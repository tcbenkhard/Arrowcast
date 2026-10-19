# Arrowcast

Basisstructuur voor de boogschietcompetitiewebsite uit
[ARCHITECTURE-HANDOFF.md](ARCHITECTURE-HANDOFF.md). Eén project met npm
workspaces, één lockfile en afzonderlijk bouwbare frontend en backend.

De publieke startpagina staat op `/`. Onder `/admin` staat het beveiligde
beheerportal met loginformulier. De backend geeft JWT's uit; beheerfuncties en
score-invoer volgen later.

## Vereisten

- Node.js 24 LTS (minimaal 24.13.0 binnen de 24-reeks; `.nvmrc` bevat de geteste versie).
- npm 11.

## Installeren en ontwikkelen

Voer in de projectroot uit:

```sh
npm ci
```

Kopieer `.env.example` naar `.env` in de projectroot. Voer daarna uit:

```sh
npm run auth:setup
```

Plaats het gegenereerde `JWT_SECRET` in `.env`. De API start alleen met een
geldig JWT-geheim. Bewaar `.env` buiten versiebeheer.

Bij het starten worden openstaande databasemigraties uitgevoerd en wordt de
eerste beheerder aangemaakt: gebruikersnaam `admin`, wachtwoord `admin`.
Als die gebruiker al bestaat, blijven het wachtwoord en de rol behouden.

Start daarna in twee terminals:

```sh
npm run dev:api
```

```sh
npm run dev:web
```

De frontend staat op `http://localhost:5173`, de backend op
`http://127.0.0.1:3000`. Vite stuurt `/api` door naar de backend. Open
`http://localhost:5173/admin` en log in met `admin` / `admin`.

De API leest `.env` bij zowel ontwikkelen als starten van de build. Bij wijziging
van de backendpoort moet ook het proxydoel in `apps/web/vite.config.ts` worden
aangepast. Sla geheimen nooit op in frontendvariabelen.

## Structuur

```text
apps/
  web/                 React + Vite; eigen package.json en TypeScript-configuratie
    src/features/      Login en beheerportal; overige features volgen later
    src/components/    Gedeelde UI-componenten
    src/lib/           Frontendhulpmiddelen
  api/                 Fastify; eigen package.json en TypeScript-configuratie
    src/modules/       JWT-authenticatie; overige modules volgen later
    src/db/            Drizzle-schema, SQLite-verbinding en adminseed
    src/plugins/       Toekomstige Fastify-plugins
packages/
  contracts/           Leeg package voor gedeelde API-contracten
  scoring/             Leeg package voor pure scoreberekeningen
migrations/            SQL-migraties met Drizzle-journal en schemasnapshots
tests/e2e/             Playwright-tests voor de authenticatieflow
```

De `.gitkeep`-bestanden bewaren de lege folders in versiebeheer. Gedeelde packages
bevatten nog geen schema's of logica en zijn nog geen afhankelijkheden van de apps.
Voeg die afhankelijkheden expliciet toe wanneer ze gebruikt gaan worden; de
frontend importeert geen backendcode.

## Bouwen en controleren

Alle commando's worden vanuit de projectroot uitgevoerd:

| Commando | Resultaat |
| --- | --- |
| `npm run build:web` | Alleen frontend naar `apps/web/dist/` |
| `npm run build:api` | Alleen backend naar `apps/api/dist/` |
| `npm run build` | Beide apps en beide gedeelde packages |
| `npm run typecheck` | Strikte TypeScript-controle van alle workspaces |
| `npm test` | Backendtests voor JWT-toegang, validatie en loginlimieten |
| `npm run test:e2e` | Browsercontroles van login, herstel, logout en tokenverloop |
| `npm run db:generate -- --name=beschrijving` | Nieuwe SQL-migratie genereren uit het schema |
| `npm run db:migrate` | Openstaande migraties uitvoeren zonder de API te starten |
| `npm run start:api` | Gebouwde backend starten |
| `npm run preview --workspace=@arrowcast/web` | Gebouwde frontend lokaal bekijken |

Voor de aparte builds is geen voorafgaande build van de andere app nodig.
Installeer afhankelijkheden altijd vanuit de projectroot met de gedeelde lockfile.
CI voert `npm ci`, de typecontrole, de volledige build en beide testsuites uit.

