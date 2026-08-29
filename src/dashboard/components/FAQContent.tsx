/**
 * FAQ content component — renders the correlation engine FAQ.
 *
 * Used in both the dashboard (full page) and popup (compact) via the `compact` prop.
 * Content mirrors docs/FAQ.md but rendered as React for in-app navigation.
 */

import type { ReactNode } from 'react';

interface FAQContentProps {
  /** Compact mode for the popup (narrower, smaller text). */
  compact?: boolean;
  /** Dark mode flag. */
  isDark: boolean;
}

export function FAQContent({ compact = false, isDark }: FAQContentProps) {
  const maxW = compact ? 'max-w-none' : 'max-w-3xl';
  const headingClass = isDark ? 'text-slate-100' : 'text-light-text';
  const subText = isDark ? 'text-slate-400' : 'text-light-muted';
  const cardBorder = isDark ? 'border-slate-800' : 'border-light-border';
  const cardBg = isDark ? 'bg-slate-900' : 'bg-light-surface';
  const proseText = isDark ? 'text-slate-300' : 'text-light-text';
  const tableHeader = isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700';
  const tableRow = isDark ? 'text-slate-400' : 'text-light-muted';
  const tableBorder = isDark ? 'border-slate-700' : 'border-light-border';

  const h2 = `${compact ? 'text-sm' : 'text-lg'} font-bold ${headingClass} mt-6 mb-2`;
  const h3 = `${compact ? 'text-xs' : 'text-base'} font-semibold ${headingClass} mt-4 mb-1`;
  const p = `${compact ? 'text-[11px]' : 'text-sm'} ${proseText} leading-relaxed mb-2`;
  const ul = `${compact ? 'text-[11px]' : 'text-sm'} ${proseText} space-y-1 list-disc list-inside mb-2`;
  const card = `rounded-xl border p-4 ${cardBg} ${cardBorder} mb-4`;

  return (
    <div className={`${maxW} mx-auto`}>
      {/* Intro */}
      <div className="text-center space-y-2 mb-6">
        <h1 className={`${compact ? 'text-lg' : 'text-2xl'} font-bold ${headingClass}`}>
          ❓ Correlation Engines FAQ
        </h1>
        <p className={`${compact ? 'text-[11px]' : 'text-sm'} ${subText}`}>
          How TrendCast matches social signals, news, and prediction markets — and which engine to choose.
        </p>
      </div>

      {/* What Are Correlation Engines? */}
      <h2 className={h2}>What Are Correlation Engines?</h2>
      <p className={p}>
        TrendCast collects data from three sources: prediction market contracts (Polymarket, Kalshi),
        social signals (Reddit, X/Twitter trends), and news headlines (BBC, CNN, Yahoo Finance, Google News).
      </p>
      <p className={p}>
        A <strong>correlation engine</strong> is the algorithm that matches these data sources to each other —
        e.g., finding which social signals are talking about the same topic as a market contract, or which
        news headlines preceded a social media discussion. TrendCast supports multiple engines because no
        single approach is perfect for all situations.
      </p>

      {/* Heuristic */}
      <div className={card}>
        <h2 className={h2}>🧮 Heuristic Engine (Default)</h2>
        <h3 className={h3}>How It Works</h3>
        <p className={p}>
          Uses <strong>no ML models</strong> — pure string matching with domain-specific rules:
        </p>
        <ul className={ul}>
          <li><strong>Regex NER</strong> — extracts entities via patterns: cashtags ($BTC), hashtags (#Election2026), known persons/orgs/locations, capitalized phrases.</li>
          <li><strong>Entity similarity</strong> — weighted Jaccard similarity on entity sets (65% weight).</li>
          <li><strong>Keyword similarity</strong> — broader keyword overlap as fallback (35% weight).</li>
          <li><strong>Cashtag/hashtag boost</strong> — exact $TICKER matches get a confidence bump.</li>
          <li><strong>Virality weighting</strong> — social signal virality adds a small boost.</li>
        </ul>
        <h3 className={h3}>Pros</h3>
        <ul className={ul}>
          <li>No downloads — works instantly.</li>
          <li>Fast — processes thousands of pairs in milliseconds.</li>
          <li>Transparent — you can see exactly what matched.</li>
          <li>No privacy concerns — nothing leaves your browser.</li>
        </ul>
        <h3 className={h3}>Cons</h3>
        <ul className={ul}>
          <li>Lexical only — &ldquo;Will Fed cut rates?&rdquo; won&rsquo;t match &ldquo;Powell hints at borrowing cost relief.&rdquo;</li>
          <li>Knowledge base limited — only recognizes curated entities.</li>
          <li>No semantic understanding — can&rsquo;t distinguish &ldquo;Apple is rising&rdquo; from &ldquo;Apple is falling.&rdquo;</li>
        </ul>
      </div>

      {/* Embedding */}
      <div className={card}>
        <h2 className={h2}>🧠 Embedding Engine (Semantic Similarity)</h2>
        <h3 className={h3}>How It Works</h3>
        <p className={p}>
          Uses transformer models to convert text into <strong>384-dimensional vectors</strong> (embeddings),
          then computes <strong>cosine similarity</strong> between them. Pairs above a threshold (0.45) are
          reported as matches.
        </p>
        <h3 className={h3}>Available Models</h3>
        <ModelTable isDark={isDark} compact={compact} models={[
          ['Xenova/all-MiniLM-L6-v2', '~23 MB', 'Default. Fastest, good general-purpose.'],
          ['Xenova/bge-small-en-v1.5', '~33 MB', 'Strong retrieval performance.'],
          ['Xenova/gte-small', '~30 MB', 'High accuracy for general text.'],
        ]} />
        <h3 className={h3}>Example</h3>
        <CodeBlock isDark={isDark} compact={compact}>{`Contract:  "Will the Fed cut rates in September?"
Signal:    "Powell hints at borrowing cost relief coming soon"

Heuristic: NO MATCH (no shared keywords/entities)
Embedding: MATCH (cosine similarity = 0.78 — semantically very close)`}</CodeBlock>
        <h3 className={h3}>Pros</h3>
        <ul className={ul}>
          <li>Semantic matching — catches paraphrases, synonyms, related concepts.</li>
          <li>No knowledge base needed — works on any text.</li>
          <li>Language-agnostic concepts — &ldquo;Bitcoin&rdquo; and &ldquo;BTC&rdquo; cluster together.</li>
        </ul>
        <h3 className={h3}>Cons</h3>
        <ul className={ul}>
          <li>Model download — 23–33 MB (cached afterward).</li>
          <li>Slower — ~50–200ms per text vs. &lt;1ms for heuristic.</li>
          <li>No direction — knows topics match, not if sentiment is bullish/bearish.</li>
        </ul>
      </div>

      {/* Sentiment */}
      <div className={card}>
        <h2 className={h2}>📊 Sentiment Engine (Directional Analysis)</h2>
        <h3 className={h3}>How It Works</h3>
        <p className={p}>
          Uses a text classification model to classify emotional direction (positive, negative, neutral),
          then refines correlation confidence using keyword overlap + sentiment magnitude + virality.
          For news↔social pairs, sentiment alignment is checked — if both are bullish or both bearish,
          the correlation is stronger.
        </p>
        <h3 className={h3}>Available Models</h3>
        <ModelTable isDark={isDark} compact={compact} models={[
          ['Xenova/distilbert-base-uncased-finetuned-sst-2-english', '~67 MB', 'Default. General English sentiment.'],
          ['Xenova/twitter-roberta-base-sentiment-latest', '~120 MB', 'Tuned for social media text.'],
          ['Xenova/finbert', '~110 MB', 'Financial domain sentiment.'],
          ['Xenova/bert-base-multilingual-uncased-sentiment', '~134 MB', 'Multilingual sentiment.'],
        ]} />
        <h3 className={h3}>Example</h3>
        <CodeBlock isDark={isDark} compact={compact}>{`News:      "Tesla stock plunges 15% after disappointing earnings"
Signal:    "TSLA to the moon! 🚀🚀🚀"

Heuristic: MATCH (shares keyword "Tesla"/"TSLA")
Sentiment: MATCH + DIVERGENCE DETECTED
           News = -0.92 (very negative)
           Signal = +0.88 (very positive)
           → Sentiment divergence — social contradicts news`}</CodeBlock>
        <h3 className={h3}>Pros</h3>
        <ul className={ul}>
          <li>Directional awareness — knows bullish vs. bearish.</li>
          <li>Divergence detection — spots when social contradicts news.</li>
          <li>Domain-specific models — FinBERT for finance, Twitter RoBERTa for social.</li>
        </ul>
        <h3 className={h3}>Cons</h3>
        <ul className={ul}>
          <li>Still needs keyword overlap for candidate filtering.</li>
          <li>Larger models — 67–134 MB downloads.</li>
          <li>Slower — ~100–300ms per text.</li>
        </ul>
      </div>

      {/* ML-NER */}
      <div className={card}>
        <h2 className={h2}>🏷️ ML-Based NER Engine</h2>
        <h3 className={h3}>How It Works</h3>
        <p className={p}>
          Replaces regex-based entity extraction with a <strong>transformer NER model</strong> (BERT-NER).
          Each text is passed through a token classification model that identifies named entities with
          type labels: PER (person), ORG (organization), LOC (location), MISC (miscellaneous). The same
          weighted Jaccard similarity from the heuristic engine is then computed on the ML-extracted entity sets.
        </p>
        <h3 className={h3}>Available Models</h3>
        <ModelTable isDark={isDark} compact={compact} models={[
          ['Xenova/bert-base-NER-uncased', '~110 MB', 'Default. BERT fine-tuned on CoNLL-2003 NER.'],
          ['Xenova/bert-large-NER-uncased', '~340 MB', 'Large variant, higher accuracy.'],
        ]} />
        <h3 className={h3}>Example</h3>
        <CodeBlock isDark={isDark} compact={compact}>{`Text: "Jerome Powell announced a new rate cut at the Federal Reserve meeting"

Regex NER:  entities = ["Federal Reserve", "Jerome Powell"]
ML NER:     entities = [
              { text: "Jerome Powell", type: PER, confidence: 0.99 },
              { text: "Federal Reserve", type: ORG, confidence: 0.97 },
              { text: "rate cut", type: MISC, confidence: 0.71 },
              { text: "meeting", type: MISC, confidence: 0.58 }
            ]`}</CodeBlock>
        <h3 className={h3}>Pros</h3>
        <ul className={ul}>
          <li>Catches unknown entities — recognizes persons/orgs not in the knowledge base.</li>
          <li>Type-aware — knows &ldquo;Apple&rdquo; is an ORG vs. a fruit based on context.</li>
          <li>Confidence scores — model-calibrated, more reliable than fixed heuristic values.</li>
          <li>No maintenance — doesn&rsquo;t need manual knowledge base updates.</li>
        </ul>
        <h3 className={h3}>Cons</h3>
        <ul className={ul}>
          <li>Model download — 110–340 MB.</li>
          <li>Slower than regex — ~50–150ms per text vs. &lt;1ms for regex.</li>
          <li>English-only for default models.</li>
          <li>May miss domain-specific entities like tickers ($BTC).</li>
        </ul>
      </div>

      {/* LLM */}
      <div className={card}>
        <h2 className={h2}>🤖 LLM Engine (Text Generation)</h2>
        <h3 className={h3}>How It Works</h3>
        <p className={p}>
          Uses a <strong>small instruction-tuned LLM</strong> (e.g., SmolLM2, Qwen2.5) to
          reason about the relationship between a signal/news headline and a contract question. The
          LLM is prompted with the text and candidate questions and asked to return a relevance
          score (0–100). Pairs above a threshold (0.40) are reported as matches.
        </p>
        <p className={p}>
          Keyword overlap is used as a pre-filter to avoid running the LLM on
          every possible pair. Each LLM call handles one signal with up to 5 candidate questions,
          keeping the input small (~200 tokens) and output tiny (~20 tokens) for faster inference.
        </p>
        <h3 className={h3}>Available Models</h3>
        <ModelTable isDark={isDark} compact={compact} models={[
          ['HuggingFaceTB/SmolLM2-135M-Instruct', '~270 MB', 'Fastest LLM. Good for quick checks.'],
          ['HuggingFaceTB/SmolLM2-360M-Instruct', '~720 MB', 'Better reasoning than 135M.'],
          ['onnx-community/Qwen2.5-0.5B-Instruct-ONNX', '~500 MB', 'Strong small LLM, good quality.'],
        ]} />
        <h3 className={h3}>Example</h3>
        <CodeBlock isDark={isDark} compact={compact}>{`Contract:  "Will the Fed cut rates in September?"
Signal:    "Powell signals borrowing costs may ease soon, markets rally"

Heuristic: MATCH (shares "Fed"/"rates")
Embedding: MATCH (cosine = 0.78)
LLM:       MATCH with score = 85/100
           The LLM reasons that "borrowing costs may ease"
           implies a rate cut, strengthening the correlation.`}</CodeBlock>
        <h3 className={h3}>WebGPU vs. CPU (WASM)</h3>
        <p className={p}>
          LLMs are much larger than other ML models (270 MB – 720 MB). On CPU (WASM) they are
          {' '}<strong>very slow</strong> — each forward pass can take 2–10 seconds. If your browser
          supports <strong>WebGPU</strong>, TrendCast automatically uses it for 10–50× faster
          inference. If WebGPU is unavailable or fails, it falls back to WASM CPU automatically.
        </p>
        <p className={p}>
          Multi-threaded WASM is also enabled when cross-origin isolation is available, using all
          CPU cores to speed up inference.
        </p>
        <h3 className={h3}>Pros</h3>
        <ul className={ul}>
          <li>Best reasoning — understands nuance, sarcasm, and implied relationships.</li>
          <li>Most flexible — no pre-defined labels or entity lists needed.</li>
          <li>Context-aware — can distinguish &ldquo;Apple is rising&rdquo; from &ldquo;Apple is falling.&rdquo;</li>
          <li>Still 100% local — no API keys, no data leaves your browser.</li>
        </ul>
        <h3 className={h3}>Cons</h3>
        <ul className={ul}>
          <li>Largest downloads — 270 MB to 720 MB per model.</li>
          <li>Slowest on CPU — impractical without WebGPU for larger models.</li>
          <li>Higher memory usage — may strain low-RAM devices.</li>
          <li>Score calibration varies by model — threshold may need adjustment.</li>
        </ul>
      </div>

      {/* Comparison Table */}
      <h2 className={h2}>📋 Comparison Table</h2>
      <div className="overflow-x-auto mb-4">
        <table className={`w-full ${compact ? 'text-[10px]' : 'text-sm'} border-collapse`}>
          <thead>
            <tr className={tableHeader}>
              <th className={`p-2 text-left border ${tableBorder}`}>Feature</th>
              <th className={`p-2 text-center border ${tableBorder}`}>Heuristic</th>
              <th className={`p-2 text-center border ${tableBorder}`}>Embedding</th>
              <th className={`p-2 text-center border ${tableBorder}`}>Sentiment</th>
              <th className={`p-2 text-center border ${tableBorder}`}>ML-NER</th>
              <th className={`p-2 text-center border ${tableBorder}`}>LLM</th>
            </tr>
          </thead>
          <tbody className={tableRow}>
            {[
              ['Download size', '0 MB', '23–33 MB', '67–134 MB', '110–340 MB', '270 MB – 2.3 GB'],
              ['Speed', '⚡ Fastest', '🟡 Medium', '🟡 Medium', '🟡 Medium', '🔴 Slowest'],
              ['Semantic matching', '❌', '✅', '❌', '❌', '✅✅✅'],
              ['Sentiment direction', '❌', '❌', '✅', '❌', '✅ (reasoning)'],
              ['Entity extraction', '✅ (regex)', '❌', '❌', '✅✅ (ML)', '❌'],
              ['Novel entity support', '❌', '✅', '✅', '✅', '✅'],
              ['No keyword overlap needed', '❌', '✅', '❌', '❌', '✅ (pre-filter used)'],
              ['Reasoning / nuance', '❌', '❌', '❌', '❌', '✅✅✅'],
              ['WebGPU recommended', '—', '—', '—', '—', '✅✅✅'],
              ['Privacy (100% local)', '✅', '✅', '✅', '✅', '✅'],
            ].map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? '' : (isDark ? 'bg-slate-900/50' : 'bg-slate-50/50')}>
                <td className={`p-2 border ${tableBorder} font-medium`}>{row[0]}</td>
                {row.slice(1).map((cell, j) => (
                  <td key={j} className={`p-2 text-center border ${tableBorder}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Choosing the Right Engine */}
      <h2 className={h2}>🎯 Choosing the Right Engine</h2>
      <div className="overflow-x-auto mb-4">
        <table className={`w-full ${compact ? 'text-[10px]' : 'text-sm'} border-collapse`}>
          <thead>
            <tr className={tableHeader}>
              <th className={`p-2 text-left border ${tableBorder}`}>Use Case</th>
              <th className={`p-2 text-left border ${tableBorder}`}>Recommended Engine</th>
            </tr>
          </thead>
          <tbody className={tableRow}>
            {[
              ['Everyday use, fast results', 'Heuristic'],
              ['Best semantic matching', 'Embedding (all-MiniLM-L6-v2)'],
              ['Sentiment-aware analysis', 'Sentiment (FinBERT for finance)'],
              ['Best entity extraction', 'ML-NER (bert-base-NER)'],
              ['Best reasoning / nuance', 'LLM (Qwen2.5-1.5B with WebGPU)'],
              ['Low bandwidth / slow connection', 'Heuristic'],
              ['Financial news analysis', 'Sentiment (FinBERT)'],
              ['Social media analysis', 'Sentiment (Twitter RoBERTa)'],
              ['Novel/niche topics', 'Embedding or LLM'],
              ['Detecting sentiment divergence', 'Sentiment'],
              ['Has WebGPU & wants best quality', 'LLM (Qwen2.5-1.5B or Phi-3.5)'],
              ['CPU-only, wants LLM quality', 'LLM (SmolLM2-135M — smallest)'],
            ].map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? '' : (isDark ? 'bg-slate-900/50' : 'bg-slate-50/50')}>
                <td className={`p-2 border ${tableBorder} font-medium`}>{row[0]}</td>
                <td className={`p-2 border ${tableBorder}`}>{row[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Combining Engines */}
      <h3 className={h3}>Combining Engines</h3>
      <p className={p}>The engines are complementary. A common workflow:</p>
      <ol className={`${ul} list-decimal`}>
        <li>Start with <strong>Heuristic</strong> for fast initial results.</li>
        <li>Switch to <strong>Embedding</strong> when you suspect missed semantic connections.</li>
        <li>Use <strong>Sentiment</strong> when you want directional bias.</li>
        <li>Use <strong>ML-NER</strong> when entity extraction quality is critical.</li>
        <li>Use <strong>LLM</strong> when you need reasoning, nuance, or sarcasm detection (WebGPU recommended).</li>
      </ol>

      {/* Performance & Privacy */}
      <h2 className={h2}>🔒 Performance & Privacy</h2>
      <h3 className={h3}>All Models Run Locally</h3>
      <ul className={ul}>
        <li>Models download from Hugging Face Hub on first use, cached by browser Cache API.</li>
        <li>No text data is ever sent to any server.</li>
        <li>No API keys needed.</li>
        <li>ONNX Runtime Web executes models using WebAssembly (WASM).</li>
        <li>LLM models can also use <strong>WebGPU</strong> for GPU acceleration when available.</li>
        <li>Multi-threaded WASM is enabled when cross-origin isolation is present, using all CPU cores.</li>
      </ul>
      <h3 className={h3}>Performance Tips</h3>
      <ul className={ul}>
        <li>First run is slower — model downloads, then cached.</li>
        <li>Smaller models are faster — all-MiniLM-L6-v2 (23 MB) vs. bert-large-NER (340 MB).</li>
        <li>ML runs in a Web Worker — inference doesn&rsquo;t block the UI.</li>
        <li>Embeddings are cached — vectors reused for subsequent comparisons.</li>
        <li>Background worker pre-computes correlations after each hourly collection.</li>
      </ul>

      {/* Why ML-NER Is Slow */}
      <h3 className={h3}>Why ML-NER Is Slower Than Other Engines</h3>
      <p className={p}>
        If you&rsquo;ve used the Embedding or Sentiment engines and then tried ML-NER, you&rsquo;ll
        notice a significant speed difference. Here&rsquo;s why:
      </p>

      <div className={card}>
        <h3 className={h3}>🧠 Why Embedding Is Fast</h3>
        <p className={p}>
          The embedding engine pre-computes a <strong>single vector per text</strong> (one forward pass
          per contract, signal, or news headline). After that, comparing two texts is just a
          <strong> cosine similarity</strong> — a cheap math operation with no model inference:
        </p>
        <CodeBlock isDark={isDark} compact={compact}>{`Step 1: Embed all texts (one forward pass each)
  contracts[0] → [0.12, -0.34, ...]  ← 1 model call
  contracts[1] → [0.08,  0.56, ...]  ← 1 model call
  signals[0]   → [0.44, -0.21, ...]  ← 1 model call
  ...
  Total model calls = contracts + signals + news

Step 2: Compare (no model needed!)
  cosine(signal_vec, contract_vec) → 0.78  ← pure math, ~0ms`}</CodeBlock>
        <p className={p}>
          So for 50 contracts + 229 signals + 100 news = <strong>~379 model calls total</strong>,
          and all pairwise comparisons are instant math.
        </p>
      </div>

      <div className={card}>
        <h3 className={h3}>️ Why ML-NER Is Slow</h3>
        <p className={p}>
          ML-NER runs a <strong>token classification model</strong> on every single text (contract,
          signal, news headline). Unlike the heuristic engine&rsquo;s regex (which is instant), the
          transformer processes each token through multiple attention layers:
        </p>
        <CodeBlock isDark={isDark} compact={compact}>{`For each text:
  Tokenize: "Jerome Powell announced a rate cut..."  → 12 tokens
  BERT forward pass: 12 tokens × 12 layers × 768 hidden dims
  Output: PER(0.99), ORG(0.97), MISC(0.71), ...

Total model calls = contracts + signals + news (same as embedding)`}</CodeBlock>
        <p className={p}>
          The model call count is the same as embedding (~379), but each call is <strong>much
          more expensive</strong>:
        </p>
        <ul className={ul}>
          <li><strong>BERT-NER models are larger</strong> — 110–340 MB vs. 23–33 MB for embedding models.</li>
          <li><strong>Token classification is heavier</strong> — BERT-NER processes every token through 12–24 transformer layers, while the embedding model only needs a single pooled output.</li>
          <li><strong>More tokens per text</strong> — NER needs full context, so longer texts = more tokens = slower inference. Embedding models can truncate more aggressively.</li>
          <li><strong>WASM penalty compounds</strong> — a 110 MB model that takes ~100ms on native CPU takes ~1–2 seconds on WASM.</li>
        </ul>
        <p className={p}>
          After entity extraction, the similarity comparison itself is fast (weighted Jaccard, same
          as heuristic). The bottleneck is purely the model inference per text.
        </p>
      </div>

      <div className={card}>
        <h3 className={h3}>📊 Speed Comparison (Approximate, WASM)</h3>
        <div className="overflow-x-auto mb-2">
          <table className={`w-full ${compact ? 'text-[10px]' : 'text-sm'} border-collapse`}>
            <thead>
              <tr className={tableHeader}>
                <th className={`p-2 text-left border ${tableBorder}`}>Engine</th>
                <th className={`p-2 text-center border ${tableBorder}`}>Model Calls</th>
                <th className={`p-2 text-center border ${tableBorder}`}>Per-Call Time</th>
                <th className={`p-2 text-center border ${tableBorder}`}>Total Time (est.)</th>
              </tr>
            </thead>
            <tbody className={tableRow}>
              {[
                ['Heuristic', '0', '<1ms', '<1s'],
                ['Embedding', '~379', '~50–200ms', '~20–80s'],
                ['Sentiment', '~379', '~100–300ms', '~40–120s'],
                ['ML-NER', '~379', '~1–2s', '~6–13min'],
                ['LLM (WebGPU)', '~229', '~0.5–2s', '~2–8min'],
                ['LLM (CPU/WASM)', '~229', '~2–10s', '~8–40min'],
              ].map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? '' : (isDark ? 'bg-slate-900/50' : 'bg-slate-50/50')}>
                  <td className={`p-2 border ${tableBorder} font-medium`}>{row[0]}</td>
                  <td className={`p-2 text-center border ${tableBorder}`}>{row[1]}</td>
                  <td className={`p-2 text-center border ${tableBorder}`}>{row[2]}</td>
                  <td className={`p-2 text-center border ${tableBorder}`}>{row[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={p}>
          Estimates assume ~50 contracts, ~229 signals, ~100 news items on a modern laptop with WASM.
          Actual times vary by CPU, browser, and model size.
        </p>
      </div>

      <div className={card}>
        <h3 className={h3}>💡 How to Make ML Engines Faster</h3>
        <ul className={ul}>
          <li><strong>Use the smaller model</strong> — BERT Base NER (110 MB) is faster than BERT Large NER (340 MB). For LLMs, SmolLM2-135M (270 MB) is fastest; Qwen2.5-1.5B (1.5 GB) is slowest.</li>
          <li><strong>Use WebGPU for LLMs</strong> — if your browser supports WebGPU, LLMs run 10–50× faster than on CPU. Chrome/Edge 113+ and recent Firefox nightlies support it.</li>
          <li><strong>Reduce data volume</strong> — disable unused data sources in settings (e.g., turn off Reddit or X if you only care about news→market correlations). Fewer items = fewer model calls.</li>
          <li><strong>Let it run in the background</strong> — the background worker pre-computes after each hourly collection. If you switch to ML-NER or LLM, the first collection will be slow, but subsequent dashboard loads will use cached results.</li>
          <li><strong>Use Heuristic for quick checks</strong> — get instant results, then switch to ML-NER or LLM for deeper analysis when you have time to wait.</li>
          <li><strong>Close other tabs</strong> — WASM inference is CPU-bound. Fewer competing tabs = more CPU for the model.</li>
          <li><strong>Be patient on first run</strong> — the model downloads on first use. After that it&rsquo;s cached, so only the inference time remains.</li>
        </ul>
      </div>

      {/* Correlation Run History */}
      <h2 className={h2}>🧪 Correlation Run History & Model Comparison</h2>
      <p className={p}>
        Every time a correlation run completes, TrendCast saves statistics about that run — the
        engine used, model, match counts, average and max confidence, and elapsed time. This
        history lets you <strong>compare engines and models side by side</strong> over time.
      </p>
      <ul className={ul}>
        <li>View past runs in the <strong>Model Comparison History</strong> table on the correlations tab.</li>
        <li>Each row shows the engine, model, match counts, avg/max confidence, and duration.</li>
        <li>Runs are sorted newest-first and can be cleared with the &ldquo;Clear&rdquo; button.</li>
        <li>Use it to decide which engine/model gives the best trade-off of quality vs. speed for your data.</li>
      </ul>

      {/* Troubleshooting */}
      <h2 className={h2}>🛠️ Troubleshooting</h2>
      <div className={card}>
        <h3 className={h3}>&ldquo;The ML runtime failed to load&rdquo;</h3>
        <ul className={ul}>
          <li>Switch to the Heuristic engine (no ML needed).</li>
          <li>Check your network connection (models download from Hugging Face CDN).</li>
          <li>Try a different model (smaller models are more likely to load).</li>
        </ul>
      </div>
      <div className={card}>
        <h3 className={h3}>&ldquo;Failed to load the ML model&rdquo;</h3>
        <ul className={ul}>
          <li>Check your network connection.</li>
          <li>Disable content blockers that might block huggingface.co.</li>
          <li>Try a different model.</li>
          <li>Switch to the Heuristic engine.</li>
        </ul>
      </div>
      <div className={card}>
        <h3 className={h3}>&ldquo;Correlation is slow&rdquo;</h3>
        <ul className={ul}>
          <li>Use a smaller model (e.g., all-MiniLM-L6-v2 instead of bert-large-NER).</li>
          <li>For LLMs, use SmolLM2-135M or Qwen2.5-0.5B — larger models are impractical on CPU.</li>
          <li>Check if WebGPU is available — LLMs are 10–50× faster with GPU acceleration.</li>
          <li>Reduce the number of collected items (disable unused data sources).</li>
          <li>Use Heuristic for quick checks, then switch to ML for deeper analysis.</li>
        </ul>
      </div>
      <div className={card}>
        <h3 className={h3}>&ldquo;No matches found&rdquo;</h3>
        <ul className={ul}>
          <li>Try a different engine — Embedding or LLM may catch semantic matches.</li>
          <li>Check that data sources are enabled in settings.</li>
          <li>Run a manual collection first (popup → &ldquo;Collect Now&rdquo;).</li>
          <li>Lower the highlight threshold in settings.</li>
        </ul>
      </div>
      <div className={card}>
        <h3 className={h3}>&ldquo;LLM engine is too slow&rdquo;</h3>
        <ul className={ul}>
          <li>Switch to SmolLM2-135M (270 MB) — the smallest and fastest LLM.</li>
          <li>Check WebGPU support — without it, LLMs run on CPU and are very slow.</li>
          <li>Use a non-LLM engine (Embedding) for similar quality at lower cost.</li>
          <li>Reduce data sources to lower the number of LLM forward passes.</li>
          <li>Let the background worker pre-compute — first run is slow, later loads use cache.</li>
        </ul>
      </div>
      <div className={card}>
        <h3 className={h3}>&ldquo;LLM model failed to load&rdquo;</h3>
        <ul className={ul}>
          <li>LLM models are large (270 MB – 2.3 GB) — check your network and available disk/memory.</li>
          <li>Try a smaller model (SmolLM2-135M or Qwen2.5-0.5B).</li>
          <li>If WebGPU init failed, the engine retries on CPU automatically — but CPU may be too slow for large models.</li>
          <li>Disable content blockers that might block huggingface.co.</li>
          <li>Switch to a non-LLM engine if the model won&rsquo;t load.</li>
        </ul>
      </div>
      <div className={card}>
        <h3 className={h3}>&ldquo;Sentiment results seem wrong&rdquo;</h3>
        <p className={p}>Different sentiment models are tuned for different text types:</p>
        <ul className={ul}>
          <li><strong>General news</strong> → DistilBERT SST-2</li>
          <li><strong>Social media</strong> → Twitter RoBERTa</li>
          <li><strong>Financial news</strong> → FinBERT</li>
          <li><strong>Multilingual</strong> → Multilingual BERT</li>
        </ul>
      </div>
    </div>
  );
}

// ── Helper sub-components ──────────────────────────────────────────

function ModelTable({ models, isDark, compact }: { models: [string, string, string][]; isDark: boolean; compact: boolean }) {
  const tableHeader = isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700';
  const tableRow = isDark ? 'text-slate-400' : 'text-light-muted';
  const tableBorder = isDark ? 'border-slate-700' : 'border-light-border';
  return (
    <div className="overflow-x-auto mb-2">
      <table className={`w-full ${compact ? 'text-[10px]' : 'text-sm'} border-collapse`}>
        <thead>
          <tr className={tableHeader}>
            <th className={`p-2 text-left border ${tableBorder}`}>Model</th>
            <th className={`p-2 text-center border ${tableBorder}`}>Size</th>
            <th className={`p-2 text-left border ${tableBorder}`}>Description</th>
          </tr>
        </thead>
        <tbody className={tableRow}>
          {models.map(([name, size, desc], i) => (
            <tr key={i} className={i % 2 === 0 ? '' : (isDark ? 'bg-slate-900/50' : 'bg-slate-50/50')}>
              <td className={`p-2 border ${tableBorder} font-mono`}>{name}</td>
              <td className={`p-2 text-center border ${tableBorder}`}>{size}</td>
              <td className={`p-2 border ${tableBorder}`}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ children, isDark, compact }: { children: ReactNode; isDark: boolean; compact: boolean }) {
  const codeBg = isDark ? 'bg-slate-950 text-slate-300' : 'bg-slate-100 text-slate-700';
  return (
    <pre className={`${codeBg} ${compact ? 'text-[10px]' : 'text-xs'} rounded-lg p-3 overflow-x-auto mb-2`}>
      <code>{children}</code>
    </pre>
  );
}