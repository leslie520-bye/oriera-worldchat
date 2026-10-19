# OriEra WorldChat — Conversation is the World

**Track: Best Apps and Agents** · Nebius x NVIDIA Global AI Hackathon (deadline 2026-10-30)

One sentence rebuilds a living world. You type `左边放6个球，右边放一个方块，重力调到0.3` and six
balls drop on the left, a box lands on the right, gravity loosens — then a narrator's voice
describes what changed, and when the scene deserves it, an AI Director plans the next act and
regenerates the world's sky and posters from text. Every hop runs on **Nebius Token Factory**
with **NVIDIA Nemotron open models**, routed by a tiered scheduler so everyday calls stay cheap:

> *"Reach for Nemotron 3 Ultra when you need serious reasoning, and let Nano or Super handle the
> fast, everyday calls, so your app stays responsive and your credits stretch further."*
> — Best Apps and Agents track description

This demo makes that sentence **visible and measurable**: a live router log shows which Nemotron
tier answered each call, and a credits panel compares actual spend against an all-Ultra baseline.

---

## What it is

A zero-dependency static web app (one HTML page + ES modules, no npm install, no build step) that
reimplements three OriEra engine layers in the browser and drives them with Nemotron:

| Engine layer | What you see | Where |
|---|---|---|
| **L7 inference runtime** | one sentence → ordered tool calls; frame-budgeted command queue with provable coalescing (`spawn+spawn = 8 balls`), rejection counters | `engine/kernel.js`, `engine/director.js` (fast tier = **Nemotron Nano**) |
| **L2 compute allocation** | per-tier EWMA shares, token/credit metering, `saved X% vs all-Ultra` | `engine/kernel.js` (`BudgetAllocator`, `UsageMeter`) |
| **L8 generative content** | `retheme` → Token Factory text-to-image (`flux-schnell`) → payload validation → **named-asset hot swap** of the sky dome and two posters (same handle, new pixels, crossfade) | `engine/genai.js`, `ArtDirectorSystem` |
| **L9 agent** | AI Director (the **HEAVY tier** — default `nvidia/nemotron-3-super-120b-a12b`, the officially promoted successor after `llama-3.1-nemotron-ultra-253b-v1` was removed from Token Factory Serverless; any Ultra ID stays Settings-selectable) plans acts: beat + theme + world transform + a memory line; **Super** narrates; `MemoryStore` persists facts and beats to localStorage — reload the page and the world remembers you | `engine/director.js`, `engine/kernel.js` (`MemoryStore`) |

The world itself (particle field + physics bodies, draggable/throwable) is a dependency-free
canvas renderer in `engine/world.js`, in the spirit of the engine's `06-agent-physics` and
`07-webgpu-particles` examples.

### Why (the problem, honestly)

AI-native games die of two costs: **latency** (a world that waits on a 250B model for every
"put a ball there" is unplayable) and **credits** (paying Ultra prices for kindergartner tasks).
OriEra's answer is architectural — AI is an engine system with a scheduler, not a chat box bolted
onto an app. This demo is that argument, runnable: the fast lane answers in a blink on Nano,
Super only speaks when there is something to narrate, the heavy tier only wakes when the story needs a
plan — and the UI proves the savings instead of claiming them.

---

## Run it

Requirements: any modern browser (Chrome/Edge/Firefox). **No install, no build.**

```bash
# from this directory — pick any static server:
node tools/proxy.mjs --static .          # zero-dep node server
# or: python -m http.server 8000
# or: npx serve .
```

Open <http://127.0.0.1:8000> (or the port your server prints). ES modules require http:// —
opening `index.html` via file:// will not work.

### Offline vs live

- **No key** → the world still fully works: a deterministic rule engine parses commands, the
  director plans from scripted acts, art slots render procedural canvas art. Badge: `OFFLINE`.
- **Live** → click **⚙ Settings**, paste a **Nebius Token Factory** API key, then **Save &
  connect**. Badge turns green: `LIVE · Nebius Token Factory`. All parsing/narration/direction
  now hops through Nemotron Nano/Super and the heavy tier; `retheme` generates real images via Token
  Factory's `/v1/images/generations`.

