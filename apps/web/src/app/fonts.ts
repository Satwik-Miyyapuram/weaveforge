import { Jersey_10, JetBrains_Mono, Rubik } from "next/font/google";

/**
 * The faces the whole product is set in, loaded once.
 *
 * One sans for everything a person reads — interface, titles and long-form
 * text alike: Rubik, a plain low-contrast sans whose corners are slightly
 * rounded. Simple letterforms, no serifs, no calligraphic swing; the headings
 * that used to change to a serif now change weight instead. JetBrains Mono
 * stays for identifiers and code, where 0/O and 1/l/I must never be confused.
 *
 * Both are variable fonts, so one file per face covers every weight the
 * stylesheets ask for.
 *
 * next/font hashes each family+weight set at build time and self-hosts the
 * files, so the desktop build works offline. Declaring them in two root
 * layouts would be two sets of font files; both documents pull this.
 */

const sans = Rubik({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--font-face-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-face-mono",
  display: "swap",
});

/* The CRT theme's pixel face, for titles and buttons only — never reading
   text. Loaded for every theme because the theme can change without a reload;
   `display: swap` keeps it off the critical path. */
const pixel = Jersey_10({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-face-pixel",
  display: "swap",
});

/** Put on <html>: the CSS variables styles/base.css reads for its type stack. */
export const FONT_VARIABLES = `${sans.variable} ${mono.variable} ${pixel.variable}`;
