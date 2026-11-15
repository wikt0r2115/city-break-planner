# Scalenie gałęzi i przegląd — 2026-11-15

Kontynuacja prac SOL-118/SOL-122 i zmian zleconych przez właściciela.
Wspólną gałęzią jest lokalny `main`. Nie wykonywano push ani usuwania gałęzi.

## Historia

- Po `git fetch --all --prune` sprawdzono 11 dotychczasowych gałęzi lokalnych
  oraz obie gałęzie zdalne: `origin/main` i `origin/codex/europe-demo-docker-ci`.
- `f69a951` zachowuje dotychczasowe niezacommitowane zmiany planera, map,
  OBO, liczby osób, pokoi i bazy noclegowej.
- Siedem starszych gałęzi miało osobne identyfikatory commitów, ale
  `git cherry HEAD <branch>` pokazał wyłącznie równoważne patche (`-`).
  Ich implementacje były już przeniesione przez cherry-pick.
- `86d9c1e` łączy te historie: `infra/docker-compose`, `sol-115/sources`,
  `sol-116-117/backend`, `sol-118/ui`, `sol-119/live-sources`, `sol-120/e2e`
  i `sol-121/release`. Merge strategią `ours` zachował dokładnie drzewo
  pierwszego rodzica; nie przywracał starszych implementacji.
- Obie gałęzie `sol-114/*`, dotychczasowy `main` oraz gałąź europejska były
  już zawarte w tej historii. Sprawdzono, że wszystkie 14 referencji
  lokalnych/zdalnych, łącznie z gałęzią integracyjną, są przodkami `main`.
- `5006a00` wyróżnia klikalne kontrolki, szczegóły i wybór połączenia.
- Robocze pliki w pozostałych worktrees pozostawiono nietknięte.
  Lokalne klucze, `.env.docker`, bazy i artefakty pozostały poza Git.

## Wynik review

Zakończony `codex review` otrzymał zakres produkcyjnego kodu frontendu,
planera i integracji OBO względem `origin/main` (`d6ab32a`). Pierwsze szersze
próby zostały przerwane przez limit usługi/przerwanie procesu; nie traktowano
ich jako zakończonego przeglądu. Osobno wykonano niezależną kontrolę
bezpieczeństwa i infrastruktury oraz przegląd zmiany wyglądu.

**P2 — lokalne odrzucenia przedłużały blokadę OBO: poprawione w `5e2211d`.**
Zaokrąglony czas oczekiwania z `reserve()` ponownie przesuwał `nextAllowed`.
Przy częstych ponowieniach blokada wspólna dla użytkowników mogła trwać
bez końca. Lokalnie odrzucone żądanie zwraca teraz odpowiedź bez zmiany
terminu; przedłużać go może odpowiedź dostawcy. Nowy test odtworzył błąd
przed poprawką i przechodzi po niej: 20 ponowień co 100 ms, zarówno po
lokalnej przerwie 6 s, jak i po odpowiedzi dostawcy z przerwą 120 s.

**Regresja skryptu nagrywania po wprowadzeniu kreatora: poprawiona.**
Skrypt czekał na ukryty etap atrakcji, zakładał automatyczny wybór miejsc
i zapisywał poza podsumowaniem. Teraz przechodzi przez etapy, jawnie dodaje
trzy miejsca i dopuszcza kontrolki mapy w publicznym widoku, nadal
zabraniając edycji. Rzeczywiste nagranie i odtworzenie GIF w przeglądarce
przeszły; historyczne pliki `docs/media/demo.*` pozostały nietknięte.

Kontrola bezpieczeństwa nie znalazła innych P0–P2. Sprawdzono stałe
endpointy i brak przekierowań, allowlisty URL, DOM popupów, owner/share
capabilities, SQL, TTL cen, minimalną bazę hotelową, konfigurację sekretów,
nieuprzywilejowane kontenery i logi proxy. Inspekcja SDK 4.2.1 potwierdziła
obecność sanitacji attribution; sama etykieta advisory nie była traktowana
jako dowód podatności. Nie wykonywano pełnego pentestu.

## Weryfikacja

| Sprawdzenie | Wynik i zakres |
| --- | --- |
| Czysta worktree `86d9c1e`: `backend/./mvnw -B -ntp package` | 68/68, poprawny JAR |
| Po poprawce OBO: `backend/./mvnw -B -ntp package` | 69/69, poprawny JAR |
| Czyste `npm ci` w `frontend/` i `e2e/` | Obie instalacje przeszły |
| `frontend/npm test`, `frontend/npm run build` | 99/99 oraz TypeScript/Vite; ponowione po zmianie wyglądu |
| `e2e/E2E_SKIP_BUILD=1 npm test` | 14 grup, w tym CRUD, uprawnienia, restart API i reset nowego planu |
| `e2e/E2E_SKIP_BUILD=1 npm run test:showcase` | PASS |
| `e2e/E2E_SKIP_BUILD=1 npm run test:stays` | PASS; ponowiony po zmianie wyglądu, kontrolowane oferty hotelowe |
| `e2e/E2E_SKIP_BUILD=1 npm run test:map` | PASS |
| `e2e/npm run test:docker` z czystej worktree | PASS; świeże obrazy `--pull --no-cache`, pusty wolumen, przeglądarka, restart, trwałość SQLite i bezpieczne logi |
| `CHROME_NO_SANDBOX=1 RECORD_OUTPUT=/tmp/city-break-recorder-review/demo.gif node scripts/record-demo.mjs` | PASS; 7 klatek, 15 s, 1240×800, 385899 B, odtworzenie potwierdzone w przeglądarce |
| Gotowy Docker po zmianie kontrolek | PASS; kliknięcie podpisu wybiera połączenie, szczegóły nie zmieniają wyboru, fokus 3 px, telefon bez przepełnienia, reduced motion |
| `docker compose --env-file .env.docker up --build -d --wait --wait-timeout 180` po poprawce OBO | Oba serwisy healthy, zachowany istniejący wolumen |
| `git diff --check` | PASS |

Nowa praca nad wyglądem zmienia obramowania, tła, hover/focus i podpis wyboru;
nie zmienia liczby kolumn ani rozmiaru ofert. Przy długich szczegółach nadal
możliwe jest przewijanie wewnątrz etapu. Nie testowano Safari/iOS ani
rzeczywistych rezerwacji. Nie potwierdzano dostępności ofert OBO na nowe daty.
