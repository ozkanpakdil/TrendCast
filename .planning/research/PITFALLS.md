# Pitfalls Research

**Domain:** Fixing correlation matching (ticker/cashtag bridging), ML worker progress propagation, analysis trigger scheduling, and result persistence — in an existing 100% client-side MV3 browser extension with a mature correlation engine
**Researched:** 2026-08-27
**Confidence:** HIGH (code-grounded: every pitfall verified against actual source in `src/utils/keywords.ts`, `src/services/engine/correlation.ts`, `src/services/engine/ml/*`, `src/workers/ml-worker.ts`, `src/background/index.ts`, `src/dashboard/hooks/useCorrelations.ts`, `src/dashboard/App.tsx`; external claims verified against Chrome developer docs and Transformers.js API docs)

---

## Critical Pitfalls

### Pitfall 1: Normalizing tickers on only one side (or only at collection time)

**What goes wrong:**
The team "fixes" the bridging by normalizing the stock-indicator news keywords (`amzn` → `$amzn`, or the reverse) in one place — usually the collector or `extractKeywords` — and ships. Correlation still fails because the other side (social signals carrying `$AMZN`, contract questions, entity-derived keywords in `src/utils/entities.ts`) still produces the old form, or because **already-stored items** keep their old keyword arrays until re-collected. The correlation engine runs over `chrome.storage.local` contents; normalization applied only at extraction time leaves days of stored data un-bridged.

**Why it happens:**
`extractKeywords` (`src/utils/keywords.ts`) stores cashtags **with** the `$` (`$amzn`, lowercased) but plain words **without** (`amzn`). These are two different string forms of the same entity, and every consumer — `keywordSimilarity`, `extractEntityKeywords`, the inverted index postings in `src/services/engine/index.ts`, and `candidateKeywords()` — does exact string matching. There are at least four producers (news collector keywords, social cashtag extraction, entity extraction, contract question parsing) and it's tempting to patch the one that's visibly broken.

**How to avoid:**
- Normalize at a **single choke point** that every producer and every consumer passes through — e.g. a `normalizeTickerKeyword(k: string): string` applied inside `extractKeywords`, `extractEntityKeywords`, and the inverted-index build/query path. Pick one canonical form (bare lowercase ticker, `amzn`) and strip `$`/`#` prefixes everywhere.
- Normalize **at correlation time**, not only at collection time — either normalize when loading items from storage in `runCorrelationAsync`, or make the index/similarity functions normalize on read. Stored old-format data must correlate without waiting for re-collection.
- Add a fixture test with the exact reported shape: news keywords `[amzn, vcp, 2026]` vs social text containing `$AMZN` must produce a match through `correlateNewsSocial`.

**Warning signs:**
- The new unit test passes on freshly-built fixtures but the user reports stock-indicator items still don't correlate (stored data is old-format).
- `correlation-equivalence` or `embedding-equivalence` suites fail after the change — a sign the normalization changed one code path but not its twin.
- Grepping for `\$[A-Z]` finds the cashtag regex in more than one file.

**Phase to address:** Phase 1 (ticker/cashtag bridging). The choke-point decision is the first commit of the phase; retrofitting it after per-site patches is a rewrite.

---

### Pitfall 2: Breaking the inverted-index superset invariant (index path silently misses what the naive loop finds)

**What goes wrong:**
The correlation engine has two paths: a naive nested loop (inputs below `InvertedIndex.TINY_INPUT_THRESHOLD`) and a candidate-filtered path (index built from `item.keywords` + entity keywords, queried via `candidateKeywords()`). The code comments explicitly call the superset property "must-have truth #4": the index query keywords must be a **superset** of what the naive loop would match on. If normalization is added to the similarity functions but not to `candidateKeywords()` / the index postings (or vice versa), the fast path returns fewer matches than the slow path — and because the fast path is what runs in production (real data exceeds the tiny threshold), the bug is invisible in small unit tests and shows up as "some tickers correlate, others don't."

**Why it happens:**
The index is keyed by exact keyword strings. Introducing a normalized form on one side of the match (query side but not postings side, or the reverse) desynchronizes the two. This is the exact class of bug the existing `correlation-equivalence` suite exists to catch — and it's also easy to "fix" a failing equivalence test by weakening the assertion instead of fixing the invariant.

**How to avoid:**
- Apply normalization inside the index build AND `candidateKeywords()` AND the pairwise similarity — never at just one layer.
- Treat any `correlation-equivalence` failure as a real invariant break, not test noise. Do not relax the equivalence assertions to make the suite green.
- Add an explicit property test: for random inputs above the tiny threshold, `indexPath(signals, contracts)` ⊇ `naiveLoop(signals, contracts)` with mixed-case/cashtag inputs.

