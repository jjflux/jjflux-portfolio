"use strict";
/*
 * Physarum (slime mold) simulator — vanilla JS + Canvas.
 *
 * Model (per agent, per frame): SENSE 3 points ahead -> STEER -> MOVE -> DEPOSIT.
 * The shared trail map is a single Float32Array at sim resolution. Each frame the
 * map is diffused (separable 3x3 box blur) and decayed, then tone-mapped through a
 * palette LUT into one ImageData and blitted with a single putImageData.
 *
 * All state lives in flat typed arrays; there are zero allocations inside the frame
 * loop. All randomness flows from one seeded PRNG so a seed reproduces the look.
 */

/* ------------------------------------------------------------------ *
 * Constants & seeded PRNG
 * ------------------------------------------------------------------ */
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// mulberry32: tiny, fast, deterministic 32-bit PRNG returning [0,1).
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ *
 * Palettes — gradient stops interpolated into 256-entry RGB LUTs.
 * Index 0 is always black so empty space reads as background.
 * ------------------------------------------------------------------ */
const PALETTES = {
  Ember: [
    [0.0, [0, 0, 0]],
    [0.25, [50, 5, 2]],
    [0.5, [150, 25, 0]],
    [0.72, [240, 90, 10]],
    [0.88, [255, 160, 40]],
    [1.0, [255, 240, 190]],
  ],
  Bioluminescent: [
    [0.0, [0, 0, 0]],
    [0.25, [0, 28, 38]],
    [0.5, [0, 110, 120]],
    [0.72, [0, 200, 160]],
    [0.88, [80, 240, 190]],
    [1.0, [210, 255, 235]],
  ],
  Mono: [
    [0.0, [0, 0, 0]],
    [0.5, [120, 120, 130]],
    [1.0, [255, 255, 255]],
  ],
  Ultraviolet: [
    [0.0, [0, 0, 0]],
    [0.25, [30, 0, 50]],
    [0.5, [95, 15, 150]],
    [0.72, [170, 40, 200]],
    [0.88, [230, 90, 215]],
    [1.0, [255, 210, 255]],
  ],
};

// LUTs filled by buildPalette()
const palR = new Uint8Array(256);
const palG = new Uint8Array(256);
const palB = new Uint8Array(256);

function buildPalette() {
  const stops = PALETTES[P.palette] || PALETTES.Ember;
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // find the two stops bracketing t
    let s = 0;
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++;
    const [p0, c0] = stops[s];
    const [p1, c1] = stops[s + 1];
    const f = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
    palR[i] = (c0[0] + (c1[0] - c0[0]) * f) | 0;
    palG[i] = (c0[1] + (c1[1] - c0[1]) * f) | 0;
    palB[i] = (c0[2] + (c1[2] - c0[2]) * f) | 0;
  }
}

/* ------------------------------------------------------------------ *
 * Behavior presets — each defines a genuinely distinct look.
 * ------------------------------------------------------------------ */
const PRESETS = {
  Veins:  { moveSpeed: 1.0,  turnSpeed: 0.43, sensorDistance: 9,  sensorAngle: 0.50, decayFactor: 0.900, depositAmount: 5.0, palette: "Ember",          startPattern: "scatter" },
  Web:    { moveSpeed: 1.3,  turnSpeed: 0.20, sensorDistance: 22, sensorAngle: 0.28, decayFactor: 0.945, depositAmount: 3.5, palette: "Bioluminescent", startPattern: "scatter" },
  Coral:  { moveSpeed: 0.7,  turnSpeed: 0.95, sensorDistance: 5,  sensorAngle: 0.85, decayFactor: 0.880, depositAmount: 6.0, palette: "Ultraviolet",    startPattern: "disk" },
  Galaxy: { moveSpeed: 1.05, turnSpeed: 0.22, sensorDistance: 13, sensorAngle: 0.62, decayFactor: 0.955, depositAmount: 3.2, palette: "Mono",           startPattern: "ring" },
};

/* ------------------------------------------------------------------ *
 * Mutable parameter state (P) + simulation buffers
 * ------------------------------------------------------------------ */
