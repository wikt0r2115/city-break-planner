package pl.citybreak.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "app.cors.allowed-origins=http://localhost:5173")
@AutoConfigureMockMvc
class HealthIntegrationTest {
    private static final Path DATABASE = temporaryDatabase();

    @Autowired private MockMvc mvc;
    @Autowired private JdbcTemplate jdbcTemplate;
    @Autowired private ObjectMapper json;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATABASE);
    }

    @Test
    void healthChecksRealSqliteDatabase() throws Exception {
        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(content().json("{\"status\":\"UP\",\"database\":\"UP\"}"));
        assertThat(Files.isRegularFile(DATABASE)).isTrue();
        assertThat(jdbcTemplate.queryForObject("SELECT sqlite_version()", String.class)).isNotBlank();
    }

    @Test
    void demoCityNormalizationPreservesGroupSizeAndPricesAllTravelers() throws Exception {
        LocalDate departure = LocalDate.now(ZoneId.of("Europe/Warsaw")).plusDays(7);
        var criteria = json.createObjectNode().put("origin", "London").put("destination", "Paris")
                .put("departureDate", departure.toString()).put("returnDate", departure.plusDays(2).toString())
                .put("priority", "LOWEST_TOTAL_COST").put("currency", "PLN").put("fareType", "STANDARD");
        var single = json.readTree(mvc.perform(post("/api/v1/searches").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(criteria))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
        criteria.put("travelers", 3);
        var group = json.readTree(mvc.perform(post("/api/v1/searches").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(criteria))).andExpect(status().isOk())
                .andExpect(jsonPath("$.criteria.origin").value("Londyn"))
                .andExpect(jsonPath("$.criteria.destination").value("Paryż"))
                .andExpect(jsonPath("$.criteria.travelers").value(3))
                .andReturn().getResponse().getContentAsString());
        assertThat(group.at("/roundTripOptions/0/id").asText()).isEqualTo(single.at("/roundTripOptions/0/id").asText());
        var singleTotal = new java.math.BigDecimal(single.at("/roundTripOptions/0/costSummary/total").asText());
        var groupTotal = new java.math.BigDecimal(group.at("/roundTripOptions/0/costSummary/total").asText());
        assertThat(groupTotal).isEqualByComparingTo(singleTotal.multiply(java.math.BigDecimal.valueOf(3)));
        assertThat(group.at("/roundTripOptions/0/outbound/segments/0/prices"))
                .isEqualTo(single.at("/roundTripOptions/0/outbound/segments/0/prices"));
    }

    @Test
    void permitsConfiguredFrontendOrigin() throws Exception {
        mvc.perform(get("/api/v1/health").header("Origin", "http://localhost:5173"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
    }

    @Test
    void acceptsFrontendPreflightForAuthorizationAndJson() throws Exception {
        mvc.perform(options("/api/v1/health")
                        .header("Origin", "http://localhost:5173")
                        .header("Access-Control-Request-Method", "GET")
                        .header("Access-Control-Request-Headers", "Authorization,Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"));
    }

    @Test
    void rejectsOtherOrigins() throws Exception {
        mvc.perform(get("/api/v1/health").header("Origin", "https://untrusted.example"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void rejectsPreflightForOtherOrigins() throws Exception {
        mvc.perform(options("/api/v1/health")
                        .header("Origin", "https://untrusted.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void unknownEndpointsHaveProblemResponse() throws Exception {
        mvc.perform(get("/api/v1/unknown-endpoint"))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.instance").value("/api/v1/unknown-endpoint"));
    }

    @Test
    void unsupportedHealthMethodHasProblemResponse() throws Exception {
        mvc.perform(post("/api/v1/health"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.status").value(405));
    }

    private static Path temporaryDatabase() {
        try {
            Path directory = Files.createTempDirectory("city-break-health-");
            Path database = directory.resolve("health.db");
            directory.toFile().deleteOnExit();
            database.toFile().deleteOnExit();
            return database;
        } catch (IOException exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
