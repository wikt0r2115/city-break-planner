package pl.citybreak.provider.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import pl.citybreak.model.Model.Criteria;
import pl.citybreak.model.Model.FareType;
import pl.citybreak.model.Model.Priority;
import pl.citybreak.provider.ai.ConnectionDiscovery.Candidate;

class OpenAiConnectionDiscoveryTest {
    private static final String SOURCE = "https://www.skm.pkp.pl/dla-pasazera/rozklad-jazdy";
    private static final String BIP_SOURCE = "https://bip.skm.pkp.pl/c60/rozklad-jazdy";
    private static final String DEPARTURE = "2026-11-21T09:35:00+01:00";
    private static final String ARRIVAL = "2026-11-21T10:10:00+01:00";
    private static final String FIXTURE_KEY = "test-only-key";
    private static final Criteria TRIP = new Criteria("Gdańsk Główny", "Gdynia Główna",
            LocalDate.parse("2026-11-21"), LocalDate.parse("2026-11-22"),
            Priority.SHORTEST_TRAVEL_TIME, "PLN", FareType.STANDARD);

    private final ObjectMapper json = new ObjectMapper();
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test
    void sendsBoundedSearchRequestAndReadsOnlyAnnotatedPublicSourceCandidates() throws Exception {
        var rows = json.createArrayNode()
                .add(row(SOURCE, ARRIVAL)).add(row(SOURCE, ARRIVAL))
                .add(row("https://www.skm.pkp.pl/uncited", ARRIVAL))
                .add(row("https://www.skm.pkp.pl.example.org/wrong", ARRIVAL))
                .add(row("https://user@www.skm.pkp.pl/private", ARRIVAL))
                .add(row("https://www.skm.pkp.pl:12345/wrong", ARRIVAL))
                .add(row("http://www.skm.pkp.pl/insecure", ARRIVAL))
                .add(row(SOURCE, "2026-11-21T10:10:00"))
                .add(row(SOURCE, "2026-11-21T07:10:00+01:00"));
        ObjectNode payload = json.createObjectNode().set("candidates", rows);
        ObjectNode reply = reply(payload, SOURCE, "https://www.skm.pkp.pl.example.org/wrong",
                "https://user@www.skm.pkp.pl/private", "https://www.skm.pkp.pl:12345/wrong",
                "http://www.skm.pkp.pl/insecure");
        var authorization = new AtomicReference<String>();
        var body = new AtomicReference<JsonNode>();
        var client = client(exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            body.set(json.readTree(exchange.getRequestBody()));
            send(exchange, 200, reply.toString());
        });

