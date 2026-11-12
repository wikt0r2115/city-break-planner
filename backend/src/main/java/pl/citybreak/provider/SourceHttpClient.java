package pl.citybreak.provider;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Anonymous, bounded reads. Redirects are deliberately not followed to another host. */
public final class SourceHttpClient implements LiveGdanskProvider.SourceFetcher {
    static final int MAX_BYTES = 5 * 1024 * 1024;
    private final HttpClient client;
    private final Duration timeout;

    public SourceHttpClient(int timeoutSeconds) {
        if (timeoutSeconds < 1 || timeoutSeconds > 5)
            throw new IllegalArgumentException("APP_SOURCE_TIMEOUT_SECONDS must be between 1 and 5");
        timeout = Duration.ofSeconds(timeoutSeconds);
        client = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build();
    }

    @Override public String get(URI uri) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(timeout)
                .header("User-Agent", "CityBreakPlanner/1.0 (anonymous public-data reader)")
                .header("Accept", "application/json,text/html;q=0.9").GET().build();
        var pending = client.sendAsync(request, info -> new LimitedBody());
        HttpResponse<byte[]> response;
        try { response = pending.get(timeout.toMillis(), TimeUnit.MILLISECONDS); }
        catch (TimeoutException exception) {
            pending.cancel(true);
            throw new java.net.http.HttpTimeoutException("Source response deadline exceeded");
        } catch (ExecutionException exception) {
            if (exception.getCause() instanceof IOException io) throw io;
            throw new IOException("Source read failed", exception.getCause());
        } catch (InterruptedException exception) { pending.cancel(true); throw exception; }
        if (response.statusCode() != 200) throw new IOException("HTTP " + response.statusCode());
        return new String(response.body(), StandardCharsets.UTF_8);
    }

    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        @Override public CompletionStage<byte[]> getBody() { return result; }
        @Override public void onSubscribe(Flow.Subscription value) { subscription = value; value.request(1); }
        @Override public void onNext(List<ByteBuffer> buffers) {
            for (ByteBuffer buffer : buffers) {
                if ((long) output.size() + buffer.remaining() > MAX_BYTES) {
                    subscription.cancel(); result.completeExceptionally(new IOException("Response exceeds 5 MiB")); return;
                }
                byte[] bytes = new byte[buffer.remaining()]; buffer.get(bytes); output.writeBytes(bytes);
            }
            subscription.request(1);
        }
        @Override public void onError(Throwable error) { result.completeExceptionally(error); }
        @Override public void onComplete() { result.complete(output.toByteArray()); }
    }
}
