using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using AngouriMath;
using AngouriMath.Core.Exceptions;
using PeterO.Numbers;
using static AngouriMath.Entity;
using static AngouriMath.Entity.Number;
using BigInteger = System.Numerics.BigInteger;

namespace AmLive;

/// <summary>
/// The numbers demo: arithmetic AngouriMath keeps exact (big integers, fractions, roots, complex
/// numbers), decimals to as many digits as asked, primes, factors and divisors, and other bases.
/// </summary>
public static class Numbers
{
    // The digits to base 36, as AngouriMath's ToBaseN and FromBaseN have them.
    private const string Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    // Past this many digits the exact value is shown cut in the middle, not typeset.
    private const int LongestTypeset = 1500;

    // Past this many digits an integer is not written in other bases: ToBaseN divides the whole
    // number once for each digit it writes, so 3000! takes a second here and 10000! twenty.
    private const int LongestInBases = 10_000;

    public static string Describe(string text, int digits, int numberBase, string otherText)
    {
        var e = Common.Parse(text, out var error);
        if (e is null)
            return Common.Fail(error);
        if (e.Vars.Any())
            return Common.Fail($"Only numbers here; this has {string.Join(", ", Common.VarsOf(e).Select(v => v.Name))}.");
        var value = Common.Try(() => e.Evaled);
        if (value is not Complex z)
            return Common.Fail("This is not a number.");
        // A whole number or a fraction is finite at any size; its decimal is not past 10^1000,
        // where the precision context's exponents end. A complex part past it is an infinity.
        static bool Finite(Real part) => part is Rational || part.EDecimal.IsFinite;
        if (z.IsNaN || !Finite(z.RealPart) || !Finite(z.ImaginaryPart))
            return Common.Fail($"This has no finite value: AngouriMath gives {z}.");

        digits = Math.Clamp(digits, 5, 2000);
        numberBase = Math.Clamp(numberBase, 2, 36);
        var context = new EContext(digits, ERounding.HalfEven, -100_000, 100_000, false);
        T InPrecision<T>(Func<T?> f) where T : class =>
            MathS.Settings.DecimalPrecisionContext.As(context, () => Common.Try(f))!;

        var kind = z switch { Integer => "integer", Rational => "rational", Real => "real", _ => "complex" };
        var o = new JsonObject { ["ok"] = true, ["kind"] = kind };

        // Integers and fractions are already exact; anything else keeps its roots and constants.
        var exact = z is Rational ? z : Common.Try(() => e.Simplify()) ?? e;
        var exactText = exact.ToString();
        static string Cut(string text) => text.Length > LongestTypeset ? $"{text[..80]} … {text[^80..]}" : text;
        o["exactText"] = Cut(exactText);
        o["exactLatex"] = exactText.Length > LongestTypeset ? "" : Common.Latex(exact);
        var length = z is Integer whole ? BigInteger.Abs(Big(whole)).ToString().Length : 0;
        if (length > 0)
            o["length"] = length;

        var numeric = z is Rational ? null : InPrecision(() => e.EvalNumerical());
        var period = 0;
        // A part that is a fraction is written out exactly, as 0.(142857); any other to the precision.
        string Part(Real part) => part is Rational q && q is not Integer
            ? Expansion(Big(q.Numerator), Big(q.Denominator), 10, out _)
            : part.ToString();
        o["decimal"] = z switch
        {
            Integer => o["exactText"]!.GetValue<string>(),
            Rational q => Expansion(Big(q.Numerator), Big(q.Denominator), 10, out period),
            Real => numeric?.ToString() ?? "",
            _ when numeric is { } c => c.ImaginaryPart.EDecimal.IsZero
                ? Part(c.RealPart)
                : $"{Part(c.RealPart)} {(c.ImaginaryPart.EDecimal.IsNegative ? "-" : "+")} {Part((Real)MathS.Abs(c.ImaginaryPart).Evaled)}i",
            _ => "",
        };
        o["period"] = period;

        // Other bases, by AngouriMath's ToBaseN: an integer exactly, shown cut in the middle as its
        // exact value is, and an irrational number cut where the precision ends. A fraction by long
        // division here, with its repeating block in brackets: ToBaseN writes the same digits and
        // cuts them.
        if ((z as Real ?? numeric as Real) is { } real && (z is Rational || real.EDecimal.IsFinite) && length <= LongestInBases)
        {
            var bases = new JsonArray();
            foreach (var b in new[] { 2, 8, 16, numberBase }.Distinct())
                bases.Add(new JsonObject
                {
                    ["base"] = b,
                    ["digits"] = z switch
                    {
                        Integer => Cut(MathS.ToBaseN(real, b)),
                        Rational q => Expansion(Big(q.Numerator), Big(q.Denominator), b, out _),
                        _ => InPrecision(() => MathS.ToBaseN(real, b)) ?? "",
                    },
                    ["exact"] = z is Rational,
                });
            o["bases"] = bases;
        }

        if (z is Integer n)
        {
            // Membership of PP is decided by Miller–Rabin, exact below 3317044064679887385961981,
            // and by Lucas–Lehmer for 2^p - 1; past that a number that passes stays undecided.
            var prime = Common.Try(() => n.In(MathS.Sets.Primes).Evaled);
            o["prime"] = prime is Entity.Boolean b ? (b.Value ? "yes" : "no") : "undecided";
            if (Common.Parse(otherText, out _)?.Evaled is Integer m && !m.EInteger.IsZero)
            {
                var gcd = MathS.NumberTheory.GreatestCommonDivisor(n, m);
                Entity lcm = MathS.Abs(n * m / gcd);
                Entity ratio = (Entity)n / m;
                o["other"] = new JsonObject
                {
                    ["m"] = m.ToString(),
                    ["gcd"] = gcd.ToString(),
                    ["lcm"] = lcm.Evaled.ToString(),
                    ["ratioLatex"] = $"\\frac{{{Common.Latex(n)}}}{{{Common.Latex(m)}}} = {Common.Latex(ratio.Evaled)}",
                };
            }
        }

        if (z is not Real)
        {
            // Exact where simplifying finds the part, as for 1/10 + 7/10 i; where it leaves
            // Re, Im, |z| or arg standing, the value to twelve digits instead.
            var c = z.ToNumerics();
            var (x, y) = (c.Real, c.Imaginary);
            // Past the range of a double the plane draws the direction alone: the parts scaled
            // down together, as (3 + 4i)^450 is.
            if (!double.IsFinite(x) || !double.IsFinite(y))
            {
                var (re, im) = (z.RealPart.EDecimal, z.ImaginaryPart.EDecimal);
                var larger = re.Abs().CompareTo(im.Abs()) >= 0 ? re.Abs() : im.Abs();
                (x, y) = (re.Divide(larger, EContext.Binary64).ToDouble(), im.Divide(larger, EContext.Binary64).ToDouble());
            }
            var parts = new JsonObject { ["x"] = x, ["y"] = y };
            foreach (var (name, part, approx) in new (string, Func<Entity, Entity>, double)[]
                     { ("re", MathS.Re, c.Real), ("im", MathS.Im, c.Imaginary), ("abs", MathS.Abs, c.Magnitude), ("arg", MathS.Arg, Math.Atan2(y, x)) })
            {
                var found = Common.Try(() => part(e).Simplify());
                parts[name] = found is null || found.Nodes.Any(n => n is Ref or Imf or Absf or Argf)
                    ? $@"\approx {approx.ToString("G12", System.Globalization.CultureInfo.InvariantCulture)}"
                    : Common.Latex(found);
            }
            o["complex"] = parts;
        }
        return o.ToJsonString();
    }

