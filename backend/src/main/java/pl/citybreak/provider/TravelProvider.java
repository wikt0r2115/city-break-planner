package pl.citybreak.provider;

import java.util.List;
import java.util.Map;
import pl.citybreak.model.Model.*;

/** Provider results are server-side facts; selected client quotes are never trusted. */
public interface TravelProvider {
    record Catalog(List<RoundTrip> options, List<Attraction> attractions, List<Source> sources,
            SearchStatus status, boolean testData, Map<String, Interest> interestsByAttraction) {
        public Catalog(List<RoundTrip> options, List<Attraction> attractions, List<Source> sources,
                SearchStatus status, boolean testData) {
            this(options, attractions, sources, status, testData, Map.of());
        }
        public Interest interestOf(String attractionId) {
            return interestsByAttraction.getOrDefault(attractionId, Interest.MIXED);
        }
    }
    PlaceCatalog placeCatalog();
    default Criteria canonicalCriteria(Criteria criteria) { return criteria; }
    Catalog search(Criteria criteria);
    /** Null means transfer data unavailable, never assume zero. */
    Integer transferMinutes(Place from, Place to);
}
