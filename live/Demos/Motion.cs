using System.Diagnostics;
using System.Numerics;
using System.Text.Json.Nodes;
using AngouriMath;
using AngouriMath.Core;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>
/// The motion demo: from a Lagrangian L (kinetic minus potential energy) in one or two
/// coordinates, AngouriMath checks that L is an energy, derives the Euler–Lagrange equations,
/// solves them for the accelerations, and derives the conserved energy. The page then integrates
/// the motion here, and draws the energy's level curves (the phase portrait) on the GPU.
/// </summary>
public static class Motion
{
    private static readonly Dimension M = Dimension.Mass, L = Dimension.Length, T = Dimension.Time;
    private static readonly Dimension Energy = M * L.Pow(2) / T.Pow(2);

    private static readonly Dictionary<Variable, Dimension> ParameterDims = new()
    {
        ["m"] = M, ["m_1"] = M, ["m_2"] = M,
        ["l"] = L, ["l_1"] = L, ["l_2"] = L, ["l_0"] = L,
        ["g"] = L / T.Pow(2), ["k"] = M / T.Pow(2),
    };

    // The mass matrix row by row, then the force vector: M a = F.
    private static FastExpression[] terms = Array.Empty<FastExpression>();
    private static FastExpression? energy;
    private static int dof;

    /// <summary>
    /// Derives the motion. Coordinates are angles or lengths (<paramref name="kinds"/>), each
    /// with its rate of change; parameters are fixed to the given values for the simulation.
    /// </summary>
    public static string Derive(string lagrangian, string[] coords, string[] rates, string[] kinds,
                                string[] parameters, double[] values)
    {
        var clock = Stopwatch.StartNew();
        var lag = Common.Parse(lagrangian, out var error);
        if (lag is null)
            return Common.Fail(error);
        var n = coords.Length;
        var q = coords.Select(c => (Variable)c).ToArray();
        var w = rates.Select(r => (Variable)r).ToArray();

        var dims = new Dictionary<Variable, Dimension>(ParameterDims);
        for (var i = 0; i < n; i++)
        {
            dims[q[i]] = kinds[i] == "length" ? L : Dimension.Dimensionless;
            dims[w[i]] = dims[q[i]] / T;
        }
        var check = MathS.Dimensions.Of(lag, dims);
        if (!check.IsConsistent)
            return Common.Fail($"The units check failed. {check}");
        if (!check.Dimension!.Equals(Energy))
            return Common.Fail($"A Lagrangian is an energy, M L^2 T^-2, but this one has dimension {check.Dimension}.");

        // Euler–Lagrange, d/dt(dL/dw_i) = dL/dq_i, is linear in the accelerations: M a = F, with
        // M_ij = d^2L/dw_i dw_j and F_i = dL/dq_i - sum_j d^2L/dw_i dq_j w_j. The entries stay
        // small enough to simplify; the solved accelerations do not (36 s for the double
        // pendulum), so the 2 by 2 system is solved numerically at every step instead.
        Entity D(Entity e, Variable v) => Common.Unconditional(e.Differentiate(v));
        var momentum = w.Select(r => D(lag, r)).ToArray();
        var mass = new Entity[n, n];
        var force = new Entity[n];
        for (var i = 0; i < n; i++)
        {
            for (var j = 0; j < n; j++)
                mass[i, j] = Tidy(D(momentum[i], w[j]));
            Entity f = D(lag, q[i]);
            for (var j = 0; j < n; j++)
                f -= D(momentum[i], q[j]) * w[j];
            force[i] = Tidy(f);
        }
        Entity hamiltonian = -lag;
        for (var i = 0; i < n; i++)
            hamiltonian += w[i] * momentum[i];
        hamiltonian = Tidy(hamiltonian);

        Entity Numeric(Entity e)
        {
            for (var i = 0; i < parameters.Length; i++)
                e = e.Substitute(parameters[i], values[i]);
            return e;
        }
        var order = q.Concat(w).ToArray();
        var compiled = new FastExpression?[n * n + n];
        for (var i = 0; i < n; i++)
        {
            for (var j = 0; j < n; j++)
                compiled[i * n + j] = Common.TryCompile(Numeric(mass[i, j]), order);
            compiled[n * n + i] = Common.TryCompile(Numeric(force[i]), order);
        }
        var compiledEnergy = Common.TryCompile(Numeric(hamiltonian), order);
        if (compiled.Any(c => c is null) || compiledEnergy is null)
            return Common.Fail("The equations of motion use something the numeric compiler does not support.");
        terms = compiled!;
        energy = compiledEnergy;
        dof = n;

        string Matrix(IEnumerable<IEnumerable<string>> rows) =>
            "\\begin{pmatrix}" + string.Join(" \\\\ ", rows.Select(r => string.Join(" & ", r))) + "\\end{pmatrix}";
        var accelerationsLatex = Matrix(q.Select(v => new[] { $"\\ddot{{{Common.Latex(v)}}}" }));
        var equation = n == 1
            ? $"{Common.Latex(mass[0, 0])} \\, \\ddot{{{Common.Latex(q[0])}}} = {Common.Latex(force[0])}"
            : $"{Matrix(Enumerable.Range(0, n).Select(i => Enumerable.Range(0, n).Select(j => Common.Latex(mass[i, j]))))} " +
              $"{accelerationsLatex} = {Matrix(force.Select(f => new[] { Common.Latex(f) }))}";
        var result = new JsonObject
        {
            ["ok"] = true,
            ["units"] = check.ToString(),
            ["lagrangian"] = Common.Latex(lag),
            ["equation"] = equation,
            ["energy"] = Common.Latex(hamiltonian),
            ["ms"] = clock.ElapsedMilliseconds,
        };
        // As AngouriMath writes a matrix, for the Matrices tab to read back.
        if (n > 1)
            result["mass"] = MathS.Matrix(mass).ToString();
        if (n == 1)
        {
            var source = MathS.Shaders.Glsl(new List<KeyValuePair<string, Entity>> { new("e", Numeric(hamiltonian)) },
                new Dictionary<Variable, string> { [q[0]] = "p.x", [w[0]] = "p.y" });
            if (source.Succeeded)
                result["energyGlsl"] = $"float energy(vec2 p)\n{{\n    float e;\n{Common.Body(source.Code!)}    return e;\n}}\n";
        }
        return result.ToJsonString();
    }

