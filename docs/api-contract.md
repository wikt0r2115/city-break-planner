# Kontrakt REST — City Break Planner v1

Wspólna baza dla SOL-116–119. Zmiany uzgadnia koordynator przed zmianą klientów
i serwera. `GET /api/v1/health` pochodzi z SOL-114; wyszukiwanie, przeliczanie
i zapis planów wdrożono w SOL-116–118. Rzeczywiste integracje pozostają w SOL-119.

## Konwencje i stan aplikacji

Prefiks `/api/v1`, JSON, identyfikatory jako nieprzezroczyste stringi. Daty:
`YYYY-MM-DD`; chwile: RFC3339 z offsetem; czas trwania: pełne minuty.
Ceny to dziesiętne stringi, waluty ISO 4217. MVP porównuje PLN i tę samą taryfę.
Wszystkie poniższe przykłady są danymi testowymi, bez potwierdzonych ofert.

`GET /api/v1/health` wykonuje rzeczywiste `SELECT 1` w SQLite:

```json
{"status":"UP","database":"UP"}
```

HTTP 200 oznacza działającą bazę. Niedostępna baza daje HTTP 503
z `{"status":"DOWN","database":"DOWN"}`, bez szczegółów połączenia.

## Podpowiedzi miejsc — SOL-129, SOL-130

`GET /api/v1/places` → HTTP 200 zwraca
`{places: [{value, label}], testData: boolean}`. Opcjonalny parametr `q`
filtruje po nazwie niezależnie od wielkości liter, polskich znaków i
nadmiarowych spacji. Brak parametru lub pusta wartość zwraca cały katalog.
Brak dopasowania zwraca pustą tablicę.

`value` trafia do `origin` lub `destination` w żądaniu wyszukiwania.
`label` jest etykietą dla użytkownika. W trybie live katalog obejmuje
Amsterdam, Londyn i Paryż z lokalnego katalogu SQLite. Wpisy „London” i
„Paris” są akceptowane jako aliasy przy wyszukiwaniu. Wyniki i plany demo
mają `testData: true`.

## Wyszukiwanie — SOL-117, SOL-119

`POST /api/v1/searches` → HTTP 200. Przykładowe żądanie:

```json
{
  "origin": "Londyn",
  "destination": "Paryż",
  "departureDate": "2026-12-05",
  "returnDate": "2026-12-06",
  "priority": "LOWEST_TOTAL_COST",
  "currency": "PLN",
  "fareType": "STANDARD"
}
```

Wymagane niepuste, różne start i cel, poprawne daty, powrót nie wcześniej
niż wyjazd i wyjazd nie w przeszłości (strefa Europe/Warsaw).
`priority` jest pojedynczą wartością:

| Wartość | Metryka |
| --- | --- |
| `LOWEST_TOTAL_COST` | suma obu przejazdów i wstępów do wybranych atrakcji |
| `SHORTEST_TRAVEL_TIME` | suma czasu obu przejazdów |
| `FEWEST_TRANSFERS` | suma przesiadek w obu kierunkach |
| `MOST_TIME_AT_DESTINATION` | czas między przyjazdem do celu i wyjazdem powrotnym |

Remisy: krótszy łączny czas podróży, mniej przesiadek, następnie `id`
leksykograficznie. `fareType`: `STANDARD` albo `REDUCED`.

Wynik: `searchId`, `criteria` (kryteria użyte do wyszukania), `status`, `roundTripOptions[]`,
`attractions[]`, `sources[]`, `testData` (boolean).

| Stan wyniku | Znaczenie |
| --- | --- |
| `OK` | źródła odpowiedziały, znaleziono warianty, wymagane dane są kompletne |
| `PARTIAL` | są przydatne dane, ale część źródeł lub pól jest niedostępna |
| `NO_CONNECTION` | źródła potwierdziły brak kursów dla wymaganej trasy i dat |
| `PROVIDER_ERROR` | nie udało się ustalić dostępności z powodu błędów źródeł |

