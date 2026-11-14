package pl.citybreak.stay;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.FieldError;
import pl.citybreak.service.ApiException;
import pl.citybreak.stay.StayModels.Criteria;

@Component
public final class StayValidation {
    private static final Set<String> CURRENCIES = Set.of("PLN", "EUR", "USD", "GBP");
    private final Clock clock;
    public StayValidation(Clock clock) { this.clock = clock; }

    public Criteria validate(Criteria input) {
        if (input == null) throw new ApiException(400, "Podaj kryteria noclegu.", List.of(new FieldError("body", "Podaj kryteria noclegu.")));
        var errors = new ArrayList<FieldError>();
        if (input.destination() == null || input.destination().isBlank() || input.destination().length() > 120
                || input.destination().chars().anyMatch(Character::isISOControl))
            errors.add(new FieldError("destination", "Podaj miasto (maksymalnie 120 znaków)."));
        LocalDate today = LocalDate.now(clock.withZone(ZoneId.of("Europe/Warsaw")));
        if (input.checkIn() == null || input.checkIn().isBefore(today.plusDays(1)) || input.checkIn().isAfter(today.plusDays(400)))
            errors.add(new FieldError("checkIn", "Wybierz przyjazd od jutra do 400 dni od dziś."));
        if (input.checkOut() == null || input.checkIn() != null
                && (!input.checkOut().isAfter(input.checkIn()) || ChronoUnit.DAYS.between(input.checkIn(), input.checkOut()) > 30))
            errors.add(new FieldError("checkOut", "Wyjazd musi przypadać po przyjeździe, maksymalnie po 30 nocach."));
        if (input.adults() == null || input.adults() < 1 || input.adults() > 8)
            errors.add(new FieldError("adults", "Wybierz od 1 do 8 dorosłych."));
        if (input.rooms() < 1 || input.rooms() > 8 || input.adults() != null && input.rooms() > input.adults())
            errors.add(new FieldError("rooms", "Wybierz od 1 do 8 pokoi, nie więcej niż liczba dorosłych."));
        if (input.currency() == null || !CURRENCIES.contains(input.currency()))
            errors.add(new FieldError("currency", "Wybierz PLN, EUR, USD albo GBP."));
        if (!errors.isEmpty()) throw new ApiException(400, "Popraw wskazane pola noclegu.", errors);
        return new Criteria(input.destination().strip(), input.checkIn(), input.checkOut(), input.adults(), input.currency(), input.rooms());
    }
}
