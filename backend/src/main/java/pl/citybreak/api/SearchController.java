package pl.citybreak.api;

import org.springframework.web.bind.annotation.*;
import pl.citybreak.model.Model.*;
import pl.citybreak.service.AttractionRecommendations;
import pl.citybreak.service.SearchService;

@RestController
@RequestMapping("/api/v1")
public class SearchController {
    private final SearchService searches;
    private final AttractionRecommendations recommendations;
    public SearchController(SearchService searches, AttractionRecommendations recommendations) {
        this.searches = searches;
        this.recommendations = recommendations;
    }
    @GetMapping("/places") PlaceCatalog places(@RequestParam(name = "q", defaultValue = "") String query) { return searches.places(query); }
    @PostMapping("/searches") SearchResponse search(@RequestBody Criteria criteria) { return searches.search(criteria); }
    @PostMapping("/recommendations") Recommendations recommendations(@RequestBody RecommendationInput input) {
        return recommendations.suggest(input);
    }
    @PostMapping("/plans/preview") Plan preview(@RequestBody PlanInput input) { return searches.preview(input); }
}