    /// <summary>The prime factors of an integer, how many divisors it has and its totient, each by AngouriMath.</summary>
    public static string Factor(string text)
    {
        var clock = Stopwatch.StartNew();
        if (Common.Parse(text, out var error)?.Evaled is not Integer n)
            return Common.Fail(error == "" ? "Only whole numbers have prime factors." : error);
        var size = n.EInteger.Abs();
        if (size.CompareTo(EInteger.FromInt32(2)) < 0)
            return Common.Fail($"{n} has no prime factors.");
        Integer whole = size;
        List<(Integer prime, Integer power)> factors;
        Integer count, totient;
        try
        {
            factors = MathS.NumberTheory.Factorize(whole).ToList();
            count = MathS.NumberTheory.CountDivisors(whole);
            totient = whole.Phi();
        }
        catch (NotSufficientlySupportedException)
        {
            return Common.Fail("AngouriMath did not factor this: past trial division, a factor is neither proven prime by Miller–Rabin nor split by Pollard’s rho.");
        }

        var list = new JsonArray();
        foreach (var (p, k) in factors)
            list.Add(new JsonObject { ["p"] = p.ToString(), ["k"] = k.ToString() });
        var latex = string.Join(@" \cdot ", factors.Select(f => f.power == 1 ? f.prime.ToString() : $"{f.prime}^{{{f.power}}}"));
        var o = new JsonObject
        {
            ["ok"] = true,
            ["factors"] = list,
            ["latex"] = $"{(n.EInteger.Sign < 0 ? "-" : "")}{latex}",
            ["divisorCount"] = count.ToString(),
            ["totient"] = totient.ToString(),
            ["ms"] = clock.ElapsedMilliseconds,
        };
        // Every divisor, from the factors, when there are few enough to list.
        if (Big(count) <= 96)
        {
            var divisors = new List<BigInteger> { 1 };
            foreach (var (p, k) in factors)
            {
                var prime = Big(p);
                divisors = divisors.SelectMany(d => Enumerable.Range(0, (int)Big(k) + 1).Select(i => d * BigInteger.Pow(prime, i))).ToList();
            }
            o["divisors"] = Common.Strings(divisors.Order().Select(d => d.ToString()));
        }
        return o.ToJsonString();
    }

