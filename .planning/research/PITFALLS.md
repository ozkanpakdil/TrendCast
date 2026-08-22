# Pitfalls Research — Milestone v1.0: Speed, Alerts & New Data

**Domain:** Adding new features to an existing 100% client-side MV3 browser extension (Chrome + Firefox) that correlates social sentiment, news, and prediction-market odds.
**Researched:** 2026-08-22
**Confidence:** HIGH
**Scope:** Pitfalls specific to ADDING these 7 features to the EXISTING system — not generic extension pitfalls. The base-system pitfalls (worker ephemerality, storage quota, O(n×m) loops, paywalled sources, ML size) are already documented in the prior research; this file focuses on what goes wrong when these NEW features are layered on top.

## Critical Pitfalls

### Pitfall 1: Correlation Alerts Fire on Every Match → Notification Fatigue + Storage Bloat

**What goes wrong:**
The alert feature correlates on every collection cycle and creates a `chrome.notifications` for every match above threshold. Users get a wall of notifications (fatigue → they disable notifications entirely), and the alert history array grows unboundedly in `chrome.storage.local`, eating the ~7 MB budget. Alerts also re-fire for the same correlation on every cycle because there's no dedup key.

**Why it happens:**
The correlation engine (`correlate`, `correlateNews`, `correlateNewsSocial`) returns a fresh match list each run. Developers naively map every match → notification without asking "did the user already see this?" The existing `MIN_CONFIDENCE` threshold (0.75, or 0.35 with shared entity) is permissive enough that many matches qualify.

**How to avoid:**
- **Dedup by a stable key** — hash `contract.id + signal.id + correlatedAt-window` (e.g. bucket by hour) and persist a "last alerted" set in storage. Never alert on the same correlation twice.
- **Throttle** — a global max (e.g. 1 alert per N minutes) and a per-market cooldown. Respect the MV3 `chrome.alarms` 30-second floor; do not attempt sub-30s alerting.
- **Watchlist-scope** — only alert on watchlist markets (the requirement says "watchlist-scoped"). This is the single best fatigue reducer.
- **Cap the alert history** — store only the last N (e.g. 100) alert records; prune older ones. Alert history is a different retention class than collection data.
- **Direction-aware** — only alert when the correlation is *new* or *direction changed* (e.g. sentiment flipped), not on every sustained match.

**Warning signs:**
- Multiple notifications appear in a single collection cycle.
- The same correlation re-alerts on consecutive cycles.
- Alert history grows monotonically in storage.
- User disables notifications (permission flips to `denied`).

**Phase to address:**
Phase: Correlation Alerts. Dedup + throttle + watchlist scope must be designed in from the first alert, not retrofitted.

---

### Pitfall 2: Notification Permission Denied / `iconUrl` Missing → Silent Alert Failure

**What goes wrong:**
`chrome.notifications.create()` throws if `iconUrl` is omitted, and silently does nothing if the `notifications` permission is denied or the user disabled notifications. The extension "looks done" (code runs, no error) but the user never sees an alert. On Firefox, notification behavior and permission handling differ from Chrome, so a Chrome-tested path can break on Firefox.

**Why it happens:**
Developers port web-app notification logic (which uses the Notification API) into the MV3 background worker without reading the `chrome.notifications` contract. The `iconUrl` requirement and the `getPermissionLevel()` check are the two most common surprises.

**How to avoid:**
- Always pass a valid `iconUrl` (use an extension-packaged icon, not a remote URL — remote URLs are blocked in MV3).
- Check `chrome.notifications.getPermissionLevel()` before creating; handle `"denied"` gracefully by falling back to an in-dashboard badge/indicator.
- Declare the `notifications` permission in `manifest.config.ts` for both Chrome and Firefox builds.
- Test the alert path on BOTH browsers — the polyfill (`@/messaging/browser`) normalizes the API, but permission behavior differs.

**Warning signs:**
- `chrome.notifications.create()` throws "iconUrl is required."
- Alerts never appear but no error is logged.
- Permission level returns `"denied"` and the code doesn't branch.

