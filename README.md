# City Break Planner

Demo planera krótkich wyjazdów między Londynem, Paryżem i Amsterdamem. Rozkłady, dojazdy, ceny i atrakcje są zapisane w SQLite. Godziny i ceny są demonstracyjne.

| Relacja | Przykładowe warianty w obie strony |
| --- | --- |
| Londyn – Paryż | Pociąg lub autokar, z metrem i autobusem miejskim |
| Paryż – Amsterdam | Pociąg lub samolot, z dojazdami na lotniska i tramwajem |
| Londyn – Amsterdam | Pociąg lub nocny prom przez Harwich i Hoek van Holland, z dojazdami koleją i metrem |

## Uruchomienie

W katalogu projektu użyj `docker compose up --build -d` i otwórz [localhost:8080](http://localhost:8080/). SQLite znajduje się w trwałym wolumenie. Szczegóły opisuje [instrukcja Docker Compose](docs/docker.md).

Bez Dockera uruchom backend z katalogu `backend` w pierwszym terminalu (JDK 21):

```powershell
.\mvnw.cmd -B -ntp package
java -jar target/city-break-planner-0.0.1-SNAPSHOT.jar
```

Na Linuxie lub macOS użyj `./mvnw` zamiast `.\mvnw.cmd`. W drugim terminalu, z katalogu `frontend` (Node 22.22.2+):

```sh
npm ci
npm run dev
```

Otwórz [localhost:5173](http://localhost:5173/). Przy pierwszym odczycie backend wczyta [dane demonstracyjne](backend/src/main/resources/demo-data.sql) do tabel `demo_*` w tej samej bazie. Zapisane plany są w tabeli `plans`. Dni demo korzystają z powtarzalnego rozkładu, więc przykład działa także po zmianie daty prezentacji.

## Scenariusz pokazu

1. Kliknij „Uzupełnij przykładową trasę” i wyszukaj Londyn → Paryż. Zmień priorytet z „Niższy koszt” na „Krótszy dojazd” i wyszukaj ponownie. Autokar ustąpi pierwszego miejsca pociągowi.
2. W sekcji zwiedzania wybierz zainteresowania i budżet. Kliknij „Zaproponuj atrakcje”. Przy budżecie 0 zł możesz pokazać propozycję Jardin des Tuileries i dodać ją do planu.
3. Wybierz wcześniejszy powrót o 08:15. Aby pokazać konflikt, ustaw wcześniej jedną wizytę ręcznie na dzień powrotu po 08:15. Zapisz plan i otwórz link do odczytu w osobnym oknie.
4. Wyszukaj Londyn → Amsterdam z powrotem co najmniej dwa dni po wyjeździe, żeby pokazać nocny prom. Czas podróży obejmuje przesiadki, a godziny przy odcinkach są lokalne.

## OpenAI

`OPENAI_API_KEY` jest opcjonalną zmienną tylko dla backendu. Zapisany klucz użytkownika Windows nadal działa. Po zbudowaniu backendu można użyć `scripts\start-openai-local.cmd`. W Compose klucz można przekazać ze środowiska lub lokalnego `.env.docker` utworzonego z `.env.docker.example`.

Kliknięcie „Zaproponuj atrakcje” może wysłać do GPT-6 Luna miasto, czas na miejscu, budżet, zainteresowania i pasujące pozycje katalogu. Wybór przechodzi kontrolę harmonogramu oraz łącznego budżetu. Bez klucza, przy awarii lub po osiągnięciu limitu pojawiają się propozycje z katalogu. Domyślnie limit to 4 próby dziennie na proces backendu (`APP_AI_DAILY_REQUESTS`). Formularz transportu, zapis i otwarcie planu korzystają z danych lokalnych.

## Testy i CI

- Backend w `backend`: `./mvnw -B -ntp package`.
- Frontend w `frontend`: `npm ci`, `npm test`, `npm run build`.
- Przeglądarka w `e2e`: `npm ci`, `npx playwright install chromium`, `npm test` i `npm run test:showcase`. Ustaw `E2E_SKIP_BUILD=1`, jeśli backend i frontend są już zbudowane.

GitHub Actions uruchamia te sprawdzenia po pushu i przy pull requestach.
Osobne zadanie buduje oba obrazy Docker Compose na świeżym runnerze i testuje demo z pustą bazą SQLite, zapisem i ponownym uruchomieniem kontenerów. Oba zadania działają bez klucza OpenAI. Aktualny format żądań opisuje [kontrakt REST](docs/api-contract.md).
