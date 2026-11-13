package pl.citybreak.provider.rail;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import pl.citybreak.model.Model.*;

class SkmTimetableTest {
    private static final LocalDate SATURDAY = LocalDate.of(2026, 11, 14);
    private static final LocalDate SUNDAY = SATURDAY.plusDays(1);
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.parse("2026-11-13T00:02:12Z");
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-13T09:00:00Z"), ZoneOffset.UTC);

    @Test void verifiesBothRoutesAndPreservesAlternativeReturns() throws IOException {
        var timetable = fixture();
        assertThat(timetable.canonicalPlace("   Gdansk ")).isEqualTo("Gdańsk Główny");
        assertThat(timetable.canonicalPlace("GDYNIA GLOWNA")).isEqualTo("Gdynia Główna");
        assertThat(timetable.canonicalPlace("Dworzec Główny")).isNull();
        assertThat(timetable.supports("Wejherowo", "Gdańsk Główny")).isTrue();
        assertThat(timetable.supports("Gdynia", "Wejherowo")).isFalse();

        for (String destination : new String[] { "Gdynia", "Wejherowo" }) {
            var result = timetable.search(criteria("gdansk", destination, SATURDAY, SUNDAY));
            assertThat(result.status()).isEqualTo(SearchStatus.PARTIAL);
            assertThat(result.testData()).isFalse();
            assertThat(result.attractions()).isEmpty();
            assertThat(result.options()).hasSize(destination.equals("Gdynia") ? 3 : 2).allSatisfy(roundTrip -> {
                assertThat(roundTrip.transfers()).isZero();
                assertThat(roundTrip.travelMinutes()).isPositive();
                assertThat(roundTrip.timeAtDestinationMinutes()).isPositive();
                Segment out = roundTrip.outbound().segments().get(0);
                assertThat(out.mode()).isEqualTo(Mode.TRAIN);
                assertThat(out.origin().name()).isEqualTo("Gdańsk Główny");
                assertThat(out.destination().name()).isEqualTo(timetable.canonicalPlace(destination));
                assertThat(out.departureAt().toLocalDate()).isEqualTo(SATURDAY);
                assertThat(out.prices()).isEmpty();
                assertThat(out.bookingUrl()).isEqualTo("https://bilety.skm.pkp.pl/");
                assertThat(out.mapUrl()).contains("travelmode=transit");
                Segment back = roundTrip.returnJourney().segments().get(0);
                assertThat(back.departureAt().toLocalDate()).isEqualTo(SUNDAY);
                assertThat(back.origin().name()).isEqualTo(out.destination().name());
                assertThat(back.destination().name()).isEqualTo(out.origin().name());
            });
            assertThat(result.options()).extracting(RoundTrip::id).doesNotHaveDuplicates();
            assertThat(result.sources()).anySatisfy(source -> {
                assertThat(source.sourceId()).isEqualTo(SkmTimetable.PUBLICATION_ID);
                assertThat(source.checkedAt()).isEqualTo(PUBLISHED);
            });
        }
    }

    @Test void convertsMidnightDeparturesToTheirActualCalendarDay() throws IOException {
        var timetable = fixture();
        var result = timetable.search(criteria("Gdynia", "Gdańsk", SUNDAY, SUNDAY));
        assertThat(result.options()).isNotEmpty().allSatisfy(option -> {
            assertThat(option.outbound().departureAt()).isEqualTo(OffsetDateTime.parse("2026-11-15T00:13:00+01:00"));
            assertThat(option.outbound().arrivalAt()).isEqualTo(OffsetDateTime.parse("2026-11-15T00:48:00+01:00"));
        });
    }

    @Test void distinguishesCoverageServiceExceptionAndProviderFailure() throws IOException {
        var timetable = fixture();
        var outside = timetable.search(criteria("Gdańsk", "Gdynia", SUNDAY, SUNDAY.plusDays(1)));
        assertThat(outside.status()).isEqualTo(SearchStatus.PARTIAL);
        assertThat(outside.options()).isEmpty();
        assertThat(outside.sources()).extracting(Source::reasonCode).contains("OUTSIDE_COVERAGE");
        var removedReturn = timetable.search(criteria("Gdańsk", "Wejherowo", SATURDAY, SATURDAY));
        assertThat(removedReturn.status()).isEqualTo(SearchStatus.NO_CONNECTION);
        var failure = new SkmTimetable(CLOCK, () -> new SkmFeedClient.Download(new byte[] { 1, 2 }, PUBLISHED))
                .search(criteria("Gdańsk", "Wejherowo", SATURDAY, SUNDAY));
        assertThat(failure.status()).isEqualTo(SearchStatus.PROVIDER_ERROR);
        assertThat(failure.sources()).extracting(Source::reasonCode).containsExactly("UPSTREAM_FAILURE");
    }

    @Test void refreshesAtMostOnceOnTheSamePublicationDay() throws IOException {
        var zip = archive();
        var attempts = new AtomicInteger();
        var timetable = new SkmTimetable(CLOCK, () -> {
            attempts.incrementAndGet();
            return new SkmFeedClient.Download(zip, PUBLISHED);
        });
        timetable.search(criteria("Gdańsk", "Gdynia", SATURDAY, SUNDAY));
        timetable.search(criteria("Gdańsk", "Wejherowo", SATURDAY, SUNDAY));
        assertThat(attempts.get()).isEqualTo(1);
    }

    private static SkmTimetable fixture() throws IOException {
        byte[] zip = archive();
        return new SkmTimetable(CLOCK, () -> new SkmFeedClient.Download(zip, PUBLISHED));
    }

    private static Criteria criteria(String origin, String destination, LocalDate out, LocalDate back) {
        return new Criteria(origin, destination, out, back, Priority.SHORTEST_TRAVEL_TIME, "PLN", FareType.STANDARD);
    }

    private static byte[] archive() throws IOException {
        var tables = Map.of("stops.txt", """
                stop_id,stop_name,stop_lat,stop_lon
                7500,"GDAŃSK GŁÓWNY",54.35,18.64
                5900,GDYNIA GŁÓWNA,54.52,18.53
                6304,WEJHEROWO,54.60,18.22
                """, "routes.txt", "route_id,route_type\nrail,2\n", "trips.txt", """
                route_id,service_id,trip_id,trip_short_name
                rail,daily,out1,99601
                rail,saturday,late,99603
                rail,sunday,back1,99602
                rail,sunday,back2,99604
                """, "calendar.txt", """
                service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date
                daily,0,0,0,0,0,1,1,20261114,20261115
                saturday,0,0,0,0,0,1,0,20261114,20261114
                sunday,0,0,0,0,0,1,0,20261114,20261114
                """, "calendar_dates.txt", """
                service_id,date,exception_type
                sunday,20261114,2
                sunday,20261115,1
                """, "stop_times.txt", """
                trip_id,stop_id,stop_sequence,arrival_time,departure_time
                out1,5900,2,09:35:00,09:36:00
                out1,7500,1,09:00:00,09:00:00
                out1,6304,3,10:10:00,10:10:00
                late,5900,1,24:13:00,24:13:00
                late,7500,2,24:48:00,24:48:00
                back1,6304,1,15:25:00,15:25:00
                back1,5900,2,16:00:00,16:01:00
                back1,7500,3,16:35:00,16:35:00
                back2,6304,1,17:25:00,17:25:00
                back2,5900,2,18:00:00,18:01:00
                back2,7500,3,18:35:00,18:35:00
                """);
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            for (var table : tables.entrySet()) {
                zip.putNextEntry(new ZipEntry(table.getKey()));
                zip.write(table.getValue().getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }
}
