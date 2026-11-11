# Kontrakt REST — City Break Planner v1

Wspólna baza dla SOL-116–119. Zmiany uzgadnia koordynator przed zmianą klientów
i serwera. `GET /api/v1/health` pochodzi z SOL-114; wyszukiwanie, przeliczanie
i zapis planów powstają w SOL-116–118, a rzeczywiste integracje w SOL-119.

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

## Wyszukiwanie — SOL-117, SOL-119

`POST /api/v1/searches` → HTTP 200. Dane testowe żądania:

```json
{
  "origin": "Warszawa",
  "destination": "Gdańsk",
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

Wynik: `searchId`, `criteria` (żądanie), `status`, `roundTripOptions[]`,
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
`status: OK | NO_CONNECTION | PROVIDER_ERROR`, `message` (string lub null).
Brak obsługi trasy zgłaszamy jako brak danych z uzasadnieniem, nie jako brak kursów.

Wariant w obie strony: `id`, `outbound`, `returnJourney`, `travelMinutes`,
`transfers`, `timeAtDestinationMinutes`, `costSummary`, `recommendedAttractionIds[]`.
Przejazd: `departureAt`, `arrivalAt`, `segments[]` (kolejność podróży).
Segment: `id`, `mode: TRAIN | PLANE | COACH | FERRY | LOCAL_TRANSIT | WALK`,
`operator`, `origin`, `destination`, `departureAt`, `arrivalAt`, `prices[]`,
`bookingUrl` i `mapUrl` (URL lub null). Miejsca zawierają `name`,
`latitude` i `longitude` (współrzędne mogą być null).
Przejazdy wariantu muszą pozostawiać nieujemny czas na miejscu.

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
  "testData": true
}
```

`status: KNOWN | UNKNOWN | PROVIDER_ERROR`. `KNOWN` wymaga nieujemnej kwoty,
waluty, taryfy, źródła i czasu sprawdzenia. Pozostałe stany mają `amount: null`
i `reason` z wyjaśnieniem; gdy nie było odczytu, `checkedAt` może być null.
`UNKNOWN` to niepotwierdzona cena przy znanej ofercie; `PROVIDER_ERROR` to
nieudany odczyt dostawcy. Ulgowa cena wymaga warunków `eligibility`
potwierdzonych w źródle; nie wyliczamy ulgi samodzielnie.

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
`startsAt` (RFC3339 albo null dla nowo dodanego punktu), `visitMinutes`.
Dla null serwer wybiera najwcześniejszy możliwy termin, uwzględniając
poprzedni punkt, godziny otwarcia i dojazdy. Po pierwszym przeliczeniu klient
przesyła otrzymany termin, aby zmiana powrotu zachowała wybory użytkownika.
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
`transferMinutesFromPrevious` (minuty lub null przy braku danych), `conflicts[]`.
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

## Rozdzielenie danych rzeczywistych i testowych

Domyślny tryb nie generuje ofert zastępujących brakujące integracje. Brak
skonfigurowanych źródeł oznacza `PROVIDER_ERROR` z czytelnym opisem i pustymi
wynikami, nigdy potwierdzony brak kursów. Jawne `APP_DATA_MODE=demo` uruchamia
kontrolowanego dostawcę testowego do weryfikacji logiki i widoków. Każdy taki wynik
i zapisany na jego podstawie plan ma `testData: true`; frontend wyraźnie to
oznacza. Nie są to rzeczywiste ceny ani rozkłady dla wskazanych dat.

Publiczne linki mają postać `${APP_FRONTEND_BASE_URL}/shared/{shareToken}`;
domyślne `APP_FRONTEND_BASE_URL` to `http://localhost:5173`.
