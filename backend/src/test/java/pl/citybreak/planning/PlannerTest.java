package pl.citybreak.planning;

import static org.assertj.core.api.Assertions.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import pl.citybreak.model.Model.*;
import pl.citybreak.provider.*;
import pl.citybreak.service.*;

class PlannerTest {
    private final Clock clock = Clock.fixed(Instant.parse("2026-11-11T10:00:00Z"), ZoneOffset.UTC);
    private final DemoTravelProvider provider = new DemoTravelProvider(clock);
    private final Planner planner = new Planner(provider);
    private final SearchService searches = new SearchService(provider, planner, new InputValidation(clock));
    private Criteria criteria(Priority priority) {
        return new Criteria("Warszawa", "Gdańsk", LocalDate.parse("2026-12-05"), LocalDate.parse("2026-12-06"), priority, "PLN", FareType.STANDARD);
    }
    @Test void lowestCostCountsBothJourneysAndRecommendedAdmissions() {
        var search = searches.search(criteria(Priority.LOWEST_TOTAL_COST));
        RoundTrip winner = search.roundTripOptions().get(0);
        assertThat(winner.id()).isEqualTo("demo-budget");
        assertThat(winner.costSummary().total()).isEqualTo("130.00");
        assertThat(winner.recommendedAttractionIds()).containsExactly("demo-museum", "demo-gallery", "demo-park");
        RoundTrip missing = search.roundTripOptions().get(search.roundTripOptions().size() - 1);
        assertThat(missing.id()).isEqualTo("demo-unknown");
        assertThat(missing.costSummary().total()).isNull();
        assertThat(missing.costSummary().missingComponents()).isNotEmpty();
    }
    @Test void shortestTravelTimeUsesBothDirections() {
        assertThat(searches.search(criteria(Priority.SHORTEST_TRAVEL_TIME)).roundTripOptions().get(0).id()).isEqualTo("demo-fast");
    }
    @Test void fewestTransfersUsesBothDirections() {
        assertThat(searches.search(criteria(Priority.FEWEST_TRANSFERS)).roundTripOptions().get(0).id()).isEqualTo("demo-direct");
    }
    @Test void mostTimeAtDestinationUsesArrivalUntilReturnDeparture() {
        assertThat(searches.search(criteria(Priority.MOST_TIME_AT_DESTINATION)).roundTripOptions().get(0).id()).isEqualTo("demo-long");
    }
    @Test void equalMetricsHaveDeterministicTravelTransfersAndIdTies() {
        var catalog = provider.search(criteria(Priority.SHORTEST_TRAVEL_TIME));
        RoundTrip base = catalog.options().get(0);
        RoundTrip z = new RoundTrip("z", base.outbound(), base.returnJourney(), 123, 1, 100, null, List.of());
        RoundTrip a = new RoundTrip("a", base.outbound(), base.returnJourney(), 123, 1, 100, null, List.of());
        assertThat(planner.rank(criteria(Priority.SHORTEST_TRAVEL_TIME), List.of(z, a), catalog.attractions()))
                .extracting(RoundTrip::id).containsExactly("a", "z");
    }
    @Test void earlierReturnKeepsAllItemsAndLaterReturnClearsWarnings() {
        Criteria criteria = criteria(Priority.LOWEST_TOTAL_COST);
        var search = searches.search(criteria);
        RoundTrip normal = option(search, "demo-budget");
        Plan draft = searches.preview(new PlanInput(criteria, normal, List.of(
                new ItemInput("museum", "demo-museum", null, 90),
                new ItemInput("gallery", "demo-gallery", null, 60),
                new ItemInput("park", "demo-park", null, 45))));
        assertThat(draft.items()).allMatch(item -> item.conflicts().isEmpty());
        List<ItemInput> preserved = draft.items().stream().map(item -> new ItemInput(item.id(), item.attractionId(),
                item.startsAt(), (int) Duration.between(item.startsAt(), item.endsAt()).toMinutes())).toList();
        Plan earlier = searches.preview(new PlanInput(criteria, option(search, "demo-early"), preserved));
        assertThat(earlier.items()).extracting(PlanItem::id).containsExactly("museum", "gallery", "park");
        assertThat(earlier.items().get(1).conflicts()).extracting(Conflict::code).contains(ConflictCode.RETURN_DEPARTURE);
        assertThat(earlier.items().get(2).conflicts()).extracting(Conflict::code).contains(ConflictCode.RETURN_DEPARTURE);
        Plan later = searches.preview(new PlanInput(criteria, normal, preserved));
        assertThat(later.items()).allMatch(item -> item.conflicts().isEmpty());
    }
    @Test void closedAttractionAndImpossibleTransferHaveSpecificReasons() {
        Criteria criteria = criteria(Priority.LOWEST_TOTAL_COST);
        RoundTrip trip = option(searches.search(criteria), "demo-budget");
        Plan plan = searches.preview(new PlanInput(criteria, trip, List.of(
                new ItemInput("closed", "demo-museum", OffsetDateTime.parse("2026-12-05T07:00:00+01:00"), 90))));
        assertThat(plan.items().get(0).conflicts()).extracting(Conflict::code)
                .contains(ConflictCode.TRANSFER_TIME, ConflictCode.OPENING_HOURS);
        assertThat(plan.items().get(0).conflicts()).allMatch(conflict -> !conflict.reason().isBlank());
    }
    @Test void unknownOpeningOrTransferDataNeverBecomesConfirmedRecommendation() {
        Criteria criteria = criteria(Priority.LOWEST_TOTAL_COST);
        var catalog = provider.search(criteria);
        Attraction known = catalog.attractions().get(0);
        Attraction unknown = new Attraction(known.id(), known.name(), new Place("unknown", null, null), known.visitMinutes(), known.entryPrices(),
                new OpeningHours(OpeningStatus.UNKNOWN, List.of()), known.sources());
        RoundTrip trip = catalog.options().get(0);
        var schedule = planner.schedule(trip, List.of(new ItemInput("x", unknown.id(), null, 90)), List.of(unknown));
        assertThat(schedule.get(0).transferMinutesFromPrevious()).isNull();
        assertThat(schedule.get(0).conflicts()).extracting(Conflict::code).contains(ConflictCode.MISSING_DATA);
        assertThat(planner.rank(criteria, List.of(trip), List.of(unknown)).get(0).recommendedAttractionIds()).isEmpty();
    }
    @Test void confirmedReducedFareIsComparedSeparately() {
        Criteria base = criteria(Priority.LOWEST_TOTAL_COST);
        Criteria reduced = new Criteria(base.origin(), base.destination(), base.departureDate(), base.returnDate(), base.priority(), "PLN", FareType.REDUCED);
        assertThat(searches.search(reduced).roundTripOptions().get(0).costSummary().total()).isEqualTo("65.00");
    }
    @Test void tamperedClientPricesAndTimesAreReplacedByServerCatalog() {
        Criteria criteria = criteria(Priority.LOWEST_TOTAL_COST);
        RoundTrip fake = new RoundTrip("demo-budget", null, null, 0, 0, 0,
                new CostSummary("0.00", "PLN", FareType.STANDARD, true, List.of()), List.of());
        Plan plan = searches.preview(new PlanInput(criteria, fake, List.of()));
        assertThat(plan.costSummary().total()).isEqualTo("80.00");
        assertThat(plan.selectedRoundTrip().travelMinutes()).isEqualTo(600);
    }
    @Test void invalidDatesAndDuplicateIdsHaveFieldErrors() {
        Criteria base = criteria(Priority.LOWEST_TOTAL_COST);
        Criteria invalid = new Criteria(base.origin(), base.destination(), base.returnDate(), base.departureDate(), base.priority(), "PLN", base.fareType());
        assertThatThrownBy(() -> searches.search(invalid)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.errors()).extracting(FieldError::field).contains("returnDate"));
        RoundTrip trip = option(searches.search(base), "demo-budget");
        assertThatThrownBy(() -> searches.preview(new PlanInput(base, trip, List.of(
                new ItemInput("same", "demo-museum", null, 90), new ItemInput("same", "demo-park", null, 45)))))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(400));
    }
    @Test void realDefaultNeverFakesEmptySchedulesAsNoConnection() {
        var live = new UnavailableTravelProvider(clock);
        var service = new SearchService(live, new Planner(live), new InputValidation(clock));
        SearchResponse result = service.search(criteria(Priority.LOWEST_TOTAL_COST));
        assertThat(result.status()).isEqualTo(SearchStatus.PROVIDER_ERROR);
        assertThat(result.roundTripOptions()).isEmpty();
        assertThat(result.testData()).isFalse();
        assertThat(result.sources().get(0).message()).contains("brak danych");
    }
    @Test void overlappingEarlierItemKeepsDownstreamFeasibilityCursorMonotonic() {
        Criteria criteria = criteria(Priority.LOWEST_TOTAL_COST);
        RoundTrip trip = option(searches.search(criteria), "demo-long");
        Plan plan = searches.preview(new PlanInput(criteria, trip, List.of(
                new ItemInput("long", "demo-park", OffsetDateTime.parse("2026-12-05T10:00:00+01:00"), 300),
                new ItemInput("overlap", "demo-museum", OffsetDateTime.parse("2026-12-05T11:00:00+01:00"), 60),
                new ItemInput("downstream", "demo-park", OffsetDateTime.parse("2026-12-05T12:15:00+01:00"), 45))));
        assertThat(plan.items()).extracting(PlanItem::id).containsExactly("long", "overlap", "downstream");
        assertThat(plan.items().get(1).conflicts()).extracting(Conflict::code).contains(ConflictCode.TRANSFER_TIME);
        assertThat(plan.items().get(2).conflicts()).extracting(Conflict::code).contains(ConflictCode.TRANSFER_TIME);
    }
    @Test void returnBufferIsRequiredEvenWhenVisitEndsBeforeDeparture() {
        Criteria criteria = criteria(Priority.LOWEST_TOTAL_COST);
        RoundTrip trip = option(searches.search(criteria), "demo-early");
        Plan plan = searches.preview(new PlanInput(criteria, trip, List.of(
                new ItemInput("buffer", "demo-park", OffsetDateTime.parse("2026-12-06T13:10:00+01:00"), 45))));
        assertThat(plan.items().get(0).endsAt()).isBefore(trip.returnJourney().departureAt());
        assertThat(plan.items().get(0).conflicts()).extracting(Conflict::code).contains(ConflictCode.RETURN_DEPARTURE);
    }
    @Test void wrongCurrencyOrMissingComparableFareMakesTotalIncomplete() {
        Criteria criteria = criteria(Priority.LOWEST_TOTAL_COST);
        var catalog = provider.search(criteria);
        Attraction source = catalog.attractions().get(0);
        Price standard = source.entryPrices().get(0);
        Price euros = new Price(PriceStatus.KNOWN, "1.00", "EUR", standard.fareType(), null,
                standard.sourceId(), standard.sourceUrl(), standard.checkedAt(), true, null);
        Attraction incomparable = new Attraction(source.id(), source.name(), source.location(), source.visitMinutes(),
                List.of(euros), source.openingHours(), source.sources());
        CostSummary currency = planner.cost(criteria, catalog.options().get(0), List.of(source.id()), List.of(incomparable));
        assertThat(currency.complete()).isFalse();
        assertThat(currency.total()).isNull();
        assertThat(currency.missingComponents()).contains("attraction:" + source.id());
        Criteria reduced = new Criteria(criteria.origin(), criteria.destination(), criteria.departureDate(), criteria.returnDate(),
                criteria.priority(), criteria.currency(), FareType.REDUCED);
        Attraction onlyStandard = new Attraction(source.id(), source.name(), source.location(), source.visitMinutes(),
                List.of(standard), source.openingHours(), source.sources());
        assertThat(planner.cost(reduced, catalog.options().get(0), List.of(source.id()), List.of(onlyStandard)).complete()).isFalse();
    }
    private RoundTrip option(SearchResponse response, String id) {
        return response.roundTripOptions().stream().filter(option -> option.id().equals(id)).findFirst().orElseThrow();
    }
}
