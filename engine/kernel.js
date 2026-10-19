/* ============================================================
 * OriEra WorldChat — engine kernel (browser-side L7/L9 mirror)
 * ADAPTED from the OriEra engine repo (read 2026-10-19):
 *   - MemoryStore        ← engine/examples/11-ai-cafe/engine/kernel.js:18 (L9, same shape)
 *   - HttpChatProvider   ← same file kernel.js:70 (OpenAI-compatible chat, Bearer)
 *   - PROVIDER_PRESETS   ← same file kernel.js:363 (presets table; Nebius tiers added)
 *   - parseIntent family ← engine/examples/06-agent-physics/index.html:160-188
 *                          + kernel.js:306-331 (negation guard, full-width digits)
 *   - CommandQueue       ← kernel.js:333-360 (frame budget + provably-safe coalescing)
 *   - BudgetAllocator / UsageMeter ← NEW, mirrors engine/docs/ARCHITECTURE.md:184-215
 *                          (EWMA cost → shares, UsageMeter metering) in reduced form.
 * Discipline carried over: application code never builds prompts, never
 * touches keys; keys live only in browser localStorage.
 * ============================================================ */

/* ---------- L9 · long-term memory (same shape as Rust MemoryStore) ---------- */
export class MemoryStore {
  /** persistKey + injectable capacity (default 60). Silently degrades to
   * in-memory when localStorage is absent (node --check / selfcheck safe). */
  constructor(persistKey = "worldchat.mem.v1", capacity = 60) {
    this.persistKey = persistKey;
    this.capacity = capacity;
    this.mem = {};
    try {
      if (typeof localStorage !== "undefined") {
        const saved = JSON.parse(localStorage.getItem(persistKey) || "null");
        if (saved) this.mem = saved;
      }
    } catch { /* corrupted storage == blank world */ }
  }
  record(agent, ep) {
    const v = (this.mem[agent] ||= []);
    v.push(ep);
    if (v.length > this.capacity) v.splice(0, v.length - this.capacity);
    this._save();
  }
  facts(agent, k = 8) { return (this.mem[agent] || []).slice(-k); }
  retrieve(agent, about, query, now, k = 4) {
    const bigrams = s => {
      const out = new Set();
      for (const seg of s.match(/[\u4e00-\u9fa5]+/g) || [])
        for (let i = 0; i < seg.length - 1; i++) out.add(seg.substr(i, 2));
      for (const w of (s.toLowerCase().match(/[a-z]{3,}/g) || [])) out.add(w);
      return out;
    };
    const q = bigrams(query + about);
    return (this.mem[agent] || [])
      .map(e => {
        const text = bigrams(e.text + e.about);
        let hits = 0; for (const g of q) if (text.has(g)) hits++;
        const recency = 1 / (1 + Math.max(0, now - e.turn));
        return { e, score: hits * 1.6 + e.imp * 0.45 + recency * 2 };
      })
      .filter(x => x.score > 0.8)
      .sort((a, b) => b.score - a.score).slice(0, k).map(x => x.e);
  }
  agents() { return Object.keys(this.mem); }
  lenTotal() { return Object.values(this.mem).reduce((a, v) => a + v.length, 0); }
  clear() { this.mem = {}; if (typeof localStorage !== "undefined") localStorage.removeItem(this.persistKey); }
  export() { return JSON.stringify(this.mem, null, 2); }
  _save() { if (typeof localStorage !== "undefined") localStorage.setItem(this.persistKey, JSON.stringify(this.mem)); }
}

/* ---------- L7 · ModelProvider: any OpenAI-compatible endpoint ----------
 * Nebius Token Factory (https://api.tokenfactory.nebius.com/v1) speaks this
 * dialect for NVIDIA Nemotron models; so do Zhipu/DeepSeek/Ollama/vLLM.
 * ----------------------------------------------------------- */
