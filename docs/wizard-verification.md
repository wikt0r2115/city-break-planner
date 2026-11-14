# Układ krokowy planera — weryfikacja

Data: 2026-11-14. Kontynuacja interfejsu SOL-118 na zlecenie właściciela;
bez osobnego zgłoszenia dla zmiany wyglądu.

## Zakres

- Kierunek, połączenie, opcjonalny nocleg, atrakcje i podsumowanie pojawiają
  się kolejno w jednej stronie. Baner i hasło strony są w nagłówku.
- „Wstecz” i „Dalej” są poza przewijaną treścią. Wcześniejsze etapy pozostają
  dostępne; zmiana kryteriów blokuje przejście do nieaktualnego planu.
- Noclegi i katalog atrakcji są stronicowane po jednej karcie. Parametry
  noclegu zwijają się po uzyskaniu ofert, a cena za noc i opłaty są w szczegółach.
- Kafelki połączeń mają maksymalnie 360 px szerokości i są wyśrodkowane.
  Desktop pokazuje 3, tablet 2, telefon 1 kafelek na stronę.
  Jedno pole „Liczba osób” (1–8) znajduje się w Kierunku. Nocleg korzysta
  z tej liczby, a pozostałe parametry noclegu nadal zmieniasz w jego kroku.
- API oblicza koszt transportu i wstępów dla całej grupy. Szczegóły biletów
  pozostają cenami za jedną osobę. Budżet rekomendacji obejmuje całą grupę.
- Mapa jest obok treści na desktopie. Na telefonie przełącznik Plan/Mapa
  ujawnia odpowiedni panel i przenosi fokus. Po ujawnieniu mapa zmienia rozmiar.
- Ukryte etapy pozostają zamontowane. Powrót i F5 nie pobierają ponownie
  świeżych ofert OBO. Ich termin ważności nadal obowiązuje poza krokiem Nocleg.
- „Nowy plan” i logo czyszczą szkic, wybrane atrakcje i nocleg; F5 zachowuje
  bieżący plan. Nowy plan zaczyna bez automatycznie wybranych atrakcji.
- Liczba pokoi jest edytowana w Noclegu, przekazywana do OBO i uwzględniana
  w kluczu cache. Ceny całego pobytu nie są ponownie mnożone przez pokoje.
- Puste, błędne i nieczytelne wyniki noclegów pokazują informację o
  niedostępności partnerów i samodzielnym szukaniu. PARTIAL z ofertami
  pokazuje oferty bez technicznego komunikatu o niepełnej odpowiedzi.
- Po wyborze hotelu mapa pokazuje wyłącznie wybrany nocleg. Plan zapisuje
  jego nazwę i współrzędne jako bazę zwiedzania. Ceny, tokeny, zdjęcia i linki
  ofert pozostają poza SQLite. Po TTL baza pozostaje, a wycena znika.
- Pierwszy transfer i transfer przy zmianie dnia uwzględniają hotel.
  ESTIMATED_WALKING i opis pochodzenia są widoczne w edytorze oraz
  publicznie. Ręczne godziny zachowują się z ewentualnym konfliktem.

## Wyniki

Polecenia uruchomiono z Node 22.23.4. `E2E_SKIP_BUILD=1` wykorzystuje wcześniej
zbudowany backend i zainstalowane zależności; testy uruchamiają lokalne serwery.

