# Mapa planu — weryfikacja 14 listopada 2026

Rozszerzenie widoków opisanych w SOL-118, wykonane na prośbę właściciela.
MapTiler SDK 4.2.1 pokazuje przystanki i ponumerowane atrakcje w edytorze
oraz publicznym planie. Przerywana linia oznacza kolejność zwiedzania.
Lokalizacje atrakcji pochodzą z katalogu serwera i są zapisywane jako
nullable `PlanItem.location`, bez migracji schematu SQLite.

## Wykonane sprawdzenia

- Backend, `./mvnw -B -ntp test`: 41 testów PASS, w tym lokalizacja przez
  preview, zapis, odczyt właściciela i publiczny oraz starszy zapis bez lokalizacji.
- Frontend, `npm test`: 44 testy PASS, w tym 7 testów mapy: brak klucza,
  aktualizacja kolejności i konfliktów bez nowej instancji, cleanup, błędy,
  ponowienie, niepoprawne współrzędne i bezpieczna treść popupu.
- `npm run build`: PASS zarówno bez klucza, jak i z fikcyjnym kluczem
  testowym; SDK/CSS są osobnymi zasobami ładowanymi na żądanie.
- W `e2e`, `E2E_SKIP_BUILD=1 npm run test:map`: PASS. Prawdziwy renderer
  SDK/WebGL, lokalny backend i tymczasowe SQLite, kontrolowany podkład
  przechwycony przez Playwright. Sprawdzono markery, otwarcie klawiaturą,
  zmianę kolejności bez nowego pobrania stylu, zapis i publiczny odczyt,
  szerokość 360 px, odpowiedź 403 i ponowienie oraz brak tokenów uprawnień
  w zewnętrznych URL, Referer i Authorization.
- Ten test podaje złośliwy HTML w attribution kontrolowanego źródła:
  nie uruchamia się zdarzenie `ontoggle`, a niebezpieczne atrybuty oraz
  adres `javascript:` są usuwane. Logo jest jawnie włączone.
- Recenzja infrastruktury i niezależna recenzja bezpieczeństwa: brak blokad.
- `E2E_SKIP_BUILD=1 npm run test:showcase`: PASS, w tym sześć kierunków,
  środki transportu, ranking, rekomendacje z katalogu i zapis w przeglądarce.
- `docker compose --env-file .env.docker up --build -d --wait --wait-timeout 180`:
  PASS, frontend i backend `healthy`, API i SQLite `UP`, wolumen zachowany.
- Końcowe sprawdzenie Chrome na `http://localhost:8080` z kluczem dodanym
  lokalnie przez właściciela: PASS. Wszystkie 38 odpowiedzi MapTiler HTTP 200,
  dwa markery atrakcji, rzeczywisty podkład, widoczne logo i informacje
  MapTiler/OpenStreetMap, szerokość 360 px bez przewijania poziomego.
  Nie zapisano żadnego testowego planu w trwałej bazie. Zrzut:
  ignorowany `e2e/artifacts/map-live-mobile.png`.

Testy lokalne używały Java 25, Node 22.23.4 i Chrome. Izolacja sandboxa
blokuje lokalne gniazda i Mockito attach; odpowiednie testy uruchomiono
ponownie z przyznanymi uprawnieniami. Automatyczny test kontrolowany nie
korzysta z rzeczywistego klucza; końcowe sprawdzenie lokalnego Dockera
wykorzystało klucz MapTiler Free właściciela, bez ujawnienia go w logach.
Zrzut kontrolowanej mapy mobilnej znajduje
się w ignorowanym `e2e/artifacts/map-mobile.png`.

## Audyt zależności

`npm audit` zgłasza GHSA-jrc7-96c5-q579 przez zakres wersji MapLibre.
[MapTiler SDK 4.2.1](https://github.com/maptiler/maptiler-sdk-js/releases/tag/v4.2.1)
oraz [MapLibre GL 5.24.1](https://github.com/maplibre/maplibre-gl-js/releases/tag/v5.24.1)
zawierają backport poprawek sanitacji attribution. Recenzent potwierdził
je także w zainstalowanych źródłach i kodzie wynikowym; opisany wyżej test
przeglądarkowy sprawdza regresję. Nie dodano niekompatybilnego nadpisania
głównej wersji MapLibre ani wyciszenia audytu.

## Pozostałe sprawdzenie

Rzeczywisty klucz działa z `localhost`; nie kontrolowano ustawień konta
w panelu MapTiler ani zachowania z innych domen. Publikacja na nowej
domenie wymaga odpowiedniego ograniczenia klucza przez Allowed HTTP origins.
Nie testowano Safari, Firefox ani urządzeń fizycznych.
