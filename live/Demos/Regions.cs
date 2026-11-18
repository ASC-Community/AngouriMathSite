using System.Diagnostics;
using System.Text.Json.Nodes;
using AngouriMath;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>
/// The regions demo. In the plane: a statement in x and y becomes a GPU test of whether a point
/// is inside, each comparison's boundary gets its exact gradient so the page can draw it one
/// pixel wide, the statement is solved for y, and boundaries are intersected exactly. On the
/// line: a statement in x, or a set formula, becomes intervals.
/// </summary>
public static class Regions
{
    private const int MaxEdges = 6;
    private static readonly Variable X = "x", Y = "y";

    private static readonly Dictionary<Variable, string> Names = new() { ["x"] = "p.x", ["y"] = "p.y" };

    public static string Analyze(string text)
    {
        var clock = Stopwatch.StartNew();
        var e = Common.Parse(text, out var error);
        if (e is null)
            return Common.Fail(error);
        var stray = e.Vars.Where(v => v != X && v != Y).Select(v => v.Name).ToList();
        if (stray.Count > 0)
            return Common.Fail($"Use x and y only. This formula also has {string.Join(", ", stray)}.");

        if (e is Entity.Set || !e.Vars.Contains(Y))
            return Line(e, clock);
        if (e is not Statement)
            return Common.Fail("Type a comparison, such as x^2 + y^2 < 1 or y > sin(x).");

        var inside = MathS.Shaders.Glsl(new List<KeyValuePair<string, Entity>> { new("inside", e) }, Names);
        if (!inside.Succeeded)
            return Common.Fail(inside.ToString());

        var comparisons = e.Nodes.OfType<ComparisonSign>().Distinct().Take(MaxEdges).ToList();
        var edges = new JsonArray();
        var boundaries = new List<Entity>();
        var glsl = $"bool regionInside(vec2 p)\n{{\n    bool inside;\n{Common.Body(inside.Code!)}    return inside;\n}}\n";
        foreach (var c in comparisons)
        {
            if (c.DirectChildren.ToList() is not [var left, var right])
                continue;
            var g = left - right;
            var outputs = new List<KeyValuePair<string, Entity>>
            {
                new("r.x", g),
                new("r.y", Common.Unconditional(g.Differentiate(X))),
                new("r.z", Common.Unconditional(g.Differentiate(Y))),
            };
            var source = MathS.Shaders.Glsl(outputs, Names);
            if (!source.Succeeded)
                continue;
            glsl += $"\nvec3 edge{boundaries.Count}(vec2 p)\n{{\n    vec3 r;\n{Common.Body(source.Code!)}    return r;\n}}\n";
            edges.Add(new JsonObject { ["text"] = $"{left} = {right}", ["latex"] = Common.Latex(new Equalsf(left, right)) });
            boundaries.Add(g);
        }

        var solved = Common.Try(() => (Entity)e.Solve(Y));
        var points = new JsonArray();
        for (var i = 0; i < boundaries.Count && clock.ElapsedMilliseconds < 3000; i++)
            for (var j = i + 1; j < boundaries.Count && clock.ElapsedMilliseconds < 3000; j++)
            {
                var solutions = Common.Try(() => MathS.Equations(boundaries[i], boundaries[j]).Solve(X, Y));
                if (solutions is null)
                    continue;
                for (var r = 0; r < solutions.RowCount; r++)
                    if (Common.Real(solutions[r, 0]) is { } px && Common.Real(solutions[r, 1]) is { } py)
                        points.Add(new JsonObject
                        {
                            ["x"] = px, ["y"] = py,
                            ["text"] = $"({solutions[r, 0]}, {solutions[r, 1]})",
                        });
            }

        return new JsonObject
        {
            ["ok"] = true,
            ["dims"] = 2,
            ["latex"] = Common.Latex(e),
            ["glsl"] = glsl,
            ["edges"] = edges,
            ["solvedY"] = solved?.ToString() ?? "",
            ["solvedYLatex"] = Common.Latex(solved),
            ["points"] = points,
            ["ms"] = clock.ElapsedMilliseconds,
        }.ToJsonString();
    }

    private static string Line(Entity e, Stopwatch clock)
    {
        Entity? set;
        string how;
        if (e is Entity.Set)
        {
            set = Common.Try(() => e.Simplify());
            how = "simplified";
        }
        else if (e is Statement)
        {
            set = Common.Try(() => (Entity)e.Solve(X));
            how = "solved for x";
        }
        else
            return Common.Fail("Type a comparison in x, such as x^2 < 4, or a set such as [1; 3) \\/ (2; 5].");
        if (set is null)
            return Common.Fail(e is Statement
                ? "AngouriMath could not solve this for x. Its inequality solver handles polynomials, not abs, sin and the like."
                : "AngouriMath could not simplify this set.");
        return new JsonObject
        {
            ["ok"] = true,
            ["dims"] = 1,
            ["latex"] = Common.Latex(e),
            ["how"] = how,
            ["set"] = set.ToString(),
            ["setLatex"] = Common.Latex(set),
            ["intervals"] = Common.Intervals(set),
            ["ms"] = clock.ElapsedMilliseconds,
        }.ToJsonString();
    }
}
