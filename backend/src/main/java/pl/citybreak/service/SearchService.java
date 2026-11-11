package pl.citybreak.service;

import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import pl.citybreak.model.Model.*;
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
    public SearchResponse search(Criteria criteria) {
        validation.criteria(criteria);
        TravelProvider.Catalog catalog = provider.search(criteria);
        List<RoundTrip> ranked = planner.rank(criteria, catalog.options(), catalog.attractions());
        SearchStatus status = catalog.status();
        if (!ranked.isEmpty() && ranked.stream().anyMatch(option -> !option.costSummary().complete())) status = SearchStatus.PARTIAL;
        return new SearchResponse(UUID.randomUUID().toString(), criteria, status, ranked,
                catalog.attractions(), catalog.sources(), catalog.testData());
    }
    public Plan preview(PlanInput input) {
        validation.plan(input);
        SearchResponse search = search(input.criteria());
        RoundTrip selected = search.roundTripOptions().stream()
                .filter(option -> option.id().equals(input.selectedRoundTrip().id())).findFirst()
                .orElseThrow(() -> search.status() == SearchStatus.PROVIDER_ERROR
                        ? new ApiException(503, "Źródło ofert jest niedostępne. Zapis nie został zmieniony.")
                        : invalid("selectedRoundTrip", "Wybrany wariant nie jest dostępny dla tych dat."));
        for (ItemInput item : input.items()) {
            if (search.attractions().stream().noneMatch(attraction -> attraction.id().equals(item.attractionId())))
                throw invalid("items", "Wybrana atrakcja nie jest dostępna w katalogu źródła.");
        }
        var items = planner.schedule(selected, input.items(), search.attractions());
        var cost = planner.cost(input.criteria(), selected,
                input.items().stream().map(ItemInput::attractionId).toList(), search.attractions());
        return new Plan(null, input.criteria(), selected, items, cost, null, null, search.testData(), null);
    }
    private ApiException invalid(String field, String message) {
        return new ApiException(400, "Popraw wskazane pola.", List.of(new FieldError(field, message)));
    }
}
