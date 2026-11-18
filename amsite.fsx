open System.Diagnostics
open System
open System.IO
open System.Runtime.InteropServices

let (/) a b = Path.Combine(a, b)

let log msg =
    printfn $"Log: {msg}"

let generatorP = "src"
let outputP = ".output" / "final"
let contentP = "content"

let dirExists path =
    try
        Directory.Exists(path)
    with
    | :? Exception as e ->
        log $"Issue accessing {path}"
        raise e

let dirDelete path =
    try
        // What `uninit` deletes are git clones, and git marks the files under
        // .git/objects/pack read-only. Directory.Delete refuses a read-only file on
        // Windows, so the attribute has to come off first -- otherwise uninit fails with
        // UnauthorizedAccessException on a pack .idx, which is what it did.
        for file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories) do
            File.SetAttributes(file, FileAttributes.Normal)
        Directory.Delete(path, true)
    with
    | :? Exception as e ->
        log $"Issue deleting {path}"
        raise e


let runProgram name activeDir args =
    let startInfo = ProcessStartInfo()
    startInfo.FileName <- name
    startInfo.Arguments <- args
    startInfo.WorkingDirectory <- activeDir
    startInfo.UseShellExecute <- false
    use proc = new Process()
    proc.StartInfo <- startInfo
    if proc.Start() |> not then
        raise (Exception $"Failure to start process {name}. Report this bug, please.")
    proc.WaitForExit()
    if proc.ExitCode <> 0 then
        raise (Exception $"Error of command {name}. Exit code: {proc.ExitCode}.")

let git = runProgram "git"
let dotnet = runProgram "dotnet"

let cliArgs = Environment.GetCommandLineArgs() |> List.ofArray

let init () =
    if dirExists("." / generatorP / "AngouriMath") then
        log "Skipping AngouriMath cloning..."
    else
        git ("." / generatorP) "clone https://github.com/asc-community/AngouriMath AngouriMath" 

    // The library moved up a folder in asc-community/AngouriMath@f0db3eef (2026-01-03), so
    // this was `Sources/AngouriMath/AngouriMath` and had stopped existing. Keep it in step
    // with the path NaiveStaticGenerator reads AngouriMath.xml from.
    dotnet ("." / generatorP / "AngouriMath" / "Sources" / "AngouriMath") "publish -c release -o publish-output --framework netstandard2.0"

    if dirExists("." / generatorP / "Yadg.NET") then
        log "Skipping Yadg.NET cloning..."
    else
        git ("." / generatorP) "clone -c core.autocrlf=false https://github.com/WhiteBlackGoose/Yadg.NET Yadg.NET"
        // Yadg.NET has not changed since 2022 and this repository cannot push to it, so the
        // site carries its fixes in Yadg.NET.patch, at the commit the patch was written against.
        // The clone keeps LF line endings on Windows too, as the patch has them.
        git ("." / generatorP / "Yadg.NET") "checkout --quiet a79a053df06a2a87d4fc6fac84dd5e81cecc11f6"
        git ("." / generatorP / "Yadg.NET") "apply ../Yadg.NET.patch"

    if dirExists("." / generatorP / contentP / "_wiki") then
        log "Skipping wiki cloning..."
    else
        git ("." / generatorP / contentP) "clone https://github.com/asc-community/AngouriMath.wiki.git _wiki"


let uninit () =
    if dirExists("." / generatorP / "AngouriMath") |> not then
        log "Skipping deleting AngouriMath..."
    else
        dirDelete("." / generatorP / "AngouriMath") 

    if dirExists("." / generatorP / "Yadg.NET") |> not then
        log "Skipping deleting Yadg.NET..."
    else
        dirDelete("." / generatorP / "Yadg.NET")

    if dirExists("." / generatorP / contentP / "_wiki") |> not then
        log "Skipping deleting wiki..."
    else
        dirDelete("." / generatorP / contentP / "_wiki") 

// AngouriMath Live, the app in live/: the library in the browser as WebAssembly. It is published
// and copied to /live, after the generator, which writes the rest of .output/final. The runtime's
// precompressed .br and .gz copies are left out, since GitHub Pages compresses what it serves itself;
// what is left is the files dotnet.js loads. Its _framework folder is copied as framework, the name
// the page's worker imports dotnet.js by: a host that drops names starting with '_' cannot lose it,
// and dotnet.js finds the rest relative to its own URL.
let buildLive () =
    let published = "." / ".output" / "live"
    dotnet "live" $"publish -c Release -o {Path.GetFullPath published}"
    let source = published / "wwwroot"
    let target = "." / outputP / "live"
    if dirExists target then dirDelete target
    for file in Directory.GetFiles(source, "*", SearchOption.AllDirectories) do
        if not (file.EndsWith ".br" || file.EndsWith ".gz") then
            let relative = Path.GetRelativePath(source, file)
            let relative =
                if relative.StartsWith("_framework" + string Path.DirectorySeparatorChar) then relative.Substring 1
                else relative
            let destination = target / relative
            Directory.CreateDirectory(Path.GetDirectoryName destination) |> ignore
            File.Copy(file, destination, true)

let build () =
    dotnet (generatorP / "NaiveStaticGenerator") "run"
    buildLive ()

let run () =
    if RuntimeInformation.IsOSPlatform(OSPlatform.Windows) then
        runProgram "start" "." ("." / outputP / "index.html")
    else if RuntimeInformation.IsOSPlatform(OSPlatform.OSX) then
        runProgram "open" "." ("." / outputP / "index.html")
    else if RuntimeInformation.IsOSPlatform(OSPlatform.Linux) then
        runProgram "xdg-open" "." ("." / outputP / "index.html")

// All of .output, not only final: the generator copies every page in .output/pre into final,
// so a page an older build wrote to pre -- one for a member the library has since removed --
// came back after a clean, with whatever broken links it had.
let clean () =
    dirDelete ("." / ".output")

match cliArgs with
| [ _; _; "init" ] -> init ()
| [ _; _; "uninit" ] -> uninit ()
| [ _; _; "build" ] -> build ()
| [ _; _; "run" ] ->
    build ()
    run ()
| [ _; _; "clean" ] -> clean ()
| _ ->
    log $"Unrecognized arguments: {cliArgs}"




