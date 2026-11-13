package pl.citybreak.service;

import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import pl.citybreak.model.Model.*;
import pl.citybreak.model.PlaceNames;
import pl.citybreak.planning.Planner;
import pl.citybreak.provider.TravelProvider;

@Service
public class SearchService {
    private final TravelProvider provider;
    private final Planner planner;
    private final InputValidation validation;
    public SearchService(TravelProvider provider, Planner planner, InputValidation validation) {
        this.provider = provider; this.planner = planner; this.validation = validation;
    }

    public PlaceCatalog places(String query) {
        PlaceCatalog catalog = provider.placeCatalog();
        String normalizedQuery = PlaceNames.normalize(query);
        if (normalizedQuery.isEmpty()) return catalog;

        List<String> terms = List.of(normalizedQuery.split(" "));
        List<PlaceSuggestion> matches = catalog.places().stream().filter(place -> {
            String text = PlaceNames.normalize(place.value() + " " + place.label());
            return terms.stream().allMatch(text::contains);
        }).toList();
        return new PlaceCatalog(matches, catalog.testData());
    }

    public SearchResponse search(Criteria criteria) {
        validation.criteria(criteria);
        TravelProvider.Catalog catalog = provider.search(criteria);
        List<RoundTrip> allRanked = planner.rank(criteria, catalog.options(), catalog.attractions());
        List<RoundTrip> ranked = allRanked.stream().limit(24).toList();
        List<Source> sources = new java.util.ArrayList<>(catalog.sources());
        if (allRanked.size() > ranked.size()) sources.add(new Source("result-limit", null, null, SourceStatus.OK,
                "Pokazano 24 najwyżej sklasyfikowane warianty spośród " + allRanked.size() + ". Ranking obejmuje wszystkie pobrane warianty."));
        SearchStatus status = catalog.status();
        if (!ranked.isEmpty() && ranked.stream().anyMatch(option -> !option.costSummary().complete())) status = SearchStatus.PARTIAL;
        return new SearchResponse(UUID.randomUUID().toString(), criteria, status, ranked,
                catalog.attractions(), List.copyOf(sources), catalog.testData());
    }
    public Plan preview(PlanInput input) {
        validation.plan(input);
        // A previously displayed option may fall outside the first page after changing the priority.
        TravelProvider.Catalog catalog = provider.search(input.criteria());
        RoundTrip selected = planner.rank(input.criteria(), catalog.options(), catalog.attractions()).stream()
                .filter(option -> option.id().equals(input.selectedRoundTrip().id())).findFirst()
                .orElseThrow(() -> catalog.status() == SearchStatus.PROVIDER_ERROR
                        ? new ApiException(503, "Źródło ofert jest niedostępne. Zapis nie został zmieniony.")
                        : invalid("selectedRoundTrip", "Wybrany wariant nie jest dostępny dla tych dat."));
        for (ItemInput item : input.items()) {
            if (catalog.attractions().stream().noneMatch(attraction -> attraction.id().equals(item.attractionId())))
                throw invalid("items", "Wybrana atrakcja nie jest dostępna w katalogu źródła.");
        }
        var items = planner.schedule(selected, input.items(), catalog.attractions());
        var cost = planner.cost(input.criteria(), selected,
                input.items().stream().map(ItemInput::attractionId).toList(), catalog.attractions());
        return new Plan(null, input.criteria(), selected, items, cost, null, null, catalog.testData(), null);
    }
    private ApiException invalid(String field, String message) {
        return new ApiException(400, "Popraw wskazane pola.", List.of(new FieldError(field, message)));
    }
}
