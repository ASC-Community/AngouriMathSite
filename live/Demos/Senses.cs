using System.Text.Json.Nodes;
using AngouriMath;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>
/// The senses demo: a formula over the named states of real signals, read the way the LogicState
/// catalogue reads them (Rafael-SOWNet/UnitsNet, spike/logic-state). A sense says which condition
/// a stored 1 means, and its opposite reads the same bit the other way round, so Closed from one
/// device and Open from another are one letter, once negated. Facts about the plant that logic
/// does not know, such as a full tank not being empty, are invariants: a row that breaks one cannot
/// occur, so the minimal form may treat it as a don't-care, and seeing one means a signal is wrong.
/// </summary>
public static class Senses
{
    /// <summary>A sense and its opposite: the same bit read the other way round.</summary>
    private sealed record Pair(string True, string False, string Source);

    // Each pair of the catalogue, the sense in which 1 means what its name says first. The sources
    // are the catalogue's; it names none for Valid and Fault.
    private static readonly Pair[] Catalogue =
    [
        new("Active", "Inactive", "BACnet; KNX DPT 1.011"),
        new("On", "Off", "KNX DPT 1.001"),
        new("Enabled", "Disabled", "KNX DPT 1.003"),
        new("Present", "Absent", "presence detection"),
        new("Occupied", "Unoccupied", "KNX DPT 1.018"),
        new("Alarm", "NoAlarm", "KNX DPT 1.005"),
        new("High", "Low", "KNX DPT 1.006; Low is active-low signalling"),
        new("Open", "Closed", "KNX DPT 1.019 (1 = open) and 1.009 (1 = close)"),
        new("Valid", "Invalid", ""),
        new("Fault", "NoFault", ""),
        new("Pressed", "Depressed", "a normally-open and a normally-closed button"),
        new("Near", "Far", "proximity switch"),
        new("Running", "Stopped", "OPC UA TwoStateDiscreteType"),
        new("Safe", "Unsafe", "OPC UA TwoStateDiscreteType"),
        new("Connected", "Disconnected", "the link, not what it measures"),
        new("Succeeded", "Failed", "the outcome of a finished operation"),
        new("Acknowledged", "Unacknowledged", "ANSI/ISA-18.2; KNX DPT 1.016"),
        new("Local", "Remote", "IEC 61850 Loc"),
        new("InService", "OutOfService", "BACnet Out_Of_Service"),
        new("Set", "Reset", "IEC 61131-3 SR/RS; KNX DPT 1.015"),
        new("Up", "Down", "KNX DPT 1.008; neither side is naturally true"),
        new("Increase", "Decrease", "KNX DPT 1.007"),
        new("Heating", "Cooling", "KNX DPT 1.100"),
        new("Shelved", "Unshelved", "ANSI/ISA-18.2; OPC UA Part 9"),
        new("Suppressed", "Unsuppressed", "ANSI/ISA-18.2; OPC UA Part 9"),
        new("Latched", "Unlatched", "ANSI/ISA-18.2; OPC UA Part 9"),
        new("Confirmed", "Unconfirmed", "OPC UA Part 9"),
        new("Silenced", "Unsilenced", "OPC UA Part 9"),
        new("Blocked", "Unblocked", "PackML"),
        new("Starved", "NotStarved", "PackML"),
        new("OutOfSpecification", "InSpecification", "NAMUR NE 107"),
        new("MaintenanceRequired", "NoMaintenanceRequired", "NAMUR NE 107"),
        new("Inverted", "NotInverted", "KNX DPT 1.012; BACnet Polarity"),
        new("Calculated", "Fixed", "KNX DPT 1.014"),
        new("Full", "NotFull", "point-level detector; no naming standard"),
        new("Empty", "NotEmpty", "point-level detector; no naming standard"),
    ];

    /// <summary>
    /// Senses that cannot both hold on one channel, kept as separate pairs because both can be
    /// false. Each becomes an invariant wherever a formula uses both on the same channel.
    /// </summary>
    private static readonly (string A, string B, string Why)[] Exclusive =
    [
        ("Full", "Empty", "A vessel is never full and empty at once. The catalogue keeps them as two pairs because a part-filled one is neither."),
    ];

    /// <summary>A word of the formula: a sense of a pair on a channel, or a letter of its own.</summary>
    private readonly record struct Reading(Pair? Pair, bool Negated, string Channel);

