#!/usr/bin/env node
/* ============================================================
 * OriEra WorldChat — selfcheck
 * Run:  node selfcheck.mjs
 * Exit 0  = the demo is complete and demonstrable offline (files present,
 *           every engine file parses, the rule parser / command queue /
 *           budget allocator / memory store / asset hot-swap chain all
 *           behave as the demo needs).
 * Exit ≠0 = prints every failure reason.
 * This script is REAL: it re-runs on every change and can fail.
 * Network is NOT touched by default — the online path needs a user key.
 * `node selfcheck.mjs --live [--key=nvapi-…]` additionally runs 5 tiny
 * READ-scale probes against the real Nebius Token Factory (models catalog,
 * fast/mid/heavy chat, one 256px image) and prints screenshot-able evidence;
 * without a key it fails loudly instead of pretending.
 * ============================================================ */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const failures = [];
const checks = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(detail => {
      checks.push(name);
      console.log("  ok  " + name + (detail ? "  — " + detail : ""));
    })
    .catch(e => {
      failures.push(name + ": " + (e && e.message || e));
      console.error("FAIL  " + name + ": " + (e && e.message || e));
    });
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/* ---------- 1. files on disk ---------- */
console.log("[1] required files");
const REQUIRED = [
  "index.html", "styles.css", "README.md", "LICENSE", "package.json", "selfcheck.mjs",
  "engine/kernel.js", "engine/genai.js", "engine/director.js", "engine/world.js", "engine/main.js",
  "tools/proxy.mjs", "test/e2e.html",
];
for (const f of REQUIRED)
  check("exists: " + f, () => { assert(existsSync(join(ROOT, f)), "missing file"); });

/* ---------- 2. every engine file parses as ES module ---------- */
console.log("[2] syntax (node --check, ESM via package.json type=module)");
for (const f of ["engine/kernel.js", "engine/genai.js", "engine/director.js", "engine/world.js", "engine/main.js", "tools/proxy.mjs", "selfcheck.mjs"]) {
  check("parses: " + f, () => {
    const r = spawnSync(process.execPath, ["--check", join(ROOT, f)], { encoding: "utf8" });
    assert(r.status === 0, (r.stderr || "syntax error").trim().split("\n").slice(0, 4).join(" | "));
  });
}

