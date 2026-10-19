# Devpost submission copy — OriEra WorldChat

**Track:** Best Apps and Agents · Nebius x NVIDIA Global AI Hackathon
**One-liner:** Conversation is the world — one sentence rebuilds a living physics sandbox,
parsed on Nemotron Nano, narrated on Super, directed on the heavy tier, all routed by a tiered
scheduler that shows — in a live router log and a credits panel — how far one Token Factory
key can stretch.

## What to write (accuracy rules)

- This submission contains exactly **one** playable demo (WorldChat, this folder). Do **not**
  write "13 browser demos" anywhere on Devpost — that figure belongs to the parent OriEra
  engine workspace, which is not part of this submission.
- Build inventory and provenance: use README's "Built with (honest inventory)" verbatim —
  the demo *adapts* two browser kernels + one example from the pre-existing Apache-2.0 OriEra
  engine; everything else is new work from the submission window.
- Never claim LIVE results that were not observed. The offline demo is fully playable and
  fully verified; the LIVE path status is stated below, verbatim.

## Live URL

**<https://leslie520-bye.github.io/oriera-worldchat/>** — GitHub Pages, deployed straight
from this folder (no build step). Boot-verified in headless Chromium against this exact URL.

## 30-second judge flow

1. Open the URL — on first visit the world introduces itself after ~1.5 s (hook sentence
   auto-plays once; any click/keypress cancels it if you'd rather drive).
2. Click chip `别清空，放3球` — watch the negation guard refuse `别清空` while `放3个球`
   executes (honest refusal, visible in the tool line).
3. Click **🎬 Direct a scene** — the L9 card shows Act/Beat/Theme plus the `Recalled:` line
   and a `recall: N facts` chip: memory being *used*, not just stored.
4. **Reload the page** — same world, same memories, same generated art (downsampled cache).
   Then `node selfcheck.mjs` if you want the 49-check receipt.

## How judges run it locally

```bash
node selfcheck.mjs          # 49 checks, offline, exit 0
node tools/proxy.mjs --static .   # then open http://127.0.0.1:<port>/
```

No install, no build. Offline (no key) the world is fully playable: rule-engine parsing,
procedural L8 art, honest degradation labels. With a Nebius Token Factory key (⚙ Settings →
Save & connect), parsing/narration/direction hop through Nemotron Nano/Super and the heavy
tier and `retheme` calls `/v1/images/generations`; every hop lands in the router log.

## Known limitations

1. **LIVE path is code-complete but has never been executed against the real Token Factory
   service.** Reason: during the whole submission window we had no API key — Nebius account
   signup is blocked at the billing-country step (no China mainland option), so no trial
   credits could be activated. What IS verified: `node selfcheck.mjs` → 49/49 passed; the
   full offline pipeline passes in a real Chromium engine (`test/e2e.html` → `"ok":true`).
   The ONLINE request shapes (OpenAI-compatible `/chat/completions`;
   `/images/generations` with `response_format: "b64_json"`, `width`, `height`) and the four
   default model IDs (`nvidia/nemotron-nano-9b-v2`, `nvidia/llama-3.3-nemotron-super-49b-v1.5`,
   `nvidia/nemotron-3-super-120b-a12b`, `black-forest-labs/flux-schnell`) are
   best-effort against published docs, **not** observed behavior. The heavy-tier default was
   updated after `nvidia/llama-3.1-nemotron-ultra-253b-v1` was removed from Token Factory
   Serverless (2026-08-31 deprecation notice; the successor ID is confirmed served on Token
   Factory per Nebius's own announcement, checked 2026-10-19 — the live catalog itself could
   not be enumerated without a key). CORS of the API is also
   unverified; the bundled relay (`node tools/proxy.mjs --relay 8787`, loopback-only) is the
   documented fallback.
   **What HAS been observed online (2026-10-19, unauthenticated):** all endpoints are
   reachable and the gateway accepts the documented paths — with an invalid key,
   `GET /v1/models` and all three `/chat/completions` tiers return
   `401 {"detail":"Couldn't authenticate. Reason: Unable authenticate"}` while
   `/images/generations` returns a bare `404` (undocumented unauthenticated routing; reported
   in FEEDBACK.md). Authenticated behavior of every probe remains unobserved until a valid
   key exists.
2. **How to close this gap the moment a key exists — no code changes required:**
   - `node selfcheck.mjs --live` (optionally `--key=nvapi-…` or env `NEBIUS_API_KEY`) runs
     five read-scale probes (models catalog; fast/mid/heavy chat at ≤24 output tokens; one
     256px image) and prints status, latency, token counts, `<think>` presence, and whether
     the fast reply parses to a `spawn_balls` command — screenshot that output as the
     router-log evidence. Without a key it fails loudly; it never fakes responses.
   - Browser path: ⚙ Settings → paste key → Save & connect → run the guided demo; if model
     IDs drifted, ⚙ → Discover models re-fills them from the live `/v1/models` catalog.
3. **Hosting is independent of the Nebius blocker and is now done:** the folder was pushed
   to GitHub Pages (URL at the top). For the record, what blocked it earlier was simply that
   no static-host account/credentials existed in this workspace — a separate issue from the
   Nebius billing-country problem; an authenticated `gh` CLI present in the environment
   closed it without any Nebius involvement.
4. Offline rule parsing covers a fixed vocabulary (spawn/boost/clear/gravity/particles/
   retheme/count; Chinese numerals 一–十/两/百); anything outside it is refused honestly
   rather than guessed.
5. **`--live` exit-code semantics (measured):** `node selfcheck.mjs` (no flag) → exit 0,
   live never requested (opt-in by design); `--live` without a key → exit 1 (fails loudly);
   `--live` with an invalid key → probes run against the real service, report per-probe
   HTTP results, exit 1. A CI gate that appends `--live` therefore fails closed when the
   key is missing — "unconfigured" can never masquerade as "passed".
