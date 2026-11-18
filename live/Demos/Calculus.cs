using System.Diagnostics;
using System.Text.Json.Nodes;
using AngouriMath;
using AngouriMath.Core;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>
/// The calculus demo: f(x), its first two derivatives and an antiderivative, all exact; the roots,
/// extrema and inflection points as solution sets; and Taylor polynomials closing in on f.
/// </summary>
public static class Calculus
{
    private const int MaxOrder = 8;
    private static readonly Variable X = "x";

    private static FastExpression? f, d1, d2, antiderivative;
    private static FastExpression?[] taylor = new FastExpression?[MaxOrder + 1];
    private static Entity? exactAntiderivative;

    public static string Analyze(string text)
    {
        var clock = Stopwatch.StartNew();
        var e = Common.Parse(text, out var error);
        if (e is null)
            return Common.Fail(error);
        var stray = e.Vars.Where(v => v != X).Select(v => v.Name).ToList();
        if (stray.Count > 0)
            return Common.Fail($"Use x as the only variable. This formula also has {string.Join(", ", stray)}.");

        var first = Common.Try(() => Common.Unconditional(e.Differentiate(X)).Simplify());
        var second = first is null ? null : Common.Try(() => Common.Unconditional(first.Differentiate(X)).Simplify());
        var integral = Common.Try(() => e.Integrate(X).Simplify());
        // An integral AngouriMath could not find comes back as an integral node.
        var found = integral is not null && !integral.Nodes.Any(n => n is Integralf);
        exactAntiderivative = found ? integral!.Substitute("C", 0) : null;

        f = Common.TryCompile(e, X);
        d1 = Common.TryCompile(first, X);
        d2 = Common.TryCompile(second, X);
        antiderivative = Common.TryCompile(exactAntiderivative, X);

        JsonObject Solved(Entity? of, string what)
        {
            var set = of is null ? null : Common.Try(() => (Entity)of.SolveEquation(X));
            return new JsonObject
            {
                ["what"] = what,
                ["latex"] = set is null ? "" : Common.Latex(set),
                ["text"] = set?.ToString() ?? "",
                ["points"] = Common.Numbers(Common.RealPoints(set, -1e6, 1e6)),
                // Decimals in the answer are what a numerical search found where no closed form was:
                // the roots of tan x = x that sin(x)/x's extrema need, a few of infinitely many.
                ["numerical"] = set is Entity.Set.FiniteSet found
                    && found.Any(root => root.Nodes.Any(node => node is Entity.Number.Real and not Entity.Number.Rational)),
            };
        }

        return new JsonObject
        {
            ["ok"] = true,
            ["f"] = Common.Latex(e),
            ["d1"] = Common.Latex(first),
            ["d2"] = Common.Latex(second),
            ["integral"] = found ? Common.Latex(integral) : "",
            ["roots"] = Solved(e, "roots"),
            ["extrema"] = Solved(first, "extrema"),
            ["inflections"] = Solved(second, "inflections"),
            ["ms"] = clock.ElapsedMilliseconds,
        }.ToJsonString();
    }

    /// <summary>Taylor polynomials of orders 0 to 8 around a, as LaTeX; also compiled for plotting.</summary>
    public static string Taylor(string text, double a)
    {
        var e = Common.Parse(text, out var error);
        if (e is null)
            return Common.Fail(error);
        // Expanding where f has no value (sin(x)/x at 0) sends AngouriMath through limits of
        // ever larger quotients; it does not come back in useful time.
        if (Common.Real(e.Substitute(X, a)) is null)
        {
            Array.Clear(taylor);
            return Common.Fail($"f has no real value at x = {a:0.###}, so it has no Taylor polynomial there.");
        }
        // Built from the exact derivatives at a, each simplified before the next is taken: the
        // library's Taylor simplifies the whole polynomial at the end, which for sin(x)/x at 1
        // took two minutes.
        var latex = new JsonArray();
        Entity derivative = e, polynomial = 0, shift = a == 0 ? X : X - a, factorial = 1;
        for (var order = 0; order <= MaxOrder; order++)
        {
            if (order > 0)
            {
                factorial *= order;
                var next = Common.Try(() => Common.Unconditional(derivative.Differentiate(X)).Simplify());
                if (next is null)
                {
                    for (; order <= MaxOrder; order++)
                    {
                        taylor[order] = null;
                        latex.Add(JsonValue.Create(""));
                    }
                    break;
                }
                derivative = next;
            }
            var coefficient = Common.Try(() => (derivative.Substitute(X, a) / factorial).Simplify()) ?? 0;
            if (order == 0)
                polynomial = coefficient;
            else if (coefficient != 0)
            {
                var power = order == 1 ? shift : MathS.Pow(shift, order);
                var term = coefficient == 1 ? power : coefficient * power;
                polynomial = polynomial == 0 ? term : polynomial + term;
            }
            taylor[order] = Common.TryCompile(polynomial, X);
            latex.Add(JsonValue.Create(taylor[order] is null ? "" : Common.Latex(polynomial)));
        }
        return new JsonObject { ["ok"] = true, ["latex"] = latex }.ToJsonString();
    }

