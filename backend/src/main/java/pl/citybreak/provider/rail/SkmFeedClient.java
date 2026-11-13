package pl.citybreak.provider.rail;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Reads only the fixed, official public download. The deadline includes the response body. */
final class SkmFeedClient {
    private static final URI DOWNLOAD = URI.create("https://www.skm.pkp.pl/gtfs-mi-kpd.zip");
    private static final int MAX_BYTES = 20 * 1024 * 1024;
    private static final Duration TIMEOUT = Duration.ofSeconds(8);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(TIMEOUT)
            .followRedirects(HttpClient.Redirect.NEVER).build();

    record Download(byte[] zip, OffsetDateTime publishedAt) {}

    Download download() throws IOException, InterruptedException {
        var request = HttpRequest.newBuilder(DOWNLOAD).timeout(TIMEOUT)
                .header("Accept", "application/zip")
                .header("User-Agent", "CityBreakPlanner/1.0 (public SKM timetable reader)").GET().build();
        var pending = client.sendAsync(request, info -> new LimitedBody());
        HttpResponse<byte[]> response;
        try {
            response = pending.get(TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException exception) {
            pending.cancel(true);
            throw new HttpTimeoutException("SKM download exceeded deadline");
        } catch (ExecutionException exception) {
            throw new IOException("SKM download failed", exception.getCause());
        } catch (InterruptedException exception) {
            pending.cancel(true);
            throw exception;
        }
        if (response.statusCode() != 200) throw new IOException("SKM returned HTTP " + response.statusCode());
        OffsetDateTime publishedAt = response.headers().firstValue("Last-Modified")
                .map(value -> OffsetDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME)).orElse(null);
        return new Download(response.body(), publishedAt);
    }

    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();
        private Flow.Subscription subscription;

        @Override public CompletableFuture<byte[]> getBody() { return result; }
        @Override public void onSubscribe(Flow.Subscription value) { subscription = value; value.request(1); }
        @Override public void onNext(List<ByteBuffer> buffers) {
            for (ByteBuffer buffer : buffers) {
                if ((long) output.size() + buffer.remaining() > MAX_BYTES) {
                    subscription.cancel();
                    result.completeExceptionally(new IOException("SKM download exceeds 20 MiB"));
                    return;
                }
                byte[] bytes = new byte[buffer.remaining()];
                buffer.get(bytes);
                output.writeBytes(bytes);
            }
            subscription.request(1);
        }
        @Override public void onError(Throwable error) { result.completeExceptionally(error); }
        @Override public void onComplete() { result.complete(output.toByteArray()); }
    }
}
