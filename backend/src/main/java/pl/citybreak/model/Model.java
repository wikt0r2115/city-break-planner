package pl.citybreak.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

/** Shared wire types; business rules live in planning and service packages. */
public final class Model {
    private Model() {}
    public enum Priority { LOWEST_TOTAL_COST, SHORTEST_TRAVEL_TIME, FEWEST_TRANSFERS, MOST_TIME_AT_DESTINATION }
    public enum FareType { STANDARD, REDUCED }
    public enum PriceStatus { KNOWN, UNKNOWN, PROVIDER_ERROR }
    public enum PriceBasis { LIVE_OFFER, PUBLISHED_TARIFF, TEST_DATA }
    public enum SearchStatus { OK, PARTIAL, NO_CONNECTION, PROVIDER_ERROR }
    public enum SourceStatus { OK, NO_CONNECTION, PROVIDER_ERROR, NO_COVERAGE }
    public enum OpeningStatus { KNOWN, UNKNOWN }
    public enum Mode { TRAIN, PLANE, COACH, FERRY, LOCAL_TRANSIT, BUS, METRO, TRAM, WALK }
    public enum ScheduleBasis { PLANNED, REALTIME }
    public enum Interest { CULTURE, OUTDOORS, HISTORY, MIXED }
    public enum ConflictCode { RETURN_DEPARTURE, OPENING_HOURS, TRANSFER_TIME, MISSING_DATA }
    public enum TransferBasis { ESTIMATED_WALKING }
    public record Criteria(String origin, String destination, LocalDate departureDate,
            LocalDate returnDate, Priority priority, String currency, FareType fareType,
            @JsonDeserialize(using = TravelerCountDeserializer.class) Integer travelers) {
        public Criteria {
            if (travelers == null) travelers = 1;
        }
        public Criteria(String origin, String destination, LocalDate departureDate,
                LocalDate returnDate, Priority priority, String currency, FareType fareType) {
            this(origin, destination, departureDate, returnDate, priority, currency, fareType, 1);
        }
    }
    public record Place(String name, Double latitude, Double longitude,
            @JsonInclude(JsonInclude.Include.NON_NULL) String timeZone) {
        public Place(String name, Double latitude, Double longitude) { this(name, latitude, longitude, null); }
    }
    public record PlaceSuggestion(String value, String label) {}
    public record PlaceCatalog(List<PlaceSuggestion> places, boolean testData) {}
    public record Price(PriceStatus status, String amount, String currency, FareType fareType,
            String eligibility, String sourceId, String sourceUrl, OffsetDateTime checkedAt,
            boolean testData, String reason, PriceBasis basis) {
        public Price(PriceStatus status, String amount, String currency, FareType fareType,
                String eligibility, String sourceId, String sourceUrl, OffsetDateTime checkedAt,
                boolean testData, String reason) {
            this(status, amount, currency, fareType, eligibility, sourceId, sourceUrl, checkedAt,
                    testData, reason, testData ? PriceBasis.TEST_DATA : null);
        }
    }
    public record Source(String sourceId, String url, OffsetDateTime checkedAt,
            SourceStatus status, String message, @JsonInclude(JsonInclude.Include.NON_NULL) String reasonCode) {
        public Source(String sourceId, String url, OffsetDateTime checkedAt, SourceStatus status, String message) {
            this(sourceId, url, checkedAt, status, message, null);
        }
    }
    @JsonIgnoreProperties("discoverySourceUrl")
    public record Segment(String id, Mode mode, String operator, Place origin, Place destination,
            OffsetDateTime departureAt, OffsetDateTime arrivalAt, List<Price> prices,
            String bookingUrl, String mapUrl,
            @JsonInclude(JsonInclude.Include.NON_NULL) String scheduleSourceUrl,
            @JsonInclude(JsonInclude.Include.NON_NULL) ScheduleBasis scheduleBasis,
            @JsonInclude(JsonInclude.Include.NON_NULL) OffsetDateTime schedulePublishedAt,
            @JsonInclude(JsonInclude.Include.NON_NULL) OffsetDateTime scheduleCheckedAt) {
        public Segment(String id, Mode mode, String operator, Place origin, Place destination,
                OffsetDateTime departureAt, OffsetDateTime arrivalAt, List<Price> prices,
                String bookingUrl, String mapUrl) {
            this(id, mode, operator, origin, destination, departureAt, arrivalAt, prices, bookingUrl, mapUrl,
                    null, null, null, null);
        }
    }
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
    public record RecommendationInput(Criteria criteria, String roundTripId, Interest interest, Integer budgetPln) {}
    public record Recommendation(String attractionId, String reason) {}
    public record Recommendations(List<Recommendation> suggestions) {}
    public record ItemInput(String id, String attractionId, OffsetDateTime startsAt, Integer visitMinutes,
            Boolean automaticTime) {
        public ItemInput(String id, String attractionId, OffsetDateTime startsAt, Integer visitMinutes) {
            this(id, attractionId, startsAt, visitMinutes, null);
        }
    }
    public record PlanInput(Criteria criteria, RoundTrip selectedRoundTrip, List<ItemInput> items,
            @JsonInclude(JsonInclude.Include.NON_NULL) Place lodging) {
        public PlanInput(Criteria criteria, RoundTrip selectedRoundTrip, List<ItemInput> items) {
            this(criteria, selectedRoundTrip, items, null);
        }
    }
    public record Conflict(ConflictCode code, String reason, String itemId) {}
    public record PlanItem(String id, String attractionId, String name, OffsetDateTime startsAt,
            OffsetDateTime endsAt, Integer transferMinutesFromPrevious, List<Conflict> conflicts,
            boolean automaticTime, Place location,
            @JsonInclude(JsonInclude.Include.NON_NULL) TransferBasis transferBasis,
            @JsonInclude(JsonInclude.Include.NON_NULL) String transferFrom) {
        public PlanItem(String id, String attractionId, String name, OffsetDateTime startsAt,
                OffsetDateTime endsAt, Integer transferMinutesFromPrevious, List<Conflict> conflicts,
                boolean automaticTime, Place location) {
            this(id, attractionId, name, startsAt, endsAt, transferMinutesFromPrevious, conflicts,
                    automaticTime, location, null, null);
        }
    }
    public record Plan(String id, Criteria criteria, RoundTrip selectedRoundTrip, List<PlanItem> items,
            CostSummary costSummary, OffsetDateTime createdAt, OffsetDateTime updatedAt,
            boolean testData, @JsonInclude(JsonInclude.Include.NON_NULL) String shareUrl,
            @JsonInclude(JsonInclude.Include.NON_NULL) Place lodging) {
        public Plan(String id, Criteria criteria, RoundTrip selectedRoundTrip, List<PlanItem> items,
                CostSummary costSummary, OffsetDateTime createdAt, OffsetDateTime updatedAt,
                boolean testData, String shareUrl) {
            this(id, criteria, selectedRoundTrip, items, costSummary, createdAt, updatedAt, testData, shareUrl, null);
        }
    }
    public record CreatedPlan(Plan plan, String ownerToken) {}
    public record FieldError(String field, String message) {}
}
