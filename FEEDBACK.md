# Feedback: Nebius Token Factory / Nebius AI Cloud / NVIDIA tooling

*(Submission requirement: feedback on using the platform. Written from the
integrator's seat — we built a browser-side, three-tier Nemotron router on
Token Factory for this hackathon.)*

## What worked well

1. **One OpenAI-compatible endpoint for the whole Nemotron family.** Swapping
   `nvidia/nemotron-nano-9b-v2` → `…nemotron-super…` → `…nemotron-ultra…` is a
   one-string change. Our tiered router (fast/mid/heavy) needed no per-vendor
   adapters beyond the OpenAI chat dialect everyone already speaks.
2. **Text-to-image under the same roof.** `/v1/images/generations` with
   `black-forest-labs/flux-schnell` means an app can do chat reasoning AND
   world art with one key and one base URL — no second vendor, no second bill.
   That single-origin property is what let our L8 "retheme" pipeline stay
   ~40 lines of adapter code.
3. **Model catalog naming is self-describing** (nano/super/ultra), which made
   our "Discover models" auto-configuration possible: filter `nemotron`, pick
   by size word. Small thing, big DX win.

## Friction we hit (and workarounds)

1. **CORS for browser-direct calls is undocumented.** Our demo is a static
   page; we could not confirm from public docs whether
   `api.tokenfactory.nebius.com` sends `Access-Control-Allow-Origin` for
   browser requests, and we had no key to test. We shipped a tiny local relay
   as the documented fallback — but a one-line CORS statement in the docs
   (or an `allow_browser: true` toggle) would remove a whole class of
   hackathon-time guessing.
2. **Model ID drift.** Nemotron IDs evolve (`nemotron-nano-9b-v2`,
   `llama-3.x-nemotron-super-49b-v1.5`, …). A stable alias
   (`nemotron/nano-latest`) — or a `/v1/models` response that tags each model
   with a `size_class: nano|super|ultra` field — would let tiered routers
   auto-wire without string heuristics. Concrete instance from this hackathon:
   our shipped default heavy-tier ID (`nvidia/llama-3.1-nemotron-ultra-253b-v1`)
   was removed from Token Factory Serverless mid-window (2026-08-31 deprecation
   notice; successor `nvidia/nemotron-3-super-120b-a12b`). A deprecation feed —
   or removed IDs resolving to their documented successor for a grace period —
   would protect shipped configs from silently pointing at dead IDs.
3. **`response_format: b64_json` on images** is what a browser needs (a `url`
   reply costs a second fetch and sometimes dies on signed-CDN quirks).
   Confirming + documenting the exact field parity with OpenAI images would
   help portability of existing client code.
4. **Undocumented unauthenticated routing on `/v1/images/generations`.** While
   validating our offline `--live` probe tool without credentials (observed
   2026-10-19, paths verified against the official docs), the four documented
   endpoints behave inconsistently: `GET /v1/models` and `POST /v1/chat/completions`
   return a descriptive `401 {"detail":"Couldn't authenticate. Reason: Unable
   authenticate"}`, but `POST /v1/images/generations` returns a bare
   `404 {"detail":"Not Found"}`. A uniform 401 (or one docs line on
   unauthenticated behavior) would stop integrators from mistaking the images
   404 for a wrong path or a missing model entitlement.

## What we'd love next

- A **usage/credits API** (`/v1/usage`) so apps like ours can show *real*
  credit savings instead of illustrative per-token weights. Our demo's
  "credits stretch further" panel would switch from honest estimate to hard
  numbers in one fetch.
- Server-sent **token streaming on chat** is already there and works well for
  the narrator lane; streaming for images (progressive) would make hot-swap
  worlds feel even more alive.

## NVIDIA tooling

- The **Nemotron tier system (Nano/Super/Ultra) is the best-fit abstraction
  for game engines we've seen**: engines already schedule compute per frame,
  and Nemotron's tiers map 1:1 onto "per-frame intent parsing vs per-scene
  narration vs per-act direction". Our BudgetAllocator exists because the
  models make tier-based cost engineering practical.
- Model cards on the NVIDIA build portal are clear about reasoning-mode
  behavior; we deliberately keep temperature/max_tokens tight per tier, which
  the OpenAI-compatible surface handled without dialect surprises.
