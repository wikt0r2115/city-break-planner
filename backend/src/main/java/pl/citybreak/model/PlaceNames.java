package pl.citybreak.model;

import java.text.Normalizer;
import java.util.Locale;

public final class PlaceNames {
    private PlaceNames() {}

    public static String normalize(String name) {
        return Normalizer.normalize(name, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "")
                .toLowerCase(Locale.ROOT)
                .replace('ł', 'l')
                .replaceAll("[\\s,]+", " ")
                .strip();
    }
}
