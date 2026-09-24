// The OS spell checker, as the recogniser's language check.
//
// `InkAnalyzer` gives every word a list of readings — "brown", "lorown",
// "bown" — and exposes no score for any of them, so the helper cannot say which
// reading is a word or how sure it is. Windows already ships the thing that can:
// `ISpellCheckerFactory` (spellcheck.dll, Windows 8+), offline, with the
// dictionaries of every language the user has installed. The helper asks it
// one question per reading — is this a word? — and hands the answers to the
// client, which picks among the readings and derives a confidence from them
// (packages/core/src/ink/decode.ts). Nothing is decided here.
//
// Source-generated COM (`GeneratedComInterface`) rather than `[ComImport]`:
// `PublishTrimmed` switches the runtime's built-in COM interop off, and the
// generated form is the one that survives trimming. Only the vtable slots up to
// `Check` are declared; a COM interface may be declared short at the end, never
// in the middle.

using System.Runtime.InteropServices;
using System.Runtime.InteropServices.Marshalling;

namespace WeaveForge.InkRecogniser;

[GeneratedComInterface(StringMarshalling = StringMarshalling.Utf16)]
[Guid("8E018A9D-2415-4677-BF08-794EA61F94BB")]
internal partial interface ISpellCheckerFactory
{
    [PreserveSig]
    int GetSupportedLanguages(out IntPtr value);

    [PreserveSig]
    int IsSupported(string languageTag, out int value);

    [PreserveSig]
    int CreateSpellChecker(string languageTag, out ISpellChecker? value);
}

[GeneratedComInterface(StringMarshalling = StringMarshalling.Utf16)]
[Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B")]
internal partial interface ISpellChecker
{
    /// <summary>Declared for its vtable slot only; never called.</summary>
    [PreserveSig]
    int GetLanguageTag(out IntPtr value);

    [PreserveSig]
    int Check(string text, out IEnumSpellingError? value);
}

[GeneratedComInterface]
[Guid("803E3BD4-2828-4410-8290-418D1D73C762")]
internal partial interface IEnumSpellingError
{
    /// <summary>`S_OK` with an error, or `S_FALSE` when there are no more.</summary>
    [PreserveSig]
    int Next(out IntPtr value);
}

internal static partial class SpellCheck
{
    private static readonly Guid FactoryClass = new("7AB36653-1796-484B-BDFA-E74F1DB7C1DC");
    private static readonly Guid FactoryInterface = new("8E018A9D-2415-4677-BF08-794EA61F94BB");
    private const uint InprocServer = 1;

    private static readonly StrategyBasedComWrappers Wrappers = new();
    private static ISpellCheckerFactory? factory;
    private static bool factoryTried;
    private static readonly Dictionary<string, ISpellChecker?> Checkers = new(StringComparer.OrdinalIgnoreCase);

    [LibraryImport("ole32.dll")]
    private static partial int CoCreateInstance(in Guid clsid, IntPtr outer, uint context, in Guid iid, out IntPtr instance);

    /// <summary>
    /// A checker for the language, the user's first fallback, or null when this
    /// machine has neither. Null is an answer, not an error: the client then
    /// treats every reading as unjudged.
    /// </summary>
    public static ISpellChecker? For(string? lang)
    {
        var tag = string.IsNullOrWhiteSpace(lang) ? "en-US" : lang;
        if (Checkers.TryGetValue(tag, out var cached)) return cached;
        ISpellChecker? checker = null;
        try
        {
            var made = Factory();
            if (made is not null)
            {
                foreach (var candidate in new[] { tag, tag.Split('-')[0], "en-US" })
                {
                    if (made.IsSupported(candidate, out var supported) != 0 || supported == 0) continue;
                    if (made.CreateSpellChecker(candidate, out checker) == 0 && checker is not null) break;
                    checker = null;
                }
            }
        }
        catch
        {
            checker = null;
        }
        Checkers[tag] = checker;
        return checker;
    }

    /// <summary>Whether the checker finds no error in a single reading.</summary>
    public static bool IsWord(ISpellChecker checker, string text)
    {
        if (checker.Check(text, out var errors) != 0 || errors is null) return false;
        var result = errors.Next(out var error);
        if (error != IntPtr.Zero) Marshal.Release(error);
        // S_FALSE (1): the enumeration was empty, so nothing is misspelled.
        return result == 1;
    }

    private static ISpellCheckerFactory? Factory()
    {
        if (factoryTried) return factory;
        factoryTried = true;
        if (CoCreateInstance(in FactoryClass, IntPtr.Zero, InprocServer, in FactoryInterface, out var instance) != 0
            || instance == IntPtr.Zero)
        {
            return null;
        }
        try
        {
            factory = (ISpellCheckerFactory)Wrappers.GetOrCreateObjectForComInstance(instance, CreateObjectFlags.None);
        }
        finally
        {
            Marshal.Release(instance);
        }
        return factory;
    }
}
