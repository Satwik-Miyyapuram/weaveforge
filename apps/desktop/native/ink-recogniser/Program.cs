// The Windows Ink recogniser, as a helper process (§5.3 of the ink notes plan).
//
// It reads one JSON object per line on stdin and writes one per line on stdout.
// Everything about *why* it is an executable rather than a native addon is in
// InkRecogniser.csproj; what this file is responsible for is the protocol, and
// the protocol is deliberately boring:
//
//   in   {"id":1,"type":"recognise","lines":[{"strokes":[[x,y,p,x,y,p,...]]}],
//         "vocabulary":["Graph-prior module"],"lang":"en-US"}
//   out  {"id":1,"type":"recognised","engine":"windows-ink@1",
//         "lines":[{"text":"...","confidence":1,"alternatives":["..."]}],"ms":7}
//
//   in   {"id":2,"type":"haptics-probe"}
//   out  {"id":2,"type":"haptics","available":true,"device":"pen 3 at pointer 5"}
//        (`available` is the OS having the API; `device` is set only if a haptic
//        pen was in range at that moment, and is a diagnostic, not a condition)
//
//   in   {"type":"haptics-tool","tool":"pen"}            (no answer)
//   in   {"type":"haptics-update","pressure":0.6,"velocity":0.9}
//   in   {"type":"haptics-stop"}
//
//   in   {"type":"quit"}
//   out  (exit)
//
// The haptics messages (ink-native-bridges.md §4, PenHapticsEngine.cs) carry no
// id and get no answer: they arrive at up to 120 Hz during a stroke, and a reply
// per sample would be the pipe's whole bandwidth. Only the probe answers.
//
// and, once at startup, {"type":"ready","engine":"windows-ink@1","version":"..."}.
//
// Four things about the recognition are worth knowing before reading it:
//
//   1. `InkAnalyzer` is the OS's own engine, offline and already installed. It
//      consumes the *trajectory* — x, y, pressure — rather than a bitmap, which is
//      the whole reason it works a page in milliseconds rather than needing
//      240–330 MB of image model and 6–20 seconds a page.
//   2. **It exposes no confidence score.** There is no per-line number to map into
//      [0,1]; the honest report is `1` for a line the analyser produced text for
//      and `0` for one it did not, with `TextAlternates` carried through as the
//      alternatives. §5.4's "map each engine's score" is therefore a no-op for
//      this engine, which is recorded here rather than papered over with an
//      invented number that would make the correction UI lie.
//   3. **It takes no vocabulary hints either.** §5.4 says "Windows Ink accepts a
//      word list as a recognition guide"; `InkAnalyzer` and
//      `InkRecognizerContainer` expose no such parameter. The fields are still on
//      the wire, because the engine interface is engine-agnostic and a future
//      engine may use them, but this one ignores them — which is why §5.4's
//      post-match against known titles is the only path that helps here, not a
//      fallback for engines that cannot.
//   4. Strokes arrive in tenths of a millimetre and are handed to WinRT in
//      device-independent pixels, the unit its recogniser works in: the
//      conversion divides by ten (0.1 mm → 1 DIP at 96 dpi).

using System.Numerics;
using System.Text;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Text.Json.Serialization;
using Windows.Foundation;
using Windows.UI.Input.Inking;
using Windows.UI.Input.Inking.Analysis;

namespace WeaveForge.InkRecogniser;

internal static class Program
{
    private const string EngineId = "windows-ink@1";

    /// <summary>One point per tenth of a millimetre: x, y, pressure.</summary>
    private const int Stride = 3;

    /// <summary>Points one stroke may hold. Past this it is a clock, not a pen.</summary>
    private const int MaxPointsPerStroke = 100_000;

    /// <summary>The pen's actuator, when the pen has one. See PenHapticsEngine.cs.</summary>
    private static readonly PenHapticsEngine Haptics = new();

