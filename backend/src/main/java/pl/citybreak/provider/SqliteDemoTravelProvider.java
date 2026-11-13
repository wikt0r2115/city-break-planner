package pl.citybreak.provider;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.*;
import pl.citybreak.model.PlaceNames;
import pl.citybreak.persistence.DemoCatalog;
import pl.citybreak.persistence.DemoCatalog.City;
import pl.citybreak.persistence.DemoCatalog.Leg;
import pl.citybreak.persistence.DemoCatalog.Visit;

@Component
@ConditionalOnProperty(name = "app.data-mode", havingValue = "demo", matchIfMissing = true)
public final class SqliteDemoTravelProvider implements TravelProvider {
    private static final Source SOURCE = new Source("demo-sqlite", null, null, SourceStatus.OK,
            "Dane demonstracyjne. Godziny i ceny są przykładowe.");
    private static final Map<String, String> ALIASES = Map.of("london", "londyn", "paris", "paryz");
    private static final Duration MAX_DEMO_STAY = Duration.ofDays(30);
    private final DemoCatalog catalog;

    public SqliteDemoTravelProvider(DemoCatalog catalog) { this.catalog = catalog; }

    @Override public PlaceCatalog placeCatalog() {
        return new PlaceCatalog(catalog.cities().stream().map(city -> city.place().name())
                .map(name -> new PlaceSuggestion(name, name)).toList(), true);
    }

    @Override public Criteria canonicalCriteria(Criteria criteria) {
        List<City> cities = catalog.cities();
        City origin = city(cities, criteria.origin());
        City destination = city(cities, criteria.destination());
        if (origin == null || destination == null) return criteria;
        return new Criteria(origin.place().name(), destination.place().name(), criteria.departureDate(),
                criteria.returnDate(), criteria.priority(), criteria.currency(), criteria.fareType());
    }

    @Override public Catalog search(Criteria criteria) {
        List<City> cities = catalog.cities();
        City origin = city(cities, criteria.origin());
        City destination = city(cities, criteria.destination());
        if (origin == null || destination == null || origin.id().equals(destination.id())) {
            var missing = new Source(SOURCE.sourceId(), null, null, SourceStatus.NO_COVERAGE,
                    "Wybierz dwa różne miasta spośród Londynu, Paryża i Amsterdamu.", "UNSUPPORTED_ROUTE");
            return new Catalog(List.of(), List.of(), List.of(missing), SearchStatus.PARTIAL, true);
        }
        Map<String, List<Leg>> trips = new LinkedHashMap<>();
        for (Leg leg : catalog.legs(origin.id(), destination.id())) {
            trips.computeIfAbsent(leg.tripId(), key -> new ArrayList<>()).add(leg);
        }
        List<RoundTrip> options = new ArrayList<>();
        for (var trip : trips.entrySet()) {
            Journey out = journey(trip.getValue(), 0, criteria.departureDate());
            Journey back = journey(trip.getValue(), 1, criteria.returnDate());
            if (!back.departureAt().isAfter(out.arrivalAt())) continue;
            options.add(new RoundTrip(trip.getKey(), out, back,
                    minutes(out.departureAt(), out.arrivalAt()) + minutes(back.departureAt(), back.arrivalAt()),
                    transfers(out) + transfers(back), minutes(out.arrivalAt(), back.departureAt()), null, List.of()));
        }
        List<Visit> visits = catalog.visits(destination.id());
        List<Attraction> attractions = visits.stream().map(visit -> attraction(visit, criteria)).toList();
        Map<String, Interest> interests = visits.stream().collect(Collectors.toUnmodifiableMap(Visit::id, Visit::category));
        return new Catalog(List.copyOf(options), attractions, List.of(SOURCE),
                options.isEmpty() ? SearchStatus.NO_CONNECTION : SearchStatus.OK, true, interests);
    }

    private static City city(List<City> cities, String value) {
        String normalized = PlaceNames.normalize(value);
        String name = ALIASES.getOrDefault(normalized, normalized);
        return cities.stream().filter(city -> PlaceNames.normalize(city.place().name()).equals(name)).findFirst().orElse(null);
    }

    private static Journey journey(List<Leg> legs, int direction, LocalDate date) {
        List<Segment> segments = legs.stream().filter(leg -> leg.direction() == direction).map(leg -> {
            Place from = leg.origin();
            Place to = leg.destination();
            var starts = at(date.plusDays(leg.departureDay()), leg.departure(), from);
            var ends = at(date.plusDays(leg.arrivalDay()), leg.arrival(), to);
            String id = leg.tripId() + "-" + direction + "-" + leg.position();
            return new Segment(id, leg.mode(), leg.operator(), from, to, starts, ends,
                    prices(leg.normalPln(), leg.reducedPln()), leg.operatorUrl(), map(from, to));
        }).toList();
        return new Journey(segments.get(0).departureAt(), segments.get(segments.size() - 1).arrivalAt(), segments);
    }

    private static Attraction attraction(Visit visit, Criteria criteria) {
        List<OpeningInterval> intervals = new ArrayList<>();
        LocalDate limit = criteria.departureDate().plusDays(MAX_DEMO_STAY.toDays());
        for (LocalDate day = criteria.departureDate(); !day.isAfter(criteria.returnDate()) && !day.isAfter(limit);
                day = day.plusDays(1)) {
            intervals.add(opening(visit, day));
        }
        if (criteria.returnDate().isAfter(limit)) intervals.add(opening(visit, criteria.returnDate()));
        return new Attraction(visit.id(), visit.place().name(), visit.place(), visit.minutes(),
                prices(visit.normalPln(), visit.reducedPln()), new OpeningHours(OpeningStatus.KNOWN, List.copyOf(intervals)),
                List.of(SOURCE));
    }

    private static OpeningInterval opening(Visit visit, LocalDate date) {
        return new OpeningInterval(at(date, visit.opens(), visit.place()), at(date, visit.closes(), visit.place()));
    }

    private static OffsetDateTime at(LocalDate day, LocalTime time, Place place) {
        return day.atTime(time).atZone(ZoneId.of(place.timeZone())).toOffsetDateTime();
    }

    private static int transfers(Journey journey) {
        return Math.max(0, (int) journey.segments().stream().filter(segment -> segment.mode() != Mode.WALK).count() - 1);
    }

    private static long minutes(OffsetDateTime from, OffsetDateTime to) { return Duration.between(from, to).toMinutes(); }

    private static List<Price> prices(int normal, int reduced) {
        return List.of(price(normal, FareType.STANDARD), price(reduced, FareType.REDUCED));
    }

    private static Price price(int amount, FareType type) {
        return new Price(PriceStatus.KNOWN, amount + ".00", "PLN", type, null, SOURCE.sourceId(), null, null, true, null);
    }

    private static String map(Place from, Place to) {
        return "https://www.google.com/maps/dir/?api=1&origin=" + from.latitude() + "%2C" + from.longitude()
                + "&destination=" + to.latitude() + "%2C" + to.longitude();
    }

    @Override public Integer transferMinutes(Place from, Place to) {
        if (from == null || to == null || from.latitude() == null || from.longitude() == null
                || to.latitude() == null || to.longitude() == null) return null;
        if (from.equals(to)) return 0;
        double north = (to.latitude() - from.latitude()) * 111;
        double east = (to.longitude() - from.longitude()) * 111 * Math.cos(Math.toRadians(from.latitude()));
        return 8 + (int) Math.ceil(Math.hypot(north, east) * 4);
    }
}