**Warning signs:**
- Matches appear with tiny fixture inputs but vanish with realistic dataset sizes.
- A code review diff touches `candidateKeywords` or the index build but not both.

**Phase to address:** Phase 1 (ticker/cashtag bridging). Verification: equivalence suites + a new mixed-form property test must pass before the phase closes.

---

### Pitfall 3: Over-bridging — treating every bare word as a potential ticker

**What goes wrong:**
The obvious fix — "strip `$` and match bare tokens" — creates false-positive bridges: the stock-indicator keyword list includes things like `vcp` (a screener pattern acronym, Volatility Contraction Pattern — not a listed ticker), years like `2026`, and generic words. Meanwhile real tickers collide with English words (`ALL` = Allstate vs "all", `ON` = ON Semiconductor vs the stop word "on"). Over-bridging floods the correlation tab with garbage matches and erodes the trust this milestone exists to build — worse than under-bridging, because the user can't tell which matches are real.

**Why it happens:**
The current cashtag regex `\$[A-Z]{2,}` is a *precision* filter (the `$` prefix is strong evidence of ticker intent). Removing the prefix as the discriminator without adding a replacement discriminator trades precision for recall indiscriminately.

**How to avoid:**
- Bridge only when there's independent evidence of ticker-ness: a small ticker allowlist (even just the user's watchlist symbols + S&P 500 tickers is enough for a personal tool), or a strict shape check (2–5 uppercase alphabetic chars, not a stop word, not purely numeric).
- Keep numeric keywords (`2026`) out of ticker bridging entirely — they are dates, not entities.
- Prefer *boosting* a bridged match (like the existing `CASHTAG_BOOST`) over letting bridged matches clear `MIN_CONFIDENCE` on their own.
- Decide the ambiguity policy explicitly and document it: when a bare word is both a common word and a ticker, which wins? (Recommendation: exact cashtag form wins; bare-word ticker matches get a lower confidence ceiling.)

**Warning signs:**
- Correlation match count jumps significantly after the fix with no new data.
- Manual spot-check of top matches shows non-stock items (e.g. "vcp" matching a VCP-pattern screener headline to an unrelated market).
- Alert volume (watchlist-scoped, deduped) increases — alerts amplify false positives.

**Phase to address:** Phase 1 (ticker/cashtag bridging). Verification: golden-file test with known ambiguous inputs (`vcp`, `2026`, `all`) asserting they do NOT bridge; alert-sweep regression test.

---

### Pitfall 4: ML progress — model download is a silent black box (progress_callback never wired)

**What goes wrong:**
The embedding pipeline creation (`createPipelineWithFallback` in `src/services/engine/ml/transformers.ts`) calls `lib.pipeline(task, model, options)` **without a `progress_callback`**. Transformers.js reports per-file download progress (`status: initiate|download|progress|done`, `loaded`/`total` bytes) only through that callback. On first run (cold Cache API), downloading Xenova/gte-small takes tens of seconds to minutes during which the app emits **zero** progress events — the dashboard shows the "loading indicator without progress" spinner, which the user reads as "stuck." The per-batch inference progress in `EmbeddingStore.embed()` only starts *after* the pipeline resolves.

**Why it happens:**
The existing progress plumbing (worker → `mlWorkerResolvers.onProgress` → `CORRELATION_PROGRESS` broadcast → dashboard) only carries *inference* progress with `phase`/`current`/`total` semantics. Download progress has a different shape (per-file byte fractions, no phase concept) so it was never wired into the same channel.

**How to avoid:**
- Pass `progress_callback` in the options object of every `lib.pipeline(...)` call (all five `get*Pipeline` functions), mapping file events into the existing `ProgressCallback` shape — e.g. `phase: 'model-download'`, `current: loaded`, `total: total` — and forward via the worker's existing `postMessage` protocol.
- Emit a synthetic "downloading model" progress event *before* pipeline creation so the UI switches from spinner to progress bar immediately.
- Handle the warm-cache case: when files come from cache, `progress` events may be skipped or instant — the UI must not require them (see Pitfall 5).

**Warning signs:**
- First-run on a fresh profile shows a spinner for >30s with no bar; second run shows a bar immediately.
- `console.log('[TrendCast] ML: creating embedding pipeline…')` appears in logs but no `CORRELATION_PROGRESS` messages follow for the whole download.

**Phase to address:** Phase 2 (ML progress fix). This is the root-cause fix; the UI-side fixes (Pitfalls 5–6) are secondary.

