package pl.citybreak.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import pl.citybreak.model.Model.*;
import pl.citybreak.planning.Planner;
import pl.citybreak.provider.TravelProvider;
import pl.citybreak.provider.TravelProvider.Catalog;
import pl.citybreak.provider.ai.ConnectionDiscovery;
import pl.citybreak.provider.ai.ConnectionDiscovery.Candidate;
import pl.citybreak.provider.rail.SkmTimetable;

class RailSearchTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-13T09:00:00Z"), ZoneOffset.UTC);
    private static final String SKM_SOURCE = "https://bip.skm.pkp.pl/otwarte-dane";
    private static final String AI_SOURCE = "https://www.skm.pkp.pl/rozklad";
    private static final LocalDate DAY = LocalDate.parse("2026-11-14");
    private static final Place GDANSK = new Place("Gdańsk Główny", null, null);
    private static final Place GDYNIA = new Place("Gdynia Główna", null, null);
    private static final Criteria CRITERIA = new Criteria(GDANSK.name(), GDYNIA.name(), DAY, DAY,
            Priority.LOWEST_TOTAL_COST, "PLN", FareType.STANDARD);
    private static final RoundTrip VERIFIED = trip("later", "18:00:00");
    private static final RoundTrip OTHER = trip("earlier", "15:00:00");
    private static final Source FEED = new Source("skm-gtfs", SKM_SOURCE, OffsetDateTime.now(CLOCK), SourceStatus.OK, null);
    private static final Source PUBLICATION = new Source("skm-feed-published", SKM_SOURCE,
            OffsetDateTime.now(CLOCK).minusHours(4), SourceStatus.OK, null);

    private final SkmTimetable timetable = mock(SkmTimetable.class);
    private final ConnectionDiscovery discovery = mock(ConnectionDiscovery.class);

    @Test
    void matchesBothDirectionsAndLeavesDiscoveryCitationsOutOfPreview() {
        var service = service(20);
        when(discovery.discover(CRITERIA)).thenReturn(List.of(candidate(VERIFIED.outbound()),
                candidate(VERIFIED.returnJourney()), new Candidate(GDYNIA.name(), GDANSK.name(), time("15:02:00"),
                        time("15:22:00"), AI_SOURCE)));

        SearchResponse search = service.search(CRITERIA);
        assertEquals(SearchStatus.PARTIAL, search.status());
        assertEquals(List.of(VERIFIED.id()), search.roundTripOptions().stream().map(RoundTrip::id).toList());
        RoundTrip trip = search.roundTripOptions().get(0);
        Segment segment = trip.outbound().segments().get(0);
        assertEquals(SKM_SOURCE, segment.scheduleSourceUrl());
        assertEquals(ScheduleBasis.PLANNED, segment.scheduleBasis());
        assertEquals(PUBLICATION.checkedAt(), segment.schedulePublishedAt());
        assertEquals(AI_SOURCE, segment.discoverySourceUrl());
        assertNull(trip.costSummary().total());
        assertEquals("AI_VERIFIED", search.sources().get(2).reasonCode());

        Plan preview = service.preview(new PlanInput(CRITERIA, trip, List.of()));
        assertNull(preview.selectedRoundTrip().outbound().segments().get(0).discoverySourceUrl());
        assertEquals(SKM_SOURCE, preview.selectedRoundTrip().returnJourney().segments().get(0).scheduleSourceUrl());
        verify(discovery, times(1)).discover(CRITERIA);
    }

    @Test
    void fallsBackOnUnmatchedCandidatesOrExhaustedBudget() {
        var service = service(1);
        when(discovery.discover(CRITERIA)).thenReturn(List.of(candidate(VERIFIED.outbound())));
        SearchResponse unmatched = service.search(CRITERIA);
        assertEquals(2, unmatched.roundTripOptions().size());
        assertEquals("AI_NO_MATCH", unmatched.sources().get(2).reasonCode());
        SearchResponse limited = service.search(CRITERIA);
        assertEquals(2, limited.roundTripOptions().size());
        assertEquals("AI_UNAVAILABLE", limited.sources().get(2).reasonCode());
        verify(discovery, times(1)).discover(CRITERIA);
    }

    @Test
    void preservesVerifiedResultsOnProviderFailureAndSkipsAiOutsideCoverage() {
        var service = service(20);
        when(discovery.discover(CRITERIA)).thenThrow(new IllegalStateException("timeout"));
        SearchResponse recovered = service.search(CRITERIA);
        assertEquals(2, recovered.roundTripOptions().size());
        assertEquals("AI_UNAVAILABLE", recovered.sources().get(2).reasonCode());

        Source outside = new Source("skm-gtfs", SKM_SOURCE, null, SourceStatus.NO_COVERAGE, null, "OUTSIDE_COVERAGE");
        when(timetable.search(CRITERIA)).thenReturn(new Catalog(List.of(), List.of(), List.of(outside), SearchStatus.PARTIAL, false));
        assertEquals(List.of(outside), service.search(CRITERIA).sources());
        verify(discovery, times(1)).discover(CRITERIA);
    }

    private SearchService service(int dailyLimit) {
        var base = mock(TravelProvider.class);
        when(timetable.supports(GDANSK.name(), GDYNIA.name())).thenReturn(true);
        when(timetable.canonicalPlace(GDANSK.name())).thenReturn(GDANSK.name());
        when(timetable.canonicalPlace(GDYNIA.name())).thenReturn(GDYNIA.name());
        when(timetable.search(CRITERIA)).thenReturn(new Catalog(List.of(VERIFIED, OTHER), List.of(),
                List.of(FEED, PUBLICATION), SearchStatus.PARTIAL, false));
        when(discovery.enabled()).thenReturn(true);
        ObjectProvider<ConnectionDiscovery> providers = new ObjectProvider<>() {
            @Override public ConnectionDiscovery getIfAvailable() { return discovery; }
        };
        return new SearchService(base, new Planner(base), new InputValidation(CLOCK),
                new RailSearch(timetable, providers, CLOCK, dailyLimit));
    }

    private static RoundTrip trip(String id, String returnTime) {
        Journey out = journey("out", GDANSK, GDYNIA, time("09:00:00"));
        Journey back = journey(id, GDYNIA, GDANSK, time(returnTime));
        return new RoundTrip(id, out, back, 40, 0, java.time.Duration.between(out.arrivalAt(), back.departureAt()).toMinutes(), null, List.of());
    }

    private static Journey journey(String id, Place from, Place to, OffsetDateTime departure) {
        var arrival = departure.plusMinutes(20);
        return new Journey(departure, arrival, List.of(new Segment(id, Mode.TRAIN, "PKP SKM", from, to,
                departure, arrival, List.of(), null, null)));
    }

    private static Candidate candidate(Journey journey) {
        Segment segment = journey.segments().get(0);
        return new Candidate(segment.origin().name(), segment.destination().name(), segment.departureAt().withOffsetSameInstant(ZoneOffset.UTC),
                segment.arrivalAt().withOffsetSameInstant(ZoneOffset.UTC), AI_SOURCE);
    }

    private static OffsetDateTime time(String time) { return OffsetDateTime.parse(DAY + "T" + time + "+01:00"); }
}
