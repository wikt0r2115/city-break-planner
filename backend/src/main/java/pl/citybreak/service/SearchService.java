package pl.citybreak.service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
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
    private final RailSearch rail;

    public SearchService(TravelProvider provider, Planner planner, InputValidation validation) {
        this(provider, planner, validation, (RailSearch) null);
    }

    @Autowired
    SearchService(TravelProvider provider, Planner planner, InputValidation validation, ObjectProvider<RailSearch> rail) {
        this(provider, planner, validation, rail.getIfAvailable());
    }

    SearchService(TravelProvider provider, Planner planner, InputValidation validation, RailSearch rail) {
        this.provider = provider;
        this.planner = planner;
        this.validation = validation;
        this.rail = rail;
    }

    public PlaceCatalog places(String query) {
        PlaceCatalog catalog = provider.placeCatalog();
        if (rail != null) {
            List<PlaceSuggestion> places = new ArrayList<>(catalog.places());
            places.addAll(rail.places().places());
            catalog = new PlaceCatalog(List.copyOf(places), catalog.testData());
        }
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
        return search(criteria, true);
    }

    public SearchResponse search(Criteria criteria, boolean discovery) {
        validation.criteria(criteria);
        Criteria canonical = rail == null ? null : rail.canonicalCriteria(criteria);
        TravelProvider.Catalog catalog = canonical == null ? baseSearch(criteria) : rail.search(canonical, discovery);
        Criteria effectiveCriteria = canonical == null ? criteria : canonical;
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

    private TravelProvider.Catalog baseSearch(Criteria criteria) {
        TravelProvider.Catalog result = provider.search(criteria);
        if (rail == null || result.sources().stream().noneMatch(source -> "UNSUPPORTED_ROUTE".equals(source.reasonCode())))
            return result;
        if (rail.ambiguous(criteria.origin()) || rail.ambiguous(criteria.destination())) {
            Source source = new Source("approved-coverage", null, null, SourceStatus.NO_COVERAGE,
                    "Doprecyzuj nazwę miejsca startu lub celu, wybierając podpowiedź.", "AMBIGUOUS_PLACE");
            return new TravelProvider.Catalog(List.of(), List.of(), List.of(source), SearchStatus.PARTIAL, false);
        }
        Source source = new Source("approved-coverage", null, null, SourceStatus.NO_COVERAGE,
                "Trasa jest poza zakresem obsługiwanych rozkładów.", "UNSUPPORTED_ROUTE");
        return new TravelProvider.Catalog(List.of(), List.of(), List.of(source), SearchStatus.PARTIAL, false);
    }

    public Plan preview(PlanInput input) {
        validation.plan(input);
        // A previously displayed option may fall outside the first page after changing the priority.
        Criteria canonical = rail == null ? null : rail.canonicalCriteria(input.criteria());
        Criteria effectiveCriteria = canonical == null ? input.criteria() : canonical;
        TravelProvider.Catalog catalog = canonical == null ? provider.search(effectiveCriteria) : rail.search(canonical, false);
        RoundTrip selected = planner.rank(effectiveCriteria, catalog.options(), catalog.attractions()).stream()
                .filter(option -> option.id().equals(input.selectedRoundTrip().id())).findFirst()
                .orElseThrow(() -> catalog.status() == SearchStatus.PROVIDER_ERROR
                        ? new ApiException(503, "Źródło ofert jest niedostępne. Zapis nie został zmieniony.")
                        : invalid("selectedRoundTrip", "Wybrany wariant nie jest dostępny dla tych dat."));
        for (ItemInput item : input.items()) {
            if (catalog.attractions().stream().noneMatch(attraction -> attraction.id().equals(item.attractionId())))
                throw invalid("items", "Wybrana atrakcja nie jest dostępna w katalogu źródła.");
        }
        var items = planner.schedule(selected, input.items(), catalog.attractions());
        var cost = planner.cost(effectiveCriteria, selected,
                input.items().stream().map(ItemInput::attractionId).toList(), catalog.attractions());
        return new Plan(null, effectiveCriteria, selected, items, cost, null, null, catalog.testData(), null);
    }
    private ApiException invalid(String field, String message) {
        return new ApiException(400, "Popraw wskazane pola.", List.of(new FieldError(field, message)));
    }
}