const P = {
  agentCount: 60000,
  stepsPerFrame: 3, // simulation substeps per rendered frame (speeds motion, keeps 60fps)
  moveSpeed: 1.0,
  turnSpeed: 0.43,
  sensorDistance: 9,
  sensorAngle: 0.5,
  decayFactor: 0.9,
  depositAmount: 5.0,
  palette: "Ember",
  startPattern: "scatter",
  bloomOn: true,        // post-process glow, on by default
  bloomIntensity: 0.55, // tasteful low default so the Ember boot glows softly
  brushMode: "off",     // "off" | "attract" | "repel"
  brushSize: 36,        // brush radius in sim cells
};

let W = 1000, H = 600;          // sim resolution
let trail, blur;                // Float32Array(W*H)
let influence;                  // Float32Array(W*H) — signed paint field (+attract / -repel), slow decay
let ax, ay, ah;                 // agent x, y, heading (Float32Array)
let simRng;                     // seeded PRNG driving the simulation
const DEFAULT_SEED = 1337;      // confirmed to yield a great Coral+Ember network on load
let currentSeed = DEFAULT_SEED;
let running = true;

// Canvas / rendering
const view = document.getElementById("view");
const dctx = view.getContext("2d");
let simCanvas, simCtx, imageData, pixels;
let dispScale = 1, dispOX = 0, dispOY = 0; // letterbox fit of sim onto view

// Bloom post-process scratch canvases (allocated once per resolution, reused).
const BLOOM_DIV = 4; // blur at quarter-res — cheap, and the upscale softens it
let bloomCanvas, bloomCtx, bloomW, bloomH;

/* ------------------------------------------------------------------ *
 * Allocation of sim-resolution buffers (called on resolution change)
 * ------------------------------------------------------------------ */
function allocSim(w, h) {
  W = w; H = h;
  trail = new Float32Array(W * H);
  blur = new Float32Array(W * H);
  influence = new Float32Array(W * H);

  simCanvas = document.createElement("canvas");
  simCanvas.width = W;
  simCanvas.height = H;
  simCtx = simCanvas.getContext("2d");
  imageData = simCtx.createImageData(W, H);
  pixels = imageData.data;
  // alpha is constant; set once so the hot loop only touches RGB.
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;

  // Low-res scratch canvas for the bloom blur (reused every frame).
  bloomW = Math.max(1, Math.round(W / BLOOM_DIV));
  bloomH = Math.max(1, Math.round(H / BLOOM_DIV));
  bloomCanvas = document.createElement("canvas");
  bloomCanvas.width = bloomW;
  bloomCanvas.height = bloomH;
  bloomCtx = bloomCanvas.getContext("2d");
}

/* ------------------------------------------------------------------ *
 * Agent seeding (uses the seeded PRNG so layouts are reproducible)
 * ------------------------------------------------------------------ */
function rebuildAgents() {
  const n = P.agentCount;
  ax = new Float32Array(n);
  ay = new Float32Array(n);
  ah = new Float32Array(n);
  seedAgents();
}

function seedAgents() {
  const n = P.agentCount;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.32;
  const pattern = P.startPattern;
  for (let i = 0; i < n; i++) {
    let px, py, ph;
    if (pattern === "ring") {
      const a = simRng() * TAU;
      const rad = R * (0.88 + 0.12 * simRng());
      px = cx + Math.cos(a) * rad;
      py = cy + Math.sin(a) * rad;
      ph = a + HALF_PI; // tangential -> rotational flow
    } else if (pattern === "disk") {
      const a = simRng() * TAU;
      const rad = R * Math.sqrt(simRng()); // uniform fill
      px = cx + Math.cos(a) * rad;
      py = cy + Math.sin(a) * rad;
      ph = simRng() * TAU;
    } else {
      // scatter
      px = simRng() * W;
      py = simRng() * H;
      ph = simRng() * TAU;
    }
    ax[i] = px;
    ay[i] = py;
    ah[i] = ph;
  }
}