Model IDs are editable in Settings and there is a **Discover models** button that reads your
account's live `/v1/models` catalog and auto-fills the Nemotron IDs (nano → fast, super → mid,
ultra/nemotron-3 → heavy, flux/sdxl → image; a catalog with no Ultra falls through to the
promoted nemotron-3 family instead of keeping a dead ID). **Verify the IDs against your Token
Factory catalog before judging** — we could not call the API without a key, so defaults are
best-effort.

<details>
<summary>If the browser blocks the API call (CORS)</summary>
We could not verify Token Factory's CORS policy without a key. If you see a CORS error in the
console, run the bundled relay — <code>node tools/proxy.mjs --relay 8787</code> — and set the
Base URL in Settings to <code>http://127.0.0.1:8787/tf/v1</code>. The relay forwards requests
verbatim and stores nothing; your key still only travels between you and Nebius.
</details>

### Selfcheck

```bash
node selfcheck.mjs
```

Real checks, rerun every time: required files exist, every engine file parses as an ES module,
all index.html references resolve, no hardcoded keys, the rule parser reproduces the verified
case (`左边放6个球，右边放一个方块，重力调到0.3，清空，扔2个球` → 5 ordered tool calls), the
negation guard refuses `别清空`, coalescing preserves conflicting side args
(`左边放6个球，右边放6个球` must stay two commands), Chinese numerals up to 百 parse
(`一百个球` → 100; `一千个球` refuses honestly), gravity clauses without a number are
refused instead of reported as fake actions, command coalescing and frame-budget deferral
behave, EWMA share and credit-savings math is exact, MemoryStore trims/recalls,
`validateAsset` rejects non-PNG bytes, named-asset hot swap fires slot bindings, the offline
director/narrator degrade without faking cloud behavior, `extractJSON` survives prose-wrapped
JSON AND strips Nemotron `<think>` blocks before matching, and 240 simulated frames never
drop a body through the floor.
Exit 0 = demo is complete and runnable offline. Exit 1 = it prints exactly what broke.

**Optional LIVE mode** (never runs without it): `node selfcheck.mjs --live` first re-runs all
offline checks, then — only with `--key=nvapi-…` or `NEBIUS_API_KEY` — fires five read-scale
probes at the real Token Factory (models catalog, fast/mid/heavy chat at ≤24 output tokens,
one 256px image) and prints status/latency/tokens/`<think>`-presence per probe, suitable as
screenshot-able router-log evidence. Without a key it fails loudly; it never fakes responses.

### Browser-engine smoke test (optional, how we verified)

`node selfcheck.mjs` cannot execute a browser, so we additionally verified the page in a real
Chromium engine (headless Edge). The harness is `test/e2e.html`: it loads the same engine
modules, drives the full offline pipeline (parse → queue → simulate → **canvas render** →
procedural L8 retheme through the real hot-swap chain → director → memory), asserts the
round-2 engine behavior in the same browser engine (side-args coalescing guard,
`<think>`-block stripping, body cap + complete snapshot), and prints a JSON verdict.
Verified during development with:

```bash
node tools/proxy.mjs --static . 8001            # serve
# headless Edge, virtual time so async steps complete:
msedge --headless --disable-gpu --virtual-time-budget=10000 --dump-dom \
  "http://127.0.0.1:8001/test/e2e.html"         # → "ok":true in the dumped DOM
```

Two headless-friendly hooks exist in the demo itself (useful for any CI/screenshot tool):
- `index.html?static=1` — full boot wiring + one rendered frame, skips the infinite rAF loop
  (headless engines emit no BeginFrames, so an rAF loop never reaches quiescence).
- `window.__worldchat.pump()` — drives one engine tick manually (queue + flush).

---

## Feature list

1. **One sentence → ordered world commands** (Chinese + English, including mixed clauses,
   Chinese numerals 一–十/两/百, full-width digits, negation guard).
2. **Visible tiered routing** — every model hop is logged with tier and the model FAMILY
   actually called (FAST·Nano / MID·Super / HEAVY·<family> — labels follow the model id),
   plus model id and latency. Nothing hidden.
3. **Credits-stretch accounting** — per-tier token metering with editable lane weights
   (fast 1 / mid 8 / heavy 40, clearly labeled illustrative), live `saved X%` vs the
   all-heavy baseline.
