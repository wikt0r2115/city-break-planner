package pl.citybreak.provider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import java.net.URI;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.*;
import pl.citybreak.model.PlaceNames;

/** Approved incremental coverage: ZTM Gdańsk line 100 and published attraction tariffs. */
@Component
@ConditionalOnProperty(name = "app.data-mode", havingValue = "live", matchIfMissing = true)
public class LiveGdanskProvider implements TravelProvider, AutoCloseable {
    public static final String API = "https://ckan2.multimediagdansk.pl/";
    public static final String SPAN = "https://ckan.multimediagdansk.pl/dataset/c24aa637-3619-4dc2-a171-a23eec8f2172/resource/9c3d6fed-5394-4ef1-b2c6-c8716999149c/download/stoptimesspan.json";
    public static final String FARE = "https://ztm.gda.pl/bilety/bilety-jednorazowe,a,3019";
    public static final String ELIGIBILITY = "https://ztm.gda.pl/bilety/przejazdy-ulgowe,a,9002";
    public static final String MUSEUM_PRICE = "https://www.muzeum1939.pl/wizyta/wizyta-miiws/bilety-i-cennik";
    public static final String MUSEUM_HOURS = "https://www.muzeum1939.pl/wizyta/wizyta-miiws/godziny-otwarcia";
    public static final String ECS_PRICE = "https://bilety.ecs.gda.pl/index/cennik.html";
    public static final String ECS_HOURS = "https://ecs.gda.pl/zaplanuj-wizyte/godziny-otwarcia/";
    private static final ZoneId ZONE = ZoneId.of("Europe/Warsaw");
    private static final PlaceCatalog PLACES = new PlaceCatalog(List.of(
            new PlaceSuggestion("Dworzec Główny", "Dworzec Główny, Gdańsk"),
            new PlaceSuggestion("Targ Rybny", "Targ Rybny, Gdańsk")), false);
    @FunctionalInterface public interface SourceFetcher { String get(URI uri) throws Exception; }
    public record Read(String url, String body, OffsetDateTime checkedAt, String error) {
        Source source(String id) { return new Source(id, url, checkedAt,
                error == null ? SourceStatus.OK : SourceStatus.PROVIDER_ERROR,
                error == null ? "Odczytano publiczne źródło podczas wyszukiwania." : "Nie udało się odczytać źródła: " + error,
                error == null ? null : "UPSTREAM_FAILURE"); }
    }
    private final Clock clock;
    private final ObjectMapper json;
    private final SourceFetcher fetcher;
    private final ExecutorService executor = Executors.newFixedThreadPool(12, task -> {
        Thread thread = new Thread(task, "public-source-reader"); thread.setDaemon(true); return thread;
    });

    @Autowired public LiveGdanskProvider(Clock clock, ObjectMapper json,
            @Value("${app.source-timeout-seconds:3}") int timeoutSeconds) {
        this(clock, json, new SourceHttpClient(timeoutSeconds));
    }
    public LiveGdanskProvider(Clock clock, ObjectMapper json, SourceFetcher fetcher) {
        this.clock = clock; this.json = json; this.fetcher = fetcher;
    }

    @Override public PlaceCatalog placeCatalog() { return PLACES; }