// Full reset: reseed PRNG, clear trail, rebuild agents.
function resetSim() {
  simRng = mulberry32(currentSeed >>> 0);
  trail.fill(0);
  if (influence) influence.fill(0); // also clear painted influence on a fresh reset
  rebuildAgents();
}

/* ------------------------------------------------------------------ *
 * Simulation step: sense -> steer -> move -> deposit, for every agent.
 * Toroidal wrapping at all edges. No allocations.
 * ------------------------------------------------------------------ */
function step() {
  const w = W, h = H, t = trail;
  const x = ax, y = ay, head = ah;
  const n = P.agentCount;
  const sd = P.sensorDistance;
  const ms = P.moveSpeed;
  const ts = P.turnSpeed;
  const dep = P.depositAmount;
  const rng = simRng;
  const inf = influence;   // signed paint field: + attract, - repel
  const iw = INFLUENCE_WEIGHT;

  // Angle-addition lets us derive the ±sensorAngle directions from a single
  // cos/sin of the heading (2 trig per agent instead of 6).
  const cosA = Math.cos(P.sensorAngle);
  const sinA = Math.sin(P.sensorAngle);

  for (let i = 0; i < n; i++) {
    const px = x[i], py = y[i], ph = head[i];
    const ch = Math.cos(ph), sh = Math.sin(ph);

    // direction vectors for left (ph - a) and right (ph + a)
    const lc = ch * cosA + sh * sinA, ls = sh * cosA - ch * sinA;
    const rc = ch * cosA - sh * sinA, rs = sh * cosA + ch * sinA;

    // --- SENSE (nearest-cell sample with single-step wrap) ---
    // sensed = trail + INFLUENCE_WEIGHT * influence.
    // Positive influence (attract) raises the sensed value so agents steer
    // toward it; negative influence (repel) drives it below the surrounding
    // trail, creating a downhill gradient OUT of the zone — the sensor pointing
    // deeper into repel reads most-negative, so agents turn toward the
    // less-repelled side and smoothly leave. We deliberately do NOT clamp to 0:
    // flooring at 0 would flatten that interior gradient and cause the random-
    // turn twitching seen before. The influence field is bounded to
    // ±INFLUENCE_MAX, so sensed stays finite (no NaN); turns remain capped by
    // turnSpeed below, so motion stays smooth.
    let fx = px + ch * sd, fy = py + sh * sd;
    if (fx < 0) fx += w; else if (fx >= w) fx -= w;
    if (fy < 0) fy += h; else if (fy >= h) fy -= h;
    let fi = (fy | 0) * w + (fx | 0);
    const f = t[fi] + iw * inf[fi];

    let lx = px + lc * sd, lyy = py + ls * sd;
    if (lx < 0) lx += w; else if (lx >= w) lx -= w;
    if (lyy < 0) lyy += h; else if (lyy >= h) lyy -= h;
    let li = (lyy | 0) * w + (lx | 0);
    const lv = t[li] + iw * inf[li];

    let rx = px + rc * sd, ry = py + rs * sd;
    if (rx < 0) rx += w; else if (rx >= w) rx -= w;
    if (ry < 0) ry += h; else if (ry >= h) ry -= h;
    let ri = (ry | 0) * w + (rx | 0);
    const rv = t[ri] + iw * inf[ri];

    // --- STEER ---
    let nh = ph, dcos = ch, dsin = sh;
    if (f > lv && f > rv) {
      // center strongest -> keep heading (reuse ch/sh)
    } else {
      if (f < lv && f < rv) {
        nh = ph + (rng() - 0.5) * 2 * ts; // ambiguous -> small random turn
      } else if (lv > rv) {
        nh = ph - ts;                     // left stronger -> rotate left
      } else {
        nh = ph + ts;                     // right stronger -> rotate right
      }
      dcos = Math.cos(nh);
      dsin = Math.sin(nh);
    }

    // --- MOVE (toroidal) ---
    let nx = px + dcos * ms;
    let ny = py + dsin * ms;
    if (nx < 0) nx += w; else if (nx >= w) nx -= w;
    if (ny < 0) ny += h; else if (ny >= h) ny -= h;
    x[i] = nx; y[i] = ny; head[i] = nh;

    // --- DEPOSIT ---
    t[(ny | 0) * w + (nx | 0)] += dep;
  }
}