4. **L7 queue discipline** — frame-budget execution, provable coalescing (adjacent same-tool
   spawn/boost sum **only when their other args match** — `左6球+右6球` stays two commands;
   repeated gravity collapses last-wins), deferred/rejected counters.
5. **L9 AI Director (HEAVY tier)** — plans the next act (name + beat + art theme + world transform +
   memory line), auto-triggers every 6 commands or on 🎬 button.
6. **L8 text-to-image hot swap** — director themes regenerate sky + 2 poster slots via Token
   Factory images; payloads are magic-byte validated before they touch the scene; same-name
   swap keeps the handle stable; crossfade in; thumbnails + per-slot status.
7. **L9 persistent memory** — facts + beats + world state **and generated art assets**
   (sky/posters, stored as dataURLs) survive reload (localStorage); export to JSON; wipe with
   confirmation. "Reload the page — it still remembers." Bodies are capped at 160 (FIFO
   eviction, shown live in the HUD as `bodies n/160`) so persistence stays complete, not
   lossy.
8. **Living sandbox** — 420-particle field (calm/storm/fountain/vortex × 10 colors + rainbow),
   physics bodies you can drag and throw, story-day counter.
9. **Guided demo button** — plays the whole 60-second story by itself.
10. **Honest degradation** — offline mode never fakes cloud behavior; failures fall back with a
    visible note in the router log ("nano call failed → rule fallback"), and so does a live
    reply that isn't parseable JSON (Nemotron `<think>` blocks are stripped first; if a live
    heavy plan still doesn't parse, the fallback reason is shown on the director card).
    Deterministic client errors (401/400) are not retried.

---

## 3-minute demo script (what judges should watch)

1. **0:00–0:20 — the hook.** Type `左边放6个球，右边放一个方块，重力调到0.3`. The router log
   shows one green `FAST·Nano` hop; the world obeys. This is "conversation is the world".
2. **0:20–0:45 — the sandbox.** `粒子变成金色风暴`, drag and throw a ball, `扔2个球，现在有多少个物体？`
   — the world answers with a count.
3. **0:45–1:20 — the tiered story.** Point at the credits panel: Nano pennies so far. Click
   **🎬 Direct a scene** → one `HEAVY` hop returns an act: new beat, new world state, and
   an art theme that triggers `retheme` — watch the L8 slots go `generating…` → `hot-swapped`
   as Token Factory images crossfade into the sky and posters. `saved X%` updates live.
