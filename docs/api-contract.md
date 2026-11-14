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
  "fareType": "STANDARD",
  "travelers": 3
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
`travelers`: liczba całkowita 1–8. Brak pola lub `null` oznacza 1 osobę,
co zachowuje znaczenie starszych żądań i zapisanych planów. Ułamki, tekst
i liczby poza zakresem są odrzucane. Pole wraca w `criteria` wyszukiwania,
podglądu, zapisu i widoku publicznego.

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
(liczba całkowita 0–10000, łączny budżet wstępów dla całej grupy).
Zwraca `{suggestions: [{attractionId, reason}], aiUsed}`.
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
Kwoty `Price.amount` pozostają cenami za jedną osobę. `costSummary.total`
obejmuje transport w obie strony oraz wskazane wstępy dla `criteria.travelers`
osób według jednej wybranej taryfy dla całej grupy. Obliczenie odbywa się
po stronie serwera, także przy zapisie i aktualizacji; przesłana suma nie
zastępuje wyceny z katalogu. Nocleg jest wyceniany osobno przez OBO i nie
jest ponownie mnożony przez liczbę osób.

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
`selectedRoundTrip` (pełny wariant), `items[]` oraz opcjonalne `lodging`.
`lodging` to wybrany punkt bazowy: `{name, latitude, longitude, timeZone?}`.
Nazwa ma 1–240 znaków, współrzędne muszą być skończone i w zakresie
geograficznym. Nie zawiera ceny, tokenu oferty, zdjęć ani linku rezerwacyjnego.
Jest wyborem użytkownika, nie potwierdzeniem rezerwacji. Brak pola lub null
usuwa bazę i przywraca harmonogram rozpoczynający się w punkcie przyjazdu.
Punkt jest zachowany w planie właściciela i publicznym, także po restarcie.
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
`transferMinutesFromPrevious` (minuty lub null przy braku danych), `conflicts[]`,
`automaticTime` (boolean) oraz `location` (obiekt miejsca albo null). Starsze zapisy bez `automaticTime` zachowują
godziny i są odczytywane w trybie ręcznym.
Przy bazie noclegowej pierwszy transfer uwzględnia przyjazd → hotel → atrakcję.
Pierwszy punkt kolejnego dnia uwzględnia poprzednią atrakcję → hotel → atrakcję;
w tym samym dniu nie dodaje objazdu przez hotel. Te transfery mają opcjonalne
`transferBasis: ESTIMATED_WALKING` i `transferFrom` z opisem poprzedniego
punktu oraz noclegu. Czas to szacunek pieszy: odległość Haversine ×1,3 przy
4,5 km/h. Nie obejmuje sieci ulic, barier, transportu publicznego ani odprawy
w hotelu. Brak współrzędnych daje null i konflikt braku danych. Automatyczne
wizyty mogą zostać przesunięte, a ręczne godziny pozostają z ewentualnym
konfliktem. Inne odcinki nadal korzystają z dotychczasowego dostawcy demo.
`location` zawiera `name`, `latitude`, `longitude` i opcjonalne `timeZone`,
tak jak lokalizacja atrakcji w wynikach wyszukiwania. Serwer pobiera ją
z katalogu atrakcji, zapisuje w migawce planu i zwraca także w publicznym
odczycie. Starsze migawki bez tego pola zwracają `location: null`, bez
migracji bazy ani geokodowania. Brak współrzędnych nie zmienia harmonogramu;
klient pomija taki punkt na mapie.
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

## Testowe wyszukiwanie noclegów OBO — rozszerzenie SOL-119

`POST /api/v1/stays/search` wyszukuje rzeczywiste noclegi niezależnie od
demonstracyjnego transportu. Wywołanie następuje wyłącznie po akcji użytkownika.
Samo wyszukiwanie nie zmienia `Plan` ani kosztu planu. Oferty, ceny, tokeny
i linki hotelowe nie są zapisywane w SQLite. Po wyborze hotelu użytkownik
może zapisać jego nazwę i współrzędne jako `Plan.lodging`, punkt bazowy
zwiedzania. Nie potrzeba tokenu właściciela do wyszukiwania noclegów.

Przykład struktury żądania (daty przykładowe):

```json
{
  "destination": "Paryż",
  "checkIn": "2026-12-05",
  "checkOut": "2026-12-07",
  "adults": 2,
  "currency": "PLN",
  "rooms": 2
}
```

`destination`: 1–120 znaków po przycięciu; `checkIn`: od jutra, do 400 dni
naprzód w strefie Europe/Warsaw; `checkOut`: później niż `checkIn`, maksymalnie
30 nocy; `adults`: liczba całkowita 1–8. `rooms`: liczba całkowita 1–8,
nie większa niż liczba dorosłych; brak pola lub `null` oznacza jeden pokój.
Waluty: PLN, EUR,
USD, GBP. Nie wysyłamy danych osobowych gości. Błędy wejścia dają HTTP 400
z `application/problem+json`. Wszystkie odpowiedzi mają `Cache-Control: no-store`.

HTTP 200 zwraca:

