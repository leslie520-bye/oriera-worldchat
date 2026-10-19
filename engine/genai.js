/* ============================================================
 * OriEra WorldChat — L8 generative kernel (browser-side mirror)
 * ADAPTED from engine/examples/13-genai-gallery/engine/genai.js (read
 * 2026-10-19). Kept the exact hot-swap chain so the demo shows the same
 * mechanics as the engine:
 *   GenerationProvider → execute → validateAsset → AssetStore.insertNamed
 *   (same-name swap, handle stable) → SlotBindings → renderer.
 *   ↑ genai.js:46       ↑ genai.js:237              ↑ genai.js:297/305
 * The one vendor change: CogView (Zhipu) endpoint → Nebius Token Factory
 * /v1/images/generations (NVIDIA-hosted open models: flux-schnell, sdxl).
 * Offline backend stays the deterministic procedural canvas (ProceduralProvider,
 * same role as Rust MockProvider) — degradation is also expression (ADR 0003).
 * ============================================================ */

export const GenerationKind = { TEXT_TO_IMAGE: "text_to_image" };
export const AssetFormat = { IMAGE: "image" };

/* ---------- L8 · validation (genai.js:41-65, PNG/JPEG subset) ---------- */
const HARD_MAX_ASSET_BYTES = 32 * 1024 * 1024;
const effectiveLimit = n => (!n || n > HARD_MAX_ASSET_BYTES ? 16 * 1024 * 1024 : n);
export function validateAsset(asset) {
  const b = asset.payload, max = effectiveLimit(asset.max_bytes);
  if (b.length > max) throw new Error(`${b.length} bytes exceeds the ${max} byte ceiling`);
  const ok =
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||   // PNG
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff);                      // JPEG
  if (!ok) throw new Error("payload does not match the image format signature");
}

export function textToImage(name, prompt, opts = {}) {
  return {
    kind: GenerationKind.TEXT_TO_IMAGE, prompt, name,
    width: opts.width ?? 768, height: opts.height ?? 512,
    max_bytes: opts.maxBytes ?? 16 * 1024 * 1024, seed: opts.seed ?? null,
  };
}

/* ---------- L8 · Nebius Token Factory image adapter ----------
 * POST {base}/images/generations {model, prompt, response_format, width, height}
 * Documented models: black-forest-labs/flux-schnell, stability-ai/sdxl.
 * Accepts both b64_json and url replies.
 * ------------------------------------------------------------- */
export class TokenFactoryImageProvider {
  constructor(cfg) { this.cfg = cfg; this.stats = { calls: 0, errors: 0, images: 0, ms: 0 }; }
  get id() { return "nebius-images-v1"; }
  get ready() { return !!this.cfg.key; }
  get capabilities() { return { text_to_image: true }; }
  get model() { return this.cfg.model || "black-forest-labs/flux-schnell"; }
  async execute(req) {
    if (!this.ready) throw new Error("tokenfactory image provider selected without a key");
    this.stats.calls++;
    const t0 = Date.now();
    const r = await fetch((this.cfg.base || "https://api.tokenfactory.nebius.com/v1") + "/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.cfg.key },
      body: JSON.stringify({
        model: this.model, prompt: req.prompt,
        response_format: "b64_json", width: req.width, height: req.height,
      }),
      signal: AbortSignal.timeout(90000), // image gen blocks server-side 2–30s
    });
    if (!r.ok) { this.stats.errors++; throw new Error("tokenfactory images HTTP " + r.status); }
    const data = await r.json();
    const entry = data.data && data.data[0];
    let bytes;
    if (entry && entry.b64_json) {
      const bin = atob(entry.b64_json); bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else if (entry && entry.url) {
      const img = await fetch(entry.url); // signed CDN: no Authorization
      if (!img.ok) { this.stats.errors++; throw new Error("image download HTTP " + img.status); }
      bytes = new Uint8Array(await img.arrayBuffer());
    } else { this.stats.errors++; throw new Error("reply has neither url nor b64_json"); }
    this.stats.ms = Date.now() - t0;
    this.stats.images++;
    return { format: AssetFormat.IMAGE, payload: bytes, provider_id: this.id, model: this.model };
  }
}

