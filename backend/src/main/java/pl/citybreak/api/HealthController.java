package pl.citybreak.api;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pl.citybreak.persistence.DatabaseHealthCheck;

@RestController
@RequestMapping("/api/v1/health")
public class HealthController {
    private final DatabaseHealthCheck databaseHealthCheck;

    public HealthController(DatabaseHealthCheck databaseHealthCheck) {
        this.databaseHealthCheck = databaseHealthCheck;
    }

    @GetMapping
    public ResponseEntity<HealthResponse> health() {
        if (databaseHealthCheck.isAvailable()) {
            return ResponseEntity.ok(new HealthResponse("UP", "UP"));
        }
        return ResponseEntity.status(503).body(new HealthResponse("DOWN", "DOWN"));
    }

    public record HealthResponse(String status, String database) { }
}
