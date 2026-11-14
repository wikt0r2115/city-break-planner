package pl.citybreak.model;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import java.io.IOException;

/** A group size is an integer; Jackson must not silently truncate a fractional input. */
public final class TravelerCountDeserializer extends JsonDeserializer<Integer> {
    @Override public Integer deserialize(JsonParser parser, DeserializationContext context) throws IOException {
        if (!parser.hasToken(JsonToken.VALUE_NUMBER_INT))
            return context.reportInputMismatch(Integer.class, "Liczba osób musi być liczbą całkowitą od 1 do 8.");
        return parser.getIntValue();
    }
}
