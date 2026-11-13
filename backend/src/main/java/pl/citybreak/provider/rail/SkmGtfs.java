package pl.citybreak.provider.rail;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import pl.citybreak.model.Model.Place;
import pl.citybreak.model.PlaceNames;

/** Parsed subset of the official SKM feed. Geometry is not needed for timetable lookups. */
final class SkmGtfs {
    static final ZoneId WARSAW = ZoneId.of("Europe/Warsaw");
    private static final int MAX_FILE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_ROWS = 100_000;
    private static final int MAX_LINE_LENGTH = 8_192;
    private static final int MAX_ARCHIVE_ENTRIES = 32;

    private final Map<String, Place> places;
    private final List<Trip> trips;
    private final Map<String, Service> services;
    private final Map<String, Map<LocalDate, Boolean>> exceptions;
    private final LocalDate firstDate;
    private final LocalDate lastDate;
    private final OffsetDateTime publishedAt;

    private SkmGtfs(Map<String, Place> places, List<Trip> trips, Map<String, Service> services,
                    Map<String, Map<LocalDate, Boolean>> exceptions, OffsetDateTime publishedAt) {
        this.places = places;
        this.trips = trips;
        this.services = services;
        this.exceptions = exceptions;
        this.publishedAt = publishedAt;
        var dates = new ArrayList<LocalDate>();
        services.values().forEach(service -> { dates.add(service.start()); dates.add(service.end()); });
        exceptions.values().forEach(days -> dates.addAll(days.keySet()));
        firstDate = dates.stream().min(Comparator.naturalOrder()).orElseThrow();
        lastDate = dates.stream().max(Comparator.naturalOrder()).orElseThrow();
    }

    record Call(String stop, int sequence, Integer arrival, Integer departure, boolean pickup, boolean dropOff) {}
    record Trip(String service, String number, List<Call> calls) {}
    record TripHeader(String service, String number) {}
    record Service(LocalDate start, LocalDate end, int weekdays) {
        boolean runsOn(LocalDate date) {
            int dayBit = 1 << (date.getDayOfWeek().getValue() - 1);
            return !date.isBefore(start) && !date.isAfter(end) && (weekdays & dayBit) != 0;
        }
    }

    static SkmGtfs read(SkmFeedClient.Download download, Map<String, String> stationNames) throws IOException {
        var path = Files.createTempFile("city-break-skm-", ".zip");
        try {
            Files.write(path, download.zip());
            try (var archive = new ZipFile(path.toFile())) {
                if (archive.size() > MAX_ARCHIVE_ENTRIES || archive.getEntry("frequencies.txt") != null)
                    throw new IOException("Unsupported SKM archive structure");
                return readTables(archive, stationNames, download.publishedAt());
            }
        } finally {
            Files.deleteIfExists(path);
        }
    }

    private static SkmGtfs readTables(ZipFile zip, Map<String, String> stationNames, OffsetDateTime publishedAt) throws IOException {
        var places = readPlaces(zip, stationNames);
        var services = readServices(zip);
        var exceptions = readExceptions(zip);
        var tripHeaders = readTripHeaders(zip, services.keySet(), exceptions.keySet());
        var trips = readTrips(zip, tripHeaders, places.keySet());
        if (publishedAt == null) {
            var stamp = zip.getEntry("stop_times.txt").getTimeLocal();
            if (stamp != null) publishedAt = stamp.atZone(WARSAW).toOffsetDateTime();
        }
        if (publishedAt == null) throw new IOException("SKM publication timestamp unavailable");
        return new SkmGtfs(places, trips, services, exceptions, publishedAt);
    }

    private static Map<String, Place> readPlaces(ZipFile zip, Map<String, String> stationNames) throws IOException {
        Map<String, Place> places = new HashMap<>();
        readTable(zip, "stops.txt", true, row -> {
            String id = row.required("stop_id");
            String name = stationNames.get(id);
            if (name != null) {
                if (!PlaceNames.normalize(name).equals(PlaceNames.normalize(row.required("stop_name"))))
                    throw new IOException("SKM station ID changed meaning");
                putUnique(places, id, new Place(name, coordinate(row.get("stop_lat"), 90), coordinate(row.get("stop_lon"), 180)));
            }
        });
        if (places.size() != stationNames.size()) throw new IOException("Pilot stations missing from SKM feed");
        return places;
    }

