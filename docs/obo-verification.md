# Testowa sekcja noclegów OBO — 14 listopada 2026

Rozszerzenie integracji z SOL-119 na bezpośrednią prośbę właściciela.
Osobny formularz w edytorze wykorzystuje miasto i daty planu jako propozycje.
Rzeczywiste noclegi są wyceniane niezależnie od demonstracyjnego transportu.
Wyszukiwanie następuje wyłącznie po naciśnięciu „Sprawdź noclegi”.

## Zakres

- Backend: `POST /api/v1/stays/search`, walidacja, adapter JSON-RPC do
  stałego serwera OBO, trzy oferty dla jednego pokoju, opcjonalny poufny klucz.
- Frontend: edytowalne miasto/daty, liczba dorosłych, waluta, cena całego
  pobytu, podatki/dopłaty/uwagi, źródło i czas wyceny, oryginalny link do OBO.
- Wyniki krótkotrwałe: brak zapisu hoteli w SQLite, Plan DTO, localStorage oraz
  publicznym widoku. Świeże oferty i formularze są zachowywane w sessionStorage
  bieżącej karty do końca pierwotnego TTL (maksymalnie 30 minut od wyceny),
  także przez odświeżenie strony. Nie ma kopii katalogu ani plików zdjęć.
  Fotografie są hotlinkowane z OBO bez przycinania, a współrzędne z tej samej
  odpowiedzi wyszukiwania trafiają do znaczników H w istniejącej mapie.
- Nie wywołujemy AI ani narzędzi rezerwacji. Płatności i potwierdzenie
  ceny odbywają się po przejściu użytkownika na stronę dostawcy.

## Weryfikacja kontrolowana

- `backend`: `./mvnw -B -ntp test` — 51 testów PASS; `./mvnw -B -ntp package -DskipTests`
  — build PASS. Nowe testy obejmują
  poprawne i częściowe wyniki, rzeczywistą świeżość cache, wygasłe oferty,
  niebezpieczne linki, HTTP 429, JSON-RPC RATE_LIMITED, timeout, błędne i zbyt
  duże odpowiedzi, przekierowania, ceny z ogromnym wykładnikiem, walidację
  parametrów i `Cache-Control: no-store` także dla błędów.
  Końcowy test rozróżniania miast sprawdza aliasy Paryża/Londynu/Amsterdamu
  oraz zachowanie jawnie doprecyzowanego `Paris, Texas` i innych miast.
- `frontend`: `npm test` — 81 testów PASS, w tym testy sekcji noclegów
  (walidacja, granice dat, wygasanie, anulowanie opóźnionych odpowiedzi,
  pagehide, nullable dopłaty, błędne linki, timeout i limity).
  `npm run build` — PASS.
- `e2e`: `E2E_SKIP_BUILD=1 npm run test:stays` — PASS. Prawdziwy frontend,
  lokalny backend i tymczasowy SQLite; odpowiedzi hotelowe są kontrolowanymi,
  jawnie oznaczonymi danymi testowymi przechwyconymi przez Playwright.
  Sprawdzono brak automatycznych zapytań, formularz, ceny i dopłaty,
  oryginalne linki, zdjęcie i znacznik hotelu, popup, widok 360 px,
  usunięcie wygasłych cen/linków/markerów, cooldown, odrębny brak ofert
  i błąd dostawcy oraz zapis planu bez danych hoteli i ich brak w widoku publicznym.
  **Liczba wywołań wyszukiwania noclegów pozostała równa 1** po powtórnym
  kliknięciu i przeładowaniu strony. Roboczy plan, oferta, zdjęcie i marker
  zostały odtworzone. Osobna sesja przeglądarki nie odziedziczyła cache.
- Recenzja niezależna: brak otwartych blokad bezpieczeństwa. Wprowadzono
  ograniczenie pamięci podczas odczytu (1 MB), całkowity timeout, brak
  przekierowań, jeden odczyt naraz i co najmniej 6 s pomiędzy startami.
  Poufny klucz jest przekazywany wyłącznie backendowi. Nie ma logowania
  surowych odpowiedzi dostawcy ani automatycznych ponowień.
- `docker compose --env-file .env.docker up --build -d --wait --wait-timeout 180`
  — PASS, frontend i backend `healthy`, wolumen SQLite zachowany.

Użyto Java 25, Node 22.23.4 i Chrome. Testy z lokalnymi serwerami i Mockito
wymagały wyjścia poza sandbox. Zrzut kontrolowanej sekcji mobilnej:
ignorowany `e2e/artifacts/stays-mobile.png`.

## Rzeczywiste źródło

Sprawdzono bezpośrednie wywołanie OBO dla Paryża, 21–23 listopada 2026,
dwóch dorosłych, jednego pokoju i PLN. OBO zwróciło HTTP 200, aktualne
wyceny z `quoted_at` i `age_seconds`, linki rezerwacji i `partial=true`.
Nie utrwalamy w tym raporcie nazw hoteli, cen ani wygasających linków.

Końcowe sprawdzenie przez rzeczywisty interfejs na `http://localhost:8080`
po przebudowie kontenerów: **PASS**. Formularz z `Paryż` i tym samym pobytem
zwrócił HTTP 200, `status: PARTIAL`, trzy aktualne oferty w PLN i
`Cache-Control: no-store`. Karty i oryginalne linki wyświetliły się poprawnie
na ekranie 360 px. W pierwotnej wersji odświeżenie usuwało wyniki; bieżące
zachowanie cache opisano i przetestowano wyżej. Health i SQLite
zwróciły `UP`. Nie zapisano testowego planu w trwałej bazie. OBO otrzymuje
kraj FR dla dokładnej nazwy Paryża; analogicznie GB/NL dla Londynu/Amsterdamu,
bez narzucania kraju innym lub jawnie doprecyzowanym nazwom miast.

Końcowy test wersji ze zdjęciami, lokalizacją i cache na rzeczywistym Dockerze:
**PASS**. OBO zwróciło trzy aktualne oferty w PLN (`PARTIAL`), wszystkie ze
zdjęciem i współrzędnymi. Przeglądarka załadowała prawdziwe zdjęcie i pokazała
trzy znaczniki H; przycisk karty otworzył popup hotelu. Po powtórnym kliknięciu
i F5 licznik żądań `/api/v1/stays/search` nadal wynosił **1**, a karty i markery
wróciły z cache. Widok 360 px nie miał poziomego przewijania; SQLite `UP`.
Nie utrwalano zdjęć, szczegółów ofert ani testowych planów w trwałej bazie.
Jeden wcześniejszy przebieg rzeczywistego źródła zwrócił `PROVIDER_ERROR`;
ręczne ponowienie dało poprawne oferty. Błędy nie są cache'owane.

[Dokumentacja OBO](https://onebookingonline.com/mcp) i
[warunki danych](https://onebookingonline.com/api-terms).
Sprawdzenie integracji nie potwierdza kompletności ofert ani gwarancji
ceny do chwili checkoutu. Nie testowano rezerwacji, płatności, darmowego
anulowania, Safari ani Firefox.

## Aktualizacja: pokoje i baza noclegowa

Powyższe odczyty rzeczywiste są historycznymi próbami dla jednego pokoju.
Nowsza wersja obsługuje rooms1–8 (<=adults), bez mnożenia kwoty dostawcy.
Oferty i ceny pozostają w cache sesji; po świadomym wyborze można zapisać
nazwę i współrzędne hotelu jako bazę zwiedzania. To punkt planu, a nie
archiwum wyceny ani potwierdzenie rezerwacji.
[Weryfikacja nowej wersji i granice szacowania dojść](wizard-verification.md).