    @Override public Catalog search(Criteria criteria) {
        if (!supported(criteria.origin(), criteria.destination())) return new Catalog(List.of(), List.of(), List.of(
                new Source("approved-coverage", null, null, SourceStatus.NO_COVERAGE,
                        "Ten etap obejmuje wyłącznie Gdańsk: Dworzec Główny ↔ Targ Rybny (linia 100). Kolej, loty, autokary i pozostałe trasy wymagają doprecyzowania w dalszym etapie projektu.", "UNSUPPORTED_ROUTE")), SearchStatus.PARTIAL, false);
        Set<String> urls = new LinkedHashSet<>(List.of(SPAN, FARE, ELIGIBILITY, MUSEUM_PRICE, MUSEUM_HOURS, ECS_PRICE, ECS_HOURS));
        for (LocalDate day : Set.copyOf(List.of(criteria.departureDate(), criteria.returnDate()))) {
            urls.add(API + "stops?date=" + day);
            urls.add(API + "stopTimes?date=" + day + "&routeId=100");
        }
        Map<String, CompletableFuture<Read>> pending = new LinkedHashMap<>();
        urls.forEach(url -> pending.put(url, CompletableFuture.supplyAsync(() -> read(url), executor)));
        try { CompletableFuture.allOf(pending.values().toArray(CompletableFuture[]::new)).get(7, TimeUnit.SECONDS); }
        catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
        catch (ExecutionException | TimeoutException exception) { /* Completed sources still remain useful. */ }
        Map<String, Read> reads = new LinkedHashMap<>();
        pending.forEach((url, future) -> {
            Read completed = future.getNow(null);
            if (completed == null) {
                future.cancel(true);
                completed = new Read(url, null, null, "nie zakończono odczytu przed limitem wyszukiwania");
            }
            reads.put(url, completed);
        });
        List<Source> sources = new ArrayList<>();
        List<Attraction> attractions = new AttractionSources().read(criteria, reads, sources);
        Read span = reads.get(SPAN);
        sources.add(span.source("ztm-date-coverage"));
        if (span.error() != null) return new Catalog(List.of(), attractions, List.copyOf(sources), SearchStatus.PROVIDER_ERROR, false);
        try {
            JsonNode coverage = json.readTree(span.body()).path("stopTimesSpans");
            JsonNode agency = null;
            for (JsonNode item : coverage) if (item.path("agencyId").asInt() == 1) agency = item;
            if (agency == null) throw new IllegalArgumentException("Nie rozpoznano zakresu dat ZTM");
            LocalDate first = LocalDate.parse(agency.path("startDate").asText());
            LocalDate last = LocalDate.parse(agency.path("endDate").asText());
            if (criteria.departureDate().isBefore(first) || criteria.returnDate().isAfter(last)) {
                sources.add(new Source("ztm-requested-dates", SPAN, span.checkedAt(), SourceStatus.NO_COVERAGE,
                        "Żądane daty są poza opublikowanym zakresem " + first + "–" + last + ". To brak pokrycia, nie potwierdzony brak kursów.", "OUTSIDE_COVERAGE"));
                return new Catalog(List.of(), attractions, List.copyOf(sources), SearchStatus.PARTIAL, false);
            }
            List<Price> prices = new AttractionSources().transportPrices(reads.get(FARE), reads.get(ELIGIBILITY), sources);
            List<Journey> out = journeys(criteria.departureDate(), criteria.origin(), criteria.destination(), reads, prices, sources);
            List<Journey> back = journeys(criteria.returnDate(), criteria.destination(), criteria.origin(), reads, prices, sources);
            List<RoundTrip> options = new ArrayList<>();
            for (Journey outbound : out) for (Journey returning : back) {
                if (returning.departureAt().isBefore(outbound.arrivalAt())) continue;
                String id = outbound.segments().get(0).id() + "__" + returning.segments().get(0).id();
                options.add(new RoundTrip(id, outbound, returning,
                        ChronoUnit.MINUTES.between(outbound.departureAt(), outbound.arrivalAt()) + ChronoUnit.MINUTES.between(returning.departureAt(), returning.arrivalAt()),
                        0, ChronoUnit.MINUTES.between(outbound.arrivalAt(), returning.departureAt()), null, List.of()));
            }
            boolean incomplete = sources.stream().anyMatch(source -> source.status() != SourceStatus.OK);
            SearchStatus status = options.isEmpty() ? SearchStatus.NO_CONNECTION : incomplete ? SearchStatus.PARTIAL : SearchStatus.OK;
            return new Catalog(List.copyOf(options), attractions, List.copyOf(sources), status, false);
        } catch (Exception exception) {
            sources.add(new Source("ztm-schedule", API, OffsetDateTime.now(clock), SourceStatus.PROVIDER_ERROR,
                    "Nie udało się potwierdzić rozkładu: " + safeError(exception), "UPSTREAM_FAILURE"));
            return new Catalog(List.of(), attractions, List.copyOf(sources), SearchStatus.PROVIDER_ERROR, false);
        }
    }

