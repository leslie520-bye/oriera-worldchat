/* ============================================================
 * OriEra WorldChat — the world being talked to (NEW code).
 * Canvas-2D particle field + physics bodies, in the spirit of
 * engine/examples/06-agent-physics (Body/World, gravity factor,
 * drag) and engine/examples/07-webgpu-particles (particle field),
 * but dependency-free so the demo runs anywhere.
 * Import-safe in Node: no DOM at module top level; step() is pure
 * math; render() takes an injected 2D context.
 * ============================================================ */

export const PARTICLE_PALETTE = {
  gold: "#ffd166", silver: "#dfe6f1", red: "#ff6b6b", blue: "#6bb8ff",
  green: "#7bd88f", purple: "#b18cff", pink: "#ff8ad1", orange: "#ffa552",
  cyan: "#6be3e0",
};
const PARTICLE_N = 420;
/** Hard cap so the O(n²) separation pass and the localStorage snapshot stay
 * bounded; oldest bodies are evicted FIFO (the HUD shows the live count). */
export const MAX_BODIES = 160;

export class World {
  constructor() {
    this.bodies = [];
    this.gravityFactor = 1;
    this.particlesCfg = { color: "cyan", mode: "calm" };
    this.particles = Array.from({ length: PARTICLE_N }, () => ({
      x: Math.random(), y: Math.random(),          // normalized 0..1, scaled at draw/step
      vx: (Math.random() - .5) * .002, vy: (Math.random() - .5) * .002,
      h: Math.random(),                             // rainbow hue phase
      r: .8 + Math.random() * 1.8,
    }));
    this.day = 1;
    this.beats = [];
    this.turn = 0;
    this.t = 0;
  }

  /* ---------- commands (called by the L7 executor) ---------- */
  _trim() { while (this.bodies.length > MAX_BODIES) this.bodies.shift(); }
  addBody(kind, count, side, W, H) {
    for (let i = 0; i < count; i++) {
      let x = W * (.25 + Math.random() * .5);
      if (side === "left") x = W * (.06 + Math.random() * .2);
      if (side === "right") x = W * (.74 + Math.random() * .2);
      this.bodies.push({
        x, y: 30 + i * 34, vx: (Math.random() - .5) * 2, vy: 0,
        r: kind === "box" ? 16 + Math.random() * 6 : 11 + Math.random() * 7,
        kind, hue: (Math.random() * 360) | 0,
      });
    }
    this._trim();
  }
  boost(count, W, H) {
    for (let i = 0; i < count; i++) {
      this.bodies.push({
        x: W * (.35 + Math.random() * .3), y: H - 40, vx: (Math.random() - .5) * 6,
        vy: -(6 + Math.random() * 4), r: 11 + Math.random() * 7, kind: "ball",
        hue: (Math.random() * 360) | 0,
      });
    }
    this._trim();
  }
  clearWorld() { this.bodies = []; }
  setGravity(factor) { this.gravityFactor = Math.max(0, Math.min(4, factor)); }
  setParticles(cfg) {
    if (cfg.color) this.particlesCfg.color = String(cfg.color).slice(0, 24);
    if (cfg.mode) this.particlesCfg.mode = String(cfg.mode).slice(0, 16);
  }
  pushBeat(beat) {
    this.beats.push({ day: this.day, text: String(beat).slice(0, 60) });
    if (this.beats.length > 30) this.beats.shift();
  }

  count() { return this.bodies.length; }

