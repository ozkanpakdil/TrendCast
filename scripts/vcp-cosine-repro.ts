/**
 * Standalone repro: measure REAL MiniLM cosines for the exact VCP scenario.
 *
 * Uses the same model (Xenova/all-MiniLM-L6-v2, q8) and the same enrichment
 * + thresholds as the production embedding engine, run in Node via Bun.
 * No mocks — this is the actual model the extension downloads.
 *
 * Run: bun run scripts/vcp-cosine-repro.ts
 */
import { pipeline, env } from '@huggingface/transformers';

// Match production: no local models, browser cache semantics don't apply in
// Node but allowLocalModels=false keeps the path identical.
env.allowLocalModels = false;

const MODEL = 'Xenova/all-MiniLM-L6-v2';

// ── Production logic mirrors ──────────────────────────────────────

// From src/utils/entities.ts — the KNOWN_TICKERS gate + TICKER_TO_ORG map
// are large; for this repro we only need the NVDA→nvidia mapping and the
// cashtag/bare-caps patterns. If the headline contains NVDA, enrichment
// appends 'nvidia' (verified by the unit test tracer).
function enrichForEmbedding(text: string): string {
  // Production: extractEntityKeywords(text).join(' ') appended.
  // For the VCP headline "NVDA — VCP 2026-08-27" the only entity is
  // nvidia (NVDA → TICKER_TO_ORG). For "$NVDA breaking out" likewise.
  // We replicate by appending 'nvidia' when the text mentions NVDA/Nvidia.
  if (/\bNVDA\b|\$NVDA\b|nvidia/i.test(text)) return `${text} nvidia`;
  return text;
}

const EMBEDDING_THRESHOLD = 0.45;
const EMBEDDING_ENTITY_THRESHOLD = 0.35;

// ── Real texts from the user's UI dump ────────────────────────────

// VCP news items (what stockScreener2 collection produces):
const vcpNews = [
  'NVDA — VCP 2026-08-27',
  'PEN — VCP 2026-08-28',
  'HOOD — VCP 2026-08-28',
  'MMM — VCP 2026-08-28',
];

// Social signals (from the user's reddit dump):
const signals = [
  'Just Buy NVDA at $12/share',
  'Made $82K NVDA Calls',
  'My NVDA tendies',
  '$IREN earnings report. What does everything think?',
  '$50,000 YOLO NVDA 8/28 exp $217.5 strike call - when to take profit?',
];

// Seeking Alpha news (for reference — these DO match):
const saNews = [
  'NVIDIA Corporation (NVDA) Presents at Bank of America 2026 Global Technology Conference Transcript',
  'NVIDIA Q2 2027 Earnings Call Transcript',
];

async function main() {
  console.log(`Loading ${MODEL} (q8)…`);
  const extractor = await pipeline('feature-extraction', MODEL, {
    dtype: 'q8',
  });

  const embed = async (texts: string[]): Promise<number[][]> => {
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    // Transformers.js Tensor: .tolist() gives number[][]
    const data = (out as unknown as { data: Float32Array; dims: number[] }).data;
    const dims = (out as unknown as { dims: number[] }).dims;
    const batch = dims[0];
    const dim = dims[dims.length - 1];
    const vectors: number[][] = [];
    for (let i = 0; i < batch; i++) {
      vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
    }
    return vectors;
  };

  const cosine = (a: number[], b: number[]): number => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  };

  // Embed everything (enriched, exactly like production)
  const allTexts = [
    ...vcpNews.map(enrichForEmbedding),
    ...signals.map(enrichForEmbedding),
    ...saNews.map(enrichForEmbedding),
  ];
  console.log('\nEnriched texts:');
  for (const t of allTexts) console.log(`  "${t}"`);

  const vectors = await embed(allTexts);
  const vcpVecs = vectors.slice(0, vcpNews.length);
  const sigVecs = vectors.slice(vcpNews.length, vcpNews.length + signals.length);
  const saVecs = vectors.slice(vcpNews.length + signals.length);

  // ── VCP news ↔ social signals ─────────────────────────────────
  console.log('\n═══ VCP news ↔ social signals (raw cosine) ═══');
  for (let i = 0; i < vcpNews.length; i++) {
    for (let j = 0; j < signals.length; j++) {
      const sim = cosine(vcpVecs[i], sigVecs[j]);
      const sharedEntity = /\bNVDA\b|\$NVDA\b|nvidia/i.test(vcpNews[i]) && /\bNVDA\b|\$NVDA\b|nvidia/i.test(signals[j]);
      const threshold = sharedEntity ? EMBEDDING_ENTITY_THRESHOLD : EMBEDDING_THRESHOLD;
      const verdict = sim >= threshold ? '✓ MATCH' : sim >= EMBEDDING_ENTITY_THRESHOLD ? '✗ below general bar' : '✗ below entity bar';
      console.log(
        `  ${sim.toFixed(3)} (bar ${threshold.toFixed(2)}) ${verdict}  "${vcpNews[i]}" ↔ "${signals[j]}"`,
      );
    }
  }

  // ── SA news ↔ social signals (the working matches, for calibration) ──
  console.log('\n═══ Seeking Alpha news ↔ social signals (calibration) ═══');
  for (let i = 0; i < saNews.length; i++) {
    for (let j = 0; j < signals.length; j++) {
      const sim = cosine(saVecs[i], sigVecs[j]);
      console.log(`  ${sim.toFixed(3)}  "${saNews[i].slice(0, 50)}…" ↔ "${signals[j]}"`);
    }
  }

  // ── VCP news ↔ SA news (the CORR-06 gap — no pass exists) ─────
  console.log('\n═══ VCP news ↔ Seeking Alpha news (NO PASS EXISTS — CORR-06) ═══');
  for (let i = 0; i < vcpNews.length; i++) {
    for (let j = 0; j < saNews.length; j++) {
      const sim = cosine(vcpVecs[i], saVecs[j]);
      console.log(`  ${sim.toFixed(3)}  "${vcpNews[i]}" ↔ "${saNews[j].slice(0, 50)}…"`);
    }
  }
}

main().catch((err) => {
  console.error('Repro failed:', err);
  process.exit(1);
});