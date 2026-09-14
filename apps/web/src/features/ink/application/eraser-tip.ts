/**
 * The pen's back tip, as an eraser.
 *
 * Windows digitizers report the Slim Pen's inverted end — and the eraser
 * barrel button — through the Pointer Events spec's fifth button: `button`
 * is `5` on the down that starts the contact, and the `buttons` bitmask
 * carries bit 5 (value `32`) for as long as the eraser end is the thing
 * touching the glass. Both spellings are the same fact, so both are read: a
 * driver that only sets one of them still works.
 *
 * A pen in the writing grip never reports either, so this never steals a
 * drawing stroke; and a hover with the pen inverted reports neither, so the
 * back tip erases only where the finger would — on contact.
 */

/** The `button` a down reports when the eraser end made the contact. */
export const PEN_ERASER_BUTTON = 5;

/** The `buttons` bit that stays set while the eraser end is in contact. */
export const PEN_ERASER_BIT = 32;

/** The pointer fields this reads; a `PointerEvent` satisfies it. */
export interface PenEraserEvent {
  pointerType: string;
  button?: number;
  buttons?: number;
}

/**
 * Whether a pointer event is the pen's eraser end.
 *
 * Touch and mouse never are: a finger is a finger, and a mouse's fifth button
 * is not a pen's back tip. The eraser bit on a hover (no buttons) is absent,
 * which is what keeps an inverted pen from erasing mid-air.
 */
export function isPenEraserPointer(event: PenEraserEvent): boolean {
  if (event.pointerType !== "pen") return false;
  if (event.button === PEN_ERASER_BUTTON) return true;
  return ((event.buttons ?? 0) & PEN_ERASER_BIT) !== 0;
}