Puste `roundTripOptions` samo nie potwierdza braku połączeń. Nieznana cena
nie oznacza braku kursu. Awaria źródła nie może zmienić się w `NO_CONNECTION`.
Każdy odczyt `sources[]`: `sourceId`, `url`, `checkedAt`,
`status: OK | NO_CONNECTION | NO_COVERAGE | PROVIDER_ERROR`, `message` (string lub null).
Opcjonalny `reasonCode` rozróżnia `UNSUPPORTED_ROUTE`, `OUTSIDE_COVERAGE`,
`UPSTREAM_FAILURE` i `NOT_CONFIGURED`. `NO_COVERAGE` oznacza brak pokrycia
trasy lub daty przez źródło, a nie potwierdzony brak kursów.
`UNRECOGNIZED_PUBLICATION` oznacza, że zmieniona treść publikacji nie
pozwoliła bezpiecznie odczytać wymaganych danych.
`AMBIGUOUS_PLACE` oznacza, że wpis pasuje do więcej niż jednej stacji.
Wyszukiwanie transportu i obliczanie priorytetów korzysta z SQLite. Para
spoza katalogu zwraca `UNSUPPORTED_ROUTE`. Gdy zapisane warianty nie
pasują do dat, w szczególności powrót wypada przed przyjazdem, zwracany
jest stan `NO_CONNECTION`.

Wariant w obie strony: `id`, `outbound`, `returnJourney`, `travelMinutes`,
`transfers`, `timeAtDestinationMinutes`, `costSummary`, `recommendedAttractionIds[]`.
Przejazd: `departureAt`, `arrivalAt`, `segments[]` (kolejność podróży).
Segment: `id`, `mode: TRAIN | PLANE | COACH | FERRY | LOCAL_TRANSIT | BUS | METRO | TRAM | WALK`,
`operator`, `origin`, `destination`, `departureAt`, `arrivalAt`, `prices[]`,
`bookingUrl` i `mapUrl` (URL lub null). Miejsca zawierają `name`,
`latitude` i `longitude` (współrzędne mogą być null).
Nowe miejsca zawierają opcjonalne `timeZone` (identyfikator IANA).
Godziny odcinków zawierają przesunięcie właściwe dla lokalizacji i daty.
Starsze zapisane plany mogą zawierać pola pochodzenia rozkładów.
Przejazdy wariantu muszą pozostawiać dodatni czas na miejscu.

## Propozycje atrakcji

`POST /api/v1/recommendations` przyjmuje `criteria`, `roundTripId`,
`interest` (`MIXED`, `CULTURE`, `OUTDOORS`, `HISTORY`) i `budgetPln`
(liczba całkowita 0–10000). Zwraca `{suggestions: [{attractionId, reason}], aiUsed}`.
Zbiór do trzech propozycji podlega kontroli wspólnego budżetu, godzin
otwarcia, dojazdów oraz powrotu. Serwer odczytuje wariant i atrakcje z bazy.
Klucz OpenAI pozwala nadać priorytet propozycjom po kliknięciu przycisku
w UI. Przy braku odpowiedzi stosowany jest wybór z katalogu. Propozycje
nie zmieniają planu automatycznie.

## Ceny i atrakcje

Dane testowe pojedynczej ceny:

```json
{
  "status": "KNOWN",
  "amount": "49.90",
  "currency": "PLN",
  "fareType": "STANDARD",
  "eligibility": null,
  "sourceId": "test-provider",
  "sourceUrl": "https://example.com/test-fare",
  "checkedAt": "2026-11-11T10:00:00Z",
  "testData": true,
  "basis": "TEST_DATA"
}
```

