# Pitfalls Research

**Domain:** Client-side prediction-market correlation browser extension (MV3, Chrome + Firefox)
**Researched:** 2026-08-22
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: MV3 Service Worker Ephemerality Kills Long-Running Collection

**What goes wrong:**
The background service worker is killed after ~30 seconds of inactivity (Chrome) and after ~5 minutes of active use. Any in-memory state — partially collected signals, in-progress correlation runs, ML model instances, pending fetch queues — is silently destroyed. The extension appears to "stop working" intermittently: data goes stale, correlations never complete, and the popup/dashboard shows old snapshots with no error.

**Why it happens:**
Manifest V3 replaced persistent background pages with event-driven service workers. Developers coming from MV2 (or from a server mindset) assume the background process stays alive. TrendCast's background-orchestrator pattern is especially vulnerable because it holds state in memory and relies on the worker being resident.

**How to avoid:**
- Treat the service worker as **stateless and restartable**. Persist every piece of state to `chrome.storage.local` immediately after mutation — never keep the source of truth in a module-level variable.
- Use `chrome.alarms` (min period 30s) to wake the worker on a schedule rather than relying on it staying alive. Re-hydrate state from storage on every `startup`/`alarm` event.
- Design collection as idempotent, resumable batches: on wake, check what's already in storage and only fetch what's missing.
- Do NOT use `chrome.runtime.getPlatformInfo()` or other tricks to keep the worker alive — they're unreliable and get flagged in review.

**Warning signs:**
- Data collection stops after the extension has been idle for a few minutes.
- Correlations complete only when the user actively opens the popup/dashboard (which wakes the worker).
- No error is logged — the worker just "disappears."

**Phase to address:**
Phase 1 (Core collection + storage-as-state). This is the foundational architecture decision; retrofitting it later is a rewrite.

---

### Pitfall 2: Unbounded Data Accumulation vs. the 10 MB Storage Quota

**What goes wrong:**
`chrome.storage.local` has a hard quota of **10 MB** (5 MB in Chrome 113 and earlier). TrendCast's `mergeSignals`/`mergeNews` accumulate ~460 news items per cycle with no cap. Combined with social signals, market odds snapshots, and correlation history, the store fills up. Writes then fail with `QUOTA_BYTES` errors, collection silently stops, and the extension becomes unusable. The `estimateBytes` function re-serializes the entire dataset on every budget check — an O(dataset) cost that itself becomes a bottleneck.

**Why it happens:**
Storage-as-state is convenient, so developers keep appending data without a retention policy. The quota is invisible until it's hit, and the failure mode (silent write rejection) is easy to miss.

**How to avoid:**
- Establish a **retention budget** up front: a hard byte cap (e.g. 7 MB soft / 9 MB hard) with a pruning policy that evicts oldest data first.
- Track bytes with `chrome.storage.local.getBytesInUse()` (cheap, no re-serialization) instead of re-serializing the whole dataset in `estimateBytes`.
- Cap the number of items per collection (e.g. max 200 news items, max 500 signals) and dedupe by URL/id before storing.
- Consider `unlimitedStorage` permission only if the data genuinely needs to exceed 10 MB — but this is a red flag for review and should be a deliberate, documented decision, not a default.

**Warning signs:**
- `chrome.storage.local` writes start throwing `QUOTA_BYTES` errors.
- Storage usage grows monotonically across collection cycles.
- The dashboard shows old data because new writes are failing.

**Phase to address:**
Phase 1 (Core collection) — budget and pruning must be designed in from the start, not bolted on.

---

### Pitfall 3: O(n×m) Correlation Loops That Freeze the UI

**What goes wrong:**
TrendCast's `correlation.ts` and `ml/ner.ts` use nested O(n×m) loops over signals × markets. With ~460 news items, hundreds of signals, and dozens of markets, each correlation pass is hundreds of thousands of string comparisons. On the main thread (or in a service worker that must respond to events), this blocks the UI for seconds and can trigger the worker to be killed as "unresponsive."

**Why it happens:**
The naive "for each signal, for each market, check if keywords match" approach is the first thing that comes to mind and works fine at small scale. It's only when data volume grows that the quadratic blowup becomes visible.

**How to avoid:**
- Build an **inverted index**: tokenize each market's keywords once, then for each signal, look up matching markets via a hash map keyed by token → O(n + m) instead of O(n×m).
- Precompute and cache tokenized lexicons; don't re-tokenize on every pass.
- Move heavy compute off the main thread: use a Web Worker (`workers/ml-worker.ts` already exists) or chunk the work across `setTimeout`/`scheduler.yield()` so the worker stays responsive.
- Add a complexity guard: if the product of input sizes exceeds a threshold, degrade gracefully (sample or batch) rather than blocking.