/* ------------------------------------------------------------------ *
 * Diffuse (separable 3x3 box blur, toroidal) + decay in one pass.
 * Horizontal pass -> blur buffer; vertical pass -> trail, * decayFactor.
 * Both inner loops are row-major for cache friendliness.
 * ------------------------------------------------------------------ */
// Influence fades slowly so paint persists a few seconds. At ~3 diffuse calls
// per rendered frame (steps/frame=3 -> diffuse once/frame, 60fps): 0.992^60 ≈
// 0.62/sec, so a stroke stays clearly influential for ~3-4s then fades out.
const INFLUENCE_DECAY = 0.992;
function diffuse() {
  const w = W, h = H, t = trail, b = blur, inf = influence;
  const o3 = 1 / 3;
  const decay = P.decayFactor;

  // Horizontal: average of left/center/right -> b
  for (let yy = 0; yy < h; yy++) {
    const row = yy * w;
    b[row] = (t[row + w - 1] + t[row] + t[row + 1]) * o3;
    for (let xx = 1; xx < w - 1; xx++) {
      const i = row + xx;
      b[i] = (t[i - 1] + t[i] + t[i + 1]) * o3;
    }
    const e = row + w - 1;
    b[e] = (t[e - 1] + t[e] + t[row]) * o3;
  }

  // Vertical: average of up/center/down rows -> t, then decay
  const last = (h - 1) * w;
  for (let yy = 0; yy < h; yy++) {
    const row = yy * w;
    const up = (yy === 0 ? last : row - w);
    const dn = (yy === h - 1 ? 0 : row + w);
    for (let xx = 0; xx < w; xx++) {
      const i = row + xx;
      t[i] = (b[up + xx] + b[row + xx] + b[dn + xx]) * o3 * decay;
      inf[i] *= INFLUENCE_DECAY; // fade the paint field so it's not permanent
    }
  }
}

/* ------------------------------------------------------------------ *
 * Render: tone-map trail -> palette -> ImageData -> view canvas.
 * Reinhard mapping (v/(v+K)) keeps output bounded regardless of trail
 * magnitude; sqrt adds glow in the low end.
 * ------------------------------------------------------------------ */
const TONE_K = 2.5;
function render() {
  const t = trail, px = pixels, size = W * H;
  for (let i = 0; i < size; i++) {
    const v = t[i];
    const n = v / (v + TONE_K);            // 0..1
    const ci = (Math.sqrt(n) * 255) | 0;   // glow curve
    const p = i << 2;
    px[p] = palR[ci];
    px[p + 1] = palG[ci];
    px[p + 2] = palB[ci];
  }
  simCtx.putImageData(imageData, 0, 0);

  // Scale onto the display canvas (letterboxed, smooth).
  dctx.fillStyle = "#000";
  dctx.fillRect(0, 0, view.width, view.height);
  dctx.imageSmoothingEnabled = true;
  const dw = W * dispScale, dh = H * dispScale;
  dctx.drawImage(simCanvas, 0, 0, W, H, dispOX, dispOY, dw, dh);

  // --- Bloom post-process (subtle additive glow) ---
  // Cheap: shrink to quarter-res while a canvas `filter` thresholds (brightness
  // + contrast crush the darks to black so only bright veins survive) and blurs
  // them. Then composite that soft, bright-only copy back additively so light
  // bleeds into nearby dark space. No per-frame allocation.
  if (P.bloomOn && P.bloomIntensity > 0) {
    bloomCtx.setTransform(1, 0, 0, 1, 0, 0);
    bloomCtx.globalCompositeOperation = "source-over";
    bloomCtx.clearRect(0, 0, bloomW, bloomH);
    bloomCtx.imageSmoothingEnabled = true;
    // blur scales with downsample factor; brightness/contrast = the threshold
    bloomCtx.filter = "blur(2px) brightness(1.25) contrast(1.7)";
    bloomCtx.drawImage(simCanvas, 0, 0, W, H, 0, 0, bloomW, bloomH);
    bloomCtx.filter = "none";

    dctx.globalCompositeOperation = "lighter";
    dctx.globalAlpha = P.bloomIntensity;
    dctx.drawImage(bloomCanvas, 0, 0, bloomW, bloomH, dispOX, dispOY, dw, dh);
    dctx.globalAlpha = 1;
    dctx.globalCompositeOperation = "source-over";
  }
}

