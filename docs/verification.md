# Weryfikacja SOL-115–118 — 11 listopada 2026

To historyczny wynik wcześniejszego etapu. Aktualny odbiór zatwierdzonych
integracji lokalnych z 12 listopada jest w [raporcie SOL-120](acceptance.md).

Sprawdzono uruchomienie aplikacji, reguły planera, zapis i uprawnienia oraz
frontend. Przepływ planera korzystał z jawnych danych testowych
`APP_DATA_MODE=demo`. Nie stanowi potwierdzenia rzeczywistych ofert ani
zamknięcia odbioru SOL-120, który zależy od integracji SOL-119.

## Środowisko i polecenia

Linux, Java 25.0.3 (kompilacja do Java 17), Maven Wrapper 3.9.16,
Node 22.23.4, npm 10.9.9, lokalny Chrome sterowany przez Playwright.
Narzędzie do sprawdzania przeglądarki zainstalowano w katalogu tymczasowym,
poza zależnościami aplikacji.

| Sprawdzenie | Wynik |
| --- | --- |
| Backend `./mvnw package` | 33 testy, 0 błędów; wykonywalny JAR |
| Budowanie JAR-a w zintegrowanym checkout: `./mvnw -B -ntp package -DskipTests` | PASS; testy wykonano wcześniej na tym samym kodzie backendu |
| Frontend `npm ci` | PASS z istniejącym lockfile |
| Frontend `npm test` | 15 testów, 0 błędów |
| Frontend `npm run build` | PASS: TypeScript i Vite |
| `git diff --check` | PASS |

Testy backendu obejmują 15 przypadków reguł planowania, 10 przypadków API
planów i 8 przypadków zdrowia bazy/CORS. Testy frontendu korzystają
z kontrolowanych odpowiedzi HTTP, a poniższe sprawdzenie w przeglądarce
wywołuje działający serwer Spring Boot.

## Przepływ przez rzeczywiste API i przeglądarkę

Backend uruchomiono z osobnym, tymczasowym plikiem SQLite. Nie nadpisywano
lokalnej bazy użytkownika. Vite działał na `http://localhost:5173`,
a API na `http://127.0.0.1:8080` z rzeczywistym CORS.

Kroki odtworzenia opisuje także sekcja danych testowych w README:

1. Uruchom backend z `APP_DATA_MODE=demo`, a frontend przez `npm run dev`.
2. Wprowadź Warszawa → Gdańsk, 05–06.12.2026. To wyłącznie parametry testu,
   nie zatwierdzona trasa rzeczywistej integracji.
3. Wyszukaj i potwierdź baner danych testowych. Backend zwraca sześć wariantów
   oraz trzy rekomendowane atrakcje. Widoczne są taryfy i niepotwierdzona cena.
4. Wybierz powrót o 14:00. Punkty pozostają w planie, a kolidujące wizyty
   pokazują powód uwzględniający dojazd na powrót.
5. Usuń park, dodaj go ponownie i przesuń wcześniej. Kolejność i wynik
   przeliczenia pochodzą z API.
6. Zapisz plan. Adres właściciela i treść strony nie zawierają tokenu edycji.
7. Otwórz link w oddzielnej sesji. Jest widok tylko do odczytu, bez przycisków
   edycji i bez nagłówka Authorization. Baner danych testowych pozostaje.
8. Zatrzymaj proces backendu i uruchom go z tym samym SQLite, bez trybu demo.
   Zapisane punkty, kolejność i link publiczny nadal działają. Dane zapisane
   jako testowe nadal mają takie oznaczenie.
9. Domyślne wyszukiwanie zwraca HTTP 200 i `PROVIDER_ERROR`, puste warianty
   oraz informację o nieskonfigurowanych źródłach; nie tworzy fikcyjnych ofert.
10. Spróbuj zmienić datę powrotu w zapisanym planie przy niedostępnych
    źródłach. Komunikat wyjaśnia, że dotychczasowy plan i uprawnienia zachowano
    oraz nie zmieniono jego terminu. Punkty i link pozostają w edytorze.
11. Usuń plan jako właściciel. Publiczne API zwraca 404, a strona pokazuje
    czytelną informację o nieistniejącym lub unieważnionym linku.

**Wynik: PASS.** Sprawdzono ekran 1440 × 1000 oraz 360 × 900; brak
poziomego przewijania edytora i widoku publicznego. Sprawdzono przechodzenie
klawiszem Tab, fokus pól i wysłanie formularza klawiszem Enter.

Osobne rzeczywiste żądania do API potwierdziły kolejność wszystkich czterech
priorytetów: koszt (`demo-budget`), czas (`demo-fast`), przesiadki
(`demo-direct`), czas na miejscu (`demo-long`). Niepełna suma nie wygrywa
rankingu ceny dzięki brakującym składnikom.

## Niezależna recenzja i bezpieczeństwo

Specjalista niezależnie sprawdził schemat SQLite i wykonał HTTP smoke test
na osobnym porcie i pliku bazy. Potwierdzono 401 bez tokenu, 403 dla tokenu
publicznego lub innego właściciela, publiczne PUT/DELETE 405, brak sekretów
w publicznym DTO i zapisanym JSON, SHA256 tokenu właściciela, niezależne
tokeny 256-bitowe, nieufanie cenom przesłanym przez klienta i trwałość
po faktycznym restarcie procesu. Uszkodzony JSON oraz przyszła wersja
schematu dają bezpieczne 503 bez obniżania wersji bazy.

Recenzent znalazł dwa przypadki utraty kontekstu edytora: błąd podglądu
nowego wyszukiwania oraz puste wyniki po zmianie powrotu. Oba poprawiono,
objęto testami regresyjnymi i ponownie niezależnie sprawdzono.
Końcowa recenzja nie ma uwag blokujących.

Raport SOL-115 i JSON dowodów sprawdzono osobno. Ponowny anonimowy odczyt
API ZTM potwierdził sześć opisanych przystanków i godzin. Niezależnie
obejrzano rozkład Świnoujścia, odróżniając prom od zastępującego go P1.

## Granice sprawdzenia

Nie sprawdzono Windows, fizycznego telefonu, czytnika ekranu, wszystkich
przeglądarek ani działania na Java 17. Nie sprawdzono kluczy dostawców,
rzeczywistych grudniowych wycen, zakupu biletów ani produkcyjnego hostingu.
Źródła rzeczywistych danych i ograniczenia są w `docs/data-sources.md`.
SOL-119 wymaga decyzji właściciela o dostawcach i zakresie; SOL-120/121
nie są zakończone przez niniejszą weryfikację danych demonstracyjnych.
