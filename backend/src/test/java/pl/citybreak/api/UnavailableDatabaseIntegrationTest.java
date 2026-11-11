package pl.citybreak.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.json.JsonCompareMode;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class UnavailableDatabaseIntegrationTest {
    @Autowired private MockMvc mvc;

    @DynamicPropertySource
    static void unavailableDatabase(DynamicPropertyRegistry registry) {
        Path absentDirectory = Path.of(System.getProperty("java.io.tmpdir"),
                "city-break-absent-" + UUID.randomUUID(), "database.db");
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + absentDirectory);
    }

    @Test
    void unavailableSqliteReturns503WithoutConnectionDetails() throws Exception {
        mvc.perform(get("/api/v1/health"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(content().json("{\"status\":\"DOWN\",\"database\":\"DOWN\"}", JsonCompareMode.STRICT));
    }
}
