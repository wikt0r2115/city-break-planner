package pl.citybreak.persistence;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import pl.citybreak.model.Model.Plan;

/** One SQLite row is an atomic, versioned snapshot. Tokens never enter the JSON payload. */
@Repository
public class PlanRepository {
    public record Stored(Plan plan, String ownerHash, String shareToken) {}
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private volatile boolean initialized;
    public PlanRepository(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

    public void insert(Stored stored) {
        initialize();
        Plan plan = stored.plan();
        jdbc.update("INSERT INTO plans(id, owner_token_hash, share_token, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                plan.id(), stored.ownerHash(), stored.shareToken(), encode(plan), plan.createdAt().toString(), plan.updatedAt().toString());
    }
    public Optional<Stored> find(String id) {
        initialize();
        return jdbc.query("SELECT payload, owner_token_hash, share_token FROM plans WHERE id = ?",
                this::readStoredPlan, id)
                .stream().findFirst();
    }
    public Optional<Stored> findShared(String token) {
        initialize();
        return jdbc.query("SELECT payload, owner_token_hash, share_token FROM plans WHERE share_token = ?",
                this::readStoredPlan, token)
                .stream().findFirst();
    }
    public boolean update(Plan plan) {
        initialize();
        return jdbc.update("UPDATE plans SET payload = ?, updated_at = ? WHERE id = ?",
                encode(plan), plan.updatedAt().toString(), plan.id()) == 1;
    }
    public boolean delete(String id) {
        initialize();
        return jdbc.update("DELETE FROM plans WHERE id = ?", id) == 1;
    }
    private Stored readStoredPlan(ResultSet row, int index) throws SQLException {
        return new Stored(decode(row.getString("payload")), row.getString("owner_token_hash"), row.getString("share_token"));
    }
    private synchronized void initialize() {
        if (initialized) return;
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            boolean previousAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try (var statement = connection.createStatement()) {
                try (var version = statement.executeQuery("PRAGMA user_version")) {
                    if (version.next() && version.getInt(1) > 1)
                        throw new SQLException("Unsupported database schema version");
                }
                statement.execute("""
                        CREATE TABLE IF NOT EXISTS plans (
                            id TEXT PRIMARY KEY NOT NULL,
                            owner_token_hash TEXT NOT NULL CHECK(length(owner_token_hash) = 64),
                            share_token TEXT UNIQUE NOT NULL CHECK(length(share_token) = 43),
                            payload TEXT NOT NULL,
                            created_at TEXT NOT NULL,
                            updated_at TEXT NOT NULL
                        )
                        """);
                statement.execute("PRAGMA user_version = 1");
                connection.commit();
                return null;
            } catch (SQLException exception) {
                connection.rollback();
                throw exception;
            } finally {
                connection.setAutoCommit(previousAutoCommit);
            }
        });
        initialized = true;
    }
    private String encode(Plan plan) {
        try { return json.writeValueAsString(plan); }
        catch (JsonProcessingException exception) { throw new DataAccessResourceFailureException("Cannot serialize plan snapshot", exception); }
    }
    private Plan decode(String payload) {
        try { return json.readValue(payload, Plan.class); }
        catch (JsonProcessingException exception) { throw new DataAccessResourceFailureException("Cannot read stored plan snapshot", exception); }
    }
}
