package pl.citybreak.stay;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import pl.citybreak.stay.StayModels.*;

class OboStayProviderTest {
    private static final Instant NOW = Instant.parse("2026-11-14T15:30:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);
    private static final Criteria CRITERIA = new Criteria("Paris, France", LocalDate.of(2026, 11, 21), LocalDate.of(2026, 11, 23), 2, "PLN");
    private final ObjectMapper json = new ObjectMapper();

    @Test void locallyRejectedRetriesDoNotExtendEitherLocalOrUpstreamCooldown() throws Exception {
        for (int firstStatus : new int[]{200, 429}) {
            AtomicReference<Instant> now = new AtomicReference<>(NOW);
            Clock clock = new Clock() {
                @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
                @Override public Clock withZone(java.time.ZoneId zone) { return this; }
                @Override public Instant instant() { return now.get(); }
            };
            AtomicInteger requests = new AtomicInteger();
            AtomicInteger status = new AtomicInteger(firstStatus);
            byte[] body = envelope(payload()).toString().getBytes(StandardCharsets.UTF_8);
            HttpServer server = server();
            server.createContext("/mcp", exchange -> {
                requests.incrementAndGet();
                exchange.getResponseHeaders().set("Retry-After", "120");
                exchange.sendResponseHeaders(status.get(), body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            });
            server.start();
            try {
                var provider = new OboStayProvider(json, clock, true, "fixture-key", 3,
                        URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/mcp"));
                assertThat(provider.search(CRITERIA).status()).isEqualTo(firstStatus == 200 ? Status.OK : Status.RATE_LIMITED);
                for (int attempt = 1; attempt <= 20; attempt++) {
                    now.set(NOW.plusMillis(attempt * 100L));
                    assertThat(provider.search(CRITERIA).status()).isEqualTo(Status.RATE_LIMITED);
                }
                assertThat(requests.get()).isEqualTo(1);
                now.set(NOW.plusSeconds(firstStatus == 200 ? 6 : 120));
                status.set(200);
                assertThat(provider.search(CRITERIA).status()).isEqualTo(Status.OK);
                assertThat(requests.get()).isEqualTo(2);
            } finally { server.stop(0); }
        }
    }

    @Test void readsStructuredAndTextEnvelopesAndPreservesQuoteInclusionsAndBookingUrl() throws Exception {
        ObjectNode payload = payload();
        var price = (ObjectNode) payload.at("/results/0/price");
        price.put("taxes_included", false).putNull("fees_included").put("inclusions_note", "Local taxes paid at property.");
        price.putArray("extra_charges").addObject().put("name", "City tax").put("payable_at", "property")
                .putObject("amount").put("amount", "10.00").put("currency", "EUR");
        String url = "https://onebookingonline.com/hotel?token=opaque%2Bvalue&currency=PLN";
        ((ObjectNode) payload.at("/results/0")).put("booking_url", url);
        SearchResponse structured = parser().parse(envelope(payload), CRITERIA);
        assertThat(structured.status()).isEqualTo(Status.OK);
        Hotel hotel = structured.hotels().get(0);
        assertThat(hotel.totalPrice()).isEqualTo("480.52");
        assertThat(hotel.nightlyPrice()).isEqualTo("240.26");
        assertThat(hotel.bookingUrl()).isEqualTo(url);
        assertThat(hotel.taxesIncluded()).isFalse();
        assertThat(hotel.feesIncluded()).isNull();
        assertThat(hotel.extraCharges()).containsExactly(new ExtraCharge("City tax", "10.00", "EUR", "property"));
        assertThat(hotel.expiresAt()).isEqualTo(NOW.plusSeconds(1800));

        ObjectNode text = json.createObjectNode();
        text.putObject("result").putArray("content").addObject().put("type", "text").put("text", payload.toString());
        assertThat(parser().parse(text, CRITERIA)).isEqualTo(structured);
        payload.put("partial", true);
        assertThat(parser().parse(envelope(payload), CRITERIA).status()).isEqualTo(Status.PARTIAL);
    }

    @Test void oldMissingFutureOrUntrustworthyFreshnessNeverBecomesAnAvailableOffer() throws Exception {
        ObjectNode payload = payload();
        ((ObjectNode) payload.at("/results/0/freshness")).put("quoted_at", NOW.minusSeconds(1801).toString());
        assertThat(parser().parse(envelope(payload), CRITERIA).status()).isEqualTo(Status.PROVIDER_ERROR);
        ((ObjectNode) payload.at("/results/0/freshness")).put("quoted_at", NOW.toString()).put("age_seconds", 1900);
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels()).isEmpty();
        ((ObjectNode) payload.at("/results/0/freshness")).put("age_seconds", -1);
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels()).isEmpty();
        ((ObjectNode) payload.at("/results/0")).remove("freshness");
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels()).isEmpty();
        payload.putObject("freshness").put("quoted_at", NOW.minusSeconds(120).toString()).put("age_seconds", 600);
        SearchResponse cached = parser().parse(envelope(payload), CRITERIA);
        assertThat(cached.hotels().get(0).quotedAt()).isEqualTo(NOW.minusSeconds(600));
        assertThat(cached.expiresAt()).isEqualTo(NOW.plusSeconds(1200));
        ((ObjectNode) payload.path("freshness")).put("quoted_at", NOW.plusSeconds(300).toString());
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels()).isEmpty();
    }

    @Test void readsHotelPhotoAndCoordinatesWithSafeFallbacksFromTheSameSearchResponse() throws Exception {
        ObjectNode payload = payload();
        ObjectNode row = (ObjectNode) payload.at("/results/0");
        String primary = "https://onebookingonline.com/photo?hotel=fixture&image=a%2Bb";
        String hero = "https://www.onebookingonline.com/photo/hero";
        String first = "https://onebookingonline.com/photo/first";
        row.put("photo_url", primary);
        ObjectNode details = row.putObject("hotel").put("hero_image", hero).put("latitude", 48.8566).put("longitude", 2.3522);
        details.putArray("images").add(first);
        Hotel hotel = parser().parse(envelope(payload), CRITERIA).hotels().get(0);
        assertThat(hotel.photoUrl()).isEqualTo(primary);
        assertThat(hotel.location()).isEqualTo(new Location(48.8566, 2.3522));

        row.put("photo_url", "https://untrusted.test/photo");
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels().get(0).photoUrl()).isEqualTo(hero);
        details.putNull("hero_image");
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels().get(0).photoUrl()).isEqualTo(first);
        row.remove("photo_url");
        details.remove("images");
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels().get(0).photoUrl()).isNull();
    }

    @Test void unsafePhotosAndMissingOrInvalidCoordinatesDoNotDiscardAnOtherwiseValidQuote() throws Exception {
        ObjectNode payload = payload();
        ObjectNode row = (ObjectNode) payload.at("/results/0");
        SearchResponse missing = parser().parse(envelope(payload), CRITERIA);
        assertThat(missing.status()).isEqualTo(Status.OK);
        assertThat(missing.hotels().get(0).photoUrl()).isNull();
        assertThat(missing.hotels().get(0).location()).isNull();
        ObjectNode details = row.putObject("hotel");
        for (String unsafe : new String[]{"http://onebookingonline.com/photo", "https://onebookingonline.com.evil.test/photo",
                "https://user:pass@onebookingonline.com/photo", "https://onebookingonline.com:8443/photo", "javascript:alert(1)"}) {
            row.put("photo_url", unsafe);
            details.put("hero_image", unsafe).putArray("images").add(unsafe);
            SearchResponse result = parser().parse(envelope(payload), CRITERIA);
            assertThat(result.status()).isEqualTo(Status.OK);
            assertThat(result.hotels().get(0).photoUrl()).as(unsafe).isNull();
        }
        for (double[] coordinates : new double[][]{{91, 2}, {-91, 2}, {48, 181}, {48, -181}, {Double.NaN, 2}, {48, Double.POSITIVE_INFINITY}}) {
            details.put("latitude", coordinates[0]).put("longitude", coordinates[1]);
            SearchResponse result = parser().parse(envelope(payload), CRITERIA);
            assertThat(result.status()).isEqualTo(Status.OK);
            assertThat(result.hotels().get(0).location()).isNull();
        }
        details.put("latitude", "48.8566").put("longitude", 2.3522);
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels().get(0).location()).isNull();
        details.put("latitude", 48.8566).putNull("longitude");
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels().get(0).location()).isNull();
        details.put("latitude", -90).put("longitude", 180);
        assertThat(parser().parse(envelope(payload), CRITERIA).hotels().get(0).location()).isEqualTo(new Location(-90.0, 180.0));
    }

    @Test void distinguishesConfirmedEmptyAmbiguityAndErrorsAndDropsUnsafeOrMalformedRows() throws Exception {
        ObjectNode payload = payload();
        payload.putArray("results");
        assertThat(parser().parse(envelope(payload), CRITERIA).status()).isEqualTo(Status.EMPTY);
        payload.putArray("ambiguous_destination").add("Paris, France").add("Paris, Texas");
        assertThat(parser().parse(envelope(payload), CRITERIA).status()).isEqualTo(Status.UNAVAILABLE);
        payload.remove("ambiguous_destination");
        payload.remove("results");
        assertThat(parser().parse(envelope(payload), CRITERIA).status()).isEqualTo(Status.PROVIDER_ERROR);
        ObjectNode failed = envelope(payload());
        ((ObjectNode) failed.path("result")).put("isError", true);
        assertThat(parser().parse(failed, CRITERIA).status()).isEqualTo(Status.PROVIDER_ERROR);
        ObjectNode error = json.createObjectNode();
        error.putObject("error").put("code", "RATE_LIMITED").put("retry_after_seconds", 17).put("message", "SECRET PROVIDER DETAIL");
        SearchResponse limited = parser().parse(error, CRITERIA);
        assertThat(limited.status()).isEqualTo(Status.RATE_LIMITED);
        assertThat(limited.retryAfterSeconds()).isEqualTo(17);
        assertThat(limited.message()).doesNotContain("SECRET");

        for (String url : new String[]{"http://onebookingonline.com/a", "https://onebookingonline.com.evil.test/a",
                "https://user@onebookingonline.com/a", "https://onebookingonline.com:8443/a", "javascript:alert(1)"}) {
            ObjectNode rows = payload();
            ((ObjectNode) rows.at("/results/0")).put("booking_url", url);
            assertThat(parser().parse(envelope(rows), CRITERIA).hotels()).as(url).isEmpty();
        }
        ObjectNode rows = payload();
        JsonNode valid = rows.at("/results/0").deepCopy();
        ((ObjectNode) rows.at("/results/0/price/total")).put("amount", "1e1000000000");
        assertThat(parser().parse(envelope(rows), CRITERIA).hotels()).isEmpty();
        ((com.fasterxml.jackson.databind.node.ArrayNode) rows.get("results")).add(valid);
        SearchResponse partial = parser().parse(envelope(rows), CRITERIA);
        assertThat(partial.status()).isEqualTo(Status.PARTIAL);
        assertThat(partial.hotels()).hasSize(1);
    }

    @Test void postsOnlyHotelSearchArgumentsWithOptionalServerKeyAndGlobalCooldown() throws Exception {
        var requests = new AtomicInteger();
        var body = new AtomicReference<String>();
        var header = new AtomicReference<String>();
        HttpServer server = server();
        ObjectNode searchPayload = payload();
        ObjectNode row = (ObjectNode) searchPayload.at("/results/0");
        row.put("photo_url", "https://onebookingonline.com/photo/fixture");
        row.putObject("hotel").put("latitude", 48.8566).put("longitude", 2.3522);
        byte[] response = envelope(searchPayload).toString().getBytes(StandardCharsets.UTF_8);
        server.createContext("/mcp", exchange -> {
            try {
                requests.incrementAndGet();
                body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                header.set(exchange.getRequestHeaders().getFirst("X-OBO-Key"));
                assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isNull();
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
            } finally { exchange.close(); }
        });
        server.start();
        try {
            var provider = provider(server, 3);
            SearchResponse firstResult = provider.search(CRITERIA);
            assertThat(firstResult.status()).isEqualTo(Status.OK);
            assertThat(firstResult.hotels().get(0).photoUrl()).isEqualTo("https://onebookingonline.com/photo/fixture");
            assertThat(firstResult.hotels().get(0).location()).isEqualTo(new Location(48.8566, 2.3522));
            SearchResponse limited = provider.search(CRITERIA);
            assertThat(limited.status()).isEqualTo(Status.RATE_LIMITED);
            assertThat(limited.retryAfterSeconds()).isGreaterThanOrEqualTo(1);
            assertThat(requests.get()).isEqualTo(1);
            JsonNode sent = json.readTree(body.get());
            assertThat(sent.path("method").asText()).isEqualTo("tools/call");
            assertThat(sent.at("/params/name").asText()).isEqualTo("search_hotels");
            assertThat(sent.at("/params/arguments/rooms").asInt()).isEqualTo(1);
            assertThat(sent.at("/params/arguments/limit").asInt()).isEqualTo(3);
            assertThat(sent.at("/params/arguments/sort").asText()).isEqualTo("price_low_to_high");
            assertThat(sent.at("/params/arguments/destination").asText()).isEqualTo(CRITERIA.destination());
            assertThat(header.get()).isEqualTo("fixture-key");
            assertThat(body.get()).doesNotContain("fixture-key", "ownerToken", "shareToken");
        } finally { server.stop(0); }
    }

    @Test void disambiguatesOnlyExactEuropeanCatalogueNamesWithoutOverridingQualifiedCities() throws Exception {
        var body = new AtomicReference<String>();
        HttpServer server = server();
        byte[] response = envelope(payload()).toString().getBytes(StandardCharsets.UTF_8);
        server.createContext("/mcp", exchange -> {
            try {
                body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
            } finally { exchange.close(); }
        });
        server.start();
        try {
            for (String[] entry : new String[][]{{"Paryż", "FR"}, {" Paris ", "FR"}, {"Londyn", "GB"},
                    {"London", "GB"}, {"Amsterdam", "NL"}, {"Paris, Texas", ""}, {"Berlin", ""}}) {
                Criteria criteria = new Criteria(entry[0], CRITERIA.checkIn(), CRITERIA.checkOut(), 2, "PLN");
                assertThat(provider(server, 3).search(criteria).status()).isEqualTo(Status.OK);
                JsonNode arguments = json.readTree(body.get()).at("/params/arguments");
                assertThat(arguments.path("destination").asText()).isEqualTo(entry[0]);
                if (entry[1].isEmpty()) assertThat(arguments.has("country")).isFalse();
                else assertThat(arguments.path("country").asText()).isEqualTo(entry[1]);
            }
        } finally { server.stop(0); }
    }
    @Test void postsRequestedRoomsAndPreservesQuotedTotalForTheWholeGroupWithoutMultiplying() throws Exception {
        var body = new AtomicReference<String>();
        HttpServer server = server();
        byte[] response = envelope(payload()).toString().getBytes(StandardCharsets.UTF_8);
        server.createContext("/mcp", exchange -> {
            try {
                body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                exchange.sendResponseHeaders(200, response.length);
                exchange.getResponseBody().write(response);
            } finally { exchange.close(); }
        });
        server.start();
        try {
            Criteria group = new Criteria(CRITERIA.destination(), CRITERIA.checkIn(), CRITERIA.checkOut(), 4, "PLN", 2);
            SearchResponse result = provider(server, 3).search(group);
            assertThat(result.status()).isEqualTo(Status.OK);
            assertThat(result.criteria()).isEqualTo(group);
            assertThat(result.criteria().rooms()).isEqualTo(2);
            assertThat(result.hotels().get(0).totalPrice()).isEqualTo("480.52");
            assertThat(result.hotels().get(0).nightlyPrice()).isEqualTo("240.26");
            JsonNode arguments = json.readTree(body.get()).at("/params/arguments");
            assertThat(arguments.path("adults").asInt()).isEqualTo(4);
            assertThat(arguments.path("rooms").asInt()).isEqualTo(2);
        } finally { server.stop(0); }
    }

    @Test void handlesHttpRateLimitRedirectsMalformedOversizedAndSlowBodiesWithoutRetry() throws Exception {
        AtomicInteger target = new AtomicInteger();
        AtomicInteger code = new AtomicInteger(429);
        AtomicReference<String> body = new AtomicReference<>("{}");
        HttpServer server = server();
        server.createContext("/elsewhere", exchange -> { target.incrementAndGet(); exchange.sendResponseHeaders(200, -1); exchange.close(); });
        server.createContext("/mcp", exchange -> {
            try {
                exchange.getResponseHeaders().set("Retry-After", "120");
                exchange.getResponseHeaders().set("Location", "/elsewhere");
                byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(code.get(), bytes.length);
                if (code.get() == 202) {
                    try { Thread.sleep(1800); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                }
                exchange.getResponseBody().write(bytes);
            } finally { exchange.close(); }
        });
        server.start();
        try {
            SearchResponse rate = provider(server, 3).search(CRITERIA);
            assertThat(rate.status()).isEqualTo(Status.RATE_LIMITED);
            assertThat(rate.retryAfterSeconds()).isEqualTo(120);
            code.set(302);
            assertThat(provider(server, 3).search(CRITERIA).status()).isEqualTo(Status.PROVIDER_ERROR);
            assertThat(target.get()).isZero();
            code.set(200); body.set("not-json SECRET DETAIL");
            assertThat(provider(server, 3).search(CRITERIA).status()).isEqualTo(Status.PROVIDER_ERROR);
            body.set("x".repeat(1_048_577));
            assertThat(provider(server, 3).search(CRITERIA).status()).isEqualTo(Status.PROVIDER_ERROR);
            code.set(202); body.set("{}");
            long started = System.nanoTime();
            assertThat(provider(server, 1).search(CRITERIA).status()).isEqualTo(Status.PROVIDER_ERROR);
            assertThat(java.time.Duration.ofNanos(System.nanoTime() - started)).isLessThan(java.time.Duration.ofMillis(1700));
        } finally { server.stop(0); }
    }

    private OboStayProvider parser() { return new OboStayProvider(json, CLOCK, false, "", 3, URI.create("http://127.0.0.1:1/mcp")); }
    private OboStayProvider provider(HttpServer server, int seconds) {
        return new OboStayProvider(json, CLOCK, true, "fixture-key", seconds, URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/mcp"));
    }
    private HttpServer server() throws Exception { return HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0); }
    private ObjectNode envelope(ObjectNode payload) {
        ObjectNode root = json.createObjectNode();
        root.putObject("result").put("isError", false).set("structuredContent", payload);
        return root;
    }
    private ObjectNode payload() throws Exception {
        return (ObjectNode) json.readTree("""
                {"results":[{"hotel_token":"fixture-hotel","name":"Fixture hotel","stars":3,
                  "booking_url":"https://onebookingonline.com/hotel/fixture",
                  "price":{"total":{"amount":480.52,"currency":"PLN"},"nightly":{"amount":240.26,"currency":"PLN"},
                    "taxes_included":null,"fees_included":null,"extra_charges":[]},
                  "freshness":{"quoted_at":"2026-11-14T15:30:00Z","age_seconds":0,"source":"live"}}],
                 "partial":false,"ambiguous_destination":[]}
                """);
    }
}
