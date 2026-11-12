// Surface Slim Pen 2 tactile haptics (ink-native-bridges.md §4).
//
// The pen's actuator is driven through `Windows.Devices.Haptics`: a
// `SimpleHapticsController` on the `PenDevice`, fed a continuous waveform whose
// intensity is set per sample from pressure and speed. Held still, the pen is
// silent (kinetic friction, not a buzz); moving, it feels like graphite.
//
// **How the controller is found is the whole difficulty.** The design note
// takes it from `PointerPoint.Properties.PointerDevice`, which needs the pointer
// event itself — and the pointer events go to Chromium's window, not to this
// process, which has no window at all. What this process *can* do is ask the OS
// for the pen behind a system pointer id: `PenDevice.GetFromPointerId`. Pointer
// ids are small integers the OS hands out while a pen is in range, so when a
// stroke starts and no controller is bound, the ids are tried in turn until one
// is a pen. The scan costs a few milliseconds once per pen; a pen that leaves
// range and returns gets a new id, which is why an update that fails rebinds.
//
// Everything here is best-effort and silent on failure: a machine with no
// haptic pen, or an OS older than Windows 11 (the pen waveforms arrived with
// SDK 22000), answers `available: false` and every later call is a no-op.

using Windows.Devices.Haptics;
using Windows.Devices.Input;
using System.Runtime.Versioning;
using Windows.Foundation.Metadata;

namespace WeaveForge.InkRecogniser;

internal sealed class PenHapticsEngine
{
    /// <summary>Below this speed, in CSS px/ms, the nib is held still: no friction.</summary>
    private const float MinVelocityThreshold = 0.05f;

    /// <summary>The speed at which friction reaches full intensity, in CSS px/ms.</summary>
    private const float NominalVelocity = 1.2f;

    /// <summary>How many system pointer ids to try when looking for the pen.</summary>
    private const uint PointerIdScanLimit = 64;

    /// <summary>Not more often than this: a scan that found nothing is a pen out of range.</summary>
    private const long RescanIntervalMs = 500;

    private SimpleHapticsController? _controller;
    private SimpleHapticsControllerFeedback? _feedback;
    private string _tool = "pen";
    private string? _device;
    private long _lastScan = long.MinValue;
    private bool _playing;

    /// <summary>Whether this OS has the pen waveforms at all; the pen itself is found later.</summary>
    [SupportedOSPlatformGuard("windows10.0.22000.0")]
    public static bool Supported =>
        OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000)
        && ApiInformation.IsTypePresent("Windows.Devices.Input.PenDevice")
        && ApiInformation.IsPropertyPresent(
            "Windows.Devices.Haptics.KnownSimpleHapticsControllerWaveforms",
            "PencilContinuous");

    /// <summary>What the last bind found, for the client's diagnostics.</summary>
    public string? Device => _device;

    /// <summary>
    /// Whether the feature exists here: the OS has the API. Whether a haptic pen
    /// is present is only knowable while one is in range, so the probe also
    /// tries a bind — `Device` says what it found — but a miss is not a no.
    /// </summary>
    public bool Probe()
    {
        if (!Supported) return false;
        _lastScan = long.MinValue;
        Bind();
        return true;
    }

    public void SetTool(string tool)
    {
        _tool = tool;
        _feedback = null;
        if (_controller is not null) SelectFeedback();
    }

    /// <summary>One sample of the stroke: pressure in [0, 1], speed in CSS px/ms.</summary>
    public void Update(float pressure, float velocity)
    {
        if (!Supported) return;
        if (_controller is null && !Bind()) return;

        // Kinetic friction: a pen held still against the glass makes no sound.
        if (velocity < MinVelocityThreshold)
        {
            Stop();
            return;
        }

        if (_feedback is null) return;
        var velocityFactor = Math.Min(1.0f, velocity / NominalVelocity);
        var pressureFactor = MathF.Pow(Math.Clamp(pressure, 0.05f, 1.0f), 0.75f);
        var intensity = Math.Clamp(pressureFactor * velocityFactor, 0.15f, 1.0f);
        try
        {
            _controller!.SendHapticFeedback(_feedback, intensity);
            _playing = true;
        }
        catch (Exception)
        {
            // The pen left range mid-stroke: drop the binding, the next sample
            // looks for it again.
            _controller = null;
            _feedback = null;
            _playing = false;
        }
    }

    /// <summary>The pen lifted: silence, at once.</summary>
    public void Stop()
    {
        if (!_playing || _controller is null) return;
        _playing = false;
        try
        {
            _controller.StopFeedback();
        }
        catch (Exception)
        {
            _controller = null;
            _feedback = null;
        }
    }

    [SupportedOSPlatform("windows10.0.22000.0")]
    private bool Bind()
    {
        var now = Environment.TickCount64;
        if (now - _lastScan < RescanIntervalMs) return false;
        _lastScan = now;
        _controller = null;
        _feedback = null;
        for (uint pointerId = 1; pointerId <= PointerIdScanLimit; pointerId++)
        {
            PenDevice? pen;
            try
            {
                pen = PenDevice.GetFromPointerId(pointerId);
            }
            catch (Exception)
            {
                continue; // Not a pointer id in use, or not a pen's.
            }
            if (pen is null) continue;
            SimpleHapticsController? controller;
            try
            {
                controller = pen.SimpleHapticsController;
            }
            catch (Exception)
            {
                continue;
            }
            if (controller is null) continue; // A pen, but not a haptic one.
            _controller = controller;
            _device = $"pen {pen.PenId} at pointer {pointerId}";
            SelectFeedback();
            return true;
        }
        return false;
    }

    /// <summary>The waveform for the tool, from what this controller says it can play.</summary>
    private void SelectFeedback()
    {
        if (_controller is null) return;
        var wanted = _tool switch
        {
            "highlighter" => KnownSimpleHapticsControllerWaveforms.MarkerContinuous,
            "eraser" => KnownSimpleHapticsControllerWaveforms.EraserContinuous,
            "ballpoint" => KnownSimpleHapticsControllerWaveforms.InkContinuous,
            _ => KnownSimpleHapticsControllerWaveforms.PencilContinuous,
        };
        SimpleHapticsControllerFeedback? found = null;
        SimpleHapticsControllerFeedback? anyContinuous = null;
        try
        {
            foreach (var feedback in _controller.SupportedFeedback)
            {
                if (feedback.Waveform == wanted)
                {
                    found = feedback;
                    break;
                }
                // A pen without the exact waveform still gets *some* friction.
                if (anyContinuous is null && feedback.Waveform == KnownSimpleHapticsControllerWaveforms.BuzzContinuous)
                    anyContinuous = feedback;
            }
        }
        catch (Exception)
        {
            // Left null: updates are then no-ops until a rebind.
        }
        _feedback = found ?? anyContinuous;
    }
}
