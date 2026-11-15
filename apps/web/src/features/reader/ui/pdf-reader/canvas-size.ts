/**
 * The CSS and backing-pixel size of a page canvas, so the pixels are exactly
 * the CSS size times the device pixel ratio.
 *
 * Flooring both sides on their own breaks that at fractional ratios: 815 CSS
 * pixels at 1.5x is 1222.5 device pixels against a 1223-pixel canvas, and the
 * browser resamples the whole page, which blurs the text. Writing the ratio as
 * a small fraction num/den and trimming the CSS size to a multiple of den
 * (at most den - 1 pixels of page margin) makes the pair exact, as pdf.js's own
 * viewer does.
 */
export interface CanvasSize {
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
}

/** The ratio as num/den with den <= 8, or null when no small fraction is close. */
function smallFraction(ratio: number): [number, number] | null {
  for (let den = 1; den <= 8; den++) {
    const num = Math.round(ratio * den);
    if (Math.abs(num / den - ratio) < 1e-3) return [num, den];
  }
  return null;
}

export function canvasSize(width: number, height: number, ratio: number): CanvasSize {
  const r = ratio > 0 ? ratio : 1;
  const fraction = smallFraction(r);
  if (!fraction) {
    const cssWidth = Math.floor(width);
    const cssHeight = Math.floor(height);
    return { cssWidth, cssHeight, pixelWidth: Math.floor(cssWidth * r), pixelHeight: Math.floor(cssHeight * r) };
  }
  const [num, den] = fraction;
  const cssWidth = Math.floor(width) - (Math.floor(width) % den);
  const cssHeight = Math.floor(height) - (Math.floor(height) % den);
  return { cssWidth, cssHeight, pixelWidth: (cssWidth / den) * num, pixelHeight: (cssHeight / den) * num };
}
