package pl.citybreak.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import pl.citybreak.model.Model.*;
import pl.citybreak.planning.Planner;
import pl.citybreak.provider.TravelProvider;
import pl.citybreak.provider.TravelProvider.Catalog;

class AttractionRecommendationsTest {
    private static final LocalDate DAY = LocalDate.parse("2099-04-10");
    private static final Place CITY = new Place("Paryż", 48.85, 2.35);
    private static final Criteria CRITERIA = new Criteria("Londyn", "Paryż", DAY, DAY,
            Priority.LOWEST_TOTAL_COST, "PLN", FareType.STANDARD);
    private final TravelProvider transport = mock(TravelProvider.class);
    private final AttractionRecommendations service = new AttractionRecommendations(transport, new Planner(transport),
            new InputValidation(Clock.fixed(Instant.parse("2026-11-13T09:00:00Z"), ZoneOffset.UTC)));

    @Test void catalogOnlyRecommendsKnownPricesWithinCombinedBudgetAndTime() {
        var museum = attraction("museum", "40", "PLN", 35, 10, 12);
        var gallery = attraction("gallery", "40", "PLN", 35, 10, 12);
        var park = attraction("park", "0", "PLN", 25, 10, 12);
        var closed = attraction("closed", "1", "PLN", 20, 12, 14);
        var euros = attraction("foreign-currency", "1", "EUR", 20, 10, 12);
        var unknown = attraction("unknown-price", null, "PLN", 20, 10, 12);
        configure(List.of(museum, gallery, park, closed, euros, unknown));

        var result = service.suggest(new RecommendationInput(CRITERIA, "trip", Interest.CULTURE, 50));
        assertThat(result.suggestions()).extracting(Recommendation::attractionId).containsExactly("museum", "park");
        assertThat(result.suggestions()).extracting(Recommendation::reason).containsExactly(
                "Pasuje do Twoich zainteresowań.", "Mieści się w czasie i budżecie na zwiedzanie.");
        assertThat(service.suggest(new RecommendationInput(CRITERIA, "trip", Interest.CULTURE, 50))).isEqualTo(result);
    }

    @Test void catalogPrioritizesInterestAndChecksScheduleForTheWholeSet() {
        var museum = attraction("museum", "0", "PLN", 60, 10, 12);
        var park = attraction("park", "0", "PLN", 60, 10, 12);
        configure(List.of(museum, park));
        var result = service.suggest(new RecommendationInput(CRITERIA, "trip", Interest.OUTDOORS, 0));
        assertThat(result.suggestions()).extracting(Recommendation::attractionId).containsExactly("park");
    }
    @Test void admissionsBudgetCoversTheWholeGroup() {
        var museum = attraction("museum", "40", "PLN", 35, 10, 12);
        var park = attraction("park", "0", "PLN", 25, 10, 12);
        configure(List.of(museum, park));
        Criteria group = new Criteria(CRITERIA.origin(), CRITERIA.destination(), CRITERIA.departureDate(),
                CRITERIA.returnDate(), CRITERIA.priority(), CRITERIA.currency(), CRITERIA.fareType(), 2);
        var catalog = transport.search(CRITERIA);
        when(transport.canonicalCriteria(group)).thenReturn(group);
        when(transport.search(group)).thenReturn(catalog);
        var single = service.suggest(new RecommendationInput(CRITERIA, "trip", Interest.CULTURE, 50));
        assertThat(single.suggestions()).extracting(Recommendation::attractionId).contains("museum");
        var tightGroup = service.suggest(new RecommendationInput(group, "trip", Interest.CULTURE, 50));
        assertThat(tightGroup.suggestions()).extracting(Recommendation::attractionId).containsExactly("park");
        var exactGroup = service.suggest(new RecommendationInput(group, "trip", Interest.CULTURE, 80));
        assertThat(exactGroup.suggestions()).extracting(Recommendation::attractionId).containsExactly("museum", "park");
    }

    @Test void returnsAtMostThreeSuggestionsInStableCatalogOrder() {
        configure(List.of(attraction("one", "0", "PLN", 10, 10, 12),
                attraction("two", "0", "PLN", 10, 10, 12),
                attraction("three", "0", "PLN", 10, 10, 12),
                attraction("four", "0", "PLN", 10, 10, 12)));
        var result = service.suggest(new RecommendationInput(CRITERIA, "trip", Interest.MIXED, 0));
        assertThat(result.suggestions()).extracting(Recommendation::attractionId).containsExactly("one", "two", "three");
    }

    @Test void returnsAnEmptyListWhenNoAttractionFits() {
        configure(List.of(attraction("closed", "0", "PLN", 20, 12, 14)));
        assertThat(service.suggest(new RecommendationInput(CRITERIA, "trip", Interest.MIXED, 0)).suggestions()).isEmpty();
    }

    @Test void rejectsInvalidRecommendationParametersBeforeSearching() {
        for (RecommendationInput input : new RecommendationInput[]{null,
                new RecommendationInput(CRITERIA, "trip", null, 50),
                new RecommendationInput(CRITERIA, null, Interest.MIXED, 50),
                new RecommendationInput(CRITERIA, "trip", Interest.MIXED, null),
                new RecommendationInput(CRITERIA, "trip", Interest.MIXED, -1),
                new RecommendationInput(CRITERIA, "trip", Interest.MIXED, 10_001)}) {
            assertThatThrownBy(() -> service.suggest(input)).isInstanceOfSatisfying(ApiException.class,
                    error -> assertThat(error.status()).isEqualTo(400));
        }
        verifyNoInteractions(transport);
    }

    @Test void rejectsAnUnknownTrip() {
        configure(List.of());
        assertThatThrownBy(() -> service.suggest(new RecommendationInput(CRITERIA, "missing", Interest.MIXED, 0)))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(400));
    }

    private void configure(List<Attraction> attractions) {
        var out = journey("out", 9, 10);
        var back = journey("back", 11, 12);
        var trip = new RoundTrip("trip", out, back, 120, 0, 60, null, List.of());
        when(transport.canonicalCriteria(CRITERIA)).thenReturn(CRITERIA);
        when(transport.search(CRITERIA)).thenReturn(new Catalog(List.of(trip), attractions, List.of(),
                SearchStatus.OK, true, Map.of("park", Interest.OUTDOORS, "museum", Interest.CULTURE)));
        when(transport.transferMinutes(any(), any())).thenReturn(0);
    }

    private static Journey journey(String id, int from, int to) {
        var segment = new Segment(id, Mode.TRAIN, "Demo", CITY, CITY, at(from), at(to), List.of(), null, null);
        return new Journey(segment.departureAt(), segment.arrivalAt(), List.of(segment));
    }

    private static Attraction attraction(String id, String amount, String currency, int minutes, int opens, int closes) {
        var price = new Price(PriceStatus.KNOWN, amount, currency, FareType.STANDARD, null, "fixture", null, null, true, null);
        return new Attraction(id, id, CITY, minutes, List.of(price),
                new OpeningHours(OpeningStatus.KNOWN, List.of(new OpeningInterval(at(opens), at(closes)))), List.of());
    }

    private static OffsetDateTime at(int hour) { return DAY.atTime(hour, 0).atOffset(ZoneOffset.ofHours(2)); }
}
