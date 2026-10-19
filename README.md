# Arrowcast

Basisstructuur voor de boogschietcompetitiewebsite uit
[ARCHITECTURE-HANDOFF.md](ARCHITECTURE-HANDOFF.md). Eén project met npm
workspaces, één lockfile en afzonderlijk bouwbare frontend en backend.

Er zijn nog geen productfunctionaliteiten geïmplementeerd. De frontend toont
alleen een starttekst en de backend start zonder applicatieroutes.

## Vereisten

- Node.js 24 LTS (minimaal 24.13.0 binnen de 24-reeks; `.nvmrc` bevat de geteste versie).
- npm 11.

## Installeren en ontwikkelen

Voer in de projectroot uit:

```sh
npm ci
```

Start daarna in twee terminals:

```sh
npm run dev:api
```

```sh
npm run dev:web
```

De frontend staat op `http://localhost:5173`, de backend op
`http://127.0.0.1:3000`. Vite stuurt `/api` door naar de backend. De backend
geeft nu op ieder pad een JSON 404 omdat er nog geen routes zijn.

Kopieer desgewenst `.env.example` naar `.env` in de projectroot. De API leest
dit bestand bij zowel ontwikkelen als starten van de build. Bij wijziging
van de backendpoort moet ook het proxydoel in `apps/web/vite.config.ts` worden
aangepast. Sla geheimen nooit op in frontendvariabelen.

## Structuur

```text
apps/
  web/                 React + Vite; eigen package.json en TypeScript-configuratie
    src/features/      Lege featurefolders volgens de architectuuroverdracht
    src/components/    Gedeelde UI-componenten
    src/lib/           Frontendhulpmiddelen
  api/                 Fastify; eigen package.json en TypeScript-configuratie
    src/modules/       Lege backendmodules volgens de architectuuroverdracht
    src/db/            Toekomstige database-integratie
    src/plugins/       Toekomstige Fastify-plugins
packages/
  contracts/           Leeg package voor gedeelde API-contracten
  scoring/             Leeg package voor pure scoreberekeningen
migrations/            Gereserveerd voor databasemigraties
tests/e2e/             Gereserveerd voor toekomstige browsertests
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
| `npm run start:api` | Gebouwde backend starten |
| `npm run preview --workspace=@arrowcast/web` | Gebouwde frontend lokaal bekijken |

Voor de aparte builds is geen voorafgaande build van de andere app nodig.
Installeer afhankelijkheden altijd vanuit de projectroot met de gedeelde lockfile.
CI voert `npm ci`, de typecontrole en de volledige build uit.

## Latere stappen

React Router, TanStack Query, Tailwind, TypeBox, SQLite/Drizzle, authenticatie,
scoreberekening en tests worden toegevoegd bij de bijbehorende implementatie.
Er zijn nu geen database, migraties, seeds of testaccounts.

Ook Docker/Compose, het serveren van frontendbestanden door Fastify, healthchecks,
het persistente volume en ARM64-validatie volgen later. De huidige basis is nog
geen productiedeployment; de architectuuroverdracht blijft daarvoor leidend.
