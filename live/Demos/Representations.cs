using System.Globalization;
using System.Text.Json.Nodes;
using AngouriMath;
using AngouriMath.Core;
using AngouriMath.Core.Budgets;
using AngouriMath.Core.Transformations;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>
/// The representations demo: one formula, every form AngouriMath can give it. Text, LaTeX,
/// SymPy, the simplified form, the expression tree, shader source, and the picture that suits
/// it: a plot, a heat map, a truth table, a number line or a value. And whether it equals a
/// second formula.
/// </summary>
public static class Representations
{
    private static FastExpression? plotted;

    public static string Describe(string text)
    {
        var e = Common.Parse(text, out var error);
        if (e is null)
            return Common.Fail(error);

        var vars = Common.VarsOf(e);
        var o = new JsonObject
        {
            ["ok"] = true,
            ["text"] = e.ToString(),
            ["latex"] = Common.Latex(e),
            ["vars"] = Common.Strings(vars.Select(v => v.Name)),
            ["sympy"] = Common.Try(() => MathS.ToSympyCode(e)) ?? "",
        };
        // The text again with the glyphs of MathS.Settings.UnicodeOutput, which the parser reads back.
        string? unicode = null;
        MathS.Settings.UnicodeOutput.As(true, () => unicode = Common.Try(() => e.ToString()));
        o["unicode"] = unicode ?? "";

        var simplified = Common.Try(() => e.Simplify());
        o["simplified"] = simplified?.ToString() ?? "";
        o["simplifiedLatex"] = Common.Latex(simplified);

        // The other rewrites: one tidying pass, products multiplied out, factors gathered, and
        // the forms simplify weighs against each other, simplest first. Forms that typeset the
        // same (x + -6 and x - 6) are shown once.
        var forms = new JsonObject();
        foreach (var (name, form) in new (string, Func<Entity>)[]
                 { ("normalized", () => e.InnerSimplified), ("expanded", () => e.Expand()), ("factorized", () => e.Factorize()) })
        {
            var f = Common.Try(form);
            forms[name] = new JsonObject { ["text"] = f?.ToString() ?? "", ["latex"] = Common.Latex(f) };
        }
        var alternatives = new JsonArray();
        var seen = new HashSet<string>();
        foreach (var a in Common.Try(() => e.Alternate(2).Take(16).ToList()) ?? new List<Entity>())
            if (alternatives.Count < 6 && Common.Latex(a) is var latex && seen.Add(latex))
                alternatives.Add(new JsonObject { ["text"] = a.ToString(), ["latex"] = latex });
        forms["alternatives"] = alternatives;
        o["forms"] = forms;

        var budget = 120;
        o["tree"] = Common.Tree(e, ref budget);
        var nodes = e.Nodes.ToList();
        o["nodes"] = nodes.Count;
        // Records compare by value, so equal subtrees collapse: what a shader computes once.
        o["distinct"] = nodes.Distinct().Count();

        plotted = null;
        if (Common.AsLetters(e) is var lettered && IsLogic(lettered))
        {
            o["kind"] = "logic";
            var letters = Common.VarsOf(lettered);
            if (letters.Count is > 0 and <= 6)
                o["truth"] = TruthTable(lettered, letters);
        }
        else if (e is Entity.Set)
        {
            o["kind"] = "set";
            var set = simplified ?? e;
            o["intervals"] = Common.Intervals(set);
        }
        else if (e is Statement && vars.Count == 1)
        {
            o["kind"] = "set";
            var solved = Common.Try(() => e.Solve(vars[0]));
            if (solved is null)
                o["note"] = $"AngouriMath could not solve this for {vars[0]}.";
            else
            {
                o["solved"] = solved.ToString();
                o["solvedLatex"] = Common.Latex(solved);
                o["intervals"] = Common.Intervals(solved);
            }
        }
        else if (vars.Count == 0)
        {
            o["kind"] = "value";
            o["value"] = Common.Try(() => e.EvalNumerical().ToString()) ?? "";
        }
        else if (vars.Count <= 2)
        {
            o["kind"] = vars.Count == 1 ? "curve" : (e is Statement ? "region" : "surface");
            var names = new Dictionary<Variable, string> { [vars[0]] = "p.x" };
            if (vars.Count == 2)
                names[vars[1]] = "p.y";
            var output = new List<KeyValuePair<string, Entity>> { new("r", e) };
            var glsl = MathS.Shaders.Glsl(output, names);
            var hlsl = MathS.Shaders.Hlsl(output, names);
            var type = e is Statement ? "bool" : "float";
            if (glsl.Succeeded)
                o["glsl"] = $"{type} f(vec2 p)\n{{\n    {type} r;\n{Common.Body(glsl.Code!)}    return r;\n}}\n";
            else
                o["glslReason"] = glsl.ToString();
            if (hlsl.Succeeded)
                o["hlsl"] = $"{type} f(float2 p)\n{{\n    {type} r;\n{Common.Body(hlsl.Code!)}    return r;\n}}\n";
            if (vars.Count == 1)
                plotted = Common.TryCompile(e, vars[0]);
        }
        else
            o["kind"] = "other";
        return o.ToJsonString();
    }

