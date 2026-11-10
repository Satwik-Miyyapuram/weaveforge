/**
 * Pitch link-preview card data (Rust `pitch_share_card`). The Next `Metadata`
 * object and `metadataBase` are built in apps/web; this module supplies the text,
 * the paths and the origin rule.
 */
import {
  appOriginFrom as rawAppOriginFrom,
  pitchShareCard as rawPitchShareCard,
  pitchShareConstants as rawPitchShareConstants,
} from "../pkg/wf_wasm.js";

export interface PitchShareImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

export interface PitchShareCard {
  title: string;
  description: string;
  ogType: string;
  siteName: string;
  locale: string;
  url: string;
  image: PitchShareImage;
  twitterCard: string;
}

export interface PitchShareConstants {
  title: string;
  description: string;
  defaultAppOrigin: string;
}

/** The origin an app deployment answers on; unset or non-http(s) gives the default. */
export function appOriginFrom(configured: string | undefined): string {
  return rawAppOriginFrom(configured);
}

/** The shared pitch title, description and default origin. */
export function pitchShareConstants(): PitchShareConstants {
  return rawPitchShareConstants() as PitchShareConstants;
}

/** Card metadata for a host serving the pitch, without `metadataBase`. */
export function pitchShareCard(basePath: string, path: string): PitchShareCard {
  return rawPitchShareCard(basePath, path) as PitchShareCard;
}