/* ---------- 3. index.html references resolve + UI hooks exist ---------- */
console.log("[3] index.html integrity");
check("all local script/css refs exist", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
    .filter(u => !/^(https?:)?\/\//.test(u));
  for (const ref of refs) assert(existsSync(join(ROOT, ref)), "broken ref: " + ref);
  return refs.length + " refs";
});
check("UI hooks used by main.js exist in index.html", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const ids = ["chat-log", "chat-input", "chat-send", "world", "hud", "router-log",
    "allocator", "credits-used", "credits-baseline", "credits-saved",
    "cnt-processed", "cnt-coalesced", "cnt-deferred", "cnt-rejected",
    "slots", "mem-list", "beats", "btn-export", "btn-wipe", "btn-direct", "btn-demo",
    "btn-settings", "settings", "f-key", "f-base", "f-fast", "f-mid", "f-heavy",
    "f-image", "f-narrate", "btn-discover", "btn-settings-save", "btn-settings-cancel",
    "status-badge", "discover-out", "suggestions"];
  for (const id of ids) assert(html.includes(`id="${id}"`), "missing id=" + id);
  return ids.length + " ids";
});
check("README names the track + models", () => {
  const md = readFileSync(join(ROOT, "README.md"), "utf8");
  assert(/Best Apps and Agents/.test(md), "track not declared");
  assert(/[Nn]emotron/.test(md), "no Nemotron mention");
  assert(/[Tt]oken [Ff]actory/.test(md), "no Token Factory mention");
});
check("LICENSE is MIT", () => {
  assert(/MIT License/.test(readFileSync(join(ROOT, "LICENSE"), "utf8")));
});
check("no hardcoded API keys in code", () => {
  for (const f of REQUIRED.filter(f => f.endsWith(".js")).concat("index.html")) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert(!/nvapi-[A-Za-z0-9_\-]{8,}/.test(src), f + " contains an nvapi- key");
    assert(!/["'\s]sk-[A-Za-z0-9]{16,}/.test(src), f + " contains an sk- key");
  }
});

/* ---------- 4. engine behavior: rule parser (offline oracle) ---------- */
console.log("[4] L7 rule parser (mirrors the verified 06-agent-physics case)");
const { parseIntent, parseIntents, CommandQueue, BudgetAllocator, UsageMeter, MemoryStore, PROVIDER_PRESETS, NEBIUS_BASE } =
  await import("./engine/kernel.js");

check("verified sentence → 5 ordered tool calls", () => {
  const out = parseIntents("左边放6个球，右边放一个方块，重力调到0.3，清空，扔2个球")
    .map(x => x.intent);
  assert(out.length === 5, "expected 5 intents, got " + out.length + ": " + JSON.stringify(out));
  const [a, b, c, d, e] = out;
  assert(a.tool === "spawn_balls" && a.args.count === 6 && a.args.side === "left", "cmd1 " + JSON.stringify(a));
  assert(b.tool === "spawn_boxes" && b.args.count === 1 && b.args.side === "right", "cmd2 " + JSON.stringify(b));
  assert(c.tool === "set_gravity" && c.args.factor === 0.3, "cmd3 " + JSON.stringify(c));
  assert(d.tool === "clear_world", "cmd4 " + JSON.stringify(d));
  assert(e.tool === "boost" && e.args.count === 2, "cmd5 " + JSON.stringify(e));
});
check("negation guard: 别清空 parses to null", () => {
  assert(parseIntent("别清空") === null, "should be refused");
  assert(parseIntent("don't clear") === null, "should be refused");
});
check("gravity without a number is refused, not reported as a fake action", () => {
  assert(parseIntent("重力像月球") === null, "no-number gravity must refuse, not set_gravity(1)");
  assert(parseIntent("gravity like the moon") === null, "no-number gravity must refuse");
  const g = parseIntent("重力调到0.3");
  assert(g && g.tool === "set_gravity" && g.args.factor === 0.3, JSON.stringify(g));
});
check("english: 'left 6 balls' + 'gravity 0.1'", () => {
  const a = parseIntent("left 6 balls");
  assert(a && a.tool === "spawn_balls" && a.args.count === 6 && a.args.side === "left", JSON.stringify(a));
  const g = parseIntent("gravity 0.1");
  assert(g && g.tool === "set_gravity" && g.args.factor === 0.1, JSON.stringify(g));
});
check("hundred numerals parse; declared vocabulary == parsed vocabulary", () => {
  const a = parseIntent("一百个球");
  assert(a && a.tool === "spawn_balls" && a.args.count === 100, JSON.stringify(a));
  const b = parseIntent("两百二十个球");
  assert(b && b.tool === "spawn_balls" && b.args.count === 220, JSON.stringify(b));
  assert(parseIntent("一千个球") === null, "千 is outside the declared vocabulary — must refuse honestly");
});
check("particles + retheme + full-width digits", () => {
  const p = parseIntent("粒子变成金色风暴");
  assert(p && p.tool === "particles" && p.args.color === "gold" && p.args.mode === "storm", JSON.stringify(p));
  const p2 = parseIntent("particles gold storm");
  assert(p2 && p2.tool === "particles" && p2.args.color === "gold", JSON.stringify(p2));
  const t = parseIntent("把世界装帧成「黄昏火山群岛」");
  assert(t && t.tool === "retheme" && t.args.theme === "黄昏火山群岛", JSON.stringify(t));
  const f = parseIntent("放５个球"); // full-width 5
  assert(f && f.tool === "spawn_balls" && f.args.count === 5, JSON.stringify(f));
});

/* ---------- 5. command queue: frame budget + provable coalescing ---------- */
console.log("[5] L7 command queue");
check("adjacent same-tool commands coalesce; counters honest", () => {
  const seen = [];
  const q = new CommandQueue(cmd => seen.push(cmd), { frameBudget: 2 });
  q.submitIntent({ tool: "spawn_balls", args: { count: 6, side: "left" } });
  q.submitIntent({ tool: "spawn_balls", args: { count: 2, side: "left" } });
  q.submitIntent({ tool: "set_gravity", args: { factor: 1 } });
  q.submitIntent({ tool: "set_gravity", args: { factor: 0.3 } });
  assert(q.queue.length === 2, "queue should hold 2 after coalescing, got " + q.queue.length);
  assert(q.coalesced === 2, "coalesced should be 2, got " + q.coalesced);
  const worldStub = {};
  q.tick(worldStub); // budget 2 → everything runs
  assert(seen.length === 2 && seen[0].args.count === 8, JSON.stringify(seen));
  assert(q.processed === 2, "processed " + q.processed);
});
check("coalescing preserves conflicting side args ('左6球+右6球' stays two commands)", () => {
  const seen = [];
  const q = new CommandQueue(cmd => seen.push(cmd), { frameBudget: 8 });
  const intents = parseIntents("左边放6个球，右边放6个球").map(x => x.intent).filter(Boolean);
  assert(intents.length === 2, "expected 2 intents, got " + JSON.stringify(intents));
  for (const i of intents) q.submitIntent({ tool: i.tool, args: i.args || {} });
  assert(q.queue.length === 2, "different sides must NOT coalesce, got queue=" + q.queue.length);
  assert(q.coalesced === 0, "nothing should be counted as coalesced, got " + q.coalesced);
  q.tick({});
  assert(seen[0].tool === "spawn_balls" && seen[0].args.count === 6 && seen[0].args.side === "left", JSON.stringify(seen[0]));
  assert(seen[1].tool === "spawn_balls" && seen[1].args.count === 6 && seen[1].args.side === "right", JSON.stringify(seen[1]));
});
check("same-side spawns still coalesce; gravity collapses last-wins", () => {
  const seen = [];
  const q = new CommandQueue(cmd => seen.push(cmd), { frameBudget: 8 });
  q.submitIntent({ tool: "spawn_balls", args: { count: 6, side: "left" } });
  q.submitIntent({ tool: "spawn_balls", args: { count: 6, side: "left" } });
  q.submitIntent({ tool: "set_gravity", args: { factor: 1 } });
  q.submitIntent({ tool: "set_gravity", args: { factor: 0.3 } });
  assert(q.queue.length === 2 && q.coalesced === 2, "queue=" + q.queue.length + " coalesced=" + q.coalesced);
  q.tick({});
  assert(seen[0].args.count === 12 && seen[0].args.side === "left", JSON.stringify(seen[0]));
  assert(seen[1].args.factor === 0.3, "newer gravity must win, got " + JSON.stringify(seen[1]));
});
check("frame budget defers overflow (deferred counter)", () => {
  const seen = [];
  const q = new CommandQueue(cmd => seen.push(cmd), { frameBudget: 1 });
  q.submitIntent({ tool: "spawn_balls", args: { count: 1, side: "left" } });
  q.submitIntent({ tool: "boost", args: { count: 1 } });
  q.submitIntent({ tool: "clear_world", args: {} });
  q.tick({});
  assert(seen.length === 1, "one cmd per frame, got " + seen.length);
  assert(q.deferred === 2, "deferred should be 2, got " + q.deferred);
  q.tick({}); q.tick({});
  assert(seen.length === 3 && q.deferred === 0, "queue should drain");
});

/* ---------- 6. L2 compute allocation: EWMA shares + credit story ---------- */
console.log("[6] L2 BudgetAllocator / UsageMeter");
check("EWMA shares + saved-credits math", () => {
  const alloc = new BudgetAllocator({});
  alloc.report("fast", 8000);   // 8000 tok × weight 1  = 8000 cost
  alloc.report("heavy", 100);   //  100 tok × weight 40 = 4000 cost
  const shares = alloc.shares();
  assert(shares.fast > shares.heavy, "fast lane should dominate: " + JSON.stringify(shares));
  const total = shares.fast + shares.narrate + shares.heavy;
  assert(Math.abs(total - 1) < 1e-6, "shares must normalize to 1: " + total);
  const m = new UsageMeter({});
  m.report("fast", 1000, 100);   // 1100 tok × 1
  m.report("narrate", 100, 30);  // 130 tok × 8
  m.report("heavy", 400, 200);   // 600 tok × 40
  // credits = 1100 + 1040 + 24000 = 26140 ; baseline = 24200 × 40 = 968000... check:
  const credits = m.credits();
  const baseline = m.baselineCredits();
  assert(credits === 1100 + 130 * 8 + 600 * 40, "credits math: " + credits);
  assert(baseline === (1100 + 130 + 600) * 40, "baseline math: " + baseline);
  const saved = m.savedRatio();
  assert(saved > 0.6 && saved < 1, "saved ratio plausible: " + saved);
});

/* ---------- 7. L9 memory: roundtrip + capacity ---------- */
console.log("[7] L9 MemoryStore");
check("record/facts/capacity trim roundtrip (node, no localStorage)", () => {
  const mem = new MemoryStore("selfcheck.test", 5);
  for (let i = 0; i < 8; i++) mem.record("user", { turn: i, day: 1, about: "world", text: "fact " + i, imp: 2 });
  assert(mem.lenTotal() === 5, "capacity trim failed: " + mem.lenTotal());
  const facts = mem.facts("user", 3);
  assert(facts.length === 3 && facts[2].text === "fact 7", "facts should keep the newest");
  mem.clear();
  assert(mem.lenTotal() === 0, "clear failed");
});
check("retrieve scores recency+importance", () => {
  const mem = new MemoryStore("selfcheck.test2", 10);
  mem.record("user", { turn: 1, day: 1, about: "world", text: "likes gold storms", imp: 5 });
  mem.record("user", { turn: 2, day: 1, about: "world", text: "spawned six balls", imp: 1 });
  const hit = mem.retrieve("user", "world", "gold storm", 3, 2);
  assert(hit.length >= 1 && hit[0].text.includes("gold"), JSON.stringify(hit));
});

/* ---------- 8. L8 hot-swap chain: validate → insertNamed → bindings ---------- */
console.log("[8] L8 asset validation + named hot-swap chain");
const { validateAsset, AssetStore, SlotBindings, GenAiSystem, ART_SLOTS, GenerationKind, textToImage } =
  await import("./engine/genai.js");

const PNG_1x1 = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4nAEFAPr/AAAAAAAABQABkpOIwAAAAABJRU5ErkJggg=="
), c => c.charCodeAt(0));
check("validateAsset accepts a real PNG and rejects garbage", () => {
  validateAsset({ format: "image", payload: PNG_1x1, max_bytes: 1024 }); // must not throw
  let threw = false;
  try { validateAsset({ format: "image", payload: new Uint8Array([1, 2, 3, 4]), max_bytes: 1024 }); }
  catch { threw = true; }
  assert(threw, "garbage payload must fail validation");
});
check("insertNamed swaps in place; SlotBindings fan out", () => {
  const store = new AssetStore();
  const seen = [];
  const bindings = new SlotBindings(store);
  bindings.bind("sky.dome", a => seen.push("sky:" + a.v));
  const a1 = { format: "image", payload: PNG_1x1, provider_id: "t", model: "m" };
  store.insertNamed("sky.dome", a1);
  store.insertNamed("sky.dome", { ...a1, provider_id: "t2" });
  assert(store.version === 2, "version should advance per swap: " + store.version);
  assert(seen.length === 2 && seen[1] === "sky:2", "bindings fan-out broken: " + JSON.stringify(seen));
  assert(store.getNamed("sky.dome").provider_id === "t2", "payload should be the new one");
});
check("GenAiSystem queues with caps + ART_SLOTS shape", () => {
  const fakeCaps = { text_to_image: false };
  const sys = new GenAiSystem({ capabilities: fakeCaps, execute: async () => { throw new Error("x"); } });
  assert(sys.submit({ kind: GenerationKind.TEXT_TO_IMAGE, prompt: "x", name: "sky.dome" }) === false, "unsupported kind must be rejected");
  assert(sys.rejected === 1, "rejection counter");
  assert(ART_SLOTS.length === 3 && ART_SLOTS[0].name === "sky.dome", "slot table changed?");
  const req = textToImage("sky.dome", "test");
  assert(req.kind === GenerationKind.TEXT_TO_IMAGE && req.prompt === "test", "request builder");
});