    // What one equality question may spend. Steps count work, not time, so the answer is the same
    // on any machine.
    private const long CompareSteps = 20_000;

    /// <summary>
    /// Whether two formulas are equal, by MathS.AreEqual, which has three answers: proved by
    /// rewrite rules, refuted at a point, or neither. Asked over the complex numbers and over the
    /// reals; each time first with the rules that hold with no side condition, and where that
    /// decides nothing, with the conditional ones as well.
    /// </summary>
    public static string Compare(string leftText, string rightText)
    {
        var left = Common.Parse(leftText, out var error);
        if (left is null)
            return Common.Fail(error);
        var right = Common.Parse(rightText, out error);
        if (right is null)
            return Common.Fail(error);

        var budget = new WorkBudget { Steps = CompareSteps };
        var answers = new JsonArray();
        foreach (var domain in new[] { Domain.Complex, Domain.Real })
        {
            EqualityAnswer answer;
            try
            {
                answer = MathS.AreEqual(left, right, budget, Soundness.Sound, domain);
                if (answer.Verdict == EqualityVerdict.Unknown)
                    answer = MathS.AreEqual(left, right, budget, Soundness.SoundUnderAssumptions, domain);
            }
            catch (Exception e)
            {
                return Common.Fail($"AngouriMath did not compare these: {e.Message}");
            }

            var o = new JsonObject
            {
                ["domain"] = domain == Domain.Real ? "real" : "complex",
                ["verdict"] = answer.Verdict.ToString(),
                ["sound"] = JsonValue.Create(answer.Justification == Soundness.Sound),
                ["rules"] = Common.Strings(answer.Assumptions.Select(rule => rule.Replace('-', ' '))),
                ["finished"] = JsonValue.Create(answer.Budget.Completed),
            };
            // The point that refutes, and what each side is there.
            if (answer.Verdict == EqualityVerdict.NotEqual && answer.Witness is { } witness)
            {
                Entity At(Entity side) => witness.Aggregate(side, (e, point) => e.Substitute(point.Key, point.Value));
                o["atLatex"] = string.Join(@",\quad ", witness.Select(point => $"{Common.Latex(point.Key)} = {Common.Latex(point.Value)}"));
                o["leftAt"] = Approximate(At(left));
                o["rightAt"] = Approximate(At(right));
            }
            answers.Add(o);
        }
        return new JsonObject { ["ok"] = true, ["steps"] = CompareSteps, ["answers"] = answers }.ToJsonString();
    }

    /// <summary>A closed expression's value to eight digits, for reading beside another.</summary>
    private static string Approximate(Entity e)
    {
        if (Common.Try(() => e.EvalNumerical()) is not Number.Complex z || z.IsNaN)
            return "no value";
        var c = z.ToNumerics();
        static string Digits(double d) => d.ToString("G8", CultureInfo.InvariantCulture).Replace("-", "−");
        if (c.Imaginary == 0)
            return Digits(c.Real);
        var sign = c.Imaginary < 0 ? "−" : "+";
        return c.Real == 0 ? $"{Digits(c.Imaginary)}i" : $"{Digits(c.Real)} {sign} {Digits(Math.Abs(c.Imaginary))}i";
    }

    /// <summary>The last described function of one variable over [from, to].</summary>
    public static double[] Sample(double from, double to, int n) => Common.Sample(plotted, from, to, n);

    internal static bool IsLogic(Entity e) =>
        e is Statement && e.Nodes.All(n => n is Variable or Entity.Boolean or Andf or Orf or Xorf or Notf or Impliesf);

    internal static JsonObject TruthTable(Entity e, List<Variable> vars)
    {
        var table = MathS.Boolean.BuildTruthTable(e, vars.ToArray());
        var rows = new JsonArray();
        if (table is not null)
            for (var i = 0; i < table.RowCount; i++)
            {
                var row = new JsonArray();
                for (var j = 0; j < table.ColumnCount; j++)
                    row.Add(JsonValue.Create(table[i, j] is Entity.Boolean { Value: true }));
                rows.Add(row);
            }
        return new JsonObject { ["vars"] = Common.Strings(vars.Select(v => v.Name)), ["rows"] = rows };
    }
}
