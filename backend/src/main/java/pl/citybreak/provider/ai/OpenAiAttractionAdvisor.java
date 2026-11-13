package pl.citybreak.provider.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import pl.citybreak.model.Model.Interest;
import pl.citybreak.model.Model.Recommendation;
import pl.citybreak.service.AttractionRecommendations.Option;

@Component
public final class OpenAiAttractionAdvisor {
    private static final Logger LOG = LoggerFactory.getLogger(OpenAiAttractionAdvisor.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(8);
    private static final URI RESPONSES = URI.create("https://api.openai.com/v1/responses");
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();
    private final ObjectMapper json;
    private final Clock clock;
    private final String key;
    private final String model;
    private final int limit;
    private final URI endpoint;
    private LocalDate budgetDay;
    private int used;

    @Autowired
    public OpenAiAttractionAdvisor(ObjectMapper json, Clock clock, @Value("${app.ai.api-key}") String key,
            @Value("${app.ai.model}") String model, @Value("${app.ai.daily-requests}") int limit) {
        this(json, clock, key, model, limit, RESPONSES);
    }

    OpenAiAttractionAdvisor(ObjectMapper json, Clock clock, String key, String model, int limit, URI endpoint) {
        this.json = json;
        this.clock = clock;
        this.key = key.strip();
        this.model = model;
        this.limit = limit;
        this.endpoint = endpoint;
    }

    public List<Recommendation> suggest(String city, long stayMinutes, Interest interest, int budget, List<Option> eligible) {
        if (eligible.isEmpty() || !key.matches("[!-~]{1,8192}") || !reserve()) return List.of();
        var context = json.createObjectNode().put("city", city).put("stayMinutes", stayMinutes)
                .put("interest", interest.name()).put("budgetPln", budget);
        var candidates = context.putArray("candidates");
        for (Option option : eligible) {
            candidates.addObject().put("id", option.attraction().id()).put("name", option.attraction().name())
                    .put("category", option.category().name()).put("visitMinutes", option.attraction().visitMinutes())
                    .put("pricePln", option.price());
        }
        var body = json.createObjectNode().put("model", model).put("store", false).put("max_output_tokens", 400)
                .put("instructions", "Pick up to three attractions from the supplied IDs, within the combined budget. "
                        + "Return JSON with a suggestions array of objects with attractionId and reason. "
                        + "Give each choice a short reason in Polish based only on the catalog and interest. "
                        + "Do not add prices, opening hours, URLs, or facts outside the catalog.")
                .put("input", context.toString());
        body.putObject("reasoning").put("effort", "none");
        var format = body.putObject("text").putObject("format").put("type", "json_schema")
                .put("name", "attractions").put("strict", true);
        var schema = format.putObject("schema").put("type", "object").put("additionalProperties", false);
        schema.putArray("required").add("suggestions");
        var item = schema.putObject("properties").putObject("suggestions").put("type", "array").put("maxItems", 3)
                .putObject("items").put("type", "object").put("additionalProperties", false);
        item.putArray("required").add("attractionId").add("reason");
        var properties = item.putObject("properties");
        var ids = properties.putObject("attractionId").put("type", "string").putArray("enum");
        eligible.forEach(option -> ids.add(option.attraction().id()));
        properties.putObject("reason").put("type", "string");
        var request = HttpRequest.newBuilder(endpoint).timeout(TIMEOUT)
                .header("Authorization", "Bearer " + key).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
        var pending = http.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        try {
            var response = pending.get(TIMEOUT.toSeconds(), TimeUnit.SECONDS);
            if (response.statusCode() != 200) {
                LOG.warn("OpenAI attraction recommendations returned HTTP {}.", response.statusCode());
                return List.of();
            }
            return parse(json, json.readTree(response.body()));
        } catch (TimeoutException unavailable) {
            pending.cancel(true);
            LOG.warn("OpenAI attraction recommendations timed out.");
            return List.of();
        } catch (InterruptedException interrupted) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            return List.of();
        } catch (java.io.IOException | ExecutionException unavailable) {
            LOG.warn("OpenAI attraction recommendations were unavailable.");
            return List.of();
        }
    }

    static List<Recommendation> parse(ObjectMapper json, JsonNode root) throws java.io.IOException {
        if (root == null || !"completed".equals(root.path("status").asText())) return List.of();
        for (JsonNode message : root.path("output")) {
            if (!"message".equals(message.path("type").asText()) || !"assistant".equals(message.path("role").asText())) continue;
            for (JsonNode content : message.path("content")) {
                if (!"output_text".equals(content.path("type").asText())) continue;
                var result = new ArrayList<Recommendation>();
                JsonNode payload = json.readTree(content.path("text").asText());
                if (payload == null || !payload.path("suggestions").isArray()) return List.of();
                for (JsonNode row : payload.path("suggestions")) {
                    String id = row.path("attractionId").asText("");
                    JsonNode reasonValue = row.path("reason");
                    if (!row.path("attractionId").isTextual() || !reasonValue.isTextual()) continue;
                    String reason = reasonValue.asText().strip();
                    if (!id.isBlank() && !reason.isBlank() && reason.length() <= 180) result.add(new Recommendation(id, reason));
                    if (result.size() == 3) break;
                }
                return List.copyOf(result);
            }
        }
        return List.of();
    }

    private synchronized boolean reserve() {
        LocalDate today = LocalDate.now(clock.withZone(ZoneId.of("Europe/Warsaw")));
        if (!today.equals(budgetDay)) {
            budgetDay = today;
            used = 0;
        }
        if (used >= limit) return false;
        used++;
        return true;
    }
}