/* ---------- 9. offline director + presets sanity ---------- */
console.log("[9] director fallback + Nebius preset sanity");
const { TieredRouter, NarratorSystem, DirectorSystem, extractJSON } = await import("./engine/director.js");
check("extractJSON survives prose-wrapped JSON", () => {
  const j = extractJSON('Sure! Here you go:\n[{"tool":"spawn_balls","args":{"count":6}}]');
  assert(Array.isArray(j) && j[0].tool === "spawn_balls", JSON.stringify(j));
});
check("extractJSON strips Nemotron <think> blocks (incl. unterminated) before matching", () => {
  const noisy = '<think>For example [{"tool":"clear_world"}] clears the world.</think>' +
    '[{"tool":"spawn_balls","args":{"count":2}}]';
  const j = extractJSON(noisy);
  assert(Array.isArray(j) && j.length === 1 && j[0].tool === "spawn_balls", JSON.stringify(j));
  const truncated = '<think>Let me think about tools like [{"tool":"particles"';
  assert(extractJSON(truncated) === null, "an all-thinking reply must yield null, not a malformed fragment");
});
check("offline director returns a rule act with the full plan shape", async () => {
  const router = new TieredRouter({ tiers: { fast: null, narrate: null, heavy: null }, log: () => {} });
  const director = new DirectorSystem(router, new MemoryStore("selfcheck.d", 5));
  const { plan, source } = await director.direct({ day: 1, world: { gravity: 1, bodies: 0 } });
  assert(source === "rule", "offline must use rule acts, got " + source);
  assert(plan.act && plan.beat && plan.theme && plan.memory, "plan incomplete: " + JSON.stringify(plan));
});
check("offline narrator stays silent (no fake cloud)", async () => {
  const router = new TieredRouter({ tiers: { fast: null, narrate: null, heavy: null }, log: () => {} });
  const n = new NarratorSystem(router, {});
  assert((await n.narrate(["spawn_balls(6)"], "en")) === null, "must not hallucinate narration offline");
});
check("Nebius preset points at Token Factory + nemotron models", () => {
  const nb = PROVIDER_PRESETS.nebius;
  assert(nb.base === NEBIUS_BASE && nb.base.startsWith("https://api.tokenfactory.nebius.com"), nb.base);
  assert(/nemotron/i.test(nb.models.fast), "fast tier should be a nemotron model");
  assert(/nemotron|llama/i.test(nb.models.heavy), "heavy tier model id present");
  assert(/flux|sdxl|stable/i.test(nb.models.image), "image model id present");
});
check("offline world simulates deterministically enough (bodies stay in bounds)", async () => {
  const { World } = await import("./engine/world.js");
  const w = new World();
  w.addBody("ball", 6, "left", 800, 500);
  w.addBody("box", 2, "right", 800, 500);
  w.boost(3, 800, 500);
  for (let i = 0; i < 240; i++) w.step(800, 500, 1);
  for (const b of w.bodies) {
    assert(b.y <= 500 - b.r + 6 + 1, "body fell through the floor: " + JSON.stringify(b));
    assert(b.x >= -1 && b.x <= 801, "body escaped sideways: " + JSON.stringify(b));
  }
  w.setParticles({ color: "gold", mode: "storm" });
  assert(w.particlesCfg.color === "gold" && w.particlesCfg.mode === "storm", "setParticles");
  const snap = w.snapshot();
  const w2 = new World(); w2.restore(snap);
  assert(w2.gravityFactor === w.gravityFactor && w2.bodies.length === w.bodies.length, "snapshot roundtrip");
});
check("world body cap evicts FIFO and the snapshot stays complete", async () => {
  const { World, MAX_BODIES } = await import("./engine/world.js");
  const w = new World();
  w.addBody("ball", MAX_BODIES + 10, "center", 800, 500);
  assert(w.bodies.length === MAX_BODIES, "cap enforced, got " + w.bodies.length);
  const snap = w.snapshot();
  assert(snap.bodies.length === w.bodies.length, "snapshot must keep every capped body");
  const w2 = new World(); w2.restore(snap);
  assert(w2.bodies.length === MAX_BODIES, "restore roundtrip through the cap");
});