export class HttpChatProvider {
  /** cfg: {key, model, base} — the key only ever lives in localStorage */
  constructor(cfg) {
    this.cfg = cfg;
    this.stats = { calls: 0, errors: 0, tokens_in: 0, tokens_out: 0 };
  }
  get id() { return this.cfg.model || "openai-compat"; }
  get ready() { return !!this.cfg.key; }
  async complete(messages, opts = {}) {
    if (!this.ready) throw new Error("no key");
    this.stats.calls++;
    const body = JSON.stringify({
      model: this.cfg.model, messages,
      temperature: opts.temp ?? 0.6,
      max_tokens: opts.max ?? 260,
      ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch((this.cfg.base || "") + "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + this.cfg.key },
          body, signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          const err = new Error("HTTP " + r.status + (text ? " · " + text.slice(0, 120) : ""));
          // deterministic client errors (401/400/404 …) must not be retried
          if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) err.noRetry = true;
          throw err;
        }
        const data = await r.json();
        const u = data.usage || {};
        this.stats.tokens_in += (u.prompt_tokens ?? 0);
        this.stats.tokens_out += (u.completion_tokens ?? 0);
        return data.choices[0].message.content;
      } catch (e) {
        if (attempt || e.noRetry) { this.stats.errors++; throw e; }
        await new Promise(z => setTimeout(z, 700));
      }
    }
  }
  /** GET /models — used by the Settings panel to auto-fill nemotron IDs. */
  async listModels() {
    if (!this.ready) throw new Error("no key");
    const r = await fetch((this.cfg.base || "") + "/models", {
      headers: { Authorization: "Bearer " + this.cfg.key }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    return (j.data || []).map(m => m.id);
  }
}

/* ---------- L7 · presets (mirror of the upstream table, Nebius-first) ----------
 * Tier defaults are editable in the demo's Settings panel; the "Discover"
 * button re-fills them from YOUR live /models catalog (filter: nemotron).
 * ------------------------------------------------------------------ */
export const NEBIUS_BASE = "https://api.tokenfactory.nebius.com/v1";
export const PROVIDER_PRESETS = {
  nebius: {
    label: "Nebius Token Factory",
    base: NEBIUS_BASE,
    models: {
      fast: "nvidia/nemotron-nano-9b-v2",          // everyday fast calls
      mid: "nvidia/llama-3.3-nemotron-super-49b-v1.5", // narration / mid reasoning
      // heavy reasoning. The previous default (nvidia/llama-3.1-nemotron-ultra-253b-v1)
      // was removed from Token Factory Serverless (2026-08-31, official deprecation
      // notice); this is the officially promoted successor. Any Ultra ID your catalog
      // still serves stays selectable in Settings / Discover.
      heavy: "nvidia/nemotron-3-super-120b-a12b",
      image: "black-forest-labs/flux-schnell",     // L8 art slot (see genai.js)
    },
  },
  rule: { label: "Offline rule engine", base: "", models: { fast: "rule-v1" }, local: true },
};

/** A removed-from-catalog model ID must never ship as a default. */
export const RETIRED_MODEL_IDS = ["nvidia/llama-3.1-nemotron-ultra-253b-v1"];

/* ---------- L7 · command channel (mirror of Rust parse + InferSystem) ----------
 * Natural language → ordered structured commands. parseIntent is a
 * deterministic offline parser (same vocabulary as the Nano prompt in
 * director.js); when a key is present the fast tier does the parsing and this
 * rule engine stays as the offline fallback / selfcheck oracle.
 * ------------------------------------------------------------------ */
export const CMD_NEGATIONS = ["不要", "别", "勿", "别清", "don't", "dont", "do not", "never"];
const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
// declared vocabulary == parsed vocabulary: up to 百 (千/万 refuse honestly
// instead of being matched by the regex and then dropped by parseCount)
const NUM_CHARS = "\\d零〇一二两三四五六七八九十百";

export function parseCount(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (!/^[一二两三四五六七八九十百]+$/.test(value)) return NaN;
  if (value.includes("百")) {
    const [hundreds, rest] = value.split("百");
    const high = hundreds ? CN_DIGITS[hundreds] : 1;
    if (high === undefined) return NaN;
    return rest ? high * 100 + parseCount(rest) : high * 100;
  }
  if (value.includes("十")) {
    const [tens, units] = value.split("十");
    const high = tens ? CN_DIGITS[tens] : 1;
    const low = units ? CN_DIGITS[units] : 0;
    return high === undefined || low === undefined ? NaN : high * 10 + low;
  }
  return CN_DIGITS[value] ?? NaN;
}

const PARTICLE_COLORS = {
  金: "gold", 金色: "gold", 银: "silver", 银色: "silver", 红: "red", 红色: "red",
  蓝: "blue", 蓝色: "blue", 绿: "green", 绿色: "green", 紫: "purple", 紫色: "purple",
  粉: "pink", 粉色: "pink", 橙: "orange", 橙色: "orange", 青: "cyan", 青色: "cyan",
  彩虹: "rainbow",
  gold: "gold", silver: "silver", red: "red", blue: "blue", green: "green",
  purple: "purple", pink: "pink", orange: "orange", cyan: "cyan", rainbow: "rainbow",
};
const PARTICLE_MODES = {
  风暴: "storm", 暴风: "storm", 席卷: "storm", storm: "storm",
  喷泉: "fountain", fountain: "fountain",
  漩涡: "vortex", vortex: "vortex",
  平静: "calm", 安静: "calm", 缓慢: "calm", calm: "calm",
};

/** Parse ONE clause into an intent, or null when not understood. */
export function parseIntent(input) {
  // full-width digits → ASCII (Chinese IME "放５个" is common)
  const t = String(input).toLowerCase().replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // negation-before-intent guard (kernel.js:314 semantics): "别清空" must not run
  const firstNeg = CMD_NEGATIONS.map(n => t.indexOf(n)).filter(i => i >= 0);
  const firstKw = ["球", "方块", "清空", "重力", "粒子", "装帧", "多少", "扔", "clear", "gravity", "particle", "retheme", "theme"]
    .map(k => t.indexOf(k)).filter(i => i >= 0);
  if (firstNeg.length && firstKw.length && Math.min(...firstNeg) < Math.min(...firstKw)) return null;

  const numRe = new RegExp("([" + NUM_CHARS + "]+)\\s*(?:个|颗)?");
  let m;
  if (/扔|抛|throw|toss/.test(t) && /球|ball/.test(t)) {
    m = t.match(new RegExp("([" + NUM_CHARS + "]+)\\s*(?:个|颗)?\\s*球"));
    const count = m ? parseCount(m[1]) : 2;
    if (!Number.isSafeInteger(count)) return null;
    return { tool: "boost", args: { count } };
  }
  if ((m = t.match(new RegExp("([" + NUM_CHARS + "]+)\\s*(?:个|颗)?\\s*方块|([" + NUM_CHARS + "]+)\\s*box")))) {
    const count = parseCount(m[1] || m[2]);
    if (!Number.isSafeInteger(count)) return null;
    let side = "center";
    if (t.includes("左") || t.includes("left")) side = "left";
    if (t.includes("右") || t.includes("right")) side = "right";
    return { tool: "spawn_boxes", args: { count, side } };
  }
  if ((m = t.match(new RegExp("([" + NUM_CHARS + "]+)\\s*(?:个|颗)?\\s*球|([" + NUM_CHARS + "]+)\\s*balls?")))) {
    const count = parseCount(m[1] || m[2]);
    if (!Number.isSafeInteger(count)) return null;
    let side = "center";
    if (t.includes("左") || t.includes("left")) side = "left";
    if (t.includes("右") || t.includes("right")) side = "right";
    return { tool: "spawn_balls", args: { count, side } };
  }
  if (t.includes("清空") || t.includes("清屏") || /\bclear\b/.test(t)) return { tool: "clear_world", args: {} };
  if (/重力|gravity/.test(t)) {
    const g = t.match(/(-?\d+(?:\.\d+)?)/);
    // no number → refuse the clause instead of reporting a fake set_gravity(1)
    if (!g) return null;
    return { tool: "set_gravity", args: { factor: +g[1] } };
  }
  if (/粒子|particle/.test(t)) {
    const args = {};
    const hex = t.match(/#[0-9a-f]{6}/);
    if (hex) args.color = hex[0];
    else for (const [k, v] of Object.entries(PARTICLE_COLORS)) if (t.includes(k)) { args.color = v; break; }
    for (const [k, v] of Object.entries(PARTICLE_MODES)) if (t.includes(k)) { args.mode = v; break; }
    if (args.color || args.mode) return { tool: "particles", args };
    return null;
  }
  if (/装帧|换装|主题|retheme|theme/.test(t)) {
    const q = t.match(/[「"']([^」"']+)[」"']/);
    const theme = (q ? q[1] : t.replace(/装帧|换装|主题|把世界|变成|retheme|theme|the world/g, "").trim()).slice(0, 60);
    return theme ? { tool: "retheme", args: { theme } } : null;
  }
  if (/多少|几个|how many|count/.test(t)) return { tool: "count_world", args: {} };
  return null;
}

/** Each clause parses independently (06-agent-physics/index.html:183 semantics). */
export function parseIntents(text) {
  return String(text).split(/[·，,；;。\n、]+|然后|接着| and then | then /i)
    .map(c => c.trim()).filter(Boolean)
    .map(command => ({ command, intent: parseIntent(command) }));
}

export class CommandQueue {
  /** executor: (cmd, world) => string (human description). Budget / coalescing
   * / rejection counters stay in the engine — same contract as upstream. */
  constructor(executor, { frameBudget = 4 } = {}) {
    this.executor = executor; this.frameBudget = frameBudget;
    this.queue = [];
    this.processed = 0; this.rejected = 0; this.coalesced = 0; this.deferred = 0;
  }
  submitText(text) {
    for (const { intent } of parseIntents(text)) if (intent) this.submitIntent(intent);
  }
  /** Coalescing happens at submit time (upstream InferSystem semantics):
   * adjacent same-kind spawns sum — but ONLY when every other arg matches
   * (side must agree, or "左边放6个球，右边放6个球" would silently swallow
   * the right side). Repeated gravity collapses last-wins; count dedupes. */
  submitIntent(cmd) {
    const tail = this.queue[this.queue.length - 1];
    if (tail && tail.tool === cmd.tool) {
      if (cmd.tool === "spawn_balls" || cmd.tool === "spawn_boxes") {
        if ((tail.args.side || "center") === (cmd.args.side || "center")) {
          tail.args.count += cmd.args.count; this.coalesced++; return;
        }
      } else if (cmd.tool === "boost") {
        tail.args.count += cmd.args.count; this.coalesced++; return;
      } else if (cmd.tool === "set_gravity") {
        tail.args = cmd.args; this.coalesced++; return;   // last gravity wins
      } else if (cmd.tool === "count_world") {
        this.coalesced++; return;
      }
    }
    this.queue.push(cmd);
  }
  get pending() { return this.queue.length; }
  tick(world) {
    let budget = this.frameBudget;
    while (this.queue.length && budget > 0) {
      const cmd = this.queue.shift();
      budget--; // unknown spends budget too (same as Rust)
      this.executor(cmd, world);
      this.processed++;
    }
    this.deferred = this.queue.length;
  }
}

/* ---------- L2 · compute allocation (reduced BudgetAllocator) ----------
 * engine/docs/ARCHITECTURE.md:207: "EWMA cost → share with floor → hysteresis".
 * Reduced but honest: per-lane EWMA of token cost → displayed shares; credit
 * weights make the "credits stretch further" story measurable.
 * ------------------------------------------------------------------ */
export class BudgetAllocator {
  constructor({ lanes = ["fast", "narrate", "heavy"], weights = { fast: 1, narrate: 8, heavy: 40 } } = {}) {
    this.lanes = lanes; this.weights = weights;
    this.ewma = Object.fromEntries(lanes.map(l => [l, 0]));
    this.alpha = 0.25;
  }
  report(lane, tokens) {
    if (!(lane in this.ewma)) return;
    const cost = (tokens || 0) * this.weights[lane];
    this.ewma[lane] = this.ewma[lane] * (1 - this.alpha) + cost * this.alpha;
  }
  shares() {
    const total = this.lanes.reduce((a, l) => a + this.ewma[l], 0) || 1;
    const floor = 0.08;
    const raw = Object.fromEntries(this.lanes.map(l => [l, Math.max(floor, this.ewma[l] / total)]));
    const sum = Object.values(raw).reduce((a, b) => a + b, 0);
    return Object.fromEntries(Object.entries(raw).map(([l, v]) => [l, v / sum]));
  }
}

/** Token accounting per tier (feeds the credits panel). */
export class UsageMeter {
  constructor({ weights = { fast: 1, narrate: 8, heavy: 40 } } = {}) {
    this.weights = weights;
    this.usage = { fast: { tokens: 0, calls: 0, errors: 0 }, narrate: { tokens: 0, calls: 0, errors: 0 }, heavy: { tokens: 0, calls: 0, errors: 0 } };
  }
  report(lane, tokensIn, tokensOut, err = false) {
    const u = (this.usage[lane] ||= { tokens: 0, calls: 0, errors: 0 });
    u.tokens += (tokensIn || 0) + (tokensOut || 0);
    u.calls++;
    if (err) u.errors++;
  }
  credits() {
    return this.laneList().reduce((a, l) => a + this.usage[l].tokens * this.weights[l], 0);
  }
  /** What the same traffic would have cost if every call went to the heavy tier. */
  baselineCredits() {
    return this.laneList().reduce((a, l) => a + this.usage[l].tokens * this.weights.heavy, 0);
  }
  savedRatio() {
    const used = this.credits(), base = this.baselineCredits();
    return base > 0 ? 1 - used / base : 0;
  }
  laneList() { return Object.keys(this.usage); }
}

/* ---------- L2 · scheduler (the app only pumps; systems stay inside) ---------- */
export class Scheduler {
  constructor() { this.systems = []; }
  add(sys) { this.systems.push(sys); return sys; }
  async tick(world) { for (const s of this.systems) await s.tick && s.tick(world); }
}
