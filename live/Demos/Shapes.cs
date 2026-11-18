using System.Diagnostics;
using System.Text.Json.Nodes;
using AngouriMath;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>
/// The shapes demo: a surface given as f(x, y, z) = 0. AngouriMath differentiates it twice, and
/// the page ray-marches it with the exact gradient (so any implicit surface can be marched, not
/// only distance fields) and colours it by curvature from the exact Hessian.
/// </summary>
public static class Shapes
{
    private static readonly Variable[] Xyz = { "x", "y", "z" };

    private static readonly Dictionary<Variable, string> Names = new()
    {
        ["x"] = "p.x", ["y"] = "p.y", ["z"] = "p.z",
    };

    public static string Generate(string text)
    {
        var clock = Stopwatch.StartNew();
        var f = Common.Parse(text, out var error);
        if (f is null)
            return Common.Fail(error);
        var stray = f.Vars.Where(v => !Xyz.Contains(v)).Select(v => v.Name).ToList();
        if (stray.Count > 0)
            return Common.Fail($"Use only x, y and z. This formula also has {string.Join(", ", stray)}.");

        var g = Xyz.Select(v => Common.Unconditional(f.Differentiate(v))).ToArray();
        Entity H(int i, int j) => Common.Unconditional(g[i].Differentiate(Xyz[j]));
        var value = new List<KeyValuePair<string, Entity>> { new("v", f) };
        var gradient = new List<KeyValuePair<string, Entity>>
        {
            new("r.x", f), new("r.y", g[0]), new("r.z", g[1]), new("r.w", g[2]),
        };
        var hessian = new List<KeyValuePair<string, Entity>>
        {
            new("Hd.x", H(0, 0)), new("Hd.y", H(1, 1)), new("Hd.z", H(2, 2)),
            new("Ho.x", H(0, 1)), new("Ho.y", H(0, 2)), new("Ho.z", H(1, 2)),
        };

        var glsl = new[] { value, gradient, hessian }.Select(o => MathS.Shaders.Glsl(o, Names)).ToArray();
        var hlsl = new[] { value, gradient, hessian }.Select(o => MathS.Shaders.Hlsl(o, Names)).ToArray();
        var declined = glsl.Concat(hlsl).FirstOrDefault(s => !s.Succeeded);
        if (declined is not null)
        {
            var reason = declined.ToString();
            if (f.Nodes.Any(n => n is Maxf or Minf))
                reason += " AngouriMath cannot differentiate max or min; a smooth version works, such as log(e^(8 a) + e^(8 b)) / 8 for max(a, b).";
            return Common.Fail(reason);
        }

        var glslSource =
            $"float field(vec3 p)\n{{\n    float v;\n{Common.Body(glsl[0].Code!)}    return v;\n}}\n\n" +
            $"vec4 fieldGrad(vec3 p)\n{{\n    vec4 r;\n{Common.Body(glsl[1].Code!)}    return r;\n}}\n\n" +
            $"void fieldHess(vec3 p, out vec3 Hd, out vec3 Ho)\n{{\n{Common.Body(glsl[2].Code!)}}}\n";
        var hlslSource =
            $"float field(float3 p)\n{{\n    float v;\n{Common.Body(hlsl[0].Code!)}    return v;\n}}\n\n" +
            $"float4 fieldGrad(float3 p)\n{{\n    float4 r;\n{Common.Body(hlsl[1].Code!)}    return r;\n}}\n\n" +
            $"void fieldHess(float3 p, out float3 Hd, out float3 Ho)\n{{\n{Common.Body(hlsl[2].Code!)}}}\n";
        return new JsonObject
        {
            ["ok"] = true,
            ["glsl"] = glslSource,
            ["hlsl"] = hlslSource,
            ["latex"] = Common.Latex(f),
            ["gradient"] = Common.Strings(g.Select(d => d.ToString())),
            ["ms"] = clock.ElapsedMilliseconds,
        }.ToJsonString();
    }
}
