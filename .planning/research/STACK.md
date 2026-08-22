# Stack Research

**Domain:** Prediction-market correlation browser extension — new capabilities (TikTok collector, more sources, correlation alerts, dashboard features, market-driven news view, performance hardening)
**Researched:** 2026-08-22
**Confidence:** HIGH

## Scope Note

This research covers **only the NEW capabilities** being added to the existing TrendCast MV3 extension. The existing stack (TypeScript 5.5 strict, React 18, Vite 5 + @crxjs/vite-plugin, Tailwind 3, @huggingface/transformers 3.7, Vitest, Playwright, Bun) is **unchanged** — do not re-architect it. Every recommendation below respects the hard constraints: **100% client-side, no backend, no API keys, Bun package manager only, Chrome + Firefox both.**

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `chrome.notifications` (via `webextension-polyfill`) | API (no pkg) | Correlation alerts/notifications | The ONLY notification API that works from an MV3 background service worker. Requires the `notifications` permission. Fully cross-browser via the existing `webextension-polyfill` (Firefox maps it to `browser.notifications`). Supports `basic`/`list`/`image`/`progress` templates, buttons, and `onClicked`/`onButtonClicked` events. |
| `@huggingface/transformers` `device: 'webgpu'` | 3.7.x (existing) | Faster client-side ML inference | v3 supports `device: 'webgpu'` for GPU acceleration — a large speedup over WASM CPU for embedding/sentiment/zero-shot. **Must keep WASM fallback** because WebGPU is not reliable in Firefox (behind `dom.webgpu.enabled` flag). Do NOT upgrade to v4.x in this milestone (breaking major; see Version Compatibility). |
| Hand-rolled `Map`-based inverted index | n/a (no pkg) | Correlation speedup (O(n×m) → candidate filtering) | The zero-shot engine already implements `findCandidateContracts` — generalize it. A keyword→contract `Map` is dependency-free, trivially testable, and exactly fits the "only compare candidates sharing keywords" pattern. No library needed. |
| `chrome.storage.local` (keep) | n/a | Storage-as-state | Already the architecture. The ~7 MB soft budget is well under the ~10 MB quota. Do NOT migrate to IndexedDB for the current dataset size — it adds async complexity for no benefit at this scale. |
| `idb` | 8.0.3 | IndexedDB wrapper (only if needed) | Only adopt if a future feature (e.g. large export history, offline cache) exceeds chrome.storage.local's quota. `idb` is the minimal, promise-based wrapper. **Defer — not needed for this milestone.** |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `flexsearch` | 0.8.212 | Full-text / fuzzy search | Only if the "market-driven news" view needs fuzzy keyword matching across headlines. For exact keyword→contract matching, the hand-rolled `Map` index is simpler and faster. Add only if you need typo-tolerance or ranked relevance. |
| `onnxruntime-web` | 1.27.0 | WebGPU/WASM backend for transformers.js | Already bundled transitively via `@huggingface/transformers`. Pin explicitly only if you need to control the WASM/WebGPU backend version. |
| `@types/chrome` / `@types/firefox-webext-browser` | existing | Notification API types | Already present. `chrome.notifications` types are included. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Bun | Package manager + script runner | Mandatory. All installs via `bun add`, never `npm`/`npx`. |
| Vitest | Unit tests for new index/collector/notification logic | Add tests for the inverted index, TikTok parser, and notification dedup logic — these are the highest-regression-risk new pieces. |
| Playwright | E2E for dashboard/notification UI | Existing. Mock `chrome.notifications` in `tests/e2e/fixtures.ts`. |

---

## Installation

```bash
# Core (only if you adopt flexsearch for fuzzy search — otherwise NO new deps)
bun add flexsearch

# Optional (only if you later migrate large datasets to IndexedDB)
bun add idb

# Dev (no new dev deps required for this milestone)
```

