using System.Text.Json.Nodes;
using AngouriMath;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>
/// The logic demo: a boolean formula as a truth table, a Karnaugh map with its groups, a gate
/// circuit, AngouriMath's simplification and a minimal sum of products, each checked equivalent
/// to the formula by AngouriMath's own truth table. Set formulas over A, B and C are read as the
/// same algebra and drawn as a Venn diagram.
/// </summary>
public static class Logic
{
    public static string Analyze(string text)
    {
        var e = Common.Parse(text, out var error);
        if (e is null)
            return Common.Fail(error);
        e = Common.AsLetters(e);
        if (!Representations.IsLogic(e))
            return Common.Fail("Use letters joined by and, or, xor, implies and not, for example (a and b) or not c.");
        return Describe(e).ToJsonString();
    }

    /// <summary>A formula over sets A, B and C, read as logic: in A ∪ B is in A or in B.</summary>
    public static string Venn(string text)
    {
        var e = Common.Parse(text, out var error);
        if (e is null)
            return Common.Fail(error);
        var logic = AsLogic(e);
        if (logic is null)
            return Common.Fail(@"Use the sets A, B and C with \/ (union), /\ (intersection) and \ (minus), for example (A \/ B) \ C.");
        var o = Describe(logic);
        if (o["simplified"] is JsonValue simplifiedText && Common.Parse(simplifiedText.GetValue<string>(), out _) is { } s)
            o["simplifiedSets"] = AsSets(s);
        o["sets"] = AsSets(logic);
        return o.ToJsonString();
    }

    private static JsonObject Describe(Entity e)
    {
        var vars = Common.VarsOf(e);
        if (vars.Count == 0 || vars.Count > 6)
            return new JsonObject { ["ok"] = false, ["error"] = "Use between one and six variables." };

        var o = new JsonObject { ["ok"] = true, ["latex"] = Common.Latex(e), ["text"] = e.ToString() };
        var truth = Representations.TruthTable(e, vars);
        o["truth"] = truth;

        // The rows where the formula holds, as indices: bit i (from the left) is variable i.
        var rows = (JsonArray)truth["rows"]!;
        var minterms = new List<int>();
        for (var r = 0; r < rows.Count; r++)
        {
            var row = (JsonArray)rows[r]!;
            if (row[vars.Count]!.GetValue<bool>())
            {
                var index = 0;
                for (var i = 0; i < vars.Count; i++)
                    index = index * 2 + (row[i]!.GetValue<bool>() ? 1 : 0);
                minterms.Add(index);
            }
        }

        var simplified = Common.Try(() => e.Simplify());
        o["simplified"] = simplified?.ToString() ?? "";
        o["simplifiedLatex"] = Common.Latex(simplified);
        o["simplifiedEquivalent"] = simplified is not null && Equivalent(e, simplified, vars);
        if (simplified is not null)
        {
            var budget = 80;
            o["circuit"] = Common.Tree(simplified, ref budget);
        }

        var cover = MinimalCover(minterms, vars.Count);
        var sop = SumOfProducts(cover, vars);
        o["groups"] = new JsonArray(cover.Select(c => (JsonNode)new JsonObject { ["mask"] = c.Mask, ["value"] = c.Value }).ToArray());
        o["sop"] = sop.ToString();
        o["sopLatex"] = Common.Latex(sop);
        o["sopEquivalent"] = Equivalent(e, sop, vars);
        return o;
    }

    /// <summary>AngouriMath's truth table of "a xor b" has no true row exactly when a and b agree everywhere.</summary>
    internal static bool Equivalent(Entity a, Entity b, List<Variable> vars) => NeverTrue(a.Xor(b), vars);

    /// <summary>Whether AngouriMath's truth table of the formula has no true row.</summary>
    internal static bool NeverTrue(Entity e, List<Variable> vars)
    {
        var table = Common.Try(() => MathS.Boolean.BuildTruthTable(e, vars.ToArray()));
        if (table is null)
            return false;
        for (var i = 0; i < table.RowCount; i++)
            if (table[i, table.ColumnCount - 1] is Entity.Boolean { Value: true })
                return false;
        return true;
    }

    /// <summary>A product term: the variables whose bit is set in Mask, each fixed to its bit in Value.</summary>
    internal readonly record struct Term(int Mask, int Value)
    {
        public bool Covers(int minterm) => (minterm & Mask) == Value;
        public int Literals => System.Numerics.BitOperations.PopCount((uint)Mask);
    }

