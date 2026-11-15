# City Break Planner

MVP planera wyjazdów między Londynem, Paryżem i Amsterdamem. Użytkownik wybiera transport, nocleg i atrakcje, a następnie zapisuje, edytuje, usuwa lub udostępnia plan do odczytu.

Rozkłady i ceny transportu oraz wstępów są demonstracyjne. Oferty noclegów pochodzą z OBO.

## Demo

[Obejrzyj nagranie aplikacji](docs/media/demo.webm)

## Technologie

- `backend/`: Java, Spring Boot, REST API z CRUD i CORS, SQLite.
- `frontend/`: React, TypeScript, Vite.
- Docker Compose: uruchomienie całości bez osobnego serwera bazy.

[Kontrakt API](docs/api-contract.md) · [Testy](docs/acceptance.md)

## Uruchomienie

```bash
git clone https://github.com/wikt0r2115/city-break-planner.git
cd city-break-planner
```

### Docker

Wymagany Docker z Compose:

```bash
docker compose up --build -d
```

Otwórz http://localhost:8080. SQLite powstaje automatycznie i pozostaje w trwałym wolumenie.

### Alternatywnie: bez Dockera

Wymagane JDK 21, Node 22.22.2+ z linii 22 i npm 10.
Oba terminale rozpocznij w katalogu repozytorium.

Terminal 1 — API:

```bash
cd backend
./mvnw spring-boot:run
```

Na Windows zamiast `./mvnw` użyj `.\mvnw.cmd`.

Terminal 2 — frontend:

```bash
cd frontend
npm ci
npm run dev
```

Aplikacja: http://localhost:5173 · Health API: http://localhost:8080/api/v1/health

Mapa wymaga publicznego klucza `VITE_MAPTILER_API_KEY` w `frontend/.env.local`. Pozostałe funkcje działają bez niego. Konfigurację mapy w Dockerze opisuje [instrukcja](docs/docker.md).

## Wsparcie AI przy tworzeniu projektu

Codex wspierał implementację, refaktoryzację, testy i niezależne recenzje. Zasady pracy agentów znajdują się w [AGENTS.md](AGENTS.md) oraz odpowiednich plikach w `backend/` i `frontend/`.