**Key point:** This milestone should add **zero or one** new runtime dependency. The inverted index, TikTok collector, and notification logic are all implementable with the existing stack + platform APIs. Adding dependencies to a hardening milestone is an anti-pattern.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `chrome.notifications` | Web Notifications API (`Notification`) | **Never for the background worker.** `Notification.requestPermission()` requires a user gesture and the `Notification()` constructor is NOT available in service workers. Only `ServiceWorkerRegistration.showNotification()` works there, and MV3 background is a service worker. `chrome.notifications` is the correct, cross-browser choice. |
| Hand-rolled `Map` inverted index | `flexsearch` | Use flexsearch only if you need fuzzy/typo-tolerant matching for the market-driven news view. For exact keyword→contract candidate filtering, the `Map` is faster and dependency-free. |
| `chrome.storage.local` (keep) | IndexedDB | Use IndexedDB only if data exceeds the ~10 MB quota or you need indexed range queries on large history. At the current 7 MB soft budget, the migration cost outweighs the benefit. |
| `@huggingface/transformers` 3.7 (keep) | `@huggingface/transformers` 4.x | v4.2.0 is latest but is a **major breaking change** (API/package restructure). Do not upgrade in a hardening milestone. Revisit in a dedicated upgrade milestone. |
| WASM CPU inference (fallback) | WebGPU | Use WebGPU when available (Chrome), fall back to WASM (Firefox). Never make WebGPU a hard requirement — Firefox support is flag-gated. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Web Notifications API (`Notification`) in the background worker | Not available in service workers; requires user gesture for permission. | `chrome.notifications` via `webextension-polyfill` |
| `@huggingface/transformers` 4.x | Major breaking change; risks destabilizing the working ML pipeline mid-hardening. | Stay on 3.7.x |
| A full search library (e.g., `lunr`, `mini-search`) for correlation | Overkill; the correlation problem is exact keyword overlap, not full-text relevance. | Hand-rolled `Map` inverted index |
| IndexedDB migration now | Premature; current data fits in `chrome.storage.local` quota. | Keep `chrome.storage.local` |
| Any backend / API key / server | Hard project constraint — 100% client-side. | Public endpoints + DOM scraping + RSS |
| `chrome.notifications` `image`/`progress` templates | `image` is deprecated (Chrome 59) and `progress` is niche; `basic` + `list` cover the correlation-alert use case. | `basic` and `list` templates |

---

## Stack Patterns by Variant

**If you need fuzzy/typo-tolerant matching in the "market-driven news" view:**
- Use `flexsearch` (0.8.212)
- Because headlines from different sources use inconsistent phrasing; fuzzy matching surfaces related markets that exact keyword matching misses.

**If you need to store large export/history datasets beyond the 7 MB budget:**
- Use `idb` (8.0.3) with IndexedDB
- Because `chrome.storage.local` caps at ~10 MB; IndexedDB has no practical cap and supports indexed range queries.

**If WebGPU is available (Chrome, `navigator.gpu` present):**
- Use `device: 'webgpu'` in the transformers.js pipeline
- Because it's a large speedup over WASM for embedding/sentiment/zero-shot inference.

**If WebGPU is unavailable (Firefox, or flag off):**
- Fall back to `device: 'wasm'` (current behavior)
- Because WebGPU is flag-gated in Firefox and must never be a hard dependency.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@huggingface/transformers` 3.7.x | `onnxruntime-web` 1.x | v3 bundles ONNX Runtime Web 1.x; `device: 'webgpu'` works on this line. |
| `@huggingface/transformers` 4.x | `onnxruntime-web` 1.27+ | v4 is a breaking change (renamed packages/APIs). **Do not mix** — pin to one major. |
| `webextension-polyfill` 0.12.0 | `chrome.notifications` / `browser.notifications` | Polyfill maps `chrome.*` to `browser.*`; `notifications` API is fully covered. |
| `chrome.notifications` | MV3 service worker | Works in the background worker; requires `notifications` permission in `manifest.config.ts`. |

---

## Sources

- Chrome `chrome.notifications` API reference — verified permission (`notifications`), templates, methods, events. **HIGH**
- MDN Notifications API / `Notification` — verified `Notification()` not available in service workers; `requestPermission` requires user gesture; `ServiceWorkerRegistration.showNotification` is the worker path. **HIGH**
- Hugging Face Transformers.js WebGPU guide — verified `device: 'webgpu'` usage and Firefox flag-gating. **HIGH**
- Chrome "Storage and cookies" — verified `chrome.storage.local` quota, `unlimitedStorage` permission, IndexedDB available in service workers. **HIGH**
- MDN IndexedDB API — verified IndexedDB supports large structured data + indexes, available in workers. **HIGH**
- npm registry (live) — verified current versions: `@huggingface/transformers` 4.2.0 (latest), `onnxruntime-web` 1.27.0, `webextension-polyfill` 0.12.0, `idb` 8.0.3, `flexsearch` 0.8.212. **HIGH**
- TikTok collection approach — no official key-free API; realistic client-side paths are DOM scraping (content script) and public RSS proxies. **MEDIUM** (needs phase-specific feasibility research)

---
*Stack research for: TrendCast new capabilities (hardening + performance)*
*Researched: 2026-08-22*
