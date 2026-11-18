using System.Text.Json.Nodes;
using AngouriMath;
using static AngouriMath.Entity;

namespace AmLive;

/// <summary>
/// The matrices demo: a matrix written as AngouriMath reads it, [[1, 2], [3, 4]], and what the
/// library gives for it: the transpose, determinant, trace, rank, inverse and reduced row echelon
/// form; the characteristic polynomial det(A - λI) and its roots, the eigenvalues; and each
/// eigenvalue's eigenvectors, read off the reduced row echelon form of A - λI. With a second
/// matrix, the product and the tensor product.
/// </summary>
public static class Matrices
{
    private const int Largest = 6;
    private static readonly Variable Lambda = "lambda";
    private static Matrix? last;

    public static string Analyze(string aText, string bText)
    {
        var a = Read(aText, "A", out var error);
        if (a is null)
            return Common.Fail(error);
        last = a;
        var numeric = !a.Vars.Any();
        var o = new JsonObject
        {
            ["ok"] = true,
            ["latex"] = Common.Latex(a),
            ["text"] = a.ToString(),
            ["rows"] = a.RowCount,
            ["cols"] = a.ColumnCount,
            ["numeric"] = numeric,
            ["transpose"] = Common.Latex(a.T),
        };
        try
        {
            o["rank"] = a.Rank;
        }
        catch (Exception)
        {
        }
        // With letters, for their values in general: a pivot that is a formula is divided by, and
        // the conditions that come with it are stated.
        var rrefConditions = new HashSet<string>();
        o["rref"] = Common.Latex(Common.Try(() => Tidy(a.ReducedRowEchelonForm, rrefConditions)));
        o["rrefConditions"] = Common.Strings(rrefConditions);

        if (a.IsSquare)
        {
            var determinant = Common.Try(() => a.Determinant?.Simplify());
            o["det"] = Common.Latex(determinant);
            o["trace"] = Common.Latex(Common.Try(() => a.Trace.Simplify()));
            var conditions = new HashSet<string>();
            var inverse = Common.Try(() => a.Inverse is { } inv ? Tidy(inv, conditions) : null);
            o["inverse"] = Common.Latex(inverse);
            o["inverseConditions"] = Common.Strings(conditions);
            Eigen(a, numeric, o);
        }
        if (a.RowCount == 2 && a.ColumnCount == 2 && numeric)
            o["entries"] = Common.Numbers(new[] { a[0, 0], a[0, 1], a[1, 0], a[1, 1] }.Select(x => Common.Real(x) ?? double.NaN));

        if (!string.IsNullOrWhiteSpace(bText))
        {
            var b = Read(bText, "B", out var bError);
            if (b is null)
                o["bError"] = bError;
            else
            {
                o["b"] = Common.Latex(b);
                if (a.ColumnCount == b.RowCount)
                    o["product"] = Common.Latex(Common.Try(() => ((Entity)a * b).Evaled is Matrix p ? Tidy(p) : null));
                else
                    o["productNote"] = $"A has {a.ColumnCount} columns and B has {b.RowCount} rows, so A B is not defined.";
                o["tensor"] = Common.Latex(Common.Try(() => Tidy(Matrix.TensorProduct(a, b))));
            }
        }
        return o.ToJsonString();
    }

    /// <summary>The last matrix to the power n; a negative power goes through the inverse.</summary>
    public static string Power(int n)
    {
        if (last is null || !last.IsSquare)
            return Common.Fail("Powers are of square matrices.");
        var power = Common.Try(() => MathS.Pow(last, n).Evaled is Matrix p ? Tidy(p) : null);
        return power is null
            ? Common.Fail(n < 0 ? "This matrix has no inverse, so no negative powers." : "AngouriMath did not find this power.")
            : new JsonObject { ["ok"] = true, ["latex"] = Common.Latex(power) }.ToJsonString();
    }

    /// <summary>The matrix the text is, or evaluates to (jacobian(...) and hessian(...) do).</summary>
    private static Matrix? Read(string text, string name, out string error)
    {
        var e = Common.Parse(text, out error);
        if (e is null)
            return null;
        var m = e as Matrix ?? Common.Try(() => e.Evaled) as Matrix;
        if (m is null)
        {
            error = $"Write {name} row by row, as [[1, 2], [3, 4]].";
            return null;
        }
        if (m.RowCount > Largest || m.ColumnCount > Largest)
        {
            error = $"{name} is {m.RowCount} by {m.ColumnCount}; this page takes up to {Largest} by {Largest}.";
            return null;
        }
        // jacobian and hessian leave their derivatives to be taken.
        return m.Nodes.Any(n => n is Derivativef) ? Tidy(m) : m;
    }

