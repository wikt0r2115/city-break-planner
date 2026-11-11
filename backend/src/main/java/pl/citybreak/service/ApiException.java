package pl.citybreak.service;

import java.util.List;
import pl.citybreak.model.Model.FieldError;

public final class ApiException extends RuntimeException {
    private final int status;
    private final List<FieldError> errors;
    public ApiException(int status, String message) { this(status, message, List.of()); }
    public ApiException(int status, String message, List<FieldError> errors) {
        super(message);
        this.status = status;
        this.errors = errors;
    }
    public int status() { return status; }
    public List<FieldError> errors() { return errors; }
}