    /// <summary>Reads Closed_door as the Open/Closed pair, negated, on the channel door. Case does not matter.</summary>
    private static Reading Read(string word)
    {
        var cut = word.IndexOf('_');
        var (name, channel) = cut < 0 ? (word, "") : (word[..cut], word[(cut + 1)..]);
        foreach (var pair in Catalogue)
            if (string.Equals(name, pair.True, StringComparison.OrdinalIgnoreCase))
                return new(pair, false, channel);
            else if (string.Equals(name, pair.False, StringComparison.OrdinalIgnoreCase))
                return new(pair, true, channel);
        return new(null, false, "");
    }

    private static string Named(string sense, string channel) => channel.Length == 0 ? sense : $"{sense}_{channel}";

    /// <summary>The formula in letters, one per channel and named after its true sense; an opposite sense is its negation.</summary>
    private static Entity InLetters(Entity e) => e.Replace(node =>
        node is Variable v && Read(v.Name) is { Pair: { } pair } r
            ? r.Negated ? !MathS.Var(Named(pair.True, r.Channel)) : MathS.Var(Named(pair.True, r.Channel))
            : node);

    /// <summary>The formula in senses: each negated letter of a pair written as the opposite sense, which needs no inverter.</summary>
    private static Entity InSenses(Entity e) => e.Replace(node =>
        node is Notf { Argument: Variable v } && Read(v.Name) is { Pair: { } pair, Negated: false } r
            ? MathS.Var(Named(pair.False, r.Channel))
            : node);

    private static bool IsFormula(Entity e) => e is Variable || Representations.IsLogic(e);

    /// <summary>The catalogue itself, for the page to show as a reference.</summary>
    public static string Reference() => new JsonObject
    {
        ["pairs"] = new JsonArray(Catalogue.Select(p => (JsonNode)new JsonObject
        {
            ["true"] = p.True,
            ["false"] = p.False,
            ["source"] = p.Source,
        }).ToArray()),
        ["exclusive"] = new JsonArray(Exclusive.Select(x => (JsonNode)new JsonObject
        {
            ["a"] = x.A,
            ["b"] = x.B,
            ["notB"] = Catalogue.First(p => p.True == x.B).False,
            ["why"] = x.Why,
        }).ToArray()),
    }.ToJsonString();

    /// <summary>A line of the formula field: Name = formula, or a formula alone (no name).</summary>
    private static (string? Name, string Body) Definition(string line)
    {
        var end = 0;
        while (end < line.Length && (char.IsLetterOrDigit(line[end]) || line[end] == '_'))
            end++;
        var at = end;
        while (at < line.Length && line[at] == ' ')
            at++;
        if (at < line.Length && line[at] == ':')
            at++;
        return end > 0 && char.IsLetter(line[0]) && at < line.Length && line[at] == '=' && (at + 1 == line.Length || line[at + 1] != '=')
            ? (line[..end], line[(at + 1)..])
            : (null, line);
    }

    private static bool IsComparison(Entity e) => e is Greaterf or Lessf or GreaterOrEqualf or LessOrEqualf;

    private static (Entity Left, Entity Right) Sides(Entity comparison) => comparison switch
    {
        Greaterf c => (c.Left, c.Right),
        GreaterOrEqualf c => (c.Left, c.Right),
        Lessf c => (c.Left, c.Right),
        LessOrEqualf c => (c.Left, c.Right),
        _ => throw new ArgumentException("Not a comparison.", nameof(comparison)),
    };

    /// <summary>The comparison that holds exactly where this one does not, for real numbers.</summary>
    private static Entity Negate(Entity comparison) => comparison switch
    {
        Greaterf c => new LessOrEqualf(c.Left, c.Right),
        GreaterOrEqualf c => new Lessf(c.Left, c.Right),
        Lessf c => new GreaterOrEqualf(c.Left, c.Right),
        LessOrEqualf c => new Greaterf(c.Left, c.Right),
        _ => !comparison,
    };

    private static string Label(Entity comparison) => comparison.ToString().Replace("<=", "≤").Replace(">=", "≥");

    private static string LetterOf(string word) => Read(word) is { Pair: { } pair } r ? Named(pair.True, r.Channel) : word;