**Phase to address:**
Phase: Correlation Alerts. Handle permission + iconUrl from day one; add a fallback UI path.

---

### Pitfall 3: "Market-Driven News" Category Taxonomy Drifts → Inconsistent Classification

**What goes wrong:**
The market-driven news view needs a category taxonomy (finance, politics, technology, etc.). If categories are defined ad-hoc (a hardcoded keyword list in one file, a different list in another), the same headline gets classified differently across runs, and adding a new category requires touching multiple files. The taxonomy also silently overlaps — e.g. a "Fed rate" story is both finance and politics — producing double-counted or mislabeled news.

**Why it happens:**
Taxonomies are deceptively simple. Developers start with a few keyword buckets, then extend them organically without a single source of truth. The existing `redditCategories` in `CONFIG` shows the pattern — categories are already scattered across config and collectors.

**How to avoid:**
- **Define the taxonomy once** in a single module (e.g. `src/config/taxonomy.ts`) with a stable category ID, label, and keyword/entity rules. Reference it from both the classifier and the UI.
- **Make categories mutually exclusive** with a deterministic precedence order (e.g. politics > finance > tech) so a headline maps to exactly one category.
- **Persist the category on the NewsItem** at collection time, not at render time — so the dashboard and export agree.
- **Version the taxonomy** — when you add a category, re-classify existing stored news or accept that old items keep the old category (document which).
- Scope v1 to 3 categories (finance, politics, technology) as the requirement states; expand later.

**Warning signs:**
- The same headline shows under two categories.
- Category labels in the dashboard don't match export labels.
- Adding a category requires editing multiple files.

**Phase to address:**
Phase: Market-Driven News view. Single-source taxonomy + deterministic precedence from day one.

---

### Pitfall 4: TikTok Collector Breaks the Whole Pipeline → No Graceful Degradation

**What goes wrong:**
TikTok is the most fragile source (DOM changes, anti-bot, login walls, ToS risk). If the TikTok collector throws, times out, or hangs, and it's wired into the same `Promise.allSettled` collection path as the reliable sources, a TikTok failure can delay or fail the entire collection cycle — regressing the "must not regress collection latency" constraint. Worse, a hung TikTok fetch can keep the ephemeral service worker alive past its budget or block the alarm cycle.

