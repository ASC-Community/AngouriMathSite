using System.Text.Json.Nodes;
using AngouriMath;
using AngouriMath.Core;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>
/// The waves demo: read a formula for a water wave's angular frequency, check its units inside
/// the wave's phase, differentiate the surface, and print it as GLSL (which the page runs) and
/// HLSL (for Unity).
/// </summary>
public static class Waves
{
    private static readonly Dimension L = Dimension.Length, T = Dimension.Time;

    // Amplitude, wavenumber, water depth, gravity, the unit direction of travel, the surface
    // point and time.
    private static readonly Dictionary<Variable, Dimension> Dims = new()
    {
        ["A"] = L, ["k"] = Dimension.Dimensionless / L, ["h"] = L, ["g"] = L / T.Pow(2),
        ["dx"] = Dimension.Dimensionless, ["dz"] = Dimension.Dimensionless,
        ["px"] = L, ["pz"] = L, ["t"] = T,
    };

    private static readonly Dictionary<Variable, string> Names = new()
    {
        ["px"] = "p.x", ["pz"] = "p.y", ["dx"] = "dir.x", ["dz"] = "dir.y", ["g"] = "WAVE_G",
    };

    // The last accepted frequency with g = 9.81, for the page's speed readout and for keeping
    // each wave's phase continuous when the depth or the formula changes.
    private static FastExpression? omegaOfKh;

    public static string Generate(string omegaText)
    {
        var omega = Common.Parse(omegaText, out var error);
        if (omega is null)
            return new JsonObject { ["ok"] = false, ["omega"] = error, ["phase"] = "" }.ToJsonString();

        Entity A = "A", k = "k", g = "g", dx = "dx", dz = "dz", px = "px", pz = "pz", t = "t";
        var omegaCheck = MathS.Dimensions.Of(omega, Dims);
        // omega on its own may be any quantity; inside the phase it has to be a frequency.
        var phase = k * (dx * px + dz * pz) - omega * t;
        var phaseCheck = MathS.Dimensions.Of(phase, Dims);
        var result = new JsonObject { ["omega"] = omegaCheck.ToString(), ["phase"] = phaseCheck.ToString() };
        if (!phaseCheck.IsConsistent || !phaseCheck.Dimension!.IsDimensionless)
        {
            result["ok"] = false;
            result["kind"] = phaseCheck.Status.ToString();
            return result.ToJsonString();
        }

        var height = A * MathS.Sin(phase);
        var outputs = new List<KeyValuePair<string, Entity>>
        {
            new("r.x", height),
            new("r.y", Common.Unconditional(height.Differentiate("px"))),
            new("r.z", Common.Unconditional(height.Differentiate("pz"))),
        };
        var glsl = MathS.Shaders.Glsl(outputs, Names);
        var hlsl = MathS.Shaders.Hlsl(outputs, Names);
        if (!glsl.Succeeded || !hlsl.Succeeded)
        {
            result["ok"] = false;
            result["kind"] = "Declined";
            result["reason"] = (glsl.Succeeded ? hlsl : glsl).ToString();
            return result.ToJsonString();
        }

        // A consistent formula may still use A or t, which the readout does not supply.
        omegaOfKh = Common.TryCompile(omega.Substitute(g, 9.81), "k", "h");
        result["ok"] = true;
        result["glsl"] = $"vec3 waveHeightSlope(vec2 p, float t, float A, float k, float h, vec2 dir)\n{{\n    vec3 r;\n{Common.Body(glsl.Code!)}    return r;\n}}\n";
        result["hlsl"] = $"float3 waveHeightSlope(float2 p, float t, float A, float k, float h, float2 dir)\n{{\n    float3 r;\n{Common.Body(hlsl.Code!)}    return r;\n}}\n";
        return result.ToJsonString();
    }

    /// <summary>The accepted frequency at each wavenumber for depth h, or NaN where it has none.</summary>
    public static double[] Omegas(double[] ks, double h)
    {
        var result = new double[ks.Length];
        for (var i = 0; i < ks.Length; i++)
        {
            var w = omegaOfKh?.Call(ks[i], h);
            result[i] = w is { } c && c.Imaginary == 0 ? c.Real : double.NaN;
        }
        return result;
    }

    public static string[] Groups() =>
        MathS.Dimensions.DimensionlessGroups(new Variable[] { "g", "k", "A", "h", "t" }, Dims)
            .Select(group => group.ToString()).ToArray();
}