    private List<Journey> journeys(LocalDate date, String origin, String destination, Map<String, Read> reads,
            List<Price> prices, List<Source> sources) throws Exception {
        Read stopsRead = reads.get(API + "stops?date=" + date);
        Read timesRead = reads.get(API + "stopTimes?date=" + date + "&routeId=100");
        sources.add(stopsRead.source("ztm-stops-" + date)); sources.add(timesRead.source("ztm-schedule-" + date));
        if (stopsRead.error() != null || timesRead.error() != null) throw new IllegalArgumentException("Odczyt przystanków lub rozkładu nie powiódł się");
        JsonNode stops = json.readTree(stopsRead.body()).path("stops");
        JsonNode rows = json.readTree(timesRead.body()).path("stopTimes");
        if (!stops.isArray() || !rows.isArray()) throw new IllegalArgumentException("Zmieniony format danych ZTM");
        Map<Integer, Place> places = new HashMap<>();
        for (JsonNode stop : stops) places.put(stop.path("stopId").asInt(), new Place(stop.path("stopName").asText(),
                stop.path("stopLat").isNumber() ? stop.path("stopLat").asDouble() : null,
                stop.path("stopLon").isNumber() ? stop.path("stopLon").asDouble() : null));
        if (places.values().stream().noneMatch(place -> normalize(place.name()).equals(normalize(origin)))
                || places.values().stream().noneMatch(place -> normalize(place.name()).equals(normalize(destination))))
            throw new IllegalArgumentException("Nie potwierdzono żądanych przystanków w słowniku");
        Map<String, List<JsonNode>> services = new TreeMap<>();
        for (JsonNode row : rows) {
            if (!row.path("routeId").isIntegralNumber() || !row.path("agencyId").isIntegralNumber() || !row.path("passenger").isBoolean()
                    || !row.path("nonpassenger").isIntegralNumber() || !row.path("date").isTextual() || !row.path("busServiceName").isTextual()
                    || row.path("busServiceName").asText().isBlank() || !row.path("order").isIntegralNumber() || !row.path("tripId").isIntegralNumber()
                    || !row.path("stopSequence").isIntegralNumber() || !row.path("stopId").isIntegralNumber())
                throw new IllegalArgumentException("Niekompletny rekord rozkładu");
            if (!row.path("date").asText().equals(date.toString()) || row.path("routeId").asInt() != 100
                    || row.path("agencyId").asInt() != 1)
                throw new IllegalArgumentException("Odpowiedź rozkładu nie dotyczy żądanej daty lub linii");
            if (!row.path("passenger").asBoolean() || row.path("nonpassenger").asInt() != 0) continue;
            String key = row.path("busServiceName").asText() + "-" + String.format("%04d-%04d", row.path("order").asInt(), row.path("tripId").asInt());
            services.computeIfAbsent(key, ignored -> new ArrayList<>()).add(row);
        }
        List<Journey> result = new ArrayList<>();
        for (var service : services.entrySet()) {
            service.getValue().sort(Comparator.comparingInt(row -> row.path("stopSequence").asInt()));
            JsonNode from = null;
            OffsetDateTime previous = null, departure = null;
            for (JsonNode row : service.getValue()) {
                Place place = places.get(row.path("stopId").asInt());
                if (place == null) throw new IllegalArgumentException("Brak przystanku w słowniku");
                OffsetDateTime arrival = exportedTime(date, row.path("arrivalTime").asText(), previous);
                OffsetDateTime depart = exportedTime(date, row.path("departureTime").asText(), arrival);
                previous = depart;
                if (from == null && normalize(place.name()).equals(normalize(origin))) { from = row; departure = depart; }
                else if (from != null && normalize(place.name()).equals(normalize(destination))) {
                    String id = "ztm100-" + date + "-" + service.getKey() + "-" + from.path("stopId").asInt() + "-" + row.path("stopId").asInt();
                    Place start = places.get(from.path("stopId").asInt());
                    String map = start.latitude() == null || start.longitude() == null || place.latitude() == null || place.longitude() == null ? null
                            : "https://www.google.com/maps/dir/?api=1&origin=" + start.latitude() + "%2C" + start.longitude()
                            + "&destination=" + place.latitude() + "%2C" + place.longitude() + "&travelmode=transit";
                    Segment segment = new Segment(id, Mode.LOCAL_TRANSIT, "ZTM Gdańsk — linia 100", start, place,
                            departure, arrival, prices, FARE, map);
                    result.add(new Journey(departure, arrival, List.of(segment)));
                    break;
                }
            }
        }
        result.sort(Comparator.comparing(Journey::departureAt));
        return List.copyOf(result);
    }

    static OffsetDateTime exportedTime(LocalDate day, String value, OffsetDateTime notBefore) {
        LocalDateTime exported = LocalDateTime.parse(value);
        LocalDate anchor = LocalDate.of(1899, 12, 30);
        long offset = ChronoUnit.DAYS.between(anchor, exported.toLocalDate());
        if (offset < 0 || offset > 2) throw new IllegalArgumentException("Nieznany format czasu rozkładu");
        OffsetDateTime result = day.plusDays(offset).atTime(exported.toLocalTime()).atZone(ZONE).toOffsetDateTime();
        while (notBefore != null && result.isBefore(notBefore)) {
            result = result.toLocalDate().plusDays(1).atTime(exported.toLocalTime()).atZone(ZONE).toOffsetDateTime();
            if (result.toLocalDate().isAfter(day.plusDays(2))) throw new IllegalArgumentException("Nieprawidłowa kolejność czasów kursu");
        }
        return result;
    }
    static String normalize(String value) {
        return PlaceNames.normalize(value).replaceFirst("^gdansk ", "").replaceFirst(" gdansk$", "");
    }
    static boolean supported(String from, String to) {
        String start = normalize(from);
        String end = normalize(to);
        return !start.equals(end) && isCoveredStop(start) && isCoveredStop(end);
    }
    private static boolean isCoveredStop(String normalizedName) {
        return PLACES.places().stream().anyMatch(place -> normalize(place.value()).equals(normalizedName));
    }
    private Read read(String url) {
        try { return new Read(url, fetcher.get(URI.create(url)), OffsetDateTime.now(clock), null); }
        catch (Exception exception) { if (exception instanceof InterruptedException) Thread.currentThread().interrupt(); return new Read(url, null, OffsetDateTime.now(clock), safeError(exception)); }
    }
    private static String safeError(Exception exception) {
        return exception instanceof java.io.IOException && exception.getMessage() != null && exception.getMessage().startsWith("HTTP ")
                ? exception.getMessage() : "niedostępne lub niezgodne dane źródła";
    }
    @Override public Integer transferMinutes(Place from, Place to) { return from != null && from.equals(to) ? 0 : null; }
    @Override @PreDestroy public void close() { executor.shutdownNow(); }
}
