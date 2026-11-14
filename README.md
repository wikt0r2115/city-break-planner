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

Planer pokazuje kolejno: **Kierunek → Połączenie → Nocleg → Atrakcje → Podsumowanie**.
Baner znajduje się w nagłówku, a nawigacja między krokami pozostaje widoczna.
Na desktopie mapa jest obok treści, na telefonie wybierasz „Plan” lub „Mapa”.
Dokument mieści się w wysokości ekranu; długie szczegóły i harmonogram przewijasz wewnątrz bieżącego kroku.
Powrót do wcześniejszego kroku i odświeżenie karty zachowują roboczy plan oraz świeże wyniki noclegów.

Liczbę osób (1–8 dorosłych) wybierasz w „Kierunku”. Koszt transportu i wstępów
oraz budżet propozycji atrakcji dotyczą całej grupy; szczegóły biletów podają
ceny za jedną osobę. Noclegi korzystają z tej samej liczby uczestników,
a OBO wycenia pobyt osobno dla grupy i liczby pokoi wybranej w „Noclegu”.
Na desktopie wyświetlane są trzy kafelki transportu, na tablecie dwa, na
telefonie jeden. „Nowy plan” lub kliknięcie logo rozpoczyna pusty plan;
zwykłe odświeżenie przywraca bieżącą pracę. Nowy plan nie wybiera atrakcji
automatycznie. Edycja powrotu w istniejącym planie zachowuje wybrane miejsca.

1. W kroku „Kierunek” kliknij „Uzupełnij przykładową trasę” i wyszukaj Londyn → Paryż. Zmień priorytet z „Niższy koszt” na „Krótszy dojazd” i wyszukaj ponownie. Autokar ustąpi pierwszego miejsca pociągowi.
2. Wybierz połączenie, a potem sprawdź i wybierz nocleg albo kliknij „Pomiń nocleg”. Oferty noclegów są stronicowane po jednym hotelu. Formularz po wyszukaniu rozwiniesz przez „Parametry noclegu”.
3. W kroku „Atrakcje” rozwiń „Dobierz atrakcje”, wybierz zainteresowania i budżet, a następnie „Zaproponuj atrakcje”. Przy budżecie 0 zł możesz dodać Jardin des Tuileries. Zakładka „Harmonogram” pozwala zmienić godziny i kolejność wizyt.
4. Wróć do połączeń i wybierz wcześniejszy powrót o 08:15. Aby pokazać konflikt, ustaw wcześniej wizytę ręcznie na dzień powrotu po 08:15. W „Podsumowaniu” zapisz plan i otwórz link do odczytu w osobnym oknie.
5. Wyszukaj Londyn → Amsterdam z powrotem co najmniej dwa dni po wyjeździe, żeby pokazać nocny prom. Czas podróży obejmuje przesiadki, a godziny przy odcinkach są lokalne.

[Weryfikacja układu krokowego](docs/wizard-verification.md).

## Mapa planu — MapTiler

Mapa pokazuje przystanki podróży i ponumerowane atrakcje z harmonogramu,
również po otwarciu udostępnionego planu. Punkty z konfliktami mają osobne
oznaczenie i opis powodu. Linie pomiędzy atrakcjami pokazują kolejność
zwiedzania; nie wyznaczają rzeczywistej drogi ani czasu dojścia.

