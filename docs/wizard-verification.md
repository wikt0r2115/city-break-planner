# Kreator planu

Kolejne etapy to Kierunek, Połączenie, Nocleg, Atrakcje i Podsumowanie.
Dokument mieści się w wysokości ekranu, a długie treści przewijają się
wewnątrz etapu. Dolna nawigacja pozostaje widoczna. Widok publiczny jest
zwykłym dokumentem do odczytu i może wymagać przewijania.

## Zachowanie

- Liczba osób 1–8 jest wybierana w Kierunku. API liczy transport i wstępy
  dla całej grupy, a szczegóły biletów podają cenę za osobę.
- Połączenia są stronicowane: trzy na desktopie, dwa na tablecie i jedno
  na telefonie. Noclegi i katalog atrakcji pokazują po jednej karcie.
- Nocleg można wybrać lub pominąć. Liczba pokoi pochodzi z tego kroku;
  cena dostawcy obejmuje cały pobyt i nie jest ponownie mnożona.
- Ukryte etapy pozostają zamontowane. F5 przywraca plan roboczy i świeży
  cache noclegów, a Nowy plan lub logo rozpoczyna pusty plan.
- Zmiana powrotu zachowuje wybrane miejsca i pokazuje konflikty z powodem.
- Na telefonie Plan/Mapa ujawnia odpowiedni panel, przenosi fokus i dopasowuje
  rozmiar mapy. Nagłówek etapu otrzymuje fokus przy zmianie kroku.
- Zapis przechowuje plan i opcjonalną bazę hotelową. Odbiorca linku ma
  wyłącznie odczyt; prawo aktualizacji i usunięcia sprawdza API.

## Czasy dojścia z noclegu

Pierwszy transfer i przejście między dniami uwzględniają hotel. Oszacowanie
wykorzystuje Haversine ×1,3 i prędkość 4,5 km/h. Nie uwzględnia sieci ulic,
barier, transportu publicznego, zameldowania ani nocnego odpoczynku.
`ESTIMATED_WALKING` i punkt początkowy są jawnie opisane w obu widokach.
Ręczne godziny pozostają bez zmian; niewystarczający czas powoduje konflikt.

## Weryfikacja

[Zestawy testów](acceptance.md) obejmują cały przepływ, reset planu,
ceny grupowe, zapis i uprawnienia. `test:stays` sprawdza układ każdego etapu
przy 1440×900, 1280×800, 390×844 i 360×740, widoczną nawigację, fokus mapy,
pokoje, TTL oraz zachowanie bazy noclegowej. Oferty hotelowe są kontrolowane;
przebieg nie potwierdza dostępności zewnętrznego dostawcy.