---

### Pitfall 5: Progress state with no terminal state — the "stuck bar" class of bugs

**What goes wrong:**
The dashboard's progress UI (`useCorrelations` + `App.tsx`) shows the bar while `corrLoading && corrProgress`. The bar only clears when `applyResult` runs. Three real paths leave it stuck even though the worker finished (or died):
1. **requestId gating:** `applyResult` rejects results whose `requestId` doesn't match `requestIdRef.current`. Background-initiated runs (the `corrInitRef` auto-run, post-collection pre-compute) generate their own `corr-${Date.now()}` id — if the dashboard has an active request with a different id (or the stored result lacks the id), the `CORRELATION_RESULT` message is dropped as "stale" and the last progress frame freezes forever.
2. **Worker death without error:** the ML worker is spawned from the MV3 service worker. If the background SW is killed (30s idle timer is reset by progress messages, but a long silent ONNX load can still hit the 5-minute single-request cap; Firefox has its own lifetime rules), the worker dies mid-run. No `error` message is ever posted → `loading` stays true, progress frozen.
3. **Error path leaves progress set:** the worker posts `{type:'error'}`; if any handler path fails to map that to `setLoading(false); setProgress(null)`, the bar survives.

**Why it happens:**
Progress is treated as a stream with an implied "result will always arrive" contract. MV3 violates that contract routinely — the codebase already knows this (the storage-polling fallback exists precisely because messages get missed) but the fallback only covers the result, not the *terminal-state* guarantee, and it's gated by the same requestId check.

**How to avoid:**
- Make the **storage write the source of truth** and the message a hint: on any progress state older than N seconds, poll storage for a result whose `requestId` matches *either* the active id *or* the id the background recorded for the current run (persist a `currentRun` marker: `{ requestId, startedAt, engine }` written by the background when it starts).
- Add a **staleness watchdog** in the dashboard: if `corrLoading` and no progress change and no storage result for >X seconds (scaled to engine — heuristic 10s, embedding 120s, LLM 10min), show "still working / retry" instead of a frozen bar.
- Every terminal path — result, error, cancel, worker death — must funnel through one `settle()` function that clears `loading` + `progress` + timer. Audit that the worker `error` message maps to it.
- On the background side, wrap `runCorrelationAsync` so that a caught failure **always** writes an error result to `CONFIG.storage.correlations` (it already does for thrown errors — verify the worker-error path also lands there).

**Warning signs:**
- Bug reports say "progress stuck at N/M" with the number frozen at a batch boundary (worker died) or at 0% (download, Pitfall 4).
- DevTools console shows `Ignoring stale result (requestId mismatch)` immediately followed by nothing — that log line is the smoking gun for cause 1.

**Phase to address:** Phase 2 (ML progress fix). Verification: unit test that a result with a foreign requestId still settles the UI when no active request owns the run; e2e test that killing the worker mid-run recovers.

---

### Pitfall 6: Late/out-of-order progress messages resurrecting a finished run

**What goes wrong:**
The dashboard listener applies any `CORRELATION_PROGRESS` message unconditionally (`setProgress(data.payload)`). PostMessage and `runtime.sendMessage` don't guarantee ordering relative to the result across contexts, and the background broadcasts progress for *any* active run. A progress message that arrives after `CORRELATION_RESULT` (or a progress message from a *previous* run that was cancelled) re-sets `progress` — the UI shows a live-looking bar for a run that already finished, or flashes a stale percentage. This is the mirror image of Pitfall 5 and often gets misdiagnosed as it.

**Why it happens:**
The progress payload carries a `requestId`, but the listener ignores it — only `applyResult` checks ids.

**How to avoid:**
- Gate progress application on the requestId too: ignore progress whose `requestId` ≠ `requestIdRef.current` (and ignore any progress once the run has settled).
- Include the requestId in the worker→background progress relay (it already does) and preserve it through the broadcast (it does) — the fix is purely on the dashboard filter side.
- When `applyResult` runs, set a `settledRequestIdRef` and have the progress listener drop messages for settled ids.

**Warning signs:**
- Progress bar reappears for a second after "done," or shows an old percentage after cancel.
- Logs show progress messages interleaved after `CORRELATION_RESULT received`.

**Phase to address:** Phase 2 (ML progress fix). Cheap to fix alongside Pitfall 5 in the same listener refactor.

---

### Pitfall 7: Analysis-trigger logic keyed off in-memory state and racing itself

