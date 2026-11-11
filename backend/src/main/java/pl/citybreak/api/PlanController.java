package pl.citybreak.api;

import java.net.URI;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import pl.citybreak.model.Model.*;
import pl.citybreak.service.PlanService;

@RestController
@RequestMapping("/api/v1")
public class PlanController {
    private final PlanService plans;
    public PlanController(PlanService plans) { this.plans = plans; }
    @PostMapping("/plans") ResponseEntity<CreatedPlan> create(@RequestBody PlanInput input) {
        CreatedPlan created = plans.create(input);
        return ResponseEntity.created(URI.create("/api/v1/plans/" + created.plan().id()))
                .cacheControl(CacheControl.noStore()).body(created);
    }
    @GetMapping("/plans/{id}") ResponseEntity<Plan> owner(@PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(plans.owner(id, authorization));
    }
    @PutMapping("/plans/{id}") ResponseEntity<Plan> update(@PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization, @RequestBody PlanInput input) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(plans.update(id, authorization, input));
    }
    @DeleteMapping("/plans/{id}") ResponseEntity<Void> delete(@PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        plans.delete(id, authorization);
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
    @GetMapping("/shared-plans/{shareToken}") ResponseEntity<Plan> shared(@PathVariable String shareToken) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .header("Referrer-Policy", "no-referrer").body(plans.shared(shareToken));
    }
}
