package pl.citybreak.service;

import static org.assertj.core.api.Assertions.assertThat;
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
import pl.citybreak.provider.ai.OpenAiAttractionAdvisor;

class AttractionRecommendationsTest {
    private static final LocalDate DAY = LocalDate.parse("2099-04-10");
    private static final Place CITY = new Place("Paryż", 48.85, 2.35);
    private static final Criteria CRITERIA = new Criteria("Londyn", "Paryż", DAY, DAY,
            Priority.LOWEST_TOTAL_COST, "PLN", FareType.STANDARD);
    private final TravelProvider transport = mock(TravelProvider.class);
    private final OpenAiAttractionAdvisor advisor = mock(OpenAiAttractionAdvisor.class);
    private final AttractionRecommendations service = new AttractionRecommendations(transport, new Planner(transport),
            new InputValidation(Clock.fixed(Instant.parse("2026-11-13T09:00:00Z"), ZoneOffset.UTC)), advisor);

    @Test void modelCanOnlyRecommendEligibleIdsWithinCombinedBudgetAndTime() {
        var museum = attraction("museum", "40", "PLN", 35, 10, 12);
        var gallery = attraction("gallery", "40", "PLN", 35, 10, 12);
        var park = attraction("park", "0", "PLN", 25, 10, 12);
        var closed = attraction("closed", "1", "PLN", 20, 12, 14);
        var euros = attraction("foreign-currency", "1", "EUR", 20, 10, 12);
        configure(List.of(museum, gallery, park, closed, euros));
        when(advisor.suggest(eq("Paryż"), anyLong(), eq(Interest.CULTURE), eq(50), anyList()))
                .thenAnswer(invocation -> {
                    List<AttractionRecommendations.Option> eligible = invocation.getArgument(4);
                    assertThat(eligible).extracting(option -> option.attraction().id())
                            .containsExactly("museum", "gallery", "park");
                    return List.of(new Recommendation("closed", "Od modelu"), new Recommendation("museum", "Od modelu"),
                            new Recommendation("museum", "Powtórzenie"), new Recommendation("gallery", "Przekracza budżet"));
                });

        var result = service.suggest(new RecommendationInput(CRITERIA, "trip", Interest.CULTURE, 50));
        assertThat(result.aiUsed()).isTrue();
        assertThat(result.suggestions()).extracting(Recommendation::attractionId).containsExactly("museum", "park");
    }

    @Test void fallbackPrioritizesInterestAndChecksScheduleForTheWholeSet() {
        var museum = attraction("museum", "0", "PLN", 60, 10, 12);
        var park = attraction("park", "0", "PLN", 60, 10, 12);
        configure(List.of(museum, park));
        var result = service.suggest(new RecommendationInput(CRITERIA, "trip", Interest.OUTDOORS, 0));
        assertThat(result.aiUsed()).isFalse();
        assertThat(result.suggestions()).extracting(Recommendation::attractionId).containsExactly("park");
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
