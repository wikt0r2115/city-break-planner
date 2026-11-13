package pl.citybreak.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.*;
import pl.citybreak.model.PlaceNames;
import pl.citybreak.provider.TravelProvider.Catalog;
import pl.citybreak.provider.ai.ConnectionDiscovery;
import pl.citybreak.provider.ai.ConnectionDiscovery.Candidate;
import pl.citybreak.provider.rail.SkmTimetable;

@Component
@ConditionalOnProperty(name = "app.data-mode", havingValue = "live", matchIfMissing = true)
class RailSearch {
    private static final ZoneId WARSAW = ZoneId.of("Europe/Warsaw");
    private final SkmTimetable timetable;
    private final ConnectionDiscovery discovery;
    private final Clock clock;
    private final int dailyLimit;
    private LocalDate budgetDate;
    private int usedRequests;

    RailSearch(SkmTimetable timetable, ObjectProvider<ConnectionDiscovery> discovery, Clock clock,
            @Value("${app.ai.daily-requests:20}") int dailyLimit) {
        this.timetable = timetable;
        this.discovery = discovery.getIfAvailable();
        this.clock = clock;
        this.dailyLimit = Math.max(0, dailyLimit);
    }

    PlaceCatalog places() { return timetable.places(); }

    Criteria canonicalCriteria(Criteria criteria) {
        if (!timetable.supports(criteria.origin(), criteria.destination())) return null;
        return new Criteria(timetable.canonicalPlace(criteria.origin()), timetable.canonicalPlace(criteria.destination()),
                criteria.departureDate(), criteria.returnDate(), criteria.priority(), criteria.currency(), criteria.fareType());
    }

    boolean ambiguous(String place) {
        if (timetable.canonicalPlace(place) != null) return false;
        List<String> terms = List.of(PlaceNames.normalize(place).split(" "));
        return timetable.places().places().stream().filter(candidate -> {
            String name = PlaceNames.normalize(candidate.label());
            return terms.stream().allMatch(name::contains);
        }).limit(2).count() > 1;
    }

    Catalog search(Criteria criteria, boolean withDiscovery) {
        Catalog verified = timetable.search(criteria);
        List<RoundTrip> planned = verified.options().stream().map(trip -> withSchedule(trip, verified.sources())).toList();
        if (!withDiscovery || planned.isEmpty()) return withOptions(verified, planned);
        if (discovery == null || !discovery.enabled()) return withSource(verified, planned,
                SourceStatus.NO_COVERAGE, "AI_NOT_CONFIGURED", "Wyniki pochodzą z rozkładu SKM. Wyszukiwanie AI jest wyłączone.");
        if (!takeRequest()) return withSource(verified, planned,
                SourceStatus.PROVIDER_ERROR, "AI_UNAVAILABLE", "Wyczerpano dzienny limit wyszukiwania AI.");

        List<Candidate> candidates;
        try { candidates = discovery.discover(criteria); }
        catch (RuntimeException failed) {
            return withSource(verified, planned, SourceStatus.PROVIDER_ERROR, "AI_UNAVAILABLE",
                    "Wyszukiwanie AI jest chwilowo niedostępne. Wyniki pochodzą z rozkładu SKM.");
        }

        // URLs from the model's cited results are display-only. GTFS is retrieved independently.
        Map<String, String> sourcesBySegment = new HashMap<>();
        List<Segment> known = planned.stream().flatMap(trip -> Stream.concat(
                trip.outbound().segments().stream(), trip.returnJourney().segments().stream())).distinct().toList();
        for (Candidate candidate : candidates) {
            String from = timetable.canonicalPlace(candidate.origin());
            String to = timetable.canonicalPlace(candidate.destination());
            known.stream().filter(segment -> segment.origin().name().equals(from) && segment.destination().name().equals(to)
                    && segment.departureAt().isEqual(candidate.departureAt())
                    && segment.arrivalAt().isEqual(candidate.arrivalAt()))
                    .forEach(segment -> sourcesBySegment.putIfAbsent(segment.id(), candidate.sourceUrl()));
        }
        List<RoundTrip> discovered = planned.stream()
                .filter(trip -> isDiscovered(trip.outbound(), sourcesBySegment) && isDiscovered(trip.returnJourney(), sourcesBySegment))
                .map(trip -> replaceJourneys(trip, cite(trip.outbound(), sourcesBySegment), cite(trip.returnJourney(), sourcesBySegment)))
                .toList();
        if (discovered.isEmpty()) return withSource(verified, planned, SourceStatus.NO_COVERAGE, "AI_NO_MATCH",
                "Nie udało się potwierdzić w rozkładzie kompletnych propozycji AI. Wyniki pochodzą z rozkładu SKM.");
        return withSource(verified, discovered, SourceStatus.OK, "AI_VERIFIED",
                "Kursy znalezione przez AI zostały potwierdzone w planowanym rozkładzie SKM.");
    }