/* ------------------------------------------------------------------ *
 * Main loop
 * ------------------------------------------------------------------ */
let lastT = 0, fpsSmooth = 0;
const fpsEl = document.getElementById("fps");

function frame(now) {
  if (running) {
    // Run several cheap sim substeps per rendered frame so the network develops
    // quickly and motion looks lively, while we still render only once at 60fps.
    const steps = P.stepsPerFrame;
    for (let s = 0; s < steps; s++) step();
    diffuse();
  }
  render();

  // FPS (rendered even while paused so resize stays correct)
  if (lastT) {
    const dt = now - lastT;
    fpsSmooth = fpsSmooth ? fpsSmooth * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
    fpsEl.textContent = fpsSmooth.toFixed(0);
  }
  lastT = now;
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ *
 * Display sizing
 * ------------------------------------------------------------------ */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const cw = window.innerWidth, chh = window.innerHeight;
  view.width = Math.round(cw * dpr);
  view.height = Math.round(chh * dpr);
  view.style.width = cw + "px";
  view.style.height = chh + "px";

  dispScale = Math.min(view.width / W, view.height / H);
  dispOX = (view.width - W * dispScale) / 2;
  dispOY = (view.height - H * dispScale) / 2;
}
window.addEventListener("resize", resize);

/* ------------------------------------------------------------------ *
 * Mouse painting — attract (food into trail) / repel (into repel field).
 *
 * Coordinate mapping (the critical part):
 *   The view canvas backing store is `view.width x view.height` = CSS px * dpr.
 *   The sim is drawn letterboxed at offset (dispOX, dispOY) and uniform scale
 *   dispScale, all measured in that device-pixel space. A pointer event gives
 *   CSS pixels relative to the element. So:
 *     deviceX = (clientX - rect.left) * (view.width  / rect.width)
 *     deviceY = (clientY - rect.top ) * (view.height / rect.height)
 *     simX    = (deviceX - dispOX) / dispScale
 *     simY    = (deviceY - dispOY) / dispScale
 *   (view.width/rect.width equals dpr, but using the measured ratio is robust
 *   to the Math.round in resize().) The brush lands exactly under the cursor.
 * ------------------------------------------------------------------ */
// Paint magnitudes. The Coral trail peaks ~3000 and agents sense values in the
// ~25-200 range, so the influence field must be the same order of magnitude to
// register. We paint into a SIGNED influence field that the sense step adds in
// at INFLUENCE_WEIGHT. Net sensed contribution at a saturated brush:
//   attract  +1.0 * 250 = +250 (dominates a normal ~85 sensed value -> agents stream in)
//   repel    +1.0 * -250 = -250 (cancels the trail -> area reads 0, agents bend away)
const INFLUENCE_WEIGHT = 1.0;
const ATTRACT_STRENGTH = 250;  // peak positive influence under the brush center
const REPEL_STRENGTH = 250;    // peak negative influence (applied as -value)
const INFLUENCE_MAX = 600;     // clamp so repeated strokes can't blow up the field

// IMMEDIATE on-canvas feedback, layered on top of the influence steering above.
// Trail peaks ~3000 and tone-maps brightly above ~150, so these make the stroke
// light up / carve out instantly under the cursor while the influence field
// does the slower gathering.
const ATTRACT_TRAIL_DEPOSIT = 180; // peak trail added per frame while dragging attract
const REPEL_TRAIL_CLEAR = 0.95;    // peak fraction of trail removed per frame under repel
let painting = false, lastSX = 0, lastSY = 0;

