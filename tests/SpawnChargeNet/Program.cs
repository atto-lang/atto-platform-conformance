using System.Globalization;
using static Atto.Net.ActorRuntime.ActorSpawnChargePlan;

static int I32(string s) => int.Parse(s, CultureInfo.InvariantCulture);
static long I64(string s) => long.Parse(s, CultureInfo.InvariantCulture);
static Affinity ParseAffinity(string s) => s switch
{
    "none" => Affinity.None, "sticky" => Affinity.Sticky, "pinned" => Affinity.Pinned,
    _ => throw new FormatException("invalid vector affinity")
};
var ids = new HashSet<string>(StringComparer.Ordinal);
int accept = 0, deny = 0;
for (string? line; (line = Console.ReadLine()) is not null;)
{
    if (line.Length == 0 || line.StartsWith('#')) continue;
    var v = line.Split('\t');
    if (v.Length != 19 || !ids.Add(v[0])) throw new FormatException("invalid vector");
    var p = new Policy(v[1] switch { "0" => false, "1" => true, _ => throw new FormatException("invalid serial") },
        I32(v[2]), I32(v[3]), I64(v[4]), I64(v[5]), I64(v[6]), I64(v[7]), I64(v[8]));
    var d = new Defaults(ParseAffinity(v[9]), I64(v[10]), I64(v[11]), I64(v[12]));
    var r = new Request(v[13] == "-" ? null : I32(v[13]), v[14] == "-" ? null : ParseAffinity(v[14]),
        v[15] == "-" ? null : I64(v[15]), v[16] == "-" ? null : I64(v[16]), v[17] == "-" ? null : I64(v[17]));
    string actual;
    try
    {
        var x = Resolve(p, d, r);
        actual = FormattableString.Invariant($"{x.CarrierCap},{x.Affinity.ToString().ToLowerInvariant()},{x.StackBytes},{x.Heap},{x.Stacks},{x.MailboxBytes},{x.Messages}");
        accept++;
    }
    catch (ArgumentException e) { actual = e.Message; deny++; }
    if (actual != v[18]) throw new Exception($"{v[0]}: expected {v[18]}, got {actual}");
}
if (ids.Count != 25 || accept != 6 || deny != 19) throw new Exception("incomplete vector coverage");
Console.WriteLine("SPAWN_CHARGE_NET_HOST_PASS 6 accepts 19 denials; no guest execution");