    private synchronized boolean takeRequest() {
        LocalDate today = LocalDate.now(clock.withZone(WARSAW));
        if (!today.equals(budgetDate)) {
            budgetDate = today;
            usedRequests = 0;
        }
        if (usedRequests >= dailyLimit) return false;
        usedRequests++;
        return true;
    }

    private static RoundTrip withSchedule(RoundTrip trip, List<Source> sources) {
        Source acquisition = sources.stream().filter(source -> source.sourceId().equals(SkmTimetable.SOURCE_ID)).findFirst().orElseThrow();
        OffsetDateTime published = sources.stream().filter(source -> source.sourceId().equals(SkmTimetable.PUBLICATION_ID))
                .findFirst().map(Source::checkedAt).orElse(null);
        return replaceJourneys(trip, provenance(trip.outbound(), acquisition, published),
                provenance(trip.returnJourney(), acquisition, published));
    }

    private static Journey provenance(Journey journey, Source source, OffsetDateTime published) {
        return new Journey(journey.departureAt(), journey.arrivalAt(), journey.segments().stream().map(segment -> new Segment(
                segment.id(), segment.mode(), segment.operator(), segment.origin(), segment.destination(), segment.departureAt(),
                segment.arrivalAt(), segment.prices(), segment.bookingUrl(), segment.mapUrl(), source.url(),
                ScheduleBasis.PLANNED, published, source.checkedAt(), null)).toList());
    }

    private static boolean isDiscovered(Journey journey, Map<String, String> sources) {
        return journey.segments().stream().allMatch(segment -> sources.containsKey(segment.id()));
    }

    private static Journey cite(Journey journey, Map<String, String> sources) {
        return new Journey(journey.departureAt(), journey.arrivalAt(), journey.segments().stream().map(segment -> new Segment(
                segment.id(), segment.mode(), segment.operator(), segment.origin(), segment.destination(), segment.departureAt(),
                segment.arrivalAt(), segment.prices(), segment.bookingUrl(), segment.mapUrl(), segment.scheduleSourceUrl(),
                segment.scheduleBasis(), segment.schedulePublishedAt(), segment.scheduleCheckedAt(), sources.get(segment.id()))).toList());
    }

    private static RoundTrip replaceJourneys(RoundTrip trip, Journey outbound, Journey returning) {
        return new RoundTrip(trip.id(), outbound, returning, trip.travelMinutes(), trip.transfers(),
                trip.timeAtDestinationMinutes(), trip.costSummary(), trip.recommendedAttractionIds());
    }

    private static Catalog withOptions(Catalog catalog, List<RoundTrip> options) {
        return new Catalog(options, catalog.attractions(), catalog.sources(), catalog.status(), catalog.testData());
    }

    private static Catalog withSource(Catalog catalog, List<RoundTrip> options, SourceStatus status, String code, String message) {
        List<Source> sources = new ArrayList<>(catalog.sources());
        sources.add(new Source("ai-search", null, null, status, message, code));
        return new Catalog(options, catalog.attractions(), List.copyOf(sources), catalog.status(), catalog.testData());
    }
}
