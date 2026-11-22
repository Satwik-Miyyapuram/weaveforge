/**
 * The shape of a usable browser install id. Every place that accepts an id from outside checks it with this.
 *
 * This is narrower than the Rust device id rule (`is_file_name_id`, 1 to 128 characters). Browser ids are
 * `crypto.randomUUID()` values (36 characters), which 8 to 64 covers. The two bounds are not shared.
 */
export const ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;