  /* ---------- persistence ---------- */
  snapshot() {
    return {
      gravityFactor: this.gravityFactor, particlesCfg: this.particlesCfg,
      day: this.day, beats: this.beats.slice(-12),
      // bodies are already capped at MAX_BODIES, so the snapshot is complete —
      // "reload and the world remembers you" no longer silently drops bodies.
      bodies: this.bodies.slice(-MAX_BODIES).map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, r: b.r, kind: b.kind, hue: b.hue })),
    };
  }
  restore(s) {
    if (!s) return;
    this.gravityFactor = s.gravityFactor ?? 1;
    this.particlesCfg = s.particlesCfg || this.particlesCfg;
    this.day = s.day || 1;
    this.beats = s.beats || [];
    if (Array.isArray(s.bodies)) this.bodies = s.bodies.map(b => ({ ...b }));
    this._trim();
  }

  /* ---------- simulation (pure math; dt in 16.6ms units) ---------- */
  step(W, H, dt) {
    this.t += dt;
    const g = 0.3 * this.gravityFactor;
    for (const b of this.bodies) {
      if (b.dragging) continue;
      b.vy += g * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * .45; }
      if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * .45; }
      const floor = H - b.r - 6;
      if (b.y > floor) { b.y = floor; b.vy = -Math.abs(b.vy) * .45; b.vx *= .985; }
      if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * .45; }
    }
    // pairwise separation (equal mass, cheap)
    for (let i = 0; i < this.bodies.length; i++) {
      for (let j = i + 1; j < this.bodies.length; j++) {
        const a = this.bodies[i], c = this.bodies[j];
        const dx = c.x - a.x, dy = c.y - a.y, rr = a.r + c.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < rr * rr) {
          const d = Math.sqrt(d2), push = (rr - d) / 2 / d;
          a.x -= dx * push; a.y -= dy * push; c.x += dx * push; c.y += dy * push;
          const tvx = a.vx, tvy = a.vy;
          a.vx = c.vx * .5 + a.vx * .5; a.vy = c.vy * .5 + a.vy * .5;
          c.vx = tvx * .5 + c.vx * .5; c.vy = tvy * .5 + c.vy * .5;
        }
      }
    }
    // particle field
    const cfg = this.particlesCfg;
    for (const p of this.particles) {
      if (cfg.mode === "storm") {
        const cx = .5 + .25 * Math.sin(this.t * .003), cy = .45;
        const dx = p.x - cx, dy = p.y - cy;
        p.vx += (-dy * 8 - dx * 1.2) * dt * .0016;
        p.vy += (dx * 8 - dy * 1.2) * dt * .0016;
      } else if (cfg.mode === "vortex") {
        const cx = .5 + .3 * Math.cos(this.t * .002), cy = .5 + .2 * Math.sin(this.t * .0025);
        const dx = p.x - cx, dy = p.y - cy;
        p.vx += (-dy * 12 - dx * .4) * dt * .0014;
        p.vy += (dx * 12 - dy * .4) * dt * .0014;
      } else if (cfg.mode === "fountain") {
        if (p.y > .96 && Math.random() < .02) { p.y = .97; p.x = .5 + (Math.random() - .5) * .1; p.vy = -(.02 + Math.random() * .02); p.vx = (Math.random() - .5) * .01; }
        p.vy += .00012 * dt;
      } else { // calm
        p.vx += Math.sin(this.t * .001 + p.h * 6) * dt * 2e-6;
        p.vy += Math.cos(this.t * .0013 + p.h * 5) * dt * 2e-6;
      }
      p.vx *= .995; p.vy *= .995;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > .02) { p.vx *= .02 / sp; p.vy *= .02 / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < 0) p.x += 1; if (p.x > 1) p.x -= 1;
      if (p.y < 0) p.y += 1; if (p.y > 1) p.y -= 1;
    }
  }

  /* ---------- rendering ---------- */
  render(ctx, W, H, assets = {}) {
    // sky slot (L8): cover-fit with crossfade
    const sky = assets["sky.dome"];
    if (sky && sky.img && sky.alpha > 0.01) {
      ctx.globalAlpha = sky.alpha;
      const s = Math.max(W / sky.img.width, H / sky.img.height);
      const dw = sky.img.width * s, dh = sky.img.height * s;
      ctx.drawImage(sky.img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#0a0e1a"); grad.addColorStop(1, "#131a2c");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
    // particle field (additive glow)
    const color = PARTICLE_PALETTE[this.particlesCfg.color] || this.particlesCfg.color;
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const x = p.x * W, y = p.y * H;
      ctx.fillStyle = this.particlesCfg.color === "rainbow" ? `hsl(${(p.h * 360 + this.t) % 360} 90% 65%)` : color;
      ctx.globalAlpha = .25 + .5 * (1 - Math.hypot(p.vx, p.vy) * 40);
      ctx.beginPath(); ctx.arc(x, y, p.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // ground line
    ctx.strokeStyle = "rgba(90,110,150,.35)";
    ctx.beginPath(); ctx.moveTo(0, H - 6); ctx.lineTo(W, H - 6); ctx.stroke();
    // physics bodies
    for (const b of this.bodies) {
      ctx.fillStyle = `hsl(${b.hue} 65% 62%)`;
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (b.kind === "box") ctx.rect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      else ctx.arc(b.x, b.y, b.r, 0, 7);
      ctx.fill(); ctx.stroke();
    }
    // poster slots (L8): floating framed panels
    const pw = Math.min(150, W * .14), ph = pw * 1.25;
    const slots = [["poster.1", 18, 84], ["poster.2", W - pw - 18, 84]];
    slots.forEach(([name, px, py], i) => {
      const a = assets[name];
      const bob = Math.sin(this.t * .001 + i * 2) * 4;
      ctx.save();
      ctx.globalAlpha = a && a.alpha != null ? a.alpha : 1;
      ctx.fillStyle = "rgba(10,12,20,.72)";
      ctx.strokeStyle = "rgba(150,170,220,.5)"; ctx.lineWidth = 2;
      ctx.fillRect(px - 5, py - 5 + bob, pw + 10, ph + 10);
      ctx.strokeRect(px - 5, py - 5 + bob, pw + 10, ph + 10);
      if (a && a.img) {
        const s = Math.max(pw / a.img.width, ph / a.img.height);
        const dw = a.img.width * s, dh = a.img.height * s;
        ctx.save(); ctx.beginPath(); ctx.rect(px, py + bob, pw, ph); ctx.clip();
        ctx.drawImage(a.img, px + (pw - dw) / 2, py + bob + (ph - dh) / 2, dw, dh);
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(70,80,110,.5)";
        ctx.fillRect(px, py + bob, pw, ph);
      }
      ctx.restore();
    });
  }

  stats() {
    return {
      bodies: this.bodies.length,
      cap: MAX_BODIES,
      gravity: this.gravityFactor,
      particles: this.particlesCfg,
      day: this.day,
    };
  }
}