**What goes wrong:**
The new rule is: auto-analyze on dashboard open **only if no analysis exists**; otherwise re-analyze only after collectNow completes. Naive implementations break three ways:
1. **"Exists" checked in React state, not storage:** the check runs before the storage load promise resolves → "no analysis" is the default answer → auto-analyze fires on *every* open, exactly the behavior being removed. (The current `corrInitRef` effect fires on `snapshot` arrival; the cached-correlations load in `useCorrelations` is a separate async effect — ordering between them is not guaranteed.)
2. **Double-fire race:** two effects (mount-check and collectNow-completion) both decide to run; or React StrictMode in dev double-invokes the mount effect. Two concurrent `CORRELATE_ALL` requests → two ML worker runs → interleaved progress messages (feeding Pitfall 6) and a storage write race.
3. **Error results count as "analysis exists":** `runCorrelationAsync` persists error results (`{matches: [], error}`) to the correlations key. If "analysis exists" = "key is non-empty," one failed run permanently suppresses auto-analysis — the user sees stale/empty correlations forever with no retry.

**Why it happens:**
Storage-as-state means the truth is async; effects naturally race the load. And the persisted shape conflates "a run happened" with "a *usable* analysis exists."

**How to avoid:**
- Gate the mount-time decision on the **loaded cached correlations** (the same value `useCorrelations` hydrates from storage), not on a parallel storage read. Concretely: the auto-analyze effect should depend on a `correlationsLoaded` flag that flips only after the storage get resolves.
- Define "analysis exists" as: cached result present **and** `!cached.error` **and** (optionally) `computedAt` newer than the newest collected item. Persist a `computedAt`/`requestId`/`engine` metadata block with the result to make this check cheap and unambiguous.
- Serialize triggers through a single `maybeRunAnalysis(reason)` function with an in-flight guard (`if (runningRef.current) return`), so mount-check, collectNow-completion, and manual re-analyze can never run concurrently.
- For StrictMode: the existing `corrInitRef` pattern (run-once ref) is correct — keep it, but move the *condition* (exists-check) inside the guarded block.

**Warning signs:**
- Network/storage log shows `CORRELATE_ALL` firing on every new-tab open after the "fix."
- Two `runCorrelationAsync data:` log lines back-to-back after clicking Collect Now.
- After one ML failure, the correlations tab never auto-refreshes again.

**Phase to address:** Phase 3 (analysis triggers + persistence). The "exists" predicate and the single-trigger guard are the phase's core design decisions.

---

### Pitfall 8: collectNow completion detection — re-analyzing against stale data

**What goes wrong:**
"Re-analyze after collectNow completes" requires knowing when collection *finished*, not when it *started*. The dashboard's `triggerCollection` sends a message and the snapshot updates via storage; if the re-analyze effect keys off `snapshot` object identity or fires on the collection *request* resolving (which is fire-and-forget), it runs against pre-collection data — the user sees "re-analyzed" results that don't include the fresh headlines, which for stock-indicator feeds (the whole point of this milestone) means the new `amzn` items still aren't correlated. A second failure mode: collectNow completion *and* the resulting snapshot change both fire the effect → two re-analyzes (Pitfall 7's double-trigger).

**Why it happens:**
There is currently no explicit "collection finished" signal to the dashboard — completion is inferred. The background's post-collection pre-compute (`Pre-compute correlations failed` path in `src/background/index.ts`) already runs correlation after collection, so a dashboard-side re-analyze can also *duplicate* the background's own run.

**How to avoid:**
- Have the background broadcast an explicit `COLLECTION_COMPLETE` message (or persist `lastCollectionAt` — which already exists in the hook — and trigger on its *change* via `storage.onChanged`, comparing values, not identity).
- Decide and document the ownership: either the **background** owns post-collection correlation (dashboard only listens for the result) or the **dashboard** triggers it — not both. Given `runCorrelationAsync` already runs after collection in the background, the cleanest fix is: dashboard does nothing on collectNow except display the incoming result; the "re-analyze after collectNow" requirement is satisfied by the existing background path, and the dashboard's own auto-run is limited to the "no analysis exists" case.
- If the dashboard must trigger: read the collected data *inside* the background at run time (it already does — `getCollectedMarkets/Signals/News`), never pass snapshot state through the message.

**Warning signs:**
- Re-analyze completes suspiciously fast (<1s) after collectNow on an ML engine — it ran on old data or the old cached embeddings.
- Two `CORRELATE_ALL` log lines per collectNow click.

**Phase to address:** Phase 3 (analysis triggers). Verification: e2e test — open tab (no auto-analyze when results exist) → click collect now → exactly one re-analysis containing the new items.

---

