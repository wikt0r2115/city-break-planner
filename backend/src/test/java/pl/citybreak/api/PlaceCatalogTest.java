package pl.citybreak.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import pl.citybreak.planning.Planner;
import pl.citybreak.provider.DemoTravelProvider;
import pl.citybreak.provider.LiveGdanskProvider;
import pl.citybreak.provider.TravelProvider;
import pl.citybreak.provider.UnavailableTravelProvider;
import pl.citybreak.service.InputValidation;
import pl.citybreak.service.SearchService;

class PlaceCatalogTest {
    private final Clock clock = Clock.systemUTC();

    @Test
    void listsOnlyCoveredStopsAndFiltersPolishNamesWithoutDiacritics() throws Exception {
        try (var provider = new LiveGdanskProvider(clock, new ObjectMapper(), uri -> {
            throw new AssertionError("The place catalog must not fetch a timetable");
        })) {
            MockMvc mvc = controller(provider);
            mvc.perform(get("/api/v1/places"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.testData").value(false))
                    .andExpect(jsonPath("$.places.length()").value(2))
                    .andExpect(jsonPath("$.places[0].value").value("Dworzec Główny"))
                    .andExpect(jsonPath("$.places[0].label").value("Dworzec Główny, Gdańsk"))
                    .andExpect(jsonPath("$.places[1].value").value("Targ Rybny"));
            mvc.perform(get("/api/v1/places").param("q", "  GDANSK, DWORZEC    GLOWNY  "))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.places.length()").value(1))
                    .andExpect(jsonPath("$.places[0].value").value("Dworzec Główny"));
            mvc.perform(get("/api/v1/places").param("q", "ryb"))
                    .andExpect(jsonPath("$.places[0].value").value("Targ Rybny"));
            mvc.perform(get("/api/v1/places").param("q", "Kraków"))
                    .andExpect(jsonPath("$.places").isEmpty());
        }
    }

    @Test
    void marksDemoSuggestionsAndReturnsAnEmptyListWithoutConfiguredSources() throws Exception {
        controller(new DemoTravelProvider(clock)).perform(get("/api/v1/places").param("q", "gdansk"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.testData").value(true))
                .andExpect(jsonPath("$.places[0].value").value("Gdańsk"));
        controller(new UnavailableTravelProvider(clock)).perform(get("/api/v1/places"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.testData").value(false))
                .andExpect(jsonPath("$.places").isEmpty());
    }

    private MockMvc controller(TravelProvider provider) {
        SearchService search = new SearchService(provider, new Planner(provider), new InputValidation(clock));
        return MockMvcBuilders.standaloneSetup(new SearchController(search)).build();
    }
}
