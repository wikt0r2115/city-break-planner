package pl.citybreak.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class PlanningConfiguration {
    @Bean Clock clock() { return Clock.systemUTC(); }
}
