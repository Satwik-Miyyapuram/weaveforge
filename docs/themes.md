# Theming Architecture

Thesis Tracker uses a pure CSS-variable theming system to maintain high performance without JavaScript layout thrashing. All colors in the app are controlled through semantic design tokens.

## How it works

1. **Tokens**: All colors are defined in `apps/web/src/app/themes.css`. No hardcoded hex values exist in `globals.css` or component files.
2. **Dual Mode**: The app tracks two distinct states:
   - `data-mode`: `"light"` or `"dark"`.
   - `data-theme`: The specific palette applied to that mode (e.g., `"mocha"`, `"amoled"`, `"latte"`).
3. **No-Flash Boot**: `layout.tsx` contains an inline `<script>` that reads `localStorage` before the DOM parses, instantly applying the correct `data-mode` and `data-theme` to the `<html>` root. This prevents any white-flash on load.

## Adding a New Theme

To add a completely new theme (e.g., "Nord"):

1. **Define the CSS Variables**
   Open `apps/web/src/app/themes.css` and add your block:
   ```css
   [data-theme="nord"] {
     --bg: #2e3440;
     --surface: #3b4252;
     --ink: #eceff4;
     --muted: #d8dee9;
     --line: #4c566a;
     --accent: #88c0d0;
     --accent-ink: #8fbcbb;
     --clay: #ebcb8b;
     --input-bg: #2e3440;
     --pill: #434c5e;
     --hover: #4c566a;
     --chip: #3b4252;
     --neutral: #434c5e;
     --status-neutral: #4c566a;
     --active-bg: #4c566a;
     --nav-bg: rgba(46, 52, 64, 0.92);
     --sel-ring: rgba(236, 239, 244, 0.16);

     /* Status colors - foreground text on colored pills should have high contrast */
     --st-positive-bg: #a3be8c; --st-positive-fg: #2e3440;
     --st-info-bg: #81a1c1;     --st-info-fg: #2e3440;
     --st-warn-bg: #ebcb8b;     --st-warn-fg: #2e3440;
     --st-danger-bg: #bf616a;   --st-danger-fg: #2e3440;

     /* Standard dark mode shadow */
     --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.45);
   }
   ```

2. **Add it to the Settings UI**
   Open `apps/web/src/features/settings/ui/settings-screen.tsx`. Add your new theme as an `<option>` in either the Light Theme or Dark Theme dropdown:
   ```tsx
   <option value="nord">Nord</option>
   ```

## Design Token Definitions

- `--bg`: The lowest background layer (page root).
- `--surface`: Elevated cards and modal backgrounds.
- `--input-bg`: Background for text inputs and dropdowns.
- `--ink`: Primary text color.
- `--muted`: Secondary/tertiary text color.
- `--line`: Borders and dividers.
- `--accent`: Primary action color (buttons, active tabs).
- `--accent-ink`: Hover state for accents or text on accent backgrounds.
- `--btn-text`: (Optional) specifically overrides the text color inside primary buttons if `--accent` contrast is too low.

## The Catppuccin Implementation

Our Catppuccin themes (Latte, Frappé, Mocha) are mapped exactly to the official Catppuccin style guide:
- `Base` -> `--bg`
- `Surface0` -> `--surface` (cards)
- `Mantle` -> `--chip`, `--nav-bg` (sidebars/shells)
- `Crust` -> `--input-bg` (deepest inset fields)