function eventToSim(e) {
  const rect = view.getBoundingClientRect();
  const devX = (e.clientX - rect.left) * (view.width / rect.width);
  const devY = (e.clientY - rect.top) * (view.height / rect.height);
  return {
    x: (devX - dispOX) / dispScale,
    y: (devY - dispOY) / dispScale,
  };
}

// Soft circular brush stamp into the signed influence field (clamped, no wrap).
// Attract paints positive, repel paints negative; magnitude is clamped so
// holding the brush can't run the field away to absurd values.
function stamp(sx, sy) {
  if (P.brushMode === "off") return;
  const attract = P.brushMode === "attract";
  const amt = attract ? ATTRACT_STRENGTH : -REPEL_STRENGTH;
  const inf = influence;
  const t = trail;
  const r = P.brushSize;
  const r2 = r * r;
  const cx = sx | 0, cy = sy | 0;
  const x0 = Math.max(0, cx - r), x1 = Math.min(W - 1, cx + r);
  const y0 = Math.max(0, cy - r), y1 = Math.min(H - 1, cy + r);
  for (let yy = y0; yy <= y1; yy++) {
    const dy = yy - sy;
    const row = yy * W;
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx - sx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const fall = 1 - d2 / r2; // smooth radial falloff (1 at center -> 0 at edge)

      // (1) influence field — the existing, tuned steering (unchanged).
      const i = row + xx;
      let v = inf[i] + amt * fall;
      if (v > INFLUENCE_MAX) v = INFLUENCE_MAX;
      else if (v < -INFLUENCE_MAX) v = -INFLUENCE_MAX;
      inf[i] = v;

      // (2) immediate trail-map feedback so the stroke is visible THIS frame.
      if (attract) {
        t[i] += ATTRACT_TRAIL_DEPOSIT * fall;            // light up bright
      } else {
        t[i] *= 1 - REPEL_TRAIL_CLEAR * fall;            // carve a dark channel
      }
    }
  }
}

// Stamp along the segment from (lastSX,lastSY) to (sx,sy) so fast drags don't gap.
function stampStroke(sx, sy) {
  const dx = sx - lastSX, dy = sy - lastSY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const stepPx = Math.max(1, P.brushSize * 0.4);
  const steps = Math.max(1, Math.ceil(dist / stepPx));
  for (let s = 1; s <= steps; s++) {
    const tt = s / steps;
    stamp(lastSX + dx * tt, lastSY + dy * tt);
  }
  lastSX = sx; lastSY = sy;
}

function onPointerDown(e) {
  if (P.brushMode === "off" || e.button !== 0) return;
  painting = true;
  const p = eventToSim(e);
  lastSX = p.x; lastSY = p.y;
  stamp(p.x, p.y);       // single dab on click (works while paused too)
  view.setPointerCapture && view.setPointerCapture(e.pointerId);
  e.preventDefault();
}
function onPointerMove(e) {
  if (!painting) return;
  const p = eventToSim(e);
  stampStroke(p.x, p.y);
  e.preventDefault();
}
function onPointerUp() { painting = false; }

view.addEventListener("pointerdown", onPointerDown);
view.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);

/* ------------------------------------------------------------------ *
 * UI wiring
 * ------------------------------------------------------------------ */
// Numeric sliders: key -> how to format the displayed value.
const SLIDERS = {
  agentCount: (v) => v.toLocaleString(),
  stepsPerFrame: (v) => String(v),
  moveSpeed: (v) => v.toFixed(2),
  turnSpeed: (v) => v.toFixed(2),
  sensorDistance: (v) => v.toFixed(1),
  sensorAngle: (v) => v.toFixed(2),
  decayFactor: (v) => v.toFixed(3),
  depositAmount: (v) => v.toFixed(1),
};

