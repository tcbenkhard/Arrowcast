# Raspberry Pi lokaal simuleren

Start vanuit de projectroot, met Docker Desktop in Linux-containerstand:

```sh
docker compose up
```

De eerste start bouwt de applicatie. Open daarna <http://localhost:8080/admin>.
Log in met `admin` / `admin` en kies bij de eerste login een nieuw wachtwoord.
Er is geen lokale Node-installatie of `.env` nodig. Bij broncodewijzigingen:

```sh
docker compose up --build
```

De container gebruikt dezelfde gebouwde React-frontend, Fastify-API,
SQLite-migraties, eerste beheerder, nginx-configuratie en Python-wifi-broker als
de Pi-image. Alleen hardwareaanroepen van de wifi-broker worden vervangen.
De API praat met de echte broker via `/run/arrowcast-network/control.sock`.
De simulatie begint zonder Ethernet of opgeslagen wifi, dus in hotspotmodus.

## Wifi en internet testen

Open **Instellingen** en sla een SSID met een geldig wifiwachtwoord op. Iedere
netwerknaam werkt in de simulatie; gebruik `wrong-password` als wachtwoord om
een mislukte verbinding te veroorzaken. Andere geldige wachtwoorden slagen.
De echte broker valideert de invoer, bewaart het NetworkManager-profiel en
verwerkt de verbindingswissel op de achtergrond.

Voer in een tweede terminal controles uit:

```sh
docker compose exec pi simctl status
docker compose exec pi simctl ethernet on
docker compose exec pi simctl ethernet off
docker compose exec pi simctl internet off
docker compose exec pi simctl internet on
docker compose exec pi simctl wifi-failure on
docker compose exec pi simctl wifi-failure off
```

Ethernet krijgt voorrang en schakelt gesimuleerde wifi uit. Zonder kabel probeert
de broker de opgeslagen wifi en valt bij een fout terug op de ArrowCast-hotspot.
Na een mislukte wifi-poging moet je de instellingen opnieuw opslaan om opnieuw
te proberen, net als op de Pi. Veranderingen duren enkele seconden;
internetdetectie kan maximaal ongeveer 15 seconden duren, plus de UI-polltijd.

De getoonde wifi-IP-adressen zijn fictief; de browser blijft bereikbaar op
`localhost:8080`, ook wanneer de simulatie offline is. `internet off` verandert
de internetstatus die de applicatie gebruikt, bijvoorbeeld om importeren te
blokkeren. Het blokkeert geen uitgaande containerverbindingen met een firewall.

## Logs testen

De logpagina toont de echte API-uitvoer en nginx-fouten. nginx logt, net als op
de Pi, geen normale paginabezoeken. Via `docker compose logs -f pi` zie je ook
processtarts en gesimuleerde netwerkovergangen.

Op de Pi leest de API de systemd-journal. In deze container leest een expliciete
`journalctl`-adapter de proceslogbestanden van Supervisor en nginx, met dezelfde
bronnen en limiet van 300 regels. Voor een herkenbare testregel:

```sh
docker compose exec pi simctl log frontend "Testmelding frontend"
docker compose exec pi simctl log backend "Testmelding backend"
docker compose exec pi simctl log updates "Testmelding updater"
```

De updater draait niet in de simulatie. De updatepagina toont daarom dat
updates uitgeschakeld zijn; het updatelog bevat een uitleg. Release-installatie,
rollback, systemd-journalrechten, TLS/publieke toegang en de SD-kaartboot worden
hier niet nagebootst. Ook echte wifi-authenticatie, radio, DHCP en de
bereikbaarheid vanaf telefoons moeten op een fysieke Pi worden gecontroleerd.
Docker Desktop gebruikt een [virtueel containernetwerk](https://docs.docker.com/desktop/features/networking/).

## Bewaren, stoppen en opnieuw beginnen

Accounts, wedstrijden, JWT-geheim, wifi-profiel en simulatieschakelaars blijven
in het Compose-volume bewaard. Proceslogs zijn tijdelijk en verdwijnen bij het
opnieuw aanmaken van de container. Stoppen:

```sh
docker compose down
```

Volledig opnieuw beginnen verwijdert **alle simulatiegegevens**:

```sh
docker compose down --volumes
docker compose up
```

Poort 8080 bezet? Stel `ARROWCAST_SIM_PORT` in, bijvoorbeeld in PowerShell:

```powershell
$env:ARROWCAST_SIM_PORT = '8081'
docker compose up
```

## Automatische controle

Met Python 3.10+ en Docker:

```sh
python deploy/sim/verify.py
```

Dit bouwt een apart, tijdelijk Compose-project op een vrije lokale poort en
controleert via nginx en de echte API: inloggen/wachtwoordwijziging, hotspot,
wifi-validatie, fout wachtwoord, wifi-herstel, Ethernet-voorrang, offline/online,
verbindingsverlies, proceslogs en behoud van account/wifi na herstart.
Na afloop verwijdert het uitsluitend zijn eigen testcontainers en testvolume.
