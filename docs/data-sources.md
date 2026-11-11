# SOL-115 — weryfikacja źródeł danych

Sprawdzono **11 listopada 2026 r.** przez oficjalne strony i anonimowe odczyty
HTTP. Dokładne czasy UTC, adresy żądań i skróty odpowiedzi zapisano w
[`docs/evidence/`](evidence/). Nie zakładano kont, nie wysyłano wniosków ani
nie wykonywano zakupów. Raport opisuje dostęp do źródeł, a nie wdrożone
integracje aplikacji.

Przykłady badawcze: **Warszawa → Gdańsk 2026-12-05**, powrót **2026-12-06**
oraz przeprawa **Centrum ↔ Warszów w Świnoujściu 2026-12-05**. Daty i trasy
nie oznaczają zatwierdzenia ostatecznego zakresu produktu przez właściciela.
Dodatkowo sprawdzono lokalny kurs ZTM Gdańsk **2026-11-14**, gdyż ta data
mieści się w aktualnie opublikowanym rozkładzie.

## Wynik i decyzje do podjęcia

**Potwierdzony anonimowy odczyt maszynowy: ZTM Gdańsk JSON**. Są godziny,
przystanki i ograniczony zakres dat; w odpowiedzi nie ma cen. Oficjalne
cenniki ZTM i trzech atrakcji są dostępne jako publikowane taryfy HTML.
Rozkład promów Świnoujścia jest dostępny jako obraz, bez potwierdzonego API.

**Nie potwierdzono dostępu do wycen konkretnego kursu Warszawa ↔ Gdańsk
na 5–6 grudnia** dla kolei, samolotów ani autokarów. Nie można obecnie
deklarować pełnego rzeczywistego porównania kosztów tej podróży.
Brak dostępu nie oznacza braku połączenia.

Właściciel powinien zdecydować:

1. Czy wystąpić o klucz PLK i osobny dostęp do źródła cen kolejowych.
   Rejestracja PLK wymaga potwierdzenia e-maila i aktywacji administratora;
   formularz podaje 3–5 dni roboczych, co może przekroczyć termin oddania.
2. Czy uzyskać dostęp partnerski Omio albo dostęp produkcyjny do dostawcy
   lotniczego. Nie zatwierdzono kont, warunków handlowych ani kosztów.
3. Jakie trasy i daty obejmie rzeczywiste demo. Dla komunikacji Gdańska
   bieżący zakres sięga 22–23 listopada, nie 5 grudnia. Ewentualną zmianę
   zakresu zatwierdza właściciel.
4. Czy dopuścić osobny, wyraźnie oznaczony scenariusz testowy planera obok
   potwierdzonych rzeczywistych odczytów. Scenariusz taki nie spełnia
   kryterium rzeczywistej wyceny w SOL-119/120.

## Transport i dostęp