    // Quine–McCluskey: merge terms that differ in one bit until nothing merges; what never merged
    // is prime. Then the smallest set of primes covering every minterm, by search over sizes,
    // fewest literals breaking ties. Six variables give at most 64 minterms. Don't-cares, rows
    // that cannot occur, take part in the merging but need no cover.
    internal static List<Term> MinimalCover(List<int> minterms, int n, IReadOnlyCollection<int>? dontCares = null)
    {
        dontCares ??= [];
        var full = (1 << n) - 1;
        if (minterms.Count == 0)
            return new();
        if (minterms.Count + dontCares.Count == 1 << n)
            return new() { new Term(0, 0) };
        var current = minterms.Concat(dontCares).Select(m => new Term(full, m)).ToHashSet();
        var primes = new HashSet<Term>();
        while (current.Count > 0)
        {
            var next = new HashSet<Term>();
            var merged = new HashSet<Term>();
            var list = current.ToList();
            for (var i = 0; i < list.Count; i++)
                for (var j = i + 1; j < list.Count; j++)
                {
                    var (a, b) = (list[i], list[j]);
                    var diff = a.Value ^ b.Value;
                    if (a.Mask == b.Mask && System.Numerics.BitOperations.PopCount((uint)diff) == 1)
                    {
                        next.Add(new Term(a.Mask & ~diff, a.Value & ~diff));
                        merged.Add(a);
                        merged.Add(b);
                    }
                }
            primes.UnionWith(current.Where(t => !merged.Contains(t)));
            current = next;
        }

        var primeList = primes.Where(p => minterms.Any(p.Covers)).OrderByDescending(p => (1 << n) - p.Literals).ToList();
        var essential = primeList.Where(p => minterms.Any(m => p.Covers(m) && primeList.Count(q => q.Covers(m)) == 1)).ToList();
        var left = minterms.Where(m => !essential.Any(p => p.Covers(m))).ToList();
        var candidates = primeList.Except(essential).Where(p => left.Any(p.Covers)).ToList();
        for (var size = 0; size <= candidates.Count; size++)
        {
            List<Term>? best = null;
            foreach (var pick in Combinations(candidates, size))
                if (left.All(m => pick.Any(p => p.Covers(m))) &&
                    (best is null || pick.Sum(p => p.Literals) < best.Sum(p => p.Literals)))
                    best = pick;
            if (best is not null)
                return essential.Concat(best).ToList();
        }
        return primeList;
    }

    private static IEnumerable<List<Term>> Combinations(List<Term> items, int size, int start = 0)
    {
        if (size == 0)
        {
            yield return new();
            yield break;
        }
        for (var i = start; i <= items.Count - size; i++)
            foreach (var rest in Combinations(items, size - 1, i + 1))
            {
                rest.Insert(0, items[i]);
                yield return rest;
            }
    }

    internal static Entity SumOfProducts(List<Term> cover, List<Variable> vars)
    {
        if (cover.Count == 0)
            return false;
        Entity? sum = null;
        foreach (var term in cover)
        {
            Entity? product = null;
            for (var i = 0; i < vars.Count; i++)
            {
                var bit = 1 << (vars.Count - 1 - i);
                if ((term.Mask & bit) == 0)
                    continue;
                Entity literal = (term.Value & bit) != 0 ? vars[i] : !vars[i];
                product = product is null ? literal : product & literal;
            }
            product ??= true;
            sum = sum is null ? product : sum | product;
        }
        return sum!;
    }

    private static Entity? AsLogic(Entity e) => e switch
    {
        Variable v when v.Name is "A" or "B" or "C" => v,
        Entity.Set.Unionf u when AsLogic(u.Left) is { } l && AsLogic(u.Right) is { } r => l | r,
        Entity.Set.Intersectionf i when AsLogic(i.Left) is { } l && AsLogic(i.Right) is { } r => l & r,
        Entity.Set.SetMinusf m when AsLogic(m.Left) is { } l && AsLogic(m.Right) is { } r => l & !r,
        _ => null,
    };

    private static string AsSets(Entity e) => e switch
    {
        Variable v => v.Name,
        Entity.Boolean { Value: true } => "everything",
        Entity.Boolean => "∅",
        Orf o => $"{Wrap(o.Left)} ∪ {Wrap(o.Right)}",
        Andf { Right: Notf n } a => $"{Wrap(a.Left)} ∖ {Wrap(n.Argument)}",
        Andf { Left: Notf n } a => $"{Wrap(a.Right)} ∖ {Wrap(n.Argument)}",
        Andf a => $"{Wrap(a.Left)} ∩ {Wrap(a.Right)}",
        Notf n => $"the complement of {Wrap(n.Argument)}",
        Xorf x => $"{Wrap(x.Left)} △ {Wrap(x.Right)}",
        _ => e.ToString(),
    };

    private static string Wrap(Entity e) => e is Variable ? AsSets(e) : $"({AsSets(e)})";
}