function syncUIFromParams() {
  for (const key in SLIDERS) {
    const el = document.getElementById(key);
    el.value = P[key];
    document.getElementById(key + "-val").textContent = SLIDERS[key](P[key]);
  }
  document.getElementById("palette").value = P.palette;
  document.getElementById("startPattern").value = P.startPattern;
  document.getElementById("bloomOn").checked = P.bloomOn;
  document.getElementById("bloomIntensity").value = P.bloomIntensity;
  document.getElementById("bloomIntensity-val").textContent = P.bloomIntensity.toFixed(2);
  document.getElementById("brushMode").value = P.brushMode;
  document.getElementById("brushSize").value = P.brushSize;
  document.getElementById("brushSize-val").textContent = String(P.brushSize);
  document.getElementById("seed").value = currentSeed;
  // highlight matching preset, if any
  document.querySelectorAll(".preset").forEach((b) => {
    b.classList.toggle("active", isPreset(b.dataset.preset));
  });
}

function isPreset(name) {
  const p = PRESETS[name];
  for (const k in p) if (P[k] !== p[k]) return false;
  return true;
}

function wireSliders() {
  for (const key in SLIDERS) {
    const el = document.getElementById(key);
    el.addEventListener("input", () => {
      const v = key === "agentCount" ? parseInt(el.value, 10) : parseFloat(el.value);
      P[key] = v;
      document.getElementById(key + "-val").textContent = SLIDERS[key](v);
      // Agent count rebuilds the agent arrays; everything else is live.
      if (key === "agentCount") resetSim();
      // a manual tweak may break preset-match highlight
      document.querySelectorAll(".preset").forEach((b) =>
        b.classList.toggle("active", isPreset(b.dataset.preset))
      );
    });
  }

  document.getElementById("palette").addEventListener("change", (e) => {
    P.palette = e.target.value;
    buildPalette();
    syncUIFromParams();
  });
  document.getElementById("startPattern").addEventListener("change", (e) => {
    P.startPattern = e.target.value;
    resetSim();
    syncUIFromParams();
  });
  document.getElementById("resolution").addEventListener("change", (e) => {
    const [w, h] = e.target.value.split("x").map(Number);
    allocSim(w, h);
    resetSim();
    resize();
  });

  // Bloom controls — live, no agent rebuild.
  document.getElementById("bloomOn").addEventListener("change", (e) => {
    P.bloomOn = e.target.checked;
  });
  document.getElementById("bloomIntensity").addEventListener("input", (e) => {
    P.bloomIntensity = parseFloat(e.target.value);
    document.getElementById("bloomIntensity-val").textContent = P.bloomIntensity.toFixed(2);
  });

  // Paint controls — live.
  const brushModeEl = document.getElementById("brushMode");
  brushModeEl.addEventListener("change", (e) => {
    P.brushMode = e.target.value;
    view.style.cursor = P.brushMode === "off" ? "default" : "crosshair";
  });
  document.getElementById("brushSize").addEventListener("input", (e) => {
    P.brushSize = parseInt(e.target.value, 10);
    document.getElementById("brushSize-val").textContent = String(P.brushSize);
  });
  // Clear paint wipes ONLY the influence field (no-op on the trail).
  document.getElementById("clearPaint").addEventListener("click", () => {
    influence.fill(0);
  });
}

function applyPreset(name) {
  Object.assign(P, PRESETS[name]);
  buildPalette();
  syncUIFromParams();
  resetSim();
}

// Derive a complete randomized look from a seed (deterministic).
function randomizeFromSeed(seed) {
  currentSeed = seed >>> 0;
  const rng = mulberry32(currentSeed);
  P.moveSpeed = lerp(0.5, 1.6, rng());
  P.turnSpeed = lerp(0.1, 1.0, rng());
  P.sensorDistance = lerp(4, 28, rng());
  P.sensorAngle = lerp(0.15, 1.0, rng());
  P.decayFactor = lerp(0.86, 0.97, rng());
  P.depositAmount = lerp(2.5, 7, rng());
  const pals = Object.keys(PALETTES);
  P.palette = pals[(rng() * pals.length) | 0];
  buildPalette();
  syncUIFromParams();
  resetSim();
}

