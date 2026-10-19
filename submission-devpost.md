# Devpost submission copy — OriEra WorldChat

**Track:** Best Apps and Agents · Nebius x NVIDIA Global AI Hackathon
**One-liner:** Conversation is the world — one sentence rebuilds a living physics sandbox,
parsed on Nemotron Nano, narrated on Super, directed on Ultra, all routed by a tiered
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

## How judges run it

```bash
node selfcheck.mjs          # 41 checks, offline, exit 0
node tools/proxy.mjs --static .   # then open http://127.0.0.1:<port>/
```

No install, no build. Offline (no key) the world is fully playable: rule-engine parsing,
procedural L8 art, honest degradation labels. With a Nebius Token Factory key (⚙ Settings →
Save & connect), parsing/narration/direction hop through Nemotron Nano/Super/Ultra and
`retheme` calls `/v1/images/generations`; every hop lands in the router log.

## Known limitations

1. **LIVE path is code-complete but has never been executed against the real Token Factory
   service.** Reason: during the whole submission window we had no API key — Nebius account
   signup is blocked at the billing-country step (no China mainland option), so no trial
   credits could be activated. What IS verified: `node selfcheck.mjs` → 41/41 passed; the
   full offline pipeline passes in a real Chromium engine (`test/e2e.html` → `"ok":true`).
   The ONLINE request shapes (OpenAI-compatible `/chat/completions`;
   `/images/generations` with `response_format: "b64_json"`, `width`, `height`) and the four
   default model IDs (`nvidia/nemotron-nano-9b-v2`, `nvidia/llama-3.3-nemotron-super-49b-v1.5`,
   `nvidia/llama-3.1-nemotron-ultra-253b-v1`, `black-forest-labs/flux-schnell`) are
   best-effort against published docs, **not** observed behavior. CORS of the API is also
   unverified; the bundled relay (`node tools/proxy.mjs --relay 8787`, loopback-only) is the
   documented fallback.
2. **How to close this gap the moment a key exists — no code changes required:**
   - `node selfcheck.mjs --live` (optionally `--key=nvapi-…` or env `NEBIUS_API_KEY`) runs
     five read-scale probes (models catalog; fast/mid/heavy chat at ≤24 output tokens; one
     256px image) and prints status, latency, token counts, `<think>` presence, and whether
     the fast reply parses to a `spawn_balls` command — screenshot that output as the
     router-log evidence. Without a key it fails loudly; it never fakes responses.
   - Browser path: ⚙ Settings → paste key → Save & connect → run the guided demo; if model
     IDs drifted, ⚙ → Discover models re-fills them from the live `/v1/models` catalog.
3. **No hosted URL** for the same account/credentials reason. Deploy is a folder push to any
   static host (no build step exists); until then judges run the two commands above.
4. Offline rule parsing covers a fixed vocabulary (spawn/boost/clear/gravity/particles/
   retheme/count; Chinese numerals 一–十/两/百); anything outside it is refused honestly
   rather than guessed.
