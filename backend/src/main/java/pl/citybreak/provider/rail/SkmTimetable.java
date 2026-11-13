package pl.citybreak.provider.rail;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.*;
import pl.citybreak.model.PlaceNames;
import pl.citybreak.provider.TravelProvider.Catalog;

/** Date-specific direct trains from the official PKP SKM timetable. */
@Component
public final class SkmTimetable {
    public static final String SOURCE_ID = "skm-gtfs";
    public static final String PUBLICATION_ID = "skm-feed-published";
    public static final String SOURCE_URL = "https://bip.skm.pkp.pl/otwarte-dane";
    private static final String OPERATOR = "PKP Szybka Kolej Miejska w Trójmieście Sp. z o.o.";
    private static final String BOOKING_URL = "https://bilety.skm.pkp.pl/";
    private static final LocalTime PUBLISH_BY = LocalTime.of(4, 0);
    private static final Duration RETRY_INTERVAL = Duration.ofMinutes(2);
    private static final int MAX_DIRECT_JOURNEYS = 256;

    private record Station(String id, String name, String cityAlias) {}
    private static final Station GDANSK = new Station("7500", "Gdańsk Główny", "Gdańsk");
    private static final Station GDYNIA = new Station("5900", "Gdynia Główna", "Gdynia");
    private static final Station WEJHEROWO = new Station("6304", "Wejherowo", "Wejherowo");
    private static final List<Station> STATIONS = List.of(GDANSK, GDYNIA, WEJHEROWO);
    private static final Map<String, String> STOP_NAMES = Map.of(GDANSK.id(), GDANSK.name(),
            GDYNIA.id(), GDYNIA.name(), WEJHEROWO.id(), WEJHEROWO.name());
    private static final PlaceCatalog PLACES = new PlaceCatalog(STATIONS.stream()
            .map(station -> new PlaceSuggestion(station.name(), station.name())).toList(), false);

    @FunctionalInterface interface Fetcher { SkmFeedClient.Download fetch() throws IOException, InterruptedException; }
    private record Snapshot(LocalDate publicationDay, OffsetDateTime checkedAt, SkmGtfs timetable) {}

    private final Clock clock;
    private final Fetcher fetcher;
    private Snapshot snapshot;
    private Instant retryAfter = Instant.MIN;

    @Autowired public SkmTimetable(Clock clock) { this(clock, new SkmFeedClient()::download); }

    SkmTimetable(Clock clock, Fetcher fetcher) {
        this.clock = clock;
        this.fetcher = fetcher;
    }

    public PlaceCatalog places() { return PLACES; }

    public String canonicalPlace(String value) {
        Station station = station(value);
        return station == null ? null : station.name();
    }

    public boolean supports(String origin, String destination) {
        return supports(station(origin), station(destination));
    }

    public Catalog search(Criteria criteria) {
        Station origin = station(criteria.origin());
        Station destination = station(criteria.destination());
        if (!supports(origin, destination)) {
            return unavailable(SearchStatus.PARTIAL, SourceStatus.NO_COVERAGE, "UNSUPPORTED_ROUTE",
                    "Pilotaż kolejowy obejmuje Gdańsk Główny ↔ Gdynia Główna i Gdańsk Główny ↔ Wejherowo.");
        }
        Snapshot current;
        try {
            current = currentSnapshot();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return readFailure();
        } catch (IOException | IllegalArgumentException | DateTimeException exception) {
            return readFailure();
        }
        SkmGtfs feed = current.timetable();
        var publication = new Source(PUBLICATION_ID, SOURCE_URL, feed.publishedAt(), SourceStatus.OK,
                "Data publikacji rozkładu „Otwarte dane” PKP SKM.");
        if (!feed.covers(criteria.departureDate()) || !feed.covers(criteria.returnDate())) {
            var coverage = new Source(SOURCE_ID, SOURCE_URL, current.checkedAt(), SourceStatus.NO_COVERAGE,
                    "Opublikowany zakres rozkładu PKP SKM to " + feed.firstDate() + " – " + feed.lastDate() + ".",
                    "OUTSIDE_COVERAGE");
            return new Catalog(List.of(), List.of(), List.of(coverage, publication), SearchStatus.PARTIAL, false);
        }

        List<Journey> outbound = journeys(feed, origin, destination, criteria.departureDate());
        List<Journey> inbound = journeys(feed, destination, origin, criteria.returnDate());
        if (outbound.size() > MAX_DIRECT_JOURNEYS || inbound.size() > MAX_DIRECT_JOURNEYS) return readFailure();
        var options = new ArrayList<RoundTrip>();
        for (Journey out : outbound) {
            for (Journey back : inbound) {
                if (back.departureAt().isBefore(out.arrivalAt())) continue;
                String id = out.segments().get(0).id() + "__" + back.segments().get(0).id();
                long travel = minutes(out.departureAt(), out.arrivalAt()) + minutes(back.departureAt(), back.arrivalAt());
                options.add(new RoundTrip(id, out, back, travel, 0, minutes(out.arrivalAt(), back.departureAt()), null, List.of()));
            }
        }
        if (options.isEmpty()) {
            var missing = new Source(SOURCE_ID, SOURCE_URL, current.checkedAt(), SourceStatus.NO_CONNECTION,
                    "Opublikowany rozkład PKP SKM nie zawiera zgodnej pary bezpośrednich kursów dla wybranych dat.");
            return new Catalog(List.of(), List.of(), List.of(missing, publication), SearchStatus.NO_CONNECTION, false);
        }
        var schedule = new Source(SOURCE_ID, SOURCE_URL, current.checkedAt(), SourceStatus.OK,
                OPERATOR + " — planowy rozkład, zasięg " + feed.firstDate() + " – " + feed.lastDate() + ".",
                "PLANNED_TIMETABLE");
        return new Catalog(List.copyOf(options), List.of(), List.of(schedule, publication), SearchStatus.PARTIAL, false);
    }