/* ---------- L8 · deterministic offline backend (genai.js:161-205) ----------
 * Same prompt → same picture (hash-seeded colors). No key still produces a
 * frame — this is the "degradation is also expression" rule in the browser.
 * ------------------------------------------------------------ */
export class ProceduralProvider {
  constructor() { this.stats = { calls: 0, errors: 0, images: 0, ms: 0 }; }
  get id() { return "procedural-v1"; }
  get ready() { return true; }
  get capabilities() { return { text_to_image: true }; }
  async execute(req) {
    this.stats.calls++;
    const t0 = Date.now();
    const seed = [...(req.prompt + "|" + req.name)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rnd = (() => { let s = seed || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
    const cv = document.createElement("canvas"); cv.width = req.width; cv.height = req.height;
    const g = cv.getContext("2d");
    const hue = seed % 360, hue2 = (hue + 40 + Math.floor(rnd() * 80)) % 360;
    if (req.name.startsWith("sky")) {
      const grad = g.createLinearGradient(0, 0, 0, req.height);
      grad.addColorStop(0, `hsl(${hue} 62% 16%)`); grad.addColorStop(.55, `hsl(${hue2} 58% 34%)`); grad.addColorStop(1, `hsl(${hue2} 48% 58%)`);
      g.fillStyle = grad; g.fillRect(0, 0, req.width, req.height);
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `rgba(255,255,255,${.2 + rnd() * .7})`;
        g.beginPath(); g.arc(rnd() * req.width, rnd() * req.height * .6, rnd() * 1.6, 0, 7); g.fill();
      }
    } else { // posters: radial duotone + abstract arcs
      const bg = g.createRadialGradient(req.width / 2, req.height * .4, 30, req.width / 2, req.height / 2, req.width);
      bg.addColorStop(0, `hsl(${hue} 55% 30%)`); bg.addColorStop(1, `hsl(${hue2} 60% 12%)`);
      g.fillStyle = bg; g.fillRect(0, 0, req.width, req.height);
      for (let i = 0; i < 7; i++) {
        g.strokeStyle = `hsla(${(hue + i * 24) % 360} 70% ${55 + rnd() * 20}% / .8)`; g.lineWidth = 2 + rnd() * 7;
        g.beginPath();
        if (rnd() < .5) g.arc(req.width / 2, req.height / 2, 30 + i * 22 + rnd() * 18, rnd() * 6, rnd() * 6 + 1.5 + rnd() * 3);
        else { const y = rnd() * req.height; g.moveTo(20 + rnd() * 40, y); g.bezierCurveTo(req.width * .4, y - 100 * rnd(), req.width * .6, y + 100 * rnd(), req.width - 30, y); }
        g.stroke();
      }
    }
    const blob = await new Promise(res => cv.toBlob(res, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    this.stats.ms = Date.now() - t0;
    this.stats.images++;
    return { format: AssetFormat.IMAGE, payload: bytes, provider_id: this.id, model: "procedural-canvas" };
  }
}

/** Selection → adapter. A remote choice without a key degrades to procedural
 * (mirrors Rust "remote kinds with an empty key degrade to offline"). */
export function createGenerationProvider(cfg) {
  return cfg && cfg.key ? new TokenFactoryImageProvider(cfg) : new ProceduralProvider();
}

/* ---------- L4 · named asset store (genai.js:235-243 insert_named) ---------- */
export class AssetStore {
  constructor() { this.named = new Map(); this.version = 0; this.subs = []; }
  insertNamed(name, genAsset) { // same-name in-place swap: handle unchanged, payload updates
    this.named.set(name, { ...genAsset, name, v: ++this.version });
    for (const fn of this.subs) fn(name, this.named.get(name));
  }
  getNamed(name) { return this.named.get(name); }
  onInsert(fn) { this.subs.push(fn); }
}

/* ---------- L8 · engine system (genai.js:252-294, reduced) ----------
 * Queue + in-flight cap + validation + metering + typed events.
 * ------------------------------------------------------------------ */
export class GenAiSystem {
  constructor(provider, { maxInFlight = 3 } = {}) {
    this.provider = provider; this.maxInFlight = maxInFlight;
    this.queue = []; this.inFlight = 0; this.rejected = 0;
  }
  get name() { return "l8-genai"; }
  submit(req) {
    if (!this.provider.capabilities[req.kind]) { this.rejected++; return false; }
    this.queue.push(req); return true;
  }
  pending() { return this.queue.length + this.inFlight; }
  tick(world) {
    while (this.inFlight < this.maxInFlight && this.queue.length) {
      const req = this.queue.shift();
      this.inFlight++;
      const m = (world.genaiMeter ||= { submitted: 0, succeeded: 0, failed: 0, degraded: 0 });
      m.submitted++;
      this.provider.execute(req)
        .then(asset => {
          try { validateAsset(asset); }
          catch (e) { this._fail(world, req, "validation: " + e.message); return; }
          m.succeeded++;
          (world.pendingSwaps ||= []).push({ name: req.name, asset, placeholder: false });
          (world.events ||= []).push({ type: "genai-landed", name: req.name, provider: this.provider.id });
        })
        .catch(e => this._fail(world, req, String(e && e.message || e)))
        .finally(() => { this.inFlight--; });
    }
  }
  _fail(world, req, error) {
    const m = world.genaiMeter;
    if (m) { m.failed++; m.degraded++; }
    (world.events ||= []).push({ type: "genai-failed", name: req.name, error, degraded: true });
  }
}

/** L4 swap landing (genai.js:297 apply_pending). */
export function applyPending(store, world) {
  const swaps = (world.pendingSwaps || []).splice(0);
  for (const s of swaps) store.insertNamed(s.name, { ...s.asset, placeholder: false });
  return swaps.length;
}

/* ---------- L5 · slot bindings (renderer-agnostic consumer) ---------- */
export class SlotBindings {
  constructor(store) { this.map = new Map(); store.onInsert((name, asset) => { const fn = this.map.get(name); if (fn) fn(asset); }); }
  bind(name, apply) { this.map.set(name, apply); }
}

/* ---------- L8 · art director (prompt shape is engine knowledge) ---------- */
export const ART_SLOTS = [
  { name: "sky.dome", label: "Sky dome", kind: GenerationKind.TEXT_TO_IMAGE, width: 1024, height: 512 },
  { name: "poster.1", label: "Poster ①", kind: GenerationKind.TEXT_TO_IMAGE, width: 512, height: 640 },
  { name: "poster.2", label: "Poster ②", kind: GenerationKind.TEXT_TO_IMAGE, width: 512, height: 640 },
];
export class ArtDirectorSystem {
  constructor(genai) { this.genai = genai; }
  get name() { return "l8-art-director"; }
  /** Retheme: submit one generation per slot (same name re-generation == hot swap). */
  retheme(world, theme) {
    const names = [];
    for (const slot of ART_SLOTS) {
      const prompt = slot.name.startsWith("sky")
        ? `wide panoramic game sky, ${theme}, seamless horizon, no text, unified palette`
        : `vertical world poster illustration, ${theme}, rich atmosphere, abstract subject, no text, no watermark`;
      if (this.genai.submit(textToImage(slot.name, prompt, { width: slot.width, height: slot.height }))) names.push(slot.name);
    }
    (world.events ||= []).push({ type: "art-retheme", theme, names });
    return names;
  }
}