    /// <summary>Digits in a base from 2 to 36 read back as a number, by AngouriMath, which refuses a digit not in the base.</summary>
    public static string FromBase(string digits, int numberBase)
    {
        try
        {
            var value = MathS.FromBaseN(digits.Trim(), numberBase);
            return new JsonObject { ["ok"] = true, ["text"] = value.ToString(), ["latex"] = Common.Latex(value) }.ToJsonString();
        }
        catch (Exception e)
        {
            return Common.Fail(e.Message);
        }
    }

    private static BigInteger Big(Integer n) => BigInteger.Parse(n.EInteger.ToString());

    /// <summary>Whether a fraction with this denominator ends in the base: when every prime of the denominator divides the base.</summary>
    private static bool Terminates(BigInteger denominator, int numberBase)
    {
        var d = BigInteger.Abs(denominator);
        for (var g = BigInteger.GreatestCommonDivisor(d, numberBase); g > 1; g = BigInteger.GreatestCommonDivisor(d, numberBase))
            while (d % g == 0)
                d /= g;
        return d == 1;
    }

    /// <summary>
    /// A fraction written out in the base by long division, with the repeating block in brackets,
    /// as 0.(142857) for 1/7. The block is found when a remainder comes back; past 1000 digits the
    /// expansion is cut.
    /// </summary>
    private static string Expansion(BigInteger numerator, BigInteger denominator, int numberBase, out int period)
    {
        var sign = numerator.Sign * denominator.Sign < 0 ? "-" : "";
        numerator = BigInteger.Abs(numerator);
        denominator = BigInteger.Abs(denominator);
        var whole = BigInteger.DivRem(numerator, denominator, out var remainder);
        var digits = new StringBuilder();
        var seen = new Dictionary<BigInteger, int>();
        period = 0;
        while (remainder != 0 && digits.Length < 1000)
        {
            if (seen.TryGetValue(remainder, out var start))
            {
                period = digits.Length - start;
                digits.Insert(start, '(').Append(')');
                break;
            }
            seen[remainder] = digits.Length;
            var digit = BigInteger.DivRem(remainder * numberBase, denominator, out remainder);
            digits.Append(Alphabet[(int)digit]);
        }
        if (remainder != 0 && period == 0)
            digits.Append('…');
        var integer = new StringBuilder();
        for (var w = whole; ; w /= numberBase)
        {
            integer.Insert(0, Alphabet[(int)(w % numberBase)]);
            if (w < numberBase)
                break;
        }
        return digits.Length == 0 ? $"{sign}{integer}" : $"{sign}{integer}.{digits}";
    }
}