4. **1:20–1:50 — memory.** Note the L9 memory panel (your facts + the director's). **Reload the
   page**: same world, same memories, same day counter. Wipe is one click away and clearly
   destructive.
5. **1:50–2:20 — under the hood.** Show `selfcheck.mjs` output (all green), the coalescing
   counter (send `放3个球，放5个球` → one merged command of 8), and the README table mapping
   each panel to an OriEra engine layer.
6. **2:20–3:00 — the argument.** The OriEra engine (Rust, 10 crates L0–L9) runs the same
   discipline natively; this browser mirror is the same architecture with Nemotron as the
   compute substrate and Token Factory as the accelerator. Credits stretch because the
   scheduler — not the developer — decides which model deserves each call.

**Fallback plan:** the demo is fully playable offline (rule engine + procedural art), so no
Wi-Fi/key situation can blank the screen; the guided-demo button covers shaky-hands moments.

---

## Where NVIDIA models + Token Factory are used (submission checklist)

- **Runtime platform:** Nebius Token Factory — `https://api.tokenfactory.nebius.com/v1`
  (`/chat/completions`, OpenAI-compatible; `/images/generations`). Configuration lives in
  `engine/kernel.js` (`NEBIUS_BASE`, `PROVIDER_PRESETS`) and `engine/genai.js`
  (`TokenFactoryImageProvider`).
- **NVIDIA Nemotron open models:**
  - fast tier (L7 parsing): `nvidia/nemotron-nano-9b-v2` — everyday calls, temp 0.1, ≤220 tok
  - mid tier (narration): `nvidia/llama-3.3-nemotron-super-49b-v1.5` — ≤70 tok, only after batches
  - heavy tier (L9 direction): `nvidia/nemotron-3-super-120b-a12b` — the only tier allowed
    to plan, and the officially promoted successor to `nvidia/llama-3.1-nemotron-ultra-253b-v1`,
    which was removed from Token Factory Serverless (2026-08-31, official deprecation notice;
    verified served on Token Factory via Nebius's own announcement, 2026-10-19). If your
    catalog still serves an Ultra ID, set it in ⚙ Settings or use Discover.
  - L8 art: `black-forest-labs/flux-schnell` (NVIDIA-hosted open model on Token Factory)
  - All four are Settings-editable + auto-discovered from your live catalog; verify before judging.
- **Token Factory acceleration points:** single OpenAI-compatible endpoint serves all four model
  roles → one key, one base URL, three tiers swapped by model id only; browser-direct calls (no
  backend hop); JSON-array tool-call output parsed with a fault-tolerant extractor plus rule
  fallback so a malformed generation never blocks the frame.
- **Feedback on the platform** (submission requirement): see `FEEDBACK.md`.

## Built with (honest inventory)

- **OriEra engine (existing project, Apache-2.0-licensed repo)** — this demo *adapts* two browser
  kernels and one example, it does **not** link or ship the Rust engine:
  - `engine/kernel.js` ← adapted from `OriEra/engine/examples/11-ai-cafe/engine/kernel.js`
    (MemoryStore, HttpChatProvider, presets table, CommandQueue coalescing/frame budget,
    parseIntent negation guard); BudgetAllocator/UsageMeter are new code mirroring
    `engine/docs/ARCHITECTURE.md` §compute budget.
  - `engine/genai.js` ← adapted from `OriEra/engine/examples/13-genai-gallery/engine/genai.js`
    (validateAsset, AssetStore.insertNamed hot swap, SlotBindings, GenAiSystem queue, ArtDirectorSystem);
    the vendor adapter is retargeted from Zhipu CogView to Nebius Token Factory images.
  - rule-parser vocabulary ← `OriEra/engine/examples/06-agent-physics/index.html` (`parseIntent`,
    Chinese-numeral `parseCount`).
  - world rendering ← new code, pattern-matched on `OriEra/engine/examples/06-agent-physics`
    (drag/gravity-factor) and `07-webgpu-particles` (particle field), rendered with Canvas2D.
- **Everything else is hand-written for this hackathon** (`engine/director.js`, `engine/world.js`,
  `engine/main.js`, `index.html`, `styles.css`, `tools/proxy.mjs`, `selfcheck.mjs`).
- **No frameworks, no npm dependencies, no build step.** Node ≥18 is needed only for the optional
  helper server and the selfcheck.

## Repository / licensing / provenance

- License: **MIT** (see `LICENSE`, visible at repo root).
- **Scope note:** this folder contains exactly **one** demo — the WorldChat page you are
  reading about. Any "13 browser demos" figure refers to the parent OriEra engine workspace,
  which is **not** part of this submission.
- **Existing-work declaration (hackathon rule):** the OriEra engine long predates this
  hackathon; it is a separate repository. The **entire `hackathon-demo/` directory — including
  the Nebius Token Factory presets and Nemotron tier presets in `engine/kernel.js`, the
  Token Factory image provider in `engine/genai.js`, the tiered router/director in
  `engine/director.js`, the whole UI, and this README — is new work created inside the
  submission window.** The commit history of this folder is the record of that work.

## Known limitations (said plainly)

- We had **no Token Factory API key during development**: the online path was implemented
  against the published API shapes (OpenAI-compatible chat; `/v1/images/generations` with
  `b64_json`) but **not executed against the live service**. Model-ID defaults are best-effort;
  use ⚙ → Discover models. If Token Factory rejects the `response_format` field, the image
  adapter will surface the HTTP error in the router log (and the demo keeps running offline).
- CORS policy of the API was unverifiable without a key; a zero-dep relay is bundled as the
  documented fallback.
- Offline rule parsing covers a fixed vocabulary (spawn/boost/clear/gravity/particles/retheme/
  count); anything else returns "couldn't turn that into world commands" rather than guessing.
- Restored generated art is a **downsampled copy** (≤640px-wide JPEG stored in localStorage, so
  multi-MB flux PNGs can never hit the storage quota); the live session always shows full-res.
- **Hosted:** <https://leslie520-bye.github.io/oriera-worldchat/> (GitHub Pages, deployed
  straight from this folder — no build step exists to get in the way; redeploy = push).