    private static Map<String, Service> readServices(ZipFile zip) throws IOException {
        Map<String, Service> services = new HashMap<>();
        List<String> weekdays = List.of("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday");
        readTable(zip, "calendar.txt", false, row -> {
            LocalDate start = date(row.required("start_date"));
            LocalDate end = date(row.required("end_date"));
            if (end.isBefore(start)) throw new IOException("Invalid SKM service dates");
            int mask = 0;
            for (int i = 0; i < weekdays.size(); i++) {
                switch (row.required(weekdays.get(i))) {
                    case "0" -> { }
                    case "1" -> mask |= 1 << i;
                    default -> throw new IOException("Invalid SKM service weekday");
                }
            }
            putUnique(services, row.required("service_id"), new Service(start, end, mask));
        });
        return services;
    }

    private static Map<String, Map<LocalDate, Boolean>> readExceptions(ZipFile zip) throws IOException {
        Map<String, Map<LocalDate, Boolean>> exceptions = new HashMap<>();
        readTable(zip, "calendar_dates.txt", false, row -> {
            boolean added = switch (row.required("exception_type")) {
                case "1" -> true;
                case "2" -> false;
                default -> throw new IOException("Invalid SKM calendar exception");
            };
            var dates = exceptions.computeIfAbsent(row.required("service_id"), ignored -> new HashMap<>());
            putUnique(dates, date(row.required("date")), added);
        });
        return exceptions;
    }

    private static Map<String, TripHeader> readTripHeaders(ZipFile zip, Set<String> services, Set<String> exceptions) throws IOException {
        Map<String, String> routes = new HashMap<>();
        readTable(zip, "routes.txt", true, row -> putUnique(routes, row.required("route_id"), row.required("route_type")));
        Map<String, TripHeader> headers = new HashMap<>();
        readTable(zip, "trips.txt", true, row -> {
            String trip = row.required("trip_id");
            String route = routes.get(row.required("route_id"));
            if (route == null) throw new IOException("Unknown route in SKM trips");
            if (!route.equals("2")) return;
            String service = row.required("service_id");
            if (!services.contains(service) && !exceptions.contains(service)) throw new IOException("Unknown SKM service calendar");
            String number = row.get("trip_short_name");
            putUnique(headers, trip, new TripHeader(service, number.isBlank() ? trip : number));
        });
        if (headers.isEmpty()) throw new IOException("No train trips in SKM feed");
        return headers;
    }

    private static List<Trip> readTrips(ZipFile zip, Map<String, TripHeader> headers, Set<String> stops) throws IOException {
        Map<String, List<Call>> calls = new HashMap<>();
        readTable(zip, "stop_times.txt", true, row -> {
            String trip = row.required("trip_id");
            String stop = row.required("stop_id");
            if (!headers.containsKey(trip) || !stops.contains(stop)) return;
            calls.computeIfAbsent(trip, ignored -> new ArrayList<>()).add(new Call(stop,
                    Integer.parseInt(row.required("stop_sequence")), seconds(row.get("arrival_time")), seconds(row.get("departure_time")),
                    regularStop(row.get("pickup_type")), regularStop(row.get("drop_off_type"))));
        });
        if (calls.isEmpty()) throw new IOException("No pilot station calls in SKM feed");
        var trips = new ArrayList<Trip>();
        for (var entry : calls.entrySet()) {
            var header = headers.get(entry.getKey());
            var tripCalls = entry.getValue();
            tripCalls.sort(Comparator.comparingInt(Call::sequence));
            for (int i = 1; i < tripCalls.size(); i++) {
                if (tripCalls.get(i).sequence() == tripCalls.get(i - 1).sequence())
                    throw new IOException("Duplicate SKM stop sequence");
            }
            trips.add(new Trip(header.service(), header.number(), List.copyOf(tripCalls)));
        }
        return List.copyOf(trips);
    }

    LocalDate firstDate() { return firstDate; }
    LocalDate lastDate() { return lastDate; }
    OffsetDateTime publishedAt() { return publishedAt; }
    Place place(String id) { return places.get(id); }
    List<Trip> trips() { return trips; }

    boolean covers(LocalDate day) { return !day.isBefore(firstDate) && !day.isAfter(lastDate); }

    boolean runsOn(Trip trip, LocalDate date) {
        Boolean exception = exceptions.getOrDefault(trip.service(), Map.of()).get(date);
        if (exception != null) return exception;
        Service service = services.get(trip.service());
        return service != null && service.runsOn(date);
    }

    static OffsetDateTime time(LocalDate serviceDay, int seconds) {
        return serviceDay.atTime(LocalTime.NOON).atZone(WARSAW).minusHours(12).plusSeconds(seconds).toOffsetDateTime();
    }

