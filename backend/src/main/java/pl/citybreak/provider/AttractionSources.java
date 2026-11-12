package pl.citybreak.provider;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import java.util.regex.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;
import pl.citybreak.model.Model.*;
import pl.citybreak.provider.LiveGdanskProvider.Read;

/** Strict extraction from refreshed official publications; changed/unreadable content stays unknown. */
final class AttractionSources {
    private static final ZoneId ZONE = ZoneId.of("Europe/Warsaw");
    private static final String TARIFF_NOTE = "Taryfa publikowana, nie wycena konkretnego kursu ani rezerwacja na wybrany dzień.";

    List<Attraction> read(Criteria criteria, Map<String, Read> reads, List<Source> sources) {
        List<Attraction> result = new ArrayList<>();
        result.add(attraction(criteria, "ecs-permanent", "Europejskie Centrum Solidarności — wystawa stała", 120,
                new Place("Europejskie Centrum Solidarności", 54.3611, 18.6492), reads.get(LiveGdanskProvider.ECS_PRICE), reads.get(LiveGdanskProvider.ECS_HOURS), true, sources));
        result.add(attraction(criteria, "museum-ww2-main", "Muzeum II Wojny Światowej — wystawa główna", 150,
                new Place("Muzeum II Wojny Światowej", 54.3563, 18.6607), reads.get(LiveGdanskProvider.MUSEUM_PRICE), reads.get(LiveGdanskProvider.MUSEUM_HOURS), false, sources));
        return List.copyOf(result);
    }

    List<Price> transportPrices(Read tariff, Read eligibility, List<Source> sources) {
        String normal = null, reduced = null, rule = null;
        if (tariff.error() == null) {
            var document = Jsoup.parse(tariff.body());
            for (Element table : document.select("table")) {
                String heading = normalized(table.text());
                if (!heading.contains("pelnoplatne") || !heading.contains("ulgowe")) continue;
                for (Element row : table.select("tr")) {
                    var cells = row.select("td");
                    if (cells.size() == 3 && normalized(cells.get(0).text()).contains("na jeden przejazd")) {
                        normal = firstDecimal(cells.get(1).text()); reduced = firstDecimal(cells.get(2).text());
                    }
                }
            }
        }
        if (eligibility.error() == null) {
            for (Element row : Jsoup.parse(eligibility.body()).select("tr")) {
                String text = normalized(row.text());
                if (text.contains("studenci szkol wyzszych") && text.contains("bez wzgledu na wiek") && text.contains("legitymacja studencka"))
                    rule = row.text();
            }
        }
        sources.add(extractionSource("ztm-published-tariff", tariff, normal != null, TARIFF_NOTE));
        sources.add(extractionSource("ztm-discount-conditions", eligibility, rule != null, "Warunki ulgi odczytano osobno z oficjalnej publikacji ZTM."));
        List<Price> prices = new ArrayList<>();
        prices.add(price(normal, FareType.STANDARD, null, "ztm-published-tariff", tariff));
        prices.add(price(rule == null ? null : reduced, FareType.REDUCED, rule, "ztm-published-tariff", tariff,
                rule == null ? eligibility : tariff));
        return List.copyOf(prices);
    }

    private Attraction attraction(Criteria criteria, String id, String name, int duration, Place place,
            Read tariff, Read hours, boolean ecs, List<Source> sources) {
        String normal = null, reduced = null, eligibility = null;
        if (tariff.error() == null) {
            var document = Jsoup.parse(tariff.body());
            String content = document.select("main").isEmpty() ? document.body().text() : document.select("main").text();
            String lower = normalized(content);
            int sectionStart = lower.indexOf(ecs ? "wystawa stala" : "wystawa glowna");
            if (sectionStart >= 0) {
                String product = lower.substring(sectionStart + (ecs ? "wystawa stala" : "wystawa glowna").length());
                int nextProduct = firstIndex(product, List.of("wystawa stocznia", "wystawa czasowa", "wystawa glowna", "westerplatte"));
                if (nextProduct >= 0) product = product.substring(0, nextProduct);
                int endFare = firstIndex(product, List.of("bilet grupowy", "bilet rodzinny", "karta duzej rodziny", "karta turysty"));
                String fareBlock = endFare >= 0 ? product.substring(0, endFare) : product;
                normal = labelledPrice(fareBlock, "normalny"); reduced = labelledPrice(fareBlock, "ulgowy");
                if (Pattern.compile("student.{0,100}26.{0,150}legitymacj").matcher(product).find())
                    eligibility = "Studenci do 26 lat z ważną legitymacją studencką; szczegóły w źródle.";
            }
        }
        Source priceSource = extractionSource(id + "-tariff", tariff, normal != null, TARIFF_NOTE);
        OpeningHours opening;
        try { opening = opening(criteria, hours, ecs); }
        catch (RuntimeException malformedPublication) { opening = new OpeningHours(OpeningStatus.UNKNOWN, List.of()); }
        Source hoursSource = extractionSource(id + "-hours", hours, opening.status() == OpeningStatus.KNOWN,
                "Godziny z publikacji instytucji, bez potwierdzenia puli biletów. Czas wizyty (" + duration + " min) jest parametrem planera, nie pomiarem instytucji. Nie potwierdzono czasu dojścia.");
        sources.add(priceSource); sources.add(hoursSource);
        return new Attraction(id, name, place, duration, List.of(
                price(normal, FareType.STANDARD, null, id + "-tariff", tariff),
                price(eligibility == null ? null : reduced, FareType.REDUCED, eligibility, id + "-tariff", tariff)),
                opening, List.of(priceSource, hoursSource));
    }