**Warning signs:**
- Correlation runs take seconds and the popup/dashboard freezes during them.
- CPU spikes to 100% on a single core during collection.
- The service worker is repeatedly terminated for being unresponsive.

**Phase to address:**
Phase 2 (Correlation engine) — the algorithm choice is made here; retrofitting an inverted index later is a rewrite.

---

### Pitfall 4: Paywalled / Low-Yield News Sources Silently Drop Out of Correlations

**What goes wrong:**
Seeking Alpha and Investing.com articles are paywalled and often not indexed by Google News RSS. The `site:seekingalpha.com` Google News query returns mostly stale or non-article pages (stock quote pages, privacy policy, 2011-era pages) rather than fresh analysis. When the RSS feed returns few/no fresh items, the correlation threshold filters them out, and the "Seeking Alpha / Investing" tab appears empty — with no error, because the fetch "succeeded."

**Why it happens:**
Developers assume a named source will always yield fresh, relevant items. In reality, RSS aggregation of paywalled sources is unreliable: Google News RSS is a personal, non-commercial feed with opaque indexing, and paywalled publishers are inconsistently represented. The failure is silent because the pipeline returns 200 with an empty or stale item list.

**How to avoid:**
- **Do not rely on a single aggregator** for paywalled sources. Add a direct source (Seeking Alpha's own RSS/API if available) or a second aggregator as a fallback.
- Add **freshness validation**: if a source returns zero items newer than N hours, log it and surface a "source degraded" state in the UI rather than silently showing nothing.
- **Decouple "fetched" from "correlated"**: a source can be healthy (fetching) but produce no correlations (threshold). Show both states distinctly.
- Respect Google News RSS terms: it is for personal, non-commercial feed rendering only — do not build a commercial product on it.

**Warning signs:**
- A source tab is empty but the network log shows successful 200 responses.
- The source's RSS returns mostly non-article pages (quote pages, static pages).
- Correlations for that source are always zero regardless of market.

**Phase to address:**
Phase 1 (News collection) — source reliability and fallback strategy must be designed before the correlation phase depends on it.

---

### Pitfall 5: Client-Side ML Model Size and WASM Inference Latency

**What goes wrong:**
Transformers.js models can be **up to 1.5 GB** (full-precision). On WASM CPU (the default for Firefox, and the fallback when WebGPU is unavailable), inference is slow — a large NER/embedding model can take seconds per batch. The model download competes with the 10 MB storage quota (models are cached in browser storage, not `chrome.storage.local`, but still consume disk and bandwidth), and slow inference blocks the collection cycle.

**Why it happens:**
Developers pick a "good" model without checking its size or the target device's capabilities. WebGPU is still experimental (~70% global support as of late 2024, and Firefox requires a feature flag), so WASM is the real baseline. A 1.5 GB fp32 model is impractical for a browser extension.

**How to avoid:**
- **Prefer quantized models**: use `dtype: "q8"` (default for WASM) or `"q4"` to shrink models 4–8×. Use `ModelRegistry.get_available_dtypes()` to pick the smallest available dtype with a fallback chain (`["q4", "q8", "fp16", "fp32"]`).
- **Choose small models** for the task (e.g. `all-MiniLM-L6-v2`-class embeddings, tiny NER) rather than large general-purpose models.
- **Detect device capability** at runtime: try `device: "webgpu"`, fall back to WASM with a quantized model. Never assume WebGPU.
- **Cache the model** and load it lazily/off the critical path; run inference in the worker so the UI never blocks.
- Set a **download size budget** and warn the user before a large download.

**Warning signs:**
- Model download exceeds tens of MB for a simple task.
- Inference takes seconds per item on WASM.
- The extension's first-run experience is dominated by a huge model download.

**Phase to address:**
Phase 3 (ML engines) — model selection and quantization are decided here; changing the model later invalidates cached embeddings.

---

### Pitfall 6: TikTok Data Collection Without a Backend Is Fragile and Possibly Non-Compliant

**What goes wrong:**
Collecting TikTok data purely client-side means either (a) DOM-scraping the TikTok web app from a content script, or (b) calling TikTok's internal/private APIs directly. Both are fragile: TikTok's DOM and API change frequently, the site uses aggressive anti-bot measures, and scraping private endpoints may violate TikTok's ToS. The result is a collector that breaks silently on every TikTok update and may get the extension flagged.

**Why it happens:**
The project is explicitly "no backend," so the natural instinct is to scrape in the browser. But TikTok is one of the hardest targets to scrape reliably, and it's a moving target.

**How to avoid:**
- **Scope it as a best-effort, optional collector**, not a core feature. Never let TikTok failure block the rest of collection.
- Prefer **public, documented surfaces** (TikTok's public web search results page) over private endpoints.
- Wrap the collector in a **resilience boundary**: try/catch, timeout, and a "collector failed" state that doesn't crash the pipeline.
- **Document the ToS risk** in the roadmap; consider whether TikTok is worth the fragility vs. a more stable source.
- Add a **manual fallback**: let users paste a TikTok URL or text snippet if automated collection fails.

**Warning signs:**
- The TikTok collector returns empty results after a TikTok UI update.
- The collector depends on specific DOM selectors or private API paths.
- Anti-bot challenges (CAPTCHA, login walls) appear.

**Phase to address:**
Phase 4 (Additional sources / TikTok) — treat as an optional differentiator with a hard failure boundary, not a core phase.

---

### Pitfall 7: MV3 Notification/Alarm Misconfiguration

**What goes wrong:**
Correlation alerts (a planned feature) fail to fire or fire at the wrong time because of MV3 constraints:
- `chrome.alarms` can fire **at most once every 30 seconds** — you cannot schedule sub-30s alerts.
- `chrome.notifications.create()` **requires an `iconUrl`**; omitting it throws.
- The `notifications` permission must be declared, and `getPermissionLevel()` may return `"denied"` if the user disabled notifications.
- Alarms continue to run while the device sleeps, so a "check every 5 minutes" alarm can pile up missed checks on wake.

**Why it happens:**
Developers port notification logic from a web app or MV2 without reading the MV3 alarm/notification constraints. The 30-second alarm floor and the `iconUrl` requirement are the two most common surprises.

**How to avoid:**
- Read the MV3 alarm/notification docs before implementing; respect the 30s minimum and the `iconUrl` requirement.
- Check `chrome.notifications.getPermissionLevel()` before creating and handle `"denied"` gracefully (fall back to in-UI badges).
- Use `chrome.alarms` with `periodInMinutes` for recurring checks; on wake, coalesce missed checks rather than running them all.
- Consider `persistAcrossSessions` (Chrome 150+) if alarms must survive browser restarts.

**Warning signs:**
- `chrome.notifications.create()` throws "iconUrl is required."
- Alerts fire more often than every 30 seconds (impossible — they're being dropped).
- Notifications silently don't appear because permission is denied.

**Phase to address:**
Phase 5 (Correlation alerts) — implement against the MV3 constraints from day one.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep all state in service-worker memory | Fast, simple reads | Lost on worker kill; forces full re-collection | Never — MV3 workers are ephemeral |
| Append to storage without a retention budget | Simple writes | Hits 10 MB quota; silent write failures | Never — budget from day one |
| O(n×m) correlation loops | First implementation is trivial | Freezes UI; worker killed as unresponsive | Only for tiny datasets; replace with inverted index |
| Rely on a single RSS aggregator for paywalled sources | One fetch path | Source silently drops out; empty tabs | Never for paywalled sources — add fallbacks |
| Use full-precision (fp32) ML models | No quantization complexity | 1.5 GB downloads; slow WASM inference | Never — use q8/q4 by default |
| DOM-scrape TikTok from content script | No backend needed | Breaks on every TikTok update; ToS risk | Only as best-effort optional feature |
| Re-serialize whole dataset in `estimateBytes` | Reuses existing serialization | O(dataset) cost on every write | Never — use `getBytesInUse()` |
| `unlimitedStorage` permission as default | Avoids quota management | Privacy red flag; review rejection | Only with documented, justified need |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Google News RSS | Relying on it for paywalled sources; treating it as a commercial feed | Use it for personal, non-commercial use only; add direct source fallbacks; validate freshness |
| Seeking Alpha / Investing.com | Assuming RSS always returns fresh articles | Expect paywall gaps; add direct RSS/API fallback; surface "feed degraded" state |
| rss2json.com (CORS proxy) | Depending on a free third-party proxy as the only path | Free tiers are unreliable; add a fallback proxy or use `host_permissions` + direct fetch |
| Hugging Face CDN (model download) | Assuming the CDN is always up | Cache models; handle download failure with retry and a fallback model |
| `chrome.notifications` | Omitting `iconUrl`; not checking permission | Always pass `iconUrl`; check `getPermissionLevel()` first |
| `chrome.alarms` | Scheduling sub-30s intervals | Respect the 30s minimum; use `periodInMinutes` |
| TikTok | Calling private endpoints / scraping DOM | Use public endpoints; wrap in a failure boundary; document ToS risk |
| Polymarket / Kalshi | Assuming stable public API shape | Pin API versions; handle schema drift with validation |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| O(n×m) correlation | UI freeze; worker killed | Inverted index; worker offload | ~hundreds of signals × hundreds of markets |
| Full-dataset re-serialization in `estimateBytes` | Slow writes; high CPU | `getBytesInUse()` | Every write as dataset grows |
| Uncapped signal/news accumulation | Storage quota hit | Retention budget; per-collection caps | ~460+ items/cycle sustained |
| Large fp32 ML model | Slow first run; slow inference | Quantize (q8/q4); small models | Any WASM-only device |
| Synchronous ML inference on main thread | UI freeze during collection | Run in worker; lazy load | First inference after model load |
| Fetching all sources in parallel without rate limiting | Rate-limit errors; blocked IPs | `rate-limiter.ts`; stagger requests | Multiple sources × frequent cycles |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Broad `host_permissions` (`<all_urls>`) | Over-privileged; review rejection; data exposure | Scope to specific origins actually needed |
| `wasm-unsafe-eval` in CSP | Weakens extension security posture | Keep CSP strict; only enable what's required for WASM |
| DOM-scraping private endpoints | ToS violation; account/extension flagged | Use public APIs; document risk |
| Storing raw scraped content without sanitization | XSS in dashboard/popup | Sanitize all scraped HTML before rendering |
| Third-party CORS proxy (rss2json) | Data routed through untrusted third party | Minimize; prefer direct fetch with `host_permissions` |
| Not validating external feed/API schema | Malformed data crashes pipeline | Validate and sanitize all external input |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Empty source tab with no explanation | User thinks it's broken | Show "feed degraded / no fresh items" state |
| Silent collection failure (worker died) | Stale data, no error | Surface last-collected timestamp and health indicator |
| Huge first-run model download | User abandons before value | Show progress; offer smaller model option |
| Notifications permission denied, silent | User misses alerts | Fall back to in-app badge; explain how to enable |
| Correlation takes seconds | UI feels frozen | Show spinner/progress; run off main thread |
| No retention/clear-data control | Storage fills; user can't reset | Provide "clear data" and storage usage display |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **News collection:** Often missing freshness validation — verify a source that returns zero fresh items surfaces a "degraded" state, not an empty tab.
- [ ] **Correlation engine:** Often missing a complexity guard — verify it degrades gracefully (samples/skips) instead of freezing at scale.
- [ ] **Storage budget:** Often missing pruning — verify `getBytesInUse()` is used and oldest data is evicted before the 10 MB quota.
- [ ] **Service worker state:** Often missing persistence — verify all state survives a worker restart (test by killing the worker).
- [ ] **ML engines:** Often missing quantization — verify the model uses q8/q4 and has a WASM fallback, not just fp32/WebGPU.
- [ ] **TikTok collector:** Often missing a failure boundary — verify a TikTok failure doesn't block core collection.
- [ ] **Notifications:** Often missing `iconUrl` and permission check — verify `create()` succeeds and `getPermissionLevel()` is handled.
- [ ] **Rate limiting:** Often missing — verify collectors respect `rate-limiter.ts` and don't hammer sources.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Worker state loss | LOW | Re-hydrate from storage; re-run idempotent collection |
| Storage quota hit | MEDIUM | Prune oldest data; add retention budget; clear stale collections |
| O(n×m) freeze | MEDIUM | Add inverted index; move to worker; add complexity guard |
| Empty paywalled source | MEDIUM | Add fallback source; surface "degraded" state |
| Model too large/slow | MEDIUM | Switch to q8/q4; smaller model; invalidate cached embeddings |
| TikTok collector broken | LOW | Disable collector; fall back to manual URL input |
| Notification misconfig | LOW | Add `iconUrl`; check permission; fall back to badge |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| MV3 worker ephemerality | Phase 1 (Core collection) | Kill worker mid-collection; verify state survives |
| Storage quota / unbounded data | Phase 1 (Core collection) | Run sustained collection; verify `getBytesInUse()` stays under budget |
| O(n×m) correlation | Phase 2 (Correlation engine) | Load 500+ signals; verify sub-second correlation |
| Paywalled source drop-out | Phase 1 (News collection) | Verify Seeking Alpha/Investing have fallbacks + degraded state |
| ML model size/speed | Phase 3 (ML engines) | Verify q8/q4 model + WASM fallback; measure inference time |
| TikTok fragility | Phase 4 (Additional sources) | Verify failure boundary; TikTok failure doesn't block core |
| Notification misconfig | Phase 5 (Correlation alerts) | Verify `iconUrl` + permission check; sub-30s alerts rejected |

## Sources

- Chrome extension API docs (storage, alarms, notifications) — developer.chrome.com — HIGH confidence
- Transformers.js WebGPU guide — huggingface.co/docs/transformers.js — HIGH confidence
- Transformers.js dtypes/quantization guide — huggingface.co/docs/transformers.js — HIGH confidence
- Google News RSS live query for `site:seekingalpha.com` — news.google.com — HIGH confidence (observed: paywalled source returns stale/non-article pages)
- Project context: `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md` — HIGH confidence (known issues)
- Personal experience / known MV3 pitfalls — MEDIUM confidence

---
*Pitfalls research for: prediction-market correlation browser extension*
*Researched: 2026-08-22*
