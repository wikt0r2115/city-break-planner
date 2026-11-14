package pl.citybreak.api;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import pl.citybreak.stay.OboStayProvider;
import pl.citybreak.stay.StayModels.Criteria;
import pl.citybreak.stay.StayModels.SearchResponse;
import pl.citybreak.stay.StayValidation;

@RestController
public final class StayController {
    private final StayValidation validation;
    private final OboStayProvider provider;
    public StayController(StayValidation validation, OboStayProvider provider) {
        this.validation = validation;
        this.provider = provider;
    }
    @PostMapping("/api/v1/stays/search")
    ResponseEntity<SearchResponse> search(@RequestBody Criteria input) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(provider.search(validation.validate(input)));
    }
}
