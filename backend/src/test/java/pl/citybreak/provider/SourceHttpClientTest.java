package pl.citybreak.provider;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.time.Duration;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;

class SourceHttpClientTest {
    @Test void deadlineAlsoBoundsSlowResponseBodyAfterSuccessfulHeaders() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool(task -> { var thread = new Thread(task); thread.setDaemon(true); return thread; }));
        server.createContext("/slow", exchange -> {
            exchange.sendResponseHeaders(200, 100);
            exchange.getResponseBody().write('x'); exchange.getResponseBody().flush();
            try { Thread.sleep(4000); } catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
            exchange.close();
        }); server.start();
        long start = System.nanoTime();
        try {
            assertThatThrownBy(() -> new SourceHttpClient(1).get(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/slow")))
                    .isInstanceOf(java.io.IOException.class);
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(3));
        } finally { server.stop(0); }
    }
    @Test void oversizedResponseIsRejectedAndRedirectsAreNotFollowed() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/large", exchange -> {
            byte[] bytes = new byte[SourceHttpClient.MAX_BYTES + 1];
            exchange.sendResponseHeaders(200, bytes.length);
            try { exchange.getResponseBody().write(bytes); } finally { exchange.close(); }
        });
        server.createContext("/redirect", exchange -> {
            exchange.getResponseHeaders().add("Location", "http://example.com/private"); exchange.sendResponseHeaders(302, -1); exchange.close();
        }); server.start();
        try {
            var client = new SourceHttpClient(2); String root = "http://127.0.0.1:" + server.getAddress().getPort();
            assertThatThrownBy(() -> client.get(URI.create(root + "/large"))).isInstanceOf(java.io.IOException.class);
            assertThatThrownBy(() -> client.get(URI.create(root + "/redirect"))).isInstanceOf(java.io.IOException.class).hasMessage("HTTP 302");
        } finally { server.stop(0); }
    }
}
