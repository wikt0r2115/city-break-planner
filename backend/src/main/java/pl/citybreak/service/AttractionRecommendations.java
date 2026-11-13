package pl.citybreak.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import pl.citybreak.model.Model.*;
import pl.citybreak.planning.Planner;
import pl.citybreak.provider.TravelProvider;
import pl.citybreak.provider.ai.OpenAiAttractionAdvisor;

@Service
public class AttractionRecommendations {
    private static final int MAX_SUGGESTIONS = 3;
    private final TravelProvider transport;
    private final Planner planner;
    private final InputValidation validation;
    private final OpenAiAttractionAdvisor advisor;

    public AttractionRecommendations(TravelProvider transport, Planner planner, InputValidation validation,
            OpenAiAttractionAdvisor advisor) {
        this.transport = transport;
        this.planner = planner;
        this.validation = validation;
        this.advisor = advisor;
    }

    public Recommendations suggest(RecommendationInput input) {
        if (input == null || input.interest() == null || input.roundTripId() == null ||
                input.budgetPln() == null || input.budgetPln() < 0 || input.budgetPln() > 10_000) {
            throw new ApiException(400, "Podaj wariant, zainteresowania i budżet na atrakcje od 0 do 10 000 zł.");
        }
        validation.criteria(input.criteria());
        Criteria criteria = transport.canonicalCriteria(input.criteria());
        var catalog = transport.search(criteria);
        var trip = catalog.options().stream().filter(option -> option.id().equals(input.roundTripId())).findFirst()
                .orElseThrow(() -> new ApiException(400, "Wybierz dostępny wariant podróży."));
        BigDecimal budget = BigDecimal.valueOf(input.budgetPln());
        Map<String, Option> eligible = new LinkedHashMap<>();
        for (Attraction attraction : catalog.attractions()) {
            BigDecimal price = planner.comparablePrice(attraction.entryPrices(), criteria);
            if (price == null) continue;
            var option = new Option(attraction, catalog.interestOf(attraction.id()), price);
            if (fits(List.of(option), trip, budget, catalog.attractions())) eligible.put(attraction.id(), option);
        }
        List<Recommendation> ranked = advisor.suggest(criteria.destination(), trip.timeAtDestinationMinutes(),
                input.interest(), input.budgetPln(), List.copyOf(eligible.values()));
        List<Option> selected = new ArrayList<>();
        List<Recommendation> suggestions = new ArrayList<>();
        for (var recommendation : ranked) {
            if (selected.size() >= MAX_SUGGESTIONS) break;
            Option option = eligible.get(recommendation.attractionId());
            if (option == null || selected.contains(option)) continue;
            if (addIfFits(option, selected, trip, budget, catalog.attractions())) suggestions.add(recommendation);
        }
        boolean aiUsed = !suggestions.isEmpty();
        for (Option option : eligible.values().stream()
                .sorted(Comparator.comparing(candidate -> candidate.category() != input.interest())).toList()) {
            if (selected.size() >= MAX_SUGGESTIONS) break;
            if (selected.contains(option)) continue;
            if (addIfFits(option, selected, trip, budget, catalog.attractions())) {
                String reason = option.category() == input.interest() ? "Pasuje do Twoich zainteresowań."
                        : "Mieści się w czasie i budżecie na zwiedzanie.";
                suggestions.add(new Recommendation(option.attraction().id(), reason));
            }
        }
        return new Recommendations(List.copyOf(suggestions), aiUsed);
    }

    public record Option(Attraction attraction, Interest category, BigDecimal price) {}

    private boolean addIfFits(Option option, List<Option> selected, RoundTrip trip,
            BigDecimal budget, List<Attraction> attractions) {
        selected.add(option);
        if (fits(selected, trip, budget, attractions)) return true;
        selected.remove(selected.size() - 1);
        return false;
    }

    private boolean fits(List<Option> options, RoundTrip trip, BigDecimal budget, List<Attraction> attractions) {
        BigDecimal total = options.stream().map(Option::price).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (total.compareTo(budget) > 0) return false;
        var items = options.stream().map(Option::attraction)
                .map(visit -> new ItemInput(visit.id(), visit.id(), null, visit.visitMinutes())).toList();
        return planner.schedule(trip, items, attractions).stream().allMatch(item -> item.conflicts().isEmpty());
    }
}
