/**
 * Math helpers shared across ML correlation engines.
 */

/** Dot product between two equal-length vectors. */
export function dotProduct(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Cosine similarity between two equal-length vectors.
 * If both vectors are L2-normalized (norm = 1), this equals the dot product.
 */
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

/** L2-normalize a vector in place and return it (no-op if norm is 0). */
export function normalize(vector: number[]): number[] {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  }
  return vector;
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

/**
 * Compute a batch size that scales with the amount of data.
 *
 * Returns `fraction` (default 10%) of `dataSize`, clamped to `[min, max]` so
 * small datasets don't produce degenerate batches and large datasets don't
 * blow up memory. Shared by the embedding, NER, and sentiment engines so
 * they all use the same batching logic.
 *
 * Memoized: the same arguments always yield the same result, and the engines
 * call this repeatedly with identical `dataSize` values across passes, so we
 * cache the result to avoid redundant math and log spam.
 */
const batchSizeCache = new Map<string, number>();

export function computeBatchSize(
  dataSize: number,
  fraction = 0.1,
  min = 1,
  max = 128,
): number {
  const key = `${dataSize}|${fraction}|${min}|${max}`;
  const cached = batchSizeCache.get(key);
  if (cached !== undefined) return cached;

  const batchSize = Math.max(min, Math.min(max, Math.ceil(dataSize * fraction)));
  batchSizeCache.set(key, batchSize);
  console.debug(`[TrendCast] computeBatchSize: dataSize=${dataSize}, fraction=${fraction}, min=${min}, max=${max} => batchSize=${batchSize}`);
  return batchSize;
}