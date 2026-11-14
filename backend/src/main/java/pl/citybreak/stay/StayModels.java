package pl.citybreak.stay;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public final class StayModels {
    private StayModels() {}
    public enum Status { OK, EMPTY, PARTIAL, PROVIDER_ERROR, RATE_LIMITED, UNAVAILABLE }
    public record Criteria(String destination, LocalDate checkIn, LocalDate checkOut,
            @JsonDeserialize(using = StrictInteger.class) Integer adults, String currency,
            @JsonDeserialize(using = StrictInteger.class) Integer rooms) {
        public Criteria {
            if (rooms == null) rooms = 1;
        }
        public Criteria(String destination, LocalDate checkIn, LocalDate checkOut, Integer adults, String currency) {
            this(destination, checkIn, checkOut, adults, currency, 1);
        }
    }
    public static final class StrictInteger extends JsonDeserializer<Integer> {
        @Override public Integer deserialize(JsonParser parser, DeserializationContext context) throws IOException {
            if (parser.currentToken() != JsonToken.VALUE_NUMBER_INT)
                return (Integer) context.handleUnexpectedToken(Integer.class, parser);
            return parser.getIntValue();
        }
    }
    public record ExtraCharge(String name, String amount, String currency, String payableAt) {}
    public record Location(Double latitude, Double longitude) {}
    public record Hotel(String hotelToken, String name, Double stars, String totalPrice, String nightlyPrice,
            String currency, String bookingUrl, Boolean taxesIncluded, Boolean feesIncluded,
            List<ExtraCharge> extraCharges, String inclusionsNote, Instant quotedAt, Instant expiresAt,
            String photoUrl, Location location) {}
    public record SearchResponse(Status status, String source, Instant checkedAt, Instant expiresAt,
            Criteria criteria, List<Hotel> hotels, String message, Integer retryAfterSeconds) {}
}