        assertThat(client.discover(TRIP)).containsExactly(new Candidate(TRIP.origin(), TRIP.destination(),
                OffsetDateTime.parse(DEPARTURE), OffsetDateTime.parse(ARRIVAL), SOURCE));
        assertThat(authorization.get()).isEqualTo("Bearer " + FIXTURE_KEY);
        JsonNode request = body.get();
        assertThat(request.path("model").asText()).isEqualTo("gpt-6-luna");
        assertThat(request.path("store").booleanValue()).isFalse();
        assertThat(request.path("max_tool_calls").intValue()).isEqualTo(3);
        assertThat(request.path("max_output_tokens").intValue()).isEqualTo(1500);
        assertThat(request.path("tool_choice").asText()).isEqualTo("required");
        assertThat(request.at("/tools/0/type").asText()).isEqualTo("web_search");
        assertThat(request.at("/tools/0/filters/allowed_domains").toString())
                .contains("www.skm.pkp.pl", "bip.skm.pkp.pl");
        assertThat(request.at("/text/format/strict").booleanValue()).isTrue();
        assertThat(json.readTree(request.path("input").asText()).path("origin").asText()).isEqualTo(TRIP.origin());
        assertThat(request.toString()).doesNotContain(FIXTURE_KEY);
    }

    @Test
    void supportsEmptySearchResultsAndRejectsResponsesWithoutSearch() throws Exception {
        ObjectNode empty = json.createObjectNode();
        empty.putArray("candidates");
        var response = new AtomicReference<>(reply(empty));
        var client = client(exchange -> send(exchange, 200, response.get().toString()));
        assertThat(client.discover(TRIP)).isEmpty();

        ObjectNode unsearched = reply(json.createObjectNode().set("candidates", json.createArrayNode().add(row(BIP_SOURCE, ARRIVAL))),
                BIP_SOURCE);
        unsearched.withArray("output").remove(0);
        response.set(unsearched);
        assertThatThrownBy(() -> client.discover(TRIP)).isInstanceOf(IllegalStateException.class)
                .hasMessage("OpenAI returned no usable search response.");
    }

    @Test
    void providerErrorDoesNotExposeResponseBodyOrCredentials() throws Exception {
        var client = client(exchange -> send(exchange, 429, "upstream error: " + FIXTURE_KEY));
        assertThatThrownBy(() -> client.discover(TRIP)).isInstanceOf(IllegalStateException.class)
                .hasMessage("OpenAI request failed (HTTP 429).").hasNoCause();
    }

    @Test
    void oversizedResponseFailsWithoutReadingUnboundedData() throws Exception {
        var client = client(exchange -> send(exchange, 200, "x".repeat(128 * 1024 + 1)));
        assertThatThrownBy(() -> client.discover(TRIP)).isInstanceOf(IllegalStateException.class)
                .hasMessage("OpenAI response could not be read.");
    }

    @Test
    void timeoutIncludesResponseBodyAfterHeadersArrive() throws Exception {
        var release = new CountDownLatch(1);
        var client = client(exchange -> {
            exchange.sendResponseHeaders(200, 100);
            exchange.getResponseBody().write('{');
            exchange.getResponseBody().flush();
            try { release.await(4, TimeUnit.SECONDS); }
            catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
            finally { exchange.close(); }
        }, Duration.ofSeconds(1));
        try {
            assertThatThrownBy(() -> client.discover(TRIP)).isInstanceOf(IllegalStateException.class)
                    .hasMessage("OpenAI request timed out.");
        } finally {
            release.countDown();
        }
    }

    @Test
    void blankOrMalformedKeyDisablesDiscovery() {
        assertThat(new OpenAiConnectionDiscovery(json, " ", "gpt-6-luna", 8).enabled()).isFalse();
        assertThat(new OpenAiConnectionDiscovery(json, "key\r\nmalformed", "gpt-6-luna", 8).enabled()).isFalse();
    }

    private ObjectNode row(String source, String arrival) {
        return json.createObjectNode().put("origin", TRIP.origin()).put("destination", TRIP.destination())
                .put("departureAt", DEPARTURE).put("arrivalAt", arrival).put("sourceUrl", source);
    }

    private ObjectNode reply(JsonNode payload, String... citations) {
        ObjectNode root = json.createObjectNode().put("status", "completed");
        var output = root.putArray("output");
        output.addObject().put("type", "web_search_call").put("status", "completed")
                .putObject("action").put("type", "search");
        var annotations = output.addObject().put("type", "message").put("role", "assistant")
                .putArray("content").addObject().put("type", "output_text").put("text", payload.toString())
                .putArray("annotations");
        for (String citation : citations) annotations.addObject().put("type", "url_citation").put("url", citation);
        return root;
    }

    private OpenAiConnectionDiscovery client(HttpHandler handler) throws IOException {
        return client(handler, Duration.ofSeconds(5));
    }

    private OpenAiConnectionDiscovery client(HttpHandler handler, Duration timeout) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool(task -> {
            var worker = new Thread(task);
            worker.setDaemon(true);
            return worker;
        }));
        server.createContext("/v1/responses", handler);
        server.start();
        URI endpoint = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v1/responses");
        return new OpenAiConnectionDiscovery(json, FIXTURE_KEY, "gpt-6-luna", timeout, endpoint);
    }

    private static void send(HttpExchange exchange, int status, String response) throws IOException {
        byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
        try (exchange) {
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
        }
    }
}
