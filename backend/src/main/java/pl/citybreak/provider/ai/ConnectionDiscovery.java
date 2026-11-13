package pl.citybreak.provider.ai;

import java.time.OffsetDateTime;
import java.util.List;
import pl.citybreak.model.Model.Criteria;

/** Finds leads that the transport provider must independently verify. */
public interface ConnectionDiscovery {
    boolean enabled();
    List<Candidate> discover(Criteria criteria);

    record Candidate(String origin, String destination, OffsetDateTime departureAt, OffsetDateTime arrivalAt,
            String sourceUrl) {}
}