    /// <summary>An invariant that rules out one product of letters, said as an implication where it has that shape.</summary>
    private static Entity RulingOut(Entity never) => never switch
    {
        Andf { Left: Variable a, Right: Notf { Argument: Variable b } } => a.Implies(b),
        Andf { Left: Notf { Argument: Variable b }, Right: Variable a } => a.Implies(b),
        Notf n => n.Argument,
        _ => !never,
    };

    private sealed record Rule(Entity Formula, string Latex, string Why, bool Builtin);

    /// <summary>
    /// Each line is an output, Name = formula, or a condition, Name = comparison of real numbers. A
    /// comparison inside a formula is a condition of its own. Outputs may use the ones above them.
    /// </summary>
    public static string Analyze(string text, string always)
    {
        var lines = text.Split([';', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (lines.Length == 0)
            return Common.Fail("Type a formula.");
        var parts = new List<(string? Name, Entity Body)>();
        foreach (var line in lines)
        {
            var (name, body) = Definition(line);
            var parsed = Common.Parse(body, out var error);
            if (parsed is null)
                return Common.Fail(name is null ? error : $"{name}: {error}");
            parts.Add((name, parsed));
        }
        if (parts.Count > 1 && parts.Any(p => p.Name is null))
            return Common.Fail("Name each output when there are several, one per line, as in On_pump = On_request and NotEmpty_tank.");
        if (parts.Count > 8)
            return Common.Fail("Use at most eight lines.");

        // Comparisons become letters. A named one takes its name; one inside a formula gets a letter
        // that is shown as the comparison. A comparison and its negation share the letter.
        var conditions = new List<(Variable Letter, Entity Comparison, string? Name)>();
        var compared = new Dictionary<string, Entity>();
        var inline = new Dictionary<string, Entity>();
        foreach (var (name, body) in parts)
        {
            if (name is null || !IsComparison(body))
                continue;
            var letter = MathS.Var(LetterOf(name));
            var where = Read(name) is { Pair: not null, Negated: true } ? Negate(body) : body;
            if (conditions.Any(c => c.Letter == letter) || compared.ContainsKey(where.ToString()))
                return Common.Fail($"{name} repeats a condition already defined.");
            conditions.Add((letter, where, name));
            compared[where.ToString()] = letter;
            compared[Negate(where).ToString()] = !letter;
        }
        Entity Lettered(Entity e) => Common.AsLetters(e.Replace(node =>
        {
            if (!IsComparison(node))
                return node;
            if (!node.Vars.Any())
                return Common.Try(() => node.Evaled) is Entity.Boolean value ? value : node;
            if (compared.TryGetValue(node.ToString(), out var known))
                return known;
            var letter = MathS.Var($"cmp_{inline.Count + 1}");
            inline[letter.Name] = node;
            conditions.Add((letter, node, null));
            compared[node.ToString()] = letter;
            compared[Negate(node).ToString()] = !letter;
            return letter;
        }));
        // Shown: each comparison letter as its comparison, a negated one turned round, and senses.
        Entity Unlettered(Entity e) => e.Replace(node => node is Variable v && inline.TryGetValue(v.Name, out var c) ? c : node);
        Entity Display(Entity e) => InSenses(Unlettered(e).Replace(node => node is Notf { Argument: var a } && IsComparison(a) ? Negate(a) : node));

        var outputLetters = parts.Where(p => p.Name is not null && !IsComparison(p.Body)).Select(p => LetterOf(p.Name!)).ToList();
        if (outputLetters.Distinct().Count() != outputLetters.Count)
            return Common.Fail("Two outputs name one channel; define each once.");
        var outputs = new List<(string? Name, Entity Written, Entity Formula)>();
        var words = new List<Entity>();
        var defined = new Dictionary<string, Entity>();
        foreach (var (name, body) in parts)
        {
            if (name is not null && IsComparison(body))
                continue;
            var logic = Lettered(body);
            if (!IsFormula(logic))
                return Common.Fail($"{name ?? "The formula"} is not a formula in senses: use senses such as Open_door, comparisons such as T > 100, and and, or, xor, implies and not.");
            words.Add(logic);
            var formula = InLetters(logic).Replace(node => node is Variable v && defined.TryGetValue(v.Name, out var f) ? f : node);
            if (formula.Vars.FirstOrDefault(v => outputLetters.Contains(v.Name)) is { } early)
                return Common.Fail($"{early.Name} is an output used above its own line; define an output before using it.");
            if (name is not null)
                defined[LetterOf(name)] = Read(name) is { Pair: not null, Negated: true } ? !formula : formula;
            outputs.Add((name, body, formula));
        }
        if (outputs.Count == 0)
            return Common.Fail("Add an output that uses the conditions, as in On_alarm = On_kettle and above_boilingpoint.");

        // An invariant over inputs is a fact about the plant: it decides which rows can occur. One
        // that mentions an output is a check on the design instead, true or not in those rows, and
        // the outputs in it are replaced by their formulas.
        var rules = new List<Rule>();
        var checks = new List<(string Latex, Entity Formula)>();
        foreach (var part in always.Split([';', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parsed = Common.Parse(part, out var error);
            if (parsed is null)
                return Common.Fail($"In the invariants: {error}");
            var logic = Lettered(parsed);
            if (!IsFormula(logic))
                return Common.Fail($"The invariant “{part}” is not a formula in senses.");
            words.Add(logic);
            var formula = InLetters(logic);
            if (formula.Vars.Any(v => outputLetters.Contains(v.Name)))
                checks.Add((Common.Latex(parsed), formula.Replace(node => node is Variable v && defined.TryGetValue(v.Name, out var f) ? f : node)));
            else
                rules.Add(new(formula, Common.Latex(parsed), "", false));
        }
        var reals = conditions.SelectMany(c => c.Comparison.Vars).Select(v => v.Name).ToHashSet();
        var everything = outputs.Select(o => o.Formula).Concat(rules.Select(r => r.Formula)).Concat(checks.Select(c => c.Formula)).ToList();
        if (everything.SelectMany(e => e.Vars).FirstOrDefault(v => reals.Contains(v.Name)) is { } clash)
            return Common.Fail($"{clash.Name} is a number in a comparison and a true-or-false letter elsewhere.");

        var letters = everything.SelectMany(e => e.Vars).Select(v => v.Name).ToHashSet();
        foreach (var (a, b, why) in Exclusive)
        {
            var notB = Catalogue.First(p => p.True == b).False;
            foreach (var channel in letters.Select(Read).Where(r => r.Pair?.True == a).Select(r => r.Channel).Distinct().Order(StringComparer.Ordinal))
                if (letters.Contains(Named(b, channel)))
                {
                    var rule = MathS.FromString($"{Named(a, channel)} implies {Named(notB, channel)}");
                    rules.Add(new(InLetters(rule), Common.Latex(rule), why, true));
                }
        }

        // What AngouriMath knows about the comparisons: those on one real number constrain each other.
        var notes = new List<string>();
        foreach (var group in conditions.Where(c => letters.Contains(c.Letter.Name))
                     .GroupBy(c => string.Join(", ", c.Comparison.Vars.Select(v => v.Name).Order(StringComparer.Ordinal))))
        {
            var members = group.ToList();
            var x = members[0].Comparison.Vars.ToList() is [var only] ? only : null;
            if (x is null && group.Key.Length > 0)
            {
                notes.Add($"Comparisons on {group.Key} together are taken as independent: AngouriMath finds where one number crosses a value, not where several do.");
                continue;
            }
            if (Feasible(members.Select(m => m.Comparison).ToList(), x, out var turns) is not { } feasible)
            {
                notes.Add($"AngouriMath could not list where the comparisons on {group.Key} turn, so they are taken as independent.");
                continue;
            }
            var never = Enumerable.Range(0, 1 << members.Count).Where(i => !feasible.Contains(i)).ToList();
            var why = x is null ? "A comparison of numbers alone is true or false once and for all."
                : $"For every real {x}: AngouriMath solved where the comparisons on {x} turn, at {string.Join(", ", turns)}, and tested a value in each interval between. If they come from separate switches, one that breaks this is broken.";
            foreach (var term in Logic.MinimalCover(never, members.Count))
            {
                var rule = RulingOut(Logic.SumOfProducts([term], members.Select(m => m.Letter).ToList()));
                rules.Add(new(rule, Common.Latex(Display(rule)), why, true));
            }
        }

        var vars = outputs.SelectMany(o => o.Formula.Vars).Distinct()
            .OrderBy(v => inline.TryGetValue(v.Name, out var c) ? Label(c) : v.Name, StringComparer.Ordinal).ToList();
        if (vars.Count == 0 || vars.Count > 6)
            return Common.Fail("Use between one and six inputs, counting each comparison as one.");
        Entity holds = rules.Count == 0 ? true : rules.Select(r => r.Formula).Aggregate((x, y) => x & y);
        var all = vars.Concat(Common.VarsOf(holds).Where(v => !vars.Contains(v))).ToList();
        if (all.Count > 10)
            return Common.Fail("Use at most ten inputs across the outputs and the invariants.");

        // A row of the outputs' inputs can occur when some value of the invariants' other letters satisfies them.
        var n = vars.Count;
        var possible = new bool[1 << n];
        if (rules.Count == 0)
            Array.Fill(possible, true);
        else if (TrueRows(holds, all) is { } holding)
            foreach (var row in holding)
                possible[row >> (all.Count - n)] = true;
        else
            return Common.Fail("AngouriMath could not build the truth table of the invariants.");
        if (!possible.Contains(true))
            return Common.Fail("The invariants contradict each other: no value of the signals satisfies them all.");
        var dontCares = Enumerable.Range(0, 1 << n).Where(i => !possible[i]).ToList();

        var columns = new List<HashSet<int>>();
        var described = new JsonArray();
        foreach (var (name, written, formula) in outputs)
        {
            var rows = (TrueRows(formula, vars) ?? []).ToHashSet();
            columns.Add(rows);
            var cover = Logic.MinimalCover(rows.Where(i => possible[i]).Order().ToList(), n, dontCares);
            var minimal = Logic.SumOfProducts(cover, vars);
            var simplified = Common.Try(() => formula.Simplify());
            described.Add(new JsonObject
            {
                ["name"] = name,
                ["nameLatex"] = name is null ? null : Common.Latex(MathS.Var(name)),
                ["latex"] = Common.Latex(written),
                ["lettersLatex"] = Common.Latex(Unlettered(formula)),
                ["simplifiedLatex"] = Common.Latex(simplified is null ? null : Display(simplified)),
                ["simplifiedEquivalent"] = simplified is not null && NeverTrue(formula.Xor(simplified)),
                ["sop"] = Display(minimal).ToString(),
                ["sopLatex"] = Common.Latex(Display(minimal)),
                ["sopEquivalent"] = NeverTrue(formula.Xor(minimal) & holds),
                ["groups"] = new JsonArray(cover.Select(c => (JsonNode)new JsonObject { ["mask"] = c.Mask, ["value"] = c.Value }).ToArray()),
            });
        }

        string Shown(Variable v) => inline.TryGetValue(v.Name, out var c) ? Label(c) : v.Name;
        string Opposite(Variable v) => inline.TryGetValue(v.Name, out var c) ? Label(Negate(c))
            : Read(v.Name) is { Pair: { } pair } r ? Named(pair.False, r.Channel) : $"¬{v.Name}";
        var o = new JsonObject
        {
            ["ok"] = true,
            ["inputs"] = new JsonArray(vars.Select(v => (JsonNode)new JsonObject { ["label"] = Shown(v), ["opposite"] = Opposite(v) }).ToArray()),
            ["outputs"] = described,
            ["truth"] = new JsonObject
            {
                ["vars"] = new JsonArray(vars.Select(v => (JsonNode)JsonValue.Create(Shown(v))).ToArray()),
                ["outputs"] = new JsonArray(outputs.Select(p => (JsonNode)JsonValue.Create(p.Name ?? "value")).ToArray()),
                ["rows"] = new JsonArray(Enumerable.Range(0, 1 << n).Select(i => (JsonNode)new JsonArray(
                    Enumerable.Range(0, n).Select(j => (JsonNode)JsonValue.Create(((i >> (n - 1 - j)) & 1) == 1))
                        .Concat(columns.Select(c => (JsonNode)JsonValue.Create(c.Contains(i)))).ToArray())).ToArray()),
                ["possible"] = new JsonArray(possible.Select(p => (JsonNode)JsonValue.Create(p)).ToArray()),
            },
            ["dontCares"] = new JsonArray(dontCares.Select(i => (JsonNode)JsonValue.Create(i)).ToArray()),
        };

        var outputWords = parts.Where(p => p.Name is not null && !IsComparison(p.Body)).Select(p => p.Name!);
        var named = conditions.Where(c => c.Name is not null).ToDictionary(c => c.Letter.Name, c => c.Comparison);
        o["senses"] = new JsonArray(outputWords.Concat(words.SelectMany(e => e.Vars).Select(v => v.Name).Where(w => !inline.ContainsKey(w)))
            .Distinct()
            .Select(word => (Word: word, Reading: Read(word), Letter: LetterOf(word)))
            .OrderBy(w => w.Letter, StringComparer.Ordinal).ThenBy(w => w.Word, StringComparer.Ordinal)
            .Select(w => (JsonNode)new JsonObject
            {
                ["word"] = w.Word,
                ["letter"] = w.Letter,
                ["negated"] = w.Reading.Negated,
                ["pair"] = w.Reading.Pair is { } p ? $"{p.True} / {p.False}" : null,
                ["source"] = w.Reading.Pair?.Source,
                ["output"] = outputLetters.Contains(w.Letter),
                ["condition"] = named.TryGetValue(w.Letter, out var c) ? Label(c) : null,
            }).ToArray());
        o["conditions"] = new JsonArray(conditions.Where(c => letters.Contains(c.Letter.Name)).Select(c => (JsonNode)new JsonObject
        {
            ["name"] = c.Name,
            ["latex"] = Common.Latex(c.Comparison),
        }).ToArray());
        o["notes"] = new JsonArray(notes.Select(t => (JsonNode)JsonValue.Create(t)).ToArray());
        o["rules"] = new JsonArray(rules.Select(r => (JsonNode)new JsonObject
        {
            ["latex"] = r.Latex,
            ["builtin"] = r.Builtin,
            ["why"] = r.Why,
        }).ToArray());

        // The invariants fail only when a signal is wrong, so their failure is an alarm.
        if (rules.Count > 0)
        {
            var ruleVars = Common.VarsOf(holds);
            var fault = ruleVars.Count <= 6 && TrueRows(!holds, ruleVars) is { } broken
                ? Logic.SumOfProducts(Logic.MinimalCover(broken, ruleVars.Count), ruleVars)
                : Common.Try(() => (!holds).Simplify());
            o["faultLatex"] = Common.Latex(fault is null ? null : Display(fault));
            // Each term of the alarm is a condition of its own, so the page can list them.
            o["faultTerms"] = new JsonArray((fault is null ? [] : Disjuncts(Display(fault)))
                .Select(t => (JsonNode)JsonValue.Create(Common.Latex(t))).ToArray());
            o["faultEquivalent"] = fault is not null && NeverTrue(fault.Xor(!holds));
            o["faultNever"] = fault is Entity.Boolean { Value: false };
        }

        // A check holds when no row that can occur breaks it: AngouriMath's truth table of the
        // invariants and the check's negation has no true row. Where it fails, the rows that break
        // it are described by their minimal form, with the rows that cannot occur as don't-cares.
        o["checks"] = new JsonArray(checks.Select(check =>
        {
            var space = Common.VarsOf(check.Formula & holds);
            var broken = TrueRows(holds & !check.Formula, space) ?? [];
            var result = new JsonObject { ["latex"] = check.Latex, ["holds"] = broken.Count == 0 };
            if (broken.Count == 0)
                return (JsonNode)result;
            var occur = TrueRows(holds, space) ?? [];
            result["broken"] = broken.Count;
            result["occur"] = occur.Count;
            var when = space.Count <= 8
                ? Logic.SumOfProducts(Logic.MinimalCover(broken, space.Count, Enumerable.Range(0, 1 << space.Count).Except(occur).ToList()), space)
                : Common.Try(() => (holds & !check.Formula).Simplify());
            result["whenTerms"] = new JsonArray((when is null ? [] : Disjuncts(Display(when)))
                .Select(t => (JsonNode)JsonValue.Create(Common.Latex(t))).ToArray());
            var bits = broken[0];
            result["example"] = string.Join(", ", Common.VarsOf(check.Formula).Select(v =>
                ((bits >> (space.Count - 1 - space.IndexOf(v))) & 1) == 1 ? Shown(v) : Opposite(v)));
            return result;
        }).ToArray());
        return o.ToJsonString();
    }

    /// <summary>
    /// The combinations of the comparisons that some real <paramref name="x"/> satisfies, as indices
    /// (bit i from the left is comparison i), and the points where they turn. Each side is taken to
    /// be continuous, so a comparison turns only where its sides are equal: AngouriMath solves for
    /// those points, and each point and one value in every interval between them are tested. Null
    /// when a solution is not a list of numbers.
    /// </summary>
    private static HashSet<int>? Feasible(List<Entity> comparisons, Variable? x, out List<Entity> turns)
    {
        turns = [];
        var points = new List<(Entity Exact, double Value)>();
        if (x is not null)
            foreach (var comparison in comparisons)
            {
                var (left, right) = Sides(comparison);
                if (Common.Try(() => MathS.SolveEquation(left - right, x)) is not { } set || Listed(set) is not { } roots)
                    return null;
                foreach (var root in roots)
                    if (Common.Real(root) is { } value && !points.Any(p => Math.Abs(p.Value - value) <= 1e-12 * Math.Max(1, Math.Abs(value))))
                        points.Add((root, value));
            }
        points.Sort((a, b) => a.Value.CompareTo(b.Value));
        turns = points.Select(p => p.Exact).ToList();
        var samples = new List<Entity>();
        if (points.Count == 0)
            samples.Add(0);
        else
        {
            samples.Add(points[0].Value - 1);
            for (var i = 0; i < points.Count; i++)
            {
                samples.Add(points[i].Exact);
                samples.Add(i + 1 < points.Count ? (points[i].Value + points[i + 1].Value) / 2 : points[i].Value + 1);
            }
        }
        var feasible = new HashSet<int>();
        foreach (var sample in samples)
        {
            var index = 0;
            foreach (var comparison in comparisons)
            {
                var at = x is null ? comparison : comparison.Substitute(x, sample);
                if (Common.Try(() => at.Simplify().Evaled) is not Entity.Boolean value)
                {
                    index = -1;
                    break;
                }
                index = index * 2 + (value.Value ? 1 : 0);
            }
            if (index >= 0)
                feasible.Add(index);
        }
        return feasible;
    }

    /// <summary>The numbers in a solution set, or null when it is not a plain list of them.</summary>
    private static List<Entity>? Listed(Entity set) => set switch
    {
        Entity.Set.FiniteSet finite when finite.All(e => !e.Vars.Any()) => finite.ToList(),
        Entity.Set.Unionf u when Listed(u.Left) is { } l && Listed(u.Right) is { } r => l.Concat(r).ToList(),
        _ => null,
    };

    /// <summary>Whether the formula is false in every row of AngouriMath's truth table over its own letters.</summary>
    private static bool NeverTrue(Entity e) => TrueRows(e, Common.VarsOf(e)) is [];

    private static IEnumerable<Entity> Disjuncts(Entity e) =>
        e is Orf or ? Disjuncts(or.Left).Concat(Disjuncts(or.Right)) : [e];

    /// <summary>
    /// The rows over <paramref name="vars"/> where the formula is true, as indices. AngouriMath's
    /// truth table is over exactly the formula's own letters, so the others are free.
    /// </summary>
    private static List<int>? TrueRows(Entity e, List<Variable> vars)
    {
        var own = vars.Where(e.Vars.ToHashSet().Contains).ToList();
        var holds = new HashSet<int>();
        if (own.Count == 0)
        {
            if (Common.Try(() => e.Evaled) is not Entity.Boolean value)
                return null;
            if (value.Value)
                holds.Add(0);
        }
        else
        {
            var table = Common.Try(() => MathS.Boolean.BuildTruthTable(e, own.ToArray()));
            if (table is null)
                return null;
            for (var i = 0; i < table.RowCount; i++)
                if (table[i, own.Count] is Entity.Boolean { Value: true })
                {
                    var index = 0;
                    for (var j = 0; j < own.Count; j++)
                        index = index * 2 + (table[i, j] is Entity.Boolean { Value: true } ? 1 : 0);
                    holds.Add(index);
                }
        }
        // Each row over all the letters, read at the formula's own.
        var positions = own.Select(v => vars.Count - 1 - vars.IndexOf(v)).ToList();
        return Enumerable.Range(0, 1 << vars.Count)
            .Where(row => holds.Contains(positions.Aggregate(0, (index, bit) => index * 2 + ((row >> bit) & 1))))
            .ToList();
    }
}