```text
{
  status: OK | EMPTY | PARTIAL | PROVIDER_ERROR | RATE_LIMITED | UNAVAILABLE,
  source: "OBO Travel",
  checkedAt: ISO-8601,
  expiresAt: ISO-8601 | null,
  criteria: { destination, checkIn, checkOut, adults, currency, rooms },
  hotels: [{
    hotelToken: string, name: string, stars: number | null,
    totalPrice: decimal-string, nightlyPrice: decimal-string | null,
    currency: ISO-4217, bookingUrl: string,
    taxesIncluded: boolean | null, feesIncluded: boolean | null,
    extraCharges: [{ name: string, amount: decimal-string,
                     currency: ISO-4217, payableAt: string | null }],
    inclusionsNote: string | null, quotedAt: ISO-8601, expiresAt: ISO-8601,
    photoUrl: string | null,
    location: { latitude: number, longitude: number } | null
  }],
  message: string | null,
  retryAfterSeconds: integer | null
}
```

Kwota `totalPrice` dotyczy całego pobytu, wszystkich wskazanych dorosłych
i wskazanej liczby pokoi. Nie mnożymy tej kwoty ponownie przez pokoje ani
osoby. `false` w podatkach/opłatach oznacza elementy nieuwzględnione,
`null` brak potwierdzenia; dodatkowe kwoty i uwagi pokazujemy bez ukrywania.
Oferty są opisywane nazwą OBO Travel i czasem wyceny. `bookingUrl` pozostaje
niezmienionym linkiem HTTPS do `onebookingonline.com` (ew. `www`), bez danych
logowania i niestandardowego portu. Nie potwierdzamy darmowego anulowania
ani gwarancji ceny, ponieważ nie wywołujemy `get_offer_policies`.

`EMPTY` oznacza poprawną, kompletną odpowiedź bez ofert; nie oznacza braku
hoteli poza pokryciem dostawcy. `PARTIAL` oznacza wyniki niepełne, odrzucone
niepoprawne/przeterminowane oferty lub niedostateczną informację o celu.
`PROVIDER_ERROR` obejmuje błąd sieci, timeout, nieprawidłowy JSON/MCP i błąd
dostawcy; nie jest zastępowany fikcyjnymi cenami. `RATE_LIMITED` sygnalizuje
limit OBO albo lokalny limit wywołań; ponowienie jest ręczne po czasie
`retryAfterSeconds`. `UNAVAILABLE` oznacza wyłączenie przez konfigurację.

Backend wykonuje wyłącznie `tools/call` → `search_hotels` pod stałym adresem
`https://onebookingonline.com/mcp` (limit 3, wskazana liczba pokoi, sortowanie cen rosnąco).
Dokładne nazwy z europejskiego katalogu (`Paryż`/`Paris`, `Londyn`/`London`,
`Amsterdam`) uzupełniają kraj FR, GB lub NL w zapytaniu do OBO. Pozostałe
nazwy, w tym doprecyzowane krajem lub regionem, nie są nadpisywane.
Klucz `OBO_API_KEY` jest opcjonalny i występuje tylko po stronie serwera.
Odczyt ma ograniczony czas i rozmiar odpowiedzi; brak przekierowań HTTP.
Jednocześnie może trwać jedno wywołanie, starty oddziela co najmniej 6 s.
Nie ma automatycznych ponowień ani trwałego cache.

Każda oferta wygasa najpóźniej 30 minut od rzeczywistej wyceny dostawcy.
Odczyt z cache nie przedłuża jej ważności. `expiresAt` całej odpowiedzi jest
najwcześniejszą datą ważności zwróconych ofert. Frontend usuwa wygasłe ceny,
linki, zdjęcia i znaczniki hotelowe; sprawdza ważność także po powrocie karty
z tła. Świeże wyniki `OK`/`PARTIAL` są cache'owane w `sessionStorage`
bieżącej karty (wersjonowany format, limit 100 KB, do trzech wyników/formularzy).
Kluczem są kontekst podróży i pełne kryteria noclegu. Odświeżenie strony
i ponowienie tego samego wyszukiwania korzystają z cache do końca pierwotnego
TTL, bez automatycznego wywołania OBO. `pagehide` anuluje trwające żądanie,
ale zachowuje ważny cache na czas przeładowania. Zamknięcie karty kończy jej
sesję; błędy i limity nie są cache'owane. Uszkodzone lub przeterminowane
wpisy są odrzucane. Nie przechowujemy ofert w localStorage ani trwałym planie.

`photoUrl` pochodzi z `photo_url`, `hotel.hero_image` lub pierwszego adresu
`hotel.images` w tej samej odpowiedzi `search_hotels`. Wymagane HTTPS,
dokładny host OBO, brak userinfo i niestandardowego portu. Nieprawidłowy adres
daje `null`, bez odrzucania poprawnej oferty. Obrazy są hotlinkowane bez
przekazywania Referer i bez przycinania, proxy, zapisywania plików w backendzie
lub dodatkowych wywołań `get_hotel_details`.
`location` wymaga obu liczbowych, skończonych współrzędnych w zakresach
szerokości ±90 i długości ±180. Brak lub błąd daje `null`, bez geokodowania.
Markery noclegów aktualizują istniejącą instancję mapy.

Roboczy plan i wyniki wyszukiwania transportu mają osobny cache bieżącej karty
do 30 minut (limit 512 KB), aby przywrócić edytor po przeładowaniu. Nie zawiera
ofert OBO ani uprawnień właściciela/udostępnienia. Publiczny widok nie odczytuje
żadnego z tych cache.
[Warunki danych OBO](https://onebookingonline.com/api-terms).

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
