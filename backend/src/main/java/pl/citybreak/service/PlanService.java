package pl.citybreak.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import pl.citybreak.model.Model.*;
import pl.citybreak.persistence.PlanRepository;
import pl.citybreak.persistence.PlanRepository.Stored;

@Service
public class PlanService {
    private final PlanRepository plans;
    private final SearchService searches;
    private final Clock clock;
    private final String frontendBaseUrl;
    private final SecureRandom random = new SecureRandom();
    public PlanService(PlanRepository plans, SearchService searches, Clock clock,
            @Value("${app.frontend-base-url}") String frontendBaseUrl) {
        this.plans = plans; this.searches = searches; this.clock = clock;
        this.frontendBaseUrl = frontendBaseUrl.replaceAll("/+$", "");
        if (!this.frontendBaseUrl.matches("https?://[^\\s?#]+"))
            throw new IllegalArgumentException("Configure an absolute frontend URL without query or fragment");
    }
    public CreatedPlan create(PlanInput input) {
        Plan draft = searches.preview(input);
        OffsetDateTime now = OffsetDateTime.now(clock);
        Plan plan = persistable(draft, UUID.randomUUID().toString(), now, now);
        String owner = token();
        String share = token();
        plans.insert(new Stored(plan, hash(owner), share));
        return new CreatedPlan(ownerView(plan, share), owner);
    }
    public Plan owner(String id, String authorization) {
        Stored stored = authorized(id, authorization);
        return ownerView(stored.plan(), stored.shareToken());
    }
    public Plan update(String id, String authorization, PlanInput input) {
        Stored stored = authorized(id, authorization);
        Plan draft = searches.preview(input);
        Plan plan = persistable(draft, id, stored.plan().createdAt(), OffsetDateTime.now(clock));
        if (!plans.update(plan)) throw missing();
        return ownerView(plan, stored.shareToken());
    }
    public void delete(String id, String authorization) {
        authorized(id, authorization);
        if (!plans.delete(id)) throw missing();
    }
    public Plan shared(String shareToken) {
        if (!shareToken.matches("[A-Za-z0-9_-]{43}")) throw missing();
        return plans.findShared(shareToken).orElseThrow(PlanService::missing).plan();
    }
    private Stored authorized(String id, String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ") || authorization.length() <= 7)
            throw new ApiException(401, "Podaj token właściciela planu.");
        Stored stored = plans.find(id).orElseThrow(PlanService::missing);
        String token = authorization.substring(7);
        if (!token.matches("[A-Za-z0-9_-]{43}") || !MessageDigest.isEqual(
                stored.ownerHash().getBytes(StandardCharsets.US_ASCII), hash(token).getBytes(StandardCharsets.US_ASCII)))
            throw new ApiException(403, "Nie masz uprawnień właściciela tego planu.");
        return stored;
    }
    private Plan ownerView(Plan plan, String shareToken) {
        return new Plan(plan.id(), plan.criteria(), plan.selectedRoundTrip(), plan.items(), plan.costSummary(),
                plan.createdAt(), plan.updatedAt(), plan.testData(), frontendBaseUrl + "/shared/" + shareToken);
    }
    private Plan persistable(Plan draft, String id, OffsetDateTime created, OffsetDateTime updated) {
        return new Plan(id, draft.criteria(), draft.selectedRoundTrip(), draft.items(), draft.costSummary(),
                created, updated, draft.testData(), null);
    }
    private String token() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    private static String hash(String token) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException exception) { throw new IllegalStateException("SHA-256 unavailable", exception); }
    }
    private static ApiException missing() { return new ApiException(404, "Nie znaleziono planu lub link utracił ważność."); }
}
