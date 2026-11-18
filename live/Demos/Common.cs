using System.Text.Json.Nodes;
using AngouriMath;
using AngouriMath.Core;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>What every demo needs: reading a formula, real numbers out of results, and JSON for the page.</summary>
internal static class Common
{
    /// <summary>Parses the text, or says why it is not a formula yet.</summary>
    public static Entity? Parse(string text, out string error)
    {
        error = "";
        if (string.IsNullOrWhiteSpace(text))
        {
            error = "Type a formula.";
            return null;
        }
        try
        {
            return MathS.FromString(text);
        }
        catch (Exception e)
        {
            error = $"Could not read the formula: {e.Message}";
            return null;
        }
    }

    // Differentiating can attach "provided ..." for a domain no real input leaves; a shader or a
    // plot cannot state it, so the demos drop it where they say why.
    public static Entity Unconditional(Entity e) => e is Providedf p ? p.Expression : e;

    public static string Latex(Entity? e)
    {
        if (e is null)
            return "";
        try
        {
            return e.Latexize();
        }
        catch (Exception)
        {
            return "";
        }
    }

    /// <summary>The real value of a closed expression, or null when it has none.</summary>
    public static double? Real(Entity e)
    {
        try
        {
            if (e is Providedf p)
            {
                if (p.Predicate.Evaled is not Entity.Boolean { Value: true })
                    return null;
                e = p.Expression;
            }
            var z = e.EvalNumerical().ToNumerics();
            if (!double.IsFinite(z.Real))
                return null;
            return Math.Abs(z.Imaginary) <= 1e-9 * Math.Max(1, Math.Abs(z.Real)) ? z.Real : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>Like <see cref="Real"/>, but infinities count: interval ends can be ±oo.</summary>
    public static double? RealOrInfinite(Entity e)
    {
        try
        {
            var z = e.EvalNumerical().ToNumerics();
            if (double.IsNaN(z.Real) || (double.IsFinite(z.Real) && Math.Abs(z.Imaginary) > 1e-9 * Math.Max(1, Math.Abs(z.Real))))
                return null;
            return z.Real;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>Samples a compiled function of one variable; NaN where it has no real value.</summary>
    public static double[] Sample(FastExpression? f, double from, double to, int n)
    {
        var r = new double[n];
        for (var i = 0; i < n; i++)
        {
            if (f is null)
            {
                r[i] = double.NaN;
                continue;
            }
            var x = from + (to - from) * i / (n - 1);
            try
            {
                var z = f.Call(x);
                r[i] = Math.Abs(z.Imaginary) <= 1e-9 * Math.Max(1, Math.Abs(z.Real)) ? z.Real : double.NaN;
            }
            catch (Exception)
            {
                r[i] = double.NaN;
            }
        }
        return r;
    }

    public static FastExpression? TryCompile(Entity? e, params Variable[] vars)
    {
        if (e is null)
            return null;
        try
        {
            return e.Compile(vars);
        }
        catch (Exception)
        {
            return null;
        }
    }

    public static T? Try<T>(Func<T?> f) where T : class
    {
        try
        {
            return f();
        }
        catch (Exception)
        {
            return null;
        }
    }

    public static JsonArray Numbers(IEnumerable<double> values)
    {
        var a = new JsonArray();
        foreach (var v in values)
            a.Add(double.IsFinite(v) ? JsonValue.Create(v) : null);
        return a;
    }

    public static JsonArray Strings(IEnumerable<string> values)
    {
        var a = new JsonArray();
        foreach (var v in values)
            a.Add(JsonValue.Create(v));
        return a;
    }

    public static string Fail(string error) => new JsonObject { ["ok"] = false, ["error"] = error }.ToJsonString();

    /// <summary>The variables of an expression, sorted by name.</summary>
    public static List<Variable> VarsOf(Entity e) => e.Vars.OrderBy(v => v.Name, StringComparer.Ordinal).ToList();

    /// <summary>
    /// The formula with e, pi and i read as letters. The parser makes e and pi constants and i
    /// the imaginary unit, but a binder that names one of them binds an ordinary variable of that
    /// name (AngouriMath's <c>Binding</c>, #984), and among true-or-false letters that is what
    /// they are. A set builder is the binder at hand: its <c>Var</c> is that variable.
    /// </summary>
    public static Entity AsLetters(Entity e) =>
        e.Replace(node => node is Constant || node is Number.Complex && node == MathS.i
            ? new Entity.Set.ConditionalSet(node, true).Var
            : node);

    /// <summary>Generated statements as a function body, indented.</summary>
    public static string Body(string code) =>
        string.Concat(code.Split('\n').Where(l => l.Length > 0).Select(l => $"    {l}\n"));

    /// <summary>Real points of a solution set within [lo, hi], including the members of a family of roots near index 0.</summary>
    public static List<double> RealPoints(Entity? set, double lo, double hi)
    {
        var points = new List<double>();
        void Add(double? v)
        {
            if (v is { } x && x >= lo && x <= hi && !points.Any(p => Math.Abs(p - x) < 1e-9 * Math.Max(1, Math.Abs(x))))
                points.Add(x);
        }
        var depth = 0;
        void Walk(Entity s)
        {
            switch (s)
            {
                case Entity.Set.FiniteSet fs:
                    foreach (var el in fs)
                        Add(Real(el));
                    break;
                case Entity.Set.Unionf u:
                    Walk(u.Left);
                    Walk(u.Right);
                    break;
                // A family of roots, union({ 2 pi n }, n in ZZ): its members for the indexes near 0. One
                // family inside another gets a shorter reach, so the two stay a few thousand members.
                case Entity.Set.IndexedUnionf { Over: Entity.Set over } family:
                    var reach = depth > 0 || family.Body.Nodes.Any(n => n is Entity.Set.IndexedUnionf) ? 20 : 80;
                    depth++;
                    for (var n = -reach; n <= reach; n++)
                        if (over.TryContains(n, out var inside) && inside)
                            Walk(family.Body.Substitute(family.Var, n));
                    depth--;
                    break;
            }
        }
        if (set is not null)
            Walk(set);
        points.Sort();
        return points;
    }

    /// <summary>A set of reals as intervals and points, or null when it is not one the page can draw.</summary>
    public static JsonArray? Intervals(Entity set)
    {
        var parts = new JsonArray();
        bool Walk(Entity s)
        {
            switch (s)
            {
                case Entity.Set.Interval i:
                    var lo = RealOrInfinite(i.Left);
                    var hi = RealOrInfinite(i.Right);
                    if (lo is null || hi is null)
                        return false;
                    parts.Add(new JsonObject
                    {
                        ["lo"] = double.IsFinite(lo.Value) ? lo.Value : null,
                        ["hi"] = double.IsFinite(hi.Value) ? hi.Value : null,
                        ["loClosed"] = i.LeftClosed, ["hiClosed"] = i.RightClosed,
                        ["loText"] = i.Left.ToString(), ["hiText"] = i.Right.ToString(),
                    });
                    return true;
                case Entity.Set.FiniteSet fs:
                    foreach (var el in fs)
                    {
                        if (Real(el) is not { } v)
                            return false;
                        parts.Add(new JsonObject { ["point"] = v, ["text"] = el.ToString() });
                    }
                    return true;
                case Entity.Set.Unionf u:
                    return Walk(u.Left) && Walk(u.Right);
                // Points taken out, as the inequality solver takes out where a denominator is zero:
                // (-2; 2) \ { 0 } is drawn as (-2; 0) and (0; 2).
                case Entity.Set.SetMinusf { Right: Entity.Set.FiniteSet removed } m:
                    var start = parts.Count;
                    if (!Walk(m.Left))
                        return false;
                    foreach (var el in removed)
                    {
                        if (Real(el) is not { } p)
                            return false;
                        for (var k = parts.Count - 1; k >= start; k--)
                        {
                            var part = parts[k]!.AsObject();
                            if (part["point"] is { } point)
                            {
                                if (point.GetValue<double>() == p)
                                    parts.RemoveAt(k);
                                continue;
                            }
                            var from = part["lo"]?.GetValue<double>() ?? double.NegativeInfinity;
                            var to = part["hi"]?.GetValue<double>() ?? double.PositiveInfinity;
                            if (p < from || p > to)
                                continue;
                            if (p == from)
                                part["loClosed"] = false;
                            else if (p == to)
                                part["hiClosed"] = false;
                            else
                            {
                                parts.Insert(k + 1, new JsonObject
                                {
                                    ["lo"] = p, ["hi"] = part["hi"]?.DeepClone(),
                                    ["loClosed"] = false, ["hiClosed"] = part["hiClosed"]!.DeepClone(),
                                    ["loText"] = el.ToString(), ["hiText"] = part["hiText"]!.DeepClone(),
                                });
                                part["hi"] = p;
                                part["hiClosed"] = false;
                                part["hiText"] = el.ToString();
                            }
                        }
                    }
                    return true;
                case Entity.Set.SpecialSet when s.ToString() == "RR":
                    parts.Add(new JsonObject
                    {
                        ["lo"] = null, ["hi"] = null, ["loClosed"] = false, ["hiClosed"] = false,
                        ["loText"] = "-oo", ["hiText"] = "+oo",
                    });
                    return true;
                default:
                    return false;
            }
        }
        return Walk(set) ? parts : null;
    }

    private static readonly Dictionary<string, string> Symbols = new()
    {
        ["Sumf"] = "+", ["Minusf"] = "−", ["Mulf"] = "×", ["Divf"] = "÷", ["Powf"] = "^", ["Andf"] = "and",
        ["Orf"] = "or", ["Xorf"] = "xor", ["Notf"] = "not", ["Impliesf"] = "implies", ["Equalsf"] = "=",
        ["Lessf"] = "<", ["Greaterf"] = ">", ["LessOrEqualf"] = "≤", ["GreaterOrEqualf"] = "≥", ["Unionf"] = "∪",
        ["Intersectionf"] = "∩", ["SetMinusf"] = "∖", ["Providedf"] = "provided", ["Logf"] = "log",
    };

    /// <summary>The expression tree as nested JSON, cut off after <paramref name="budget"/> nodes.</summary>
    public static JsonObject Tree(Entity e, ref int budget)
    {
        budget--;
        var name = e.GetType().Name;
        var label = e switch
        {
            Variable or Number or Entity.Boolean => e.ToString(),
            _ when Symbols.TryGetValue(name, out var s) => s,
            _ => name.EndsWith('f') ? name[..^1].ToLowerInvariant() : name,
        };
        var node = new JsonObject { ["t"] = label };
        if (e is Variable or Number or Entity.Boolean)
            return node;
        var children = new JsonArray();
        foreach (var c in e.DirectChildren)
        {
            if (budget <= 0)
            {
                children.Add(new JsonObject { ["t"] = "…" });
                break;
            }
            children.Add(Tree(c, ref budget));
        }
        node["c"] = children;
        return node;
    }
}
