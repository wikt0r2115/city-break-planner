package pl.citybreak.provider;

import java.math.BigDecimal;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.*;

/** Explicit opt-in fixture provider. Nothing in this class represents an actual offer or tariff. */
@Component
@ConditionalOnProperty(name = "app.data-mode", havingValue = "demo")
public class DemoTravelProvider implements TravelProvider {
    private static final ZoneId ZONE = ZoneId.of("Europe/Warsaw");
    private static final String SOURCE = "https://example.com/city-break-test-data";
    private final Clock clock;
    public DemoTravelProvider(Clock clock) { this.clock = clock; }
    @Override public Catalog search(Criteria criteria) {
        Source source = new Source("demo-fixtures", SOURCE, OffsetDateTime.now(clock), SourceStatus.OK,
                "DANE TESTOWE: wymyślone połączenia, ceny i atrakcje; nie są ofertą sprzedaży.");
        Place start = new Place(criteria.origin(), 52.23, 21.01);
        Place destination = new Place(criteria.destination(), 54.35, 18.65);
        List<Attraction> attractions = List.of(
                attraction(criteria, "demo-museum", "Muzeum — dane testowe", 90, "30.00", 9, 18, 54.351, 18.651, source),
                attraction(criteria, "demo-gallery", "Galeria — dane testowe", 60, "20.00", 10, 17, 54.355, 18.655, source),
                attraction(criteria, "demo-park", "Park — dane testowe", 45, "0.00", 8, 22, 54.36, 18.66, source));
        List<RoundTrip> options = List.of(
                trip(criteria, "demo-budget", start, destination, 7, 12, 18, 23, 2, "40.00", Mode.COACH),
                trip(criteria, "demo-fast", start, destination, 8, 9.5, 18, 19.5, 2, "100.00", Mode.PLANE),
                trip(criteria, "demo-direct", start, destination, 7, 11, 18, 22, 0, "70.00", Mode.TRAIN),
                trip(criteria, "demo-long", start, destination, 6, 9, 21, 24, 1, "90.00", Mode.TRAIN),
                trip(criteria, "demo-unknown", start, destination, 7, 10, 20, 23, 3, null, Mode.TRAIN),
                trip(criteria, "demo-early", start, destination, 8, 10, 14, 16, 1, "85.00", Mode.TRAIN));
        return new Catalog(options, attractions, List.of(source), SearchStatus.PARTIAL, true);
    }
    private RoundTrip trip(Criteria criteria, String id, Place origin, Place destination,
            double depart, double arrive, double back, double home, int transfers, String price, Mode mode) {
        Journey outbound = journey(id + "-out", origin, destination, at(criteria.departureDate(), depart), at(criteria.departureDate(), arrive), price, mode, transfers / 2);
        Journey returning = journey(id + "-return", destination, origin, at(criteria.returnDate(), back), at(criteria.returnDate(), home), price, mode, transfers - transfers / 2);
        long minutes = ChronoUnit.MINUTES.between(outbound.departureAt(), outbound.arrivalAt())
                + ChronoUnit.MINUTES.between(returning.departureAt(), returning.arrivalAt());
        return new RoundTrip(id, outbound, returning, minutes, transfers,
                ChronoUnit.MINUTES.between(outbound.arrivalAt(), returning.departureAt()), null, List.of());
    }
    private Journey journey(String id, Place origin, Place destination, OffsetDateTime depart,
            OffsetDateTime arrive, String price, Mode mode, int transfers) {
        List<Segment> segments = new ArrayList<>();
        int count = transfers + 1;
        long totalMinutes = ChronoUnit.MINUTES.between(depart, arrive);
        for (int i = 0; i < count; i++) {
            Place from = i == 0 ? origin : new Place("Przesiadka testowa " + i, null, null);
            Place to = i == count - 1 ? destination : new Place("Przesiadka testowa " + (i + 1), null, null);
            String segmentPrice = price == null ? null : new BigDecimal(price).divide(BigDecimal.valueOf(count), 2, java.math.RoundingMode.HALF_UP).toPlainString();
            if (price != null && i == count - 1)
                segmentPrice = new BigDecimal(price).subtract(new BigDecimal(segmentPrice).multiply(BigDecimal.valueOf(count - 1))).toPlainString();
            segments.add(new Segment(id + "-" + i, mode, "Przewoźnik testowy", from, to,
                    depart.plusMinutes(totalMinutes * i / count), depart.plusMinutes(totalMinutes * (i + 1) / count),
                    prices(segmentPrice), SOURCE, "https://www.openstreetmap.org/"));
        }
        return new Journey(depart, arrive, List.copyOf(segments));
    }
    private Attraction attraction(Criteria criteria, String id, String name, int minutes, String amount,
            int open, int close, double lat, double lon, Source source) {
        List<OpeningInterval> intervals = new ArrayList<>();
        for (LocalDate day = criteria.departureDate(); !day.isAfter(criteria.returnDate()) && !day.isAfter(criteria.departureDate().plusDays(30)); day = day.plusDays(1))
            intervals.add(new OpeningInterval(at(day, open), at(day, close)));
        if (criteria.returnDate().isAfter(criteria.departureDate().plusDays(30)))
            intervals.add(new OpeningInterval(at(criteria.returnDate(), open), at(criteria.returnDate(), close)));
        if (id.equals("demo-gallery")) {
            intervals.clear();
            intervals.add(new OpeningInterval(at(criteria.returnDate(), 15), at(criteria.returnDate(), 17)));
        }
        return new Attraction(id, name, new Place(name, lat, lon), minutes, prices(amount),
                new OpeningHours(OpeningStatus.KNOWN, List.copyOf(intervals)), List.of(source));
    }
    private List<Price> prices(String amount) {
        return List.of(price(amount, FareType.STANDARD), price(amount == null ? null
                : new BigDecimal(amount).multiply(new BigDecimal("0.50")).setScale(2).toPlainString(), FareType.REDUCED));
    }
    private Price price(String amount, FareType fareType) {
        return new Price(amount == null ? PriceStatus.UNKNOWN : PriceStatus.KNOWN, amount, "PLN", fareType,
                fareType == FareType.REDUCED ? "TEST: przykładowa ulga 50%; nie jest potwierdzoną taryfą." : null,
                "demo-fixtures", SOURCE, OffsetDateTime.now(clock), true,
                amount == null ? "TEST: cena niepotwierdzona." : null);
    }
    private static OffsetDateTime at(LocalDate date, double hour) {
        return date.atStartOfDay(ZONE).plusMinutes((long) (hour * 60)).toOffsetDateTime();
    }
    @Override public Integer transferMinutes(Place from, Place to) {
        if (from == null || to == null || from.latitude() == null || from.longitude() == null
                || to.latitude() == null || to.longitude() == null) return null;
        // Controlled test parameter, not a real routing estimate.
        return from.equals(to) ? 0 : 15;
    }
}
