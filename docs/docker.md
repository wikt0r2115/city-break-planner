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
| `VITE_MAPTILER_API_KEY` | pusta | Publiczny klucz mapy MapTiler, przekazywany podczas budowania frontendu. |
| `APP_OBO_ENABLED` | `true` | Włącza testową sekcję rzeczywistych noclegów OBO. |
| `APP_OBO_TIMEOUT_SECONDS` | `25` | Limit odczytu OBO w sekundach, zakres 1–30. |
| `OBO_API_KEY` | pusta | Opcjonalny poufny klucz OBO, przekazywany wyłącznie backendowi. |

Zmienne runtime przekazuje Compose. Frontend jest budowany z adresem
`/api/v1`, więc przeglądarka nie próbuje połączyć się z nazwą kontenera.
Lokalne `.env`, bazy, `target` i `node_modules` są wykluczone z kontekstu
budowania. `VITE_MAPTILER_API_KEY` jest publicznym kluczem przeglądarkowym,
obecnym w zbudowanych plikach aplikacji. Ogranicz go w MapTiler przez
Allowed HTTP origins: `localhost` dla lokalnego uruchomienia, osobny klucz
z rzeczywistą domeną dla produkcji. Mapa nie korzysta z service tokenów;
poufny `OBO_API_KEY` pozostaje na backendzie i nie trafia do zmiennych `VITE_*`.

Mapę włączysz przez dodanie `VITE_MAPTILER_API_KEY` do lokalnego
`.env.docker` i uruchomienie `docker compose --env-file .env.docker up --build -d`.
Ponieważ klucz jest ustawieniem budowania, sama operacja `restart` nie
zmieni go we frontendzie. Nie trzeba usuwać wolumenu SQLite.

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
w przeglądarce wyszukanie połączeń, rekomendacje z katalogu,
zapis atrakcji, publiczny odczyt i zachowanie planu po
`down` i ponownym `up`. Na końcu usuwa zasoby swojego projektu testowego.

Ten sam test uruchamia się w zadaniu „Docker Compose clean start” w CI.
Raport jest dostępny jako artefakt przebiegu GitHub Actions i lokalnie
w `e2e/artifacts/docker-report.json`.
