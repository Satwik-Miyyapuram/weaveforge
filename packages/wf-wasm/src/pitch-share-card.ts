/**
 * Pitch link-preview card data (Rust `pitch_share_card`). The Next `Metadata`
 * object and `metadataBase` are built in apps/web; this module supplies the text,
 * the paths and the origin rule.
 */
export {
  appOriginFrom,
  pitchShareCard,
  pitchShareConstants,
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
