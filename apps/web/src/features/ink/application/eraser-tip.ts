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

/** What a sweep needs from a pointer event; a React or DOM `PointerEvent` fits. */
export interface EraserSweepEvent extends PenEraserEvent {
  pointerId: number;
  currentTarget: unknown;
}

/** What a hover needs: which pointer, over which surface. */
export interface EraserHoverEvent {
  pointerId: number;
  currentTarget: unknown;
}

type Styled = { style: { cursor: string } };
const styled = (target: unknown): target is Styled =>
  typeof target === "object" && target !== null && "style" in target;

/**
 * One erase sweep, down to up: whether a down erases, which pointer owns the
 * sweep, and the eraser cursor while it lasts. Notes and the reader share it so
 * the back tip behaves the same on a sheet and on a PDF page.
 *
 * A hovering pen reports nothing that tells its ends apart (no button, no bit,
 * same tilt and size), so after a back-tip lift the cursor stays with that
 * pointer until it leaves the surface or the front tip touches down. Windows
 * gives each entry into range a fresh pointerId, so the stickiness ends there.
 */
export class EraserSweep {
  private pointer: number | null = null;
  private byTip = false;
  /** The pointer whose hover still shows the eraser after a back-tip lift. */
  private sticky: number | null = null;
  private target: Styled | null = null;
  private cursorBefore = "";

  constructor(private readonly cursor: string) {}

  /**
   * Starts a sweep when the armed tool erases, or when `tipErases` and the
   * pen's back tip made the contact. False leaves the down to the caller.
   */
  begin(event: EraserSweepEvent, toolErases: boolean, tipErases: boolean): boolean {
    const byTip = tipErases && isPenEraserPointer(event);
    if (!toolErases && !byTip) return false;
    this.sticky = null;
    this.pointer = event.pointerId;
    this.byTip = byTip;
    this.show(event.currentTarget);
    return true;
  }

  /** Whether `pointerId` is the one sweeping. */
  owns(pointerId: number): boolean {
    return this.pointer === pointerId;
  }

  /** Ends the sweep `pointerId` owns; false when it owned none. */
  end(pointerId: number): boolean {
    if (this.pointer !== pointerId) return false;
    this.pointer = null;
    if (this.byTip) this.sticky = pointerId;
    else this.restoreCursor();
    return true;
  }

  /** A hover over `currentTarget`: the sticky pointer brings the eraser cursor along. */
  hover(event: EraserHoverEvent): void {
    if (this.sticky !== event.pointerId || this.target === event.currentTarget) return;
    this.show(event.currentTarget);
  }

  /** The pointer left the surface: its eraser cursor comes off, and returns on the next hover. */
  leave(pointerId: number): void {
    if (this.sticky === pointerId && this.pointer === null) this.restoreCursor();
  }

  /** A down that did not erase: the back tip is no longer the end in use. */
  release(pointerId: number): void {
    if (this.sticky !== pointerId) return;
    this.sticky = null;
    this.restoreCursor();
  }

  private show(target: unknown): void {
    this.restoreCursor();
    if (!styled(target)) return;
    this.target = target;
    this.cursorBefore = target.style.cursor;
    target.style.cursor = this.cursor;
  }

  // A surface that set its own cursor meanwhile (a tool change) keeps it.
  private restoreCursor(): void {
    if (this.target && this.target.style.cursor === this.cursor) this.target.style.cursor = this.cursorBefore;
    this.target = null;
  }
}
