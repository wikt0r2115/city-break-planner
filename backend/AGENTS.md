# Backend

- Realizuj logikę planowania i walidację po stronie serwera. Trzymaj kontrakt HTTP, reguły planowania, dostęp do SQLite i integracje zewnętrzne w osobnych częściach.
- Przy zmianie interfejsu porównaj kod z kontraktem REST. Zadbaj o walidację dat, konfigurację CORS i spójny format błędów.
- Dla porównań cen używaj jednej waluty i porównywalnej taryfy. Wynik z brakującymi składnikami nie może zostać uznany za najtańszy na podstawie częściowej sumy.
- Po zmianie powrotu zachowaj punkty wybrane przez użytkownika i oznacz te, które wypadają z harmonogramu. Uwzględnij czas przejazdów i godziny otwarcia.
- Przy zmianach zapisu sprawdź pełny CRUD i to, że odbiorca publicznego linku nie może edytować ani usunąć planu.
- W testach zewnętrznych dostawców używaj kontrolowanych odpowiedzi. Rzeczywisty odczyt sprawdzaj osobno na konkretnej trasie i dacie.
