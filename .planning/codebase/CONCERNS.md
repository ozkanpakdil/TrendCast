# Codebase Concerns

**Analysis Date:** 2026-08-22

## Tech Debt

**Duplicated FAQ block in popup:**
- Issue: The FAQ content block is rendered three times in the popup's tab switch. `{activeTab === 'faq' && (<FAQContent compact isDark />)}` appears at lines 196, 200, and 204 of `src/popup/App.tsx`. This is redundant JSX that renders the same component three times when the FAQ tab is active.
- Files: `src/popup/App.tsx`
- Impact: Redundant DOM output and wasted render work; confusing to maintain. Likely a copy-paste artifact.
- Fix approach: Remove the two duplicate blocks, keeping a single `{activeTab === 'faq' && (<FAQContent compact isDark />)}`.

- **Empty socials content script:**
- Issue: `src/content/socials/index.ts` is an empty file (0 bytes), yet the manifest declares it as the content script for x.com/twitter/reddit/tiktok with `overlay.css` (`src/manifest.config.ts` lines 126–127). The social scraping and odds-overlay injection for these platforms is not implemented.
- Files: `src/content/socials/index.ts`, `src/manifest.config.ts`
- Impact: The extension claims to collect X/Twitter/Reddit/TikTok signals and inject odds overlays, but the content script does nothing. Social signals for these platforms can only come from the background collectors (Reddit `.json`, X via Google Trends RSS), not from live page DOM scraping. TikTok has no background collector, so TikTok signals are never actually collected despite being a declared source.
- Fix approach: Implement the social scraping logic in `src/content/socials/index.ts`, or remove the empty script and its manifest declaration until implemented.

- **Large component files:**
- Issue: Several UI files exceed 500 lines, making them hard to navigate and test.
- Files: `src/dashboard/components/CorrelationPanel.tsx` (1032 lines), `src/background/index.ts` (883 lines), `src/dashboard/App.tsx` (748 lines), `src/dashboard/components/FAQContent.tsx` (674 lines), `src/dashboard/components/HistoryChart.tsx` (500 lines).
- Impact: High cognitive load; `CorrelationPanel.tsx` mixes graph simulation, rendering, and list views in one file. `background/index.ts` mixes orchestration, merging, history, and ML worker management.
- Fix approach: Extract sub-components (e.g., graph canvas, list views) and split background orchestration into focused modules.

- **Duplicate entries in curated lexicons/knowledge bases:**
- Issue: `src/utils/sentiment.ts` contains duplicate words in its positive/negative lexicons (e.g., 'worried' and 'hurt' appear twice in the negative lexicon). `src/utils/entities.ts` has a casing-inconsistent duplicate key `'deSantis'` alongside `'desantis'` in `KNOWN_PERSONS`.
- Files: `src/utils/sentiment.ts`, `src/utils/entities.ts`
- Impact: Duplicate entries are harmless to the Set-based lookups but indicate sloppy curation and can mask intent (e.g., a word intended to be in one polarity accidentally duplicated in another).
- Fix approach: Deduplicate lexicon entries and normalize entity keys to a single casing.

- **Inline eslint-disable suppressions:**
- Issue: Several `eslint-disable` comments suppress rules rather than fixing the underlying issue.
- Files: `src/dashboard/App.tsx` (line 137 `react-hooks/exhaustive-deps`), `src/dashboard/components/CorrelationPanel.tsx` (lines 416, 428 `react-hooks/exhaustive-deps`), `src/messaging/index.ts` (line 104 `@typescript-eslint/no-explicit-any`).
- Impact: Suppressed exhaustive-deps warnings can hide stale-closure bugs in hooks.
- Fix approach: Refactor the hooks to satisfy the dependency arrays rather than suppressing.

## Known Bugs

- **Duplicate FAQ rendering in popup:**
- Symptoms: The FAQ content block is rendered three times when the FAQ tab is active in the popup.
- Files: `src/popup/App.tsx` (lines 196, 200, 204)
- Trigger: Open the popup and switch to the FAQ tab.
- Workaround: None needed (renders identically), but it is a correctness defect.

- **TikTok signals never collected:**
- Symptoms: TikTok is a declared enabled source (`enabledSources.tiktok` in `src/types/index.ts` and the mock in `tests/e2e/fixtures.ts`), but there is no TikTok collector and the social content script is empty.
- Files: `src/content/socials/index.ts`, `src/services/collectors/`
- Trigger: Enabling TikTok in settings produces no TikTok signals.
- Workaround: None — feature is unimplemented.

## Security Considerations

