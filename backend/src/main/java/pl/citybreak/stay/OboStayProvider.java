package pl.citybreak.stay;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import pl.citybreak.model.PlaceNames;
import pl.citybreak.stay.StayModels.*;

@Component
public final class OboStayProvider {
    private static final URI ENDPOINT = URI.create("https://onebookingonline.com/mcp");
    private static final int MAX_BYTES = 1_048_576;
    private static final Duration MAX_AGE = Duration.ofMinutes(30);
    private final ObjectMapper json;
    private final Clock clock;
    private final boolean enabled;
    private final String key;
    private final URI endpoint;
    private final Duration timeout;
    private final HttpClient http;
    private final Semaphore active = new Semaphore(1);
    private Instant nextAllowed = Instant.MIN;

    @Autowired
    public OboStayProvider(ObjectMapper json, Clock clock, @Value("${app.obo.enabled:true}") boolean enabled,
            @Value("${app.obo.api-key:}") String key, @Value("${app.obo.timeout-seconds:25}") int seconds) {
        this(json, clock, enabled, key, seconds, ENDPOINT);
    }

    OboStayProvider(ObjectMapper json, Clock clock, boolean enabled, String key, int seconds, URI endpoint) {
        this.json = json;
        this.clock = clock;
        this.enabled = enabled;
        this.key = key == null ? "" : key.strip();
        this.endpoint = endpoint;
        timeout = Duration.ofSeconds(Math.max(1, Math.min(30, seconds)));
        http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(timeout).build();
    }

    public SearchResponse search(Criteria criteria) {
        if (!enabled) return response(Status.UNAVAILABLE, criteria, List.of(), "Wyszukiwanie noclegów jest obecnie wyłączone.", null);
        if (!key.isEmpty() && !key.matches("[!-~]{1,8192}")) return error(criteria);
        int cooldown = reserve();
        if (cooldown > 0) return response(Status.RATE_LIMITED, criteria, List.of(),
                "Trwa inne wyszukiwanie lub osiągnięto limit. Spróbuj ponownie za chwilę.", cooldown);
        try { return request(criteria); }
        finally { active.release(); }
    }

    private synchronized int reserve() {
        Instant now = clock.instant();
        if (now.isBefore(nextAllowed)) return (int) Math.max(1, Math.min(3600, (Duration.between(now, nextAllowed).toMillis() + 999) / 1000));
        if (!active.tryAcquire()) return 6;
        nextAllowed = now.plusSeconds(6);
        return 0;
    }

