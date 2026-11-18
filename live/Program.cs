using System.Runtime.InteropServices.JavaScript;

[assembly: System.Runtime.Versioning.SupportedOSPlatform("browser")]

// The page's worker drives everything through the exports below; each returns JSON or numbers.
Console.WriteLine("AngouriMath is running in WebAssembly.");

namespace AmLive
{
    public static partial class WavesJs
    {
        [JSExport] internal static string Generate(string omega) => Waves.Generate(omega);
        [JSExport] internal static double[] Omegas(double[] k, double h) => Waves.Omegas(k, h);
        [JSExport] internal static string[] Groups() => Waves.Groups();
    }

    public static partial class RepresentationsJs
    {
        [JSExport] internal static string Describe(string text) => Representations.Describe(text);
        [JSExport] internal static double[] Sample(double from, double to, int n) => Representations.Sample(from, to, n);
        [JSExport] internal static string Compare(string left, string right) => Representations.Compare(left, right);
    }

    public static partial class ShapesJs
    {
        [JSExport] internal static string Generate(string text) => Shapes.Generate(text);
    }

    public static partial class CalculusJs
    {
        [JSExport] internal static string Analyze(string text) => Calculus.Analyze(text);
        [JSExport] internal static string Taylor(string text, double a) => Calculus.Taylor(text, a);
        [JSExport] internal static double[] Sample(double from, double to, int n, int order) => Calculus.Sample(from, to, n, order);
        [JSExport] internal static string Area(double a, double b) => Calculus.Area(a, b);
        [JSExport] internal static string Limits(string text) => Calculus.Limits(text);
        [JSExport] internal static string LimitAt(string text, string at) => Calculus.LimitAt(text, at);
    }

    public static partial class LogicJs
    {
        [JSExport] internal static string Analyze(string text) => Logic.Analyze(text);
        [JSExport] internal static string Venn(string text) => Logic.Venn(text);
        [JSExport] internal static string Senses(string text, string always) => AmLive.Senses.Analyze(text, always);
        [JSExport] internal static string SenseCatalogue() => AmLive.Senses.Reference();
    }

    public static partial class RegionsJs
    {
        [JSExport] internal static string Analyze(string text) => Regions.Analyze(text);
    }

    public static partial class NumbersJs
    {
        [JSExport]
        internal static string Describe(string text, int digits, int numberBase, string other) =>
            Numbers.Describe(text, digits, numberBase, other);

        [JSExport] internal static string Factor(string text) => Numbers.Factor(text);
        [JSExport] internal static string FromBase(string digits, int numberBase) => Numbers.FromBase(digits, numberBase);
    }

    public static partial class MatricesJs
    {
        [JSExport] internal static string Analyze(string a, string b) => Matrices.Analyze(a, b);
        [JSExport] internal static string Power(int n) => Matrices.Power(n);
    }

    public static partial class MotionJs
    {
        [JSExport]
        internal static string Derive(string lagrangian, string[] coords, string[] rates, string[] kinds,
                                      string[] parameters, double[] values) =>
            Motion.Derive(lagrangian, coords, rates, kinds, parameters, values);

        [JSExport] internal static double[] Step(double[] state, double dt, int steps) => Motion.Step(state, dt, steps);
        [JSExport] internal static double[] Energies(double[] state) => Motion.Energies(state);
    }
}