### Pitfall 9: Persistence breaking on quota, serialization, or double-apply

**What goes wrong:**
Persisting correlation results to `chrome.storage.local` (the milestone requirement) interacts badly with three existing constraints:
1. **Quota:** `storage.local` is 10MB (5MB on Chrome ≤113), measured as JSON stringification of values + key lengths; over-quota writes **fail immediately** with a rejected promise. Correlation results can be large: per-key caps allow 1000 signals × 1000 contracts, and matches carry matched-text excerpts. A big result + existing collections can blow the ~7MB soft budget the project already manages (PERF-03), silently dropping the write — the feature "works in dev, loses results in production."
2. **Serialization:** `JSON.stringify` drops `undefined` fields; `CorrelationResult` fields that are `undefined` (e.g. `requestId` on legacy paths) vanish, which then re-triggers the requestId-gating bugs in Pitfall 5. Non-JSON values (functions, undefined) throw or silently vanish.
3. **Double-apply:** the dashboard has *two* result appliers — the `CORRELATION_RESULT` message listener and the 1s storage-polling fallback — with no "already applied" guard. Both call `applyResult`, which appends to `runHistory` and persists run stats. With persistence added to more paths, a single run can be recorded 2× in history and stats.

**Why it happens:**
The persistence write is treated as fire-and-forget (`await browser.storage.local.set(...)` inside a try/catch that only logs), and the two appliers were added at different times (message listener first, polling fallback later for missed messages).

