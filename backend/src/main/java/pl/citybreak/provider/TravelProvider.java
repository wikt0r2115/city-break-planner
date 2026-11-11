package pl.citybreak.provider;

import java.util.List;
import pl.citybreak.model.Model.*;

/** Provider results are server-side facts; selected client quotes are never trusted. */
public interface TravelProvider {
    record Catalog(List<RoundTrip> options, List<Attraction> attractions, List<Source> sources,
            SearchStatus status, boolean testData) {}
    Catalog search(Criteria criteria);
    /** Null means transfer data unavailable, never assume zero. */
    Integer transferMinutes(Place from, Place to);
}
