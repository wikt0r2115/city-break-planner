# SOL-123 — skąd pozyskiwać dane tras

Stan badania: **13 listopada 2026**. To rekomendacje dla kolejnego etapu,
nie deklaracja wdrożonych integracji. Aktualny zakres aplikacji pozostaje
opisany w [raporcie źródeł SOL-115](data-sources.md). Badanie nie obejmowało
zakładania kont, przyjmowania umów, zakupów ani kontaktowania się z dostawcami.

## Wniosek dla projektu

Najbardziej realistyczne są dwie niezależne ścieżki: **otwarte rozkłady +
silnik wyznaczania tras** oraz **partnerskie źródło aktualnych ofert cenowych**.
Pierwsza pozwala rozwijać czas podróży, przesiadki i czas na miejscu.
Druga jest potrzebna do wiarygodnego porównywania cen konkretnych kursów.
Nie potwierdziliśmy jednego bezpłatnego API zapewniającego komplet polskiej
kolei, autokarów, lotów, promów, cen i ulg studenckich.

Rekomendacja techniczna: najpierw sprawdzić otwarte rozkłady POLREGIO, SKM
i komunikacji miejskiej na kilku uzgodnionych trasach, a następnie zasilać
nimi własny OTP lub MOTIS. Transitous może przyspieszyć prototyp pod warunkami
opisanymi niżej. Jeśli ważniejszy jest szybki dostęp do szerokiego routingu
bez utrzymywania feedów, alternatywą jest płatne API Google/HERE po pilotażu
pokrycia i ocenie zasad zapisu wyników. To rekomendacje, nie decyzja
o rozszerzeniu obsługiwanych tras ani zatwierdzenie kosztów.

## Jakie dane są potrzebne

| Warstwa | Co daje | Czego sama nie dowodzi |
| --- | --- | --- |
| OpenStreetMap / sieć ulic | Przebieg dróg i dojść; silnik oblicza geometrię, dystans i szacowany czas marszu. | Rozkładu pociągu, dostępności miejsca ani ceny. |
| GTFS Static / NeTEx | Przystanki, linie, kursy, kalendarz i planowane godziny. Trzeba sprawdzić horyzont dat oraz wyjątki kalendarza. | Aktualnego opóźnienia, realizacji kursu ani dynamicznej ceny. |
| GTFS-RT / SIRI / API realtime | Opóźnienia, odwołania, komunikaty lub pozycje, zależnie od dostawcy. | Kompletnego routingu bez rozkładu bazowego ani gwarancji przesiadki. |
| API routingu | Łączy odcinki, dojścia i przesiadki dla daty; zakres zależy od wgranych źródeł. | Pełnego rynku przewozów ani aktualnej oferty zakupu. |
| Taryfa / fares GTFS | Opublikowane zasady cenowe, jeśli feed rzeczywiście je zawiera i silnik je obsługuje. | Wycenionego, dostępnego biletu na konkretny kurs. |
| Oferta rezerwacyjna | Cena, waluta, warunki i dostępność dla konkretnych parametrów pasażera i podróży; oferta może wygasnąć. | Automatycznej obsługi polskiej ulgi studenckiej. |