| Polecenie / sprawdzenie | Wynik |
| --- | --- |
| `cd backend && ./mvnw -B -ntp package` | 68/68 testów i poprawny JAR; walidacja liczby osób, mnożenie kwot, budżet grupy, zapis/publiczny odczyt oraz starsze plany |
| `cd frontend && npm test` | 99/99 testów, 10 plików |
| `cd frontend && npm run build` | TypeScript i Vite przechodzą |
| `cd e2e && E2E_SKIP_BUILD=1 npm test` | 14 grup akceptacyjnych, w tym porównanie ceny 1 vs 3 osób, 3 karty na desktopie o szerokości ≤360 px i reset nowego planu, zapis/publiczny odczyt liczby osób, restart API, uprawnienia i błędy wyszukiwania |
| `cd e2e && E2E_SKIP_BUILD=1 npm run test:showcase` | 6 kierunków, ranking, propozycje z katalogu i zapis |
| `cd e2e && E2E_SKIP_BUILD=1 npm run test:map` | Rzeczywisty SDK/WebGL, kontrolowany podkład, klawiatura, zapis/publiczny widok, błąd i ponowienie mapy |
| `cd e2e && E2E_SKIP_BUILD=1 npm run test:stays` | 3 osoby/2 pokoje, brak drugiego pola liczby osób, jeden OBO search mimo F5 i nawigacji; z 3 markerów zostaje 1; hotel wpływa na ESTIMATED_WALKING; minimalna baza po zapisie/publicznie, bez tokenu/ceny; PARTIAL/puste/błędy, TTL i usunięcie bazy |
| Układ każdego etapu: 1440×900, 1280×800, 390×844, 360×740 | Jeden widoczny etap, brak przewijania dokumentu w obu osiach, widoczna dolna nawigacja |
| Mobilne Plan/Mapa | Widoczny canvas z poprawnym rozmiarem i fokus w ujawnionym panelu; powrót fokusu do nagłówka kroku |
| `git diff --check` | Bez błędów |
| `docker compose --env-file .env.docker up --build -d --wait --wait-timeout 180` | Oba serwisy healthy |
| Przeglądarka, gotowy Docker `http://localhost:8080` | Health/SQLite UP, wszystkie etapy, dodanie atrakcji, rzeczywista mapa MapTiler i znacznik, mobilny fokus, F5 oraz baner w nagłówku |
| Gotowy Docker po dodaniu liczby osób (poprzedni etap) | Cena grupy 3 osób = 3 × cena 1 osoby, wąskie karty, liczba nocujących z Kierunku, podsumowanie i F5 zachowują 3 osoby, Kierunek na telefonie mieści się w szerokości i wysokości ekranu |

Końcowe sprawdzenie gotowego Dockera: 3 kafelki, 2 pokoje, jeden wybrany
marker, szacowane dojście w harmonogramie, F5 bez ponowienia OBO i pusty
nowy plan. Oferty hotelowe w tym scenariuszu były kontrolowane; API planu,
SQLite i renderer MapTiler były rzeczywiste. Zrzuty: `refinements-docker-*.png`.

Zrzuty są w ignorowanym `e2e/artifacts/wizard-*.png`, raport scenariusza
akceptacyjnego w `e2e/artifacts/demo-report.json`.

Niezależny recenzent sprawdził bieżący kod kreatora: brak blokad.
Potwierdził fokus, `aria-current`, ukrycie nieaktywnych pól z tabowania,
resize mapy, działanie TTL poza etapem noclegu, izolację sessionStorage,
blokowanie starych kryteriów i zachowanie uprawnień. Wcześniejsza uwaga
o fokusie mobilnego przełącznika została poprawiona i objęta E2E.

Osobna niezależna recenzja zmiany liczby osób: brak blokad. Obejmuje
domyślną jedną osobę w starszym JSON, odrzucanie ułamków, zachowanie count
w normalizacji nazw miast, jednokrotne mnożenie cen, budżet rekomendacji,
zapis SQLite i publiczny widok oraz rozdzielenie cache dla różnych grup.

Recenzja resetu, pokoi i bazy hotelowej znalazła niezgodny limit nazwy
noclegu (200 vs 240 w OBO). Poprawiono limit do 240 i dodano test 240/241;
recenzent potwierdził usunięcie blokady. Sprawdzono też wyścigi odpowiedzi,
TTL, minimalny zapis bazy, oznaczenia estymacji i breakpointy kart.

## Granice

Na małych ekranach, po rozwinięciu szczegółów lub przy długim harmonogramie
przewijana jest treść etapu. Dolna nawigacja pozostaje widoczna. Publiczny
plan zachowuje układ dokumentu do odczytu i może wymagać przewijania.

Test noclegów używa jawnie oznaczonych ofert kontrolowanych, więc nie
potwierdza bieżącej dostępności ani cen OBO. W tym etapie prac nie wykonywano
rezerwacji, osobnego testu Safari/iOS ani pełnego testu Dockera z pustym
wolumenem (`npm run test:docker`). Nie zmieniono schematu SQLite; liczba osób
jest częścią istniejącego JSON planu, a starszy JSON oznacza jedną osobę.

Estymacja hotelowa jest geometrią Haversine ×1,3 przy 4,5 km/h, bez sieci ulic,
barier, transportu publicznego ani godzin zameldowania. Wizyta w kolejnym
dniu uwzględnia oba odcinki przez hotel; nie modeluje nocnego odpoczynku.
Nie podłączano nowego dostawcy routingu ani płatnej usługi.
[Oficjalna strona MapTiler opisuje dostęp do routingu w ramach beta](https://www.maptiler.com/routing/).
