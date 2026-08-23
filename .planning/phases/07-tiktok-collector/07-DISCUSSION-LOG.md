# Phase 7: TikTok Collector - Discussion Log

**Date:** 2026-08-23
**Mode:** Autonomous (recommended defaults accepted; user cancelled interactive questions)

## Gray Areas Resolved

| Decision | Question | Resolution |
|----------|----------|------------|
| D-01 | Content script scope | TikTok only — X/Reddit already have background collectors |
| D-02 | TikTok health tracking | Separate `SocialSourceHealth` map + single TikTok badge (avoids breaking `NewsSource`-keyed union) |
| D-03 | Automatic collection vs. manual URL-paste | Automatic background-tab collection (like Reddit/X) — open the discover page in a background tab during `runCollection`; NO URL-paste input box (user rejected the manual flow as over-engineered) |
| D-04 | Hard timeout location | Content-script `Promise.race` (TikTok is content-script-driven) |
| D-05 | TikTok default toggle | On by default (like Reddit/X) — automatic collection, no opt-in needed |

## Research Summary

See `07-RESEARCH.md`. Key finding: `src/content/socials/index.ts` is empty (0 bytes) despite being declared in the manifest for x.com/reddit.com/tiktok.com. All TikTok infrastructure (types, messaging, config, popup toggle, dashboard rendering, manifest) already exists — only the content script implementation, social-health tracking, and automatic background-tab collection are missing.

## Confidence

MEDIUM-HIGH. The core work (implementing the empty content script) is well-scoped. Main risks: TikTok DOM fragility (mitigated by broad selectors + graceful `[]`), and the automatic background-tab collection requiring new background tab-opening logic.