`status: KNOWN | UNKNOWN | PROVIDER_ERROR`. `KNOWN` wymaga nieujemnej kwoty,
waluty, taryfy, źródła i czasu sprawdzenia. Pozostałe stany mają `amount: null`
i `reason` z wyjaśnieniem; gdy nie było odczytu, `checkedAt` może być null.
`UNKNOWN` to niepotwierdzona cena przy znanej ofercie; `PROVIDER_ERROR` to
nieudany odczyt dostawcy. Ulgowa cena wymaga warunków `eligibility`
potwierdzonych w źródle; nie wyliczamy ulgi samodzielnie.

`basis` określa rodzaj ceny: `LIVE_OFFER` (oferta wyceniona dla konkretnego
terminu), `PUBLISHED_TARIFF` (aktualnie odczytany publikowany cennik, bez
potwierdzenia konkretnej rezerwacji) albo `TEST_DATA` (jawny przykład testowy).
Starszy zapis lub nieznana cena może mieć `basis: null` albo brak tego pola.
Frontend rozróżnia cennik od oferty i nie nadaje brakującemu polu znaczenia
`LIVE_OFFER`. `checkedAt` jest czasem rzeczywistego odczytu, nie datą
ponownego wyświetlenia wcześniej zapisanej ceny.

`costSummary`: `total` (string lub null), `currency`, `fareType`, `complete`
(boolean), `missingComponents[]` (identyfikatory brakujących składników).
Niekompletne dane dają `total: null`, `complete: false`; taki wariant nie może
zostać uznany za najtańszy na podstawie częściowej sumy. Bez kompletnych
wariantów API nie wskazuje zwycięzcy kosztowego. Koszt rekomendacji obejmuje
atrakcje `recommendedAttractionIds`; koszt zapisanego planu — jego `items`.

Atrakcja: `id`, `name`, `location`, `visitMinutes`, `entryPrices[]`,
`openingHours`, `sources[]`. `openingHours` zawiera `status: KNOWN | UNKNOWN`
i `intervals[]` (`opensAt`, `closesAt` RFC3339 dla konkretnych dat).
Nieznane godziny nie potwierdzają dostępności atrakcji.

## Plany i harmonogram — SOL-116, SOL-117

| Endpoint | Wynik |
| --- | --- |
| `POST /api/v1/plans/preview` | 200, przeliczony szkic bez zapisu i poświadczeń |
| `POST /api/v1/plans` | 201, `Location: /api/v1/plans/{id}`, `{plan, ownerToken}` |
| `GET /api/v1/plans/{id}` | 200, plan właściciela |
| `PUT /api/v1/plans/{id}` | 200, przeliczony plan właściciela |
| `DELETE /api/v1/plans/{id}` | 204 bez body |
| `GET /api/v1/shared-plans/{shareToken}` | 200, publiczny plan tylko do odczytu |

Żądanie utworzenia/aktualizacji: `criteria` (jak wyszukiwanie),
`selectedRoundTrip` (pełny wariant), `items[]`.
Element wejściowy: `id` (stabilny, nadany przez klienta), `attractionId`,
`startsAt` (RFC3339 albo null), `visitMinutes` oraz opcjonalne `automaticTime`
(boolean). Dla null serwer wybiera najwcześniejszy możliwy termin, uwzględniając
poprzedni punkt, godziny otwarcia i dojazdy. Klient wysyła null przy dodaniu
punktu i dla automatycznych punktów po zmianie kolejności. Gdy klient przesyła
konkretną godzinę z `automaticTime: true`, serwer zachowuje tę godzinę i tryb
automatyczny przy zmianie powrotu lub zapisie. `automaticTime: false` wymaga
podania godziny ustawionej ręcznie. Bez pola `automaticTime` tryb wynika
z wartości `startsAt`: null oznacza tryb automatyczny, godzina oznacza ręczny.
Serwer weryfikuje oferty i ceny po swojej stronie,
oblicza godziny końca, dojazdy, konflikty i sumę; nie ufa sumom klienta.

