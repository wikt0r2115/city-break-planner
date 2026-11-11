package pl.citybreak.planning;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.*;
import pl.citybreak.provider.TravelProvider;

/** Pure planning rules. Explicit user times and item order are preserved on every recalculation. */
@Component
public class Planner {
    private final TravelProvider provider;
    public Planner(TravelProvider provider) { this.provider = provider; }

    public List<RoundTrip> rank(Criteria criteria, List<RoundTrip> options, List<Attraction> attractions) {
        List<RoundTrip> enriched = new ArrayList<>();
        for (RoundTrip option : options) {
            List<ItemInput> candidates = new ArrayList<>();
            for (Attraction attraction : attractions) {
                var attempted = new ArrayList<>(candidates);
                attempted.add(new ItemInput("recommend-" + attraction.id(), attraction.id(), null, attraction.visitMinutes()));
                List<PlanItem> schedule = schedule(option, attempted, attractions);
                if (schedule.stream().allMatch(item -> item.conflicts().isEmpty())) candidates = attempted;
            }
            List<String> recommended = candidates.stream().map(ItemInput::attractionId).toList();
            CostSummary total = cost(criteria, option, recommended, attractions);
            enriched.add(new RoundTrip(option.id(), option.outbound(), option.returnJourney(), option.travelMinutes(),
                    option.transfers(), option.timeAtDestinationMinutes(), total, recommended));
        }
        Comparator<RoundTrip> tie = Comparator.comparingLong(RoundTrip::travelMinutes)
                .thenComparingInt(RoundTrip::transfers).thenComparing(RoundTrip::id);
        Comparator<RoundTrip> main = switch (criteria.priority()) {
            case LOWEST_TOTAL_COST -> Comparator.comparing((RoundTrip trip) -> !trip.costSummary().complete())
                    .thenComparing(trip -> trip.costSummary().complete()
                            ? new BigDecimal(trip.costSummary().total()) : BigDecimal.ZERO);
            case SHORTEST_TRAVEL_TIME -> Comparator.comparingLong(RoundTrip::travelMinutes);
            case FEWEST_TRANSFERS -> Comparator.comparingInt(RoundTrip::transfers);
            case MOST_TIME_AT_DESTINATION -> Comparator.comparingLong(RoundTrip::timeAtDestinationMinutes).reversed();
        };
        enriched.sort(main.thenComparing(tie));
        return List.copyOf(enriched);
    }

    public List<PlanItem> schedule(RoundTrip trip, List<ItemInput> inputs, List<Attraction> attractions) {
        Map<String, Attraction> catalog = new HashMap<>();
        attractions.forEach(attraction -> catalog.put(attraction.id(), attraction));
        List<PlanItem> result = new ArrayList<>();
        OffsetDateTime previousEnd = trip.outbound().arrivalAt();
        Place previousPlace = last(trip.outbound()).destination();
        Place returnPlace = trip.returnJourney().segments().get(0).origin();
        for (ItemInput input : inputs) {
            Attraction attraction = catalog.get(input.attractionId());
            List<Conflict> conflicts = new ArrayList<>();
            Integer transfer = provider.transferMinutes(previousPlace, attraction.location());
            OffsetDateTime earliest = previousEnd.plusMinutes(transfer == null ? 0 : transfer);
            OffsetDateTime start = input.startsAt() == null
                    ? earliestStart(earliest, input.visitMinutes(), attraction.openingHours()) : input.startsAt();
            OffsetDateTime end = start.plusMinutes(input.visitMinutes());
            if (transfer == null) add(conflicts, ConflictCode.MISSING_DATA, "Brak potwierdzonego czasu dotarcia do atrakcji.", input.id());
            if (start.isBefore(earliest) || start.isBefore(trip.outbound().arrivalAt()))
                add(conflicts, ConflictCode.TRANSFER_TIME, "Nie wystarczy czasu na dotarcie po poprzednim punkcie lub przyjeździe.", input.id());
            OpeningHours opening = attraction.openingHours();
            if (opening == null || opening.status() == OpeningStatus.UNKNOWN)
                add(conflicts, ConflictCode.MISSING_DATA, "Nie potwierdzono godzin otwarcia atrakcji.", input.id());
            else if (opening.intervals().stream().noneMatch(interval -> !start.isBefore(interval.opensAt()) && !end.isAfter(interval.closesAt())))
                add(conflicts, ConflictCode.OPENING_HOURS, "Wizyta nie mieści się w potwierdzonych godzinach otwarcia.", input.id());
            Integer toReturn = provider.transferMinutes(attraction.location(), returnPlace);
            if (toReturn == null) add(conflicts, ConflictCode.MISSING_DATA, "Brak potwierdzonego czasu dojazdu na powrót.", input.id());
            if (end.plusMinutes(toReturn == null ? 0 : toReturn).isAfter(trip.returnJourney().departureAt()))
                add(conflicts, ConflictCode.RETURN_DEPARTURE, "Wizyta wraz z dojazdem kończy się po odjeździe powrotnym.", input.id());
            result.add(new PlanItem(input.id(), input.attractionId(), attraction.name(), start, end, transfer, List.copyOf(conflicts)));
            if (end.isAfter(previousEnd)) previousEnd = end;
            previousPlace = attraction.location();
        }
        return List.copyOf(result);
    }

