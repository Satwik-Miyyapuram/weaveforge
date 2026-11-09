//! Vector normalization for the semantic index (TS `embedding-port.ts`
//! `normalizeVector`). Done once at insert so cosine similarity is a dot product.

/// Unit-normalize `vector`. A zero vector is returned unchanged, so it has
/// similarity 0 with everything rather than NaN.
pub fn normalize_vector(vector: &[f32]) -> Vec<f32> {
    let sum: f32 = vector.iter().map(|v| v * v).sum();
    let length = sum.sqrt();
    if length == 0.0 {
        return vector.to_vec();
    }
    vector.iter().map(|v| v / length).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales_to_unit_length() {
        let unit = normalize_vector(&[3.0, 4.0]);
        assert!((unit[0] - 0.6).abs() < 1e-6);
        assert!((unit[1] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn zero_vector_is_unchanged() {
        assert_eq!(normalize_vector(&[0.0, 0.0, 0.0]), vec![0.0, 0.0, 0.0]);
    }
}
