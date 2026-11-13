package pl.citybreak.api;

import org.springframework.web.bind.annotation.*;
import pl.citybreak.model.Model.*;
import pl.citybreak.service.SearchService;

@RestController
@RequestMapping("/api/v1")
public class SearchController {
    private final SearchService searches;
    public SearchController(SearchService searches) { this.searches = searches; }
    @GetMapping("/places") PlaceCatalog places(@RequestParam(name = "q", defaultValue = "") String query) { return searches.places(query); }
    @PostMapping("/searches") SearchResponse search(@RequestBody Criteria criteria) { return searches.search(criteria); }
    @PostMapping("/plans/preview") Plan preview(@RequestBody PlanInput input) { return searches.preview(input); }
}