    public CostSummary cost(Criteria criteria, RoundTrip trip, List<String> attractionIds, List<Attraction> attractions) {
        BigDecimal total = BigDecimal.ZERO;
        List<String> missing = new ArrayList<>();
        for (Journey journey : List.of(trip.outbound(), trip.returnJourney())) {
            for (Segment segment : journey.segments()) {
                BigDecimal amount = price(segment.prices(), criteria);
                if (amount == null) missing.add("segment:" + segment.id()); else total = total.add(amount);
            }
        }
        Map<String, Attraction> catalog = new HashMap<>();
        attractions.forEach(attraction -> catalog.put(attraction.id(), attraction));
        for (String id : attractionIds) {
            Attraction attraction = catalog.get(id);
            BigDecimal amount = attraction == null ? null : price(attraction.entryPrices(), criteria);
            if (amount == null) missing.add("attraction:" + id); else total = total.add(amount);
        }
        return new CostSummary(missing.isEmpty() ? total.setScale(2).toPlainString() : null,
                criteria.currency(), criteria.fareType(), missing.isEmpty(), List.copyOf(missing));
    }

    private BigDecimal price(List<Price> prices, Criteria criteria) {
        if (prices == null) return null;
        for (Price price : prices) {
            if (price.status() != PriceStatus.KNOWN || price.fareType() != criteria.fareType()
                    || !criteria.currency().equals(price.currency()) || price.amount() == null
                    || price.sourceId() == null || price.sourceUrl() == null || price.checkedAt() == null
                    || (price.fareType() == FareType.REDUCED && (price.eligibility() == null || price.eligibility().isBlank()))) continue;
            try {
                BigDecimal amount = new BigDecimal(price.amount());
                if (amount.signum() >= 0 && amount.scale() <= 2) return amount;
            } catch (NumberFormatException ignored) { /* Missing data is not a zero cost. */ }
        }
        return null;
    }
    private OffsetDateTime earliestStart(OffsetDateTime earliest, int minutes, OpeningHours opening) {
        if (opening == null || opening.status() == OpeningStatus.UNKNOWN) return earliest;
        return opening.intervals().stream().sorted(Comparator.comparing(OpeningInterval::opensAt))
                .map(interval -> earliest.isAfter(interval.opensAt()) ? earliest : interval.opensAt())
                .filter(start -> opening.intervals().stream().anyMatch(interval -> !start.isBefore(interval.opensAt())
                        && !start.plusMinutes(minutes).isAfter(interval.closesAt())))
                .findFirst().orElse(earliest);
    }
    private static Segment last(Journey journey) { return journey.segments().get(journey.segments().size() - 1); }
    private static void add(List<Conflict> conflicts, ConflictCode code, String reason, String id) {
        conflicts.add(new Conflict(code, reason, id));
    }
}
