package pl.citybreak.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.*;

@Component
public class InputValidation {
    private final Clock clock;
    public InputValidation(Clock clock) { this.clock = clock; }
    public void criteria(Criteria criteria) {
        List<FieldError> errors = new ArrayList<>();
        if (criteria == null) {
            fail(List.of(new FieldError("criteria", "Podaj kryteria podróży.")));
            return;
        }
        if (blank(criteria.origin()) || criteria.origin().length() > 120)
            errors.add(new FieldError("origin", "Podaj miejsce startu (maksymalnie 120 znaków)."));
        if (blank(criteria.destination()) || criteria.destination().length() > 120)
            errors.add(new FieldError("destination", "Podaj cel (maksymalnie 120 znaków)."));
        if (!blank(criteria.origin()) && !blank(criteria.destination())
                && criteria.origin().strip().equalsIgnoreCase(criteria.destination().strip()))
            errors.add(new FieldError("destination", "Cel musi różnić się od miejsca startu."));
        if (criteria.departureDate() == null)
            errors.add(new FieldError("departureDate", "Podaj datę wyjazdu."));
        else if (criteria.departureDate().isBefore(LocalDate.now(clock.withZone(ZoneId.of("Europe/Warsaw")))))
            errors.add(new FieldError("departureDate", "Wyjazd nie może być w przeszłości."));
        if (criteria.returnDate() == null)
            errors.add(new FieldError("returnDate", "Podaj datę powrotu."));
        else if (criteria.departureDate() != null && criteria.returnDate().isBefore(criteria.departureDate()))
            errors.add(new FieldError("returnDate", "Powrót nie może poprzedzać wyjazdu."));
        if (criteria.priority() == null) errors.add(new FieldError("priority", "Wybierz jeden priorytet."));
        if (!"PLN".equals(criteria.currency())) errors.add(new FieldError("currency", "Obsługiwana waluta porównania to PLN."));
        if (criteria.fareType() == null) errors.add(new FieldError("fareType", "Wybierz taryfę."));
        if (!errors.isEmpty()) fail(errors);
    }
    public void plan(PlanInput input) {
        if (input == null) fail(List.of(new FieldError("plan", "Podaj plan.")));
        criteria(input.criteria());
        List<FieldError> errors = new ArrayList<>();
        if (input.selectedRoundTrip() == null || blank(input.selectedRoundTrip().id()))
            errors.add(new FieldError("selectedRoundTrip", "Wybierz wariant podróży."));
        if (input.items() == null) errors.add(new FieldError("items", "Podaj listę punktów planu."));
        else if (input.items().size() > 100) errors.add(new FieldError("items", "Plan może zawierać maksymalnie 100 punktów."));
        else {
            var ids = new HashSet<String>();
            for (int i = 0; i < input.items().size(); i++) {
                ItemInput item = input.items().get(i);
                String field = "items[" + i + "]";
                if (item == null) { errors.add(new FieldError(field, "Punkt nie może być pusty.")); continue; }
                if (blank(item.id()) || item.id().length() > 100 || !ids.add(item.id()))
                    errors.add(new FieldError(field + ".id", "Podaj unikatowy identyfikator punktu (maksymalnie 100 znaków)."));
                if (blank(item.attractionId())) errors.add(new FieldError(field + ".attractionId", "Wybierz atrakcję."));
                if (item.visitMinutes() == null || item.visitMinutes() < 1 || item.visitMinutes() > 1440)
                    errors.add(new FieldError(field + ".visitMinutes", "Wizyta musi trwać od 1 do 1440 minut."));
            }
        }
        if (!errors.isEmpty()) fail(errors);
    }
    private static boolean blank(String value) { return value == null || value.isBlank(); }
    private static void fail(List<FieldError> errors) { throw new ApiException(400, "Popraw wskazane pola.", errors); }
}
