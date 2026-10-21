# Arrowcast

Basisstructuur voor de boogschietcompetitiewebsite uit
[ARCHITECTURE-HANDOFF.md](ARCHITECTURE-HANDOFF.md). Eén project met npm
workspaces, één lockfile en afzonderlijk bouwbare frontend en backend.

De publieke startpagina staat op `/`. Onder `/admin` staat het beveiligde
beheerportal met loginformulier. Beheer gebruikt JWT-authenticatie; de
score-invoer gebruikt afzonderlijke QR-toegang per wedstrijdbaan.

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
Bij de eerste login moet je een nieuw wachtwoord van minstens 8 tekens kiezen.
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
    src/modules/       Authenticatie, beheer en QR-score-invoer
    src/db/            Drizzle-schema, SQLite-verbinding en adminseed
    src/plugins/       Toekomstige Fastify-plugins
packages/
  contracts/           Gedeelde scoring-API-contracten
  scoring/             Pure scorevalidatie, totalen en gemiddelden
migrations/            SQL-migraties met Drizzle-journal en schemasnapshots
tests/e2e/             Playwright-tests voor de authenticatieflow
```

De `.gitkeep`-bestanden bewaren alleen bewust gereserveerde, nog lege
featurefolders in versiebeheer. Frontend en backend delen scoringtypes via het
contracts-package. Pure, database-onafhankelijke scoringsregels staan in het
scoring-package. De frontend importeert geen backendcode.

## Bouwen en controleren

Alle commando's worden vanuit de projectroot uitgevoerd:

| Commando | Resultaat |
| --- | --- |
| `npm run build:web` | Alleen frontend naar `apps/web/dist/` |
| `npm run build:api` | Alleen backend naar `apps/api/dist/` |
| `npm run build` | Beide apps en beide gedeelde packages |
| `npm run typecheck` | Strikte TypeScript-controle van alle workspaces |
| `npm run lint` | TypeScript- en repositoryhygiënecontroles |
| `npm test` | Unit- en API-tests in alle workspaces |
| `npm run test:e2e` | Browsercontroles van login, herstel, logout en tokenverloop |
| `npm run test:deployment` | Python-tests en syntaxcontrole van appliance-scripts |
| `npm run audit:dependencies` | Dependency-audit; hoge kwetsbaarheden falen |
| `npm run check` | Lint, build, unit/API- en deploymentcontroles |
| `npm run db:generate -- --name=beschrijving` | Nieuwe SQL-migratie genereren uit het schema |
| `npm run db:migrate` | Openstaande migraties uitvoeren zonder de API te starten |
| `npm run start:api` | Gebouwde backend starten |
| `npm run preview --workspace=@arrowcast/web` | Gebouwde frontend lokaal bekijken |

Voor de aparte builds is geen voorafgaande build van de andere app nodig.
Installeer afhankelijkheden altijd vanuit de projectroot met de gedeelde lockfile.
CI voert installatie, repositoryhygiëne, typecontrole, de volledige build,
unit/API/browser/deploymenttests en de dependency-audit uit.

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
Herstarten overschrijft geen bestaande accounts of wachtwoorden. Accounts die nog
het standaardwachtwoord gebruiken, moeten dit voor beheeracties wijzigen.

## Authenticatie

- `POST /api/v1/auth/login` ontvangt JSON `{ "username": "…", "password": "…" }`.
  Bij succes bevat de response `{ "token": "…", "expiresAt": 1234567890000, "forceChangePassword": true }`;
  `expiresAt` is een Unix-tijdstip in milliseconden.
- `GET /api/v1/admin/me` vereist `Authorization: Bearer <token>` en retourneert
  `{ "username": "…", "role": "admin", "expiresAt": 1234567890000, "forceChangePassword": true }`.
- `POST /api/v1/admin/password` ontvangt `{ "currentPassword": "admin", "newPassword": "een-lang-nieuw-wachtwoord" }`.
  Het nieuwe wachtwoord moet anders zijn en minstens 8 tekens bevatten. De API
  zet `force_change_password` uit en geeft een nieuwe JWT terug. Alle eerdere
  tokens van deze gebruiker worden ongeldig via `session_version`. Zolang
  `forceChangePassword` waar is, zijn alleen `/admin/me` en `/admin/password`
  toegankelijk; andere beheeracties geven `403 PASSWORD_CHANGE_REQUIRED`.
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
  geldig tot het verstrijken van het uur of totdat het wachtwoord wordt gewijzigd.
  Rotatie van `JWT_SECRET` maakt alle bestaande JWT's ongeldig.
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

While a competition is Scheduled, **Details → Edit** shows every lane in the
selected range with its assigned distance. Select a distance to add a lane or
choose **Not assigned** to remove it; at least one lane must remain. Saving lane
or distance changes clears participant placements and preserves the target type
and target count of retained lanes. Newly added lanes use the competition's
default target and one target. Lane changes are locked once check-in starts or
scores exist.

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

## Lane scoring

Competitions define `numberOfRounds` (1–1000) and `arrowsPerRound` (1–36), defaulting
to 10 rounds of 3 arrows for existing and new competitions. Set these when creating
a competition, or use **Save scoring format** in its detail page before Check-in.
`PATCH /api/v1/admin/competitions/:competitionId/scoring-settings` accepts both fields.

During scoring, the Scoring card shows participant names, submitted rounds/total
rounds, total scores and average scores per arrow in submitted rounds, sorted by descending
average and refreshed every five seconds. QR, participants and lanes cards start
collapsed.

Starting check-in generates one QR code per lane so cards can be printed before
score entry opens. Starting the competition creates a persistent scoring cursor
for each lane and preserves those QR codes. **Lane scoring QR codes** prints the cards using the
browser's print/save-as-PDF dialog. Set **Scoring website address** to an address
reachable by the lane devices; localhost on the organizer's computer is not
reachable from a phone. QR generation runs locally without an external QR service.

QR links open `/scoring/:competitionId/:laneId/:grantId#token=...` without an admin
login. The browser removes the fragment and exchanges the random 32-byte secret
for a dedicated HttpOnly, SameSite=Strict scoring cookie scoped to that grant's
API path. QR grants last seven days; browser sessions last up to 24 hours. Scanning
the same printout on another device creates another session for the same lane.
Session secrets are stored as hashes. QR secrets are retained in the database so
authenticated admins can retrieve and reprint the same cards after refreshing.
For older codes stored only as hashes, the admin page creates retrievable codes
without revoking existing printouts or scoring sessions.
**Generate replacement QR codes** revokes previous codes and sessions while
preserving scores and progress. GET/POST/DELETE on the authenticated
`/api/v1/admin/competitions/:competitionId/scoring-codes` endpoint inspect, replace,
and revoke grants respectively. GET and POST return QR links.