    /// <summary>
    /// The whole program runs on one STA thread, and that is not a detail.
    ///
    /// WinRT objects belong to an apartment. A console app's main thread is MTA by
    /// default and an `async` `Main` resumes its continuations on thread-pool
    /// threads, so `InkAnalyzer` and `InkRecognizerContainer` ended up created in
    /// one apartment and released in another — which does not throw, it
    /// **fail-fasts** the process with `0xC0000409` *after* the answers have been
    /// written. The client saw correct recognition followed by a crash.
    ///
    /// So: one dedicated STA thread, synchronous throughout, and `AnalyzeAsync`
    /// blocked on with `AsTask()` rather than awaited. Verified by the exit code
    /// in the contract test, which is the only place this is visible.
    /// </summary>
    [STAThread]
    private static int Main()
    {
        var finished = new ManualResetEventSlim(false);
        var thread = new Thread(() =>
        {
            try
            {
                Run();
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"ink-recogniser: {error}");
            }
            finally
            {
                finished.Set();
            }
        });
        try
        {
            // Windows-only, which this project's target framework already says.
            thread.SetApartmentState(ApartmentState.STA);
        }
        catch (PlatformNotSupportedException)
        {
            // Not a reason to refuse to run: the analyser will fail on its own if
            // there is no apartment to give it.
        }
        thread.Start();
        finished.Wait();
        return 0;
    }

    /// <summary>The request loop: one line in, one line out, until stdin ends.</summary>
    private static void Run()
    {
        // UTF-8 both ways with no BOM, and the text layer is not ASCII: β and §
        // have to survive, and a console on the ANSI code page would mangle them.
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);

        Write(Serialize(new ReadyResponse("ready", EngineId, Describe())));

        string? line;
        while ((line = Console.In.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            string? response;
            try
            {
                response = Handle(line);
            }
            catch (Exception error)
            {
                // A failure is answered rather than thrown: the client is waiting
                // on a line, and a process that dies silently looks like a hang.
                response = Serialize(new ErrorResponse("error", error.Message, null));
            }
            if (response is null) break; // quit
            if (response.Length > 0) Write(response);
        }
        Stop(0);
    }

    /// <summary>
    /// End the process the hard way, because the polite way crashes on this stack.
    ///
    /// Windows Ink's own objects — an `InkStroke` graph, an analysis result — make
    /// the process **fail-fast with `0xC0000409` while it shuts down**, after every
    /// answer has been written and flushed. Isolated with controls, in this order:
    ///
    /// | Program | Exit |
    /// | --- | --- |
    /// | a trivial .NET console app | 0 |
    /// | + `InkAnalyzer` + `AnalyzeAsync`, one stroke | 0 |
    /// | + a page's worth of strokes and the tree walk | **`0xC0000409`** |
    /// | the same, with `GC.Collect()` + `WaitForPendingFinalizers()` before the end | **0**, then `0xC0000409` at teardown |
    /// | the same, ending with `TerminateProcess(GetCurrentProcess(), 0)` | 0 |
    ///
    /// So collecting the objects is safe, returning from `Main` is safe even, and
    /// *terminating* is where it dies — and `Environment.Exit(0)` does not avoid it
    /// because that still runs DLL detach. `TerminateProcess` does not, and exits 0.
    ///
    /// This matters because the client reads the exit code: without it the app would
    /// see correct recognition followed by "the helper crashed", restart a process
    /// that was working, and raise a Windows Error Reporting event every time a page
    /// was recognised. It is a workaround for a teardown bug rather than a symptom
    /// of a live one — nothing here is lost except the runtime's own cleanup of
    /// objects the process is about to discard anyway — and it is the kind of thing
    /// that should be deleted the moment a Windows update stops needing it.
    /// </summary>
    private static void Stop(int code)
    {
        Console.Out.Flush();
        if (OperatingSystem.IsWindows())
        {
            TerminateProcess(GetCurrentProcess(), (uint)code);
        }
        Environment.Exit(code);
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll")]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    /// <summary>
    /// Serialize through the source-generated context, not reflection.
    ///
    /// `PublishTrimmed` turns reflection-based serialization *off* — the runtime
    /// refuses it outright rather than trimming a path that would fail later — so
    /// a trimmed helper must generate its serializers at compile time. That is the
    /// right trade for a program this small anyway: the context is the schema, and
    /// a field renamed on one side fails the build on the other.
    /// </summary>
    private static string Serialize<T>(T value) =>
        JsonSerializer.Serialize(value, typeof(T), InkJsonContext.Default);

    private static void Write(string line)
    {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }

    /// <summary>
    /// Handle one request line: the answer, `""` for a message that gets none, or
    /// null when the caller asked to quit.
    /// </summary>
    private static string? Handle(string line)
    {
        using var document = JsonDocument.Parse(line);
        var root = document.RootElement;
        var id = root.TryGetProperty("id", out var idElement) && idElement.TryGetInt32(out var parsed)
            ? parsed
            : (int?)null;
        var type = root.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : null;

        switch (type)
        {
            case "quit":
                return null;
            case "ping":
                return Serialize(new ReadyResponse("ready", EngineId, Describe(), id));
            case "recognise":
                return Recognise(root, id);
            case "haptics-probe":
                return Serialize(new HapticsResponse("haptics", Haptics.Probe(), Haptics.Device, id));
            case "haptics-tool":
                Haptics.SetTool(root.TryGetProperty("tool", out var tool) ? tool.GetString() ?? "pen" : "pen");
                return string.Empty;
            case "haptics-update":
                Haptics.Update(Number(root, "pressure"), Number(root, "velocity"));
                return string.Empty;
            case "haptics-stop":
                Haptics.Stop();
                return string.Empty;
            default:
                return Serialize(new ErrorResponse("error", $"unknown request type {type ?? "(none)"}", id));
        }
    }

    /// <summary>
    /// Recognise one page's lines.
    ///
    /// Every requested line's strokes go in together, each tagged with its own id
    /// so the answer can be mapped back exactly: `InkAnalysisNode.GetStrokeIds()`
    /// returns the ids of the strokes under a node, which is the mapping the text
    /// layer needs and is not a guess from bounding boxes. The analyser is the OS's
    /// and does its own line finding, so a requested line whose strokes it merges
    /// or splits comes back joined — one paragraph per line is what the note's text
    /// layer is, and the engine's finer segmentation is not what the writer asked
    /// for.
    /// </summary>
    private static string Recognise(JsonElement root, int? id)
    {
        var started = Environment.TickCount64;
        var request = JsonSerializer.Deserialize(root.GetRawText(), InkJsonContext.Default.RecogniseRequest);
        var requested = request?.Lines ?? [];
        if (requested.Count == 0)
        {
            return Serialize(new RecognisedResponse("recognised", EngineId, [], Elapsed(started), id));
        }

        var builder = new InkStrokeBuilder();
        var strokes = new List<InkStroke>();
        // The id the builder assigned, mapped to the line the caller sent it in.
        // `InkStroke.Id` is read-only and the builder numbers strokes from 1, but
        // reading it back rather than assuming the sequence means the mapping
        // cannot drift if that ever changes.
        var ownerOfStroke = new Dictionary<uint, int>();
        for (var index = 0; index < requested.Count; index++)
        {
            foreach (var flat in requested[index].Strokes ?? [])
            {
                if (flat.Length < Stride * 2) continue;
                var points = new List<InkPoint>(Math.Min(flat.Length / Stride, MaxPointsPerStroke));
                for (var at = 0; at + Stride <= flat.Length && points.Count < MaxPointsPerStroke; at += Stride)
                {
                    points.Add(new InkPoint(
                        new Point(flat[at] / 10.0, flat[at + 1] / 10.0),
                        (float)Math.Clamp(flat[at + 2] / 255.0, 0f, 1f)));
                }
                if (points.Count < 2) continue;
                var stroke = builder.CreateStrokeFromInkPoints(points, Matrix3x2.Identity);
                strokes.Add(stroke);
                ownerOfStroke[stroke.Id] = index;
            }
        }

        var lines = EmptyLines(requested.Count);
        if (strokes.Count > 0)
        {
            var analyzer = new InkAnalyzer();
            analyzer.AddDataForStrokes(strokes);
            // Blocking rather than awaiting: this thread is the apartment, and
            // `AsTask()` runs the operation's completion on the thread pool, so
            // there is nothing for this thread to pump. See `Main`.
            var result = analyzer.AnalyzeAsync().AsTask().GetAwaiter().GetResult();
            if (result.Status == InkAnalysisStatus.Updated)
            {
                var text = new List<string>[requested.Count];
                var alternatives = new List<string>[requested.Count];
                // A recursive walk over `Children`, because the analysis root is a
                // tree and the lines are leaves under it: a page of handwriting
                // comes back as `InkDrawing` or `InkWritingRegion` → `InkLine` →
                // `InkWord`s, and which of those wrappers appear depends on what
                // the engine made of the page. `Children` is null on a leaf.
                foreach (var line in AnalysisLines(analyzer.AnalysisRoot))
                {
                    var said = line.RecognizedText ?? string.Empty;
                    // An analysis line's text belongs to each requested line
                    // that owns one of its strokes — once per owner, not once
                    // per stroke, or a three-stroke word comes back three times.
                    var owners = new HashSet<int>();
                    foreach (var strokeId in line.GetStrokeIds())
                    {
                        if (ownerOfStroke.TryGetValue(strokeId, out var owner)) owners.Add(owner);
                    }
                    foreach (var owner in owners)
                    {
                        if (said.Length > 0) (text[owner] ??= []).Add(said);
                        foreach (var alternate in Alternatives(line))
                        {
                            var found = alternatives[owner] ??= [];
                            if (!found.Contains(alternate)) found.Add(alternate);
                        }
                    }
                }
                for (var index = 0; index < requested.Count; index++)
                {
                    var said = text[index];
                    if (said is not { Count: > 0 }) continue;
                    var found = alternatives[index];
                    lines[index] = new RecognisedLine(
                        string.Join(" ", said),
                        // No score exists; `1` is "the engine produced text for
                        // this line", not a measurement. See the note at the top.
                        1,
                        found is { Count: > 0 } ? found.GetRange(0, Math.Min(4, found.Count)) : null);
                }
            }
        }

        return Serialize(new RecognisedResponse("recognised", EngineId, lines, Elapsed(started), id));
    }

    /// <summary>Every recognised line in the analysis tree, depth-first.</summary>
    private static IEnumerable<InkAnalysisLine> AnalysisLines(IInkAnalysisNode root)
    {
        foreach (var child in root.Children ?? [])
        {
            if (child is InkAnalysisLine line)
            {
                yield return line;
                continue;
            }
            foreach (var nested in AnalysisLines(child)) yield return nested;
        }
    }

    /// <summary>
    /// Every other reading the engine offered for a line's words.
    ///
    /// The line's own children are the words; `FindNodes` exists on the analysis
    /// *root*, not on a node, so this walks the same tree the lines came from.
    /// </summary>
    private static List<string> Alternatives(InkAnalysisLine line)
    {
        var found = new List<string>();
        foreach (var child in line.Children ?? [])
        {
            if (child is not InkAnalysisInkWord word) continue;
            foreach (var alternate in word.TextAlternates ?? [])
            {
                if (!string.IsNullOrWhiteSpace(alternate) && !found.Contains(alternate)) found.Add(alternate);
            }
        }
        return found;
    }

    private static List<RecognisedLine> EmptyLines(int count)
    {
        var lines = new List<RecognisedLine>(count);
        for (var index = 0; index < count; index++) lines.Add(new RecognisedLine(string.Empty, 0, null));
        return lines;
    }

    private static float Number(JsonElement root, string name) =>
        root.TryGetProperty(name, out var element) && element.TryGetDouble(out var value) && !double.IsNaN(value)
            ? (float)value
            : 0f;

    private static int Elapsed(long started) => (int)Math.Max(0, Environment.TickCount64 - started);

    /// <summary>
    /// What this machine can recognise with, for the client's `available()`.
    ///
    /// **It does not call `InkRecognizerContainer.GetRecognizers()`.** That is the
    /// only API that lists the installed handwriting recognisers, and on this
    /// machine (Snapdragon X, Windows 11 arm64, .NET 9) touching it **fail-fasts
    /// the process at teardown** with `0xC0000409` — after every answer has been
    /// written, so the client sees perfectly good recognition followed by a crash
    /// exit code. Isolated by a control: a trivial console app exits 0, the same
    /// app plus `InkAnalyzer` and `AnalyzeAsync` exits 0, and the same app plus
    /// `InkRecognizerContainer` exits `0xC0000409`. The analyser is the thing this
    /// helper exists for, so the container is not used at all.
    ///
    /// What replaces it is the evidence that actually matters: an `InkAnalyzer`
    /// constructs, which is the engine being present. The recogniser *names* were
    /// only ever a diagnostic, and losing them costs nothing but a line of text in
    /// `version`.
    /// </summary>
    private static string Describe()
    {
        try
        {
            _ = new InkAnalyzer();
            return $"windows-ink analyser ready on {Environment.OSVersion.VersionString}";
        }
        catch (Exception error)
        {
            return $"unavailable: {error.Message}";
        }
    }

    // `internal`, not `private`: the source-generated serializer context below is
    // a sibling type and cannot see a private nested type. These are the wire
    // format, so they are the assembly's business rather than this class's.
    internal sealed record ReadyResponse(string Type, string Engine, string? Version, int? Id = null);

    internal sealed record ErrorResponse(string Type, string Message, int? Id);

    internal sealed record RecognisedResponse(
        string Type,
        string Engine,
        List<RecognisedLine> Lines,
        int Ms,
        int? Id);

    internal sealed record HapticsResponse(string Type, bool Available, string? Device, int? Id);

    internal sealed record RecognisedLine(string Text, double Confidence, List<string>? Alternatives);

    internal sealed class RecogniseRequest
    {
        [JsonPropertyName("lines")]
        public List<RecogniseLine>? Lines { get; set; }

        /// <summary>Accepted and ignored: this engine takes no word list. See above.</summary>
        [JsonPropertyName("vocabulary")]
        public List<string>? Vocabulary { get; set; }

        /// <summary>Accepted and ignored: the OS picks its own model.</summary>
        [JsonPropertyName("lang")]
        public string? Lang { get; set; }
    }

    internal sealed class RecogniseLine
    {
        [JsonPropertyName("strokes")]
        public List<double[]>? Strokes { get; set; }
    }
}

/// <summary>
/// The protocol's schema, generated at compile time.
///
/// Every type that crosses the wire is listed here; a type that is not is a build
/// error rather than a runtime one, which is the point of listing them.
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(Program.ReadyResponse))]
[JsonSerializable(typeof(Program.ErrorResponse))]
[JsonSerializable(typeof(Program.RecognisedResponse))]
[JsonSerializable(typeof(Program.HapticsResponse))]
[JsonSerializable(typeof(Program.RecogniseRequest))]
internal sealed partial class InkJsonContext : JsonSerializerContext;
