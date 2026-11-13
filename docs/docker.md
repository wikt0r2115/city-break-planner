# SOL-122 — uruchomienie przez Docker Compose

```bash
docker compose up --build -d
```

Adres aplikacji: `http://localhost:8080`. Domyślne wartości nie wymagają
tworzenia pliku konfiguracyjnego. Pierwszy build wymaga dostępu do rejestru
obrazów, Maven Central i npm. Demo pobiera połączenia z lokalnego SQLite.

## Elementy środowiska

| Element | Odpowiedzialność |
| --- | --- |
| `frontend` | Buduje React z lockfile i serwuje pliki przez Nginx; przekazuje `/api/` do backendu, obsługuje adresy SPA `/plans/` i `/shared/`. |
| `backend` | Buduje kod Maven Wrapperem, uruchamia Spring Boot i korzysta z SQLite. Dostępny wewnątrz sieci Compose. |
| `planner_data` | Nazwany wolumen zawierający `/data/city-break-planner.db`; przetrwa odtworzenie kontenerów i zwykłe `docker compose down`. |

SQLite jest biblioteką w procesie Javy. Wszystkie klasy aplikacji są
w wykonywalnym JAR-ze i startują przez Spring Boot; nie uruchamia się ich
osobno i nie jest potrzebny dodatkowy serwer bazy.

Obrazy są wieloetapowe: narzędzia budowania nie trafiają do obrazów runtime.
Procesy aplikacji działają bez roota. Health backendu wykonuje rzeczywiste
zapytanie SQLite; frontend startuje po uzyskaniu zdrowego backendu.
Konfiguracja Nginx ponownie rozwiązuje nazwę usługi po odtworzeniu backendu.
Logi nie zapisują ścieżek z tokenami udostępniania.

## Konfiguracja

Opcjonalny szablon: `.env.docker.example`. Skopiuj do `.env.docker`,
dostosuj wartości i dodawaj `--env-file .env.docker` do poleceń Compose.

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `APP_PORT` | `8080` | Port aplikacji na komputerze użytkownika. |
| `APP_BIND_ADDRESS` | `127.0.0.1` | Adres nasłuchu opublikowanego portu. |
| `APP_FRONTEND_BASE_URL` | `http://localhost:${APP_PORT}` | Adres zapisanych linków i dozwolony origin API; zwykle nie wymaga ustawienia. |
| `OPENAI_API_KEY` | pusta | Opcjonalny klucz backendu do rekomendowania atrakcji. |
| `APP_AI_MODEL` | `gpt-6-luna` | Model używany do rekomendowania atrakcji. |
| `APP_AI_DAILY_REQUESTS` | `4` | Dzienny limit prób w procesie backendu. |

Zmienne runtime przekazuje Compose. Frontend jest budowany z adresem
`/api/v1`, więc przeglądarka nie próbuje połączyć się z nazwą kontenera.
Lokalne `.env`, bazy, `target` i `node_modules` są wykluczone z kontekstu
budowania. Wprowadzenie kluczy dostawców w dalszym etapie dotyczy wyłącznie
backendu, zgodnie z kontraktem projektu.

## Operacje

```bash
docker compose ps
docker compose logs -f --tail=100
docker compose up --build -d
docker compose down
```

Zwykłe zatrzymanie nie usuwa wolumenu. Kolejny start odczytuje zapisane
plany. `docker compose down --volumes` usuwa także dane — nie jest potrzebne
przy normalnym zatrzymywaniu aplikacji.

Domyślnie udostępniony jest jeden port na loopback. Przy dostępie z innego
komputera trzeba świadomie ustawić adres nasłuchu i `APP_FRONTEND_BASE_URL`
na adres osiągalny przez odbiorców linków.

## Weryfikacja

Opcjonalny test developerski wymaga Node zgodnego z projektem i przeglądarki
opisanej w `docs/acceptance.md`:

```bash
cd e2e
npm ci
npm run test:docker
```

Test tworzy własny projekt Compose, losowy port i pusty wolumen. Buduje
oba obrazy przez `docker compose build --pull --no-cache`. Sprawdza
w przeglądarce wyszukanie połączeń, rekomendacje z katalogu przy pustym
`OPENAI_API_KEY`, zapis atrakcji, publiczny odczyt i zachowanie planu po
`down` i ponownym `up`. Na końcu usuwa zasoby swojego projektu testowego.

Ten sam test uruchamia się w zadaniu „Docker Compose clean start” w CI.
Raport jest dostępny jako artefakt przebiegu GitHub Actions i lokalnie
w `e2e/artifacts/docker-report.json`.

### Wynik z 12 listopada 2026

**PASS** na Linux x86_64, Docker 29.9.1, Compose 5.6.0:

- `docker compose config --quiet`, konfiguracja niestandardowego portu
  i budowanie obu obrazów z kodu źródłowego.
- `DOCKER_TEST_LIVE_DATE=2026-11-14 npm run test:docker`: przeglądarka
  wykonała wyszukanie, zapis i publiczny odczyt przez rzeczywiste kontenery.
- Potwierdzono SQLite w świeżym wolumenie, procesy bez roota, brak
  opublikowanego portu backendu oraz poprawne błędy JSON z API.
- Właściwy adres linków działa z losowym portem; działają też bezpośrednie
  wejścia na trasy SPA właściciela i odbiorcy.
- Po zatrzymaniu backendu tokeny nie pojawiły się w stdout ani stderr
  logów. Po jego odtworzeniu proxy ponownie osiągnęło zdrowe API.
- Po pełnym `down` i kolejnym `up` wybrane punkty nadal były zapisane;
  usunięcie planu przez właściciela unieważniło publiczny link.
- W trybie `live` kontener pobrał rzeczywiste lokalne połączenia dla
  14.11.2026. Potwierdzono odczyt HTTPS i dostęp do źródeł z kontenera.
- Niezależna recenzja infrastruktury i bezpieczeństwa: bez otwartych blokad.

[Zapis wykonania](evidence/sol122-docker-verification.json).
Test po sprawdzeniu usunął wyłącznie zasoby swojego unikalnego projektu.
Windows, macOS i ARM64 nie były weryfikowane.
