# City Break Planner

Planer krótkich wyjazdów, który łączy wybór transportu ze zwiedzaniem. Po zmianie godziny powrotu ma wskazywać, które atrakcje przestają mieścić się w planie.

## Aktualny zakres

Backend Java / Spring Boot / SQLite udostępnia wyszukiwanie, porównywanie
czterech priorytetów, przeliczanie harmonogramu i zapis planu. Frontend
React / TypeScript / Vite pozwala wybrać podróż, edytować atrakcje, zobaczyć
konflikty po zmianie powrotu oraz udostępnić zapisany plan do odczytu.

Domyślny tryb `live` odczytuje rzeczywisty rozkład linii 100 w Gdańsku
oraz dostępne oficjalne cenniki atrakcji. **Taryfa publikowana nie jest ofertą
wycenioną dla konkretnej rezerwacji.** Każda cena pokazuje źródło i czas
odczytu; niedostępne dane nie są zastępowane wymyślonymi wartościami.
Pełny scenariusz reguł planera można też sprawdzić w jawnym trybie danych
testowych opisanym niżej.

Wspólny [kontrakt REST](docs/api-contract.md) opisuje wyszukiwanie, cztery
priorytety, ceny i źródła, harmonogram, CRUD oraz odrębny publiczny odczyt.
Weryfikację dostępu do źródeł, pokrycie dat i ograniczenia opisuje
[raport SOL-115](docs/data-sources.md). Nie potwierdzamy dostępności konkretnego
kursu lub biletu na podstawie samego opublikowanego cennika.

## Zatwierdzony etap i dalsze doprecyzowanie

Właściciel zatwierdził pierwszy etap SOL-119: **Dworzec Główny ↔ Targ Rybny
w Gdańsku, linia 100**, wyłącznie w datach opublikowanych przez ZTM,
oraz dostępne oficjalne cenniki atrakcji. To lokalny odcinek w mieście,
nie połączenie Warszawa–Gdańsk. Przystanki po obu stronach Dworca mogą mieć
różne identyfikatory; adapter sprawdza rzeczywistą kolejność i godziny kursu.

**Zakres kolei, samolotów, autokarów, promów, pozostałych tras oraz dostawców
cen wymaga doprecyzowania w dalszym etapie projektu.** Ten etap nie oznacza
pełnego pokrycia wszystkich środków transportu. Nie zakładano kont,
nie kupowano dostępu i nie deklarujemy działania niezweryfikowanych API.

Rozkład i taryfa są odrębnymi źródłami. Błąd jednego cennika zachowuje dane
pozostałych źródeł. Brak pokrycia daty lub trasy nie oznacza braku kursów.
Jeśli nie potwierdzono godzin otwarcia, warunków ulgi lub czasu dojścia,
aplikacja pokazuje ten brak zamiast przyjmować dostępność lub zerowy dojazd.

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
między uruchomieniami; zapis planów tworzy wymagany schemat przy pierwszej
operacji na repozytorium planów.

W drugim terminalu:

```bash
cd frontend
npm ci
npm run dev
```

Otwórz **http://localhost:5173**. Wyszukiwanie wymaga działającego backendu.
Vite ma stały port: gdy 5173 jest zajęty, zwolnij port zamiast zmieniać origin
bez dostosowania CORS. `localhost` i `127.0.0.1` to różne originy.

Sprawdzenie API:

```bash
curl --fail http://127.0.0.1:8080/api/v1/health
```

Oczekiwane HTTP 200 i `{"status":"UP","database":"UP"}`. Awaria bazy daje
HTTP 503 i `{"status":"DOWN","database":"DOWN"}`. Wyłączony backend
powoduje czytelny błąd na stronie i pozwala ponowić sprawdzenie.

## Pełny przebieg na danych testowych

Przed trybem testowym możesz sprawdzić dane rzeczywiste bez dodatkowych
kluczy: uruchom domyślny backend i frontend, wpisz **Dworzec Główny** oraz
**Targ Rybny**, a następnie wybierz daty z opublikowanego zakresu ZTM.
Zakres może się zmieniać; odpowiedź API podaje brak pokrycia dla zbyt
odległej daty. Lista pokazuje do 24 wariantów po porównaniu wszystkich
znalezionych par według wybranego priorytetu. Nie jest pełnym spisem kursów.

W terminalu backendu, zamiast domyślnego polecenia uruchomienia:

```bash
cd backend
APP_DATA_MODE=demo ./mvnw spring-boot:run
```