Opis formatów i wejść silnika: [OTP — źródła danych](https://docs.opentripplanner.org/en/latest/Data-Sources/).

## Źródła otwarte i kolej w Polsce

| Opcja | Pokrycie i dostęp | Cena i ograniczenia | Ocena dla nas |
| --- | --- | --- | --- |
| [POLREGIO — oficjalny GTFS](https://polregio.pl/pl/rozklad-jazdy-i-mapa-polaczen/rozklad-jazdy/) | Rozkład przewoźnika, publikowany codziennie o 10:00; nie cała kolej w Polsce. Pobranie anonimowe: **200**, 2,38 MB; kalendarze do **12.12.2026**. | W pobranym ZIP brak plików taryfowych `fare*`. Jest link do zakupu, bez wyceny kursu. Warunki ponownego wykorzystania należy ustalić przed redystrybucją. | Mocny kandydat do rozszerzenia o kolej regionalną: 1984 aktywne rekordy trips 5.12 po uwzględnieniu wyjątków kalendarza; bez dowodu dowolnej relacji. |
| [PKP SKM Trójmiasto — BIP](https://bip.skm.pkp.pl/c60/rozklad-jazdy) | Oficjalna publikacja GTFS; zakres sieci SKM. Pobranie anonimowe: **200**, 15,26 MB; kalendarze do **12.12.2026**. | Brak `fare*`; obecność `agency_fare_url` nie oznacza cen. BIP odsyła do regulaminu otwartych danych, którego treści nie udało się potwierdzić przez timeout. | Naturalne uzupełnienie Gdańska; 89 aktywnych trips zarówno 5, jak 6.12. Przed importem potwierdzić regulamin. |
| [ZTM Gdańsk — CKAN](https://ckan.multimediagdansk.pl/pl/dataset/tristar) i inne miejskie feedy | W Gdańsku już działa adapter JSON; GTFS może zasilać silnik. Pozostałe miasta wymagają osobnego sprawdzenia operatora, licencji i dat. | Bez klucza w potwierdzonym źródle Gdańska. Ceny z osobnej taryfy, feed ma ograniczony horyzont. | Rozwijać źródła organizatorów zamiast parsować strony wyników wyszukiwarek. |
| [PKP PLK — API otwartych danych](https://pdp-api.plk-sa.pl/api-documentation) | Rozkłady, realizacja i utrudnienia kolejowe; [bezpłatne](https://www.plk-sa.pl/klienci-i-kontrahenci/api-otwarte-dane) po rejestracji i zatwierdzeniu klucza. | Samo konto nie daje aktywnego dostępu. API rozkładu nie jest API ofert biletowych. Świeży odczyt bez klucza: **401 MissingKey**. | Docelowe źródło szerszych danych kolejowych, po uzyskaniu dostępu i sprawdzeniu pokrycia. |

Wyniki nowych prób pobrania feedów i zapytań znajdują się w
[dowodzie badania](evidence/sol123-route-research.json). Historyczna próba PLK:
[11.11 — odmowa bez klucza](evidence/plk-access-verification.json).

Inne miasta mogą udostępniać osobno GTFS i GTFS-RT, np.
[ZTM Poznań — pliki](https://www.ztm.poznan.pl/otwarte-dane/gtfsfiles/)
i [realtime](https://www.ztm.poznan.pl/otwarte-dane/gtfs-rt/).
Potwierdzono dokumentację tych publikacji, nie pobrano i nie zwalidowano ich
feedów w SOL-123. KOLEO/PKP Intercity nie traktujemy jako publicznego API na
podstawie endpointów używanych przez ich aplikacje: nie potwierdzono w tym
badaniu dokumentacji ani uprawnienia do takiej integracji.

## Gotowe API i własny routing

| Opcja | Co uzyskamy | Dostęp / koszt | Ograniczenia |
| --- | --- | --- | --- |
| [Transitous](https://transitous.org/api/) na MOTIS | Gotowy routing transportu publicznego z dojściami, zależny od dostępnych feedów. | Publiczne API do lekkiego prototypu bez konta. Użycie docelowe: projekt open source na odpowiedniej licencji, niekomercyjny, małe obciążenie. | Best effort, bez gwarancji działania. Wymagany identyfikujący User-Agent i atrybucja źródeł/OSM. Powyżej 720 zapytań routingu/24 h, przy wielu użytkownikach lub automatyzacji trzeba uzgodnić obciążenie; to próg koordynacji, nie gwarantowany darmowy pakiet. Repo nie zawiera obecnie pliku LICENSE: publiczny kod sam nie spełnia warunku licencji. |
| Własny [OpenTripPlanner](https://www.opentripplanner.org/) / [MOTIS](https://github.com/motis-project/motis) + GTFS + OSM | Kontrolowany routing multimodalny, kalendarze, przesiadki i dojścia, opcjonalnie realtime z dostępnych feedów. | Silniki open source; ponosimy koszty infrastruktury, importów, aktualizacji i monitoringu. Można później dodać osobny kontener. | Silnik nie dostarcza rozkładów ani cen sam z siebie. Potrzebne licencje każdego feedu, atrybucja OSM, walidacja pokrycia oraz zasoby na budowę grafu. Nie wdrażano ani nie mierzono wydajności w tym badaniu. |
| [Google Routes — TRANSIT](https://developers.google.com/maps/documentation/routes/transit-route) | Trasy, przystanki, godziny, dojścia i preferencja mniejszej liczby przesiadek; pokrycie trzeba sprawdzić dla naszych relacji. | Konto rozliczeniowe i klucz. W pay-as-you-go Compute Routes Essentials: 10 000 bezpłatnych żądań/miesiąc, następnie 5 USD/1000 w pierwszym płatnym przedziale. Inne funkcje/SKU mają inne stawki. | `transitFare` to szacunek, zwracany tylko gdy dostawca zna opłaty wszystkich etapów. Brak gwarancji polskiej ulgi i ofert lotniczych. Ograniczenia przechowywania kolidują z założeniem trwałego snapshotu całej trasy — wymagana zmiana sposobu zapisu albo odpowiednia licencja. Nie wykonano zapytania autoryzowanego. |
| [HERE Public Transit v8](https://docs.here.com/transit/docs/readme-public-transit-api-v8) | Routing, odjazdy i wyszukiwanie przystanków; szczegółowość zależy od miejsca i źródła. | Wymaga konta/uprawnień i uwierzytelnienia. Nie potwierdzono w tym badaniu aktualnej stawki właściwej dla Public Transit. | HERE rozróżnia realtime, rozkład i oszacowanie; nie wolno pokazać oszacowania jako potwierdzonego rozkładu. Brak potwierdzenia kompletu polskich tras, cen i ulg. |
| [openrouteservice / HeiGIT](https://playground.heigit.org/) | Dojścia piesze między dworcem a atrakcjami, geometria i szacowany czas; uzupełnienie rozkładu. | Hosted API wymaga klucza; istnieje bezpłatny Standard z limitami. Własny backend jest alternatywą z kosztami utrzymania. | Nie zastępuje routingu kolejowego/autobusowego z kalendarzem ani cen biletów. Anonimowa próba: 401. Nowe integracje kierować na `api.heigit.org`, nie wycofywane `api.openrouteservice.org`. |

Cennik i naliczanie Google: [stawki](https://developers.google.com/maps/billing-and-pricing/pricing),
[warunki wyboru SKU](https://developers.google.com/maps/billing-and-pricing/sku-details/routes).
Nie przeliczymy limitu żądań na liczbę użytkowników: jedno wyszukiwanie może
wymagać kilku zapytań o wyjazd, powrót i dojścia, a macierze rozliczają elementy.
HERE: [poziomy pokrycia](https://docs.here.com/transit/docs/coverage).
HeiGIT: [migracja adresu API, 22.10.2026](https://heigit.org/changes-in-the-openrouteservice-universe/),
[oficjalne FAQ limitów](https://giscience.github.io/openrouteservice/v9.10.0/frequently-asked-questions),
[bieżący panel planów](https://account.heigit.org/info/plans).

Google: [polityka przechowywania](https://developers.google.com/maps/documentation/routes/policies)
nie zezwala ogólnie na trwały zapis pełnych wyników; wyjątek place IDs
nie obejmuje całego planu. Dla adresu rozliczeniowego w EOG obowiązują
[osobne warunki](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms):
§20.2 pozwala przechowywać współrzędne do 30 dni, a §20.1 ogranicza użycie
opisu/kroków trasy z mapą. Nie interpretować tego jako prawa do przechowania
całej odpowiedzi przez 30 dni. To istotne ograniczenie obecnego modelu
zapisanych i udostępnianych planów.

### Rzeczywista próba Transitous

Publiczny produkcyjny `GET /api/v6/plan` zwrócił **200** i trzy planowane
połączenia dla współrzędnych przy Warszawie Centralnej i Gdańsku Głównym,
**5 grudnia 2026**. Poniżej same odcinki kolejowe, czas Europe/Warsaw;
pełne itineraries zawierają dodatkowo dojścia piesze.

| Pociąg | Warszawa Centralna | Gdańsk Główny | Przesiadki |
| --- | --- | --- | --- |
| EIP 1502 | 07:29 | 10:01 | 0 |
| EIP 3510 | 08:29 | 10:54 | 0 |
| EIC 4550 Wysocki | 08:49 | 11:34 | 0 |

Każdy odcinek ma `realTime=false`: to planowany rozkład, nie potwierdzenie
realizacji ani dostępności miejsc. Nie potwierdzono ceny. Pole `source`
wskazuje `pl_PKP-Intercity.gtfs.zip`, czyli feed społecznościowy, nie
oficjalne API PKP Intercity. Pochodzenie: [manifest Polski](https://github.com/public-transport/transitous/blob/main/feeds/pl.json),
[publikacja GTFS](https://gtfs.kasznia.net/) i [wykaz źródeł](https://transitous.org/sources/).
To potwierdza użyteczność próbki, nie pełne pokrycie Polski. Próba objęła
tylko wyjazd; powrotu 6.12 nie wyszukiwano.

## Bilety i integracje partnerskie

| Opcja | Dane i model | Dostęp / koszt / ocena |
| --- | --- | --- |
| [Omio B2B — Meta Search API](https://www.omio.com/corporate/omio-b2b/) | Trasy, ceny i dostępność, przekierowanie do checkout; kolej, autobusy i loty według zasobu partnera. | Najlepsze dopasowanie funkcjonalne do porównywania i linkowania zakupu. Wymaga uzgodnienia B2B; brak potwierdzonego publicznego cennika i dostępu projektu. Osobno potwierdzić polskich przewoźników i ulgi. |
| [Distribusion](https://www.distribusion.com/), [dokumentacja](https://docs.distribusion.com/) | Integracja dystrybucyjna transportu naziemnego, m.in. autobusów i kolei; docelowo wyszukiwanie i sprzedaż. | Publiczna dokumentacja nie jest dostępem do produkcyjnego zasobu. Model partnerski i warunki handlowe; brak potwierdzonej stawki oraz konkretnych polskich połączeń. Alternatywa B2B, nie bezpłatny router. |
| [Flix — partnerzy](https://global.flixbus.com/company/partners/affiliate-partners) | Oficjalnie oferuje integracje GTFS, API, white label i metasearch własnej sieci. | Wymaga zgłoszenia z danymi firmy, domen i ruchem. Brak potwierdzonego anonimowego API cen oraz jawnej opłaty za API. Sensowny osobny dostawca autokarów, po przyznaniu dostępu. |
| [Trainline Partner Solutions — Global API](https://tps.thetrainline.com/our-products/global-api/) | Europejska kolej, ceny/rezerwacje, obsługa posprzedażowa i realtime tam, gdzie dostępne. | B2B, brak publicznej stawki; dostawca podaje średnio 12 tygodni integracji, nie gwarantowany termin. Sprawdzić konkretną polską ofertę i uprawnienia ulgowe; kierunek na dalszy etap. |
| [Direct Ferries Connect](https://www.directferriesconnect.com/connect) | Partnerskie REST API do ofert i biletów promowych. | Bezpłatna rejestracja partnera w ofercie nie dowodzi bezpłatności produkcyjnego API. Warunki/zakres wymagają uzgodnienia. Nie potwierdzono lokalnej przeprawy miejskiej Świnoujścia. |

**Loty — dwa istotne ograniczenia:**

- [Duffel — aktualna umowa](https://duffel.com/services-agreement) zabrania
  wykorzystania metasearch bez wyraźnego odrębnego uprawnienia. Nasz model porównywania nie powinien zakładać
  takiego uprawnienia. To API sprzedażowe z weryfikacją dostępu produkcyjnego,
  nie domyślny dostawca porównywarki. [Cennik](https://duffel.com/pricing)
  obejmuje m.in. 3 USD za potwierdzone zamówienie, 1% za Managed Content
  oraz 0,005 USD za wyszukiwania ponad stosunek 1500:1 do zamówień;
  dodatkowe usługi mają osobne opłaty. [Testowe rozkłady/ceny](https://duffel.com/docs/api/overview/test-mode) nie są ofertą live.
- [Portal Amadeus](https://developers.amadeus.com/) po wyrenderowaniu
  potwierdza zamknięcie Self-Service **17 lipca** i obsługę Enterprise.
  Komunikat nie podaje roku. Nie rekomendujemy dawnych bezpłatnych limitów
  Self-Service jako dostępnej dzisiaj ścieżki. Enterprise wymaga uzgodnienia
  dostępu; koszt i zasób niepotwierdzone.

Żadna z tych stron nie potwierdza jeszcze datowanej wyceny Warszawa–Gdańsk
dla naszego projektu. Marketingowe liczby przewoźników nie gwarantują
wybranych relacji, taryf studenckich, Ryanaira/Wizz Aira ani wszystkich
lokalnych promów. Nie zakładano kont i nie wysyłano formularzy partnerskich.

## Proponowana kolejność

1. Uzgodnić kilka relacji i dat akceptacyjnych. Dla każdej sprawdzić feed,
   horyzont rozkładu, licencję i rzeczywisty przebieg kursów. Brak danych
   pozostaje brakiem pokrycia, nie komunikatem „brak połączenia”.
2. Wykonać mały prototyp routingu z otwartych danych: własny OTP/MOTIS albo
   Transitous, jeśli spełnimy warunki użycia. Zapisywać źródło, czas odczytu,
   zakres dat i informację, czy godziny są planowane czy aktualizowane.
3. Uzupełnić dojścia do atrakcji przez silnik na OSM. Czas marszu oznaczyć
   jako oszacowanie; nie traktować odległości w linii prostej jako trasy.
4. Osobno uzyskać ofertę dostawcy cen i zweryfikować studenckie uprawnienia.
   Bez kompletnej wyceny nie ogłaszać „najtańszego” wariantu. Utrzymać
   `PUBLISHED_TARIFF` i `LIVE_OFFER` jako różne podstawy ceny w obecnym kontrakcie.

Do decyzji właściciela pozostają obsługiwane relacje/środki transportu,
ewentualna licencja open source projektu, komercyjny charakter oraz budżet
i zgody na konta partnerskie. Nie są potrzebne do ukończenia samego researchu.

## Weryfikacja i granice

Sprawdzono oficjalne dokumentacje i dostęp anonimowy tam, gdzie był dostępny.
Nie ma potwierdzonych produkcyjnych wycen biletów ani działania usług za
kluczem. Testy sandbox nie potwierdzają prawdziwych rozkładów/cen.
Raport ma charakter techniczny; nie zastępuje uzgodnienia warunków licencji
i umów z dostawcami przed użyciem produkcyjnym.

Zmieniono wyłącznie dokumentację; nie uruchamiano ponownie testów aplikacji.
Weryfikacja: `python3 -m json.tool docs/evidence/sol123-route-research.json`,
kontrola lokalnych linków i zgodności dowodów oraz `git diff --check` —
**PASS**. Niezależny recenzent potwierdził sumy SHA256 surowych ZIP,
aktywne kalendarze, brak plików taryfowych oraz trzy planowane odcinki
Transitous po przeliczeniu UTC na Europe/Warsaw. Recenzja warunków API
i raportu — **PASS**, bez blokujących uwag. Amadeus oceniono na podstawie
zapisanego dowodu wyrenderowanej strony, bez drugiego niezależnego renderu.
