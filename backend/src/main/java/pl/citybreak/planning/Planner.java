package pl.citybreak.planning;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.ZoneId;
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
        return options.stream().map(option -> withRecommendations(criteria, option, attractions))
                .sorted(main.thenComparing(tie)).toList();
    }

    public RoundTrip withRecommendations(Criteria criteria, RoundTrip option, List<Attraction> attractions) {
        List<ItemInput> candidates = new ArrayList<>();
        for (Attraction attraction : attractions) {
            candidates.add(new ItemInput("recommend-" + attraction.id(), attraction.id(), null, attraction.visitMinutes()));
            if (schedule(option, candidates, attractions).stream().anyMatch(item -> !item.conflicts().isEmpty()))
                candidates.remove(candidates.size() - 1);
        }
        List<String> recommended = candidates.stream().map(ItemInput::attractionId).toList();
        return new RoundTrip(option.id(), option.outbound(), option.returnJourney(), option.travelMinutes(),
                option.transfers(), option.timeAtDestinationMinutes(), cost(criteria, option, recommended, attractions), recommended);
    }

    public List<PlanItem> schedule(RoundTrip trip, List<ItemInput> inputs, List<Attraction> attractions) {
        return schedule(trip, inputs, attractions, null);
    }

    public List<PlanItem> schedule(RoundTrip trip, List<ItemInput> inputs, List<Attraction> attractions, Place lodging) {
        Map<String, Attraction> catalog = new HashMap<>();
        attractions.forEach(attraction -> catalog.put(attraction.id(), attraction));
        List<PlanItem> result = new ArrayList<>();
        OffsetDateTime previousEnd = trip.outbound().arrivalAt();
        Place previousPlace = last(trip.outbound()).destination();
        Place returnPlace = trip.returnJourney().segments().get(0).origin();
        String destinationZone = previousPlace.timeZone();
        ZoneId zone = destinationZone == null ? trip.outbound().arrivalAt().getOffset() : ZoneId.of(destinationZone);
        for (ItemInput input : inputs) {
            Attraction attraction = catalog.get(input.attractionId());
            List<Conflict> conflicts = new ArrayList<>();
            Integer transfer = provider.transferMinutes(previousPlace, attraction.location());
            OffsetDateTime earliest = previousEnd.plusMinutes(transfer == null ? 0 : transfer);
            OffsetDateTime start = input.startsAt() == null
                    ? earliestStart(earliest, input.visitMinutes(), attraction.openingHours()) : input.startsAt();
            TransferBasis transferBasis = null;
            String transferFrom = null;
            // The hotel is a base between days, not a waypoint between every visit.
            // Include arrival -> hotel for the first visit and the return to the
            // hotel from the preceding day's final visit for later day starts.
            boolean viaLodging = lodging != null && (result.isEmpty()
                    || start.atZoneSameInstant(zone).toLocalDate().isAfter(previousEnd.atZoneSameInstant(zone).toLocalDate()));
            if (viaLodging) {
                Integer toHotel = estimatedWalkingMinutes(previousPlace, lodging);
                Integer fromHotel = estimatedWalkingMinutes(lodging, attraction.location());
                transfer = toHotel == null || fromHotel == null ? null : toHotel + fromHotel;
                earliest = previousEnd.plusMinutes(transfer == null ? 0 : transfer);
                if (input.startsAt() == null) start = earliestStart(earliest, input.visitMinutes(), attraction.openingHours());
                transferBasis = TransferBasis.ESTIMATED_WALKING;
                transferFrom = previousPlace.name() + " → " + lodging.name();
            }
            OffsetDateTime end = start.plusMinutes(input.visitMinutes());
            if (transfer == null) add(conflicts, ConflictCode.MISSING_DATA, "Brak potwierdzonego czasu dotarcia do atrakcji.", input.id());
            if (start.isBefore(earliest) || start.isBefore(trip.outbound().arrivalAt()))
                add(conflicts, ConflictCode.TRANSFER_TIME, "Nie wystarczy czasu na dotarcie po poprzednim punkcie lub przyjeździe.", input.id());
            OpeningHours opening = attraction.openingHours();
            OffsetDateTime visitStart = start;
            if (opening == null || opening.status() == OpeningStatus.UNKNOWN)
                add(conflicts, ConflictCode.MISSING_DATA, "Nie potwierdzono godzin otwarcia atrakcji.", input.id());
            else if (opening.intervals().stream().noneMatch(interval -> containsVisit(interval, visitStart, end)))
                add(conflicts, ConflictCode.OPENING_HOURS, "Wizyta nie mieści się w potwierdzonych godzinach otwarcia.", input.id());
            Integer toReturn = provider.transferMinutes(attraction.location(), returnPlace);
            if (toReturn == null) add(conflicts, ConflictCode.MISSING_DATA, "Brak potwierdzonego czasu dojazdu na powrót.", input.id());
            if (end.plusMinutes(toReturn == null ? 0 : toReturn).isAfter(trip.returnJourney().departureAt()))
                add(conflicts, ConflictCode.RETURN_DEPARTURE, "Wizyta wraz z dojazdem kończy się po odjeździe powrotnym.", input.id());
            boolean automaticTime = input.startsAt() == null || Boolean.TRUE.equals(input.automaticTime());
            result.add(new PlanItem(input.id(), input.attractionId(), attraction.name(), start, end, transfer,
                    List.copyOf(conflicts), automaticTime, attraction.location(), transferBasis, transferFrom));
            if (end.isAfter(previousEnd)) previousEnd = end;
            previousPlace = attraction.location();
        }
        return List.copyOf(result);
    }

    /** Geometric walking estimate, not a routed journey or a provider-confirmed duration. */
    static Integer estimatedWalkingMinutes(Place from, Place to) {
        if (!coordinates(from) || !coordinates(to)) return null;
        double lat1 = Math.toRadians(from.latitude());
        double lat2 = Math.toRadians(to.latitude());
        double latitude = lat2 - lat1;
        double longitude = Math.toRadians(to.longitude() - from.longitude());
        double a = Math.pow(Math.sin(latitude / 2), 2)
                + Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(longitude / 2), 2);
        double kilometers = 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
        return (int) Math.ceil(kilometers * 1.3 / 4.5 * 60);
    }

    private static boolean coordinates(Place place) {
        return place != null && place.latitude() != null && place.longitude() != null
                && Double.isFinite(place.latitude()) && Math.abs(place.latitude()) <= 90
                && Double.isFinite(place.longitude()) && Math.abs(place.longitude()) <= 180;
    }

    public CostSummary cost(Criteria criteria, RoundTrip trip, List<String> attractionIds, List<Attraction> attractions) {
        BigDecimal total = BigDecimal.ZERO;
        List<String> missing = new ArrayList<>();
        for (Journey journey : List.of(trip.outbound(), trip.returnJourney())) {
            for (Segment segment : journey.segments()) {
                BigDecimal amount = comparablePrice(segment.prices(), criteria);
                if (amount == null) missing.add("segment:" + segment.id()); else total = total.add(amount);
            }
        }
        Map<String, Attraction> catalog = new HashMap<>();
        attractions.forEach(attraction -> catalog.put(attraction.id(), attraction));
        for (String id : attractionIds) {
            Attraction attraction = catalog.get(id);
            BigDecimal amount = attraction == null ? null : comparablePrice(attraction.entryPrices(), criteria);
            if (amount == null) missing.add("attraction:" + id); else total = total.add(amount);
        }
        return new CostSummary(missing.isEmpty() ? total.multiply(BigDecimal.valueOf(criteria.travelers())).setScale(2).toPlainString() : null,
                criteria.currency(), criteria.fareType(), missing.isEmpty(), List.copyOf(missing));
    }

    /** Returns null when the catalog has no comparable amount for the selected tariff and currency. */
    public BigDecimal comparablePrice(List<Price> prices, Criteria criteria) {
        if (prices == null) return null;
        for (Price price : prices) {
            if (price.status() != PriceStatus.KNOWN || price.fareType() != criteria.fareType()
                    || !criteria.currency().equals(price.currency()) || price.amount() == null || price.sourceId() == null) continue;
            boolean demo = price.testData() && price.basis() == PriceBasis.TEST_DATA;
            if (!demo && (price.sourceUrl() == null || price.checkedAt() == null
                    || (price.fareType() == FareType.REDUCED && (price.eligibility() == null || price.eligibility().isBlank())))) continue;
            try {
                BigDecimal amount = new BigDecimal(price.amount());
                if (amount.signum() >= 0 && amount.scale() <= 2) return amount;
            } catch (NumberFormatException ignored) { /* Missing data is not a zero cost. */ }
        }
        return null;
    }
    private static OffsetDateTime earliestStart(OffsetDateTime earliest, int minutes, OpeningHours opening) {
        if (opening == null || opening.status() == OpeningStatus.UNKNOWN) return earliest;
        OffsetDateTime best = null;
        for (OpeningInterval interval : opening.intervals()) {
            OffsetDateTime start = earliest.isAfter(interval.opensAt()) ? earliest : interval.opensAt();
            if (containsVisit(interval, start, start.plusMinutes(minutes)) && (best == null || start.isBefore(best)))
                best = start;
        }
        return best == null ? earliest : best;
    }

    private static boolean containsVisit(OpeningInterval interval, OffsetDateTime start, OffsetDateTime end) {
        return !start.isBefore(interval.opensAt()) && !end.isAfter(interval.closesAt());
    }
    private static Segment last(Journey journey) { return journey.segments().get(journey.segments().size() - 1); }
    private static void add(List<Conflict> conflicts, ConflictCode code, String reason, String id) {
        conflicts.add(new Conflict(code, reason, id));
    }
}
