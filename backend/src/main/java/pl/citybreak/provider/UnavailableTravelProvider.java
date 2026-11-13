package pl.citybreak.provider;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.*;

@Component
@ConditionalOnProperty(name = "app.data-mode", havingValue = "unavailable")
public class UnavailableTravelProvider implements TravelProvider {
    private final Clock clock;
    public UnavailableTravelProvider(Clock clock) { this.clock = clock; }
    @Override public PlaceCatalog placeCatalog() { return new PlaceCatalog(List.of(), false); }
    @Override public Catalog search(Criteria criteria) {
        Source source = new Source("unconfigured", null, OffsetDateTime.now(clock), SourceStatus.PROVIDER_ERROR,
                "Nie skonfigurowano zweryfikowanych źródeł ofert. To brak danych, nie potwierdzony brak połączeń.");
        return new Catalog(List.of(), List.of(), List.of(source), SearchStatus.PROVIDER_ERROR, false);
    }
    @Override public Integer transferMinutes(Place from, Place to) { return null; }
}
