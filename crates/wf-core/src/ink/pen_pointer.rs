//! The pen's eraser end and barrel button, read from a pointer event. A port of
//! the decisions in `apps/web/src/features/ink/application/eraser-tip.ts`.
//!
//! `button` and `buttons` are JS numbers that may be absent (`-1` is "no
//! button"), so both arrive as `Option<f64>`.

/// The `button` a down reports when the eraser end made the contact.
pub const PEN_ERASER_BUTTON: f64 = 5.0;
/// The `buttons` bit that stays set while the eraser end is in contact.
pub const PEN_ERASER_BIT: u32 = 32;
/// The `button` a barrel-button down reports.
pub const PEN_BARREL_BUTTON: f64 = 2.0;
/// The `buttons` bit a pen's barrel button sets while it is held.
pub const PEN_BARREL_BIT: u32 = 2;

/// Whether a JS bitmask holds `bit`. A missing or non-finite mask holds none,
/// as the JS `?? 0` and `NaN & bit` leave it.
fn holds_bit(buttons: Option<f64>, bit: u32) -> bool {
    buttons.is_some_and(|value| value.is_finite() && (value as i64 & i64::from(bit)) != 0)
}

/// Whether a pointer event is the pen's eraser end. Touch and mouse never are,
/// and a hover reports neither the button nor the bit, so an inverted pen does
/// not erase in mid-air.
#[must_use]
pub fn is_pen_eraser_pointer(
    pointer_type: &str,
    button: Option<f64>,
    buttons: Option<f64>,
) -> bool {
    pointer_type == "pen"
        && (button == Some(PEN_ERASER_BUTTON) || holds_bit(buttons, PEN_ERASER_BIT))
}

/// Whether a pen touched down with its barrel button held. The barrel selects
/// (a lasso) rather than drawing a stray stroke.
#[must_use]
pub fn is_pen_barrel_pointer(
    pointer_type: &str,
    button: Option<f64>,
    buttons: Option<f64>,
) -> bool {
    pointer_type == "pen"
        && (button == Some(PEN_BARREL_BUTTON) || holds_bit(buttons, PEN_BARREL_BIT))
}

#[cfg(test)]
mod tests {
    use super::{is_pen_barrel_pointer, is_pen_eraser_pointer};

    #[test]
    fn the_eraser_end_is_read_from_the_button_on_the_down() {
        assert!(is_pen_eraser_pointer("pen", Some(5.0), None));
    }

    #[test]
    fn the_eraser_end_is_read_from_the_bit_while_it_is_in_contact() {
        assert!(is_pen_eraser_pointer("pen", Some(-1.0), Some(32.0)));
    }

    #[test]
    fn a_hover_with_no_button_or_bit_is_not_the_eraser() {
        assert!(!is_pen_eraser_pointer("pen", Some(-1.0), Some(0.0)));
        assert!(!is_pen_eraser_pointer("pen", None, None));
    }

    #[test]
    fn touch_and_mouse_are_never_the_pens_eraser() {
        assert!(!is_pen_eraser_pointer("touch", None, Some(32.0)));
        assert!(!is_pen_eraser_pointer("mouse", Some(5.0), Some(32.0)));
    }

    #[test]
    fn a_non_finite_mask_holds_no_bit() {
        assert!(!is_pen_eraser_pointer("pen", None, Some(f64::NAN)));
    }

    #[test]
    fn the_barrel_is_read_from_the_button_or_the_bit() {
        assert!(is_pen_barrel_pointer("pen", Some(2.0), None));
        assert!(is_pen_barrel_pointer("pen", Some(-1.0), Some(2.0)));
    }

    #[test]
    fn the_eraser_bit_is_not_the_barrel() {
        assert!(!is_pen_barrel_pointer("pen", Some(-1.0), Some(32.0)));
    }
}
