"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/select";
import { sanitizeCardTint, type CardTint, DARK_THEME_OPTIONS, LIGHT_THEME_OPTIONS, CONTROL_SIZE_OPTIONS, SURFACE_STYLE_OPTIONS, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, sanitizeThemeId, sanitizeControlSize, sanitizeSurfaceStyle, type ControlSizeId, type SurfaceStyle, type ThemeConfig } from "@/lib/theme/theme";
import { persistThemeChange, readLocalAppearance } from "@/lib/theme/theme-persistence";
import { CardTintPicker } from "./card-tint-picker";
import { ThemeConfigPanel } from "./theme-config-panel";
import { ThemeCardPicker } from "./theme-card-picker";

/**
 * The Appearance tab: theme, tint and interface preferences for this device.
 * Each control persists on change through persistThemeChange; nothing waits
 * for the Save button the server-backed tabs use.
 */
export function AppearancePanel() {
  const [lightTheme, setLightTheme] = useState<string>(DEFAULT_LIGHT_THEME);
  const [darkTheme, setDarkTheme] = useState<string>(DEFAULT_DARK_THEME);
  const [controlSize, setControlSize] = useState<ControlSizeId>("default");
  const [surfaces, setSurfaces] = useState<SurfaceStyle>("borderless");
  const [reactiveMotion, setReactiveMotion] = useState(false);
  const [cardTint, setCardTint] = useState<CardTint>("full");
  const [cardTilt, setCardTilt] = useState(true);
  const [scanlines, setScanlines] = useState(true);
  const [customTheme, setCustomTheme] = useState<ThemeConfig | null>(null);

  useEffect(() => {
    const appearance = readLocalAppearance();
    setLightTheme(appearance.lightTheme ?? DEFAULT_LIGHT_THEME);
    setDarkTheme(appearance.darkTheme ?? DEFAULT_DARK_THEME);
    setControlSize(sanitizeControlSize(appearance.controlSize));
    setSurfaces(sanitizeSurfaceStyle(appearance.surfaces));
    setReactiveMotion(appearance.reactiveMotion ?? false);
    setCardTint(sanitizeCardTint(appearance.cardTint));
    setCardTilt(appearance.cardTilt ?? true);
    setScanlines(appearance.scanlines ?? true);
    setCustomTheme(appearance.customTheme ?? null);
  }, []);

  function handleLightThemeChange(val: string) {
    const safe = sanitizeThemeId(val, "light");
    setLightTheme(safe);
    persistThemeChange(
      { lightTheme: safe },
      { apply: document.documentElement.dataset.mode !== "dark" },
    );
  }

  function handleDarkThemeChange(val: string) {
    const safe = sanitizeThemeId(val, "dark");
    setDarkTheme(safe);
    persistThemeChange(
      { darkTheme: safe },
      { apply: document.documentElement.dataset.mode === "dark" },
    );
  }

  function handleCardTintChange(val: string) {
    const safe = sanitizeCardTint(val);
    setCardTint(safe);
    persistThemeChange({ cardTint: safe });
  }

  function handleCardTiltChange(on: boolean) {
    setCardTilt(on);
    persistThemeChange({ cardTilt: on });
  }

  function handleScanlinesChange(on: boolean) {
    setScanlines(on);
    persistThemeChange({ scanlines: on });
  }

  function handleControlSizeChange(val: string) {
    const safe = sanitizeControlSize(val);
    setControlSize(safe);
    persistThemeChange({ controlSize: safe });
  }

  function handleSurfacesChange(val: string) {
    const safe = sanitizeSurfaceStyle(val);
    setSurfaces(safe);
    persistThemeChange({ surfaces: safe });
  }

  function handleReactiveMotionChange(on: boolean) {
    setReactiveMotion(on);
    persistThemeChange({ reactiveMotion: on });
  }

  function handleCustomThemeChange(config: ThemeConfig | null) {
    setCustomTheme(config);
    if (config) {
      // A theme file carries its own surface and motion preference, so the
      // controls above have to follow what was just applied.
      setSurfaces(config.surfaces);
      setReactiveMotion(config.reactiveMotion);
    }
  }

  // Laid out like a record page (styles/appearance.css): mono section
  // heads over a hairline, one row per preference with its explanation on
  // the left and the control on the right, and no box around any of it.
  return (
    <div id="settings-appearance" className="settings-anchor appearance" role="tabpanel" aria-labelledby="settings-tab-appearance">
      <header className="appearance-head">
        <h3 className="appearance-title">Appearance</h3>
        <p className="appearance-lede">How WeaveForge looks on this device.</p>
      </header>

      <section className="appearance-section" aria-labelledby="appearance-theme-head">
        <h4 id="appearance-theme-head" className="record-section-head">Theme</h4>
        <div className="appearance-row">
          <div className="appearance-row-text">
            <span className="appearance-label" id="lightThemeLabel">Light theme</span>
            <p>Used while your system is in light mode.</p>
          </div>
        </div>
        <ThemeCardPicker
          name="lightTheme"
          labelledBy="lightThemeLabel"
          options={LIGHT_THEME_OPTIONS}
          value={lightTheme}
          onChange={handleLightThemeChange}
        />
        <div className="appearance-row">
          <div className="appearance-row-text">
            <span className="appearance-label" id="darkThemeLabel">Dark theme</span>
            <p>Used while your system is in dark mode.</p>
          </div>
        </div>
        <ThemeCardPicker
          name="darkTheme"
          labelledBy="darkThemeLabel"
          options={DARK_THEME_OPTIONS}
          value={darkTheme}
          onChange={handleDarkThemeChange}
        />
        <CardTintPicker value={cardTint} onChange={handleCardTintChange} />
        <ThemeConfigPanel current={customTheme} onChange={handleCustomThemeChange} />
      </section>

      <section className="appearance-section" aria-labelledby="appearance-interface-head">
        <h4 id="appearance-interface-head" className="record-section-head">Interface</h4>
        <div className="appearance-row">
          <div className="appearance-row-text">
            <label htmlFor="surfaces">Surfaces</label>
            <p>
              Borderless separates panels and cards with shadow and a faint fill; Bordered
              outlines each with a hairline. Pick Bordered with High Contrast, where a
              shadow carries too little contrast to mark an edge.
            </p>
          </div>
          <Select id="surfaces" value={surfaces} onChange={(e) => handleSurfacesChange(e.target.value)}>
            {SURFACE_STYLE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </Select>
        </div>
        <div className="appearance-row">
          <div className="appearance-row-text">
            <label htmlFor="controlSize">Button size</label>
            <p>Scales icon buttons and expand toggles (lists, report sections, cards) together.</p>
          </div>
          <Select id="controlSize" value={controlSize} onChange={(e) => handleControlSizeChange(e.target.value)}>
            {CONTROL_SIZE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </Select>
        </div>
        <div className="appearance-row">
          <div className="appearance-row-text">
            <label htmlFor="reactiveMotion">Reactive animations</label>
            <p>
              Cards tilt toward the pointer and catch a light sheen; buttons and nav icons
              respond to hover and press. Ordinary transitions are unaffected, and a
              system &ldquo;reduce motion&rdquo; setting overrides this.
            </p>
          </div>
          <input
            id="reactiveMotion"
            type="checkbox"
            role="switch"
            className="themed-check appearance-switch"
            checked={reactiveMotion}
            onChange={(e) => handleReactiveMotionChange(e.target.checked)}
          />
        </div>
        {(lightTheme === "crt" || customTheme?.cardTilt === true) && (
          <div className="appearance-row">
            <div className="appearance-row-text">
              <label htmlFor="cardTilt">Tilted cards</label>
              <p>
                Cards lean a little off square, like a hand of dealt cards. On by default
                for CRT; a theme file can turn it on for any theme with{" "}
                <code>&quot;tilt&quot;: true</code>.
              </p>
            </div>
            <input
              id="cardTilt"
              type="checkbox"
              role="switch"
              className="themed-check appearance-switch"
              checked={cardTilt}
              onChange={(e) => handleCardTiltChange(e.target.checked)}
            />
          </div>
        )}
        {lightTheme === "crt" && (
          <div className="appearance-row">
            <div className="appearance-row-text">
              <label htmlFor="scanlines">Scanlines</label>
              <p>Only for the CRT theme.</p>
            </div>
            <input
              id="scanlines"
              type="checkbox"
              role="switch"
              className="themed-check appearance-switch"
              checked={scanlines}
              onChange={(e) => handleScanlinesChange(e.target.checked)}
            />
          </div>
        )}
      </section>
    </div>
  );
}