    private static Integer seconds(String value) throws IOException {
        if (value.isBlank()) return null;
        var parts = value.split(":", -1);
        if (parts.length != 3 || !value.matches("[0-9]{1,2}:[0-9]{2}:[0-9]{2}")) throw new IOException("Invalid SKM time");
        int hours = Integer.parseInt(parts[0]);
        int minutes = Integer.parseInt(parts[1]);
        int seconds = Integer.parseInt(parts[2]);
        if (hours >= 48 || minutes >= 60 || seconds >= 60) throw new IOException("Unsupported SKM time");
        return hours * 3600 + minutes * 60 + seconds;
    }

    private static LocalDate date(String value) { return LocalDate.parse(value, DateTimeFormatter.BASIC_ISO_DATE); }
    private static boolean regularStop(String value) { return value.isBlank() || value.equals("0"); }
    private static Double coordinate(String value, int max) {
        if (value.isBlank()) return null;
        double coordinate = Double.parseDouble(value);
        return Double.isFinite(coordinate) && Math.abs(coordinate) <= max ? coordinate : null;
    }

    private static <K, V> void putUnique(Map<K, V> map, K key, V value) throws IOException {
        if (map.putIfAbsent(key, value) != null) throw new IOException("Duplicate GTFS key");
    }

    @FunctionalInterface private interface RowConsumer { void accept(Row row) throws IOException; }

    private static void readTable(ZipFile zip, String name, boolean required, RowConsumer consumer) throws IOException {
        ZipEntry entry = zip.getEntry(name);
        if (entry == null && !required) return;
        if (entry == null || entry.getSize() < 0 || entry.getSize() > MAX_FILE_BYTES) throw new IOException("Invalid GTFS entry " + name);
        try (InputStream input = zip.getInputStream(entry)) {
            byte[] bytes = input.readNBytes(MAX_FILE_BYTES + 1);
            if (bytes.length != entry.getSize()) throw new IOException("GTFS entry exceeds size limit or is truncated");
            var decoder = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT);
            try (var reader = new BufferedReader(new InputStreamReader(new ByteArrayInputStream(bytes), decoder))) {
                String header = reader.readLine();
                if (header == null) throw new IOException("Missing GTFS table header");
                List<String> columns = csv(header.startsWith("\ufeff") ? header.substring(1) : header);
                Map<String, Integer> indexes = new HashMap<>();
                for (int i = 0; i < columns.size(); i++) putUnique(indexes, columns.get(i), i);
                int rowCount = 0;
                for (String line; (line = reader.readLine()) != null;) {
                    if (++rowCount > MAX_ROWS) throw new IOException("GTFS row limit exceeded");
                    if (line.isBlank()) continue;
                    List<String> values = csv(line);
                    if (values.size() != columns.size()) throw new IOException("Unexpected GTFS column count");
                    consumer.accept(new Row(indexes, values));
                }
            }
        }
    }

    private record Row(Map<String, Integer> indexes, List<String> values) {
        String get(String name) { return indexes.containsKey(name) ? values.get(indexes.get(name)) : ""; }
        String required(String name) throws IOException {
            String value = get(name);
            if (value.isBlank()) throw new IOException("Missing GTFS value for " + name);
            return value;
        }
    }

    /** GTFS uses RFC 4180 quoting and forbids line breaks within fields. */
    private static List<String> csv(String line) throws IOException {
        if (line.length() > MAX_LINE_LENGTH) throw new IOException("GTFS line length exceeded");
        var values = new ArrayList<String>();
        var field = new StringBuilder();
        boolean quoted = false;
        boolean endedQuote = false;
        for (int i = 0; i < line.length(); i++) {
            char ch = line.charAt(i);
            if (quoted) {
                if (ch != '"') field.append(ch);
                else if (i + 1 < line.length() && line.charAt(i + 1) == '"') { field.append('"'); i++; }
                else { quoted = false; endedQuote = true; }
            } else if (ch == ',') {
                values.add(field.toString());
                field.setLength(0);
                endedQuote = false;
            } else if (endedQuote) throw new IOException("Malformed GTFS quoted field");
            else if (ch == '"') {
                if (!field.isEmpty()) throw new IOException("Malformed GTFS quote");
                quoted = true;
            } else field.append(ch);
        }
        if (quoted) throw new IOException("Unterminated GTFS quote");
        values.add(field.toString());
        return values;
    }
}
