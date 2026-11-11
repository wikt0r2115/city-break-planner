# City Break Planner

Planer krótkich wyjazdów, który łączy wybór transportu ze zwiedzaniem. Po zmianie godziny powrotu ma wskazywać, które atrakcje przestają mieścić się w planie.

## Zakres SOL-114

Uruchamialny szkielet: backend Java / Spring Boot / SQLite oraz frontend
React / TypeScript / Vite. Strona startowa odczytuje `/api/v1/health`
bezpośrednio z backendu i pokazuje stan rzeczywistego połączenia z bazą.
Nie ma jeszcze wyszukiwania ofert, edytora ani zapisu planów. Nie podajemy
przykładowych cen jako rzeczywistych danych.

Wspólny [kontrakt REST](docs/api-contract.md) opisuje wyszukiwanie, cztery
priorytety, ceny i źródła, harmonogram, CRUD oraz odrębny publiczny odczyt.
Poza health endpointy są planowane w SOL-116–119.

## Wymagania

- JDK 17–25; lokalna weryfikacja na Java 25.
- Node.js 22.22.2+ z linii 22 LTS oraz npm 10; `.nvmrc` wskazuje linię 22.
- Dostęp do internetu przy pierwszym pobieraniu zależności i Maven Wrapper.

Maven jest dostarczany przez wrapper w `backend/`; instalacja systemowa
Mavena ani serwera SQLite nie jest potrzebna. Przy zainstalowanym `nvm`
uruchom w katalogu repozytorium `nvm install && nvm use`.

## Uruchomienie lokalne

Otwórz dwa terminale w katalogu repozytorium. W pierwszym:

```bash
cd backend
./mvnw spring-boot:run
```

Backend: `http://127.0.0.1:8080`. SQLite automatycznie tworzy lokalny plik
`backend/city-break-planner.db`, ignorowany przez Git. Plik zachowuje się
między uruchomieniami; tabele planów będą dodane w SOL-116.

W drugim terminalu:

```bash
cd frontend
npm ci
npm run dev
```

Otwórz **http://localhost:5173**. Strona pokaże wynik połączenia z API i SQLite.
Vite ma stały port: gdy 5173 jest zajęty, zwolnij port zamiast zmieniać origin
bez dostosowania CORS. `localhost` i `127.0.0.1` to różne originy.

Sprawdzenie API:

```bash
curl --fail http://127.0.0.1:8080/api/v1/health
```

Oczekiwane HTTP 200 i `{"status":"UP","database":"UP"}`. Awaria bazy daje
HTTP 503 i `{"status":"DOWN","database":"DOWN"}`. Wyłączony backend
powoduje czytelny błąd na stronie i pozwala ponowić sprawdzenie.

## Konfiguracja

Domyślne ustawienia wystarczają do startu. Szablony:
[backend/.env.example](backend/.env.example),
[frontend/.env.example](frontend/.env.example).

| Zmienna | Domyślna wartość | Odbiorca |
| --- | --- | --- |
| `SERVER_ADDRESS` | `127.0.0.1` | backend |
| `SERVER_PORT` | `8080` | backend |
| `SPRING_DATASOURCE_URL` | `jdbc:sqlite:./city-break-planner.db` | backend |
| `APP_CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | backend; lista po przecinku |
| `VITE_API_BASE_URL` | `http://localhost:8080/api/v1` | frontend; adres publiczny |

Spring Boot nie wczytuje automatycznie `.env`. Dla własnej konfiguracji
w terminalu backendu wykonaj (Bash, plik lokalny pod własną kontrolą):

```bash
cd backend
cp .env.example .env
# Dostosuj .env przed uruchomieniem.
set -a
source .env
set +a
./mvnw spring-boot:run
```

W frontendzie `cp .env.example .env.local`; Vite wczyta ten plik po ponownym
uruchomieniu. Nigdy nie dodawaj sekretów do `VITE_*` — trafiają do przeglądarki.
Nie ma jeszcze skonfigurowanych dostawców danych ani wymaganych kluczy API.
Klucze i nazwy zmiennych dostawców dodamy po weryfikacji źródeł w SOL-115/119.

## Testy i budowanie

Z katalogu `backend/`:

```bash
./mvnw test
./mvnw package
java -jar target/city-break-planner-0.0.1-SNAPSHOT.jar
```

Z katalogu `frontend/`:

```bash
npm ci
npm test
npm run build
```

Testy backendu sprawdzają SQLite, health i CORS. Testy frontendu sprawdzają
odczyt API oraz stany komunikacji; build sprawdza TypeScript i tworzy `dist/`.
Backend i Vite muszą działać jednocześnie, aby ręcznie sprawdzić pełne połączenie.
W Windows użyj `mvnw.cmd` zamiast `./mvnw`; eksport zmiennych dostosuj do powłoki.

## Organizacja dalszej pracy

`backend/` odpowiada za REST, walidację, planowanie, SQLite i dostawców;
`frontend/` za widoki i komunikację z API; `docs/api-contract.md` jest wspólną
umową. Koordynator uzgadnia jej zmiany przed równoległą implementacją.

SOL-115 weryfikuje źródła na konkretnych trasach i datach. SOL-116 wdraża
zapis i uprawnienia, SOL-117 planowanie, SOL-118 widoki, SOL-119 integracje.
Dalsze niezależne prace zaczynaj z tej samej aktualnej gałęzi bazowej,
w osobnych worktrees. Nie uznawaj braku ceny albo awarii dostawcy za
potwierdzony brak połączenia. Zakres obsługiwanych tras zatwierdza właściciel.

Instrukcje dla agentów są w [AGENTS.md](AGENTS.md), [backend/AGENTS.md](backend/AGENTS.md) i [frontend/AGENTS.md](frontend/AGENTS.md).