Frontend uruchom bez zmian. Tryb `demo` zwraca **wyłącznie fikcyjne, kontrolowane
przykłady**. Są oznaczone `testData: true` przez API i komunikatem w interfejsie.
Pokazane ceny i godziny nie stanowią rzeczywistych ofert, także po zapisie
i udostępnieniu planu. Nie używaj ich do zakupu lub planowania faktycznej podróży.

1. Podaj start, cel i przyszłe daty, wybierz jeden priorytet i wyszukaj.
2. Porównaj warianty, rozwiń etapy podróży i wybierz połączenie.
3. Dodawaj i usuwaj atrakcje oraz zmieniaj ich kolejność. Harmonogram oblicza API.
4. Wybierz wcześniejszy powrót. Punkty pozostają w planie, a przy kolizjach
   pojawiają się powody, uwzględniające dojazd i godziny otwarcia.
5. Zapisz plan i skopiuj link do odczytu. Otwórz go w osobnej sesji przeglądarki:
   odbiorca widzi plan bez kontrolek edycji.

Token edycji jest zapamiętywany lokalnie przez przeglądarkę dla danego planu.
Link do odczytu go nie zawiera. Wyczyszczenie danych przeglądarki oznacza
utratę lokalnego prawa edycji; nie ma jeszcze kont ani odzyskiwania tokenu.
Publiczny link pozostaje aktywny do usunięcia planu. Zapisane plany można
odczytać po ponownym uruchomieniu backendu z tym samym plikiem SQLite.

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
| `APP_FRONTEND_BASE_URL` | `http://localhost:5173` | backend; baza linków do odczytu |
| `APP_DATA_MODE` | `live` | backend; `demo` włącza jawne przykłady testowe |
| `APP_SOURCE_TIMEOUT_SECONDS` | `3` | backend; limit odczytu źródła, zakres 1–5 s |
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
Zatwierdzone źródła lokalne nie wymagają kluczy API. Dane pobiera serwer,
z ograniczeniem czasu i rozmiaru odpowiedzi. Nazwy zmiennych i zasady
dostępu przyszłych dostawców ustalimy po doprecyzowaniu kolejnego etapu;
żadnych kluczy dostawców nie przekazujemy do przeglądarki.

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

Testy backendu sprawdzają SQLite, health i CORS, pełny CRUD i uprawnienia,
priorytety oraz konflikty harmonogramu. Testy frontendu używają kontrolowanych
odpowiedzi API do sprawdzenia wyszukiwania, edytora i widoku publicznego.
Build sprawdza TypeScript i tworzy `dist/`.
Backend i Vite muszą działać jednocześnie, aby ręcznie sprawdzić pełne połączenie.
W Windows użyj `mvnw.cmd` zamiast `./mvnw`; eksport zmiennych dostosuj do powłoki.

Aktualne wyniki, kroki powtórzenia i granice sprawdzenia opisuje
[raport weryfikacji SOL-115–118](docs/verification.md). Weryfikacja przepływu
na danych testowych nie zastępuje odbioru rzeczywistych integracji w SOL-120.

## Organizacja dalszej pracy

`backend/` odpowiada za REST, walidację, planowanie, SQLite i dostawców;
`frontend/` za widoki i komunikację z API; `docs/api-contract.md` jest wspólną
umową. Koordynator uzgadnia jej zmiany przed równoległą implementacją.

SOL-115 weryfikuje źródła na konkretnych trasach i datach. SOL-116 obejmuje
zapis i uprawnienia, SOL-117 planowanie, SOL-118 widoki, SOL-119 integracje.
Dalsze niezależne prace zaczynaj z tej samej aktualnej gałęzi bazowej,
w osobnych worktrees. Nie uznawaj braku ceny albo awarii dostawcy za
potwierdzony brak połączenia. Zakres obsługiwanych tras zatwierdza właściciel.

Przy implementacji wykorzystano Codexa do koordynacji zadań z Linear,
pracy agentów nad backendem, frontendem i weryfikacją źródeł, a także testów
i niezależnej recenzji. Instrukcje projektowe oraz kontrakt są wersjonowane
w repozytorium; decyzje o zasięgu produktu i źródłach należą do właściciela.

Instrukcje dla agentów są w [AGENTS.md](AGENTS.md), [backend/AGENTS.md](backend/AGENTS.md) i [frontend/AGENTS.md](frontend/AGENTS.md).
