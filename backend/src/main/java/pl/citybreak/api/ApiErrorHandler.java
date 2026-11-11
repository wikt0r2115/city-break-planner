package pl.citybreak.api;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.util.List;
import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import pl.citybreak.model.Model.FieldError;
import pl.citybreak.service.ApiException;

@RestControllerAdvice
public class ApiErrorHandler extends ResponseEntityExceptionHandler {
    @ExceptionHandler(ApiException.class)
    ResponseEntity<ProblemDetail> api(ApiException error, HttpServletRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatusCode.valueOf(error.status()), error.getMessage());
        problem.setTitle(switch (error.status()) {
            case 400 -> "Nieprawidłowe dane";
            case 401 -> "Wymagany token właściciela";
            case 403 -> "Brak uprawnień";
            case 404 -> "Nie znaleziono planu";
            default -> "Usługa niedostępna";
        });
        problem.setInstance(URI.create(request.getRequestURI()));
        if (!error.errors().isEmpty()) problem.setProperty("errors", error.errors());
        var response = ResponseEntity.status(error.status()).cacheControl(CacheControl.noStore());
        if (error.status() == 401) response.header(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        return response.body(problem);
    }
    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<ProblemDetail> database(DataAccessException error, HttpServletRequest request) {
        return api(new ApiException(503, "Zapis planów jest chwilowo niedostępny. Spróbuj ponownie."), request);
    }
    @Override protected ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException error,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Podaj poprawny JSON, daty i wartości pól.");
        problem.setTitle("Nieprawidłowe dane");
        problem.setProperty("errors", List.of(new FieldError("body", "Sprawdź format dat, godzin i wybranych wartości.")));
        return handleExceptionInternal(error, problem, headers, HttpStatus.BAD_REQUEST, request);
    }
}