The mobile screen stacks participant cards vertically in a lane group. Selecting
a card expands its score entry and collapses the previous participant. The active
card includes a scoresheet; click any round row to select it for editing.
Saving returns to the lane's current unfinished round and participant.
Use the numeric buttons to record each arrow; **Miss** scores zero and is stored
as `M`. This first scoring format supports values 0–10.
Each arrow selection in an unfinished round saves a draft to the database.
**Save** requires every arrow, submits the participant's round, and selects the
first unfinished score in round and target-letter order. Participants can be
scored out of order without skipping unfinished rounds. After all rounds are
submitted, the lane is complete.
Select an earlier round or use **Edit** in the recorded rounds to correct scores,
including after lane completion while the competition is active and unlocked.
Corrections stay local until **Save correction** submits all arrows together;
the existing submitted total remains in place until then. Switching away from an
unsaved correction asks for confirmation. The screen shows submitted totals and
the recorded rounds, including drafts.

Closing or reopening the screen, restarting the API, or scanning on another phone
restores server-confirmed drafts and the lane cursor. The screen distinguishes
saving from confirmation; input still awaiting confirmation needs a connection
and a successful retry before it is available on another device. Scoring polls
every five seconds for progress made on other devices. There is no offline queue.

Each mutation has a submission UUID and expected lane version. Saving scores,
advancing progress, recording the audit entry, and remembering the submission
are one transaction. An identical retry returns its original result; stale edits
return 409 and require reloading instead of overwriting another device.
Scoring APIs under `/api/v1/scoring/:grantId` expose `POST /exchange`, `GET /context`,
and `POST /scores`. Writes require `X-Arrowcast-Scoring: 1`; cross-site requests
are rejected. Every request checks grant/session validity, and every new write
checks current lane assignment, scoring lock, competition status and score values.