Installeer voor de browsertests eenmalig Chromium met `npx playwright install chromium`.
De tests starten eigen servers op poorten 3000 en 5173; houd die poorten vrij.
Ze gebruiken een tijdelijke database en lezen je `.env` niet.

## Databaseversiebeheer

De backend gebruikt SQLite met Drizzle ORM. `DATABASE_PATH` bepaalt het
databasebestand (standaard `data/arrowcast.sqlite`); relatieve paden beginnen
altijd bij de projectroot. Ontbrekende mappen worden aangemaakt. De backend
sluit de database bij het stoppen.

Wijzig voor een schemawijziging `apps/api/src/db/schema.ts` en voer
`npm run db:generate -- --name=beschrijving` uit. Commit het SQL-bestand en de
bijbehorende bestanden in `migrations/meta/`. Bewerk al uitgevoerde migraties
niet; voeg voor een volgende wijziging een nieuwe migratie toe. Dit volgt de
[Drizzle-migratieworkflow](https://orm.drizzle.team/docs/migrations).

Migraties worden bij het starten toegepast voordat de API beschikbaar wordt;
bij een fout start de API niet. De tabel `__drizzle_migrations` registreert de
uitgevoerde versies. Je kunt ze ook vooraf toepassen met `npm run db:migrate`.
Maak een back-up voordat je bestaande databases migreert. De map `migrations/`
moet naast de apps worden meegeleverd bij een deployment.

De adminseed draait na de migraties. Alleen een ontbrekende gebruiker met
gebruikersnaam `admin` wordt toegevoegd, met een scrypt-hash van `admin`.
Herstarten overschrijft geen bestaande accounts of wachtwoorden.

## Authenticatie

- `POST /api/v1/auth/login` ontvangt JSON `{ "username": "…", "password": "…" }`.
  Bij succes bevat de response `{ "token": "…", "expiresAt": 1234567890000 }`;
  `expiresAt` is een Unix-tijdstip in milliseconden.
- `GET /api/v1/admin/me` vereist `Authorization: Bearer <token>` en retourneert
  `{ "username": "…", "role": "admin", "expiresAt": 1234567890000 }`.
- JWT's zijn één uur geldig, ondertekend met HS256 en gebonden aan de beheerapp
  via issuer en audience. De server controleert de adminrol en gebruikersnaam.
  Nieuwe beheer-API-routes horen in de beveiligde `/admin`-scope in `routes.ts`.
- Accounts en scrypt-wachtwoordhashes staan in de database. De login en
  toegangscontrole lezen de gebruiker uit de database.
  De login staat maximaal vijf pogingen per IP per minuut toe. De implementatie
  volgt de officiële [Fastify JWT-plugin](https://github.com/fastify/fastify-jwt)
  en [rate-limit-plugin](https://github.com/fastify/fastify-rate-limit).
- De browser bewaart de JWT in `sessionStorage` per tabblad en valideert deze
  bij het openen of verversen van `/admin` via de backend. Verlopen of ongeldige
  tokens verwijderen de toegang; verbindingsfouten bieden een nieuwe poging.
- Uitloggen verwijdert de JWT uit het tabblad. Een eerder gekopieerde JWT blijft
  geldig tot het verstrijken van het uur; er is nog geen server-side intrekking
  of refreshmechanisme. Rotatie van `JWT_SECRET` maakt alle bestaande JWT's ongeldig.
- De eerste beheerder wordt automatisch geseed met `admin` / `admin`.
  Gebruik HTTPS buiten lokale ontwikkeling om wachtwoorden en tokens te beschermen.
  De JWT-keuze uit deze implementatie vervangt het sessievoorstel uit de handoff.

## Range Management API

De beheerpagina `/admin/ranges` toont de ranges met ondersteunde afstanden en
baannummers. Via **Add** opent een modal voor een nieuwe range. Baannummers kunnen
als `1-11`, `1, 3, 5` of een combinatie worden ingevoerd.

`GET /api/v1/admin/ranges` vereist `Authorization: Bearer <token>` en retourneert
een lijst van ranges met `id`, `name`, `supportedDistancesMeters` en `lanes`
(elk met `id` en `number`). Ranges staan op naam gesorteerd, afstanden en banen
oplopend op afstand en nummer.

`POST /api/v1/admin/ranges` vereist `Authorization: Bearer <token>` en maakt
een range met ondersteunde afstanden en fysieke lanes aan:

```json
{
  "name": "Indoor",
  "supportedDistancesMeters": [18, 25],
  "lanes": [{ "number": 1 }, { "number": 2 }]
}
```

Bij succes volgt `201 Created` met `id`, `name`, `supportedDistancesMeters` en
`lanes` (elk met `id` en `number`). IDs zijn UUIDs. Alle lanes ondersteunen de
afstanden van hun range; meerdere afstanden maken geen extra fysieke lanes.
De naam wordt getrimd en moet 1 tot 100 tekens bevatten. Afstanden moeten positief
en uniek zijn (1 tot 100 afstanden). Een range bevat 1 tot 1000 lanes met positieve
gehele nummers tot 2147483647, uniek binnen die range. Andere ranges mogen dezelfde
baannummers gebruiken. Ongeldige invoer geeft `400`; ontbrekende of ongeldige
authenticatie geeft `401`. Aanmaken gebeurt in een transactie: bij een fout wordt
niets opgeslagen. Migratie `0001_add_ranges.sql` voegt de benodigde tabellen toe.

## Competition Management API

The **Competitions** tab at `/admin/competitions` lists competitions in ascending
date and starting time order. **Add** opens a modal to enter a name, date, starting
and ending time, select a range, and assign a supported distance to each selected
physical lane. Create a range first if none exist.

`GET /api/v1/admin/competitions` and `POST /api/v1/admin/competitions` require
`Authorization: Bearer <token>`. Create a competition with:

```json
{
  "name": "Indoor competition",
  "date": "2026-11-01",
  "startingTime": "09:00",
  "endingTime": "12:00",
  "rangeId": "<range UUID>",
  "lanes": [{ "laneId": "<lane UUID>", "distanceMeters": 18 }]
}
```

Creation returns `201` with `id`, trimmed `name`, `date`, `startingTime`,
`endingTime`, `status`, `range` (`id`, `name`), and `lanes` (`laneId`, `number`,
`distanceMeters`). New competitions always start in `Scheduled`. The overview and
`GET /api/v1/admin/competitions/:competitionId` return the competition fields
including `status`, without lanes. Lane assignments are loaded separately.
Dates use `YYYY-MM-DD`; times use `HH:mm` and are local to the competition,
without timezone conversion. Ending time must be after starting time on the same
date. Names must contain 1?100 characters; select 1?1000 unique lanes from the
chosen range and a supported distance for each. Invalid input returns `400`;
invalid authentication returns `401`.

The status flow is `Scheduled > Check-in > Active > Closed`. Use the
next stage in the flow strip above competition details to advance one step. The authenticated
`PATCH /api/v1/admin/competitions/:competitionId/status` endpoint accepts
`{ "status": "Check-in" }` and returns the updated competition. Earlier stages can
be selected to move back. Skipping forward or selecting the current stage returns
`409`; a missing competition returns `404`.

Creation is transactional. Database foreign keys enforce range, lane and distance
ownership. Migration `0012_competition_status.sql` replaces the `active` boolean
with `status`, maps existing active competitions to `Active` and inactive ones to
`Draft`, and preserves lane assignments and participant registrations. Migration
`0013_scheduled_initial_status.sql` converts Draft to Scheduled and makes Scheduled
the default starting status.

Competition lanes default to **one target**. Migration
`0005_default_one_target.sql` fills previously unset target counts with 1 and
preserves configured counts. The lane dropdown offers 1 or 2 targets. Select individual
lanes or use the Select all checkbox; when lanes are selected, two dropdowns
above the table apply a target type or target count to those lanes only. Every
change saves immediately; requests for the same lane are processed in order. Save failures appear below the dropdown with
a retry option.

Entering Check-in generates persistent shooting assignments in
`competition_participants`: `checked_in`, `lane_id`, and `target_letter`. A/C use
target 1 and B/D use target 2, with at most two shooters per target. The planner
matches target types, minimizes the number of shooting lines, balances their
occupancy, and maximizes spacing within each line and target group. With mixed
target types, spacing is improved across groups over several passes.

Moving back to Scheduled preserves assignments and check-in flags. Entering
Check-in again fills only unassigned places, using existing lines where possible.
Insufficient matching capacity returns `409` without changing assignments or status.
Lane and participant target edits that invalidate assigned places also return `409`.

During Check-in, `PATCH /api/v1/admin/competitions/:competitionId/participants/:participantId/check-in`
accepts `{ "checkedIn": true }` or `false`. The **Reassign checked-in participants**
button calls `POST /api/v1/admin/competitions/:competitionId/assignments/reassign`:
it rebuilds assignments for checked-in participants and releases everyone else's
place. This action is only available during Check-in. Assignment writes are
transactional, and the database prevents duplicate places. Migration
`0014_shooting_assignments.sql` preserves registrations, initializes check-in flags
to false, and caps legacy lane target counts above two at two. Scoring can later
extend the same competition participant record.

## Target types

The **Target types** tab at `/admin/target-types` lists target names and lets an
administrator add a type. Types are plain strings, trimmed to 1?100 characters;
duplicate names are rejected without regard to ASCII case. Competition lanes
select a name from this catalogue and continue saving changes automatically.
Existing lane values remain available in the selector.

Both endpoints require `Authorization: Bearer <token>`:

- `GET /api/v1/admin/target-types` returns an array of strings.
- `POST /api/v1/admin/target-types` accepts `{ "name": "Custom target" }` and
  returns the created name as a JSON string with status `201`. Invalid input
  returns `400`, duplicate names `409`, and invalid authentication `401`.

Migration `0004_target_types.sql` creates the catalogue, seeds 18 Dutch target
names, and imports existing competition lane target names. The seed covers full
40/60/80/122 cm faces, Dutch Target, Las Vegas, horizontal 3-spot, compound 4-spot,
80 cm 6-ring, hit/miss, field faces, and 3D/paper animal targets. It is an
extensible starting list; it does not define scoring or eligibility rules.
Sources are recorded in the migration, including the
[KHSN competition guide](https://mijn.handboogsport.nl/bondscompetities/info/),
[indoor target specifications](https://sportinfrastructuur.nl/voorschriften/C0255),
and [outdoor target specifications](https://www.sportinfrastructuur.nl/voorschriften/C0251).

## Deelnemers en verenigingen importeren

```sh
npm run db:import-participants
```

Dit script ontdekt het nieuwste seizoen op mijn.handboogsport.nl en haalt de
individuele regiocompetities op voor Indoor en 25m 1pijl, voor alle aangeboden
regio's en boogtypen. Het importeert namen, bondsnummers en verenigingen met
verenigingsnummers, inclusief verenigingen uit de filters zonder deelnemers.
Het gebruikt uitsluitend openbare pagina's; inloggen is niet nodig.

De import gebruikt `DATABASE_PATH` uit `.env` (standaard `data/arrowcast.sqlite`).
Deelnemers worden op bondsnummer bijgewerkt met behoud van hun id; verenigingen
op verenigingsnummer. Bestaande records worden niet verwijderd. Nummers blijven
tekst zodat voorloopnullen behouden blijven. Alle gegevens worden eerst opgehaald
en gecontroleerd en vervolgens in één transactie opgeslagen. Bij bronfouten of
tegenstrijdige deelnemergegevens wordt niets geïmporteerd. Verzoeken volgen elkaar
op met minimaal een halve seconde tussenruimte en een timeout van 30 seconden.

Gebruik `npm run db:import-participants -- --dry-run` om alleen te controleren
en aantallen te tonen zonder de database te openen of te wijzigen.

Het tabblad **Instellingen** staat rechts in het beheerportal op `/admin/settings`.
Klik op **Importeer deelnemers uit handboogsport** om dezelfde import vanuit de
browser te starten. De pagina toont voortgang, fouten en de aantallen na afloop.
De import draait op de achtergrond en gaat door wanneer je de pagina verlaat;
bij terugkomst verschijnt de actuele status. Tijdens een import kan geen tweede
import vanuit het beheerportal worden gestart. De status blijft beschikbaar tot
de API herstart; deelnemers en verenigingen blijven in de database bewaard.
Stoppen/herstarten van de API tijdens het ophalen onderbreekt de beschikbaarheid;
de server wacht bij normaal afsluiten op een lopende import.

`POST /api/v1/admin/participants/import` start de import (`202`, of `409` als er al
een loopt). `GET /api/v1/admin/participants/import` geeft de status en het resultaat.
Beide endpoints vereisen een ingelogde beheerder.

## Deelnemers aan wedstrijden toevoegen

Open een wedstrijd en klik onder **Participants** op **Add participant**.
De modal zoekt op naamwoorden (fulltext, ongeacht volgorde en accenten, met
woordvoorvoegsels) en op volledig of gedeeltelijk bondsnummer. Er verschijnen
maximaal twintig resultaten. Na het invullen van een zoekterm staat **New participant** bovenaan en opent
een formulier voor naam, bondsnummer en een bestaande vereniging. Selecteer een
bestaande deelnemer met de muis of Enter, of neem het gemarkeerde resultaat over
met Tab en ga direct naar het tweede veld **Bow type**. Pijltoetsen wijzigen de
selectie, ook naar **New participant** bovenaan. Typ of selecteer een boogtype;
de eerste Enter bevestigt het boogtype, de tweede Enter schrijft de deelnemer in.
De knop **Add participant** kan ook worden gebruikt na beide selecties.
Na toevoegen blijft de modal open met beide velden leeg en focus op het zoekveld voor de volgende
deelnemer. Dit geldt ook na het aanmaken van een nieuwe deelnemer.
Dubbele inschrijvingen en dubbele
bondsnummers worden geweigerd; invoer blijft bij fouten behouden.

De beveiligde API biedt `GET /api/v1/admin/participants?q=...`,
`GET /api/v1/admin/clubs`, `GET /api/v1/admin/bow-types` en `GET`/`POST` op
`/api/v1/admin/competitions/:competitionId/participants`. Een POST bevat óf
`{ "participantId": "...", "bowType": "Recurve" }` óf
`{ "name": "...", "federationNumber": "...", "clubNumber": "...", "bowType": "Recurve" }`.
Een nieuwe deelnemer en inschrijving worden samen in een transactie opgeslagen.
Boogtype is verplicht voor nieuwe inschrijvingen en verwijst naar de boogtypenlijst.
Het wordt per wedstrijd opgeslagen en in de deelnemerstabel getoond. Bestaande
inschrijvingen zonder boogtype blijven behouden en tonen een streepje.
Migratie `0010_competition_participant_bow_type.sql` voegt dit veld toe.

Selecteer deelnemers met de selectievakjes of **Select all**. Bij een selectie
verschijnt de knop **Uitschrijven**. Na klikken vraagt een bevestigingsvenster
om akkoord voor het aantal geselecteerde deelnemers. Annuleren behoudt de selectie.
Bevestigen verwijdert
uitsluitend de geselecteerde inschrijvingen uit de geopende wedstrijd; de
deelnemers en hun inschrijvingen in andere wedstrijden blijven behouden.
Bij fouten blijft de selectie staan en kun je opnieuw proberen.
De beveiligde API gebruikt `DELETE /api/v1/admin/competitions/:competitionId/participants`
met `{ "participantIds": ["..."] }`. Opnieuw uitschrijven is veilig: reeds
verwijderde inschrijvingen worden overgeslagen.

Migratie `0007_competition_participants.sql` maakt de inschrijftabel.
De custom migratie `0008_participant_search.sql` maakt een SQLite FTS5-index op
deelnemersnamen met bijbehorende triggers. Triggers houden deze index actueel bij
importeren, aanmaken, wijzigen en verwijderen; bestaande deelnemers worden bij
de migratie geïndexeerd.

## Latere stappen

TanStack Query, Tailwind, TypeBox, gebruikersbeheer en
scoreberekening worden toegevoegd bij de bijbehorende implementatie.
`/scoring` is nog niet geïmplementeerd.

Ook Docker/Compose, het serveren van frontendbestanden door Fastify, healthchecks,
het persistente volume en ARM64-validatie volgen later. De huidige basis is nog
geen productiedeployment; de architectuuroverdracht blijft daarvoor leidend.
