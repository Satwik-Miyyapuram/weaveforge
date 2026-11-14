# Settings

Settings hold your appearance, your theme file, your integration keys and the
acceptance of the privacy disclaimer. They are saved to your account, so they
follow you to every device you sign in on.

## How to

1. Pick a light theme and a dark theme, and set **Button size**. Changes apply at once.
2. To use your own theme, click **Template** under **Theme file** to download the
   starter file, edit it, and upload it again. A file with a problem is refused, and
   the list of problems tells you what to fix. The app never applies half a theme.
3. Enter an integration key (for example Zotero or Semantic Scholar). Keys are
   stored with your settings and read back the same way for every feature that
   needs them.
4. When the privacy disclaimer changes, you are asked to accept it again before
   the app opens.

## Reference

Theme files are capped at 64 KB. The file can set up to 24 colours, three
fonts and three corner radii. Colours must be hex, `rgb()`, `hsl()` or one of
four keywords. Font stacks name up to five families, and values with stylesheet
syntax are rejected. A file reports at most 50 problems.

Appearance settings are checked when they are read back. A value that is not
recognised is dropped and the default is used. The animation speed is one of
0.25, 0.5, 1, 2 or 4 times normal.

An integration key is read from the provider's bag first, then from the older
flat column it used to live in. Keys are written to both places, so an older
version of the app still finds them.

The disclaimer must be accepted again whenever its version is raised. A
settings row with no acceptance time, or with an older version, asks for it. A
row with no version counts as version 1, so it is asked again too.

Source: `crates/wf-core/src/settings/`

## Related

- [Storage and sync](sync.md) — where your settings are kept
- [Integrations](integrations.md) — the keys each integration needs
- [Theming](../building/themes.md) — how the theme file maps onto the app
