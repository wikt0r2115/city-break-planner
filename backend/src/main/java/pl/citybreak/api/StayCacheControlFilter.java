package pl.citybreak.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Also prevents caching malformed requests handled before the controller is invoked. */
@Component
public final class StayCacheControlFilter extends OncePerRequestFilter {
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        if (request.getRequestURI().equals("/api/v1/stays/search") || request.getRequestURI().equals("/api/v1/stays/search/"))
            response.setHeader("Cache-Control", "no-store");
        chain.doFilter(request, response);
    }
}
