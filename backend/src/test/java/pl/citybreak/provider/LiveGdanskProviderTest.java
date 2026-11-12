package pl.citybreak.provider;

import static org.assertj.core.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import pl.citybreak.model.Model.*;
import pl.citybreak.planning.Planner;
import pl.citybreak.service.*;

class LiveGdanskProviderTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-11T12:00:00Z"), ZoneOffset.UTC);
    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    private final Map<String, Reply> fixtures = new ConcurrentHashMap<>();
    private final AtomicInteger requests = new AtomicInteger();
    private HttpServer server;
    private LiveGdanskProvider provider;
    private record Reply(int status, String body) {}
    @BeforeEach void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool(task -> { var thread = new Thread(task); thread.setDaemon(true); return thread; }));
        server.createContext("/", exchange -> {
            requests.incrementAndGet();
            Reply reply = fixtures.getOrDefault(exchange.getRequestURI().toString(), new Reply(404, "not in fixture coverage"));
            byte[] body = reply.body().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(reply.status(), body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        server.start();
        var http = new SourceHttpClient(2);
        provider = new LiveGdanskProvider(CLOCK, json, uri -> http.get(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + key(uri))));
        put(LiveGdanskProvider.SPAN, "{\"stopTimesSpans\":[{\"agencyId\":1,\"startDate\":\"2026-11-11\",\"endDate\":\"2026-11-23\"}]}");
        put(LiveGdanskProvider.FARE, "<table><tr><th>pełnopłatne</th><th>ulgowe</th></tr><tr><td><p>na jeden przejazd</p><p>75 - minutowy</p></td><td><p>4,80</p><p>6,00</p></td><td><p>2,40</p><p>3,00</p></td></tr></table>");
        put(LiveGdanskProvider.ELIGIBILITY, "<table><tr><td>studenci szkół wyższych bez względu na wiek</td><td>legitymacja studencka</td></tr></table>");
        put(LiveGdanskProvider.ECS_PRICE, "WYSTAWA STAŁA BILET NORMALNY | 40 zł BILET ULGOWY | 35 zł Studentkom i studentom do 26 roku życia za okazaniem ważnej legitymacji studenckiej.");
        put(LiveGdanskProvider.ECS_HOURS, "październik — kwiecień wystawa stała poniedziałek, środa – piątek | 10–17 sobota – niedziela | 10–18 wtorek wystawy nieczynne taras widokowy maj — wrzesień wystawa stała poniedziałek – piątek | 10–19 sobota – niedziela | 10–20 taras widokowy 9 dni w roku budynek jest zamknięty 1 listopada 24 grudnia 25 grudnia 26 grudnia Zasady zwiedzania");
        fail(LiveGdanskProvider.MUSEUM_PRICE, 403); fail(LiveGdanskProvider.MUSEUM_HOURS, 403);
        put(LiveGdanskProvider.API + "stops?date=2026-11-14", "{\"stops\":[{\"stopId\":1015,\"stopName\":\"Dworzec Główny\",\"stopLat\":54.35524,\"stopLon\":18.64517},{\"stopId\":1023,\"stopName\":\"Dworzec Główny\",\"stopLat\":54.35698,\"stopLon\":18.64555},{\"stopId\":100,\"stopName\":\"Targ Rybny\",\"stopLat\":54.35358,\"stopLon\":18.65789}]}");
        schedule(List.of(service(11, 1, 1015, 100, "08:00", "08:08"), service(11, 3, 1015, 100, "09:00", "09:08"),
                service(22, 2, 100, 1023, "10:00", "10:07"), service(22, 4, 100, 1023, "18:00", "18:07")));
    }
    @AfterEach void stop() { if (provider != null) provider.close(); if (server != null) server.stop(0); }

    @Test void datedRoundTripUsesDifferentReturnPlatformAndRefreshedPublishedTariff() {
        var result = provider.search(criteria());
        assertThat(result.status()).isEqualTo(SearchStatus.PARTIAL);
        assertThat(result.testData()).isFalse();
        assertThat(result.options()).hasSize(4);
        var trip = result.options().get(0);
        assertThat(trip.outbound().departureAt().toString()).isEqualTo("2026-11-14T08:00+01:00");
        assertThat(trip.returnJourney().segments().get(0).id()).endsWith("100-1023");
        assertThat(trip.travelMinutes()).isEqualTo(15);
        assertThat(trip.outbound().segments().get(0).mapUrl()).contains("origin=", "destination=", "travelmode=transit");
        var prices = trip.outbound().segments().get(0).prices();
        assertThat(prices).extracting(Price::amount).containsExactly("4.80", "2.40");
        assertThat(prices).allMatch(price -> price.basis() == PriceBasis.PUBLISHED_TARIFF && !price.testData());
        assertThat(prices.get(0).checkedAt().toInstant()).isEqualTo(CLOCK.instant());
        assertThat(prices.get(1).eligibility()).contains("legitymacja studencka");
        assertThat(result.attractions().get(0).entryPrices()).extracting(Price::amount).containsExactly("40.00", "35.00");
        assertThat(result.attractions().get(0).openingHours().status()).isEqualTo(OpeningStatus.KNOWN);
        assertThat(result.attractions().get(1).entryPrices()).allMatch(price -> price.status() == PriceStatus.PROVIDER_ERROR && price.amount() == null);
        assertThat(provider.transferMinutes(trip.outbound().segments().get(0).destination(), result.attractions().get(0).location())).isNull();
    }
    @Test void unsupportedRouteIsCoverageNotConfirmedNoConnectionAndDoesNotFetchAnything() {
        var c = criteria();
        var result = provider.search(new Criteria("Warszawa", "Gdańsk", c.departureDate(), c.returnDate(), c.priority(), c.currency(), c.fareType()));
        assertThat(result.status()).isEqualTo(SearchStatus.PARTIAL);
        assertThat(result.sources().get(0).status()).isEqualTo(SourceStatus.NO_COVERAGE);
        assertThat(result.sources().get(0).reasonCode()).isEqualTo("UNSUPPORTED_ROUTE");
        assertThat(requests.get()).isZero();
    }
    @Test void dateOutsidePublishedRangeIsNotReportedAsNoConnection() {
        var c = criteria();
        var result = provider.search(new Criteria(c.origin(), c.destination(), LocalDate.of(2026,12,5), LocalDate.of(2026,12,6), c.priority(), c.currency(), c.fareType()));
        assertThat(result.status()).isEqualTo(SearchStatus.PARTIAL);
        assertThat(result.sources()).anyMatch(source -> "OUTSIDE_COVERAGE".equals(source.reasonCode()));
        assertThat(result.options()).isEmpty();
    }
    @Test void failedSchedulePreservesUsefulAttractionDataAndDoesNotClaimNoConnection() {
        fail(LiveGdanskProvider.API + "stopTimes?date=2026-11-14&routeId=100", 503);
        var result = provider.search(criteria());
        assertThat(result.status()).isEqualTo(SearchStatus.PROVIDER_ERROR);
        assertThat(result.attractions().get(0).entryPrices().get(0).amount()).isEqualTo("40.00");
        assertThat(result.sources()).anyMatch(source -> source.status() == SourceStatus.PROVIDER_ERROR);
    }
    @Test void emptyVerifiedScheduleAloneCanConfirmNoConnection() throws Exception {
        schedule(List.of());
        assertThat(provider.search(criteria()).status()).isEqualTo(SearchStatus.NO_CONNECTION);
    }
    @Test void changedTariffStaysUnknownAndNeverTurnsIntoFreeTransport() {
        put(LiveGdanskProvider.FARE, "<p>Zmienił się format cennika</p>");
        var catalog = provider.search(criteria());
        assertThat(catalog.options()).isNotEmpty();
        assertThat(catalog.options().get(0).outbound().segments().get(0).prices()).allMatch(price -> price.status() == PriceStatus.UNKNOWN && price.amount() == null);
        var ranked = new Planner(provider).rank(criteria(), catalog.options(), catalog.attractions());
        assertThat(ranked).allMatch(trip -> !trip.costSummary().complete() && trip.costSummary().total() == null);
    }
    @Test void unconfirmedDiscountConditionsDoNotCreateOrInferReducedFare() {
        fail(LiveGdanskProvider.ELIGIBILITY, 503);
        var prices = provider.search(criteria()).options().get(0).outbound().segments().get(0).prices();
        assertThat(prices.get(0).amount()).isEqualTo("4.80");
        assertThat(prices.get(1).amount()).isNull();
        assertThat(prices.get(1).status()).isEqualTo(PriceStatus.PROVIDER_ERROR);
    }
    @Test void missingPermanentTariffNeverBorrowsPricesFromStoczniaOrFamilyProducts() {
        put(LiveGdanskProvider.ECS_PRICE, "WYSTAWA STAŁA Bilet rodzinny 100 zł WYSTAWA STOCZNIA BILET NORMALNY | 15 zł BILET ULGOWY | 10 zł studentom do 26 lat z legitymacją");
        var ecs = provider.search(criteria()).attractions().get(0);
        assertThat(ecs.entryPrices()).allMatch(price -> price.amount() == null && price.status() == PriceStatus.UNKNOWN);
    }
    @Test void changedTuesdayOpeningCannotBeSilentlyAssumedClosed() {
        Reply original = fixtures.get(key(URI.create(LiveGdanskProvider.ECS_HOURS)));
        put(LiveGdanskProvider.ECS_HOURS, original.body().replace("wtorek wystawy nieczynne", "wtorek 10–17"));
        assertThat(provider.search(criteria()).attractions().get(0).openingHours().status()).isEqualTo(OpeningStatus.UNKNOWN);
    }
    @Test void museumHolidayClosureNeedsActualDatedClosureSectionRatherThanFooterYear() {
        put(LiveGdanskProvider.MUSEUM_HOURS, "Godziny pracy muzeum Poniedziałek Nieczynne Wtorek 10:00–16:00 Środa–Niedziela 10:00–18:00 Kasy muzeum ©2026");
        assertThat(provider.search(criteria()).attractions().get(1).openingHours().status()).isEqualTo(OpeningStatus.UNKNOWN);
        put(LiveGdanskProvider.MUSEUM_HOURS, "Godziny pracy muzeum Poniedziałek Nieczynne Wtorek 10:00–16:00 Środa–Niedziela 10:00–18:00 Muzeum będzie nieczynne dla zwiedzających w następujących terminach 14 listopada 2026 r. Kasy muzeum");
        var opening = provider.search(criteria()).attractions().get(1).openingHours();
        assertThat(opening.status()).isEqualTo(OpeningStatus.KNOWN); assertThat(opening.intervals()).isEmpty();
    }
    @Test void malformedAttractionCalendarCannotDiscardValidTransportAndOtherAttractions() {
        put(LiveGdanskProvider.MUSEUM_HOURS, "Godziny pracy muzeum Poniedziałek Nieczynne Wtorek 10:00–16:00 Środa–Niedziela 10:00–18:00 Muzeum będzie nieczynne dla zwiedzających w następujących terminach 31 kwietnia 2026 r. Kasy muzeum");
        var catalog = provider.search(criteria());
        assertThat(catalog.options()).hasSize(4);
        assertThat(catalog.attractions().get(0).openingHours().status()).isEqualTo(OpeningStatus.KNOWN);
        assertThat(catalog.attractions().get(1).openingHours().status()).isEqualTo(OpeningStatus.UNKNOWN);
    }
    @Test void malformedScheduleIsProviderFailureRatherThanConfirmedAbsence() {
        put(LiveGdanskProvider.API + "stopTimes?date=2026-11-14&routeId=100", "{\"stopTimes\":[{}]}");
        assertThat(provider.search(criteria()).status()).isEqualTo(SearchStatus.PROVIDER_ERROR);
    }
    @Test void staleScheduleContainingOnlyAnotherDateCannotConfirmNoConnection() throws Exception {
        var stale = service(11, 1, 1015, 100, "08:00", "08:08");
        stale.forEach(row -> row.put("date", "2026-11-15"));
        schedule(List.of(stale));
        var catalog = provider.search(criteria());
        assertThat(catalog.status()).isEqualTo(SearchStatus.PROVIDER_ERROR);
        assertThat(catalog.options()).isEmpty();
        assertThat(catalog.sources()).anyMatch(source -> source.status() == SourceStatus.PROVIDER_ERROR);
        assertThat(catalog.sources()).noneMatch(source -> source.status() == SourceStatus.NO_CONNECTION);
    }
    @Test void mixedDayPayloadIsNotPartiallyTrustedAsTheRequestedCalendar() throws Exception {
        var staleReturn = service(22, 2, 100, 1023, "10:00", "10:07");
        staleReturn.forEach(row -> row.put("date", "2026-11-15"));
        schedule(List.of(service(11, 1, 1015, 100, "08:00", "08:08"), staleReturn));
        assertThat(provider.search(criteria()).status()).isEqualTo(SearchStatus.PROVIDER_ERROR);
    }
    @Test void wrongRoutePayloadCannotConfirmNoConnection() throws Exception {
        var wrongRoute = service(11, 1, 1015, 100, "08:00", "08:08");
        wrongRoute.forEach(row -> row.put("routeId", 200));
        schedule(List.of(wrongRoute));
        assertThat(provider.search(criteria()).status()).isEqualTo(SearchStatus.PROVIDER_ERROR);
    }
    @Test void malformedPassengerFlagCannotBeCoercedIntoAnEmptyPassengerSchedule() throws Exception {
        var malformed = service(11, 1, 1015, 100, "08:00", "08:08");
        malformed.forEach(row -> row.put("passenger", "unavailable"));
        schedule(List.of(malformed));
        assertThat(provider.search(criteria()).status()).isEqualTo(SearchStatus.PROVIDER_ERROR);
    }
    @Test void rankingRunsOnEveryCandidateBeforeTheTwentyFourResultBound() throws Exception {
        List<List<Map<String,Object>>> services = new ArrayList<>();
        for (int i = 0; i < 35; i++) services.add(service(11, i + 1, 1015, 100, LocalTime.of(8,0).plusMinutes(i).toString(), LocalTime.of(8,8).plusMinutes(i).toString()));
        services.add(service(22,100,100,1023,"10:00","10:07")); services.add(service(22,101,100,1023,"18:00","18:07"));
        schedule(services);
        var base = criteria();
        var c = new Criteria(base.origin(),base.destination(),base.departureDate(),base.returnDate(),Priority.MOST_TIME_AT_DESTINATION,"PLN",FareType.STANDARD);
        var search = new SearchService(provider, new Planner(provider), new InputValidation(CLOCK));
        var response = search.search(c);
        assertThat(response.roundTripOptions()).hasSize(24);
        assertThat(response.roundTripOptions().get(0).timeAtDestinationMinutes()).isEqualTo(592);
        assertThat(response.sources()).anyMatch(source -> source.sourceId().equals("result-limit"));
        var full = provider.search(c).options(); assertThat(full).hasSize(70);
        var notInFirstPage = full.stream().filter(trip -> response.roundTripOptions().stream().noneMatch(page -> page.id().equals(trip.id()))).findFirst().orElseThrow();
        assertThat(search.preview(new PlanInput(c,notInFirstPage,List.of())).selectedRoundTrip().id()).isEqualTo(notInFirstPage.id());
    }
    @Test void exportedSentinelSupportsAfterMidnightRolloverAndNeverShows1899() {
        var day = LocalDate.of(2026,11,14);
        var before = LiveGdanskProvider.exportedTime(day,"1899-12-30T23:58:00",null);
        assertThat(LiveGdanskProvider.exportedTime(day,"1899-12-30T00:07:00",before).toString()).isEqualTo("2026-11-15T00:07+01:00");
        assertThat(LiveGdanskProvider.exportedTime(day,"1899-12-31T00:07:00",before).toString()).isEqualTo("2026-11-15T00:07+01:00");
        assertThat(LiveGdanskProvider.normalize("Gdańsk Dworzec Główny")).isEqualTo("dworzec glowny");
    }
    private Criteria criteria() { return new Criteria("Dworzec Główny", "Targ Rybny", LocalDate.of(2026,11,14), LocalDate.of(2026,11,14), Priority.LOWEST_TOTAL_COST,"PLN",FareType.STANDARD); }
    private static String key(URI uri) { return uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()); }
    private void put(String url, String body) { fixtures.put(key(URI.create(url)),new Reply(200,body)); }
    private void fail(String url, int status) { fixtures.put(key(URI.create(url)),new Reply(status,"upstream unavailable")); }
    private void schedule(List<List<Map<String,Object>>> services) throws Exception { put(LiveGdanskProvider.API + "stopTimes?date=2026-11-14&routeId=100", json.writeValueAsString(Map.of("stopTimes", services.stream().flatMap(List::stream).toList()))); }
    private List<Map<String,Object>> service(int trip, int order, int from, int to, String depart, String arrive) {
        return List.of(row(trip,order,from,1,depart), row(trip,order,to,2,arrive));
    }
    private Map<String,Object> row(int trip,int order,int stop,int sequence,String time) {
        Map<String,Object> row = new LinkedHashMap<>();
        row.put("routeId",100); row.put("agencyId",1); row.put("tripId",trip); row.put("order",order); row.put("busServiceName","100-01");
        row.put("passenger",true); row.put("nonpassenger",0); row.put("date","2026-11-14"); row.put("stopId",stop); row.put("stopSequence",sequence);
        row.put("arrivalTime","1899-12-30T"+time+":00"); row.put("departureTime","1899-12-30T"+time+":00"); return row;
    }
}
