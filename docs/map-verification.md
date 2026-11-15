# Mapa planu

MapTiler SDK pokazuje przystanki podróży, ponumerowane atrakcje i noclegi
w kreatorze oraz publicznym widoku. Linie oznaczają kolejność punktów;
nie wyznaczają drogi po ulicach. Lokalizacje transportu i atrakcji pochodzą
z katalogu SQLite, a hoteli z odpowiedzi OBO lub zapisanej bazy noclegowej.

Publiczny klucz `VITE_MAPTILER_API_KEY` ustaw w `frontend/.env.local`
lub przekaż do budowania przez Compose. Bez klucza albo przy błędzie mapy
pozostałe funkcje planera działają. SDK jest ładowany na żądanie.

## Weryfikacja

Z katalogu `e2e/`, po przygotowaniu zależności i przeglądarki:

```bash
npm run test:map
```

Test używa rzeczywistego SDK/WebGL i kontrolowanego stylu, bez prawdziwego
klucza. Sprawdza markery, popupy, obsługę klawiaturą, aktualizację planu,
zapis i publiczny odczyt, ekran 360 px, błąd 403 i ponowienie. Weryfikuje
bezpieczną treść popupów i atrybucji oraz brak tokenów uprawnień w żądaniach
zewnętrznych. Logo i informacje o źródłach pozostają widoczne.

Wybrany hotel, filtrowanie pozostałych ofert i mobilne przełączanie mapy
sprawdza także `npm run test:stays`. Pełne polecenia są w [instrukcji testów](acceptance.md).

Test kontrolowanego podkładu nie potwierdza dostępności prawdziwych kafelków
ani limitów konta MapTiler. Starsze plany bez współrzędnych mogą pokazywać
mniej punktów. Publiczny widok zachowuje zwykłe przewijanie dokumentu.