    private OpeningHours opening(Criteria criteria, Read read, boolean ecs) {
        if (read.error() != null) return new OpeningHours(OpeningStatus.UNKNOWN, List.of());
        String text = normalized(Jsoup.parse(read.body()).text());
        String winter = between(text, "pazdziernik - kwiecien", "taras widokowy");
        String summer = between(text, "maj - wrzesien", "taras widokowy");
        String museum = between(text, "godziny pracy muzeum", "kasy muzeum");
        Set<LocalDate> museumClosures = ecs ? Set.of() : museumClosures(museum);
        List<OpeningInterval> intervals = new ArrayList<>();
        // Publication scope is checked for every requested date; never extrapolate beyond recognized rules.
        List<LocalDate> days = new ArrayList<>();
        for (LocalDate day = criteria.departureDate(); !day.isAfter(criteria.returnDate()); day = day.plusDays(1)) {
            if (days.size() == 60) return new OpeningHours(OpeningStatus.UNKNOWN, List.of());
            days.add(day);
        }
        for (LocalDate day : days) {
            int[] range;
            if (ecs) {
                boolean isWinter = day.getMonthValue() <= 4 || day.getMonthValue() >= 10;
                String season = isWinter ? winter : summer;
                if (season.isEmpty()) return new OpeningHours(OpeningStatus.UNKNOWN, List.of());
                int[] weekday = hours(season, isWinter ? "poniedzialek,?\\s*sroda\\s*-\\s*piatek" : "poniedzialek\\s*-\\s*piatek");
                int[] weekend = hours(season, "sobota\\s*-\\s*niedziela");
                if (weekday == null || weekend == null || (isWinter && (!closedWeekday(season, "wtorek") || hours(season, "wtorek") != null)))
                    return new OpeningHours(OpeningStatus.UNKNOWN, List.of());
                if (closedEcs(day, text) || (isWinter && day.getDayOfWeek() == DayOfWeek.TUESDAY)) continue;
                range = day.getDayOfWeek().getValue() >= 6 ? weekend : weekday;
            } else {
                int[] tuesday = hours(museum, "wtorek");
                int[] rest = hours(museum, "sroda\\s*-\\s*niedziela");
                if (tuesday == null || rest == null || !closedWeekday(museum, "poniedzialek") || hours(museum, "poniedzialek") != null || museumClosures == null)
                    return new OpeningHours(OpeningStatus.UNKNOWN, List.of());
                if (day.getDayOfWeek() == DayOfWeek.MONDAY || museumClosures.contains(day)) continue;
                range = day.getDayOfWeek() == DayOfWeek.TUESDAY ? tuesday : rest;
            }
            intervals.add(new OpeningInterval(day.atTime(range[0], 0).atZone(ZONE).toOffsetDateTime(), day.atTime(range[1], 0).atZone(ZONE).toOffsetDateTime()));
        }
        return new OpeningHours(OpeningStatus.KNOWN, List.copyOf(intervals));
    }
    private boolean closedEcs(LocalDate day, String text) {
        String section = between(text, "9 dni w roku", "zasady zwiedzania");
        if (section.isEmpty()) return false;
        String[] months = {"stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "wrzesnia", "pazdziernika", "listopada", "grudnia"};
        String date = day.getDayOfMonth() + " " + months[day.getMonthValue() - 1];
        if (day.getMonthValue() == 6 && day.getDayOfMonth() == 4 && day.getYear() == 2026 && section.contains("w 2026 roku") && section.contains("otwarte")) return false;
        return Pattern.compile("(?<!\\d)" + Pattern.quote(date) + "\\b").matcher(section).find();
    }
    private Set<LocalDate> museumClosures(String text) {
        int from = text.indexOf("muzeum bedzie nieczynne dla zwiedzajacych w nastepujacych terminach");
        if (from < 0) return null;
        String[] months = {"stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "wrzesnia", "pazdziernika", "listopada", "grudnia"};
        Matcher dates = Pattern.compile("(?<!\\d)(\\d{1,2}) (" + String.join("|", months) + ") (20\\d{2})(?!\\d)").matcher(text.substring(from));
        Set<LocalDate> result = new HashSet<>();
        while (dates.find()) result.add(LocalDate.of(Integer.parseInt(dates.group(3)), Arrays.asList(months).indexOf(dates.group(2)) + 1, Integer.parseInt(dates.group(1))));
        return result.isEmpty() ? null : Set.copyOf(result);
    }
    private boolean closedWeekday(String text, String day) {
        return Pattern.compile(day + "(?:(?!poniedzial|wtorek|sroda|czwartek|piatek|sobota|niedziel).){0,70}(?:nieczynne|zamkniete)").matcher(text).find();
    }
    private int[] hours(String content, String prefix) {
        Matcher match = Pattern.compile(prefix + "\\s*\\|?\\s*(\\d{1,2})(?::00)?\\s*-\\s*(\\d{1,2})(?::00)?").matcher(content);
        if (!match.find()) return null;
        int open = Integer.parseInt(match.group(1)), close = Integer.parseInt(match.group(2));
        return open >= 0 && close <= 24 && open < close ? new int[]{open, close} : null;
    }
    private String labelledPrice(String text, String label) {
        Matcher matcher = Pattern.compile("bilet " + label + "\\s*\\|?\\s*(\\d{1,4}(?:[,.]\\d{2})?)\\s*zl").matcher(text);
        return matcher.find() ? new BigDecimal(matcher.group(1).replace(',', '.')).setScale(2).toPlainString() : null;
    }
    private String firstDecimal(String text) {
        Matcher matcher = Pattern.compile("(?<!\\d)(\\d{1,4}[,.]\\d{2})(?!\\d)").matcher(text);
        return matcher.find() ? new BigDecimal(matcher.group(1).replace(',', '.')).setScale(2).toPlainString() : null;
    }
    private Price price(String amount, FareType fare, String eligibility, String id, Read publication) { return price(amount, fare, eligibility, id, publication, publication); }
    private Price price(String amount, FareType fare, String eligibility, String id, Read publication, Read determiningSource) {
        PriceStatus status = amount != null ? PriceStatus.KNOWN : determiningSource.error() == null ? PriceStatus.UNKNOWN : PriceStatus.PROVIDER_ERROR;
        return new Price(status, amount, "PLN", fare, eligibility, id, publication.url(), publication.checkedAt(), false,
                amount == null ? "Nie potwierdzono ceny lub warunków taryfy w odczytanym źródle." : TARIFF_NOTE,
                amount == null ? null : PriceBasis.PUBLISHED_TARIFF);
    }
    private Source extractionSource(String id, Read read, boolean recognized, String message) {
        if (read.error() != null) return read.source(id);
        return new Source(id, read.url(), read.checkedAt(), recognized ? SourceStatus.OK : SourceStatus.NO_COVERAGE,
                recognized ? message : "Nie rozpoznano wymaganych danych w publikacji. Nie zastępujemy ich statycznym cennikiem ani godzinami.",
                recognized ? null : "UNRECOGNIZED_PUBLICATION");
    }
    private static String normalized(String text) { return LiveGdanskProvider.normalize(text).replace('–', '-').replace('—', '-').replace('−', '-').replace('\u00a0', ' '); }
    private static String between(String text, String start, String end) {
        int from = text.indexOf(start); if (from < 0) return "";
        int until = text.indexOf(end, from + start.length()); return until < 0 ? "" : text.substring(from + start.length(), until);
    }
    private static int firstIndex(String text, List<String> markers) {
        return markers.stream().mapToInt(text::indexOf).filter(index -> index >= 0).min().orElse(-1);
    }
}
