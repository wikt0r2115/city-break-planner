# Integracja noclegów OBO

`POST /api/v1/stays/search` wywołuje stały serwer MCP OBO przez backend.
Wyszukiwanie jest jawnie uruchamiane przez użytkownika, bez narzędzi
rezerwacji. Klucz `OBO_API_KEY` jest opcjonalny i pozostaje na serwerze.

## Dane i cykl życia

- Parametry obejmują miasto, daty, walutę, dorosłych i pokoje. Liczba osób
  pochodzi z Kierunku, a pokoje wybiera się w Noclegu: 1–8, najwyżej tyle,
  ile dorosłych. W odpowiedzi są najwyżej trzy oferty.
- Cena dotyczy całego pobytu i grupy. Nie mnożymy jej przez osoby ani pokoje.
  Podatki, dopłaty i cena za noc są wyświetlane, jeśli dostawca je podał.
- Zdjęcia i współrzędne pochodzą z tego samego wyszukiwania; nie pobieramy
  osobnych szczegółów hotelu. Zdjęcia są wyświetlane z adresów dostawcy.
- Formularze i świeże wyniki pozostają w `sessionStorage` bieżącej karty.
  Cache mieści trzy wyszukiwania i wygasa najpóźniej 30 minut od wyceny;
  odczyt nie przedłuża TTL. F5 i nawigacja nie ponawiają świeżego wyszukiwania.
- Oferty, ceny, tokeny, zdjęcia i linki nie trafiają do SQLite. Po wyborze
  hotelu zapisany plan może zachować nazwę i współrzędne jako bazę zwiedzania,
  widoczną także publicznie. Wygaśnięcie wyceny nie usuwa tej bazy.
- Po wyborze noclegu mapa usuwa pozostałe oferty. Baza wpływa na szacowane
  dojście do atrakcji; [ograniczenia estymacji](wizard-verification.md).
- Puste lub nieczytelne wyniki pokazują informację o niedostępności partnerów
  i samodzielnym szukaniu. Poprawne oferty częściowej odpowiedzi są wyświetlane.

Backend ogranicza rozmiar odpowiedzi i czas odczytu, nie podąża za
przekierowaniami i dopuszcza jedno aktywne wyszukiwanie z co najmniej 6 s
pomiędzy startami. Nie wykonuje automatycznych ponowień. Wyceny są zwracane
z `Cache-Control: no-store`; poufne klucze nie trafiają do przeglądarki.

## Weryfikacja

Testy Java sprawdzają parser, walidację, limity, timeouty i błędne odpowiedzi.
`npm test` we frontendzie obejmuje formularz, linki, wygasanie, anulowanie
spóźnionych odpowiedzi oraz cache. Z katalogu `e2e/` uruchom:

```bash
npm run test:stays
```

Scenariusz używa prawdziwego frontendu, API i SQLite oraz kontrolowanych
ofert hotelowych. Sprawdza m.in. brak ponownego wyszukiwania po F5,
pokoje, zdjęcia, markery, wybór i usunięcie bazy oraz minimalny zapis planu.
Pełne przygotowanie opisuje [instrukcja testów](acceptance.md).

Testy nie gwarantują bieżącej dostępności ani cen OBO. Rezerwacja i płatność
odbywają się po przejściu na stronę dostawcy i nie są częścią aplikacji.