- **Broad host permissions:**
- Risk: `host_permissions` in `src/manifest.config.ts` (lines 161–175) grant access to many domains (polymarket, kalshi, x.com, twitter, reddit, tiktok, bbc, cnn, seekingalpha, investing, rss2json, huggingface). These trigger user consent prompts and, if a content script were compromised, expand the attack surface.
- Files: `src/manifest.config.ts`
- Current mitigation: Content scripts run in an isolated world and only read the DOM; no credentials are handled (the browser sends session cookies automatically). `data_collection_permissions` is declared `required: ['none']`.
- Recommendations: Keep the permission set minimal; remove domains not actively scraped (e.g., TikTok until implemented). Review whether `tabs` and `scripting` permissions are both necessary.

- **`wasm-unsafe-eval` in CSP:**
- Risk: The extension CSP allows `'wasm-unsafe-eval'` (`src/manifest.config.ts` line 219), required by ONNX Runtime Web for ML inference.
- Files: `src/manifest.config.ts`
- Current mitigation: The CSP otherwise restricts to `'self'` for scripts and objects; `'unsafe-inline'` is only for styles.
- Recommendations: This is a necessary trade-off for on-device ML; keep it and ensure no other `unsafe-eval`/`unsafe-inline` script sources are added.

- **Third-party CORS proxy dependency:**
- Risk: All RSS feeds are fetched through `api.rss2json.com` (`src/config/index.ts` lines 89–133). This third-party service sees all feed requests and is a single point of failure / supply-chain surface.
- Files: `src/config/index.ts`
- Current mitigation: No API keys are used; requests are unauthenticated public RSS.
- Recommendations: Consider a self-hosted proxy or direct fetch where CORS allows; monitor rss2json availability.

- **No secrets in repo:**
- Positive: No API keys or credentials are stored; `.env` files are not read. The extension runs entirely client-side.

## Performance Bottlenecks

- **O(n×m) correlation loops:**
- Problem: The heuristic engine (`src/services/engine/correlation.ts`) and the NER engine (`src/services/engine/ml/ner.ts`) iterate signals × contracts (and news × signals) in nested loops. The NER engine pre-extracts entities in batches but still compares every signal against every contract.
- Files: `src/services/engine/correlation.ts`, `src/services/engine/ml/ner.ts`
- Cause: No index on contracts by keyword; every pair is compared.
- Improvement path: Build a keyword→contract inverted index to only compare candidates sharing keywords (the zero-shot engine already does this via `findCandidateContracts` in `src/services/engine/ml/zeroshot.ts`).

- **Uncapped signal/news accumulation:**
- Problem: `mergeSignals` and `mergeNews` in `src/background/index.ts` (lines 775–790) keep ALL signals and news with no cap. A full cycle can produce ~460 news items across 6 sources.
- Files: `src/background/index.ts`
- Cause: Deliberate design choice to avoid dropping sources, relying on `pruneStorageIfNeeded` to evict oldest when over the 7 MB budget.
- Impact: Storage grows until pruning kicks in; correlation passes process ever-growing arrays, slowing each hourly run.
- Improvement path: Add per-key caps (e.g., max signals/news) in addition to byte-budget pruning.

- **Large ML model downloads:**
- Problem: LLM models up to 1.5 GB (`onnx-community/Qwen2.5-1.5B-Instruct-ONNX`) and 720 MB (`HuggingFaceTB/SmolLM2-360M-Instruct`) are downloaded from the Hugging Face CDN on first use (`src/config/index.ts` lines 282–300). WASM CPU inference on these is slow.
- Files: `src/config/index.ts`, `src/services/engine/ml/llm.ts`
- Cause: On-device inference requires the full model in the browser.
- Improvement path: Default to smaller models; gate large models behind explicit user opt-in; surface WebGPU availability (already detected in `src/services/engine/ml/transformers.ts`).

- **Storage byte estimation cost:**
- Problem: `estimateBytes` in `src/utils/storage.ts` uses `new Blob([JSON.stringify(value)]).size`, which serializes the entire dataset on every budget check after each collection cycle.
- Files: `src/utils/storage.ts`
- Impact: Adds serialization overhead on the hot path.
- Improvement path: Cache sizes incrementally or sample rather than full re-serialize.

## Fragile Areas

- **DOM-scraping content scripts:**
- Files: `src/content/prediction-markets/index.ts`, `src/content/news/index.ts`
- Why fragile: They rely on broad, brittle CSS selectors (e.g., `[class*="market-card"]` in `src/content/prediction-markets/index.ts`) and MutationObserver + URL polling. Site layout changes break scraping silently.
- Safe modification: Keep selectors defensive (fallback to text/URL heuristics); add tests that mock the DOM.
- Test coverage: No unit tests for content scripts.

- **Third-party service dependencies:**
- Problem: The extension depends on `api.rss2json.com` (all RSS) and the Hugging Face CDN (model downloads). Both are external and can rate-limit or go down.
- Files: `src/config/index.ts`
- Why fragile: A rss2json outage stops all news collection; a Hugging Face outage blocks ML model loading.
- Safe modification: Add retry/backoff (already partially via `conditional-fetch.ts` ETag caching) and graceful degradation when models fail to load.

