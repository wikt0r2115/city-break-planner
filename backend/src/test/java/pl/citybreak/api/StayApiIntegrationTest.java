package pl.citybreak.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"app.obo.enabled=false", "spring.datasource.url=jdbc:sqlite::memory:"})
@AutoConfigureMockMvc
class StayApiIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    @Test void disabledProviderUsesTypedStatusWithoutCachingOrNetwork() throws Exception {
        mvc.perform(post("/api/v1/stays/search").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(criteria())))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.status").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.source").value("OBO Travel"))
                .andExpect(jsonPath("$.hotels").isEmpty()).andExpect(jsonPath("$.criteria.destination").value("Paris, France"))
                .andExpect(jsonPath("$.criteria.rooms").value(1));
    }
    @Test void roomCountDefaultsForLegacyAndSurvivesValidationAndResponseSerialization() throws Exception {
        for (ObjectNode request : new ObjectNode[]{criteria(), criteria().putNull("rooms")}) {
            mvc.perform(post("/api/v1/stays/search").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(request)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.criteria.rooms").value(1));
        }
        mvc.perform(post("/api/v1/stays/search").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(criteria().put("destination", " Paris, France ").put("rooms", 2))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.criteria.rooms").value(2))
                .andExpect(jsonPath("$.criteria.adults").value(2))
                .andExpect(jsonPath("$.criteria.destination").value("Paris, France"));
    }
    @Test void roomCountMustBeAnIntegerWithinAdultOccupancyAndRange() throws Exception {
        for (int rooms : new int[]{0, -1, 9, 3}) {
            mvc.perform(post("/api/v1/stays/search").contentType(MediaType.APPLICATION_JSON)
                            .content(json.writeValueAsBytes(criteria().put("rooms", rooms))))
                    .andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.errors[0].field").value("rooms"));
        }
        for (String body : new String[]{criteria().put("rooms", 1.5).toString(),
                criteria().put("rooms", "2").toString(), criteria().put("rooms", true).toString()}) {
            mvc.perform(post("/api/v1/stays/search").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
        }
        mvc.perform(post("/api/v1/stays/search").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(criteria().put("adults", 8).put("rooms", 8))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.criteria.rooms").value(8));
    }
    @Test void validationAndMalformedJsonAlwaysReturnProblemDetailsAndNoStore() throws Exception {
        LocalDate today = LocalDate.now(ZoneId.of("Europe/Warsaw"));
        ObjectNode invalid = criteria().put("destination", " ").put("checkIn", today.toString())
                .put("checkOut", today.toString()).put("adults", 9).put("currency", "ABC");
        mvc.perform(post("/api/v1/stays/search").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(invalid)))
                .andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.errors.length()").value(5));
        for (String body : new String[]{"{", "null", criteria().put("adults", 1.5).toString(),
                criteria().put("adults", "2").toString(), criteria().put("checkIn", "not-a-date").toString(),
                criteria().put("checkIn", today.plusDays(401).toString()).toString(),
                criteria().put("checkOut", today.plusDays(50).toString()).toString()}) {
            mvc.perform(post("/api/v1/stays/search").contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
        }
    }
    private ObjectNode criteria() {
        LocalDate day = LocalDate.now(ZoneId.of("Europe/Warsaw")).plusDays(7);
        return json.createObjectNode().put("destination", "Paris, France").put("checkIn", day.toString())
                .put("checkOut", day.plusDays(2).toString()).put("adults", 2).put("currency", "PLN");
    }
}