    /// <summary>f, f', f'', the antiderivative and the Taylor polynomial of the given order over [from, to].</summary>
    public static double[] Sample(double from, double to, int n, int order)
    {
        var curves = new[] { f, d1, d2, antiderivative, order >= 0 && order <= MaxOrder ? taylor[order] : null };
        return curves.SelectMany(c => Common.Sample(c, from, to, n)).ToArray();
    }

    /// <summary>The area under f over [a, b]: exactly from the antiderivative, and by the midpoint rule as a check.</summary>
    public static string Area(double a, double b)
    {
        string? exact = null, exactLatex = null;
        double? exactValue = null;
        if (exactAntiderivative is not null)
        {
            var area = Common.Try(() => (exactAntiderivative.Substitute(X, b) - exactAntiderivative.Substitute(X, a)).Simplify());
            if (area is not null)
            {
                exact = area.ToString();
                exactLatex = Common.Latex(area);
                exactValue = Common.Real(area);
            }
        }
        // Midpoints never touch the ends, where f may have no value (sin(x)/x at 0).
        const int n = 4000;
        var h = (b - a) / n;
        var ys = Common.Sample(f, a + h / 2, b - h / 2, n);
        var midpoint = ys.Sum() * h;
        return new JsonObject
        {
            ["exact"] = exact, ["exactLatex"] = exactLatex, ["exactValue"] = exactValue,
            ["numeric"] = double.IsFinite(midpoint) ? midpoint : null,
        }.ToJsonString();
    }

    /// <summary>
    /// The limits of f at both infinities, and on either side of each point near the origin where
    /// a denominator or the argument of a logarithm is zero, which is where f may have a hole, a
    /// jump or a pole.
    /// </summary>
    public static string Limits(string text)
    {
        var e = Common.Parse(text, out var error);
        if (e is null)
            return Common.Fail(error);
        var points = new List<(Entity At, double Value)>();
        foreach (var node in e.Nodes)
        {
            var zero = node switch { Divf d => d.Divisor, Logf l => l.Antilogarithm, _ => null };
            if (zero is null || !zero.Vars.Contains(X))
                continue;
            // A family such as the zeros of sin(x) is a union over an index, not a finite set; it is left out.
            if (Common.Try(() => (Entity)zero.SolveEquation(X)) is not Entity.Set.FiniteSet zeros)
                continue;
            foreach (var z in zeros)
                if (!z.Vars.Any() && Common.Real(z) is { } v && Math.Abs(v) <= 50 && !points.Any(p => Math.Abs(p.Value - v) < 1e-9))
                    points.Add((Common.Try(() => z.Simplify()) ?? z, v));
        }
        var near = new JsonArray();
        foreach (var (at, value) in points.OrderBy(p => Math.Abs(p.Value)).Take(4))
            near.Add(new JsonObject
            {
                ["at"] = Common.Latex(at),
                ["x"] = value,
                ["defined"] = Common.Real(e.Substitute(X, at)) is not null,
                ["left"] = Limit(e, at, ApproachFrom.Left),
                ["right"] = Limit(e, at, ApproachFrom.Right),
            });
        return new JsonObject
        {
            ["ok"] = true,
            ["minus"] = Limit(e, Number.Real.NegativeInfinity, ApproachFrom.BothSides),
            ["plus"] = Limit(e, Number.Real.PositiveInfinity, ApproachFrom.BothSides),
            ["points"] = near,
        }.ToJsonString();
    }

    /// <summary>The limit of f at a point the reader chooses, from each side; at an infinity, the one there is.</summary>
    public static string LimitAt(string text, string atText)
    {
        var e = Common.Parse(text, out var error);
        var at = e is null ? null : Common.Parse(atText, out error);
        if (e is null || at is null)
            return Common.Fail(error);
        if (at.Vars.Any() || Common.RealOrInfinite(at) is not { } value)
            return Common.Fail("x has to approach a real number, +oo or -oo.");
        var o = new JsonObject { ["ok"] = true, ["at"] = Common.Latex(at), ["x"] = double.IsFinite(value) ? value : null };
        if (double.IsFinite(value))
        {
            o["left"] = Limit(e, at, ApproachFrom.Left);
            o["right"] = Limit(e, at, ApproachFrom.Right);
            o["value"] = Common.Real(e.Substitute(X, at)) is { } v ? v : null;
        }
        else
            o["limit"] = Limit(e, at, ApproachFrom.BothSides);
        return o.ToJsonString();
    }

    /// <summary>
    /// One limit as LaTeX, with its kind: a real value, an infinity, none (AngouriMath answers NaN
    /// where there is no limit, as for sin(x) at infinity) or unknown (it left the limit unevaluated).
    /// </summary>
    private static JsonObject Limit(Entity f, Entity at, ApproachFrom side)
    {
        var limit = Common.Try(() => Common.Unconditional(f.Limit(X, at, side)));
        if (limit is null || limit.Nodes.Any(n => n is Limitf))
            return new JsonObject { ["kind"] = "unknown", ["latex"] = "" };
        if (limit.IsNaN)
            return new JsonObject { ["kind"] = "none", ["latex"] = "" };
        var value = Common.RealOrInfinite(limit);
        return new JsonObject
        {
            ["kind"] = value switch { double.PositiveInfinity => "+oo", double.NegativeInfinity => "-oo", null => "other", _ => "value" },
            ["latex"] = Common.Latex(limit),
            ["value"] = value is { } v && double.IsFinite(v) ? v : null,
        };
    }
}
