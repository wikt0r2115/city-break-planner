package pl.citybreak.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

/** Shared wire types; business rules live in planning and service packages. */
public final class Model {
    private Model() {}
    public enum Priority { LOWEST_TOTAL_COST, SHORTEST_TRAVEL_TIME, FEWEST_TRANSFERS, MOST_TIME_AT_DESTINATION }
    public enum FareType { STANDARD, REDUCED }
    public enum PriceStatus { KNOWN, UNKNOWN, PROVIDER_ERROR }
    public enum SearchStatus { OK, PARTIAL, NO_CONNECTION, PROVIDER_ERROR }
    public enum SourceStatus { OK, NO_CONNECTION, PROVIDER_ERROR }
    public enum OpeningStatus { KNOWN, UNKNOWN }
    public enum Mode { TRAIN, PLANE, COACH, FERRY, LOCAL_TRANSIT, WALK }
    public enum ConflictCode { RETURN_DEPARTURE, OPENING_HOURS, TRANSFER_TIME, MISSING_DATA }
    public record Criteria(String origin, String destination, LocalDate departureDate,
            LocalDate returnDate, Priority priority, String currency, FareType fareType) {}
    public record Place(String name, Double latitude, Double longitude) {}
    public record Price(PriceStatus status, String amount, String currency, FareType fareType,
            String eligibility, String sourceId, String sourceUrl, OffsetDateTime checkedAt,
            boolean testData, String reason) {}
    public record Source(String sourceId, String url, OffsetDateTime checkedAt,
            SourceStatus status, String message) {}
    public record Segment(String id, Mode mode, String operator, Place origin, Place destination,
            OffsetDateTime departureAt, OffsetDateTime arrivalAt, List<Price> prices,
            String bookingUrl, String mapUrl) {}
    public record Journey(OffsetDateTime departureAt, OffsetDateTime arrivalAt, List<Segment> segments) {}
    public record CostSummary(String total, String currency, FareType fareType,
            boolean complete, List<String> missingComponents) {}
    public record RoundTrip(String id, Journey outbound, Journey returnJourney, long travelMinutes,
            int transfers, long timeAtDestinationMinutes, CostSummary costSummary,
            List<String> recommendedAttractionIds) {}
    public record OpeningInterval(OffsetDateTime opensAt, OffsetDateTime closesAt) {}
    public record OpeningHours(OpeningStatus status, List<OpeningInterval> intervals) {}
    public record Attraction(String id, String name, Place location, int visitMinutes,
            List<Price> entryPrices, OpeningHours openingHours, List<Source> sources) {}
    public record SearchResponse(String searchId, Criteria criteria, SearchStatus status,
            List<RoundTrip> roundTripOptions, List<Attraction> attractions,
            List<Source> sources, boolean testData) {}
    public record ItemInput(String id, String attractionId, OffsetDateTime startsAt, Integer visitMinutes) {}
    public record PlanInput(Criteria criteria, RoundTrip selectedRoundTrip, List<ItemInput> items) {}
    public record Conflict(ConflictCode code, String reason, String itemId) {}
    public record PlanItem(String id, String attractionId, String name, OffsetDateTime startsAt,
            OffsetDateTime endsAt, Integer transferMinutesFromPrevious, List<Conflict> conflicts) {}
    public record Plan(String id, Criteria criteria, RoundTrip selectedRoundTrip, List<PlanItem> items,
            CostSummary costSummary, OffsetDateTime createdAt, OffsetDateTime updatedAt,
            boolean testData, @JsonInclude(JsonInclude.Include.NON_NULL) String shareUrl) {}
    public record CreatedPlan(Plan plan, String ownerToken) {}
    public record FieldError(String field, String message) {}
}