- **MV3 service worker ephemerality:**
- Problem: The background service worker (`src/background/index.ts`) is ephemeral in MV3; long ML runs and the 300s worker idle timeout (`src/workers/ml-worker.ts`) can be interrupted by the browser.
- Files: `src/background/index.ts`, `src/workers/ml-worker.ts`
- Why fragile: A worker restart mid-collection loses in-memory state; the code uses fire-and-forget `CORRELATE_ALL` to avoid "Promised response went out of scope" errors.
- Safe modification: Persist partial state and resume; keep the idle timeout conservative.

## Scaling Limits

- **Storage quota:**
- Current capacity: 7 MB soft budget against a ~10 MB `chrome.storage.local` quota (`src/config/index.ts` lines 174–178).
- Limit: Uncapped signals/news growth triggers pruning; history is capped at `maxHistoryEntries` (default 168) and `MAX_RUN_HISTORY=50` in `src/dashboard/hooks/useCorrelations.ts`.
- Scaling path: Add per-key caps and consider IndexedDB for large datasets.

- **Correlation compute:**
- Current: O(signals × contracts) per engine pass; three passes (signals→markets, news→markets, news→signals).
- Limit: As markets/signals grow, each hourly run takes longer and risks exceeding the worker idle timeout.
- Scaling path: Keyword inverted index (as in zero-shot) and candidate pre-filtering across all engines.

## Dependencies at Risk

- **@crxjs/vite-plugin (beta):**
- Risk: Pinned to `^2.0.0-beta.28` in `package.json` — a beta release used for the core build pipeline.
- Impact: API churn or bugs in the build tooling; Firefox/Chrome manifest generation depends on it.
- Migration plan: Track stable releases; the `browser: 'firefox'` option already handles the `use_dynamic_url` Firefox incompatibility (`vite.config.ts`).

- **rss2json.com (free tier):**
- Risk: Free CORS proxy; rate limits and availability are not guaranteed.
- Impact: All news collection stops if it fails.
- Files: `src/config/index.ts`
- Migration plan: Self-host a proxy or use direct fetch where CORS allows.

- **Hugging Face CDN:**
- Risk: Model weights are fetched from `huggingface.co` at runtime; CDN changes or outages block ML.
- Impact: ML engines fail to load models.
- Files: `src/config/index.ts`, `src/services/engine/ml/transformers.ts`
- Migration plan: Bundle small models or pin model revisions.

## Missing Critical Features

- **TikTok collection:**
- Problem: TikTok is a declared source but has no collector and the social content script is empty.
- Files: `src/content/socials/index.ts`, `src/services/collectors/`
- Blocks: TikTok signals cannot be collected or correlated.

- **Social content-script scraping:**
- Problem: The declared social content script (`src/content/socials/index.ts`) is empty, so X/Twitter/Reddit page-level scraping and odds overlays are not implemented.
- Files: `src/content/socials/index.ts`
- Blocks: Overlay injection and richer social signal collection.

## Test Coverage Gaps

- **ML engines untested:**
- What's not tested: `src/services/engine/ml/` (embedding, sentiment, zeroshot, ner, llm, transformers, math) — no unit tests.
- Files: `src/services/engine/ml/*.ts`
- Risk: Model pipeline changes (batching, caching, thresholds) can regress silently.
- Priority: High

- **Collectors untested:**
- What's not tested: `src/services/collectors/` (polymarket, kalshi, reddit, x-trends, news) — no unit tests for parsing/error handling.
- Files: `src/services/collectors/*.ts`
- Risk: Feed format changes break collection unnoticed.
- Priority: High

- **Utilities untested:**
- What's not tested: `src/utils/sentiment.ts`, `src/utils/entities.ts`, `src/utils/storage.ts`, `src/utils/conditional-fetch.ts`, `src/utils/export.ts`.
- Files: `src/utils/*.ts`
- Risk: Lexicon/entity changes and storage pruning logic are unverified.
- Priority: Medium

- **Background/messaging untested:**
- What's not tested: `src/background/index.ts` orchestration and `src/messaging/index.ts` retry logic.
- Files: `src/background/index.ts`, `src/messaging/index.ts`
- Risk: The fire-and-forget correlation flow and message retry are critical paths with no coverage.
- Priority: High

- **Content scripts untested:**
- What's not tested: `src/content/prediction-markets/index.ts`, `src/content/news/index.ts` DOM scraping.
- Files: `src/content/*/index.ts`
- Risk: Brittle selectors break silently.
- Priority: Medium

- **Existing coverage:** Only one unit test file exists: `tests/unit/correlation.test.ts` (tests `extractKeywords`, `keywordSimilarity`, `correlate`). E2E tests cover the dashboard and popup UI (`tests/e2e/dashboard.spec.ts`, `tests/e2e/popup.spec.ts`) and screenshots (`tests/screenshots/screenshots.spec.ts`) via the browser mock in `tests/e2e/fixtures.ts`.

---

*Concerns audit: 2026-08-22*