    private SearchResponse request(Criteria criteria) {
        var body = json.createObjectNode().put("jsonrpc", "2.0").put("id", "stay-search").put("method", "tools/call");
        var params = body.putObject("params").put("name", "search_hotels");
        var arguments = params.putObject("arguments").put("destination", criteria.destination()).put("check_in", criteria.checkIn().toString())
                .put("check_out", criteria.checkOut().toString()).put("adults", criteria.adults()).put("rooms", criteria.rooms())
                .put("currency", criteria.currency()).put("limit", 3).put("sort", "price_low_to_high");
        // These exact names belong to our European demo catalogue. Qualified or
        // other destinations stay unrestricted, so "Paris, Texas" is not changed.
        String country = switch (PlaceNames.normalize(criteria.destination())) {
            case "paryz", "paris" -> "FR";
            case "londyn", "london" -> "GB";
            case "amsterdam" -> "NL";
            default -> null;
        };
        if (country != null) arguments.put("country", country);
        var builder = HttpRequest.newBuilder(endpoint).timeout(timeout).header("Content-Type", "application/json")
                .header("Accept", "application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString()));
        if (!key.isEmpty()) builder.header("X-OBO-Key", key);
        CompletableFuture<HttpResponse<byte[]>> pending = null;
        try {
            pending = http.sendAsync(builder.build(), info -> new BoundedSubscriber(MAX_BYTES));
            var received = pending.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            if (received.statusCode() == 429) return rateLimited(criteria, retry(received.headers().firstValue("Retry-After").orElse("60")));
            if (received.statusCode() != 200) return error(criteria);
            return parse(json.readTree(received.body()), criteria);
        } catch (InterruptedException interrupted) {
            if (pending != null) pending.cancel(true);
            Thread.currentThread().interrupt();
            return error(criteria);
        } catch (Exception unavailable) {
            if (pending != null) pending.cancel(true);
            return error(criteria);
        }
    }

    SearchResponse parse(JsonNode root, Criteria criteria) throws IOException {
        if (root == null || !root.isObject()) return error(criteria);
        if (root.hasNonNull("error")) return providerFailure(root.get("error"), criteria);
        JsonNode result = root.path("result");
        if (!result.isObject()) return error(criteria);
        JsonNode payload = result.path("structuredContent");
        if (!payload.isObject()) {
            payload = null;
            for (JsonNode content : result.path("content")) {
                if ("text".equals(content.path("type").asText()) && content.path("text").isTextual()) {
                    try {
                        JsonNode candidate = json.readTree(content.get("text").asText());
                        if (candidate != null && candidate.isObject()) { payload = candidate; break; }
                    } catch (IOException notJson) { /* Human-readable MCP content is not a hotel result. */ }
                }
            }
        }
        if (payload == null) return error(criteria);
        if (payload.hasNonNull("error")) return providerFailure(payload.get("error"), criteria);
        if (result.path("isError").asBoolean(false) || payload.path("isError").asBoolean(false)
                || "RATE_LIMITED".equals(payload.path("status").asText()) || "RATE_LIMITED".equals(payload.path("code").asText()))
            return providerFailure(payload, criteria);
        JsonNode ambiguous = payload.path("ambiguous_destination");
        if (ambiguous.asBoolean(false) || ambiguous.isArray() && !ambiguous.isEmpty()) return response(Status.UNAVAILABLE, criteria, List.of(),
                "Doprecyzuj miasto noclegu, dodając kraj.", null);
        if (!payload.path("results").isArray()) return error(criteria);
        Instant checkedAt = clock.instant();
        var hotels = new ArrayList<Hotel>();
        boolean invalid = false;
        for (JsonNode row : payload.get("results")) {
            try {
                Hotel hotel = hotel(row, payload.path("freshness"), checkedAt, criteria.currency());
                if (hotel == null) invalid = true;
                else if (hotels.size() < 3) hotels.add(hotel);
            } catch (IllegalArgumentException badRow) { invalid = true; }
        }
        boolean partial = invalid || payload.path("partial").asBoolean(false);
        if (hotels.isEmpty()) {
            if (invalid) return error(criteria);
            return response(partial ? Status.PARTIAL : Status.EMPTY, criteria, List.of(),
                    partial ? "Dostawca zwrócił niepełny wynik. Spróbuj ponownie." : "Dostawca nie zwrócił noclegów dla tych kryteriów.", null);
        }
        hotels.sort(java.util.Comparator.comparing(hotel -> new BigDecimal(hotel.totalPrice())));
        Instant expires = hotels.stream().map(Hotel::expiresAt).min(Instant::compareTo).orElseThrow();
        return new SearchResponse(partial ? Status.PARTIAL : Status.OK, "OBO Travel", checkedAt, expires,
                criteria, List.copyOf(hotels), partial ? "Część ofert była niepełna lub nieaktualna. Pokazujemy dostępne aktualne wyniki." : null, null);
    }

    private Hotel hotel(JsonNode row, JsonNode envelope, Instant checked, String currency) {
        if (!row.isObject()) return null;
        String token = text(row.get("hotel_token"), 2048);
        if (token == null) token = text(row.get("hotel_id"), 2048);
        String name = text(row.get("name"), 240);
        String url = oboUrl(row.get("booking_url"));
        JsonNode price = row.path("price");
        String total = money(price.path("total"), currency);
        if (token == null || name == null || url == null || total == null) return null;
        Instant quoted = quoteTime(row.path("freshness"), envelope, checked);
        if (quoted == null) return null;
        Instant expires = min(quoted.plus(MAX_AGE), checked.plus(MAX_AGE));
        if (!expires.isAfter(checked)) return null;
        Double stars = row.path("stars").isNumber() ? row.get("stars").doubleValue() : null;
        if (stars != null && (!Double.isFinite(stars) || stars < 0 || stars > 5)) stars = null;
        var charges = new ArrayList<ExtraCharge>();
        JsonNode extra = price.path("extra_charges");
        if (!extra.isMissingNode() && !extra.isNull() && !extra.isArray()) return null;
        for (JsonNode charge : extra) {
            String chargeName = text(charge.get("name"), 240);
            String chargeCurrency = text(charge.path("amount").get("currency"), 3);
            if (chargeCurrency == null || !chargeCurrency.matches("[A-Z]{3}")) return null;
            String amount = money(charge.path("amount"), chargeCurrency);
            if (chargeName == null || amount == null) return null;
            charges.add(new ExtraCharge(chargeName, amount, chargeCurrency, text(charge.get("payable_at"), 120)));
        }
        return new Hotel(token, name, stars, total, money(price.path("nightly"), currency), currency, url,
                bool(price.get("taxes_included")), bool(price.get("fees_included")), List.copyOf(charges),
                text(price.get("inclusions_note"), 1000), quoted, expires, photoUrl(row), location(row.path("hotel")));
    }

    private static String photoUrl(JsonNode row) {
        String photo = oboUrl(row.get("photo_url"));
        if (photo != null) return photo;
        JsonNode hotel = row.path("hotel");
        photo = oboUrl(hotel.get("hero_image"));
        if (photo != null) return photo;
        JsonNode images = hotel.path("images");
        return images.isArray() && !images.isEmpty() ? oboUrl(images.get(0)) : null;
    }

    private static Location location(JsonNode hotel) {
        JsonNode latitude = hotel.path("latitude");
        JsonNode longitude = hotel.path("longitude");
        if (!latitude.isNumber() || !longitude.isNumber()) return null;
        double lat = latitude.doubleValue();
        double lon = longitude.doubleValue();
        return Double.isFinite(lat) && Double.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
                ? new Location(lat, lon) : null;
    }

    private Instant quoteTime(JsonNode local, JsonNode envelope, Instant checked) {
        JsonNode stamp = local.hasNonNull("quoted_at") ? local.get("quoted_at") : envelope.get("quoted_at");
        if (stamp == null || !stamp.isTextual()) return null;
        Instant quoted;
        try { quoted = OffsetDateTime.parse(stamp.asText()).toInstant(); }
        catch (java.time.DateTimeException invalid) { return null; }
        if (quoted.isAfter(checked.plusSeconds(60))) return null;
        quoted = min(quoted, checked);
        for (JsonNode source : List.of(local, envelope)) {
            if (source.hasNonNull("age_seconds")) {
                JsonNode age = source.get("age_seconds");
                if (!age.canConvertToLong() || !age.isIntegralNumber() || age.longValue() < 0 || age.longValue() > 31_536_000) return null;
                quoted = min(quoted, checked.minusSeconds(age.longValue()));
            }
        }
        return quoted;
    }

    private static String oboUrl(JsonNode node) {
        String value = text(node, 4096);
        if (value == null) return null;
        try {
            URI url = URI.create(value);
            return "https".equalsIgnoreCase(url.getScheme()) && url.getUserInfo() == null
                    && (url.getPort() == -1 || url.getPort() == 443)
                    && ("onebookingonline.com".equalsIgnoreCase(url.getHost()) || "www.onebookingonline.com".equalsIgnoreCase(url.getHost()))
                    ? value : null;
        } catch (IllegalArgumentException invalid) { return null; }
    }
    private static String money(JsonNode node, String currency) {
        if (!currency.equals(node.path("currency").asText()) || !node.path("amount").isValueNode()) return null;
        try {
            BigDecimal amount = new BigDecimal(node.get("amount").asText());
            if (amount.signum() < 0 || amount.scale() < 0 || amount.scale() > 2 || amount.precision() > 12) return null;
            return amount.toPlainString();
        } catch (NumberFormatException invalid) { return null; }
    }
    private static String text(JsonNode node, int max) {
        if (node == null || !node.isTextual()) return null;
        String value = node.asText();
        return value.isBlank() || value.length() > max || value.chars().anyMatch(Character::isISOControl) ? null : value;
    }
    private static Boolean bool(JsonNode node) { return node != null && node.isBoolean() ? node.booleanValue() : null; }
    private static Instant min(Instant first, Instant second) { return first.isBefore(second) ? first : second; }
    private static int retry(String value) {
        try { return Math.max(1, Math.min(3600, Integer.parseInt(value))); }
        catch (NumberFormatException invalid) { return 60; }
    }
    private SearchResponse error(Criteria criteria) { return response(Status.PROVIDER_ERROR, criteria, List.of(), "Nie udało się pobrać aktualnych noclegów. Spróbuj ponownie.", null); }
    private SearchResponse providerFailure(JsonNode error, Criteria criteria) {
        if ("RATE_LIMITED".equals(error.path("code").asText()) || "RATE_LIMITED".equals(error.path("status").asText())
                || "429".equals(error.path("code").asText()) || "RATE_LIMITED".equals(error.asText()))
            return rateLimited(criteria, retry(error.path("retry_after_seconds").asText("60")));
        return error(criteria);
    }
    private synchronized SearchResponse rateLimited(Criteria criteria, int seconds) {
        nextAllowed = nextAllowed.isAfter(clock.instant().plusSeconds(seconds)) ? nextAllowed : clock.instant().plusSeconds(seconds);
        return response(Status.RATE_LIMITED, criteria, List.of(), "Trwa inne wyszukiwanie lub osiągnięto limit. Spróbuj ponownie za chwilę.", seconds);
    }
    private SearchResponse response(Status status, Criteria criteria, List<Hotel> hotels, String message, Integer retry) {
        return new SearchResponse(status, "OBO Travel", clock.instant(), null, criteria, hotels, message, retry);
    }

    private static final class BoundedSubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> delegate = HttpResponse.BodySubscribers.ofByteArray();
        private final int limit;
        private Flow.Subscription subscription;
        private int received;
        private boolean failed;
        private BoundedSubscriber(int limit) { this.limit = limit; }
        @Override public CompletionStage<byte[]> getBody() { return delegate.getBody(); }
        @Override public void onSubscribe(Flow.Subscription subscription) { this.subscription = subscription; delegate.onSubscribe(subscription); }
        @Override public void onNext(List<ByteBuffer> buffers) {
            if (failed) return;
            for (ByteBuffer buffer : buffers) {
                if (buffer.remaining() > limit - received) {
                    failed = true;
                    subscription.cancel();
                    delegate.onError(new IOException("Provider response exceeded limit"));
                    return;
                }
                received += buffer.remaining();
            }
            delegate.onNext(buffers);
        }
        @Override public void onError(Throwable error) { if (!failed) delegate.onError(error); }
        @Override public void onComplete() { if (!failed) delegate.onComplete(); }
    }
}
