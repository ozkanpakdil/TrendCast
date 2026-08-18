/**
 * Math helpers shared across ML correlation engines.
 */

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/** Mean-pool a 2D embedding [tokens][dims] into a single [dims] vector. */
export function meanPool(tensor: number[][]): number[] {
  if (tensor.length === 0) return [];
  const dims = tensor[0].length;
  const result = new Array(dims).fill(0);
  for (const row of tensor) {
    for (let d = 0; d < dims; d++) {
      result[d] += row[d];
    }
  }
  for (let d = 0; d < dims; d++) {
    result[d] /= tensor.length;
  }
  return result;
}