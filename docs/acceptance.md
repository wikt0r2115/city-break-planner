# Testy aplikacji

Wymagane: JDK 17–25, Node 22.22.2+ (linia 22), npm i Chrome/Chromium.

## Backend i frontend

Z katalogu `backend/`:

```bash
./mvnw -B -ntp package
```

Na Windows użyj `mvnw.cmd`. Polecenie uruchamia testy i buduje JAR.
Z katalogu `frontend/`:

```bash
npm ci
npm test
npm run build
```

## Testy przeglądarkowe

Z katalogu `e2e/`:

```bash
npm ci
npx playwright install chromium
npm test
npm run test:showcase
npm run test:map
npm run test:stays
```

Każdy runner przygotowuje backend i frontend. Po wcześniejszym zbudowaniu
JAR-a i zainstalowaniu zależności można ustawić `E2E_SKIP_BUILD=1`.
Zamiast instalować Chromium, można wskazać istniejącą przeglądarkę przez
`E2E_BROWSER_PATH=/sciezka/do/chrome`. Harness wykrywa też lokalny Chrome
pod `/opt/google/chrome/chrome`.

Testy uruchamiają własne Spring Boot i Vite na losowych portach loopback,
z odpowiednim CORS i osobnym SQLite. Zatrzymują własne procesy i sprzątają
swoje bazy; nie używają danych ani serwerów użytkownika.

| Polecenie | Zakres |
| --- | --- |
| `npm test` | Kontrolowany dostawca `fixture`: priorytety, ceny grupy, kreator, reset, edycja atrakcji, konflikty, CRUD, uprawnienia, publiczny odczyt, restart API i obsługa błędów. |
| `npm run test:showcase` | Katalog SQLite `demo`: sześć kierunków między Londynem, Paryżem i Amsterdamem, środki transportu, ranking, rekomendacje z katalogu i zapis w przeglądarce. |
| `npm run test:map` | Rzeczywisty renderer MapTiler z kontrolowanym podkładem: punkty, popupy, klawiatura, zapis, publiczny widok oraz błąd i ponowienie. |
| `npm run test:stays` | Kontrolowane oferty OBO: pokoje, zdjęcia, cache przez F5, TTL, wybór hotelu, mapa, baza noclegowa w harmonogramie i zapis planu. |
| `npm run test:docker` | Osobny projekt Compose, świeże obrazy i wolumen, działające API/SQLite, zapis, restart i trwałość danych. Wymaga Dockera; szczegóły w [instrukcji](docker.md). |

Wyniki i zrzuty trafiają do ignorowanego `e2e/artifacts/`. Główny runner
zapisuje `demo-report.json`, a przy błędzie także `failure.png` i logi
własnych serwerów. Nie wypisuje tokenu właściciela.

## Granice

Przykładowe ceny i rozkłady nie są ofertami przewoźników. Podkład mapy
oraz odpowiedzi hotelowe w automatycznych testach są kontrolowane, więc
wynik nie potwierdza dostępności zewnętrznych usług ani aktualnych cen OBO.
Testy nie wykonują rezerwacji i płatności. CI uruchamia testy Java,
frontendu, główny E2E, showcase i osobny test Dockera; mapę i noclegi
uruchamia się także powyższymi poleceniami.

## Wsparcie AI przy tworzeniu projektu

Codex był używany do koordynowania zadań z Linear, implementacji,
sprawdzania źródeł, testów i niezależnej recenzji zmian. Pliki `AGENTS.md`
w repozytorium opisują podział odpowiedzialności i zasady weryfikacji.
