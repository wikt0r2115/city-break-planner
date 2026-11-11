# City Break Planner — instrukcje dla agentów

## Produkt

Budujemy responsywny planer city breaków dla studentów. Użytkownik podaje miejsce startu, cel i daty, a następnie wybiera jeden priorytet: łączny koszt przejazdów i wstępu, czas dojazdu, liczbę przesiadek albo czas na miejscu. Plan łączy transport z sugestiami zwiedzania. Po zmianie powrotu oznacz punkty, które przestały mieścić się w harmonogramie, i podaj powód. Użytkownik sam decyduje, jak zmienić plan.

## Struktura

- `backend/` — Java, Spring Boot, SQLite, API REST i logika planera.
- `frontend/` — React, TypeScript, Vite oraz widoki na telefon i desktop.
- `docs/api-contract.md` — planowana lokalizacja kontraktu REST. Utwórz go w SOL-114 i utrzymuj razem z kodem.

## Praca ze zgłoszeniami

- Przed zmianami przeczytaj ticket w Linearze, jego kryteria akceptacji i zależności. Przy braku dostępu poproś o treść zgłoszenia.
- Zaczynaj niezależne zadania z tej samej, aktualnej gałęzi bazowej. Przy pracach równoległych używaj osobnych gałęzi lub worktrees.
- Zmieniaj pliki potrzebne do realizacji ticketu. Zmiany wspólnego kontraktu uzgadniaj z koordynatorem przed modyfikacją obu stron.
- Decyzje o funkcjach, obsługiwanych trasach i ewentualnym ograniczeniu zasięgu należą do właściciela projektu.

## Dane i dostęp

- Sprawdzaj ceny podczas wyszukiwania. Podawaj źródło, walutę i czas sprawdzenia. Pokazuj taryfę normalną i ulgową, gdy źródło je potwierdza.
- Rozróżniaj potwierdzony brak połączenia, brak ceny i błąd dostawcy. Przykłady testowe oznaczaj jawnie.
- Przechowuj klucze dostawców po stronie serwera, poza repozytorium. W dokumentacji podawaj nazwy zmiennych i wartości przykładowe.
- Zapisany plan można udostępnić do odczytu. Prawo do edycji i usunięcia sprawdzaj po stronie API.

## Weryfikacja

- Backend: `cd backend`, `./mvnw spring-boot:run`; testy `./mvnw test`, budowanie `./mvnw package`. Wymagane JDK 17–25.
- Frontend: `cd frontend`, `npm ci`, `npm run dev`; testy `npm test`, budowanie `npm run build`. Wymagane Node 22.22.2+ (linia 22), npm 10.
- Sprawdzenie komunikacji: otwórz `http://localhost:5173`; health API to `GET http://127.0.0.1:8080/api/v1/health` i rzeczywisty odczyt SQLite.
- Konfiguracja: `backend/.env.example` oraz `frontend/.env.example`; Spring wymaga wyeksportowanych zmiennych, Vite wczytuje `.env.local`. Sekrety nigdy nie trafiają do `VITE_*`.
- `backend/` odpowiada za API i dane, `frontend/` za widoki; `docs/api-contract.md` jest wspólną umową, a jej zmiany uzgadnia koordynator.

- Ustal i sprawdź faktyczne polecenia uruchomienia i testów w SOL-114. Zapisz je w README.
- Uruchom testy dotyczące zmienionego zachowania. Zmiany kontraktu sprawdź przez frontend i API.
- W podsumowaniu podaj identyfikator zgłoszenia, zmienione obszary, wykonane komendy, wyniki i otwarte problemy.
