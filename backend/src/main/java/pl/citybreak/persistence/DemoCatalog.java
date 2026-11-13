package pl.citybreak.persistence;

import java.time.LocalTime;
import java.util.List;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.stereotype.Repository;
import pl.citybreak.model.Model.Interest;
import pl.citybreak.model.Model.Mode;
import pl.citybreak.model.Model.Place;

@Repository
public class DemoCatalog {
    private final JdbcTemplate jdbc;
    private boolean initialized;

    public DemoCatalog(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public record City(String id, Place place) {}
    public record Leg(String tripId, int direction, int position, Mode mode, String operator, String operatorUrl,
            Place origin, Place destination, int departureDay, LocalTime departure, int arrivalDay,
            LocalTime arrival, int normalPln, int reducedPln) {}
    public record Visit(String id, Place place, Interest category, int minutes, LocalTime opens, LocalTime closes,
            int normalPln, int reducedPln) {}

    public List<City> cities() {
        initialize();
        return jdbc.query("SELECT id, name, lat, lon, zone FROM demo_places WHERE id IN ('lon','par','ams') ORDER BY id",
                (row, index) -> new City(row.getString("id"), new Place(row.getString("name"), row.getDouble("lat"),
                        row.getDouble("lon"), row.getString("zone"))));
    }

    public List<Leg> legs(String origin, String destination) {
        initialize();
        return jdbc.query("""
                SELECT s.*, a.name AS a_name, a.lat AS a_lat, a.lon AS a_lon, a.zone AS a_zone,
                       b.name AS b_name, b.lat AS b_lat, b.lon AS b_lon, b.zone AS b_zone
                FROM demo_segments s
                JOIN demo_trips t ON t.id = s.trip_id
                JOIN demo_places a ON a.id = s.origin
                JOIN demo_places b ON b.id = s.destination
                WHERE t.origin = ? AND t.destination = ?
                ORDER BY s.trip_id, s.direction, s.position
                """, (row, index) -> new Leg(row.getString("trip_id"), row.getInt("direction"), row.getInt("position"),
                        Mode.valueOf(row.getString("mode")), row.getString("operator"), row.getString("operator_url"),
                        new Place(row.getString("a_name"), row.getDouble("a_lat"), row.getDouble("a_lon"), row.getString("a_zone")),
                        new Place(row.getString("b_name"), row.getDouble("b_lat"), row.getDouble("b_lon"), row.getString("b_zone")),
                        row.getInt("departure_day"), LocalTime.parse(row.getString("departure_time")),
                        row.getInt("arrival_day"), LocalTime.parse(row.getString("arrival_time")),
                        row.getInt("normal_pln"), row.getInt("reduced_pln")), origin, destination);
    }

    public List<Visit> visits(String city) {
        initialize();
        return jdbc.query("""
                SELECT a.*, p.zone FROM demo_attractions a JOIN demo_places p ON p.id = a.city
                WHERE a.city = ? ORDER BY a.rowid
                """, (row, index) -> new Visit(row.getString("id"), new Place(row.getString("name"),
                        row.getDouble("lat"), row.getDouble("lon"), row.getString("zone")),
                        Interest.valueOf(row.getString("category")), row.getInt("minutes"),
                        LocalTime.parse(row.getString("opens")), LocalTime.parse(row.getString("closes")),
                        row.getInt("normal_pln"), row.getInt("reduced_pln")), city);
    }

    private synchronized void initialize() {
        if (initialized) return;
        var seed = new ResourceDatabasePopulator(new ClassPathResource("demo-data.sql"));
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            boolean autoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                seed.populate(connection);
                connection.commit();
                return null;
            } catch (RuntimeException | java.sql.SQLException failed) {
                connection.rollback();
                throw failed;
            } finally {
                connection.setAutoCommit(autoCommit);
            }
        });
        initialized = true;
    }
}