| Źródło i zakres | Dostęp i wynik próby | Cena / ulga | Ograniczenie i pewność |
| --- | --- | --- | --- |
| [PKP PLK — otwarte dane](https://www.plk-sa.pl/klienci-i-kontrahenci/api-otwarte-dane), [dokumentacja](https://pdp-api.plk-sa.pl/api-documentation) | Oficjalne API rozkładów, realizacji i utrudnień. Wymaga `X-API-Key`. Anonimowy GET `/api/v1/schedules?dateFrom=2026-12-05&dateTo=2026-12-06` dał **401**; nie pobrano stacji ani kursów. [Dowód](evidence/plk-access-verification.json). | Dokumentacja nie potwierdza API cen biletów. Taryfa normalna i ulgowa dla dat przykładu: **nieustalone**. | Bezpłatna rejestracja nie jest aktywnym dostępem. Wysoka pewność wymogu klucza i odmowy anonimowego odczytu; brak potwierdzenia pokrycia wybranej trasy/dat. |
| [Omio — program partnerski](https://www.omio.co.uk/affiliate) | Oficjalna strona oferuje Search API dla partnerów. Nie otrzymano poświadczeń ani publicznego anonimowego endpointu. Nie wykonano zapytania API. | Cena konkretnego kursu i warunki ulg: **niepotwierdzone**. | Wymagana decyzja i dostęp partnerski. Nie traktować widżetu/linku afiliacyjnego jako działającej integracji. Wysoka pewność istnienia oferty API, brak potwierdzenia dostępu projektu. |
| [LOT — Warszawa → Gdańsk](https://www.lot.com/pl/pl/loty/loty-do-europy/loty-do-polski/loty-do-gdanska/loty-z-warszawy-do-gdanska) | Oficjalna strona potwierdza relację i formularz wyszukiwania. Nie uzyskano anonimowego udokumentowanego API ani odpowiedzi z konkretnym lotem na 5–6 grudnia. | **Nieustalone**. Ceny w kalendarzu LOT odświeżanym raz na dobę nie są gwarancją dostępnej oferty. Nie zakładać automatycznej ulgi studenckiej. | Link zakupu nie jest odpowiedzią cenową. Wysoka pewność braku potwierdzenia w tej próbie; nie wniosek o braku API lub lotów. |
| [Duffel — tryb testowy](https://duffel.com/docs/api/overview/test-mode) | Wymaga konta i tokenu. Nie wykonano odczytu bez tokenu ani nie zakładano konta. | Sandbox Duffel Airways ma **nierealistyczne rozkłady i ceny**, co dostawca wprost dokumentuje. | Może służyć do testowania adaptera, nigdy jako potwierdzenie rzeczywistego lotu. Token testowy nie daje dostępu produkcyjnego. Wysoka pewność. |
| [FlixBus — Warszawa → Gdańsk](https://www.flixbus.pl/polaczenia-autobusowe/warszawa-gdansk), [rozkłady](https://www.flixbus.pl/rozklady) | Publiczna strona trasy i publikowane rozkłady. Nie potwierdzono anonimowego API z wyceną na wybrane daty. | Cena reklamowa „od” nie jest wyceną wskazanego kursu. Normalna/ulgowa na 5–6 grudnia: **nieustalone**. | Strona listuje rozkład linii 1210 ważny od 30.08.2026; samego wpisu nie traktujemy jako potwierdzenia kursowania 5 grudnia. Wysoka pewność braku datowanej wyceny w tej próbie. |
| [ZTM Gdańsk — CKAN](https://ckan.multimediagdansk.pl/pl/dataset/tristar) | Anonimowe JSON/GTFS, bez klucza. **200** dla linii 100, 2026-11-14. Odczytano daty, przystanki i godziny. [Dowód](evidence/ztm-gdansk-verification.json). | Ceny pobiera się oddzielnie z [publikowanej taryfy](https://ztm.gda.pl/bilety/bilety-jednorazowe,a,3019), nie z JSON rozkładu. | Zakres agency 1: 11–23.11.2026. Dla 05.12 odczyt dał **404**: brak pokrycia daty, a nie potwierdzony brak kursu. Licencja zbioru CC BY i osobny regulamin korzystania. Wysoka pewność. |
| [ZDMiŻ Świnoujście — rozkład](https://www.zdmiz.swi.pl/rozklad-kursowania-promow) | Publiczny obraz rozkładu od 17.10.2026, ręcznie obejrzany. Nie potwierdzono API. [Dowód odczytu](evidence/swinoujscie-schedule-verification.json). | Bieżąca strona rozkładu nie podaje taryfy; ceny na grudzień oznaczamy jako **niepotwierdzone**, bez samodzielnego wpisywania zera. | Zielone komórki to autobus **P1**, białe to prom. [Komunikat miasta](https://www.swinoujscie.pl/artykul/zmiany-na-przeprawie-warszow-jeden-prom-zastapi-autobus) określa organizację do 18.04.2027. Wysoka pewność rozkładu publikowanego; bez gwarancji realizacji rejsu. |

### Potwierdzony przykład lokalnego kursu i taryfy

JSON ZTM dla **2026-11-14**, linia **100**, kurs identyfikowany łącznie przez
`tripId=11`, `order=1`, `busServiceName=100-01`, pokazuje pasażerski przejazd:

**Dworzec Główny 10:36 → Hucisko 10:39 → Targ Drzewny 10:41 → Targ Chlebowy
10:42 → Żuraw 10:43 → Targ Rybny 10:44**, czas lokalny Europe/Warsaw.

To odczyt rozkładu dla konkretnego dnia, **nie live quote**. Pole daty w
`arrivalTime`/`departureTime` ma eksportowy znacznik `1899-12-30`; właściwy
dzień kursowania pochodzi z `date`. Nie wolno wyświetlać roku 1899 ani uznać
`tripId` za globalnie unikalny identyfikator kursu.

[Taryfa ZTM](https://ztm.gda.pl/bilety/bilety-jednorazowe,a,3019), sprawdzona
11.11.2026, podaje osobno: jeden przejazd **4,80 / 2,40 PLN**, 75 minut
**6,00 / 3,00 PLN**, 24 godziny **22,00 / 11,00 PLN** (normalny / ulgowy).
To cennik publikowany; nie potwierdzono utrzymania stawek w grudniu.
[Warunki ulg](https://ztm.gda.pl/bilety/przejazdy-ulgowe,a,9002) obejmują
studentów polskich uczelni bez względu na wiek z legitymacją; dla studentów
zagranicznych wskazano ISIC i granicę 26 lat. Nie przenosić tych warunków
automatycznie na kolej ani atrakcje.

W rozkładzie Świnoujścia **10:00 z Centrum** oraz **10:30 z Warszowa** są
komórkami promowymi; **10:30 z Centrum** jest zielonym kursem P1. Źródło
nie daje czasu przybycia, więc nie wyliczono czasu rejsu z domysłu.

## Atrakcje: taryfa, godziny i czas zwiedzania

Poniższe ceny są **publikowanymi cennikami**, sprawdzonymi 11.11.2026,
waluta **PLN**. Nie są rezerwacją, wyceną dynamiczną ani potwierdzeniem
dostępnej puli biletów na 5–6 grudnia. Odczyt publicznych stron jest
potwierdzony; brak udokumentowanych publicznych API tych instytucji.

| Atrakcja / źródła | Normalny / ulgowy i potwierdzone warunki | Godziny ze źródła | Czas wizyty |
| --- | --- | --- | --- |
| [Muzeum II Wojny Światowej — wystawa główna, cennik](https://www.muzeum1939.pl/wizyta/wizyta-miiws/bilety-i-cennik), [godziny](https://www.muzeum1939.pl/wizyta/wizyta-miiws/godziny-otwarcia) | **33 / 23 PLN**. Ulga student do 26 lat z legitymacją. Audioprzewodnik dodatkowo 12 PLN; nie dopisujemy go bez wyboru. Zakup: [oficjalna kasa online](https://bilety.muzeum1939.pl/). | Pon. zamknięte; wt. 10–16; śr.–nd. 10–18. Kasy zamykają się wcześniej. Oficjalnie wymieniono zamknięcia 24–26 i 31.12.2026. | Ewentualne 120–180 minut to **parametr planera**, nie zmierzony czas z tego źródła. |
| [Europejskie Centrum Solidarności — wystawa stała, cennik](https://bilety.ecs.gda.pl/index/cennik.html), [godziny](https://ecs.gda.pl/zaplanuj-wizyte/godziny-otwarcia/) | **40 / 35 PLN**, audioprzewodnik w cenie. Ulga: studenci do 26 lat z ważną legitymacją. To inny produkt niż wystawa Stocznia (15 / 10 PLN). | Paź.–kwie.: pon. i śr.–pt. 10–17, sob.–nd. 10–18, wt. zamknięte. Budynek ma inne godziny niż wystawy; istnieją limity wejść. | Robocze 120 minut to **parametr planera**, a nie gwarancja instytucji. |
| [Hevelianum — pakiet wystaw, cennik](https://hevelianum.pl/cennik/cennik-indywidualny/), [planowanie wizyty](https://hevelianum.pl/zaplanuj-wizyte-gora-gradowa/) | **30 / 25 PLN** za pakiet. Warunków studenckiej ulgi nie potwierdzono w przeczytanym cenniku: nie stosować jej automatycznie bez dodatkowego regulaminu. Zakup: [oficjalna kasa](https://bilety.hevelianum.pl/). | Główna sekcja z datami 2026: pon. zamknięte, wt.–pt. 8–16, sob.–nd. 10–18. Stopka zawiera sprzeczne, starsze informacje; nie używać jej do generowania godzin. | Robocze 150 minut to **parametr planera**; nie ekstrapolować czasu specjalnego pokazu na cały pakiet. |

Dla SOL-119 trzeba podczas wyszukiwania ponownie odczytywać lub świadomie
odświeżać publikacje. `checkedAt` oznacza faktyczny odczyt źródła; nie wolno
nadać dzisiejszej daty statycznym, nieodświeżonym danym zapisanym w kodzie.
Jeżeli nie potwierdzono warunków ulgi albo godzin dla danego dnia, należy
zwrócić jawny brak danych. Brak biletów w jednej puli internetowej nie
przesądza o braku biletów w kasie ani zamknięciu atrakcji.

## Zalecenia do SOL-119

- Rozdziel adapter rozkładu od taryfy i ofert wycenionych na kurs. ZTM można
  połączyć z opublikowaną taryfą, jawnie wskazując rodzaj źródła ceny.
- Dla PLK skonfiguruj przyszły `PLK_API_KEY` tylko w backendzie. Nazwy
  pozostałych zmiennych ustal dopiero po wyborze dostawcy i umowy.
- Obsługuj brak klucza, HTTP 401, datę poza zakresem, błąd źródła i brak
  ceny osobno. Nie mapuj każdego 404 na `NO_CONNECTION`.
- Odczyt jednego lokalnego rozkładu nie potwierdza wyceny całej podróży.
  Dopóki brakuje któregoś składnika, suma porównawcza pozostaje niepełna.
- Ze Świnoujścia nie generuj rejsów na podstawie samych odstępów czasu;
  harmonogram jest mieszany, z osobnymi kursami P1. Obraz wymaga jawnie
  kontrolowanej ekstrakcji oraz ponownego sprawdzenia przed wyszukiwaniem.
- Brak potwierdzonej integracji między miastami pozostaje otwartą decyzją
  produktową. Raport nie zatwierdza redukcji zakresu ani dostawcy płatnego.

## Weryfikacja i granice

Wykonano anonimowe GET przez `urllib.request`: metadane CKAN, zakres dat,
linie, przystanki, odjazdy linii 100 dla 14.11 i 05.12 oraz chroniony endpoint
PLK dla 05–06.12. Sprawdzono bieżący obraz rozkładu ZDMiŻ i oficjalne strony
pozostałych dostawców. JSON dowodów przeszedł parsowanie, spójność godzin
i zakresów sprawdzono na odpowiedziach, `git diff --check` bez uwag.

Nie sprawdzono: dostępu z kluczami, umów/licencji partnerskich, płatności,
zakupu biletu, rzeczywistych grudniowych wycen transportu między miastami,
osiągalności każdej kombinacji przesiadek ani wdrożenia adapterów w aplikacji.
Bezpośrednie odczyty HTTP dotyczą chwili zapisanej w dowodzie, nie przyszłej
gwarancji dostępności usług. Niezależną recenzję i decyzje właściciela
koordynuje agent główny.
