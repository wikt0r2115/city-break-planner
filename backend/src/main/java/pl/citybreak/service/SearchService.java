package pl.citybreak.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
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
        this.provider = provider;
        this.planner = planner;
        this.validation = validation;
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
        Criteria effectiveCriteria = provider.canonicalCriteria(criteria);
        TravelProvider.Catalog catalog = provider.search(effectiveCriteria);
        List<RoundTrip> allRanked = planner.rank(effectiveCriteria, catalog.options(), catalog.attractions());
        List<RoundTrip> ranked = allRanked.stream().limit(24).toList();
        List<Source> sources = new ArrayList<>(catalog.sources());
        if (allRanked.size() > ranked.size()) sources.add(new Source("result-limit", null, null, SourceStatus.OK,
                "Pokazano 24 najwyżej sklasyfikowane warianty spośród " + allRanked.size() + ". Ranking obejmuje wszystkie pobrane warianty."));
        SearchStatus status = catalog.status();
        if (!ranked.isEmpty() && ranked.stream().anyMatch(option -> !option.costSummary().complete())) status = SearchStatus.PARTIAL;
        return new SearchResponse(UUID.randomUUID().toString(), effectiveCriteria, status, ranked,
                catalog.attractions(), List.copyOf(sources), catalog.testData());
    }

    public Plan preview(PlanInput input) {
        validation.plan(input);
        Criteria effectiveCriteria = provider.canonicalCriteria(input.criteria());
        TravelProvider.Catalog catalog = provider.search(effectiveCriteria);
        RoundTrip raw = catalog.options().stream()
                .filter(option -> option.id().equals(input.selectedRoundTrip().id())).findFirst()
                .orElseThrow(() -> catalog.status() == SearchStatus.PROVIDER_ERROR
                        ? new ApiException(503, "Źródło ofert jest niedostępne. Zapis nie został zmieniony.")
                        : invalid("selectedRoundTrip", "Wybrany wariant nie jest dostępny dla tych dat."));
        Set<String> allowedAttractions = catalog.attractions().stream().map(Attraction::id).collect(Collectors.toSet());
        List<String> selectedAttractions = input.items().stream().map(ItemInput::attractionId).toList();
        if (!allowedAttractions.containsAll(selectedAttractions))
            throw invalid("items", "Wybrana atrakcja nie jest dostępna w katalogu źródła.");
        RoundTrip selected = planner.withRecommendations(effectiveCriteria, raw, catalog.attractions());
        var items = planner.schedule(selected, input.items(), catalog.attractions());
        var cost = planner.cost(effectiveCriteria, selected, selectedAttractions, catalog.attractions());
        return new Plan(null, effectiveCriteria, selected, items, cost, null, null, catalog.testData(), null);
    }
    private ApiException invalid(String field, String message) {
        return new ApiException(400, "Popraw wskazane pola.", List.of(new FieldError(field, message)));
    }
}