/* ---------- verdict ---------- */
console.log("\n" + (failures.length
  ? `SELFCHECK FAILED — ${checks.length} passed, ${failures.length} failed`
  : `SELFCHECK PASSED — ${checks.length} checks, demo is complete and runnable offline`));
for (const f of failures) console.error("  ✗ " + f);

/* ---------- optional LIVE verification (only with --live; needs a real key) ----------
 * Read-scale on purpose: ≤24 output tokens per chat probe, one 256px image —
 * cents, not dollars. Every probe prints status + latency + reply excerpt so
 * the output doubles as the router-log evidence judges asked for. */
const argv = process.argv.slice(2);
const LIVE = argv.includes("--live");
const argVal = name => {
  const a = argv.find(s => s.startsWith("--" + name + "="));
  return a ? a.split("=").slice(1).join("=") : null;
};
async function runLive() {
  const key = argVal("key") || process.env.NEBIUS_API_KEY || "";
  const base = (argVal("base") || "https://api.tokenfactory.nebius.com/v1").replace(/\/+$/, "");
  if (!key) {
    console.error("\nLIVE: no key — pass --key=nvapi-… or set NEBIUS_API_KEY. Offline checks above still passed.");
    return false;
  }
  const { PROVIDER_PRESETS } = await import("./engine/kernel.js");
  const m = PROVIDER_PRESETS.nebius.models;
  const probes = [];
  let failuresLive = 0;
  async function probe(label, path, init, describe) {
    const t0 = Date.now();
    try {
      const r = await fetch(base + path, {
        ...init,
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(90000),
      });
      const ms = Date.now() - t0;
      const text = await r.text();
      if (!r.ok) { failuresLive++; probes.push(`${label}: FAIL HTTP ${r.status} (${ms}ms) ${text.slice(0, 140).replace(/\s+/g, " ")}`); return null; }
      let detail = "";
      try { detail = describe ? describe(text) : ""; } catch (e) { detail = "— describe failed: " + (e.message || e); }
      probes.push(`${label}: OK HTTP ${r.status} (${ms}ms) ${detail}`);
      return text;
    } catch (e) {
      failuresLive++;
      probes.push(`${label}: FAIL ${String(e.message || e).slice(0, 120)} (${Date.now() - t0}ms)`);
      return null;
    }
  }
  console.log(`\n[LIVE] base=${base} · 5 probes, read-scale budgets`);
  await probe("1/5 models  GET /models", "/models", { method: "GET" }, t => {
    const ids = (JSON.parse(t).data || []).map(x => x.id);
    const nem = ids.filter(i => /nemotron/i.test(i));
    return `— ${ids.length} models, ${nem.length} nemotron · default IDs in catalog: fast=${ids.includes(m.fast)} mid=${ids.includes(m.mid)} heavy=${ids.includes(m.heavy)} image=${ids.includes(m.image)}`;
  });
  const fastRaw = await probe(`2/5 fast    chat [${m.fast}]`, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: m.fast, temperature: 0.1, max_tokens: 24,
      messages: [{ role: "user", content: 'Convert to JSON array only: 3 balls on the left' }] }),
  }, t => {
    const j = JSON.parse(t), c = String(j.choices?.[0]?.message?.content || ""), u = j.usage || {};
    return `— tokens ${u.prompt_tokens ?? "?"}+${u.completion_tokens ?? "?"}${/<think>/i.test(c) ? " · <think> present" : " · no <think>"} · reply: ${c.slice(0, 80).replace(/\s+/g, " ")}`;
  });
  await probe(`3/5 mid     chat [${m.mid}]`, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: m.mid, temperature: 1.0, max_tokens: 24,
      messages: [{ role: "user", content: "One short playful sentence (max 10 words): six balls just landed on the left." }] }),
  }, t => "— reply: " + String(JSON.parse(t).choices?.[0]?.message?.content || "").slice(0, 80).replace(/\s+/g, " "));
  await probe(`4/5 heavy   chat [${m.heavy}]`, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: m.heavy, temperature: 0.8, max_tokens: 24,
      messages: [{ role: "user", content: 'Return ONLY JSON {"act":"<=20 chars","beat":"<=40 chars"} for a calm dawn scene.' }] }),
  }, t => {
    const j = JSON.parse(t), c = String(j.choices?.[0]?.message?.content || ""), u = j.usage || {};
    return `— tokens ${u.prompt_tokens ?? "?"}+${u.completion_tokens ?? "?"} · reply: ${c.slice(0, 80).replace(/\s+/g, " ")}`;
  });
  await probe(`5/5 image   images [${m.image}]`, "/images/generations", {
    method: "POST",
    body: JSON.stringify({ model: m.image, prompt: "dusk volcanic isles, wide panoramic sky", response_format: "b64_json", width: 256, height: 256 }),
  }, t => {
    const e = (JSON.parse(t).data || [])[0] || {};
    return `— b64_json=${e.b64_json ? "yes(~" + Math.round(e.b64_json.length * 3 / 4 / 1024) + "KB)" : "no"}${e.url ? " url=yes" : ""}`;
  });
  if (fastRaw) {
    const { extractJSON } = await import("./engine/director.js");
    const reply = String(JSON.parse(fastRaw).choices?.[0]?.message?.content || "");
    const parsed = extractJSON(reply);
    const okArr = Array.isArray(parsed) && parsed.some(c => c && c.tool === "spawn_balls");
    probes.push(`    fast reply → extractJSON → spawn_balls command: ${okArr ? "YES" : "NO"}`);
    if (!okArr) failuresLive++;
  }
  for (const p of probes) console.log("  " + p);
  console.log(failuresLive
    ? `LIVE FAILED — ${failuresLive} probe(s) failed`
    : "LIVE PASSED — all probes OK (keep this output as the router-log evidence)");
  return failuresLive === 0;
}
if (LIVE && failures.length === 0) {
  process.exit(await runLive() ? 0 : 1);
}
process.exit(failures.length ? 1 : 0);
