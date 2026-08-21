import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";

/**
 * The three faces the whole product is set in, loaded once.
 *
 * next/font hashes each family+weight set at build time, so declaring the same
 * three in two root layouts is not just repetition — it is two sets of font
 * files. Both documents pull this instead.
 */

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const serif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-serif",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

/** Put on <html>: the CSS variables styles/base.css reads for its type stack. */
export const FONT_VARIABLES = `${sans.variable} ${serif.variable} ${mono.variable}`;