    /// <summary>
    /// The characteristic polynomial, its roots, and for a matrix of numbers each eigenvalue's
    /// eigenvectors: the null space of A - λI, one vector per column without a pivot in its
    /// reduced row echelon form.
    /// </summary>
    private static void Eigen(Matrix a, bool numeric, JsonObject o)
    {
        var shifted = a.With((i, j, e) => i == j ? e - Lambda : e);
        var polynomial = Common.Try(() => shifted.Determinant?.Simplify());
        if (polynomial is null)
            return;
        o["charpoly"] = Common.Latex(polynomial);
        // Past 2 by 2 the roots of a polynomial with letters in it are pages long.
        if (!numeric && a.RowCount > 2)
            return;
        if (Common.Try(() => polynomial.SolveEquation(Lambda)) is not Entity.Set.FiniteSet roots)
            return;
        var eigen = new JsonArray();
        foreach (var root in roots)
        {
            var value = Common.Try(() => root.Simplify()) ?? root;
            var full = Common.Latex(value);
            var latex = Short(value);
            var item = new JsonObject { ["latex"] = latex };
            if (numeric)
            {
                var number = Common.Try(() => value.EvalNumerical());
                var c = number?.ToNumerics();
                item["approx"] = c is { } w ? Approx(w) : "";
                item["re"] = c?.Real;
                item["im"] = c?.Imaginary;
                var vectors = new JsonArray();
                // A root of a cubic comes by Cardano's formula, through cube roots, and eliminating
                // with it exactly takes seconds; its eigenvectors are found from its value instead.
                var exact = latex != "" && !full.Contains(@"\sqrt[");
                Entity? at = exact ? value : number;
                var reduced = at is null ? null : Common.Try(() =>
                {
                    var m = shifted.With((i, j, e) => e.Substitute(Lambda, at));
                    return exact ? Tidy(Tidy(m).ReducedRowEchelonForm) : m.With((i, j, e) => e.Evaled).ReducedRowEchelonForm;
                });
                if (reduced is not null)
                    foreach (var v in NullSpace(reduced))
                    {
                        var parts = v.Select(x => Common.Try(() => x.EvalNumerical())).ToList();
                        vectors.Add(new JsonObject
                        {
                            ["latex"] = exact ? Short(MathS.Vector(v)) : "",
                            ["numeric"] = parts.All(p => p is not null && Math.Abs(p.ToNumerics().Imaginary) < 1e-12)
                                ? Common.Numbers(parts.Select(p => p!.ToNumerics().Real))
                                : null,
                        });
                    }
                item["vectors"] = vectors;
            }
            eigen.Add(item);
        }
        o["eigen"] = eigen;
    }

    private static List<Entity[]> NullSpace(Matrix reduced)
    {
        var n = reduced.ColumnCount;
        var pivots = new List<(int Row, int Column)>();
        for (var r = 0; r < reduced.RowCount; r++)
            for (var c = 0; c < n; c++)
                if (!IsZero(reduced[r, c]))
                {
                    pivots.Add((r, c));
                    break;
                }
        var vectors = new List<Entity[]>();
        for (var free = 0; free < n; free++)
        {
            if (pivots.Any(p => p.Column == free))
                continue;
            var v = Enumerable.Repeat((Entity)0, n).ToArray();
            v[free] = 1;
            foreach (var (row, column) in pivots)
                v[column] = Common.Try(() => (-reduced[row, free]).Simplify()) ?? -reduced[row, free];
            vectors.Add(v);
        }
        return vectors;
    }

    private static bool IsZero(Entity e)
    {
        try
        {
            return e.EvalNumerical().ToNumerics().Magnitude < 1e-9;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>
    /// Simplified entry by entry. A condition an entry comes with ("provided not a = 0") is taken
    /// off and collected, so that the matrix reads plainly and its conditions are stated once.
    /// </summary>
    private static Matrix Tidy(Matrix m, HashSet<string>? conditions = null) =>
        m.With((i, j, e) =>
        {
            var s = Common.Try(() => e.Simplify()) ?? e;
            if (s is Providedf p)
            {
                conditions?.Add(Common.Latex(p.Predicate));
                return p.Expression;
            }
            return s;
        });

    // Cubic roots by Cardano's formula run to pages; past this a numeric value stands in.
    private static string Short(Entity e)
    {
        var latex = Common.Latex(e);
        return latex.Length <= 400 ? latex : "";
    }

    private static string Approx(System.Numerics.Complex c)
    {
        static string F(double x) => Math.Round(x, 6).ToString("0.######", System.Globalization.CultureInfo.InvariantCulture);
        if (Math.Abs(c.Imaginary) < 1e-12)
            return F(c.Real);
        var imaginary = Math.Abs(c.Imaginary) == 1 ? "i" : $"{F(Math.Abs(c.Imaginary))}i";
        if (Math.Abs(c.Real) < 1e-12)
            return c.Imaginary < 0 ? $"-{imaginary}" : imaginary;
        return $"{F(c.Real)} {(c.Imaginary < 0 ? "-" : "+")} {imaginary}";
    }
}