**How to avoid:**
- **Trim before persist:** store the result *without* bulky fields (full text excerpts, embedding vectors — embeddings must never be persisted, they're 384 floats × thousands of texts) or cap persisted matches per category (e.g. top 200 by confidence). Keep the full result in memory for the live session.
- **Check the write result:** `await` the `set()` and surface quota failures (`chrome.runtime.lastError` / rejected promise) — at minimum log loudly; ideally fall back to a trimmed write.
- **Idempotent apply:** tag applied results by `requestId` (`lastAppliedRequestIdRef`); both appliers check it before calling `applyResult`. This fixes the existing double-history bug as a side effect.
- **Shape the persisted record:** always write `requestId`, `engine`, `computedAt` explicitly (never `undefined`) so reload-time "analysis exists" checks (Pitfall 7) are reliable.
- Reuse the existing budget authority: after writing, the PERF-03 `getBytesInUse()` check should still pass; add a unit test that a max-caps result + persisted correlations stays under budget.

**Warning signs:**
- `getBytesInUse()` jumps by megabytes after one correlation run.
- `runHistory` shows duplicate entries with identical timestamps.
- Results survive reload in dev (small dataset) but vanish with production-scale data (quota).

**Phase to address:** Phase 3 (persistence). Verification: unit test for quota-trim behavior; unit test that message + polling appliers produce exactly one history entry.

---

### Pitfall 10: Assuming the MV3 service worker outlives the correlation run

**What goes wrong:**
`runCorrelationAsync` is fire-and-forget inside the background SW. Chrome terminates the SW after 30s of inactivity (extension API calls and events reset the timer), after any single request exceeds 5 minutes, and independently kills workers whose `fetch` stalls >30s. An ML run (model download + inference) routinely exceeds these windows. When the SW dies: the ML worker (a child of the SW context) dies, the storage write never happens, no `CORRELATION_RESULT` is broadcast — the dashboard spins forever (Pitfall 5) and, with the new trigger logic, the next tab open sees "no analysis exists" and re-runs, potentially looping. The existing code already acknowledges this pattern (`chrome.alarms` for collection "survives worker restarts", progress messages resetting the idle timer) but the *correlation* path relies on staying alive by luck.

**Why it happens:**
The progress-message relay incidentally keeps the SW alive during inference (each `CORRELATION_PROGRESS` broadcast is an API call that resets the 30s timer) — but only *while progress flows*. The silent gaps (model download before Pitfall 4's fix, long ONNX session init, LLM token generation without per-token progress) are exactly where the SW dies.

**How to avoid:**
- Persist a **run marker** before starting: `{ requestId, engine, model, startedAt }` in `storage.local`. On SW startup (top-level) and on dashboard load, if a marker exists with no matching completed result and `startedAt` is stale, treat the run as dead: clear the marker, surface "analysis interrupted — retry," and let the trigger logic (Pitfall 7) decide whether to re-run.
- Keep the progress relay flowing during download (Pitfall 4 fixes both the UX *and* the SW lifetime, since download progress events now reset the idle timer).
- For LLM engines, ensure the progress callback fires at least every ~20s (per-request or heartbeat), not just per-phase.
- Never hold run state in SW globals across the run — `mlWorkerResolvers` is already at risk; the marker in storage is the recovery path.

**Warning signs:**
- `about:extensions` → service worker "inactive" while the dashboard still shows a running correlation.
- Correlation failures cluster on LLM/embedding engines and on first-run (download) — never on heuristic.

**Phase to address:** Phase 2 (ML progress) for the marker + watchdog; Phase 3 (triggers) for the "dead run → re-analyze" decision. Both phases must agree on the marker's shape — define it in Phase 2.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Normalizing keywords ad-hoc at each match site (`.replace('$','')` inline) | One-line fixes per bug report | N divergent normalizers; next source re-introduces the mismatch; equivalence suites become unfixable | Never — one choke point from day one |
| Hardcoding a ticker→cashtag map for the three known feeds | Fast demo of bridging | Breaks on every new symbol; unmaintainable | Never |
| Persisting the full `CorrelationResult` untrimmed | Feature "done" in an afternoon | Quota failures at production scale; PERF-03 budget regressions | Only if a hard per-category cap is applied in the same commit |
| Treating "correlations key non-empty" as "analysis exists" | Simple trigger check | Persisted error results permanently suppress auto-analysis | Never — check `error` field explicitly |
| Dashboard polls storage faster (500ms) instead of fixing the message path | Masks missed messages | Wasted CPU in a persistent new-tab page; still racy | Never — fix the terminal-state contract instead |
| Skipping the equivalence suites because "this change is UI-only" | Faster phase | The exact regression class this milestone fixes is what those suites guard | Never — they exist for precisely this milestone |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Transformers.js `pipeline()` | Assuming progress events fire during inference by default; wiring `progress_callback` only on one of the five `get*Pipeline` functions | Wire `progress_callback` in `createPipelineWithFallback` (the single choke point all five use); map download events (`status: 'progress'`, `loaded`/`total`) to the existing progress protocol |
| Transformers.js in Web Worker | Assuming `browser.runtime.getURL` works in the worker (it doesn't — the codebase already routes around this via `wasmPathOverride`) | Forward progress via the worker's existing `postMessage` protocol; don't add extension-API calls inside the worker |
| `chrome.storage.local` | Assuming writes always succeed; assuming quota is unlimited because dev data is small | Await and check every `set()`; trim before persist; verify against `getBytesInUse()` (the project's PERF-03 authority) |
| `runtime.sendMessage` broadcasts | Assuming the dashboard always receives `CORRELATION_RESULT` (backgrounded tabs, Firefox channel quirks) | Storage write is the source of truth; messages are hints; the polling fallback + run marker (Pitfall 10) close the gap |
| Firefox vs Chrome messaging | Testing progress only in Chrome; Firefox's `runtime.sendMessage` promise rejects when no listener (already `.catch`ed in background — keep it that way for the new `COLLECTION_COMPLETE` broadcast) | Run the e2e suite under `TARGET=firefox` for the trigger/progress phases; both browsers are a hard requirement |
| rss2json stock-indicator feeds | Assuming keyword arrays are stable in shape (they contain years, screener acronyms, mixed case) | Normalize defensively at the choke point; treat feed keywords as untrusted input (length-cap, strip non-word chars) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Normalizing keywords inside the pairwise loop / per-candidate query | Correlation latency regresses; PERF-02 gains quietly lost | Normalize once per item at index-build and at signal/news load; never inside `correlatePair` | Immediately at ~100+ contracts (index path) |
| Persisting the full result on every progress tick or per-phase | Storage write amplification; `onChanged` listener storms in the dashboard | Persist once per completed run; progress stays in messages only | At ML-engine runtimes (dozens of writes/min) |
| Adding a second trigger path that doubles correlation runs | Auto-analyze on every tab open (the bug being fixed) made extra runs cheap to ignore; with re-analyze-after-collectNow the index rebuild + ML cost lands on every collection | One serialized trigger function (Pitfall 7); background owns post-collection correlation | Every collectNow with ML engines |
| Embedding cache keyed by raw text while the *fed text* changes | After bridging changes what text is embedded, warm-cache runs re-embed everything (slow first run) and `embedding-equivalence` fails | If the embedder input changes at all, bump the cache key/version; otherwise don't touch embedder inputs — bridging happens at keyword level, not text level | First run after the bridging change |
| Storage-polling interval left running after settle | Dashboard tab (persistent new-tab) burns CPU indefinitely | The existing `if (!loading) return` guard is correct — preserve it in the refactor | Always (background energy) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Building match regexes from feed-derived keywords (e.g. `new RegExp(keyword)`) to bridge tickers | ReDoS / broken correlation from hostile or malformed feed content (rss2json feeds are external input) | String-set membership and prefix normalization only — never construct regexes from untrusted keywords |
| Persisting unbounded feed-derived strings into the correlations record | Storage-quota exhaustion used as a DoS-on-self; bloated exports | Length-cap every persisted string field (headlines, matched excerpts) at write time |
| Broadening host permissions to "fix" a source's correlation | New permission warnings; violates the 100% client-side, minimal-permission posture | Bridging is a pure data-transform fix — no new permissions, no new network access |
| Logging full correlation payloads at debug level in the persistent new-tab console | Headline/user-watchlist data leaks into shared-machine consoles | Keep existing `console.debug` gating; never log full result objects |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Progress bar that jumps backwards across phases (contracts → signals → news each restart at 0) | Looks broken; users cancel healthy runs | Show phase label (already exists via `phaseLabel`) + per-phase bar, or a weighted overall bar; never one continuous 0→100 |
| Frozen spinner with no cancel affordance during silent model download | Users force-reload the tab, losing the run | Wire download progress (Pitfall 4) and keep the existing Cancel button visible during download |
| Auto-analyze on every tab open (current behavior) | CPU spike + ML re-run each new-tab; battery drain; results flicker | The milestone's trigger fix — load persisted results instantly, analyze only when absent |
| Re-analysis silently replacing visible results mid-read | User loses their place in the list/graph | On re-analyze after collectNow, keep old results rendered until the new result arrives (the storage-first pattern already enables this) |
| Error results rendered as "no correlations found" | User believes the market has no signal when the engine actually failed | Persist and surface `error` distinctly (the hook already reads `cached.error` — keep that path, and exclude errors from "analysis exists") |

## "Looks Done But Isn't" Checklist

- [ ] **Ticker bridging:** Often fixed for news→market only — verify `correlateNewsSocial` (news keywords `[amzn,…]` vs social `$AMZN`) and news→market *both* match; verify with **stored old-format data**, not just fresh fixtures.
- [ ] **Ticker bridging:** Often missing the inverted-index path — verify the index (fast) path and naive (tiny-input) path agree on mixed-form inputs (equivalence suite).
- [ ] **ML progress:** Often tested only warm-cache — verify **first-run** (cold cache, download visible), warm run (bar may skip download entirely), and error path (bar clears).
- [ ] **ML progress:** Often missing the background-initiated run case — verify a correlation started by the background (post-collection) still settles the dashboard's loading state.
- [ ] **Analysis triggers:** Often verified only on first open — verify *second* tab open does NOT re-analyze, and that a persisted **error** result still allows re-analysis.
- [ ] **Analysis triggers:** Often missing the collectNow→exactly-one-re-analysis assertion (double-trigger via snapshot change + completion signal).
- [ ] **Persistence:** Often verified with dev-scale data — verify a max-caps (1000/1000/1000) run persists without quota failure and reloads intact.
- [ ] **Persistence:** Often missing idempotency — verify message listener + storage-poll fallback produce exactly **one** `runHistory` entry per run.
- [ ] **Cross-browser:** Often Chrome-only — run the trigger/progress e2e specs under `TARGET=firefox`.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Normalization applied at wrong layer (Pitfall 1) | MEDIUM | Move normalization into the choke point; delete per-site patches; re-run equivalence suites; no data migration needed if normalization is at read time |
| Index/similarity desync (Pitfall 2) | MEDIUM | Restore superset invariant in `candidateKeywords` + index build; add property test so it can't regress silently |
| Over-bridging shipped (Pitfall 3) | LOW | Tighten the ticker-evidence rule (allowlist/shape check); lower bridged-match confidence ceiling; false positives age out with the next correlation run |
| Progress callback wired in only some pipelines (Pitfall 4) | LOW | Move `progress_callback` into `createPipelineWithFallback` — one edit covers all five engines |
| Stuck-bar shipped to users (Pitfall 5) | MEDIUM | Ship the run-marker + staleness watchdog; existing stuck states self-heal on next dashboard load once the marker logic lands |
| Quota-blown persistence (Pitfall 9) | MEDIUM | Add trim-on-persist; existing over-budget keys are already handled by PERF-03 pruning — verify pruning covers the new key |
| Double-applied run history (Pitfall 9) | LOW | Add `lastAppliedRequestId` guard; dedupe existing history entries by `timestamp+engine` once during migration |

## Pitfall-to-Phase Mapping

Phase numbering below follows the natural dependency order for v0.1.6 (roadmap will confirm labels): **Phase 1 = ticker/cashtag bridging**, **Phase 2 = ML progress fix**, **Phase 3 = analysis triggers + persistence**.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. One-sided normalization | Phase 1 | Unit test: `[amzn, vcp, 2026]` news keywords match `$AMZN` social signal via `correlateNewsSocial`; stored old-format fixture correlates without re-collection |
| 2. Index superset break | Phase 1 | `correlation-equivalence` + `embedding-equivalence` suites green; new mixed-form index-vs-naive property test |
| 3. Over-bridging | Phase 1 | Golden tests: `vcp`, `2026`, stop-word tickers do NOT bridge; match-count delta vs pre-change bounded; alert-sweep regression test |
| 4. Silent model download | Phase 2 | Manual/e2e: cold-cache first run shows byte progress; `progress_callback` present in `createPipelineWithFallback` (single choke point) |
| 5. No terminal state | Phase 2 | Unit: foreign-requestId result settles UI; unit: worker `error` message clears progress; e2e: killed worker → watchdog message |
| 6. Late progress messages | Phase 2 | Unit: progress after settle is ignored; progress with foreign requestId ignored |
| 7. Trigger races / error-as-exists | Phase 3 | Unit: "exists" excludes error results; unit: in-flight guard blocks concurrent triggers; e2e: second tab open fires zero `CORRELATE_ALL` |
| 8. Stale-data re-analyze | Phase 3 | e2e: collectNow → exactly one re-analysis whose results include newly collected items |
| 9. Persistence quota/duplication | Phase 3 | Unit: max-caps result persists under budget; unit: one history entry per run despite dual appliers |
| 10. SW lifetime vs run | Phase 2 (marker shape) + Phase 3 (re-run policy) | Unit: stale marker without result → run treated as dead; dashboard recovers without user action |

## Sources

- Code-grounded (HIGH confidence — direct source reading, 2026-08-27):
  - `src/utils/keywords.ts` — cashtag regex `\$[A-Z]{2,}`, `$`-prefixed keyword form, `keywordSimilarity` exact-string Jaccard
  - `src/services/engine/correlation.ts` — `MIN_CONFIDENCE`, `CASHTAG_BOOST`, `candidateKeywords()` superset invariant ("must-have truth #4"), tiny-input fallback path
  - `src/services/engine/ml/transformers.ts` — `createPipelineWithFallback` (no `progress_callback` passed), pipeline cache, WebGPU→WASM fallback
  - `src/services/engine/ml/embedding.ts` — per-batch inference progress only after pipeline ready; `phase && model` gating
  - `src/workers/ml-worker.ts` — progress/result/error message protocol; worker-side cancel flag
  - `src/background/index.ts` — `runCorrelationAsync` fire-and-forget, storage write + `CORRELATION_RESULT` broadcast, progress relay, alarm setup, error-result persistence
  - `src/dashboard/hooks/useCorrelations.ts` — requestId gating in `applyResult`, storage-polling fallback, dual appliers, `persistRunStats`
  - `src/dashboard/App.tsx` — `corrInitRef` auto-run on snapshot (the trigger being changed), progress bar render conditions
  - `.planning/PROJECT.md` — v0.1.5 state, PERF-02/03 constraints, 360-test suite incl. equivalence suites
- Chrome developer docs (HIGH — fetched directly, 2026-08-27):
  - Extension service worker lifecycle: 30s idle termination, 5-minute single-request cap, fetch >30s rule, "persist data rather than using global variables," `chrome.alarms` 30s minimum (Chrome 120+), long-lived messaging keeping SW alive (Chrome 114+) — developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
  - `chrome.storage` quotas: local 10MB (5MB ≤ Chrome 113), JSON-stringification measurement, immediate failure on quota exceed, sync 100KB/8KB-per-item/write limits, session 10MB in-memory, Web Storage unavailable in service workers — developer.chrome.com/docs/extensions/reference/api/storage
- Transformers.js docs (MEDIUM — official docs site; the custom-usage guide URL 404'd, API verified via the pipelines API page and the installed `@huggingface/transformers` 3.7 usage in-repo):
  - `pipeline(task, model, options)` accepts `progress_callback` on `PretrainedModelOptions`; per-file events with `status`/`name`/`loaded`/`total`; quantization `dtype` options (`q4`/`q8`/`fp16`/`fp32`); WebGPU `device` option — huggingface.co/docs/transformers.js

---
*Pitfalls research for: v0.1.6 "fix correlation" — TrendCast MV3 extension*
*Researched: 2026-08-27*