**Pause scoring** / **Resume scoring** uses the authenticated
`PATCH /api/v1/admin/competitions/:competitionId/scoring-lock` endpoint with
`{ "scoringLocked": true }` or `false`. Ending a competition revokes its QR codes and scoring sessions, blocking both
reading and entering lane scores. Open scoring pages remove the cards on their
next refresh (within five seconds). Reopening requires new QR codes. Once draft or submitted scores exist, returning to Scheduled
or Check-in is blocked so participant assignments and scoring counts stay intact.
Reopening Closed to Active preserves existing scores, progress and valid codes.

Migration `0015_lane_scoring.sql` adds scoring configuration and tables without
rebuilding or deleting existing competitions or assignments. It runs at API
startup through the normal migration mechanism.

Browser tests use a temporary SQLite database with a test club. If development
servers already occupy ports 3000/5173, set `ARROWCAST_E2E_API_PORT` and
`ARROWCAST_E2E_WEB_PORT` to unused ports before running the browser tests.
`PLAYWRIGHT_CHANNEL=msedge` can use an installed Edge browser instead of the
downloaded Playwright Chromium.

## Taalinstellingen

De site ondersteunt Nederlands en Engels. Gebruikers kiezen hun taal via het
profielmenu; beheerders kunnen deze ook instellen bij het aanmaken of bewerken
van een gebruiker. De voorkeur staat in `users.language` en wordt bij het
inloggen toegepast. Zonder account wordt de taalkeuze in de browser bewaard.

Alle interfaceteksten en applicatiemeldingen staan met een vaste sleutel in
`packages/contracts/src/locales/nl.json` en `en.json`. Voeg nieuwe teksten aan
beide bestanden toe en gebruik `t(key, parameters)` in componenten. De tests
controleren of beide catalogi dezelfde sleutels en invulparameters bevatten.
Migratie `0020_user_language.sql` voegt de voorkeur toe aan bestaande databases;
deze migratie draait automatisch bij het starten van de API.

## Latere stappen

TanStack Query, Tailwind, TypeBox, gebruikersbeheer en
scoreberekening worden toegevoegd bij de bijbehorende implementatie.
Score entry is available through the lane QR links described below.

De workflow [Raspberry Pi image](.github/workflows/pi-image.yml) bouwt een native
ARM64 SD-kaartimage met nginx, Node.js, systemd en SQLite, zonder Docker.
Zie [bouwen, downloaden en installeren](docs/pi-image.md). Handmatig starten maakt
een downloadbaar Actions-artifact; een versietag maakt ook een release die na
het uploaden van alle bestanden automatisch wordt gepubliceerd.
Een fysieke Pi-bootcheck blijft vereist voordat de image in productie wordt gebruikt.
De image zendt het open wifi-netwerk **ArrowCast** uit. Verbind zonder
wifi-wachtwoord en open `http://10.42.0.1/admin`; Ethernet blijft ook beschikbaar.
Log in met `admin` / `admin` en kies bij de eerste login een nieuw wachtwoord.
De beheerportal blijft geblokkeerd totdat het wachtwoord is gewijzigd.

Het [Raspberry Pi-installatie- en updateplan](RASPBERRY-PI-PLAN.md) beschrijft
de verdere browsergestuurde eerste installatie, back-ups, herstel en updates
zonder kennis van Docker of Linux. Deze functies volgen later; dit plan vervangt
het eerdere Docker-voorstel uit de architectuuroverdracht.