    /// <summary>
    /// Advances every copy of the system (coordinates then rates, copy after copy) by
    /// <paramref name="steps"/> classical Runge–Kutta steps of <paramref name="dt"/>.
    /// </summary>
    public static double[] Step(double[] state, double dt, int steps)
    {
        var s = (double[])state.Clone();
        var size = 2 * dof;
        if (size == 0)
            return s;
        var y = new double[size];
        var k = new double[4][];
        for (var c = 0; c + size <= s.Length; c += size)
        {
            Array.Copy(s, c, y, 0, size);
            for (var step = 0; step < steps; step++)
            {
                k[0] = Rate(y);
                k[1] = Rate(Add(y, k[0], dt / 2));
                k[2] = Rate(Add(y, k[1], dt / 2));
                k[3] = Rate(Add(y, k[2], dt));
                for (var i = 0; i < size; i++)
                    y[i] += dt / 6 * (k[0][i] + 2 * k[1][i] + 2 * k[2][i] + k[3][i]);
            }
            Array.Copy(y, 0, s, c, size);
        }
        return s;
    }

    /// <summary>The conserved energy of every copy.</summary>
    public static double[] Energies(double[] state)
    {
        var size = 2 * dof;
        if (size == 0 || energy is null)
            return Array.Empty<double>();
        var result = new double[state.Length / size];
        for (var c = 0; c < result.Length; c++)
            result[c] = energy.Call(Args(state, c * size, size)).Real;
        return result;
    }

    private static double[] Rate(double[] y)
    {
        var r = new double[y.Length];
        var args = Args(y, 0, y.Length);
        var v = terms.Select(t => t.Call(args).Real).ToArray();
        for (var i = 0; i < dof; i++)
            r[i] = y[dof + i];
        if (dof == 1)
            r[1] = v[1] / v[0];
        else
        {
            // Cramer's rule on M a = F, with M = [v0 v1; v2 v3] and F = [v4 v5].
            var det = v[0] * v[3] - v[1] * v[2];
            r[2] = (v[4] * v[3] - v[1] * v[5]) / det;
            r[3] = (v[0] * v[5] - v[2] * v[4]) / det;
        }
        return r;
    }

    // Simplifies what is small enough to simplify quickly; leaves the rest as derived.
    private static Entity Tidy(Entity e) =>
        e.Nodes.Count() <= 120 ? Common.Try(() => e.Simplify()) ?? e : e;

    private static double[] Add(double[] y, double[] k, double h)
    {
        var r = new double[y.Length];
        for (var i = 0; i < y.Length; i++)
            r[i] = y[i] + h * k[i];
        return r;
    }

    private static Complex[] Args(double[] s, int from, int count)
    {
        var a = new Complex[count];
        for (var i = 0; i < count; i++)
            a[i] = s[from + i];
        return a;
    }
}
