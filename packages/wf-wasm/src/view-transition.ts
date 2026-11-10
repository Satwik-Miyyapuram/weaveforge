/**
 * Page-transition tier and click checks (Rust `view_transition`), re-exported from index.ts.
 */
import {
  isPlainClick as rawIsPlainClick,
  motionTier as rawMotionTier,
  transitionsOn as rawTransitionsOn,
} from "../pkg/wf_wasm.js";

export type MotionTier = "off" | "calm" | "reactive" | "crt";
export type MotionTierInput = { motion: string | undefined; theme: string | undefined; reducedMotion: boolean; supported: boolean };

/** Calm by default, bigger with Reactive motion, stepped on CRT; off when reduced or unsupported (Rust `motion_tier`). */
export function motionTier(input: MotionTierInput): MotionTier {
  return rawMotionTier(input.motion, input.theme, input.reducedMotion, input.supported) as MotionTier;
}

/** True when the tier animates at all (Rust `transitions_on`). */
export function transitionsOn(input: MotionTierInput): boolean {
  return rawTransitionsOn(input.motion, input.theme, input.reducedMotion, input.supported);
}

/** The mouse fields a link click is judged by. */
export type ClickFields = {
  button: number;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** A plain left click that a link would follow in this window (Rust `is_plain_click`). */
export function isPlainClick(e: ClickFields): boolean {
  return rawIsPlainClick(e.button, e.defaultPrevented, e.metaKey, e.ctrlKey, e.shiftKey, e.altKey);
}