Do włączenia podkładu mapy potrzebny jest publiczny klucz z
[MapTiler Cloud → API keys](https://cloud.maptiler.com/account/keys/).
W lokalnym pliku `.env.docker` ustaw `VITE_MAPTILER_API_KEY=twoj_klucz`,
a następnie przebuduj frontend:

```bash
docker compose --env-file .env.docker up --build -d
```

W ustawieniach klucza ogranicz Allowed HTTP origins do `localhost`
(ewentualnie `127.0.0.1`, jeśli używasz tego adresu). Dla opublikowanej
strony użyj oddzielnego klucza ograniczonego do jej domeny.
Klucz do mapy jest publiczny i trafia do plików przeglądarki; nie używaj
service tokena ani klucza OpenAI. Nie zapisuj prawdziwych kluczy w repo.
Przy Vite bez Dockera ustaw tę samą zmienną w `frontend/.env.local`.
Zmiana klucza w Dockerze wymaga ponownego budowania frontendu.

Integracja korzysta ze współrzędnych własnego katalogu SQLite, bez
geokodowania. Zachowuje logo i informacje o źródłach MapTiler. Bez klucza
lub przy niedostępnej mapie harmonogram, zapis i udostępnianie nadal działają.
Starsze zapisane plany bez współrzędnych atrakcji mogą pokazywać tylko
przystanki; ponowne przeliczenie i zapis uzupełniają dostępne współrzędne.
Limity i wykorzystanie planu Free sprawdzisz w panelu MapTiler Analytics.
[Wyniki i granice weryfikacji mapy](docs/map-verification.md).

## OpenAI

`OPENAI_API_KEY` jest opcjonalną zmienną tylko dla backendu. Zapisany klucz użytkownika Windows nadal działa. Po zbudowaniu backendu można użyć `scripts\start-openai-local.cmd`. W Compose klucz można przekazać ze środowiska lub lokalnego `.env.docker` utworzonego z `.env.docker.example`.

Kliknięcie „Zaproponuj atrakcje” może wysłać do GPT-6 Luna miasto, czas na miejscu, budżet, zainteresowania i pasujące pozycje katalogu. Wybór przechodzi kontrolę harmonogramu oraz łącznego budżetu. Bez klucza, przy awarii lub po osiągnięciu limitu pojawiają się propozycje z katalogu. Domyślnie limit to 4 próby dziennie na proces backendu (`APP_AI_DAILY_REQUESTS`). Formularz transportu, zapis i otwarcie planu korzystają z danych lokalnych.

## Testowa sekcja noclegów — OBO Travel

Po wyszukaniu podróży sekcja „Nocleg na Twój wyjazd” podpowiada miasto
i daty z planu. Możesz je zmienić niezależnie i nacisnąć „Sprawdź noclegi”.
Liczba dorosłych pochodzi z kroku „Kierunek”; liczbę pokoi (1–8, maksymalnie
tyle, ile dorosłych) wybierasz w „Noclegu”. Wyszukiwanie uruchamia się
wyłącznie na żądanie. Przy jednodniowym wyjeździe ustaw późniejszą datę
wymeldowania; OBO wymaga co najmniej jednej nocy i zameldowania od jutra.

To rzeczywiste oferty [OBO Travel](https://onebookingonline.com/mcp),
wyceniane osobno od demonstracyjnego transportu i atrakcji. Sekcja pokazuje
do trzech hoteli, cenę całego pobytu, walutę, czas sprawdzenia oraz dostępne
informacje o podatkach i dodatkowych opłatach. Sprawdzenie oferty i rezerwacja
odbywają się na stronie OBO; aplikacja nie pobiera płatności.

Domyślnie działa bez konta i klucza, bez użycia AI. Opcjonalny `OBO_API_KEY`
zwiększa limit przypisany do backendu i musi pozostać poza przeglądarką.
`APP_OBO_ENABLED=false` wyłącza integrację, a `APP_OBO_TIMEOUT_SECONDS`
ustawia limit odczytu (domyślnie 25 s, maksymalnie 30 s). Przy limitach,
błędach lub niepełnych odpowiedziach pojawia się odpowiedni komunikat.

Karty pokazują zdjęcia z adresów OBO oraz przycisk „Pokaż na mapie”.
Hotele ze znanymi współrzędnymi mają na mapie fioletowe znaczniki `H`.
Zdjęcia i współrzędne pochodzą z tego samego wyszukiwania co ceny;
nie wykonujemy dodatkowego zapytania o szczegóły każdego hotelu.

Świeże wyniki oraz formularz są zachowywane w `sessionStorage` bieżącej karty.
Odświeżenie strony przywraca także roboczy plan i hotele bez kolejnego
wyszukiwania OBO. Ponowne kliknięcie dla tych samych parametrów korzysta
z aktualnych wyników. Cache mieści do trzech wyszukiwań i wygasa najpóźniej
30 minut od wyceny; odczyt nie przedłuża tego czasu. Po wygaśnięciu trzeba
ręcznie sprawdzić ceny ponownie. Zamknięcie karty kończy jej sesję.
Oferty, ceny, zdjęcia i tokeny OBO nie są zapisywane w SQLite. Po świadomym
wyborze hotelu plan może zachować jego nazwę i współrzędne jako bazę
zwiedzania, także w publicznym widoku. Mapa pokazuje wtedy wyłącznie ten
nocleg. Pierwsze dojście i dojście po zmianie dnia uwzględniają hotel;
czasy są oznaczone jako szacunek pieszy ze współrzędnych, bez wyznaczania
trasy po ulicach. Po wygaśnięciu ceny baza pozostaje punktem planu.
Puste i nieczytelne wyniki wyświetlają informację o niedostępności partnerów
i samodzielnym szukaniu noclegu. Poprawne oferty częściowej odpowiedzi
są pokazywane bez komunikatu technicznego. Zdjęcia są
wyświetlane bezpośrednio ze źródła, bez kopiowania plików do aplikacji.
[Warunki korzystania z danych OBO](https://onebookingonline.com/api-terms).
[Weryfikacja integracji noclegów](docs/obo-verification.md).

## Testy i CI

- Backend w `backend`: `./mvnw -B -ntp package`.
- Frontend w `frontend`: `npm ci`, `npm test`, `npm run build`.
- Przeglądarka w `e2e`: `npm ci`, `npx playwright install chromium`, `npm test` i `npm run test:showcase`. Ustaw `E2E_SKIP_BUILD=1`, jeśli backend i frontend są już zbudowane.

GitHub Actions uruchamia te sprawdzenia po pushu i przy pull requestach.
Osobne zadanie buduje oba obrazy Docker Compose na świeżym runnerze i testuje demo z pustą bazą SQLite, zapisem i ponownym uruchomieniem kontenerów. Oba zadania działają bez klucza OpenAI. Aktualny format żądań opisuje [kontrakt REST](docs/api-contract.md).
