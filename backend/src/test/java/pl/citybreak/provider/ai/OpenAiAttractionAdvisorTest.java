package pl.citybreak.provider.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import pl.citybreak.model.Model.Attraction;
import pl.citybreak.model.Model.Interest;
import pl.citybreak.model.Model.Recommendation;
import pl.citybreak.service.AttractionRecommendations.Option;

class OpenAiAttractionAdvisorTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test void readsCompletedAssistantSuggestionsAndIgnoresMalformedEntries() throws Exception {
        var response = json.createObjectNode().put("status", "completed");
        response.putArray("output").addObject().put("type", "message").put("role", "assistant")
                .putArray("content").addObject().put("type", "output_text").put("text", """
                        {"suggestions":[{"attractionId":"louvre","reason":"Pasuje do zainteresowania sztuką."},
                                        {"attractionId":"orsay","reason":""},
                                        {"attractionId":"park","reason":42}]}
                        """);
        assertThat(OpenAiAttractionAdvisor.parse(json, response))
                .containsExactly(new Recommendation("louvre", "Pasuje do zainteresowania sztuką."));
        response.put("status", "incomplete");
        assertThat(OpenAiAttractionAdvisor.parse(json, response)).isEmpty();
    }

    @Test void callsOnlyTheConfiguredEndpointAndReturnsEmptyOnRateLimitOrExhaustedBudget() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var requests = new AtomicInteger();
        var requestBody = new AtomicReference<String>();
        var authHeader = new AtomicReference<String>();
        server.createContext("/responses", exchange -> {
            try {
                requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                authHeader.set(exchange.getRequestHeaders().getFirst("Authorization"));
                requests.incrementAndGet();
                exchange.sendResponseHeaders(429, -1);
            } finally { exchange.close(); }
        });
        server.start();
        try {
            var endpoint = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/responses");
            var advisor = new OpenAiAttractionAdvisor(json, Clock.systemUTC(), "fixture-key", "fixture-model", 1, endpoint);
            var museum = new Attraction("louvre", "Louvre", null, 60, List.of(), null, List.of());
            var options = List.of(new Option(museum, Interest.CULTURE, BigDecimal.TEN));
            assertThat(advisor.suggest("Paryż", 120, Interest.CULTURE, 25, List.of())).isEmpty();
            assertThat(advisor.suggest("Paryż", 120, Interest.CULTURE, 25, options)).isEmpty();
            assertThat(advisor.suggest("Paryż", 120, Interest.CULTURE, 25, options)).isEmpty();
            assertThat(requests.get()).isEqualTo(1);
            assertThat(authHeader.get()).isEqualTo("Bearer fixture-key");
            var body = json.readTree(requestBody.get());
            assertThat(body.path("store").asBoolean()).isFalse();
            assertThat(body.has("tools")).isFalse();
            assertThat(body.at("/text/format/schema/properties/suggestions/items/properties/attractionId/enum/0").asText())
                    .isEqualTo("louvre");
            assertThat(requestBody.get()).doesNotContain("fixture-key");
        } finally {
            server.stop(0);
        }
    }
}