Plan w odpowiedzi: `id`, `criteria`, `selectedRoundTrip`, `items[]`,
`costSummary`, `createdAt`, `updatedAt`, `testData`.
W szkicu z `/plans/preview` `id`, `createdAt` i `updatedAt` mają wartość null,
nie ma `shareUrl`. Endpoint nie tworzy planu ani tokenów i pozwala sprawdzić
konflikty przed świadomym zapisem. Operacje zapisu i aktualizacji zawsze
ponownie wyliczają plan po stronie serwera.
Właściciel dodatkowo otrzymuje `shareUrl` (frontendowe `/shared/{shareToken}`).
Publiczne DTO nie zawiera tokenów, linku właściciela ani poświadczeń.
`ownerToken` zwracany jest tylko przy utworzeniu i nie znajduje się w obiekcie planu.

Element wynikowy: `id`, `attractionId`, `name`, `startsAt`, `endsAt`,
`transferMinutesFromPrevious` (minuty lub null przy braku danych), `conflicts[]`
oraz `automaticTime` (boolean). Starsze zapisy bez `automaticTime` zachowują
godziny i są odczytywane w trybie ręcznym.
Konflikt: `code`, `reason` (czytelny komunikat), `itemId`.
Kody: `RETURN_DEPARTURE` (z dojazdem na powrót), `OPENING_HOURS`,
`TRANSFER_TIME`, `MISSING_DATA`.
Zmiana powrotu zachowuje punkty wybrane przez użytkownika, oznacza kolizje
przy konkretnych punktach i podaje powód. Niczego nie usuwa automatycznie.

### Dostęp

Utworzenie planu generuje niezależne losowe tokeny właściciela i udostępnienia,
każdy z co najmniej 256 bitami losowości.
Token właściciela (co najmniej 256 bitów losowości) przekazuje się wyłącznie
w `Authorization: Bearer …` przy GET/PUT/DELETE właścicielskich; baza przechowuje
jego hash. Publiczny token uprawnia wyłącznie do GET udostępnionego planu.
API sprawdza prawo edycji/usunięcia na serwerze. Nie obsługuje PUT/DELETE
na publicznym endpointcie (405); podanie tokenu publicznego jako właścicielskiego
nie daje uprawnień (403). Usunięcie planu unieważnia publiczny link (404).
Tokenów nie umieszczamy w logach; środowisko publiczne wymaga HTTPS.
Widok udostępniony ustawia `Referrer-Policy: no-referrer`, aby linki zewnętrzne
nie ujawniały tokenu udostępnienia w nagłówku Referer.

## Błędy i konfiguracja

Błędy HTTP: `application/problem+json`. Dane testowe:

```json
{
  "type": "about:blank",
  "title": "Nieprawidłowe dane",
  "status": 400,
  "detail": "Popraw wskazane pola.",
  "instance": "/api/v1/searches",
  "errors": [{"field":"returnDate","message":"Powrót nie może poprzedzać wyjazdu."}]
}
```

400: walidacja/niepoprawny JSON; 401: brak tokenu właściciela; 403:
nieprawidłowy token; 404: brak zasobu; 405: nieobsługiwana metoda;
500: nieoczekiwany błąd (bez sekretów); 503: niedostępna infrastruktura.
Health ma celowo prosty format opisany powyżej. Błąd pojedynczego dostawcy
w wyszukiwaniu pozostaje w odpowiedzi 200 i `sources`, by zachować inne wyniki.

CORS dopuszcza jawne originy z `APP_CORS_ALLOWED_ORIGINS`, domyślnie
`http://localhost:5173`, bez wildcard i bez cookies. Klucze dostawców są
wyłącznie po stronie backendu; żadnych sekretów w zmiennych `VITE_*`.

## Dane demonstracyjne

Rozkłady, ceny i godziny otwarcia pochodzą z lokalnego SQLite. Przykładowe
taryfy mają `basis: TEST_DATA` i `checkedAt: null`.

Publiczne linki mają postać `${APP_FRONTEND_BASE_URL}/shared/{shareToken}`.
Domyślne `APP_FRONTEND_BASE_URL` to `http://localhost:5173`.
