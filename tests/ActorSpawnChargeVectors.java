package dev.oreslang.runtime;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import static dev.oreslang.runtime.ActorSpawnChargePlan.*;

/** Host calculation only: feed the shared conformance TSV on stdin. */
public final class ActorSpawnChargeVectors {
    private static Integer optInt(String s) { return s.equals("-") ? null : Integer.valueOf(s); }
    private static Long optLong(String s) { return s.equals("-") ? null : Long.valueOf(s); }
    private static Affinity affinity(String s) { return Affinity.valueOf(s.toUpperCase(Locale.ROOT)); }
    public static void main(String[] args) throws Exception {
        var ids = new HashSet<String>();
        int accepts = 0, denies = 0;
        try (var reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            for (String line; (line = reader.readLine()) != null;) {
                if (line.isEmpty() || line.startsWith("#")) continue;
                var v = line.split("\t", -1);
                if (v.length != 19 || !ids.add(v[0])) throw new AssertionError("invalid vector: " + line);
                if (!v[1].equals("0") && !v[1].equals("1")) throw new AssertionError("invalid serial flag");
                // Decode outside the backend denial handler: malformed vectors cannot count as denials.
                boolean serial = v[1].equals("1");
                int cap = Integer.parseInt(v[2]), dc = Integer.parseInt(v[3]);
                long slots = Long.parseLong(v[4]), hl = Long.parseLong(v[5]), sl = Long.parseLong(v[6]);
                long ml = Long.parseLong(v[7]), mb = Long.parseLong(v[8]);
                var d = new Defaults(affinity(v[9]), Long.parseLong(v[10]), Long.parseLong(v[11]), Long.parseLong(v[12]));
                var r = new Request(optInt(v[13]), v[14].equals("-") ? null : affinity(v[14]),
                        optLong(v[15]), optLong(v[16]), optLong(v[17]));
                String actual;
                try {
                    var p = new Policy(serial, cap, dc, slots, hl, sl, ml, mb);
                    var plan = resolve(p, d, r);
                    var c = plan.charge();
                    actual = plan.carrierCap() + "," + plan.affinity().name().toLowerCase(Locale.ROOT) + "," +
                            plan.stackBytes() + "," + c.heap() + "," + c.stacks() + "," + c.mailboxBytes() + "," + c.messages();
                    accepts++;
                } catch (IllegalArgumentException ex) {
                    actual = ex.getMessage(); denies++;
                }
                if (!v[18].equals(actual)) throw new AssertionError(v[0] + ": expected " + v[18] + ", got " + actual);
            }
        }
        if (ids.size() != 25 || accepts != 6 || denies != 19) throw new AssertionError("incomplete vector coverage");
        System.out.println("SPAWN_CHARGE_JAVA_HOST_PASS 6 accepts 19 denials; no guest execution");
    }
}