**Why it happens:**
The existing `collectNews` uses `Promise.allSettled` (good — one failure doesn't reject the batch), but a *hanging* fetch (no timeout) still blocks the cycle until the worker is killed. TikTok's aggressive anti-bot makes hangs and empty results common.

**How to avoid:**
- **Hard timeout** on the TikTok fetch (e.g. 5s) — never let it block the cycle.
- **Isolate it** — run TikTok collection as a separate, optional step that can be skipped entirely if it fails or if the user disables it in settings.
- **Best-effort contract** — TikTok is a differentiator, not a table stake. A TikTok failure must never degrade BBC/CNN/Polymarket/Kalshi collection.
- **Document the ToS/legal risk** in the roadmap and PRIVACY.md. Prefer public surfaces (TikTok discover page) over private endpoints; never bypass login walls.
- **Manual fallback** — let users paste a TikTok URL/snippet if automated collection fails.

**Warning signs:**
- TikTok failure delays or fails the whole collection cycle.
- The collector depends on specific DOM selectors or private API paths.
- Anti-bot challenges (CAPTCHA, login wall) appear.
- Collection latency regresses when TikTok is enabled.

**Phase to address:**
Phase: TikTok collector. Isolate + timeout + graceful degradation are non-negotiable.

---

### Pitfall 5: Inverted Index Returns Wrong Results (or Is Never Built) → Correlation Regresses

**What goes wrong:**
The correlation speedup (inverted keyword→contract index) is the highest-leverage change, but it's easy to get subtly wrong: (a) the index is built from a different tokenization than the matching step, so candidates are missed; (b) the index is rebuilt on every cycle instead of incrementally, so the "speedup" is eaten by index construction; (c) the index is only applied to the heuristic path while the ML paths (`correlateAllEmbedding`, etc.) still do O(n×m), so the user sees no end-to-end improvement; (d) the index changes match results (drops a valid match), regressing correlation quality.

**Why it happens:**
The existing `correlation.ts` uses `extractEntityKeywords` + `keywordSimilarity` with a shared `EntityCache`. An inverted index must use the SAME tokenization and the SAME similarity semantics, or it produces different (wrong) results. Developers often build a "fast" index that doesn't preserve the exact matching behavior.

**How to avoid:**
- **Single tokenization source** — the index and the matcher must call the same `extractKeywords`/`extractEntityKeywords` so candidate sets are identical.
- **Incremental index** — rebuild only the delta (new signals/markets) or cache the index in storage keyed by a data version, not rebuild from scratch each cycle.
- **Apply to ALL paths** — the inverted index should be a shared candidate-filtering layer used by heuristic AND ML engines, so the end-to-end latency improves, not just one path.
- **Golden-test the equivalence** — before/after: run the same dataset through old O(n×m) and new index path; assert identical match sets. This is the regression guard.
- **Complexity guard** — if candidate sets are tiny, the index overhead may exceed the naive loop; keep the naive path as a fallback for small inputs.

**Warning signs:**
- Correlation results change after the index is introduced (missing matches).
- Index construction takes longer than the naive loop it replaces.
- Only the heuristic path is faster; ML engines still block.

**Phase to address:**
Phase: Correlation speedup. Golden-test equivalence + incremental index + apply to all paths.

---

### Pitfall 6: Per-Key Storage Caps + Incremental Byte Estimation Break the Budget Model

**What goes wrong:**
The existing `storage.ts` uses `estimateBytes` (re-serializes the whole dataset via `JSON.stringify` + `Blob`) on every budget check — an O(dataset) cost. Adding per-key caps and "incremental byte estimation" can go wrong in two ways: (a) the incremental estimator drifts from the real `chrome.storage.local` serialization (UTF-16 vs UTF-8, key overhead), so the budget is wrong and QUOTA errors still happen; (b) per-key caps are enforced at write time but the pruning logic (`pruneStorageIfNeeded`) still re-measures the whole store, so the "incremental" win is lost.

**Why it happens:**
`estimateBytes` uses `new Blob([JSON.stringify(value)]).size` which is UTF-8 bytes, but `chrome.storage.local` serializes as UTF-16 (2 bytes/char) plus per-key overhead. The two diverge, so a budget tuned to `estimateBytes` can still overflow the real quota. And "incremental" estimation is often bolted on without replacing the full re-serialization in the pruning path.

**How to avoid:**
- **Use `chrome.storage.local.getBytesInUse()`** for the authoritative total — it's cheap and exact. Keep `estimateBytes` only as a per-item relative heuristic, not the budget authority.
- **Per-key caps** — enforce a max item count AND a max byte estimate per key (signals, news, markets, history, alerts) at write time, so no single key can blow the budget.
- **Incremental estimation** — track a running byte delta per key (add new item size, subtract pruned item size) instead of re-serializing the whole dataset. Reconcile against `getBytesInUse()` periodically.
- **Account for UTF-16** — if you must estimate, use `value.length * 2` (UTF-16) not `Blob` UTF-8 size, or calibrate the budget against real `getBytesInUse()` readings.
- **Test the budget** — run sustained collection and assert `getBytesInUse()` stays under the 7 MB soft budget.

**Warning signs:**
- `QUOTA_BYTES` errors still occur despite the "budget."
- `estimateBytes` and `getBytesInUse()` disagree significantly.
- Pruning still re-serializes the whole dataset every cycle.

**Phase to address:**
Phase: Storage caps + incremental estimation. Use `getBytesInUse()` as authority; reconcile estimates.

---

### Pitfall 7: ML Quantization / WebGPU Breaks the WASM Fallback (or Regresses Quality)

**What goes wrong:**
Adding q8/q4 quantization + WebGPU with WASM fallback to Transformers.js can fail in several ways: (a) the model is quantized but the WASM fallback path isn't tested, so WebGPU-only devices (or Firefox, where WebGPU is flag-gated) get a broken or slow path; (b) quantization changes embedding/sentiment results enough to shift correlation confidence, silently changing which correlations surface; (c) the `dtype`/`device` options are passed to `pipeline()` but the existing `ml-worker.ts` WASM path setup (`setWasmPath` + `deriveWasmPath`) isn't updated, so the quantized model can't load in the worker; (d) upgrading Transformers.js to v4.x (breaking) to get better WebGPU support.

**Why it happens:**
The existing `ml-worker.ts` carefully derives the WASM path from `self.location.href` and sets it before any pipeline. Adding WebGPU means the worker must also handle `device: 'webgpu'` and a fallback to WASM — a device-detection + fallback chain that's easy to get wrong. Quantization is a silent quality change that isn't caught without golden tests.

**How to avoid:**
- **Device detection + fallback chain** — try `device: 'webgpu'`, catch, fall back to WASM with a quantized model. Never assume WebGPU (Firefox requires a flag).
- **Use `ModelRegistry.get_available_dtypes()`** to pick the smallest available dtype with a fallback chain `["q4", "q8", "fp16", "fp32"]`.
- **Golden-test quantization** — run the same corpus through fp32 and q8/q4; assert correlation results don't shift beyond a tolerance. If they do, adjust thresholds.
- **Update the worker WASM path** — ensure `setWasmPath`/`deriveWasmPath` still works when WebGPU is the primary device and WASM is the fallback.
- **Do NOT upgrade to Transformers v4.x** — it's a breaking major; stay on 3.7.x.
- **Cache the model** and load lazily; keep the download size budget in mind (q8/q4 shrinks models 4–8×).

**Warning signs:**
- WebGPU-only path fails on Firefox (flag-gated).
- Quantized model produces different correlations than fp32.
- Worker can't load the model after adding WebGPU (WASM path broken).
- Model download size regresses (fp32 default).

**Phase to address:**
Phase: ML quantization/WebGPU. Fallback chain + golden tests + keep v3.7.x.

---

### Pitfall 8: Watchlist/Export Improvements Break Existing Data or Regress the Dashboard

**What goes wrong:**
Watchlist and export improvements touch the dashboard and the storage schema. Common mistakes: (a) adding a field to `WatchlistEntry` or `NewsItem` without a migration, so old stored data lacks the field and the UI crashes or shows undefined; (b) export (`exportToCsv`/`exportToJson`) is extended for new sources (TikTok, market-driven categories) but the existing export format isn't kept backward-compatible, breaking users' existing exports; (c) the watchlist change regresses the virtualized feed rendering (the `VirtualizedGrid`/`@tanstack/react-virtual` path) by adding non-virtualized rows.

**Why it happens:**
The dashboard is a mature React app with virtualized feeds. Adding watchlist sort/filter/correlation and export coverage is "easy" but touches the storage schema and the render path. Schema drift (new fields on stored objects) is the classic silent breakage.

**How to avoid:**
- **Schema migration** — when adding fields to stored types, add a version field and a migration step that backfills old records on read (or on install). Never assume stored data matches the new type.
- **Backward-compatible export** — keep the existing CSV/JSON sections; ADD new sections (TikTok, categories) rather than changing existing column headers. Document the format.
- **Keep export complete** — every new source (TikTok) and every new field (category) must appear in export, or the export is silently incomplete.
- **Preserve virtualization** — new watchlist/export UI must use the same `VirtualizedGrid` helper; don't add unbounded DOM rows.
- **Test against real stored data** — load a snapshot with old-format records and verify the dashboard renders.

**Warning signs:**
- Dashboard throws on `undefined` field after an upgrade.
- Export CSV columns change and break existing consumers.
- Watchlist with many entries freezes the dashboard (non-virtualized).
- New sources missing from export.

**Phase to address:**
Phase: Dashboard watchlist/export. Schema migration + backward-compatible export + virtualization.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems when adding these features.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Alert on every correlation match | Simple, no dedup logic | Notification fatigue; users disable alerts; storage bloat | Never — dedup + throttle + watchlist scope from day one |
| Hardcode category taxonomy in the view | Fast to ship | Drift; inconsistent classification; hard to extend | Never — single taxonomy module |
| Wire TikTok into the shared collection batch | Reuses existing path | TikTok failure/hang blocks the whole cycle | Never — isolate + hard timeout |
| Build inverted index from scratch each cycle | Simple | Index cost eats the speedup | Only for tiny datasets; use incremental index |
| Use `estimateBytes` (JSON.stringify) as the budget authority | Reuses existing code | Drifts from real quota; QUOTA errors | Never — use `getBytesInUse()` |
| Quantize the model without golden tests | Smaller download | Silent correlation quality shift | Never — verify equivalence |
| Add fields to stored types without migration | Fast | Old data crashes dashboard | Never — migrate on read/write |
| Upgrade Transformers to v4.x for WebGPU | Better WebGPU support | Breaking major; breaks existing ML path | Never — stay on 3.7.x |

## Integration Gotchas

Common mistakes when connecting to external services / platform APIs for these features.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `chrome.notifications` | Omitting `iconUrl`; not checking permission | Always pass `iconUrl`; check `getPermissionLevel()`; fall back to badge |
| `chrome.alarms` | Scheduling sub-30s alert checks | Respect the 30s floor; use `periodInMinutes`; coalesce missed checks on wake |
| TikTok | Calling private endpoints / scraping DOM; no timeout | Use public surfaces; hard timeout; isolate; document ToS risk |
| Transformers.js WebGPU | No WASM fallback; wrong `dtype`/`device` | Fallback chain; `get_available_dtypes()`; keep WASM path working |
| `chrome.storage.local` | Using `estimateBytes` as authority | Use `getBytesInUse()`; calibrate estimates to UTF-16 |
| Export | Changing existing CSV columns | Keep sections backward-compatible; append new sections |

## Performance Traps

Patterns that work at small scale but fail as usage grows — relevant to the new features.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Alert history unbounded | Storage bloat; slow reads | Cap alert history (e.g. 100) | Sustained alerting over days |
| Inverted index rebuilt each cycle | Index build > naive loop | Incremental index; cache by data version | Large contract sets |
| Index only on heuristic path | ML path still O(n×m) | Shared candidate-filtering layer | ML engines enabled |
| TikTok fetch without timeout | Collection stalls; worker killed | Hard timeout (5s) + isolation | Any TikTok anti-bot change |
| Full re-serialization in pruning | Slow writes; high CPU | `getBytesInUse()` + incremental delta | Every cycle as dataset grows |
| Quantized model without golden test | Silent quality shift | Golden-test equivalence | After quantization |
| Non-virtualized watchlist rows | Dashboard freeze | Use `VirtualizedGrid` | Watchlist > ~100 entries |

## Security Mistakes

Domain-specific security issues for these features.

| Mistake | Risk | Prevention |
|---------|------|------------|
| TikTok private-endpoint scraping | ToS violation; account/extension flagged | Use public surfaces; document risk; never bypass consent |
| Remote `iconUrl` in notifications | Blocked in MV3; fails | Use packaged extension icon |
| Storing scraped TikTok content unsanitized | XSS in dashboard | Sanitize all scraped HTML before rendering |
| Exporting raw data with PII | Privacy leak | Respect PRIVACY.md; export only collected public data |
| Broad `host_permissions` for TikTok | Over-privileged; review rejection | Scope to specific origins; prefer public endpoints |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Alert fatigue (too many notifications) | User disables alerts | Dedup + throttle + watchlist scope |
| Notifications denied, silent | User misses alerts | Fall back to in-app badge; explain how to enable |
| Category mislabeled news | User distrusts the view | Single taxonomy; deterministic precedence |
| TikTok empty with no explanation | User thinks it's broken | Show "best-effort / unavailable" state |
| Export missing new sources | Incomplete data | Keep export complete for all sources |
| Watchlist/export freeze | Dashboard feels broken | Virtualize; migrate schema |

## "Looks Done But Isn't" Checklist

- [ ] **Correlation alerts:** Often missing dedup + throttle — verify the same correlation doesn't re-alert on consecutive cycles.
- [ ] **Notifications:** Often missing `iconUrl` + permission check — verify `create()` succeeds and `getPermissionLevel()` is handled.
- [ ] **Market-driven news:** Often missing a single taxonomy — verify categories are defined once and reused by classifier + export.
- [ ] **TikTok collector:** Often missing a timeout + isolation — verify a TikTok failure/hang doesn't block the collection cycle.
- [ ] **Inverted index:** Often missing equivalence — verify the index produces the same match set as the naive loop (golden test).
- [ ] **Storage caps:** Often missing `getBytesInUse()` — verify the budget uses the authoritative API, not just `estimateBytes`.
- [ ] **ML quantization:** Often missing WASM fallback — verify the WebGPU path falls back to WASM on Firefox/flag-gated devices.
- [ ] **Watchlist/export:** Often missing schema migration — verify old stored records render without `undefined` crashes.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Alert fatigue | LOW | Add dedup/throttle; clear alert history |
| Notification misconfig | LOW | Add `iconUrl`; check permission; fall back to badge |
| Taxonomy drift | MEDIUM | Consolidate to single module; re-classify stored items |
| TikTok breaking pipeline | LOW | Disable collector; add timeout; isolate |
| Index result drift | MEDIUM | Revert to naive path; fix tokenization equivalence |
| Storage QUOTA errors | MEDIUM | Prune; switch to `getBytesInUse()`; add per-key caps |
| Quantization quality shift | MEDIUM | Re-tune thresholds; golden-test equivalence |
| Schema migration crash | MEDIUM | Add migration; backfill on read |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Alert dedup/throttle/fatigue | Correlation Alerts | Run 2 cycles; verify no duplicate alerts |
| Notification permission/iconUrl | Correlation Alerts | Verify `create()` + `getPermissionLevel()` on Chrome AND Firefox |
| Taxonomy drift | Market-driven news | Verify single taxonomy; same category in dashboard + export |
| TikTok pipeline break | TikTok collector | Disable TikTok; verify core collection unaffected; 5s timeout |
| Inverted index drift | Correlation speedup | Golden-test index vs naive; assert identical match sets |
| Storage caps / byte estimation | Storage caps | Verify `getBytesInUse()` under budget; per-key caps enforced |
| ML quantization / WebGPU fallback | ML quantization | Verify WASM fallback on Firefox; golden-test quantized vs fp32 |
| Watchlist/export schema drift | Dashboard | Load old snapshot; verify no `undefined` crash; export backward-compatible |

## Sources

- Project context: `.planning/PROJECT.md` (milestone v1.0 features, constraints) — HIGH confidence
- Codebase: `src/services/engine/correlation.ts` (O(n×m) loops, `MIN_CONFIDENCE`, `EntityCache`) — HIGH
- Codebase: `src/utils/storage.ts` (`estimateBytes` re-serialization, `pruneStorageIfNeeded`) — HIGH
- Codebase: `src/workers/ml-worker.ts` (WASM path derivation, worker protocol) — HIGH
- Codebase: `src/services/engine/ml/transformers.ts` (lazy loader, WASM config, dtype/device options) — HIGH
- Codebase: `src/services/collectors/news.ts` (`Promise.allSettled`, rss2json CORS proxy) — HIGH
- Codebase: `src/background/index.ts` (MV3 ephemeral worker notes, alarm setup) — HIGH
- Codebase: `src/config/index.ts` (`redditCategories`, scrape targets incl. TikTok) — HIGH
- Chrome extension API docs (alarms 30s floor, notifications `iconUrl`/permission, `getBytesInUse`) — developer.chrome.com — HIGH
- Transformers.js WebGPU + dtypes/quantization guide — huggingface.co/docs/transformers.js — HIGH
- Prior research: `.planning/research/SUMMARY.md`, `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md` — HIGH

---
*Pitfalls research for: TrendCast Milestone v1.0 — Speed, Alerts & New Data*
*Researched: 2026-08-22*