    private synchronized Snapshot currentSnapshot() throws IOException, InterruptedException {
        var now = clock.instant().atZone(SkmGtfs.WARSAW);
        boolean beforeUpdate = now.toLocalTime().isBefore(PUBLISH_BY);
        LocalDate publicationDay = beforeUpdate ? now.toLocalDate().minusDays(1) : now.toLocalDate();
        if (snapshot != null && !snapshot.publicationDay().isBefore(publicationDay)) return snapshot;
        if (now.toInstant().isBefore(retryAfter)) throw new IOException("SKM feed not ready");
        retryAfter = now.toInstant().plus(RETRY_INTERVAL);
        SkmGtfs timetable = SkmGtfs.read(fetcher.fetch(), STOP_NAMES);
        var checkedAt = clock.instant().atZone(SkmGtfs.WARSAW).toOffsetDateTime();
        LocalDate archiveDay = timetable.publishedAt().atZoneSameInstant(SkmGtfs.WARSAW).toLocalDate();
        if (archiveDay.isBefore(publicationDay) || timetable.publishedAt().isAfter(checkedAt))
            throw new IOException("SKM archive publication timestamp is outside the expected range");
        snapshot = new Snapshot(archiveDay, checkedAt, timetable);
        return snapshot;
    }

    private static List<Journey> journeys(SkmGtfs feed, Station origin, Station destination, LocalDate departureDay) {
        var journeys = new LinkedHashMap<String, Journey>();
        for (LocalDate serviceDay : List.of(departureDay.minusDays(1), departureDay, departureDay.plusDays(1))) {
            for (SkmGtfs.Trip trip : feed.trips()) {
                if (!feed.runsOn(trip, serviceDay)) continue;
                OffsetDateTime start = null;
                for (SkmGtfs.Call call : trip.calls()) {
                    if (call.stop().equals(origin.id()) && call.pickup() && call.departure() != null) {
                        var departure = SkmGtfs.time(serviceDay, call.departure());
                        if (departure.toLocalDate().equals(departureDay)) start = departure;
                    }
                    if (start != null && call.stop().equals(destination.id()) && call.dropOff() && call.arrival() != null) {
                        var arrival = SkmGtfs.time(serviceDay, call.arrival());
                        if (!arrival.isAfter(start)) continue;
                        String number = HexFormat.of().formatHex(trip.number().getBytes(StandardCharsets.UTF_8));
                        String id = "skm-" + number + "-" + start.toEpochSecond() + "-" + arrival.toEpochSecond() + "-" + origin.id() + "-" + destination.id();
                        Place from = feed.place(origin.id());
                        Place to = feed.place(destination.id());
                        var segment = new Segment(id, Mode.TRAIN, OPERATOR, from, to, start, arrival, List.of(), BOOKING_URL, mapUrl(from, to));
                        journeys.putIfAbsent(id, new Journey(start, arrival, List.of(segment)));
                        break;
                    }
                }
            }
        }
        return journeys.values().stream().sorted(Comparator.comparing(Journey::departureAt).thenComparing(Journey::arrivalAt)
                .thenComparing(journey -> journey.segments().get(0).id())).toList();
    }

    private static Station station(String value) {
        if (value == null) return null;
        String name = PlaceNames.normalize(value);
        return STATIONS.stream().filter(station -> name.equals(PlaceNames.normalize(station.name()))
                || name.equals(PlaceNames.normalize(station.cityAlias()))).findFirst().orElse(null);
    }

    private static boolean supports(Station origin, Station destination) {
        return origin != null && destination != null && (origin == GDANSK) != (destination == GDANSK);
    }

    private static long minutes(OffsetDateTime start, OffsetDateTime end) { return Duration.between(start, end).toMinutes(); }

    private static String mapUrl(Place origin, Place destination) {
        if (origin.latitude() == null || origin.longitude() == null || destination.latitude() == null || destination.longitude() == null) return null;
        return "https://www.google.com/maps/dir/?api=1&origin=" + origin.latitude() + "%2C" + origin.longitude()
                + "&destination=" + destination.latitude() + "%2C" + destination.longitude() + "&travelmode=transit";
    }

    private Catalog readFailure() {
        return unavailable(SearchStatus.PROVIDER_ERROR, SourceStatus.PROVIDER_ERROR, "UPSTREAM_FAILURE",
                "Nie udało się potwierdzić aktualnego rozkładu PKP SKM.");
    }

    private Catalog unavailable(SearchStatus status, SourceStatus sourceStatus, String code, String message) {
        var source = new Source(SOURCE_ID, SOURCE_URL, OffsetDateTime.now(clock), sourceStatus, message, code);
        return new Catalog(List.of(), List.of(), List.of(source), status, false);
    }
}
