# SOL-120 — odtwarzalne testy odbioru

Zestaw `e2e/` uruchamia własne procesy Spring Boot i Vite na losowych portach
loopback, z pasującym CORS, linkami frontendowymi i osobnym plikiem SQLite
w katalogu tymczasowym. Nie korzysta z lokalnej bazy użytkownika ani nie
zatrzymuje serwerów uruchomionych przez inne osoby.

## Uruchomienie z czystego klonu

Wymagane: JDK 17–25, Node 22.22.2+ i npm. Zweryfikowano Linux, Java 25.0.3,
Node 22.23.4, npm 10.9.9 i Chrome z lokalnej instalacji.

```bash
cd e2e
npm ci
npx playwright install chromium
npm test
```

Gdy dostępny jest już Chrome, można pominąć pobieranie przeglądarki:

```bash
E2E_BROWSER_PATH=/sciezka/do/chrome npm test
```

W środowisku użytym do weryfikacji wykryto automatycznie
`/opt/google/chrome/chrome`. Poza tym środowiskiem domyślnie używana jest
przeglądarka zainstalowana przez Playwright.

Pierwsze uruchomienie pobiera zależności. Runner buduje backend przez
`./mvnw -B -ntp package -DskipTests`, wykonuje `npm ci` oraz `npm run build`
frontendu, a następnie uruchamia scenariusze. Testy jednostkowe backendu
i frontendu pozostają osobnymi poleceniami opisanymi w README.

Przy powtarzaniu testu bez zmian źródeł można użyć już przygotowanego JAR-a
i zależności:

```bash
E2E_SKIP_BUILD=1 npm test
```

Raport znajduje się w ignorowanym `e2e/artifacts/demo-report.json`. Przy
błędzie runner zapisuje zrzut `failure.png` i podaje katalog logów serwerów.
Nie zapisuje tokenu właściciela w raporcie ani nie wypisuje go do terminala.
W razie sukcesu usuwa tymczasową bazę i zatrzymuje własne procesy.

## Scenariusz deterministyczny

`npm test` zawsze uruchamia `APP_DATA_MODE=demo`. Daty wybiera względem
bieżącego dnia w strefie Europe/Warsaw, dzięki czemu nie stają się przeszłe.
To jawne fikcyjne oferty, nie dowód rzeczywistych cen ani realizacji kursu.

10 grup sprawdza:

1. Wyszukiwanie klawiaturą, rzeczywiste HTTP/CORS oraz oznaczenie danych.
2. Cztery priorytety po stronie serwera i niepełny koszt.
3. Wcześniejszy powrót zachowujący punkty i wskazujący powód konfliktu.
4. Dodanie, usunięcie i zmianę kolejności atrakcji przez API podglądu.
5. Utworzenie i aktualizację planu bez ujawniania tokenu edycji w URL/DOM.
6. API 401 bez uprawnienia, 403 dla tokenu publicznego/innego właściciela
   oraz 405 dla publicznych PUT/DELETE.
7. Link w niezależnej sesji bez kontrolek edycji i nagłówka Authorization,
   brak poziomego przewijania na ekranie 360 × 900.
8. Odczyt punktów, kolejności i linku po rzeczywistym restarcie procesu Java.
9. Zachowanie istniejącego planu i prawa edycji przy pustych wynikach.
10. Unieważnienie wcześniej działającego linku po usunięciu planu.

Normalne działania przechodzą przez działający Spring Boot i SQLite.
Wyłącznie dwa negatywne scenariusze UI (`NO_CONNECTION`, `PROVIDER_ERROR`)
pochodzą z osobnego, kontrolowanego serwera HTTP testu. Są oznaczone jako
testowe i nie stanowią odpowiedzi ZTM ani innego operatora. Parsery i błędy
rzeczywistych dostawców sprawdzają dodatkowo kontrolowane testy backendu.

## Osobny test rzeczywistych źródeł

Właściciel zaakceptował etap lokalnego Gdańska: Dworzec Główny ↔ Targ Rybny
oraz potwierdzone publikowane cenniki atrakcji. Kolej, loty, autokary,
pozostałe trasy i wyceny biletów na konkretny kurs wymagają doprecyzowania
w dalszym etapie projektu.

Test live jest wyłącznie na żądanie i wymaga podania konkretnej daty
w opublikowanym zakresie rozkładu:

```bash
cd e2e
E2E_LIVE_DATE=2026-11-14 npm run test:live
```

Data powyżej jest przykładem z SOL-115, nie trwałą gwarancją pokrycia.
Przed późniejszym uruchomieniem wybierz aktualną datę wewnątrz zakresu API.
Test odrzuca wynik bez rzeczywistych wariantów, sprawdza daty i czasy,
`basis: PUBLISHED_TARIFF`, źródła, walutę, czas sprawdzenia oraz warunki
potwierdzonych ulg. Sprawdza też widoczny rodzaj ceny w mobilnym interfejsie
i osobne `NO_COVERAGE` dla daty poza zakresem, zamiast fałszywego braku kursów.
Wynik zapisuje w `e2e/artifacts/live-report.json`.

Nie myl cennika publikowanego z datowaną ofertą rezerwacyjną. Awaria
zewnętrznego źródła powoduje niepowodzenie testu, nie potwierdzenie braku
połączeń. Test live należy wykonać po integracji SOL-119 na tej samej wersji
kodu, którą pokazuje demonstracja.

## Wykonane sprawdzenie

11.11.2026: `npm ci` i `npm test` — **PASS, 10/10 grup** na bazie kodu
`2abcc06` z nowym zestawem E2E. Zbudowano aplikację od źródeł i wykonano
faktyczny restart Java. Wynik nie obejmuje jeszcze integracji SOL-119.
Ponownie wykonano 10/10 grup po dopracowaniu sprzątania. Wymuszony brak
pliku przeglądarki zakończył się oczekiwanym błędem i zatrzymaniem własnych
Java/Vite; SIGTERM podczas startu backendu również nie pozostawił procesu.

Nie wykonano w tej wersji zestawu: testu live po integracji nowego adaptera,
Windows, fizycznego telefonu, czytnika ekranu, innych silników przeglądarki,
zakupu biletu ani źródeł kolejowych/lotniczych/autokarowych. Nowy adapter
jest wdrażany niezależnie; koordynator dopisuje wynik testu live po scaleniu.