function wireButtons() {
  document.querySelectorAll(".preset").forEach((b) => {
    b.addEventListener("click", () => applyPreset(b.dataset.preset));
  });

  const pp = document.getElementById("playPause");
  pp.addEventListener("click", () => {
    running = !running;
    pp.textContent = running ? "Pause" : "Play";
  });

  document.getElementById("reset").addEventListener("click", resetSim);

  document.getElementById("randomize").addEventListener("click", () => {
    // draw a fresh seed from the running PRNG so each click differs, yet the
    // resulting seed fully reproduces this look when typed back in.
    const newSeed = (simRng() * 4294967296) >>> 0;
    randomizeFromSeed(newSeed);
  });

  document.getElementById("save").addEventListener("click", saveImage);

  document.getElementById("applySeed").addEventListener("click", () => {
    const raw = document.getElementById("seed").value.trim();
    const n = parseInt(raw, 10);
    if (!isNaN(n)) randomizeFromSeed(n);
  });

  document.getElementById("share").addEventListener("click", shareLink);

  document.getElementById("collapse").addEventListener("click", () => {
    document.getElementById("panel").classList.toggle("collapsed");
  });
}

// Save exactly what's on screen as a PNG.
function saveImage() {
  view.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "physarum-" + currentSeed + ".png";
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

/* ------------------------------------------------------------------ *
 * Shareable URL: encodes seed + all parameters in the hash.
 * ------------------------------------------------------------------ */
function shareLink() {
  const q = new URLSearchParams();
  q.set("seed", currentSeed);
  for (const key in SLIDERS) q.set(key, P[key]);
  q.set("palette", P.palette);
  q.set("startPattern", P.startPattern);
  q.set("res", W + "x" + H);
  const url = location.origin + location.pathname + "#" + q.toString();
  const btn = document.getElementById("share");
  const done = () => { btn.textContent = "Copied!"; setTimeout(() => (btn.textContent = "Copy share link"), 1200); };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt("Copy link:", url));
  else prompt("Copy link:", url);
  history.replaceState(null, "", "#" + q.toString());
}

function applyFromURL() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) return false;
  const q = new URLSearchParams(hash);
  if (![...q.keys()].length) return false;

  if (q.has("res")) {
    const [w, h] = q.get("res").split("x").map(Number);
    if (w && h) allocSim(w, h);
  }
  for (const key in SLIDERS) {
    if (q.has(key)) {
      const v = key === "agentCount" ? parseInt(q.get(key), 10) : parseFloat(q.get(key));
      if (!isNaN(v)) P[key] = v;
    }
  }
  if (q.has("palette") && PALETTES[q.get("palette")]) P.palette = q.get("palette");
  if (q.has("startPattern")) P.startPattern = q.get("startPattern");
  if (q.has("seed")) {
    const s = parseInt(q.get("seed"), 10);
    if (!isNaN(s)) currentSeed = s >>> 0;
  }
  buildPalette();
  syncUIFromParams();
  resetSim();
  return true;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
function init() {
  allocSim(W, H);
  buildPalette();
  wireSliders();
  wireButtons();

  // If a share link is present, use it; otherwise the gorgeous default.
  // If a share link is present, it wins. Otherwise boot into the gorgeous
  // default: the Coral parameter set, but recolored to Ember and seeded with a
  // random scatter (not Coral's own Ultraviolet/disk) — a confirmed
  // good-looking orange/red branching network on first open.
  if (!applyFromURL()) {
    currentSeed = DEFAULT_SEED;          // locked seed -> reliably great on load
    Object.assign(P, PRESETS.Coral);     // full Coral parameter set
    P.palette = "Ember";                 // override Coral's Ultraviolet
    P.startPattern = "scatter";          // override Coral's disk (no donut)
    buildPalette();
    syncUIFromParams();                  // reflect loaded state in the panel
    resetSim();                          // reseed agents from DEFAULT_SEED
  }
  syncUIFromParams();
  resize();
  requestAnimationFrame(frame);
}

init();
