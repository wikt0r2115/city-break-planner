package pl.citybreak.api;

import static org.assertj.core.api.Assertions.*;
import static org.hamcrest.Matchers.contains;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.*;
import java.time.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import pl.citybreak.persistence.PlanRepository;

@SpringBootTest(properties = {"app.data-mode=fixture", "app.frontend-base-url=http://localhost:5173", "app.cors.allowed-origins=http://localhost:5173"})
@AutoConfigureMockMvc
class PlanApiIntegrationTest {
    private static final Path DATABASE = database();
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired PlanRepository repository;
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + DATABASE);
    }
    @BeforeEach void clearPlans() {
        repository.find("initialize-schema");
        jdbc.update("DELETE FROM plans");
    }
    @Test void fullLifecycleAndIndependentPublicReadFollowUpdates() throws Exception {
        ObjectNode input = input("demo-budget");
        JsonNode created = create(input);
        String id = created.at("/plan/id").asText();
        String owner = created.get("ownerToken").asText();
        String share = share(created);
        assertThat(owner).hasSize(43).doesNotContain(share);
        mvc.perform(get("/api/v1/plans/" + id).header("Authorization", "Bearer " + owner))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.criteria.origin").value("Warszawa"));
        mvc.perform(get("/api/v1/shared-plans/" + share))
                .andExpect(status().isOk()).andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(jsonPath("$.ownerToken").doesNotExist()).andExpect(jsonPath("$.shareUrl").doesNotExist())
                .andExpect(jsonPath("$.id").value(id));
        ((ObjectNode) input.get("criteria")).put("priority", "FEWEST_TRANSFERS");
        mvc.perform(put("/api/v1/plans/" + id).header("Authorization", "Bearer " + owner)
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.criteria.priority").value("FEWEST_TRANSFERS"));
        mvc.perform(get("/api/v1/shared-plans/" + share)).andExpect(status().isOk())
                .andExpect(jsonPath("$.criteria.priority").value("FEWEST_TRANSFERS"));
        mvc.perform(delete("/api/v1/plans/" + id).header("Authorization", "Bearer " + owner))
                .andExpect(status().isNoContent()).andExpect(content().string(""));
        mvc.perform(get("/api/v1/plans/" + id).header("Authorization", "Bearer " + owner)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/shared-plans/" + share)).andExpect(status().isNotFound());
    }
    @Test void missingWrongPublicAndOtherOwnersCannotEditOrDelete() throws Exception {
        ObjectNode input = input("demo-budget");
        JsonNode first = create(input);
        JsonNode second = create(input);
        String id = first.at("/plan/id").asText();
        String otherOwner = second.get("ownerToken").asText();
        mvc.perform(get("/api/v1/plans/" + id)).andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", "Bearer"));
        for (String wrong : new String[]{share(first), otherOwner, "x".repeat(43), "' OR 1=1 --"}) {
            mvc.perform(get("/api/v1/plans/" + id).header("Authorization", "Bearer " + wrong)).andExpect(status().isForbidden());
            mvc.perform(put("/api/v1/plans/" + id).header("Authorization", "Bearer " + wrong)
                            .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                    .andExpect(status().isForbidden());
            mvc.perform(delete("/api/v1/plans/" + id).header("Authorization", "Bearer " + wrong)).andExpect(status().isForbidden());
        }
        mvc.perform(put("/api/v1/shared-plans/" + share(first)).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(input))).andExpect(status().isMethodNotAllowed());
        mvc.perform(delete("/api/v1/shared-plans/" + share(first))).andExpect(status().isMethodNotAllowed());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM plans", Integer.class)).isEqualTo(2);
    }
    @Test void freshRepositoryReadsActualSqliteSnapshotAndOnlyOwnerHashIsStored() throws Exception {
        JsonNode created = create(input("demo-budget"));
        String id = created.at("/plan/id").asText();
        var reopened = new PlanRepository(jdbc, json).find(id).orElseThrow();
        assertThat(reopened.plan().criteria().origin()).isEqualTo("Warszawa");
        assertThat(reopened.plan().selectedRoundTrip().id()).isEqualTo("demo-budget");
        assertThat(reopened.plan().shareUrl()).isNull();
        assertThat(reopened.ownerHash()).hasSize(64).isNotEqualTo(created.get("ownerToken").asText());
        String payload = jdbc.queryForObject("SELECT payload FROM plans WHERE id = ?", String.class, id);
        assertThat(payload).doesNotContain(created.get("ownerToken").asText(), share(created), "ownerToken", "shareUrl");
        assertThat(Files.isRegularFile(DATABASE)).isTrue();
        assertThat(jdbc.queryForObject("PRAGMA user_version", Integer.class)).isEqualTo(1);
    }
    @Test void draftHasExplicitNullIdentityAndNeverCreatesTokensOrRows() throws Exception {
        mvc.perform(post("/api/v1/plans/preview").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(input("demo-budget"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.createdAt").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.shareUrl").doesNotExist()).andExpect(jsonPath("$.ownerToken").doesNotExist());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM plans", Integer.class)).isZero();
    }
    @Test void serverSchedulesNewItemsAndPreservesEveryItemWhenReturnChanges() throws Exception {
        ObjectNode input = input("demo-budget");
        var items = input.putArray("items");
        items.addObject().put("id", "museum").put("attractionId", "demo-museum").putNull("startsAt").put("visitMinutes", 90);
        items.addObject().put("id", "gallery").put("attractionId", "demo-gallery").putNull("startsAt").put("visitMinutes", 60);
        JsonNode created = create(input);
        JsonNode savedItems = created.at("/plan/items");
        for (int i = 0; i < items.size(); i++) {
            ((ObjectNode) items.get(i)).put("startsAt", savedItems.get(i).get("startsAt").asText())
                    .put("automaticTime", savedItems.get(i).get("automaticTime").asBoolean());
        }
        input.set("selectedRoundTrip", option("demo-early"));
        String id = created.at("/plan/id").asText();
        JsonNode shortened = readResponse(mvc.perform(put("/api/v1/plans/" + id).header("Authorization", "Bearer " + created.get("ownerToken").asText())
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value("museum"))
                .andExpect(jsonPath("$.items[1].id").value("gallery"))
                .andExpect(jsonPath("$.items[1].automaticTime").value(true))
                .andExpect(jsonPath("$.items[1].conflicts[0].code").value("RETURN_DEPARTURE")));
        assertThat(visitStart(shortened.at("/items/1"))).isEqualTo(visitStart(savedItems.get(1)));
    }
    @Test void reorderedAutomaticVisitsRescheduleAndManualVisitsStayFixedAcrossReloads() throws Exception {
        ObjectNode input = input("demo-long");
        var initialItems = input.putArray("items");
        var museum = initialItems.addObject().put("id", "museum").put("attractionId", "demo-museum")
                .putNull("startsAt").put("visitMinutes", 90).put("automaticTime", true);
        var park = initialItems.addObject().put("id", "park").put("attractionId", "demo-park")
                .putNull("startsAt").put("visitMinutes", 45);
        JsonNode created = create(input);
        JsonNode original = created.at("/plan/items");
        assertThat(localVisitTime(original.get(0))).isEqualTo(LocalTime.of(9, 15));
        assertThat(localVisitTime(original.get(1))).isEqualTo(LocalTime.of(11, 0));
        String id = created.at("/plan/id").asText();
        String owner = "Bearer " + created.get("ownerToken").asText();

        input.putArray("items").add(park).add(museum);
        JsonNode reordered = readResponse(mvc.perform(put("/api/v1/plans/" + id).header("Authorization", owner)
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(contains("park", "museum")))
                .andExpect(jsonPath("$.items[*].automaticTime").value(contains(true, true)))
                .andExpect(jsonPath("$.items[0].conflicts").isEmpty())
                .andExpect(jsonPath("$.items[1].conflicts").isEmpty()));
        assertThat(localVisitTime(reordered.at("/items/0"))).isEqualTo(LocalTime.of(9, 15));
        assertThat(localVisitTime(reordered.at("/items/1"))).isEqualTo(LocalTime.of(10, 15));

        String fixedStart = reordered.at("/items/0/startsAt").asText();
        park.put("startsAt", fixedStart).put("automaticTime", false);
        input.putArray("items").add(museum).add(park);
        JsonNode withManualTime = readResponse(mvc.perform(put("/api/v1/plans/" + id).header("Authorization", owner)
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(contains("museum", "park")))
                .andExpect(jsonPath("$.items[1].conflicts[0].code").value("TRANSFER_TIME")));
        assertThat(visitStart(withManualTime.at("/items/1"))).isEqualTo(visitStart(reordered.at("/items/0")));
        String savedFixedStart = withManualTime.at("/items/1/startsAt").asText();
        mvc.perform(get("/api/v1/plans/" + id).header("Authorization", owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].automaticTime").value(contains(true, false)))
                .andExpect(jsonPath("$.items[1].startsAt").value(savedFixedStart));
        mvc.perform(get("/api/v1/shared-plans/" + share(created)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].automaticTime").value(contains(true, false)))
                .andExpect(jsonPath("$.items[1].startsAt").value(savedFixedStart));

        String payload = jdbc.queryForObject("SELECT payload FROM plans WHERE id = ?", String.class, id);
        JsonNode legacySnapshot = json.readTree(payload);
        legacySnapshot.get("items").forEach(item -> ((ObjectNode) item).remove("automaticTime"));
        jdbc.update("UPDATE plans SET payload = ? WHERE id = ?", json.writeValueAsString(legacySnapshot), id);
        JsonNode legacy = readResponse(mvc.perform(get("/api/v1/plans/" + id).header("Authorization", owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].automaticTime").value(contains(false, false))));
        assertThat(visitStart(legacy.at("/items/0"))).isEqualTo(visitStart(legacySnapshot.at("/items/0")));
        assertThat(visitStart(legacy.at("/items/1"))).isEqualTo(visitStart(legacySnapshot.at("/items/1")));
    }
    @Test void malformedDatesEnumsTimezonesAndDurationsUseProblemDetails() throws Exception {
        ObjectNode input = input("demo-budget");
        ((ObjectNode) input.get("criteria")).put("returnDate", "1999-01-01");
        mvc.perform(post("/api/v1/plans").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.errors[0].field").value("returnDate"));
        ObjectNode invalidDuration = input("demo-budget");
        invalidDuration.putArray("items").addObject().put("id", "x").put("attractionId", "demo-museum")
                .put("startsAt", "2026-12-05T10:00:00+01:00").put("visitMinutes", 0);
        mvc.perform(post("/api/v1/plans/preview").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(invalidDuration)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].field").value("items[0].visitMinutes"));
        ((ObjectNode) invalidDuration.get("items").get(0)).put("visitMinutes", 90).put("startsAt", "2026-12-05T10:00:00");
        mvc.perform(post("/api/v1/plans/preview").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(invalidDuration)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].field").value("body"));
        mvc.perform(post("/api/v1/searches").contentType(MediaType.APPLICATION_JSON).content("{\"priority\":\"UNKNOWN\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.status").value(400));
    }
    @Test void missingPlansAndInvalidPublicLinksReturn404WithoutSqlInjection() throws Exception {
        mvc.perform(get("/api/v1/plans/missing").header("Authorization", "Bearer " + "x".repeat(43))).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/shared-plans/" + "x".repeat(43))).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/shared-plans/not-a-valid-token")).andExpect(status().isNotFound());
    }
    @Test void unknownSelectionAndAttractionAreRejectedByServerCatalog() throws Exception {
        ObjectNode input = input("demo-budget");
        ((ObjectNode) input.get("selectedRoundTrip")).put("id", "invented");
        mvc.perform(post("/api/v1/plans").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].field").value("selectedRoundTrip"));
        input = input("demo-budget");
        input.putArray("items").addObject().put("id", "x").put("attractionId", "invented").putNull("startsAt").put("visitMinutes", 90);
        mvc.perform(post("/api/v1/plans").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errors[0].field").value("items"));
    }
    @Test void corruptedStoredJsonReturnsSafe503() throws Exception {
        JsonNode created = create(input("demo-budget"));
        String id = created.at("/plan/id").asText();
        jdbc.update("UPDATE plans SET payload = ? WHERE id = ?", "broken SECRET-DATABASE-CONTENT", id);
        String body = mvc.perform(get("/api/v1/shared-plans/" + share(created))).andExpect(status().isServiceUnavailable())
                .andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("SECRET-DATABASE-CONTENT", "org.sqlite", "jdbc:");
    }
    @Test void unsupportedFutureSchemaFailsWithoutDowngradingDatabase() {
        jdbc.execute("PRAGMA user_version=2");
        try {
            assertThatThrownBy(() -> new PlanRepository(jdbc, json).find("missing"))
                    .isInstanceOf(org.springframework.dao.DataAccessException.class);
            assertThat(jdbc.queryForObject("PRAGMA user_version", Integer.class)).isEqualTo(2);
        } finally { jdbc.execute("PRAGMA user_version=1"); }
    }
    private ObjectNode input(String optionId) throws Exception {
        ObjectNode input = json.createObjectNode();
        input.set("criteria", criteria()); input.set("selectedRoundTrip", option(optionId)); input.putArray("items");
        return input;
    }
    private JsonNode option(String id) throws Exception {
        JsonNode response = json.readTree(mvc.perform(post("/api/v1/searches").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(criteria()))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        for (JsonNode option : response.get("roundTripOptions")) if (option.get("id").asText().equals(id)) return option;
        throw new IllegalStateException("Missing fixture");
    }
    private ObjectNode criteria() {
        LocalDate departure = LocalDate.now(ZoneId.of("Europe/Warsaw")).plusDays(20);
        ObjectNode criteria = json.createObjectNode();
        criteria.put("origin", "Warszawa").put("destination", "Gdańsk").put("departureDate", departure.toString())
                .put("returnDate", departure.plusDays(1).toString()).put("priority", "LOWEST_TOTAL_COST")
                .put("currency", "PLN").put("fareType", "STANDARD");
        return criteria;
    }
    private JsonNode create(ObjectNode input) throws Exception {
        return json.readTree(mvc.perform(post("/api/v1/plans").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(input)))
                .andExpect(status().isCreated()).andExpect(header().exists("Location"))
                .andExpect(header().string("Cache-Control", "no-store")).andReturn().getResponse().getContentAsString());
    }
    private String share(JsonNode created) {
        String url = created.at("/plan/shareUrl").asText();
        return url.substring(url.lastIndexOf('/') + 1);
    }
    private LocalTime localVisitTime(JsonNode item) {
        return visitStart(item).atZone(ZoneId.of("Europe/Warsaw")).toLocalTime();
    }
    private Instant visitStart(JsonNode item) {
        return OffsetDateTime.parse(item.get("startsAt").asText()).toInstant();
    }
    private JsonNode readResponse(ResultActions response) throws Exception {
        return json.readTree(response.andReturn().getResponse().getContentAsString());
    }
    private static Path database() {
        try {
            Path database = Files.createTempDirectory("city-break-plans-").resolve("plans.db");
            database.toFile().deleteOnExit(); database.getParent().toFile().deleteOnExit();
            return database;
        } catch (IOException exception) { throw new IllegalStateException(exception); }
    }
}
