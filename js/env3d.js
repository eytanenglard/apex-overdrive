/* APEX OVERDRIVE 3D - js/env3d.js - MODULE 3 "env": realistic world around the road (procedural, three.js r128).
   Generated from dev/env-src/*.js by dev/build-env.py. API: window.env3DFactory.build(scene, track, renderer) -> { update(dt, focus), dispose(), warmup(camera), group } */
(function () {
"use strict";

// ============================================================================
// [p01_core]
// ============================================================================
// APEX OVERDRIVE 3D - env3d.js  (MODULE 3: realistic world around the road)
// Procedural only: no downloads. Plain script, three.js r128 global build.
//   const env = window.env3DFactory.build(scene, track, renderer)
//   env.update(dt, focusWorldPos); env.dispose(); env.group
// ============================================================================

const E3 = {
  CL: 400,              // chunk length along z
  ROW: 10,              // terrain grid row step (z)
  ROAD_STEP: 5,         // road ribbon row step (z)
  ZMIN: -400,           // world extent behind the start
  ZEXTRA: 1500,         // world extent past the finish
  cache: { tex: {}, env: {}, geo: {} },
  PI2: Math.PI * 2,
  deadline: Infinity    // time-slicing: generators yield when performance.now() passes this
};

const e3clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// colour management: all palettes below are authored as sRGB display colours; the renderer (ACES + sRGB output) wants linear
const e3lin = v => (v <= 0 ? 0 : Math.pow(v, 2.2));
const e3lin3 = c => [e3lin(c[0]), e3lin(c[1]), e3lin(c[2])];
function e3Color(c) { return new THREE.Color(e3lin(c[0]), e3lin(c[1]), e3lin(c[2])); }
const e3lerp = (a, b, t) => a + (b - a) * t;
const e3smooth = (a, b, x) => { const t = e3clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const e3mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function e3hexRGB(h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }
function e3strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function e3rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const e3tick = () => performance.now() > E3.deadline;   // used inside generators: `if (e3tick()) yield;`

// ---- gradient noise (2D) ---------------------------------------------------
const E3_GX = new Float64Array([1, -1, 1, -1, 1.4, -1.4, 0, 0]);
const E3_GY = new Float64Array([1, 1, -1, -1, 0, 0, 1.4, -1.4]);
class E3Noise {
  constructor(seed) {
    const r = e3rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }
  // returns roughly [-1, 1]
  n(x, y) {
    const P = this.p;
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const pa = P[X], pb = P[X + 1];
    const ga = P[pa + Y] & 7, gb = P[pb + Y] & 7, gc = P[pa + Y + 1] & 7, gd = P[pb + Y + 1] & 7;
    const xf1 = xf - 1, yf1 = yf - 1;
    const a = E3_GX[ga] * xf + E3_GY[ga] * yf, b = E3_GX[gb] * xf1 + E3_GY[gb] * yf;
    const c = E3_GX[gc] * xf + E3_GY[gc] * yf1, d = E3_GX[gd] * xf1 + E3_GY[gd] * yf1;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const x1 = a + u * (b - a), x2 = c + u * (d - c);
    return (x1 + v * (x2 - x1)) * 0.78;
  }
  fbm(x, y, oct, lac, gain) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * this.n(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  ridged(x, y, oct, lac, gain) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(this.n(x * f, y * f)); s += a * v * v; n += a; a *= gain; f *= lac; }
    return s / n; // 0..1
  }
}

// ---- merged static geometry builder (typed arrays, grows on demand) ---------
const E3_TMP = { m: new THREE.Matrix4(), nm: new THREE.Matrix3(), q: new THREE.Quaternion(), e: new THREE.Euler(), s: new THREE.Vector3(), p: new THREE.Vector3() };
class E3Geo {
  constructor(lin) {
    this.cap = 2048; this.icap = 4096;
    this.pos = new Float32Array(this.cap * 3); this.nor = new Float32Array(this.cap * 3); this.uv = new Float32Array(this.cap * 2); this.col = new Float32Array(this.cap * 3);
    this.idx = new Uint32Array(this.icap);
    this.n = 0; this.ni = 0; this.lin = lin !== false;
  }
  _c(col) { const c = col || [1, 1, 1]; return this.lin ? [e3lin(c[0]), e3lin(c[1]), e3lin(c[2])] : c; }
  _ensure(nv, ni) {
    if (this.n + nv > this.cap) {
      let c = this.cap; while (c < this.n + nv) c *= 2;
      const grow = (a, k) => { const b = new Float32Array(c * k); b.set(a); return b; };
      this.pos = grow(this.pos, 3); this.nor = grow(this.nor, 3); this.uv = grow(this.uv, 2); this.col = grow(this.col, 3); this.cap = c;
    }
    if (this.ni + ni > this.icap) {
      let c = this.icap; while (c < this.ni + ni) c *= 2;
      const b = new Uint32Array(c); b.set(this.idx); this.idx = b; this.icap = c;
    }
  }
  // append a THREE geometry transformed by matrix m; col = [r,g,b] (multiplies vertex colours when present) ; uvT=[su,sv,ou,ov]
  add(geo, m, col, uvT) {
    const p = geo.attributes.position, nn = geo.attributes.normal, uv = geo.attributes.uv, cc = geo.attributes.color, ix = geo.index;
    const cnt = p.count, ni = ix ? ix.count : cnt;
    this._ensure(cnt, ni);
    E3_TMP.nm.getNormalMatrix(m);
    const e = m.elements, ne = E3_TMP.nm.elements;
    const c = this._c(col), base = this.n;
    const pa = p.array, na = nn ? nn.array : null, ua = uv ? uv.array : null, ca = cc ? cc.array : null;
    const P = this.pos, N = this.nor, U = this.uv, C = this.col;
    for (let i = 0; i < cnt; i++) {
      const x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2], o = (base + i) * 3;
      P[o] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (na) {
        const nx = na[i * 3], ny = na[i * 3 + 1], nz = na[i * 3 + 2];
        let tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
        const l = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        N[o] = tx / l; N[o + 1] = ty / l; N[o + 2] = tz / l;
      } else { N[o] = 0; N[o + 1] = 1; N[o + 2] = 0; }
      const uo = (base + i) * 2;
      if (ua) { let u = ua[i * 2], v = ua[i * 2 + 1]; if (uvT) { u = u * uvT[0] + uvT[2]; v = v * uvT[1] + uvT[3]; } U[uo] = u; U[uo + 1] = v; } else { U[uo] = 0; U[uo + 1] = 0; }
      if (ca) { C[o] = c[0] * ca[i * 3]; C[o + 1] = c[1] * ca[i * 3 + 1]; C[o + 2] = c[2] * ca[i * 3 + 2]; } else { C[o] = c[0]; C[o + 1] = c[1]; C[o + 2] = c[2]; }
    }
    const I = this.idx; let k = this.ni;
    if (ix) { const ia = ix.array; for (let i = 0; i < ni; i++) I[k++] = ia[i] + base; }
    else for (let i = 0; i < cnt; i++) I[k++] = i + base;
    this.ni = k; this.n += cnt;
  }
  // transform helper: position, euler(x,y,z), scale
  addT(geo, x, y, z, rx, ry, rz, sx, sy, sz, col, uvT) {
    const T = E3_TMP;
    T.e.set(rx || 0, ry || 0, rz || 0, 'YXZ');
    T.q.setFromEuler(T.e);
    T.p.set(x, y, z);
    T.s.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    T.m.compose(T.p, T.q, T.s);
    this.add(geo, T.m, col, uvT);
  }
  // free quad from 4 points (CCW seen from the front); uv rect [u0,v0,u1,v1]
  // nh = optional normal hint [x,y,z]: winding is flipped when the computed normal disagrees with it
  quad(a, b, c, d, col, uvr, nh) {
    const cl = this._c(col);
    this.quadV(a, b, c, d, cl, cl, cl, cl, uvr, nh, true);
  }
  // quad with per-vertex colours (c0..c3 for a,b,c,d)
  quadV(a, b, c, d, c0, c1, c2, c3, uvr, nh, raw) {
    this._ensure(4, 6);
    const base = this.n;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    let flip = false;
    if (nh && nx * nh[0] + ny * nh[1] + nz * nh[2] < 0) { flip = true; nx = -nx; ny = -ny; nz = -nz; }
    const r = uvr || [0, 0, 1, 1];
    const P = this.pos, N = this.nor, U = this.uv, C = this.col;
    for (let i = 0; i < 4; i++) {
      const p = i === 0 ? a : i === 1 ? b : i === 2 ? c : d, cc = raw ? (i === 0 ? c0 : i === 1 ? c1 : i === 2 ? c2 : c3) : this._c(i === 0 ? c0 : i === 1 ? c1 : i === 2 ? c2 : c3);
      const o = (base + i) * 3, uo = (base + i) * 2;
      P[o] = p[0]; P[o + 1] = p[1]; P[o + 2] = p[2]; N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
      U[uo] = (i === 0 || i === 3) ? r[0] : r[2]; U[uo + 1] = i < 2 ? r[1] : r[3];
      C[o] = cc[0]; C[o + 1] = cc[1]; C[o + 2] = cc[2];
    }
    const I = this.idx, k = this.ni;
    if (flip) { I[k] = base; I[k + 1] = base + 2; I[k + 2] = base + 1; I[k + 3] = base; I[k + 4] = base + 3; I[k + 5] = base + 2; }
    else { I[k] = base; I[k + 1] = base + 1; I[k + 2] = base + 2; I[k + 3] = base; I[k + 4] = base + 2; I[k + 5] = base + 3; }
    this.ni += 6; this.n += 4;
  }
  get empty() { return this.n === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.n * 3), 3));
    const ia = this.idx.slice(0, this.ni);
    g.setIndex(new THREE.BufferAttribute(this.n > 65535 ? ia : new Uint16Array(ia), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ---- tiny disposal registry (everything built per scene goes through here) -
class E3Own {
  constructor() { this.geos = []; this.mats = []; this.texs = []; this.objs = []; }
  geo(g) { this.geos.push(g); return g; }
  mat(m) { this.mats.push(m); return m; }
  tex(t) { this.texs.push(t); return t; }
  dispose() {
    this.geos.forEach(g => g.dispose());
    this.mats.forEach(m => m.dispose());
    this.texs.forEach(t => t.dispose());
    this.geos.length = this.mats.length = this.texs.length = 0;
  }
}

// ---- canvas helper ----------------------------------------------------------
function e3canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function e3canvasTex(c, opts) {
  const t = new THREE.CanvasTexture(c);
  opts = opts || {};
  t.wrapS = opts.clampS ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapT = opts.clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = opts.aniso || 8;
  if (opts.srgb) t.encoding = THREE.sRGBEncoding;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}
function e3maxAniso(renderer) { try { return Math.min(16, renderer.capabilities.getMaxAnisotropy()); } catch (e) { return 8; } }

// shared unit primitives for E3Geo (cached once, never disposed: tiny)
function e3prim() {
  const C = E3.cache.geo;
  if (!C.box) {
    C.box = new THREE.BoxGeometry(1, 1, 1);
    C.cyl8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1);
    C.cyl12 = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1);
    C.cyl16 = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1);
    C.plane = new THREE.PlaneGeometry(1, 1);
    C.sph = new THREE.SphereGeometry(0.5, 10, 8);
  }
  return C;
}

// ============================================================================
// [p02_textures]
// ============================================================================
// p02: procedural textures (cached in E3.cache.tex, generated once)
// ============================================================================

function e3periodicLattice(n, rnd) { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; }
function e3pn(lat, n, x, y) {
  const fx = x * n, fy = y * n;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const xa = x0 % n, xb = (x0 + 1) % n, ya = y0 % n, yb = (y0 + 1) % n;
  const a = lat[ya * n + xa], b = lat[ya * n + xb], c = lat[yb * n + xa], d = lat[yb * n + xb];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Tileable RGBA noise (R fine grain, G blotches, B crack lines, A pebbles)  -> DataTexture, used by terrain, sky, water, lava
function e3NoiseTex(renderer) {
  const C = E3.cache.tex;
  if (C.noise) return C.noise;
  const N = 512;
  const rnd = e3rng(90210);
  const sizes = [4, 8, 12, 16, 24, 32, 64, 96, 128, 256];
  const L = {}; sizes.forEach(s => { L[s] = e3periodicLattice(s, rnd); });
  const d = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i / N, y = j / N;
      let R = 0.42 * e3pn(L[64], 64, x, y) + 0.30 * e3pn(L[128], 128, x, y) + 0.28 * e3pn(L[256], 256, x, y);
      let G = 0.34 * e3pn(L[4], 4, x, y) + 0.30 * e3pn(L[8], 8, x, y) + 0.20 * e3pn(L[16], 16, x, y) + 0.16 * e3pn(L[32], 32, x, y);
      const r1 = 1 - Math.abs(2 * e3pn(L[12], 12, x, y) - 1), r2 = 1 - Math.abs(2 * e3pn(L[24], 24, x + 0.31, y + 0.17) - 1);
      let B = Math.max(e3smooth(0.9, 0.995, r1), 0.8 * e3smooth(0.92, 0.998, r2));
      let A = e3smooth(0.6, 0.82, e3pn(L[96], 96, x, y)) * 0.8 + e3smooth(0.62, 0.84, e3pn(L[128], 128, x + 0.5, y + 0.5)) * 0.5;
      R = e3clamp((R - 0.5) * 1.55 + 0.5, 0, 1); G = e3clamp((G - 0.5) * 1.7 + 0.5, 0, 1);
      const o = (j * N + i) * 4;
      d[o] = R * 255; d[o + 1] = G * 255; d[o + 2] = B * 255; d[o + 3] = e3clamp(A, 0, 1) * 255;
    }
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = renderer ? e3maxAniso(renderer) : 8;
  t.needsUpdate = true;
  C.noise = t;
  return t;
}

function e3softDot() {
  const C = E3.cache.tex;
  if (C.dot) return C.dot;
  const c = e3canvas(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return (C.dot = t);
}
// vertical soft streak (wet-road lamp reflection), bright at v=1 (top of quad = the lamp end), fades toward v=0
function e3streakTex() {
  const C = E3.cache.tex;
  if (C.streak) return C.streak;
  const c = e3canvas(32, 256), g = c.getContext('2d');
  const gv = g.createLinearGradient(0, 0, 0, 256);
  gv.addColorStop(0, 'rgba(255,255,255,1)'); gv.addColorStop(0.08, 'rgba(255,255,255,0.7)'); gv.addColorStop(0.4, 'rgba(255,255,255,0.22)'); gv.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gv; g.fillRect(0, 0, 32, 256);
  g.globalCompositeOperation = 'destination-in';
  const gh = g.createLinearGradient(0, 0, 32, 0);
  gh.addColorStop(0, 'rgba(255,255,255,0)'); gh.addColorStop(0.5, 'rgba(255,255,255,1)'); gh.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gh; g.fillRect(0, 0, 32, 256);
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return (C.streak = t);
}
// elliptical light pool on the road (additive)
function e3poolTex() {
  const C = E3.cache.tex;
  if (C.pool) return C.pool;
  const c = e3canvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.42)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return (C.pool = t);
}

// ---------------------------------------------------------------------------
// Road: asphalt + realistic markings. 22 m wide (1 u), tile = 44 m along z
// kind: alpine | city | canyon | snow
// returns { map, rough, bump }
// ---------------------------------------------------------------------------
function e3RoadTextures(kind, hi, renderer) {
  const key = 'road_' + kind + (hi ? '_h' : '_l');
  const C = E3.cache.tex;
  if (C[key]) return C[key];
  const W = hi ? 1024 : 512, H = hi ? 2048 : 1024;
  const PX = W / 22;                       // px per metre
  const rnd = e3rng(777 + e3strHash(kind));
  const R = (a, b) => a + (b - a) * rnd();
  const PAL = {
    alpine: { base: '#3b3c40', paint: '#ecebe4', edge: '#ecebe4', grain: 1.0 },
    city: { base: '#2a2c31', paint: '#e6e8e8', edge: '#e6e8e8', grain: 0.9 },
    canyon: { base: '#443d39', paint: '#ebe7dc', edge: '#e9b923', grain: 1.1 },
    snow: { base: '#3c4046', paint: '#f2f4f4', edge: '#f2f4f4', grain: 0.9 }
  }[kind];

  // aggregate grain tile (256)
  const gt = e3canvas(256, 256), gg = gt.getContext('2d');
  const img = gg.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 128 + (rnd() + rnd() + rnd() - 1.5) * 34 * PAL.grain;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = e3clamp(v, 0, 255); img.data[i * 4 + 3] = 255;
  }
  gg.putImageData(img, 0, 0);
  for (let i = 0; i < 700; i++) { const r = R(0.8, 2.4); gg.fillStyle = 'rgba(' + (rnd() < 0.5 ? '200,200,200' : '45,45,45') + ',' + R(0.15, 0.4) + ')'; gg.beginPath(); gg.arc(rnd() * 256, rnd() * 256, r, 0, E3.PI2); gg.fill(); }

  const make = (w, h, base) => { const c = e3canvas(w, h); const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, w, h); return [c, g]; };
  const [mc, g] = make(W, H, PAL.base);
  const pat = g.createPattern(gt, 'repeat');
  const overlay = (alpha, scale, rot) => {
    g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = alpha;
    const m = new DOMMatrix().rotate(rot).scale(scale); pat.setTransform(m); g.fillStyle = pat; g.fillRect(0, 0, W, H); g.restore();
  };
  overlay(0.7, 0.42 * (W / 1024) + 0.04, 0); overlay(0.4, 0.75 * (W / 1024) + 0.08, 31);

  // large soft tonal blotches (wear / patchiness)
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, y = rnd() * H, r = R(60, 260) * (W / 1024), l = rnd() < 0.5;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, l ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    // wrap vertically for seamless tiling
    if (y - r < 0) { g.save(); g.translate(0, H); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
    if (y + r > H) { g.save(); g.translate(0, -H); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }

  const X = m => (m + 11) * PX;          // metres from centre -> px
  const lanes = [-7, 0, 7];
  // polished wheel tracks (darker, shiny) with random segment strength
  lanes.forEach(lc => {
    [-0.88, 0.88].forEach(off => {
      let y = 0;
      while (y < H) {
        const len = R(120, 520), a = R(0.1, 0.34);
        const x0 = X(lc + off - 0.42), w = 0.84 * PX;
        const gr = g.createLinearGradient(x0, 0, x0 + w, 0);
        gr.addColorStop(0, 'rgba(8,8,10,0)'); gr.addColorStop(0.3, 'rgba(8,8,10,' + a + ')'); gr.addColorStop(0.7, 'rgba(8,8,10,' + a + ')'); gr.addColorStop(1, 'rgba(8,8,10,0)');
        g.fillStyle = gr; g.fillRect(x0 + R(-3, 3), y, w, len);
        y += len;
      }
    });
    // dusty/oily centre between tracks
    const gx = g.createLinearGradient(X(lc - 0.55), 0, X(lc + 0.55), 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.5, 'rgba(0,0,0,0.10)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gx; g.fillRect(X(lc - 0.55), 0, 1.1 * PX, H);
  });
  // oil drips along lane centres
  for (let i = 0; i < 26; i++) {
    const lc = lanes[Math.floor(rnd() * 3)] + R(-0.4, 0.4), x = X(lc), y = rnd() * H, r = R(5, 18) * (W / 1024);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(4,4,6,0.38)'); gr.addColorStop(1, 'rgba(4,4,6,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // repair patches
  for (let i = 0; i < 9; i++) {
    const w = R(1.2, 3.4) * PX, h = R(1.6, 5) * PX, x = X(R(-10, 8)), y = rnd() * (H - h);
    g.fillStyle = rnd() < 0.6 ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.045)'; g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1.2 * (W / 1024) + 0.3; g.strokeRect(x, y, w, h);
  }
  // transverse tar-sealed joints across the whole road
  for (let i = 0; i < 6; i++) {
    const y = (i + R(0.1, 0.9)) * H / 6; g.strokeStyle = 'rgba(6,6,8,0.34)'; g.lineWidth = 2.2 * (W / 1024) + 0.3; g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= W; x += 40) g.lineTo(x, y + R(-2, 2)); g.stroke();
  }
  // hairline cracks
  g.lineCap = 'round';
  for (let i = 0; i < 110; i++) {
    let x = rnd() * W, y = rnd() * H, a = rnd() * E3.PI2; const n = Math.floor(R(5, 18));
    g.strokeStyle = 'rgba(6,6,8,' + R(0.18, 0.42) + ')'; g.lineWidth = R(0.6, 1.4) * (W / 1024) + 0.3; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < n; k++) { a += R(-0.55, 0.55); x += Math.cos(a) * R(6, 20); y += Math.sin(a) * R(6, 20); g.lineTo(x, y); }
    g.stroke();
  }

  // rumble strips just outside the edge lines
  for (let s = -1; s <= 1; s += 2) {
    const x0 = s < 0 ? X(-11) : X(10.55), w = 0.45 * PX;
    for (let y = 0; y < H; y += 0.34 * PX) {
      g.fillStyle = 'rgba(0,0,0,0.34)'; g.fillRect(x0, y, w, 0.12 * PX);
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x0, y + 0.12 * PX, w, 0.12 * PX);
    }
  }

  // ---- paint layer (with wear) ----
  const [pc, pg] = make(W, H, 'rgba(0,0,0,0)'); pg.clearRect(0, 0, W, H);
  const lw = 0.2 * PX;
  pg.fillStyle = PAL.edge;
  pg.fillRect(X(-10.4) - lw / 2, 0, lw, H); pg.fillRect(X(10.4) - lw / 2, 0, lw, H);
  if (kind === 'canyon') { pg.fillRect(X(-10.05) - lw / 2, 0, lw * 0.5, H); pg.fillRect(X(10.05) - lw / 2, 0, lw * 0.5, H); }
  pg.fillStyle = PAL.paint;
  const period = 512 * (H / 2048);
  for (let k = 0; k < 4; k++) [-3.5, 3.5].forEach(m => { pg.fillRect(X(m) - lw / 2, k * period + period * 0.18, lw, 3.5 * PX); });
  // wear: erase speckles + noise
  pg.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) {
    const r = R(0.6, 2.6) * (W / 1024) + 0.2; pg.fillStyle = 'rgba(0,0,0,' + R(0.25, 0.9) + ')';
    const xs = [X(-10.4), X(10.4), X(-3.5), X(3.5), X(-10.05), X(10.05)];
    pg.beginPath(); pg.arc(xs[Math.floor(rnd() * 6)] + R(-8, 8), rnd() * H, r, 0, E3.PI2); pg.fill();
  }
  const pat2 = pg.createPattern(gt, 'repeat'); pat2.setTransform(new DOMMatrix().scale(0.6 * (W / 1024) + 0.2));
  pg.globalAlpha = 0.5; pg.fillStyle = pat2; pg.fillRect(0, 0, W, H);   // grain eats into the paint
  pg.globalAlpha = 1; pg.globalCompositeOperation = 'source-over';
  // wheel wear on the dashes' edges: nothing; composite onto asphalt
  g.save(); g.globalAlpha = 0.94; g.drawImage(pc, 0, 0); g.restore();
  // paint is slightly darkened where tyres run over the lane lines
  g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.5;
  const dv = g.createLinearGradient(0, 0, 0, H); dv.addColorStop(0, '#fff'); dv.addColorStop(0.5, '#cfcfcf'); dv.addColorStop(1, '#fff'); g.fillStyle = dv; g.fillRect(X(-3.8), 0, 0.6 * PX, H); g.fillRect(X(3.2), 0, 0.6 * PX, H); g.restore();

  // snow slush / salt at the edges
  if (kind === 'snow') {
    [0, 1].forEach(s => {
      const x0 = s === 0 ? 0 : W - 1.7 * PX, x1 = s === 0 ? 1.7 * PX : W;
      const gr = g.createLinearGradient(s === 0 ? x0 : x1, 0, s === 0 ? x1 : x0, 0);
      gr.addColorStop(0, 'rgba(226,232,238,0.62)'); gr.addColorStop(1, 'rgba(226,232,238,0)');
      g.fillStyle = gr; g.fillRect(x0, 0, x1 - x0, H);
    });
    for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(235,240,245,' + R(0.08, 0.4) + ')'; const x = rnd() < 0.5 ? R(0, 2.2) * PX : W - R(0, 2.2) * PX; g.fillRect(x, rnd() * H, R(2, 10), R(3, 22)); }
    g.fillStyle = 'rgba(235,240,245,0.07)'; for (let l = -1; l <= 1; l++) g.fillRect(X(l * 7 - 0.1), 0, 0.2 * PX, H);
  }
  // sand drift at the edges for canyon / alpine dust
  if (kind === 'canyon' || kind === 'alpine') {
    [0, 1].forEach(s => {
      const x0 = s === 0 ? 0 : W - 1.2 * PX, x1 = s === 0 ? 1.2 * PX : W;
      const gr = g.createLinearGradient(s === 0 ? x0 : x1, 0, s === 0 ? x1 : x0, 0);
      gr.addColorStop(0, kind === 'canyon' ? 'rgba(170,110,70,0.42)' : 'rgba(150,140,120,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x0, 0, x1 - x0, H);
    });
  }

  // ---- roughness (G channel) ----
  const rw = W / 2, rh = H / 2, rpx = PX / 2;
  const wet = kind === 'city';
  const [rc, rg] = make(rw, rh, wet ? 'rgb(115,115,115)' : 'rgb(222,222,222)');
  const rpat = rg.createPattern(gt, 'repeat');
  rg.save(); rg.globalCompositeOperation = 'overlay'; rg.globalAlpha = 0.5; rpat.setTransform(new DOMMatrix().scale(0.5)); rg.fillStyle = rpat; rg.fillRect(0, 0, rw, rh); rg.restore();
  const RX = m => (m + 11) * rpx;
  lanes.forEach(lc => [-0.88, 0.88].forEach(off => {
    const x0 = RX(lc + off - 0.42), w = 0.84 * rpx;
    const gr = rg.createLinearGradient(x0, 0, x0 + w, 0);
    const c = wet ? '45,45,45' : '150,150,150';
    gr.addColorStop(0, 'rgba(' + c + ',0)'); gr.addColorStop(0.5, 'rgba(' + c + ',0.85)'); gr.addColorStop(1, 'rgba(' + c + ',0)');
    rg.fillStyle = gr; rg.fillRect(x0, 0, w, rh);
  }));
  if (wet) {
    for (let i = 0; i < 48; i++) {   // puddles
      const x = RX(R(-10, 10)), y = rnd() * rh, rx = R(0.5, 2.4) * rpx, ry = R(2, 9) * rpx;
      const gr = rg.createRadialGradient(x, y, 0, x, y, 1); gr.addColorStop(0, 'rgba(18,18,18,0.95)'); gr.addColorStop(0.7, 'rgba(25,25,25,0.8)'); gr.addColorStop(1, 'rgba(60,60,60,0)');
      rg.save(); rg.translate(x, y); rg.scale(rx, ry); rg.translate(-x, -y); rg.fillStyle = gr; rg.beginPath(); rg.arc(x, y, 1, 0, E3.PI2); rg.fill(); rg.restore();
    }
  }
  rg.save(); rg.globalAlpha = 0.9; rg.globalCompositeOperation = 'source-over';
  rg.drawImage(pc, 0, 0, rw, rh);   // paint = rough
  rg.restore();
  rg.save(); rg.globalCompositeOperation = 'lighter'; rg.fillStyle = 'rgba(0,0,0,0)'; rg.restore();

  // ---- bump ----
  const [bc, bg] = make(rw, rh, 'rgb(128,128,128)');
  const bpat = bg.createPattern(gt, 'repeat');
  bg.save(); bg.globalAlpha = 0.9; bpat.setTransform(new DOMMatrix().scale(0.3)); bg.fillStyle = bpat; bg.fillRect(0, 0, rw, rh); bg.restore();
  bg.save(); bg.globalAlpha = 0.25; bg.drawImage(mc, 0, 0, rw, rh); bg.restore();
  bg.save(); bg.globalAlpha = 0.5; bg.drawImage(pc, 0, 0, rw, rh); bg.restore();

  const out = {
    map: e3canvasTex(mc, { aniso: renderer ? e3maxAniso(renderer) : 8, srgb: true }),
    rough: e3canvasTex(rc, { aniso: 4 }),
    bump: e3canvasTex(bc, { aniso: 4 })
  };
  C[key] = out;
  return out;
}

// ---------------------------------------------------------------------------
// Pine needles / foliage (tileable, mid-grey so it multiplies vertex colours)
// ---------------------------------------------------------------------------
function e3FoliageTex() {
  const C = E3.cache.tex;
  if (C.foliage) return C.foliage;
  const c = e3canvas(128, 128), g = c.getContext('2d');
  const rnd = e3rng(4242);
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1100; i++) {
    const x = rnd() * 128, y = rnd() * 128, a = rnd() * 3.14, l = 3 + rnd() * 9, v = 90 + rnd() * 165;
    g.strokeStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.8)'; g.lineWidth = 1 + rnd(); g.beginPath();
    for (let w = -1; w <= 1; w++) { g.moveTo(x + w * 128, y); g.lineTo(x + w * 128 + Math.cos(a) * l, y + Math.sin(a) * l); }
    g.stroke();
  }
  for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(30,30,30,0.35)'; g.beginPath(); g.arc(rnd() * 128, rnd() * 128, 2 + rnd() * 5, 0, E3.PI2); g.fill(); }
  const t = e3canvasTex(c, { aniso: 4 });
  return (C.foliage = t);
}

// ---------------------------------------------------------------------------
// City: facade textures (3 variants), 8 cols x 16 floors per tile. lit windows
// ---------------------------------------------------------------------------
function e3FacadeTextures() {
  const C = E3.cache.tex;
  if (C.facades) return C.facades;
  const rnd = e3rng(555);
  const R = (a, b) => a + (b - a) * rnd();
  const out = [];
  for (let v = 0; v < 3; v++) {
    const c = e3canvas(512, 1024), g = c.getContext('2d');
    const cw = 64, ch = 64;
    const base = ['#0b101c', '#141a26', '#0a0d16'][v];
    g.fillStyle = base; g.fillRect(0, 0, 512, 1024);
    // subtle panel noise
    for (let i = 0; i < 3500; i++) { const a = R(0.02, 0.07); g.fillStyle = 'rgba(' + (rnd() < 0.5 ? '255,255,255' : '0,0,0') + ',' + a + ')'; g.fillRect(rnd() * 512, rnd() * 1024, R(2, 18), R(2, 10)); }
    const warm = ['#ffe9b8', '#ffdca0', '#fff4d6', '#ffd08a'], cool = ['#d8ecff', '#bcdcff', '#eaf4ff'];
    for (let row = 0; row < 16; row++) {
      const floorLit = rnd() < 0.14, floorCool = rnd() < 0.4;
      for (let col = 0; col < 8; col++) {
        const x = col * cw, y = row * ch;
        let lit = floorLit ? rnd() < 0.9 : rnd() < (v === 1 ? 0.34 : 0.45);
        let wx, wy, ww, wh;
        if (v === 0) { wx = x + 2; wy = y + 12; ww = cw - 4; wh = 40; }            // ribbon glazing
        else if (v === 1) { wx = x + 14; wy = y + 14; ww = 34; wh = 36; }            // apartment windows
        else { wx = x + 8; wy = y + 8; ww = 48; wh = 46; }                           // big panes
        if (lit) {
          const col2 = (floorCool ? cool : warm)[Math.floor(rnd() * 3)];
          g.fillStyle = col2; g.globalAlpha = R(0.55, 1.0); g.fillRect(wx, wy, ww, wh); g.globalAlpha = 1;
          if (v === 1 && rnd() < 0.5) { g.fillStyle = 'rgba(40,20,0,0.35)'; g.fillRect(wx, wy, ww, R(6, 22)); } // curtain
        } else {
          g.fillStyle = ['#0e1626', '#101a2c', '#0b1220'][Math.floor(rnd() * 3)]; g.fillRect(wx, wy, ww, wh);
          g.fillStyle = 'rgba(120,150,200,0.07)'; g.fillRect(wx, wy, ww, 5);
        }
        if (v === 1) { g.fillStyle = 'rgba(120,120,130,0.22)'; g.fillRect(x + 8, y + 52, cw - 16, 5); } // balcony slab
      }
      if (v === 0) { g.fillStyle = 'rgba(60,70,90,0.5)'; g.fillRect(0, row * ch + 56, 512, 3); }
    }
    // vertical mullions
    g.fillStyle = 'rgba(0,0,0,0.5)'; for (let col = 0; col <= 8; col++) g.fillRect(col * cw - 1, 0, 2, 1024);
    out.push(e3canvasTex(c, { aniso: 4, srgb: true }));
  }
  return (C.facades = out);
}

// ---------------------------------------------------------------------------
// Sign atlas (4 x 2 cells of 256): speed 80 / 100 / 60 / bend warning / chevron / exit / ... (Hebrew+Latin text allowed)
// ---------------------------------------------------------------------------
function e3SignAtlas() {
  const C = E3.cache.tex;
  if (C.signs) return C.signs;
  const c = e3canvas(1024, 512), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 512);
  const cell = (i, fn) => { g.save(); g.translate((i % 4) * 256, Math.floor(i / 4) * 256); g.beginPath(); g.rect(0, 0, 256, 256); g.clip(); fn(); g.restore(); };
  const speed = (i, n) => cell(i, () => {
    g.fillStyle = '#d9d9d6'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(128, 128, 118, 0, E3.PI2); g.fill();
    g.strokeStyle = '#c4161c'; g.lineWidth = 24; g.beginPath(); g.arc(128, 128, 104, 0, E3.PI2); g.stroke();
    g.fillStyle = '#101010'; g.font = 'bold 108px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 128, 136);
  });
  speed(0, 80); speed(1, 100); speed(2, 60);
  cell(3, () => { // bend warning triangle
    g.fillStyle = '#d9d9d6'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#c4161c'; g.beginPath(); g.moveTo(128, 14); g.lineTo(246, 226); g.lineTo(10, 226); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(128, 50); g.lineTo(214, 208); g.lineTo(42, 208); g.closePath(); g.fill();
    g.strokeStyle = '#101010'; g.lineWidth = 16; g.lineCap = 'round'; g.beginPath(); g.moveTo(104, 200); g.bezierCurveTo(104, 150, 156, 130, 146, 84); g.stroke();
    g.fillStyle = '#101010'; g.beginPath(); g.moveTo(146, 62); g.lineTo(166, 100); g.lineTo(124, 96); g.closePath(); g.fill();
  });
  cell(4, () => { // chevron board
    g.fillStyle = '#17171a'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#f5c400'; g.fillRect(10, 10, 236, 236);
    g.strokeStyle = '#17171a'; g.lineWidth = 34; g.lineCap = 'butt'; g.lineJoin = 'miter';
    g.beginPath(); g.moveTo(66, 36); g.lineTo(190, 128); g.lineTo(66, 220); g.stroke();
  });
  cell(5, () => { // green exit sign (Hebrew + English)
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#0c6b3a'; g.fillRect(8, 8, 240, 240);
    g.strokeStyle = '#f2f2f2'; g.lineWidth = 4; g.strokeRect(16, 16, 224, 224);
    g.fillStyle = '#f2f2f2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 64px Arial, sans-serif'; g.fillText('EXIT 12', 128, 80);
    g.direction = 'rtl'; g.font = 'bold 56px Arial, sans-serif'; g.fillText('יציאה 12', 128, 150);
    g.beginPath(); g.moveTo(108, 190); g.lineTo(148, 190); g.lineTo(148, 210); g.lineTo(176, 180); g.lineTo(148, 150); g.lineTo(148, 170); g.lineTo(108, 170); g.closePath(); g.fill();
  });
  cell(6, () => { // reflector delineator / hazard post stripes
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#c4161c'; for (let i = -2; i < 8; i++) { g.beginPath(); g.moveTo(i * 60, 256); g.lineTo(i * 60 + 30, 256); g.lineTo(i * 60 + 130, 0); g.lineTo(i * 60 + 100, 0); g.fill(); }
  });
  cell(7, () => { // blue info sign (rest area)
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#0b4ea2'; g.fillRect(8, 8, 240, 240);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 56px Arial, sans-serif'; g.fillText('SERVICE', 128, 70);
    g.direction = 'rtl'; g.font = 'bold 54px Arial, sans-serif'; g.fillText('שירות', 128, 140);
    g.font = 'bold 40px Arial, sans-serif'; g.direction = 'ltr'; g.fillText('2 KM', 128, 206);
  });
  const t = e3canvasTex(c, { aniso: 8, clampS: true, clampT: true, srgb: true });
  return (C.signs = t);
}
function e3KmAtlas() {   // digits 0..31 : 8 x 4 cells of 128
  const C = E3.cache.tex;
  if (C.km) return C.km;
  const c = e3canvas(1024, 512), g = c.getContext('2d');
  g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 32; i++) {
    const x = (i % 8) * 128, y = Math.floor(i / 8) * 128;
    g.fillStyle = '#1a1a1c'; g.fillRect(x, y, 128, 22);
    g.fillStyle = '#f4f4f0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 14px Arial'; g.fillText('KM', x + 64, y + 11);
    g.fillStyle = '#111'; g.font = 'bold 78px Arial, sans-serif'; g.fillText(String(i), x + 64, y + 76);
  }
  const t = e3canvasTex(c, { aniso: 4, clampS: true, clampT: true, srgb: true });
  return (C.km = t);
}

// ============================================================================
// [p03_themes]
// ============================================================================
// p03: theme tables (palette, light, fog, sky, road, props, densities)
// Colours are [r,g,b] 0..1 in the game's existing (unmanaged / linear-looking) pipeline.
// ============================================================================

const E3THEMES = {
  alpine: {
    key: 'alpine',
    exposure: 1.08,
    fog: { color: [0.80, 0.62, 0.50], density: 0.00092 },
    sun: { az: 38, el: 14, color: [1.0, 0.72, 0.46], I: 2.6 },
    hemi: { sky: [0.30, 0.40, 0.70], ground: [0.22, 0.15, 0.10], I: 0.9 },
    env: { ibl: 0.55 },
    sky: {
      top: [0.09, 0.20, 0.46], mid: [0.34, 0.50, 0.78], horizon: [0.90, 0.62, 0.46], horizonSun: [1.0, 0.58, 0.28], ground: [0.80, 0.62, 0.50],
      sunSize: 0.0105, sunGlow: 0.7, sunDisc: 5.0,
      cloud: { amt: 0.58, col: [0.88, 0.67, 0.52], shade: [0.42, 0.36, 0.50], speed: 0.0016, scale: 1.0 },
      stars: 0
    },
    road: { kind: 'alpine', roughness: 0.92, rail: 'wbeam' },
    seaY: -26,
    ravines: [0.145, 0.285, 0.555, 0.70, 0.86],
    ravineDepth: 24,
    treeDensity: 1.0
  },
  city: {
    key: 'city',
    exposure: 1.12,
    fog: { color: [0.13, 0.12, 0.20], density: 0.00135 },
    sun: { az: -30, el: 38, color: [0.45, 0.55, 1.0], I: 0.55 },
    hemi: { sky: [0.07, 0.10, 0.22], ground: [0.06, 0.05, 0.06], I: 0.9 },
    env: { ibl: 0.9 },
    sky: {
      top: [0.012, 0.020, 0.060], mid: [0.045, 0.060, 0.14], horizon: [0.30, 0.17, 0.24], horizonSun: [0.34, 0.20, 0.26], ground: [0.13, 0.12, 0.20],
      sunSize: 0.011, sunGlow: 0.6, sunDisc: 2.4,
      cloud: { amt: 0.30, col: [0.30, 0.20, 0.30], shade: [0.04, 0.05, 0.10], speed: 0.0009, scale: 1.2 },
      stars: 1
    },
    road: { kind: 'city', roughness: 1.0, rail: 'jersey' },
    groundOffset: 9.6,
    ravines: [],
    treeDensity: 0
  },
  canyon: {
    key: 'canyon',
    exposure: 1.06,
    fog: { color: [0.72, 0.42, 0.28], density: 0.00105 },
    sun: { az: 30, el: 17, color: [1.0, 0.60, 0.32], I: 2.7 },
    hemi: { sky: [0.45, 0.30, 0.30], ground: [0.35, 0.15, 0.08], I: 0.8 },
    env: { ibl: 0.5 },
    sky: {
      top: [0.20, 0.20, 0.42], mid: [0.66, 0.46, 0.46], horizon: [0.92, 0.55, 0.30], horizonSun: [1.0, 0.52, 0.20], ground: [0.72, 0.42, 0.28],
      sunSize: 0.013, sunGlow: 1.15, sunDisc: 7.0,
      cloud: { amt: 0.30, col: [1.0, 0.66, 0.46], shade: [0.40, 0.28, 0.36], speed: 0.0012, scale: 0.8 },
      stars: 0
    },
    road: { kind: 'canyon', roughness: 0.92, rail: 'wbeam' },
    ravines: [0.12, 0.285, 0.40, 0.555, 0.70, 0.86],
    ravineDepth: 30,
    treeDensity: 1.0
  },
  snow: {
    key: 'snow',
    exposure: 0.92,
    fog: { color: [0.66, 0.75, 0.88], density: 0.00088 },
    sun: { az: -28, el: 31, color: [1.0, 0.93, 0.80], I: 2.0 },
    hemi: { sky: [0.33, 0.48, 0.90], ground: [0.36, 0.40, 0.50], I: 0.72 },
    env: { ibl: 0.6 },
    sky: {
      top: [0.12, 0.30, 0.68], mid: [0.40, 0.60, 0.88], horizon: [0.76, 0.85, 0.96], horizonSun: [0.88, 0.90, 0.95], ground: [0.62, 0.72, 0.86],
      sunSize: 0.0095, sunGlow: 0.8, sunDisc: 6.0,
      cloud: { amt: 0.42, col: [0.90, 0.92, 0.96], shade: [0.52, 0.60, 0.78], speed: 0.0013, scale: 1.0 },
      stars: 0
    },
    road: { kind: 'snow', roughness: 0.9, rail: 'wbeam' },
    ravines: [0.145, 0.285, 0.555, 0.70, 0.86],
    ravineDepth: 26,
    treeDensity: 0.9
  }
};

// ============================================================================
// [p04_ground]
// ============================================================================
// p04: ground model (natural terrain per theme, road corridor, gorges/bridges)
//      + chunked terrain meshes + sea / river / lava surfaces
// ============================================================================

class E3Ground {
  constructor(track, T, hi) {
    this.track = track; this.T = T; this.hi = hi;
    this.key = T.key;
    this.L = track.length;
    this.zmin = E3.ZMIN; this.zmax = this.L + E3.ZEXTRA;
    this.nz = new E3Noise(e3strHash(track.config.id + '_g'));
    this.n2 = new E3Noise(e3strHash(track.config.id + '_v'));
    this.stz = track.stations.map(s => s.z);
    this.RW = track.roadWidth / 2;                 // 11
    this.seaY = T.seaY || 0;
    // gorges (ravines) with the river / lava at the bottom, crossing the road on a bridge
    this.ravines = (T.ravines || []).map((f, i) => {
      const z = Math.round(f * this.L / 5) * 5;
      const rnd = e3rng(e3strHash(track.config.id) + i * 31);
      return { z, win: 34 + rnd() * 16, wout: 78 + rnd() * 26, depth: (T.ravineDepth || 24) * (0.85 + rnd() * 0.3), floor: 0, side: rnd() };
    });
    this.ravines.forEach(r => { r.floor = track.getHeightAt(r.z) - (this.key === 'alpine' || this.key === 'canyon' || this.key === 'snow' ? 0.8 : 0) - r.depth; });
    // bridge factor lookup (per 5 m), computed lazily
    this.bfStep = 5;
    this.bfN = Math.ceil((this.zmax - this.zmin) / this.bfStep) + 2;
    this.bf = new Float32Array(this.bfN);
    for (let i = 0; i < this.bfN; i++) {
      const z = this.zmin + i * this.bfStep;
      const cx = track.getCurveXAt(z), R = track.getHeightAt(z);
      const sf = this.stationFlat(z);
      const G = this.natural(cx, z, 0, 0, R, sf);
      this.bf[i] = e3smooth(2.4, 5.5, R - G);
    }
    // lateral columns relative to the road centre (dense near the road)
    const lat = [0]; let p = 0, s = 2.0;
    while (p < 24) { p += s; lat.push(p); }
    while (p < 1500) { s *= 1.115; p += s; lat.push(p); }
    this.latPos = lat;                              // 0..~1500
    const full = [];
    for (let i = lat.length - 1; i >= 1; i--) full.push(-lat[i]);
    for (let i = 0; i < lat.length; i++) full.push(lat[i]);
    this.LAT = Float32Array.from(full);
    this.NC = this.LAT.length;
    this.iCenter = lat.length - 1;
  }

  stationFlat(z) {
    let d = 1e9;
    for (let i = 0; i < this.stz.length; i++) { const dd = Math.abs(z - this.stz[i]); if (dd < d) d = dd; }
    return 1 - e3smooth(120, 340, d);
  }
  stationDz(z) {
    let d = 1e9;
    for (let i = 0; i < this.stz.length; i++) { const dd = Math.abs(z - this.stz[i]); if (dd < d) d = dd; }
    return d;
  }
  bridgeF(z) {
    const f = (z - this.zmin) / this.bfStep;
    const i = e3clamp(Math.floor(f), 0, this.bfN - 2);
    return e3lerp(this.bf[i], this.bf[i + 1], e3clamp(f - i, 0, 1));
  }

  // natural ground height at world (x, z); s = x - roadCentreX ; a = |s| ; R = road height ; sfa = station flatten mask
  natural(x, z, s, a, R, sf) {
    const nz = this.nz;
    const sfa = sf * (1 - e3smooth(60, 160, a));
    let h;
    switch (this.key) {
      case 'alpine': {
        const B = R - 0.8;
        const hills = 12 * nz.fbm(x / 140 + 11, z / 140, 4, 2, 0.5) + 4 * nz.fbm(x / 38, z / 38, 2, 2, 0.5);
        if (s <= 0 || a < 6) {
          const rise = (a < 150 ? a * 0.13 : 19.5 + (a - 150) * 0.44) * (0.75 + 0.5 * nz.fbm(x / 400 + 3, z / 400, 2, 2, 0.5));
          const peaks = 270 * e3smooth(480, 1250, a) * (0.2 + 0.8 * nz.ridged(x / 560 + 2, z / 560, 4, 2, 0.5));
          h = B + (hills * e3smooth(6, 80, a) + rise * e3smooth(10, 50, a)) * (1 - sfa) + peaks;
        } else {
          const c = this.coast(z, sf);
          const landH = B + hills * 0.6 * e3smooth(6, 70, a) * (1 - sfa);
          const t = e3smooth(c - 42, c + 26, a);
          const floor = this.seaY - 7 - 42 * e3smooth(c, c + 400, a);
          h = e3lerp(landH, floor, t);
          if (a > 330) {
            const isl = Math.max(0, nz.fbm(x / 300 + 7, z / 300 - 3, 3, 2, 0.5) - 0.06) / 0.94;
            let ih = this.seaY - 3 + isl * isl * 150 * e3smooth(330, 700, a);
            ih += 330 * e3smooth(1050, 1500, a) * (0.25 + 0.75 * nz.ridged(x / 520 - 4, z / 520, 4, 2, 0.5));
            if (ih > h) h = ih;
          }
        }
        break;
      }
      case 'city':
        h = R - this.T.groundOffset + 0.0;
        break;
      case 'canyon': {
        const B = R - 1.2;
        const side = s < 0 ? 0 : 1;
        const open = e3smooth(0.1, 0.55, nz.n(z / 900 + side * 5, 0.5)) * 260;
        let w0 = 54 + 72 * (0.5 + 0.5 * Math.sin(z * 0.0017 + side * 2.1)) + 55 * nz.fbm(z / 180 + side * 9, 3.3, 2, 2, 0.5) + open + sf * 120;
        if (w0 < 40) w0 = 40;
        const wallH = 88 + 58 * nz.n(z / 420 + side * 3, 1.7);
        const floorN = 2.6 * nz.fbm(x / 60, z / 60, 3, 2, 0.5) * e3smooth(8, 50, a) * (1 - sfa);
        const d = a - w0;
        h = B + floorN;
        if (d > 0) {
          let rise = wallH * e3smooth(0, 70, d);
          const tstep = 15, t = rise / tstep, fl = Math.floor(t), fr = t - fl;
          const rise2 = tstep * (fl + e3smooth(0.30, 0.78, fr));
          rise = e3lerp(rise, rise2, 0.88);
          rise += 7 * nz.ridged(x / 46 + 5, z / 46, 3, 2, 0.5) * e3smooth(0, 90, d);
          h = B + floorN + rise + 9 * nz.fbm(x / 90, z / 90, 2, 2, 0.5) * e3smooth(70, 150, d);
        }
        // mesas / buttes further out
        const bm = Math.max(0, nz.ridged(x / 250 + 2, z / 250, 3, 2, 0.5) - 0.56) / 0.44;
        if (bm > 0 && a > 170) {
          const top = B + 36 + 100 * bm * e3smooth(170, 520, a);
          let bt = top - B; const tstep = 13, tt = bt / tstep, fl = Math.floor(tt);
          bt = tstep * (fl + e3smooth(0.3, 0.8, tt - fl));
          const mh = B + bt * e3smooth(0.0, 0.35, bm);
          if (mh > h) h = mh;
        }
        const far = 200 * e3smooth(700, 1450, a) * (0.35 + 0.65 * nz.ridged(x / 480 + 9, z / 480, 3, 2, 0.5));
        h += far;
        break;
      }
      default: { // snow
        const B = R - 0.8;
        const hills = 9 * nz.fbm(x / 160 + 5, z / 160 + 4, 4, 2, 0.5) * e3smooth(6, 70, a) + 3 * nz.fbm(x / 45, z / 45, 2, 2, 0.5) * e3smooth(6, 40, a);
        const rise = (a < 160 ? a * 0.12 : 19 + (a - 160) * 0.42) * (0.7 + 0.6 * nz.fbm(x / 380 + 8, z / 380, 2, 2, 0.5));
        const peaks = 300 * e3smooth(440, 1250, a) * (0.22 + 0.78 * nz.ridged(x / 520 + 6, z / 520, 4, 2, 0.5));
        h = B + (hills + rise * e3smooth(10, 60, a)) * (1 - sfa) + peaks;
        const lake = this.lakeMask(x, z, a, sfa);
        if (lake > 0) h = e3lerp(h, Math.min(h, B - 4.5), lake);
        break;
      }
    }
    // gorges (nature themes): a trench across the road
    for (let i = 0; i < this.ravines.length; i++) {
      const r = this.ravines[i];
      const dz = Math.abs(z - r.z);
      if (dz > r.wout) continue;
      let g = 1 - e3smooth(r.win, r.wout, dz);
      if (this.key === 'alpine') {
        if (s > 0) { const c = this.coast(r.z, 0); g *= 1 - e3smooth(c - 110, c - 34, a); }
        g *= 1 - e3smooth(260, 480, a);
      } else g *= 1 - e3smooth(240, 520, a);
      if (g > 0 && h > r.floor) {
        const fl = r.floor + 1.2 * nz.fbm(x / 22, z / 22, 2, 2, 0.5) + 2.0 * nz.ridged(x / 14, z / 14, 2, 2, 0.5);
        h = e3lerp(h, fl, e3clamp(g * 1.15, 0, 1));
      }
    }
    return h;
  }
  coast(z, sf) {
    return 50 + 24 * Math.sin(z * 0.0021 + 1.0) + 16 * Math.sin(z * 0.0057 + 4.0) + 10 * this.nz.n(z / 70, 5.5) + 130 * (sf === undefined ? this.stationFlat(z) : sf);
  }
  lakeMask(x, z, a, sfa) {
    const v = this.nz.fbm(x / 200 + 17, z / 200 - 5, 3, 2, 0.5) * 0.5 + 0.5;
    return e3smooth(0.55, 0.64, v) * e3smooth(46, 100, a) * (1 - e3smooth(520, 760, a)) * (1 - sfa);
  }

  // final terrain height (road corridor blended with natural ground)
  H(x, z) {
    const tk = this.track;
    const cx = tk.getCurveXAt(z), R = tk.getHeightAt(z);
    const s = x - cx, a = Math.abs(s);
    const sf = this.stationFlat(z);
    const G = this.natural(x, z, s, a, R, sf);
    return this.finalH(G, a, R, z, s);
  }
  finalH(G, a, R, z, s) {
    const base = R - 0.34;
    const e = a > this.RW + 2.5 ? a - this.RW - 2.5 : 0;
    const lo = base - 0.62 * e, hi = base + 1.1 * e;
    let h = G < lo ? lo : (G > hi ? hi : G);
    const f = this.bridgeF(z);
    if (f > 0) h = e3lerp(h, G, f * (1 - e3smooth(52, 78, a)));
    if (this.key === 'snow' && f < 0.6) h += 0.95 * Math.exp(-((a - 14.6) * (a - 14.6)) / 3.4) * (1 - f);   // snow-plough banks
    // pit3d forecourt box (local x -40..+42, z +-70 around every station): terrain is dead flat at road level - 0.34
    // (blended out over ~35 m so there is no step). City has its own service deck instead.
    if (this.key !== 'city') {
      const dz = this.stationDz(z);
      if (dz < 112) {
        const m = (1 - e3smooth(70, 112, dz)) * e3smooth(-54, -40, s) * (1 - e3smooth(42, 56, s));
        if (m > 0) h = e3lerp(h, base, m);
      }
    }
    return h;
  }

  // forest density 0..1 at a world point (needs terrain y and normal-y)
  forest(x, z, a, y, ny, R, s) {
    if (this.key === 'city' || this.key === 'canyon') return 0;
    const n2 = this.n2;
    let m;
    const up = y - R;
    if (this.key === 'alpine') {
      m = e3smooth(-0.10, 0.26, n2.fbm(x / 170 + 5, z / 170, 3, 2, 0.5));
      m *= 1 - e3smooth(150, 250, up);
      if (s > 0) m *= e3smooth(this.seaY + 5, this.seaY + 12, y);
    } else {
      m = e3smooth(0.05, 0.36, n2.fbm(x / 120 + 9, z / 120 - 4, 3, 2, 0.5));
      m *= 1 - e3smooth(90, 180, up);
    }
    m *= e3smooth(0.68, 0.86, ny) * e3smooth(13.5, 30, a);
    return m;
  }
}

// ---------------------------------------------------------------------------
// terrain colour per theme -> out = [r,g,b, rockWeight, special]
// ---------------------------------------------------------------------------
function e3TerrainColor(G, x, z, y, ny, a, s, R, out) {
  const nz = G.n2, key = G.key;
  const slope = 1 - ny;
  let r, g, b, rock = 0, sp = 0;
  if (key === 'alpine') {
    const t = e3clamp(0.5 + 0.9 * nz.fbm(x / 90, z / 90, 3, 2, 0.5), 0, 1);
    r = e3lerp(0.45, 0.20, t); g = e3lerp(0.48, 0.38, t); b = e3lerp(0.20, 0.12, t);
    const f = G.forest(x, z, a, y, ny, R, s);
    r = e3lerp(r, 0.13, f * 0.8); g = e3lerp(g, 0.21, f * 0.8); b = e3lerp(b, 0.11, f * 0.8);
    const up = y - R;
    rock = Math.max(e3smooth(0.2, 0.4, slope), e3smooth(130, 260, up) * 0.8);
    if (rock > 0) { r = e3lerp(r, 0.44, rock); g = e3lerp(g, 0.40, rock); b = e3lerp(b, 0.36, rock); }
    if (up > 210) { const sn = e3smooth(210, 300, up + 40 * nz.n(x / 50, z / 50)) * (0.4 + 0.6 * e3smooth(0.1, 0.5, ny)); r = e3lerp(r, 0.93, sn); g = e3lerp(g, 0.93, sn); b = e3lerp(b, 0.97, sn); rock *= 1 - sn; }
    const sea = G.seaY;
    if (s > 0) {
      const beach = e3smooth(sea + 7, sea + 2.5, y) * (1 - e3smooth(0.18, 0.3, slope));
      r = e3lerp(r, 0.78, beach); g = e3lerp(g, 0.68, beach); b = e3lerp(b, 0.50, beach);
      const wet = e3smooth(sea + 1.6, sea - 0.4, y);
      r = e3lerp(r, 0.22, wet); g = e3lerp(g, 0.21, wet); b = e3lerp(b, 0.20, wet);
    }
    if (a < 15.5) { r = 0.36; g = 0.33; b = 0.30; sp = 1; rock = 0; }
    else if (a < 30) { const k = (1 - e3smooth(15.5, 30, a)) * e3smooth(0.1, 0.3, slope); r = e3lerp(r, 0.46, k); g = e3lerp(g, 0.35, k); b = e3lerp(b, 0.24, k); }
  } else if (key === 'city') {
    const t = nz.fbm(x / 40, z / 40, 2, 2, 0.5);
    r = 0.075 + 0.02 * t; g = 0.08 + 0.02 * t; b = 0.10 + 0.02 * t; rock = 0;
  } else if (key === 'canyon') {
    const t = e3clamp(0.5 + 0.9 * nz.fbm(x / 70, z / 70, 3, 2, 0.5), 0, 1);
    r = e3lerp(0.74, 0.58, t); g = e3lerp(0.44, 0.27, t); b = e3lerp(0.27, 0.16, t);
    const pale = e3smooth(0.55, 0.85, nz.fbm(x / 36 + 3, z / 36, 3, 2, 0.5) * 0.5 + 0.5);
    r = e3lerp(r, 0.86, pale * 0.5); g = e3lerp(g, 0.62, pale * 0.5); b = e3lerp(b, 0.40, pale * 0.5);
    rock = Math.max(e3smooth(0.14, 0.34, slope), e3smooth(8, 26, y - (R - 1.2)));
    if (a < 15.5) { r = 0.50; g = 0.35; b = 0.25; sp = 1; rock = 0; }
  } else { // snow
    const t = e3clamp(0.5 + 0.9 * nz.fbm(x / 60, z / 60, 3, 2, 0.5), 0, 1);
    r = e3lerp(0.84, 0.68, t); g = e3lerp(0.88, 0.76, t); b = e3lerp(0.94, 0.88, t);
    const f = G.forest(x, z, a, y, ny, R, s);
    r = e3lerp(r, 0.60, f * 0.4); g = e3lerp(g, 0.68, f * 0.4); b = e3lerp(b, 0.76, f * 0.4);
    const up = y - R;
    rock = Math.max(e3smooth(0.17, 0.36, slope) * e3smooth(-10, 20, up), 0) * (0.75 + 0.25 * nz.n(x / 30, z / 30));
    if (up > 260) rock *= 1 - e3smooth(260, 330, up) * 0.7;
    if (rock > 0) { r = e3lerp(r, 0.30, rock); g = e3lerp(g, 0.31, rock); b = e3lerp(b, 0.35, rock); }
    const lake = G.lakeMask(x, z, a, 0);
    if (lake > 0.02) { sp = lake; r = e3lerp(r, 0.50, lake); g = e3lerp(g, 0.72, lake); b = e3lerp(b, 0.88, lake); rock *= 1 - lake; }
    if (a < 15.5) { const sl = 1 - e3smooth(12, 15.5, a); r = e3lerp(r, 0.64, sl); g = e3lerp(g, 0.66, sl); b = e3lerp(b, 0.68, sl); }
  }
  out[0] = r; out[1] = g; out[2] = b; out[3] = rock; out[4] = sp;
}

// ---------------------------------------------------------------------------
// terrain material (standard in 'high', lambert in 'low') with splat-free
// triplanar-free procedural detail from the tileable noise texture
// ---------------------------------------------------------------------------
function e3TerrainMaterial(T, hi, noiseTex) {
  const key = T.key;
  const mat = hi
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.0, envMapIntensity: (T.env && T.env.ibl) || 0.5 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.customProgramCacheKey = () => 'e3terr_' + key + (hi ? 'H' : 'L');
  mat.userData.time = { value: 0 };
  mat.onBeforeCompile = shader => {
    shader.uniforms.uNoise = { value: noiseTex };
    shader.uniforms.uTime = mat.userData.time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aMat;\nvarying vec2 vMat;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat; vWP = position;');
    let frag = '';
    frag += 'uniform sampler2D uNoise; uniform float uTime; varying vec2 vMat; varying vec3 vWP;\n';
    if (hi) frag += `
      vec3 e3Perturb(vec3 sp, vec3 sn, vec2 dH) {
        vec3 sx = dFdx(sp), sy = dFdy(sp);
        vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
        float det = dot(sx, r1);
        vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
        return normalize(abs(det) * sn - grad);
      }\n`;
    let body = `
      vec2 wp = vWP.xz;
      vec4 n1 = texture2D(uNoise, wp * 0.085);
      vec4 n2 = texture2D(uNoise, wp * 0.019 + 0.37);
      vec4 n3 = texture2D(uNoise, wp * 0.0033 + 0.71);
      float grain = n1.r, blot = n2.g * 0.55 + n3.g * 0.45;
      float e3H = (grain - 0.5) * 0.5;
      float grassTex = 1.0 + (grain - 0.5) * 0.42 + (blot - 0.5) * 0.9;
      float rockTex = 1.0 + (grain - 0.5) * 0.7 + (blot - 0.5) * 0.5 - 0.5 * n2.b - 0.25 * n1.b;
      vec3 e3col = vColor * mix(grassTex, rockTex, vMat.x);
      float e3emi = 0.0;
    `;
    if (key === 'canyon') {
      body += `
      float yb = vWP.y * 0.27 + n3.g * 2.2 + n2.g * 0.45 + n1.g * 0.05;
      float b1 = sin(yb * 2.7) * 0.5 + 0.5, b2 = sin(yb * 8.5 + 1.7) * 0.5 + 0.5, b3 = sin(yb * 21.0 + n2.g * 6.0) * 0.5 + 0.5;
      vec3 bandCol = mix(vec3(0.58, 0.25, 0.15), vec3(0.90, 0.57, 0.36), b1);
      bandCol = mix(bandCol, vec3(0.36, 0.14, 0.10), b2 * 0.42);
      bandCol = pow(bandCol, vec3(2.2));
      bandCol *= 0.88 + 0.22 * b3;
      bandCol *= 0.85 + 0.3 * grain - 0.35 * n2.b;
      e3col = mix(e3col, bandCol, smoothstep(0.1, 0.55, vMat.x));
      `;
    } else if (key === 'snow') {
      body += `
      float spk = step(0.9, texture2D(uNoise, wp * 1.3).r) * step(0.55, texture2D(uNoise, wp * 0.41 + uTime * 0.07).g);
      e3emi = spk * (1.0 - vMat.x) * 0.55;
      e3col = mix(e3col, pow(vec3(0.42, 0.66, 0.84), vec3(2.2)) * (0.85 + 0.3 * n3.g), vMat.y * 0.85);
      `;
    } else if (key === 'alpine') {
      body += `
      e3col *= 1.0 + vMat.y * (n1.a * 0.5 - 0.15);
      `;
    }
    body += '\n diffuseColor.rgb = e3col;\n';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + frag)
      .replace('#include <map_fragment>', body)
      .replace('#include <color_fragment>', '');
    if (hi) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = e3Perturb(-vViewPosition, normal, vec2(dFdx(e3H), dFdy(e3H)) * ' + (key === 'canyon' ? '0.0' : '0.3') + ' * (0.1 + 0.8 * vMat.x));')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + (key === 'snow' ? 'roughnessFactor = mix(roughnessFactor, 0.22, vMat.y);' : ''));
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(e3emi);');
  };
  return mat;
}

// ---------------------------------------------------------------------------
// chunk list (lazy): chunks are tiny containers; content is built on demand
// ---------------------------------------------------------------------------
function e3MakeChunks(G, group) {
  const CL = E3.CL;
  const c0 = Math.floor(G.zmin / CL), c1 = Math.ceil(G.zmax / CL);
  const chunks = [];
  for (let c = c0; c < c1; c++) {
    const cg = new THREE.Group();
    cg.visible = false;
    group.add(cg);
    chunks.push({ c, z0: c * CL, z1: (c + 1) * CL, group: cg, phase: 0, ready: false, dist: 1e9, builders: null, veg: null, T: null });
  }
  return chunks;
}

// terrain mesh for one chunk. keeps local arrays (heights/normals) for the sampler used by props
function* e3TerrainChunk(ctx, ch) {
  const G = ctx.G, tk = G.track, NC = G.NC, LAT = G.LAT, ROW = E3.ROW;
  const rpc = E3.CL / ROW;
  const nrows = rpc + 3;                 // local rows k = 0..rpc+2  <-> r = k-1 = -1..rpc+1
  const P = new Float32Array(nrows * NC * 3), Nn = new Float32Array(nrows * NC * 3);
  const Rr = new Float32Array(nrows), Cx = new Float32Array(nrows);
  for (let k = 0; k < nrows; k++) {
    if (e3tick()) yield;
    const z = ch.z0 + (k - 1) * ROW;
    const cx = tk.getCurveXAt(z), R = tk.getHeightAt(z);
    Rr[k] = R; Cx[k] = cx;
    const sf = G.stationFlat(z);
    for (let j = 0; j < NC; j++) {
      const s = LAT[j], x = cx + s, a = Math.abs(s);
      const Gn = G.natural(x, z, s, a, R, sf);
      const h = G.finalH(Gn, a, R, z, s);
      const o = (k * NC + j) * 3;
      P[o] = x; P[o + 1] = h; P[o + 2] = z;
    }
  }
  for (let k = 1; k < nrows - 1; k++) {
    if (e3tick()) yield;
    for (let j = 0; j < NC; j++) {
      const ja = j > 0 ? j - 1 : j, jb = j < NC - 1 ? j + 1 : j;
      const oa = (k * NC + ja) * 3, ob = (k * NC + jb) * 3, oc = ((k - 1) * NC + j) * 3, od = ((k + 1) * NC + j) * 3;
      const dxx = P[ob] - P[oa], dxy = P[ob + 1] - P[oa + 1], dxz = P[ob + 2] - P[oa + 2];
      const dzx = P[od] - P[oc], dzy = P[od + 1] - P[oc + 1], dzz = P[od + 2] - P[oc + 2];
      const nx = dzy * dxz - dzz * dxy, ny = dzz * dxx - dzx * dxz, nzv = dzx * dxy - dzy * dxx;
      const l = Math.hypot(nx, ny, nzv) || 1;
      const o = (k * NC + j) * 3;
      Nn[o] = nx / l; Nn[o + 1] = ny / l; Nn[o + 2] = nzv / l;
    }
  }
  const nv = (rpc + 1) * NC;
  const gp = new Float32Array(nv * 3), gn = new Float32Array(nv * 3), gc = new Float32Array(nv * 3), gm = new Float32Array(nv * 2), gu = new Float32Array(nv * 2);
  const out = [0, 0, 0, 0, 0];
  for (let r = 0; r <= rpc; r++) {
    if (e3tick()) yield;
    const k = r + 1, z = ch.z0 + r * ROW;
    for (let j = 0; j < NC; j++) {
      const o = (k * NC + j) * 3, v = r * NC + j;
      gp[v * 3] = P[o]; gp[v * 3 + 1] = P[o + 1]; gp[v * 3 + 2] = P[o + 2];
      gn[v * 3] = Nn[o]; gn[v * 3 + 1] = Nn[o + 1]; gn[v * 3 + 2] = Nn[o + 2];
      const s = LAT[j];
      e3TerrainColor(G, P[o], z, P[o + 1], Nn[o + 1], Math.abs(s), s, Rr[k], out);
      gc[v * 3] = e3lin(out[0]); gc[v * 3 + 1] = e3lin(out[1]); gc[v * 3 + 2] = e3lin(out[2]);
      gm[v * 2] = out[3]; gm[v * 2 + 1] = out[4];
    }
  }
  const ncol = NC - 1;
  const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(rpc * ncol * 6);
  let q = 0;
  for (let r = 0; r < rpc; r++) for (let j = 0; j < ncol; j++) {
    const a = r * NC + j, b = a + 1, cc = a + NC, d = cc + 1;
    idx[q++] = a; idx[q++] = cc; idx[q++] = b; idx[q++] = b; idx[q++] = cc; idx[q++] = d;
  }
  const geo = ctx.own.geo(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(gn, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  geo.setAttribute('aMat', new THREE.BufferAttribute(gm, 2));
  geo.setAttribute('uv', new THREE.BufferAttribute(gu, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, ctx.terrMat);
  mesh.receiveShadow = ctx.hi;
  mesh.matrixAutoUpdate = false;
  ch.group.add(mesh);
  ch.mesh = mesh;
  ch.recv = [mesh];
  ch.T = { P, Nn, Cx, Rr, NC, nrows };
}

// ============================================================================
// [p05_sky]
// ============================================================================
// p05: sky dome (gradient + sun + shader clouds + stars), themed IBL, lights
// ============================================================================

function e3SunDir(T) {
  const az = T.sun.az * Math.PI / 180, el = T.sun.el * Math.PI / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

function e3SkyMaterial(T, noiseTex, hi) {
  const S = T.sky, c = (a) => new THREE.Color(a[0], a[1], a[2]);   // sky is authored & output in display space (so it matches the fog colour exactly)
  const sd = e3SunDir(T);
  const sunCol = new THREE.Color(T.sun.color[0], T.sun.color[1], T.sun.color[2]);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false, defines: hi ? {} : { LOWQ: 1 },
    uniforms: {
      uTop: { value: c(S.top) }, uMid: { value: c(S.mid) }, uHorizon: { value: c(S.horizon) }, uHorizonSun: { value: c(S.horizonSun) }, uGround: { value: c(S.ground) },
      uSunCol: { value: sunCol }, uSunDir: { value: sd }, uSunSize: { value: S.sunSize }, uSunDisc: { value: S.sunDisc }, uSunGlow: { value: S.sunGlow },
      uCloudAmt: { value: hi ? S.cloud.amt : S.cloud.amt * 0.9 }, uCloudCol: { value: c(S.cloud.col) }, uCloudShade: { value: c(S.cloud.shade) },
      uCloudScale: { value: S.cloud.scale }, uStars: { value: S.stars }, uTime: { value: 0 }, uGamma: { value: 1.0 }, uWind: { value: new THREE.Vector2(0, 0) },
      uNoise: { value: noiseTex }
    },
    vertexShader: `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uTop, uMid, uHorizon, uHorizonSun, uGround, uSunCol, uSunDir, uCloudCol, uCloudShade;
      uniform float uSunSize, uSunDisc, uSunGlow, uCloudAmt, uCloudScale, uStars, uTime, uGamma;
      uniform vec2 uWind;
      uniform sampler2D uNoise;
      float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec2 dxz = normalize(d.xz + vec2(1e-5));
        vec2 sxz = normalize(uSunDir.xz + vec2(1e-5));
        float az = dot(dxz, sxz) * 0.5 + 0.5;
        float sunAz = pow(az, 2.6);
        vec3 hor = mix(uHorizon, uHorizonSun, sunAz);
        float t1 = pow(clamp(h, 0.0, 1.0), 0.5);
        vec3 col = mix(hor, uMid, smoothstep(0.0, 0.34, t1));
        col = mix(col, uTop, smoothstep(0.30, 0.98, t1));
        // warm band hugging the horizon near the sun
        col += uHorizonSun * 0.10 * sunAz * (1.0 - smoothstep(0.0, 0.22, h)) * (uSunGlow);
        col = mix(col, uGround, smoothstep(0.0, -0.10, h));
        float sdot = max(dot(d, uSunDir), 0.0);
        float ang = acos(clamp(sdot, 0.0, 1.0));
        float disc = 1.0 - smoothstep(uSunSize * 0.92, uSunSize * 1.05, ang);
        float glow = pow(sdot, 260.0) * 0.9 + pow(sdot, 40.0) * 0.11 + pow(sdot, 7.0) * 0.022;
        // clouds on a virtual plane
        float cl = 0.0; vec3 ccol = vec3(0.0);
        if (h > 0.0 && uCloudAmt > 0.0) {
          vec2 cp = d.xz / (h + 0.10) * 0.34 * uCloudScale + uWind;
#ifdef LOWQ
          float n = texture2D(uNoise, cp * 0.55).g * 0.62 + texture2D(uNoise, cp * 1.9 + 0.31).g * 0.38;
#else
          float n = texture2D(uNoise, cp * 0.55).g * 0.52 + texture2D(uNoise, cp * 1.37 + 0.31).g * 0.30 + texture2D(uNoise, cp * 3.1 + 0.77).r * 0.18;
#endif
          float th = 0.74 - uCloudAmt * 0.34;
          cl = smoothstep(th, th + 0.17, n) * smoothstep(0.012, 0.20, h);
#ifdef LOWQ
          float lit = clamp((n - 0.5) * 3.0 + 0.55 + dot(dxz, sxz) * 0.15, 0.0, 1.0);
#else
          vec2 sp = cp - sxz * 0.055;
          float n2 = texture2D(uNoise, sp * 0.55).g * 0.52 + 0.24;
          float lit = clamp((n - n2) * 5.5 + 0.55, 0.0, 1.0);
#endif
          ccol = mix(uCloudShade, uCloudCol, lit);
          ccol += uSunCol * pow(sdot, 10.0) * 0.28 * (0.4 + 0.6 * lit);
          ccol = mix(ccol, hor * 1.05, (1.0 - smoothstep(0.0, 0.26, h)) * 0.55);
        }
        // stars
#ifndef LOWQ
        if (uStars > 0.0 && h > 0.02) {
          vec2 g = vec2(atan(d.z, d.x) * 57.2958, asin(clamp(h, -1.0, 1.0)) * 57.2958) * 1.15;
          vec2 id = floor(g); vec2 f = fract(g) - 0.5;
          float r = hash21(id);
          float on = step(0.985, r);
          vec2 off = vec2(hash21(id + 7.1), hash21(id + 3.7)) - 0.5;
          float s = on * smoothstep(0.22, 0.0, length(f - off * 0.5)) * (0.5 + 0.5 * sin(uTime * (1.0 + r * 3.0) + r * 40.0));
          col += vec3(0.8, 0.88, 1.0) * s * uStars * smoothstep(0.02, 0.25, h) * (1.0 - cl);
        }
#endif
        col += uSunCol * (disc * uSunDisc + glow * uSunGlow) * (1.0 - cl * 0.82);
        col = mix(col, ccol, cl * 0.92);
        gl_FragColor = vec4(pow(max(col, vec3(0.0)), vec3(uGamma)), 1.0);
      }`
  });
  return m;
}

// sky gradient (display space, no clouds) - JS twin of the sky shader, used to paint the IBL dome with plain vertex colours
function e3SkyColorAt(T, dx, dy, dz) {
  const S = T.sky, sd = e3SunDir(T);
  const dl = Math.hypot(dx, dz) || 1e-5, sl = Math.hypot(sd.x, sd.z) || 1e-5;
  const az = ((dx / dl) * (sd.x / sl) + (dz / dl) * (sd.z / sl)) * 0.5 + 0.5, sunAz = Math.pow(e3clamp(az, 0, 1), 2.6);
  const hor = e3mix3(S.horizon, S.horizonSun, sunAz);
  const t1 = Math.sqrt(e3clamp(dy, 0, 1));
  let col = e3mix3(hor, S.mid, e3smooth(0, 0.34, t1));
  col = e3mix3(col, S.top, e3smooth(0.30, 0.98, t1));
  const w = 0.10 * sunAz * (1 - e3smooth(0, 0.22, dy)) * S.sunGlow;
  col = [col[0] + S.horizonSun[0] * w, col[1] + S.horizonSun[1] * w, col[2] + S.horizonSun[2] * w];
  return e3mix3(col, S.ground, e3smooth(0, -0.10, dy));
}

// themed image-based lighting, cached per theme.
// Built ONLY from built-in MeshBasic materials (they write the RGBE target correctly - a custom ShaderMaterial without
// <encodings_fragment> wrote raw values into the RGBE texture and produced ~1e37 radiance => black world in the real game),
// then read back into a plain DataTexture (CubeUV/RGBE) so it does not depend on any render target or WebGL context.
function e3Environment(renderer, T, noiseTex) {
  const C = E3.cache.env;
  if (C[T.key]) return C[T.key];
  const scene = new THREE.Scene();
  const tmp = [];
  const R = 90;
  // sky dome painted with vertex colours
  const sg = new THREE.SphereGeometry(R, 32, 24);
  const p = sg.attributes.position, cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / R, y = p.getY(i) / R, z = p.getZ(i) / R;
    const c = e3SkyColorAt(T, x, y, z);
    cols[i * 3] = e3lin(c[0]); cols[i * 3 + 1] = e3lin(c[1]); cols[i * 3 + 2] = e3lin(c[2]);
  }
  sg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const sm = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
  scene.add(new THREE.Mesh(sg, sm)); tmp.push(sg, sm);
  // sun / moon disc (HDR) so the wet road, rails and cars pick up a sharp glint
  const sd = e3SunDir(T);
  const sunCol = new THREE.Color(T.sun.color[0], T.sun.color[1], T.sun.color[2]).multiplyScalar(T.sky.sunDisc * 0.7);
  const cg = new THREE.CircleGeometry(R * 0.06, 20), cm = new THREE.MeshBasicMaterial({ color: sunCol, side: THREE.DoubleSide, fog: false });
  const disc = new THREE.Mesh(cg, cm); disc.position.copy(sd).multiplyScalar(R * 0.9); disc.lookAt(0, 0, 0); scene.add(disc); tmp.push(cg, cm);
  const gcol = T.sky.ground;
  const gg = new THREE.CircleGeometry(R * 0.95, 24), gm = new THREE.MeshBasicMaterial({ color: e3Color([gcol[0] * 0.55, gcol[1] * 0.55, gcol[2] * 0.55]), fog: false });
  const ground = new THREE.Mesh(gg, gm); ground.rotation.x = -Math.PI / 2; ground.position.y = -1; scene.add(ground); tmp.push(gg, gm);
  if (T.key === 'city') {
    const rnd = e3rng(99);
    const g = new THREE.PlaneGeometry(1, 1);
    const lc = [[1.9, 1.5, 0.95], [1.5, 1.8, 2.0], [1.8, 0.6, 1.3], [2.0, 0.95, 0.35], [1.3, 1.45, 1.9]];
    const mats = lc.map(c => new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]), side: THREE.DoubleSide, fog: false }));
    for (let i = 0; i < 110; i++) {
      const a = rnd() * E3.PI2, r = 62 + rnd() * 22;
      const m = new THREE.Mesh(g, mats[Math.floor(rnd() * mats.length)]);
      m.position.set(Math.cos(a) * r, 2 + rnd() * rnd() * 34, Math.sin(a) * r);
      m.scale.set(1.5 + rnd() * 5, 0.8 + rnd() * 2, 1);
      m.lookAt(0, m.position.y, 0);
      scene.add(m);
    }
    for (let i = 0; i < 8; i++) [-1, 1].forEach(s => {
      const m = new THREE.Mesh(g, mats[0]);
      m.position.set(s * 9, 6, 12 + i * 9); m.scale.set(0.9, 0.5, 1); m.lookAt(0, 6, 0); scene.add(m);
    });
    tmp.push(g, ...mats);
  }
  let tex = null;
  try {
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(scene, 0.03);
    const w = rt.width, h = rt.height, buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    tex = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.mapping = THREE.CubeUVReflectionMapping; tex.encoding = THREE.RGBEEncoding;
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.flipY = false; tex.name = 'env3d_' + T.key; tex.needsUpdate = true;
    pm.dispose(); rt.dispose();
  } catch (e) { console.warn('[env3d] IBL bake failed, world uses direct lights only', e); }
  tmp.forEach(o => o.dispose());
  C[T.key] = { tex };
  return C[T.key];
}

// ---------------------------------------------------------------------------
// lights: hemisphere + sun/moon (shadow follows the player, texel-snapped)
// ---------------------------------------------------------------------------
function e3Lights(T, hi, group, own) {
  const hemi = new THREE.HemisphereLight(new THREE.Color(...T.hemi.sky), new THREE.Color(...T.hemi.ground), T.hemi.I);
  hemi.position.set(0, 250, 0);
  group.add(hemi);
  const sunDir = e3SunDir(T);
  const sun = new THREE.DirectionalLight(new THREE.Color(...T.sun.color), T.sun.I);
  const EXT = 56, DIST = 260;
  sun.castShadow = !!hi;
  if (hi) {
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -EXT; cam.right = EXT; cam.top = EXT; cam.bottom = -EXT; cam.near = 10; cam.far = DIST + 300;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.35;
    sun.shadow.radius = 2;
    cam.updateProjectionMatrix();
    if (E3.cache.shadowMap) sun.shadow.map = E3.cache.shadowMap;   // r128 leaks a GL texture per new shadow map: reuse one for the page lifetime
  }
  group.add(sun); group.add(sun.target);
  const lx = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
  const ly = new THREE.Vector3().crossVectors(sunDir, lx).normalize();
  const c = new THREE.Vector3();
  const texel = (2 * EXT) / 2048;
  const place = (focus) => {
    c.set(focus.x, focus.y, focus.z + 26);
    const px = Math.round(c.dot(lx) / texel) * texel, py = Math.round(c.dot(ly) / texel) * texel, pz = c.dot(sunDir);
    c.set(0, 0, 0).addScaledVector(lx, px).addScaledVector(ly, py).addScaledVector(sunDir, pz);
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(sunDir, DIST);
    sun.target.updateMatrixWorld();
  };
  place(new THREE.Vector3(0, 0, 60));
  const dispose = () => { if (sun.shadow && sun.shadow.map) { E3.cache.shadowMap = sun.shadow.map; sun.shadow.map = null; } if (sun.dispose) sun.dispose(); hemi.dispose && hemi.dispose(); };
  return { hemi, sun, sunDir, place, dispose };
}

// ============================================================================
// [p06_road]
// ============================================================================
// p06: road ribbon (exact track sampling), deck/piers (bridges & viaduct),
//      W-beam guard rails / jersey barriers, per-chunk merged meshes
// ============================================================================

function e3MakeMaterials(T, hi, roadTex, own, env) {
  const ibl = (T.env && T.env.ibl) || 0.5;
  const M = {};
  if (hi) {
    M.road = own.mat(new THREE.MeshStandardMaterial({ map: roadTex.map, roughnessMap: roadTex.rough, roughness: T.road.roughness, metalness: 0.0, vertexColors: true, envMapIntensity: T.key === 'city' ? 0.5 : 0.8 }));
    M.road.customProgramCacheKey = () => 'e3road';
    M.road.onBeforeCompile = shader => {
      shader.uniforms.uNoise = { value: e3NoiseTex() };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          { vec2 wm = vec2(vUv.x * 22.0, vUv.y * 44.0);
            float g1 = texture2D(uNoise, wm * 0.42).r, g2 = texture2D(uNoise, wm * 1.7 + 0.37).r;
            float fadeG = 1.0 - smoothstep(25.0, 80.0, length(vViewPosition));
            diffuseColor.rgb *= 1.0 + (g1 - 0.5) * 0.55 * fadeG + (g2 - 0.5) * 0.35 * fadeG; }`);
    };
    M.concrete = own.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: ibl * 0.5 }));
    M.steel = own.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.72, envMapIntensity: 1.1, side: THREE.DoubleSide }));
    M.sign = own.mat(new THREE.MeshStandardMaterial({ map: e3SignAtlas(), roughness: 0.55, metalness: 0.1, vertexColors: true, emissive: 0xffffff, emissiveMap: e3SignAtlas(), emissiveIntensity: T.key === 'city' ? 0.5 : 0.04, side: THREE.DoubleSide, envMapIntensity: 0.3 }));
    M.misc = own.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, envMapIntensity: ibl * 0.5, side: THREE.DoubleSide }));
  } else {
    M.road = own.mat(new THREE.MeshLambertMaterial({ map: roadTex.map, vertexColors: true }));
    M.concrete = own.mat(new THREE.MeshLambertMaterial({ vertexColors: true }));
    M.steel = own.mat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    M.sign = own.mat(new THREE.MeshLambertMaterial({ map: e3SignAtlas(), vertexColors: true, side: THREE.DoubleSide, emissive: T.key === 'city' ? 0x444444 : 0x000000 }));
    M.misc = own.mat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  }
  M.glow = own.mat(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  M.pool = own.mat(new THREE.MeshBasicMaterial({ map: e3poolTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  M.streak = own.mat(new THREE.MeshBasicMaterial({ map: e3streakTex(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  [M.pool, M.streak].forEach(m => { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; });
  return M;
}

// per-chunk containers for merged geometry builders
function e3ChunkBuilders() { return { concrete: new E3Geo(), steel: new E3Geo(), glow: new E3Geo(false), sign: new E3Geo(), misc: new E3Geo(), pool: new E3Geo(false), streak: new E3Geo(false) }; }

const E3_PROFILES = {
  wbeam: [[0, 0.155], [0.040, 0.105], [0.045, 0.040], [0.0, 0.0], [0.045, -0.040], [0.040, -0.105], [0, -0.155]].reverse().map(p => [p[0], p[1]]),
  // inner base -> top -> outer base
  jersey: [[-0.30, 0.0], [-0.17, 0.25], [-0.105, 0.88], [0.105, 0.88], [0.17, 0.25], [0.30, 0.0]]
};

function* e3RoadChunk(ctx, ch) {
  const { G, own, hi, T, M } = ctx;
  const tk = G.track, RW = G.RW;
  const STEP = E3.ROAD_STEP;
  const kind = T.road.kind;
  const rail = T.road.rail;
  const concCol = (z, k) => { const h = 0.9 + 0.08 * Math.sin(z * 0.37 + k) + 0.04 * Math.sin(z * 1.9); return [0.60 * h, 0.60 * h, 0.58 * h]; };
  const noiseA = G.n2;
  const pierEvery = T.key === 'city' ? 30 : 24;
  const stationNear = (z, d) => { for (let i = 0; i < G.stz.length; i++) if (Math.abs(z - G.stz[i]) < d) return true; return false; };

  {
    const B = ch.builders;
    const z0 = ch.z0, z1 = ch.z1;
    // ---- road top ribbon + skirts/underside ----
    const nRows = Math.round((z1 - z0) / STEP) + 1;
    const pos = new Float32Array(nRows * 2 * 3), nor = new Float32Array(nRows * 2 * 3), uv = new Float32Array(nRows * 2 * 2), col = new Float32Array(nRows * 2 * 3);
    const idx = [];
    for (let i = 0; i < nRows; i++) {
      if ((i & 7) === 0 && e3tick()) yield;
      const z = z0 + i * STEP;
      const cx = tk.getCurveXAt(z), R = tk.getHeightAt(z);
      const Rp = (tk.getHeightAt(z + 2) - tk.getHeightAt(z - 2)) / 4;
      const nl = Math.hypot(1, Rp);
      const br = 0.93 + 0.1 * noiseA.n(z / 41, 3.3) + 0.05 * noiseA.n(z / 9.7, 1.1);
      for (let s = 0; s < 2; s++) {
        const o = (i * 2 + s);
        pos[o * 3] = cx + (s === 0 ? -RW : RW); pos[o * 3 + 1] = R; pos[o * 3 + 2] = z;
        nor[o * 3] = 0; nor[o * 3 + 1] = 1 / nl; nor[o * 3 + 2] = -Rp / nl;
        uv[o * 2] = s; uv[o * 2 + 1] = z / 44;
        col[o * 3] = col[o * 3 + 1] = col[o * 3 + 2] = br;
      }
      if (i < nRows - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      // skirts / underside
      if (i < nRows - 1) {
        const zb = z + STEP, cxb = tk.getCurveXAt(zb), Rb = tk.getHeightAt(zb);
        const f = Math.max(G.bridgeF(z), G.bridgeF(zb));
        const dA = e3lerp(0.40, 1.45, e3smooth(0.2, 0.55, G.bridgeF(z))), dB = e3lerp(0.40, 1.45, e3smooth(0.2, 0.55, G.bridgeF(zb)));
        const cc = concCol(z, 1);
        for (let side = -1; side <= 1; side += 2) {
          B.concrete.quad([cx + side * RW, R, z], [cx + side * RW, R - dA, z], [cxb + side * RW, Rb - dB, zb], [cxb + side * RW, Rb, zb], cc, null, [side, 0, 0]);
        }
        if (f > 0.2) {
          const uc = [cc[0] * 0.62, cc[1] * 0.62, cc[2] * 0.62];
          B.concrete.quad([cx - RW, R - dA, z], [cx + RW, R - dA, z], [cxb + RW, Rb - dB, zb], [cxb - RW, Rb - dB, zb], uc, null, [0, -1, 0]);
        }
      }
    }
    const rg = own.geo(new THREE.BufferGeometry());
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    rg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); rg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    rg.setIndex(idx); rg.computeBoundingSphere();
    const road = new THREE.Mesh(rg, M.road); road.receiveShadow = true; road.matrixAutoUpdate = false;
    ch.group.add(road);
    ch.road = road;
    ch.recv.push(road);

    // ---- piers (hammerhead) where the road is high above the ground ----
    for (let z = Math.ceil(z0 / pierEvery) * pierEvery; z < z1; z += pierEvery) {
      if (e3tick()) yield;
      const f = G.bridgeF(z);
      if (f < 0.55) continue;
      const cx = tk.getCurveXAt(z), R = tk.getHeightAt(z), hd = tk.getHeadingAt(z);
      const yTop = R - 2.05;
      const yBot = G.H(cx, z) - 1.4;
      if (yTop - yBot < 1.8) continue;
      const cc = concCol(z, 5), P = e3prim();
      const hgt = yTop - yBot;
      // column (tapered look: two stacked sections)
      B.concrete.addT(P.cyl12, cx, yBot + hgt * 0.5, z, 0, hd, 0, 3.0, hgt, 2.5, cc);
      if (hgt > 7) B.concrete.addT(P.box, cx, yBot + 0.9, z, 0, hd, 0, 4.0, 1.8, 3.4, [cc[0] * 0.85, cc[1] * 0.85, cc[2] * 0.85]);
      // cap beam
      B.concrete.addT(P.box, cx, R - 1.75, z, 0, hd, 0, 19.0, 1.1, 2.9, cc);
      // bearing shadow line
      B.concrete.addT(P.box, cx, R - 1.17, z, 0, hd, 0, 21.4, 0.12, 2.5, [cc[0] * 0.5, cc[1] * 0.5, cc[2] * 0.5]);
    }

    // ---- guard rails / barriers ----
    const RS = 4;
    const nr = Math.round((z1 - z0) / RS) + 1;
    const mode = new Array(nr);
    const rows = new Array(nr);
    for (let i = 0; i < nr; i++) {
      const z = z0 + i * RS;
      rows[i] = { z, cx: tk.getCurveXAt(z), R: tk.getHeightAt(z) };
      if (stationNear(z, 47)) mode[i] = 'none';
      else mode[i] = (G.bridgeF(z) > 0.4 || rail === 'jersey') ? 'jersey' : 'wbeam';
    }
    for (let i = 0; i < nr; i++) {
      if ((i & 7) === 0 && e3tick()) yield;
      const A = rows[i];
      const hd = tk.getHeadingAt(A.z);
      // posts / reflectors
      if (mode[i] === 'wbeam') {
        for (let side = -1; side <= 1; side += 2) {
          const lat = RW + 1.0;
          B.steel.addT(e3prim().box, A.cx + side * (lat + 0.09), A.R + 0.40, A.z, 0, hd, 0, 0.10, 0.84, 0.16, [0.52, 0.54, 0.57]);
          B.steel.addT(e3prim().box, A.cx + side * (lat + 0.0), A.R + 0.62, A.z, 0, hd, 0, 0.14, 0.22, 0.12, [0.45, 0.47, 0.50]);   // spacer block
          if (i % 4 === 0) B.glow.addT(e3prim().box, A.cx + side * (lat - 0.055), A.R + 0.78, A.z, 0, hd, 0, 0.03, 0.07, 0.16, side < 0 ? [1.5, 1.15, 0.25] : [1.5, 1.5, 1.4]);
        }
      } else if (mode[i] === 'jersey' && i % 4 === 0 && T.key === 'city') {
        // reflective studs on the barrier top
        for (let side = -1; side <= 1; side += 2) B.glow.addT(e3prim().box, A.cx + side * (RW - 0.05), A.R + 0.9, A.z, 0, hd, 0, 0.2, 0.05, 0.3, side < 0 ? [1.6, 1.2, 0.3] : [1.6, 1.6, 1.6]);
      }
      if (i === nr - 1) break;
      const Bn = rows[i + 1];
      if (mode[i] === 'none' || mode[i] !== mode[i + 1]) continue;
      const m = mode[i];
      const prof = E3_PROFILES[m];
      const lat = m === 'wbeam' ? RW + 0.97 : RW - 0.05;
      const yb = m === 'wbeam' ? 0.64 : 0.0;
      for (let side = -1; side <= 1; side += 2) {
        const joint = (m === 'jersey' && Math.round(A.z / RS) % 1 === 0);
        const cA = m === 'wbeam' ? [0.74, 0.76, 0.78] : (() => { const c = concCol(A.z, 9); return [c[0] * 1.02, c[1] * 1.02, c[2] * 1.02]; })();
        const cB = cA;
        for (let k = 0; k < prof.length - 1; k++) {
          const p0 = prof[k], p1 = prof[k + 1];
          const dd = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dd, dy) || 1;
          const nh = [side * (-dy / l), dd / l, 0];
          const a = [A.cx + side * (lat + p0[0]), A.R + yb + p0[1], A.z], b = [A.cx + side * (lat + p1[0]), A.R + yb + p1[1], A.z];
          const c = [Bn.cx + side * (lat + p1[0]), Bn.R + yb + p1[1], Bn.z], d = [Bn.cx + side * (lat + p0[0]), Bn.R + yb + p0[1], Bn.z];
          (m === 'wbeam' ? B.steel : B.concrete).quad(a, b, c, d, k % 2 === 0 || m === 'jersey' ? cA : [cA[0] * 0.88, cA[1] * 0.88, cA[2] * 0.88], null, nh);
        }
        if (m === 'jersey') {   // dark expansion joint at the start of each 4 m element
          const jc = [0.18, 0.18, 0.18];
          B.concrete.quad([A.cx + side * (lat - 0.105), A.R + 0.86, A.z], [A.cx + side * (lat + 0.105), A.R + 0.86, A.z], [A.cx + side * (lat + 0.105), A.R + 0.86, A.z + 0.05], [A.cx + side * (lat - 0.105), A.R + 0.86, A.z + 0.05], jc, null, [0, 1, 0]);
        }
      }
    }
  }
}

// flush one chunk's builders into meshes (called after props are added)
function* e3FlushChunk(ctx, ch) {
  const { M, own, hi } = ctx;
  const B = ch.builders;
  const add = (b, mat, shadow, recv) => {
    if (b.empty) return null;
    const m = new THREE.Mesh(own.geo(b.build()), mat);
    m.castShadow = !!shadow && hi; m.receiveShadow = !!recv && hi; m.matrixAutoUpdate = false;
    ch.group.add(m);
    if (recv && hi) ch.recv.push(m);
    return m;
  };
  add(B.concrete, M.concrete, true, true); if (e3tick()) yield;
  add(B.steel, M.steel, true, false); if (e3tick()) yield;
  add(B.misc, M.misc, true, true); if (e3tick()) yield;
  add(B.glow, M.glow, false, false);
  add(B.sign, M.sign, true, false); if (e3tick()) yield;
  const p = add(B.pool, M.pool, false, false); if (p) p.renderOrder = 2;
  const s2 = add(B.streak, M.streak, false, false); if (s2) s2.renderOrder = 2;
  if (B.extra) B.extra.forEach(f => f(ch));
  ch.builders = null;
}

// ============================================================================
// [p07_props]
// ============================================================================
// p07: vegetation (instanced, chunked, 2 LODs), rocks, cacti, roadside props
// ============================================================================

function e3Sampler(ch, G) {
  const { P, Nn, NC, nrows, Cx } = ch.T, LAT = G.LAT, ROW = E3.ROW, z0 = ch.z0;
  return function (x, z, out) {
    let fi = (z - z0) / ROW + 1;
    let i = Math.floor(fi); if (i < 0) i = 0; if (i > nrows - 2) i = nrows - 2;
    const ti = e3clamp(fi - i, 0, 1);
    const s = x - (Cx[i] + (Cx[i + 1] - Cx[i]) * ti);
    let lo = 0, hi = NC - 1;
    if (s <= LAT[0]) { hi = 1; } else if (s >= LAT[NC - 1]) { lo = NC - 2; } else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (LAT[m] <= s) lo = m; else hi = m; } }
    const tj = e3clamp((s - LAT[lo]) / (LAT[hi] - LAT[lo]), 0, 1);
    const a00 = (i * NC + lo) * 3, a01 = (i * NC + hi) * 3, a10 = ((i + 1) * NC + lo) * 3, a11 = ((i + 1) * NC + hi) * 3;
    const y0 = P[a00 + 1] + (P[a01 + 1] - P[a00 + 1]) * tj, y1 = P[a10 + 1] + (P[a11 + 1] - P[a10 + 1]) * tj;
    out.y = y0 + (y1 - y0) * ti;
    const n0 = Nn[a00 + 1] + (Nn[a01 + 1] - Nn[a00 + 1]) * tj, n1 = Nn[a10 + 1] + (Nn[a11 + 1] - Nn[a10 + 1]) * tj;
    out.ny = n0 + (n1 - n0) * ti;
    out.s = s;
    return out;
  };
}

// ---------------- geometry generators -----------------
function e3ConeLayers(radii, heights, bases, seg, withCap, snowy, colTip, colRim, rnd, uvRepeat) {
  const pos = [], nor = [], col = [], uv = [], idx = [];
  let n = 0;
  const push = (x, y, z, nx, ny, nz, c, u, v) => { pos.push(x, y, z); nor.push(nx, ny, nz); col.push(c[0], c[1], c[2]); uv.push(u, v); return n++; };
  for (let L = 0; L < radii.length; L++) {
    const R = radii[L], H = heights[L], y0 = bases[L];
    const ring = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * E3.PI2, rr = R * (k % 2 === 0 ? 1.0 : 0.76) * (0.94 + 0.12 * rnd());
      ring.push([Math.cos(a) * rr, y0 + (k % 2 === 0 ? 0 : 0.12) + 0.1 * (rnd() - 0.5), Math.sin(a) * rr, a]);
    }
    const apexY = y0 + H;
    const cr = colRim.map(v => v * (0.85 + 0.3 * rnd()));
    const apexIdx = [];
    const midRing = [];
    if (snowy) {
      for (let k = 0; k < seg; k++) { const p = ring[k]; midRing.push([p[0] * 0.5, y0 + H * 0.5, p[2] * 0.5, p[3]]); }
    }
    for (let k = 0; k < seg; k++) {
      const p = ring[k], q = ring[(k + 1) % seg];
      const aIdx = push(0, apexY, 0, 0, 1, 0, colTip, (k + 0.5) / seg * uvRepeat, 1 * uvRepeat);
      const mk = (pp) => { const l = Math.hypot(pp[0], pp[2]) || 1; return [pp[0] / l * 0.82, 0.58, pp[2] / l * 0.82]; };
      if (!snowy) {
        const np = mk(p), nq = mk(q);
        const ia = push(p[0], p[1], p[2], np[0], np[1], np[2], cr, k / seg * uvRepeat, 0);
        const ib = push(q[0], q[1], q[2], nq[0], nq[1], nq[2], cr, (k + 1) / seg * uvRepeat, 0);
        idx.push(aIdx, ib, ia);
      } else {
        const mp = midRing[k], mq = midRing[(k + 1) % seg];
        const snow = [0.93, 0.96, 1.0], snow2 = [0.78, 0.86, 0.80];
        const np = mk(p), nq = mk(q);
        const ma = push(mp[0], mp[1], mp[2], np[0], np[1], np[2], snow, k / seg * uvRepeat, 0.5 * uvRepeat);
        const mb = push(mq[0], mq[1], mq[2], nq[0], nq[1], nq[2], snow, (k + 1) / seg * uvRepeat, 0.5 * uvRepeat);
        idx.push(aIdx, mb, ma);
        const ia = push(p[0], p[1], p[2], np[0], np[1], np[2], cr, k / seg * uvRepeat, 0), ib = push(q[0], q[1], q[2], nq[0], nq[1], nq[2], cr, (k + 1) / seg * uvRepeat, 0);
        const ma2 = push(mp[0], mp[1], mp[2], np[0], np[1], np[2], snow2, k / seg * uvRepeat, 0.5 * uvRepeat), mb2 = push(mq[0], mq[1], mq[2], nq[0], nq[1], nq[2], snow2, (k + 1) / seg * uvRepeat, 0.5 * uvRepeat);
        idx.push(ma2, mb2, ib, ma2, ib, ia);
      }
      if (withCap) {
        const dark = [cr[0] * 0.45, cr[1] * 0.45, cr[2] * 0.45];
        const c0 = push(0, y0 + 0.25, 0, 0, -1, 0, dark, 0, 0), ca = push(p[0], p[1], p[2], 0, -1, 0, dark, 0, 0), cb = push(q[0], q[1], q[2], 0, -1, 0, dark, 0, 0);
        idx.push(c0, ca, cb);
      }
    }
  }
  return { pos, nor, col, uv, idx, n };
}
function e3MakeGeo(parts) {
  let pos = [], nor = [], col = [], uv = [], idx = [], n = 0;
  parts.forEach(p => { p.idx.forEach(i => idx.push(i + n)); pos = pos.concat(p.pos); nor = nor.concat(p.nor); col = col.concat(p.col); uv = uv.concat(p.uv); n += p.n; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}
function e3TrunkPart(rb, rt, h, seg, c, y0) {
  const pos = [], nor = [], col = [], uv = [], idx = [];
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * E3.PI2, cs = Math.cos(a), sn = Math.sin(a);
    pos.push(cs * rb, y0, sn * rb, cs * rt, y0 + h, sn * rt); nor.push(cs, 0.1, sn, cs, 0.1, sn); col.push(c[0], c[1], c[2], c[0] * 0.8, c[1] * 0.8, c[2] * 0.8); uv.push(k / seg, 0, k / seg, 1);
    if (k < seg) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
  }
  return { pos, nor, col, uv, idx, n: (seg + 1) * 2 };
}
function e3PineGeos(T, hi) {
  const rnd = e3rng(31337);
  const snowy = T.key === 'snow';
  const tip = snowy ? [0.20, 0.34, 0.24] : [0.15, 0.30, 0.14], rim = snowy ? [0.07, 0.17, 0.12] : [0.06, 0.16, 0.08];
  const trunk = [0.22, 0.16, 0.11];
  const radii0 = [2.5, 2.1, 1.7, 1.3, 0.95, 0.55], heights0 = [2.4, 2.1, 1.9, 1.7, 1.5, 1.4], bases0 = [1.3, 2.7, 4.0, 5.2, 6.3, 7.3];
  const hiG = e3MakeGeo([e3TrunkPart(0.26, 0.12, 5.5, 6, trunk, -0.2), e3ConeLayers(radii0, heights0, bases0, hi ? 10 : 8, true, snowy, tip, rim, rnd, 3)]);
  const lo = e3MakeGeo([e3TrunkPart(0.3, 0.2, 2.2, 5, trunk, -0.2), e3ConeLayers([2.7, 1.9, 1.1], [3.8, 3.4, 3.0], [1.4, 3.7, 5.9], 7, true, snowy, tip, rim, rnd, 2)]);
  const lo2 = e3MakeGeo([e3ConeLayers([2.8, 2.0, 1.2], [3.9, 3.5, 3.1], [1.4, 3.7, 5.9], 5, false, snowy, tip, rim, rnd, 2)]);
  return { hi: hiG, lo, lo2 };
}
function e3BroadleafGeos(hi) {
  const rnd = e3rng(777);
  const mk = (blobs, segW, segH) => {
    const parts = [e3TrunkPart(0.35, 0.22, 3.4, 6, [0.28, 0.2, 0.14], -0.2)];
    blobs.forEach((b, bi) => {
      const g = new THREE.SphereGeometry(1, segW, segH);
      const p = g.attributes.position, nrm = g.attributes.normal;
      const pos = [], nor = [], col = [], uv = [], idx = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const d = 1 + 0.18 * Math.sin(x * 3 + bi) * Math.cos(z * 2.7 + y * 2) ;
        pos.push(b[0] + x * b[3] * d, b[1] + y * b[3] * 0.82 * d, b[2] + z * b[3] * d);
        const l = Math.hypot(x, y * 1.2, z) || 1; nor.push(x / l, y * 1.2 / l, z / l);
        const t = e3clamp(y * 0.5 + 0.5, 0, 1);
        col.push(0.12 + 0.2 * t, 0.26 + 0.24 * t, 0.07 + 0.08 * t); uv.push(p.getX(i) * 2, p.getY(i) * 2);
      }
      for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i));
      parts.push({ pos, nor, col, uv, idx, n: p.count });
      g.dispose();
    });
    return e3MakeGeo(parts);
  };
  const hiG = mk([[0, 4.6, 0, 2.3], [1.3, 4.0, 0.5, 1.7], [-1.2, 4.2, -0.6, 1.8], [0.2, 5.8, -0.3, 1.5]], 8, 6);
  const lo = mk([[0, 4.6, 0, 2.9]], 6, 4);
  return { hi: hiG, lo };
}
function e3RockGeo(seed, tint, noise) {
  const g0 = new THREE.IcosahedronGeometry(1, 1);
  const p = g0.attributes.position;
  const rnd = e3rng(seed);
  const ox = rnd() * 50, oy = rnd() * 50;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise.n(x * 1.6 + ox + y * 0.9, z * 1.6 + oy + y * 0.7);
    const r = 1 + 0.32 * n;
    x *= r * 1.15; y *= r * 0.8; z *= r;
    if (y < -0.42) y = -0.42 + (y + 0.42) * 0.1;
    p.setXYZ(i, x, y, z);
  }
  g0.computeVertexNormals();
  const col = [];
  for (let i = 0; i < p.count; i++) { const t = e3clamp(p.getY(i) * 0.6 + 0.55, 0.3, 1.1); const v = 0.8 + 0.25 * noise.n(p.getX(i) * 3 + ox, p.getZ(i) * 3); col.push(tint[0] * t * v, tint[1] * t * v, tint[2] * t * v); }
  g0.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g0;
}
function e3CactusGeo() {
  const rnd = e3rng(2020);
  const parts = [];
  const cyl = (x, y, z, r, h, rx, rz, seg, c) => {
    const g = new THREE.CylinderGeometry(r * 0.88, r, h, seg, 1, false);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    const p = g.attributes.position, n = g.attributes.normal, pos = [], nor = [], col = [], uv = [], idx = [];
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const rib = 0.82 + 0.18 * Math.sin(Math.atan2(g.attributes.uv.getX(i) * 6.28, 1) * 0 + g.attributes.uv.getX(i) * 6.28 * seg);
      col.push(c[0] * rib, c[1] * rib, c[2] * rib); uv.push(g.attributes.uv.getX(i), g.attributes.uv.getY(i));
    }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i));
    parts.push({ pos, nor, col, uv, idx, n: p.count });
    g.dispose();
  };
  const sph = (x, y, z, r, c) => {
    const g = new THREE.SphereGeometry(r, 8, 5, 0, E3.PI2, 0, Math.PI / 2); g.translate(x, y, z);
    const p = g.attributes.position, n = g.attributes.normal, pos = [], nor = [], col = [], uv = [], idx = [];
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(c[0], c[1], c[2]); uv.push(0, 0); }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i));
    parts.push({ pos, nor, col, uv, idx, n: p.count }); g.dispose();
  };
  const C = [0.30, 0.50, 0.26];
  cyl(0, 2.3, 0, 0.42, 4.6, 0, 0, 10, C); sph(0, 4.6, 0, 0.37, C);
  cyl(0.85, 2.25, 0, 0.26, 1.5, 0, Math.PI / 2, 8, C); cyl(1.55, 3.05, 0, 0.27, 1.9, 0, 0, 8, C); sph(1.55, 4.0, 0, 0.25, C);
  cyl(-0.8, 1.55, 0, 0.24, 1.3, 0, Math.PI / 2, 8, C); cyl(-1.4, 2.35, 0, 0.25, 1.6, 0, 0, 8, C); sph(-1.4, 3.15, 0, 0.23, C);
  return e3MakeGeo(parts);
}
function e3BushGeo(tint, rnd) {
  const g = new THREE.SphereGeometry(1, 6, 4);
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), d = 1 + 0.25 * Math.sin(x * 5 + z * 3.3);
    p.setXYZ(i, x * d, Math.max(y, -0.2) * d, z * d);
    const t = e3clamp(y * 0.5 + 0.7, 0.55, 1.2);
    col.push(tint[0] * t, tint[1] * t, tint[2] * t);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------- instancing helpers -----------------
function e3Instanced(geo, mat, list, own, opts) {
  opts = opts || {};
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  m.count = list.length;
  const d = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    d.position.set(it.x, it.y, it.z);
    d.rotation.set(it.tx || 0, it.ry || 0, it.tz || 0);
    d.scale.set(it.sx, it.sy, it.sz === undefined ? it.sx : it.sz);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
    c.setRGB(it.cr === undefined ? 1 : it.cr, it.cg === undefined ? 1 : it.cg, it.cb === undefined ? 1 : it.cb);
    m.setColorAt(i, c);
  }
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.frustumCulled = false;
  m.castShadow = false; m.receiveShadow = false;
  return m;
}

// ---------------- props: shared setup (once per build) -----------------
function e3PropsInit(ctx) {
  const { track, T, G, own, hi } = ctx;
  const S = ctx.S = { adders: {} };
  S.noise = new E3Noise(e3strHash(track.config.id + '_rock'));
  S.dens = T.treeDensity * (hi ? 1 : 0.55);
  S.treeMat = own.mat(new THREE.MeshLambertMaterial({ vertexColors: true, map: e3FoliageTex() }));
  S.rockMat = hi
    ? own.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, envMapIntensity: 0.9 }))
    : own.mat(new THREE.MeshLambertMaterial({ vertexColors: true }));
  S.bushMat = own.mat(new THREE.MeshLambertMaterial({ vertexColors: true }));
  S.shadowMat = own.mat(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  const lin = g => { const c = g.attributes.color; for (let i = 0; i < c.count; i++) c.setXYZ(i, e3lin(c.getX(i)), e3lin(c.getY(i)), e3lin(c.getZ(i))); return g; };
  S.pine = S.broad = S.cactus = S.bush = S.bush2 = null; S.rocks = [];
  if (T.key === 'alpine' || T.key === 'snow') {
    const pg = e3PineGeos(T, hi); S.pine = { hi: own.geo(lin(pg.hi)), lo: own.geo(lin(pg.lo)), lo2: own.geo(lin(pg.lo2)) };
    if (T.key === 'alpine') { const bg = e3BroadleafGeos(hi); S.broad = { hi: own.geo(lin(bg.hi)), lo: own.geo(lin(bg.lo)) }; }
    S.bush = own.geo(lin(e3BushGeo(T.key === 'snow' ? [0.62, 0.72, 0.68] : [0.28, 0.44, 0.16])));
  }
  const rockTint = T.key === 'canyon' ? [0.88, 0.52, 0.34] : T.key === 'snow' ? [0.40, 0.41, 0.46] : [0.52, 0.49, 0.44];
  if (T.key !== 'city') S.rocks = [own.geo(lin(e3RockGeo(11, rockTint, S.noise))), own.geo(lin(e3RockGeo(29, rockTint, S.noise)))];
  if (T.key === 'canyon') { S.cactus = own.geo(lin(e3CactusGeo())); S.bush = own.geo(lin(e3BushGeo([0.52, 0.44, 0.22]))); S.bush2 = own.geo(lin(e3BushGeo([0.62, 0.40, 0.22]))); }

  const stationNear = (z, d) => { for (let i = 0; i < G.stz.length; i++) if (Math.abs(z - G.stz[i]) < d) return true; return false; };
  const nearFeature = (z, d) => { if (stationNear(z, d)) return true; for (const r of track.ramps) if (Math.abs(r.z - z) < d * 0.4) return true; return false; };
  S.stationNear = stationNear; S.nearFeature = nearFeature;

  // ================= roadside props (closures run when the chunk is built) =================
  const P = e3prim();
  const addAt = (z, fn) => { const ci = Math.floor(z / E3.CL); (S.adders[ci] = S.adders[ci] || []).push(fn); };
  const heading = z => track.getHeadingAt(z);
  const RW = G.RW;
  const atlasCell = k => { const u0 = (k % 4) / 4, v1 = 1 - Math.floor(k / 4) * 0.5; return [u0, v1 - 0.5, u0 + 0.25, v1]; };
  const kmCell = k => { const u0 = (k % 8) / 8, v1 = 1 - Math.floor(k / 8) * 0.25; return [u0, v1 - 0.25, u0 + 0.125, v1]; };
  const white = [1, 1, 1];
  const board = (B, x, y, z, w, h, hd, uvr, flipU) => {
    const rx = -Math.cos(hd), rz = Math.sin(hd), hw = w / 2;
    const bl = [x - rx * hw, y, z - rz * hw], br = [x + rx * hw, y, z + rz * hw], tr = [x + rx * hw, y + h, z + rz * hw], tl = [x - rx * hw, y + h, z - rz * hw];
    const f = [-Math.sin(hd), 0, -Math.cos(hd)];
    B.sign.quad(bl, br, tr, tl, white, flipU ? [uvr[2], uvr[1], uvr[0], uvr[3]] : uvr, f);
  };
  const post = (B, x, y0, y1, z, hd, w) => { B.steel.addT(P.box, x, (y0 + y1) / 2, z, 0, hd, 0, w || 0.09, y1 - y0, w || 0.09, [0.55, 0.57, 0.6]); };
  const L = track.length;
  const signAt = (z, cell, size, latSign, lat, high) => addAt(z, (ch, B, gy) => {
    const hd = heading(z), cx = track.getCurveXAt(z);
    const x = cx + latSign * lat, y0 = Math.max(gy(x, z), track.getHeightAt(z) - 1.2), top = y0 + (high || 2.5);
    post(B, x, y0 - 0.2, top, z, hd);
    board(B, x, top - size, z - 0.07, size, size, hd, atlasCell(cell));
    B.steel.addT(P.box, x, top - size * 0.5, z + 0.01, 0, hd, 0, size * 0.96, size * 0.96, 0.03, [0.45, 0.47, 0.5]);
  });
  const speedZ = [[420, 0], [Math.round(L * 0.24) - 650, 2], [Math.round(L * 0.45) - 650, 2], [Math.round(L * 0.53), 1], [Math.round(L * 0.65) - 650, 2], [Math.round(L * 0.82) - 650, 2], [Math.round(L * 0.92), 0]];
  speedZ.forEach(([z, cell]) => { if (!stationNear(z, 90) && !nearFeature(z, 60)) signAt(z, cell, 1.0, -1, RW + 2.8, 2.4); });
  // bends: warning sign + chevrons on the outside
  const curv = z => (track.getCurveXAt(z + 20) - 2 * track.getCurveXAt(z) + track.getCurveXAt(z - 20)) / 400;
  let kMax = 0; for (let z = 900; z < L - 900; z += 20) kMax = Math.max(kMax, Math.abs(curv(z)));
  let lastBend = -1e9;
  for (let z = 900; z < L - 900; z += 20) {
    const k = curv(z);
    if (Math.abs(k) > kMax * 0.7 && z - lastBend > 900 && !nearFeature(z, 120)) {
      lastBend = z;
      let z2 = z; while (z2 < L - 300 && Math.abs(curv(z2)) > kMax * 0.55 && z2 - z < 300) z2 += 20;
      const dir = Math.sign(k);
      if (!stationNear(z - 170, 90)) signAt(z - 170, 3, 1.1, -1, RW + 2.8, 2.5);
      for (let zz = z; zz < z2; zz += 26) {
        const zq = zz;
        if (stationNear(zq, 90)) continue;
        addAt(zq, (ch, B, gy) => {
          const hd = heading(zq), cx = track.getCurveXAt(zq), outer = dir > 0 ? -1 : 1;
          const x = cx + outer * (RW + 2.6), y0 = Math.max(gy(x, zq), track.getHeightAt(zq) - 1.2);
          post(B, x, y0 - 0.2, y0 + 1.8, zq, hd);
          board(B, x, y0 + 0.9, zq - 0.06, 1.3, 1.0, hd, atlasCell(4), dir > 0);
        });
      }
    }
  }
  // kilometre posts
  for (let z = 1000; z < L; z += 1000) {
    if (stationNear(z, 90)) continue;
    addAt(z, (ch, B, gy) => {
      const hd = heading(z), cx = track.getCurveXAt(z), x = cx - (RW + 2.3), y0 = Math.max(gy(x, z), track.getHeightAt(z) - 1.2);
      B.misc.addT(P.box, x, y0 + 0.5, z, 0, hd, 0, 0.22, 1.0, 0.12, [0.92, 0.92, 0.88]);
      const rx = -Math.cos(hd), rz = Math.sin(hd), f = [-Math.sin(hd), 0, -Math.cos(hd)];
      B.sign.quad([x - rx * 0.1, y0 + 0.25, z - 0.07], [x + rx * 0.1, y0 + 0.25, z - 0.07], [x + rx * 0.1, y0 + 0.88, z - 0.07], [x - rx * 0.1, y0 + 0.88, z - 0.07], white, kmCell(Math.round(z / 1000) % 32), f);
    });
  }
  // snow stakes
  if (T.key === 'snow') {
    for (let z = 60; z < L + 600; z += 24) {
      if (stationNear(z, 85)) continue;
      addAt(z, (ch, B, gy) => {
        const hd = heading(z), cx = track.getCurveXAt(z);
        [-1, 1].forEach(sd => {
          const x = cx + sd * (RW + 2.2), y0 = Math.max(gy(x, z), track.getHeightAt(z) - 0.6);
          B.misc.addT(P.box, x, y0 + 1.0, z, 0, hd, 0, 0.07, 2.2, 0.07, [0.12, 0.12, 0.13]);
          B.misc.addT(P.box, x, y0 + 2.0, z, 0, hd, 0, 0.075, 0.4, 0.075, [0.8, 0.12, 0.1]);
          B.glow.addT(P.box, x, y0 + 1.7, z - 0.04, 0, hd, 0, 0.06, 0.12, 0.02, [1.4, 1.4, 1.4]);
        });
      });
    }
  }
  // overhead gantries with direction signs
  [0.075, 0.215, 0.355, 0.54, 0.7, 0.915].map(f => Math.round(f * L)).forEach((gz, gi) => {
    let z = gz, tries = 0;
    while (tries++ < 12 && (nearFeature(z, 130) || track.loops.some(l => Math.abs(l.z - z) < 90) || track.fireRings.some(r => Math.abs(r.z - z) < 40))) z += 45;
    addAt(z, (ch, B) => {
      const cx = track.getCurveXAt(z), R = track.getHeightAt(z), hd = heading(z), cs = Math.cos(hd), sn = Math.sin(hd);
      const col = [0.62, 0.64, 0.66], side = RW + 2.1, height = 7.4;
      [-1, 1].forEach(sd => {
        const x = cx + sd * side * cs, zz = z - sd * side * sn;
        B.steel.addT(P.box, x, R + height / 2, zz, 0, hd, 0, 0.55, height, 0.55, col);
        B.steel.addT(P.box, x, R + 0.35, zz, 0, hd, 0, 0.9, 0.7, 0.9, [0.5, 0.5, 0.5]);
      });
      B.steel.addT(P.box, cx, R + height + 0.2, z, 0, hd, 0, side * 2 + 0.6, 0.5, 0.5, col);
      B.steel.addT(P.box, cx, R + height + 0.95, z, 0, hd, 0, side * 2 + 0.6, 0.12, 0.12, col);
      for (let k = -6; k <= 5; k++) { const x = cx + (k + 0.5) * side / 3 * cs, zz = z - (k + 0.5) * side / 3 * sn; B.steel.addT(P.box, x, R + height + 0.58, zz, 0, hd, (k % 2 ? 0.6 : -0.6), 0.07, 0.8, 0.07, col); }
      (gi % 2 === 0 ? [5, 7] : [7, 5]).forEach((cell, bi) => {
        const off = (bi === 0 ? -1 : 1) * 3.6, bx = cx + off * cs, bz = z - off * sn - 0.2;
        board(B, bx, R + height - 4.0, bz, 5.2, 4.6, hd, atlasCell(cell));
        B.steel.addT(P.box, bx, R + height - 1.7, z, 0, hd, 0, 5.3, 4.7, 0.08, [0.4, 0.42, 0.45]);
      });
      B.glow.addT(P.box, cx, R + height - 0.2, z - 0.3, 0, hd, 0, side * 2 - 0.5, 0.1, 0.1, [2.0, 1.8, 1.4]);
    });
  });
  S.addAt = addAt; S.board = board; S.atlasCell = atlasCell;
}

// ---------------- props: per chunk (vegetation + registered roadside closures) -----------------
function* e3PropsChunk(ctx, ch) {
  const { track, T, G, own, hi } = ctx, S = ctx.S;
  const sample = ch.sample = e3Sampler(ch, G);
  const out = { y: 0, ny: 1, s: 0 };
  const { pine, broad, bush, bush2, rocks, cactus, dens, nearFeature } = S;
  const scatter = function* (rnd, count, aMin, aMax, powK, accept, fn) {
    for (let n = 0; n < count; n++) {
      if ((n & 127) === 0 && e3tick()) yield;
      const z = ch.z0 + rnd() * (ch.z1 - ch.z0);
      const a = aMin + (aMax - aMin) * Math.pow(rnd(), powK);
      const side = rnd() < 0.5 ? -1 : 1;
      const x = track.getCurveXAt(z) + side * a;
      sample(x, z, out);
      const R = track.getHeightAt(z);
      const p = accept(a, side * a, x, out.y, z, out.ny, R, rnd);
      if (p <= 0 || rnd() > p) continue;
      fn(x, out.y, z, a, side, out.ny, R);
    }
  };
  const rnd = e3rng(e3strHash(track.config.id) + ch.c * 977);
  const L = { near: [], far: [], broadN: [], bush: [], bush2: [], rockA: [], rockB: [], cactus: [] };
  const forestAcc = (aa, s, x, y, z, ny, R) => {
    if (S.stationNear(z, 85) && aa < 48) return 0;
    if (nearFeature(z, 150) && aa < 70) return 0;
    const m = G.forest(x, z, aa, y, ny, R, s);
    return m > 0.22 ? Math.min(1, m * 1.15) * dens : 0;
  };
  if (pine) {
    const mkTree = (x, y, z) => {
      const sc = 0.95 + rnd() * 0.75, b = 0.7 + 0.5 * rnd(), tint = rnd();
      return { x, y: y - 0.15, z, ry: rnd() * 6.28, tx: (rnd() - 0.5) * 0.07, tz: (rnd() - 0.5) * 0.07, sx: sc * (0.85 + 0.3 * rnd()), sy: sc * (0.9 + 0.35 * rnd()), cr: b * (0.95 + 0.1 * tint), cg: b * (1.0 + 0.1 * (0.5 - tint)), cb: b * (0.95 + 0.1 * (0.5 - tint)) };
    };
    yield* scatter(rnd, Math.round(1100 * dens), 14, 75, 1.0, forestAcc, (x, y, z, aa) => {
      if (broad && aa < 120 && rnd() < 0.16) { const t = mkTree(x, y, z); L.broadN.push({ x, y: y - 0.1, z, ry: t.ry, sx: 0.9 + rnd() * 0.7, sy: 0.9 + rnd() * 0.6, cr: 0.8 + rnd() * 0.5, cg: 0.9 + rnd() * 0.4, cb: 0.8 + rnd() * 0.4 }); }
      else L.near.push(mkTree(x, y, z));
    });
    yield* scatter(rnd, Math.round(1900 * dens), 75, 520, 1.5, forestAcc, (x, y, z) => { const t = mkTree(x, y, z); t.sx *= 1.25; t.sy *= 1.35; L.far.push(t); });
  }
  if (bush) {
    yield* scatter(rnd, Math.round((T.key === 'canyon' ? 220 : 240) * (hi ? 1 : 0.5)), 14, 90, 1.4, (aa, s, x, y, z, ny, R) => {
      if (S.stationNear(z, 85) && aa < 48) return 0;
      if (nearFeature(z, 120) && aa < 40) return 0.25;
      if (T.key === 'canyon') return ny > 0.9 ? 0.9 : 0;
      if (T.key === 'alpine' && s > 0 && y < G.seaY + 6) return 0;
      return ny > 0.84 ? (G.forest(x, z, aa, y, ny, R, s) > 0.2 ? 0.2 : 0.9) : 0;
    }, (x, y, z) => {
      const sc = 0.7 + rnd() * 1.2, c = 0.75 + rnd() * 0.5;
      const item = { x, y: y - 0.1, z, ry: rnd() * 6.28, sx: sc, sy: sc * (0.6 + 0.3 * rnd()), sz: sc * (0.8 + 0.4 * rnd()), cr: c, cg: c * (0.95 + 0.1 * rnd()), cb: c };
      (bush2 && rnd() < 0.4 ? L.bush2 : L.bush).push(item);
    });
  }
  if (rocks.length) {
    yield* scatter(rnd, Math.round((T.key === 'canyon' ? 320 : 180) * (hi ? 1 : 0.55)), 13.8, 260, 1.7, (aa, s, x, y, z, ny, R) => {
      if (S.stationNear(z, 85) && aa < 48) return 0;
      if (nearFeature(z, 100) && aa < 60) return 0;
      if (T.key === 'alpine' && s > 0 && y < G.seaY + 1.5) return 0;
      return 0.18 + 0.9 * e3smooth(0.1, 0.4, 1 - ny);
    }, (x, y, z, aa) => {
      const big = rnd() < (T.key === 'canyon' ? 0.05 : 0.12), base = T.key === 'canyon' ? 1.3 : 1.1;
      const sc = (big ? 3.0 : 1.0) * base * (0.5 + rnd() * 1.2) * (1 + aa / 420), c = 0.85 + rnd() * 0.4;
      (rnd() < 0.5 ? L.rockA : L.rockB).push({ x, y: y + sc * 0.06, z, ry: rnd() * 6.28, tx: (rnd() - 0.5) * 0.3, tz: (rnd() - 0.5) * 0.3, sx: sc * (0.9 + 0.5 * rnd()), sy: sc * (0.55 + 0.5 * rnd()), sz: sc * (0.9 + 0.5 * rnd()), cr: c, cg: c, cb: c });
    });
  }
  if (cactus) {
    yield* scatter(rnd, Math.round(150 * (hi ? 1 : 0.5)), 15, 190, 1.2, (aa, s, x, y, z, ny, R) => {
      if (S.stationNear(z, 85) && aa < 48) return 0;
      if (nearFeature(z, 120) && aa < 60) return 0;
      if (ny < 0.92) return 0;
      return 0.35 + 0.65 * e3smooth(-0.3, 0.3, G.n2.fbm(x / 80 + 4, z / 80, 2, 2, 0.5));
    }, (x, y, z) => { const sc = 0.8 + rnd() * 1.1, c = 0.85 + rnd() * 0.3; L.cactus.push({ x, y: y - 0.1, z, ry: rnd() * 6.28, sx: sc, sy: sc * (0.8 + 0.5 * rnd()), cr: c, cg: c, cb: c }); });
  }
  ch.veg = {};
  if (e3tick()) yield;
  if (L.near.length) {
    const m0 = e3Instanced(pine.hi, S.treeMat, L.near, own), m1 = e3Instanced(pine.lo, S.treeMat, L.near, own);
    m1.instanceMatrix = m0.instanceMatrix; m1.instanceColor = m0.instanceColor;
    const mS = new THREE.InstancedMesh(pine.lo, S.shadowMat, L.near.length);
    mS.instanceMatrix = m0.instanceMatrix; mS.count = L.near.length; mS.frustumCulled = false; mS.castShadow = hi; mS.visible = false;
    ch.group.add(m0, m1, mS);
    ch.veg.near0 = m0; ch.veg.near1 = m1; ch.veg.shadow = mS;
  }
  if (L.broadN.length) {
    const b0 = e3Instanced(broad.hi, S.treeMat, L.broadN, own), b1 = e3Instanced(broad.lo, S.treeMat, L.broadN, own);
    b1.instanceMatrix = b0.instanceMatrix; b1.instanceColor = b0.instanceColor;
    ch.group.add(b0, b1); ch.veg.b0 = b0; ch.veg.b1 = b1;
  }
  if (e3tick()) yield;
  if (L.far.length) {
    const f1 = e3Instanced(pine.lo, S.treeMat, L.far, own), f2 = new THREE.InstancedMesh(pine.lo2, S.treeMat, L.far.length);
    f2.instanceMatrix = f1.instanceMatrix; f2.instanceColor = f1.instanceColor; f2.count = L.far.length; f2.frustumCulled = false;
    ch.group.add(f1, f2); ch.veg.far1 = f1; ch.veg.far2 = f2;
  }
  if (e3tick()) yield;
  if (L.bush.length) ch.group.add(e3Instanced(bush, S.bushMat, L.bush, own));
  if (L.bush2.length) ch.group.add(e3Instanced(bush2, S.bushMat, L.bush2, own));
  if (L.rockA.length) ch.group.add(e3Instanced(rocks[0], S.rockMat, L.rockA, own));
  if (L.rockB.length) ch.group.add(e3Instanced(rocks[1], S.rockMat, L.rockB, own));
  if (L.cactus.length) ch.group.add(e3Instanced(cactus, S.treeMat, L.cactus, own));
  if (e3tick()) yield;
  // roadside closures registered for this chunk
  const list = S.adders[ch.c];
  if (list) {
    const gy = (x, z) => { sample(x, z, out); return out.y; };
    for (let i = 0; i < list.length; i++) list[i](ch, ch.builders, gy);
  }
}

function e3PropsVis(ctx, fz, chunks) {
  const hi = ctx.hi;
  for (let i = 0; i < chunks.length; i++) {
    const ch = chunks[i], v = ch.veg;
    if (!ch.ready || !ch.group.visible || !v) continue;
    const near = ch.dist < 460;
    if (v.near0) { v.near0.visible = near; v.near1.visible = !near; v.shadow.visible = hi && ch.dist < 60; }
    if (v.b0) { v.b0.visible = near; v.b1.visible = !near; }
    if (v.far1) { v.far1.visible = near; v.far2.visible = !near; }
  }
}

// ============================================================================
// [p08_special]
// ============================================================================
// p08: water (sea / rivers / frozen rivers / lava), finish & start gantries,
//      city (towers, lamps, billboards, train, service decks), snow particles
// ============================================================================

function e3WaterMaterial(T, noiseTex, kind, own, hi) {
  const lin = a => { const c = new THREE.Color(a[0], a[1], a[2]); c.r = Math.pow(c.r, 2.2); c.g = Math.pow(c.g, 2.2); c.b = Math.pow(c.b, 2.2); return c; };
  const S = T.sky;
  const frozen = T.key === 'snow';
  const U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uSunDir: { value: e3SunDir(T) }, uSunCol: { value: new THREE.Color(T.sun.color[0], T.sun.color[1], T.sun.color[2]) },
    uSkyTop: { value: lin(S.top) }, uSkyMid: { value: lin(S.mid) }, uSkyHor: { value: lin(S.horizon) }, uSkySun: { value: lin(S.horizonSun) },
    uShallow: { value: lin(frozen ? [0.62, 0.80, 0.90] : kind === 'sea' ? [0.14, 0.48, 0.48] : [0.20, 0.38, 0.30]) },
    uDeep: { value: lin(frozen ? [0.38, 0.60, 0.78] : kind === 'sea' ? [0.02, 0.17, 0.30] : [0.06, 0.20, 0.17]) }
  }]);
  U.uNoise = { value: noiseTex };   // (UniformsUtils.merge would clone the texture and leak a GL texture per build)
  const m = new THREE.ShaderMaterial({
    uniforms: U, fog: true, defines: hi ? {} : { LOWQ: 1 },
    vertexShader: `
      attribute float aDepth; varying vec3 vW; varying float vDepth;
      #include <fog_pars_vertex>
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vDepth = aDepth; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `
      varying vec3 vW; varying float vDepth;
      uniform float uTime; uniform sampler2D uNoise; uniform vec3 uSunDir, uSunCol, uSkyTop, uSkyMid, uSkyHor, uSkySun, uShallow, uDeep;
      #include <fog_pars_fragment>
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float dist = length(cameraPosition - vW);
        mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
        vec2 p = vW.xz; vec2 t = vec2(uTime * 0.9, uTime * 0.55);
        vec4 s1 = texture2D(uNoise, rot * p * 0.0173 + t * 0.010);
        #ifdef LOWQ
        vec4 s2 = s1.argb;
        #else
        vec4 s2 = texture2D(uNoise, rot * rot * p * 0.0431 - t * 0.018 + 0.31);
        #endif
        vec2 n1 = s1.rg - 0.5, n2 = s2.gr - 0.5, n3 = vec2(s2.b - 0.5, s1.b - 0.5) * 0.6;
        float k = 1.0 / (1.0 + dist * 0.006);
        ${frozen ? 'k *= 0.12;' : (kind === 'river' ? 'k *= 0.35;' : '')}
        vec3 N = normalize(vec3((n1.x * 0.7 + n2.x * 0.6) * k * 1.2, 1.0, (n1.y * 0.7 + n2.y * 0.6) * k * 1.2));
        vec3 R = reflect(-V, N);
        float ry = max(R.y, 0.0);
        vec2 rxz = normalize(R.xz + vec2(1e-5)), sxz = normalize(uSunDir.xz + vec2(1e-5));
        vec3 hor = mix(uSkyHor, uSkySun, pow(dot(rxz, sxz) * 0.5 + 0.5, 2.6));
        float q = pow(ry, 0.5);
        vec3 sky = mix(hor, uSkyMid, smoothstep(0.0, 0.34, q));
        sky = mix(sky, uSkyTop, smoothstep(0.3, 0.98, q));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 16.0, vDepth));
        vec3 col = mix(body, sky, clamp(fres * ${frozen ? '0.55' : '1.0'}, 0.0, 1.0));
        float sd = max(dot(R, uSunDir), 0.0);
        float spark = s2.a + 0.5 * s1.a;
        col += uSunCol * (pow(sd, 700.0) * 16.0 * (0.30 + spark) + pow(sd, 90.0) * 1.0 + pow(sd, 8.0) * 0.08);
        ${frozen ? `
        float crack = texture2D(uNoise, p * 0.05).b + 0.6 * texture2D(uNoise, p * 0.13 + 0.3).b;
        col = mix(col, vec3(0.7, 0.8, 0.9), clamp(crack, 0.0, 1.0) * 0.5);
        ` : `
        float shore = 1.0 - smoothstep(0.0, 1.5, vDepth);
        float fm = shore * smoothstep(0.35, 0.75, texture2D(uNoise, p * 0.16 + vec2(0.0, uTime * 0.03)).g * 0.8 + 0.25 * sin(vDepth * 6.0 - uTime * 1.5) + 0.1);
        col = mix(col, vec3(0.80, 0.86, 0.88), clamp(fm, 0.0, 1.0) * 0.85);
        `}
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
        #include <fog_fragment>
      }`
  });
  return own.mat(m);
}
function e3LavaMaterial(own, noiseTex) {
  const U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]);
  U.uNoise = { value: noiseTex };
  return own.mat(new THREE.ShaderMaterial({
    uniforms: U, fog: true,
    vertexShader: `
      attribute float aDepth; varying vec3 vW; varying float vDepth;
      #include <fog_pars_vertex>
      void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vDepth = aDepth; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `
      varying vec3 vW; varying float vDepth; uniform float uTime; uniform sampler2D uNoise;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vW.xz;
        float f1 = texture2D(uNoise, p * 0.011 + vec2(uTime * 0.004, -uTime * 0.02)).g;
        float f2 = texture2D(uNoise, p * 0.034 + vec2(-uTime * 0.01, -uTime * 0.045)).g;
        float f3 = texture2D(uNoise, p * 0.09 + vec2(uTime * 0.02, -uTime * 0.08)).g;
        float c1 = texture2D(uNoise, p * 0.05 + vec2(0.0, -uTime * 0.03)).b;
        float heat = smoothstep(0.38, 0.70, f1 * 0.45 + f2 * 0.35 + f3 * 0.2);
        vec3 crust = vec3(0.018, 0.008, 0.006) * (0.6 + f3);
        vec3 hot = mix(vec3(1.7, 0.2, 0.02), vec3(4.2, 1.5, 0.15), heat) * (0.7 + 0.6 * f2);
        float glowLines = clamp(c1 * 1.4, 0.0, 1.0) * 0.8;
        float m = clamp(heat * 1.15 + glowLines * 0.7, 0.0, 1.0);
        m = max(m, 1.0 - smoothstep(0.0, 1.6, vDepth) * 0.0);
        vec3 col = mix(crust, hot, smoothstep(0.15, 0.6, m));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
        #include <fog_fragment>
      }`
  }));
}

function e3WaterMesh(ctx, ch, level, rowOK, j0, j1, jOK, mat, own) {
  const P = ch.T.P, NC = ch.T.NC;
  const rows = E3.CL / E3.ROW + 1;
  const nc = j1 - j0 + 1;
  const pos = new Float32Array(rows * nc * 3), dep = new Float32Array(rows * nc);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < nc; k++) {
      const o = ((r + 1) * NC + j0 + k) * 3, v = r * nc + k;
      pos[v * 3] = P[o]; pos[v * 3 + 1] = level; pos[v * 3 + 2] = P[o + 2];
      dep[v] = level - P[o + 1];
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    if (!rowOK(ch.z0 + r * E3.ROW)) continue;
    for (let k = 0; k < nc - 1; k++) {
      if (jOK && !jOK(j0 + k, ch.z0 + r * E3.ROW)) continue;
      const a = r * nc + k, b = a + 1, c = a + nc, d = c + 1;
      if (Math.max(dep[a], dep[b], dep[c], dep[d]) < -0.05) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (!idx.length) return null;
  const g = own.geo(new THREE.BufferGeometry());
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.BufferAttribute(dep, 1));
  g.setIndex(idx); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.matrixAutoUpdate = false;
  ch.group.add(m);
  return m;
}

function e3WaterInit(ctx) {
  const { T, own, noiseTex } = ctx;
  if (T.key === 'city') return;
  const W = ctx.W = {};
  W.water = e3WaterMaterial(T, noiseTex, T.key === 'alpine' ? 'sea' : 'river', own, ctx.hi);
  W.lava = T.key === 'canyon' ? e3LavaMaterial(own, noiseTex) : null;
  ctx.updaters.push((dt, time) => { W.water.uniforms.uTime.value = time; if (W.lava) W.lava.uniforms.uTime.value = time; });
}
function e3WaterChunk(ctx, ch) {
  const { T, G, own } = ctx, W = ctx.W;
  if (!W) return;
  const iC = G.iCenter, NC = G.NC;
  if (T.key === 'alpine') e3WaterMesh(ctx, ch, G.seaY, () => true, iC, NC - 1, null, W.water, own);
  G.ravines.forEach(r => {
    if (ch.z1 < r.z - r.wout - 20 || ch.z0 > r.z + r.wout + 20) return;
    const level = r.floor + (T.key === 'canyon' ? 1.6 : 2.4);
    const jOK = (j, z) => {
      const s = G.LAT[j]; if (Math.abs(s) > 520) return false;
      if (T.key === 'alpine' && s > 0) return s < G.coast(r.z, 0) - 78;
      return true;
    };
    e3WaterMesh(ctx, ch, level, z => Math.abs(z - r.z) <= r.wout + 12, 0, NC - 1, jOK, W.lava || W.water, own);
  });
}

// ---------------------------------------------------------------------------
// finish / start gantries
// ---------------------------------------------------------------------------
function e3BannerTexture(textLatin, textHeb, accent) {
  const c = e3canvas(1024, 192), g = c.getContext('2d');
  g.fillStyle = '#101216'; g.fillRect(0, 0, 1024, 192);
  const cell = 24;
  for (let y = 0; y < 192; y += cell) for (let x = 0; x < 150; x += cell) {
    const on = ((x / cell + y / cell) % 2) === 0;
    g.fillStyle = on ? '#f4f4f2' : '#15171b'; g.fillRect(x, y, cell, cell);
    g.fillStyle = on ? '#15171b' : '#f4f4f2'; g.fillRect(1024 - 150 + x, y, cell, cell);
  }
  g.fillStyle = accent; g.fillRect(150, 0, 724, 10); g.fillRect(150, 182, 724, 10);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = '#ffffff'; g.font = 'bold 118px Arial, sans-serif'; g.fillText(textLatin, 340, 100);
  g.direction = 'rtl'; g.fillStyle = accent; g.font = 'bold 118px Arial, sans-serif'; g.fillText(textHeb, 760, 100);
  return e3canvasTex(c, { aniso: 8, srgb: true, clampS: true, clampT: true });
}
function e3CheckerStrip() {
  const c = e3canvas(512, 64), g = c.getContext('2d');
  const cell = 32;
  for (let y = 0; y < 64; y += cell) for (let x = 0; x < 512; x += cell) { g.fillStyle = ((x + y) / cell) % 2 === 0 ? '#f2f2f0' : '#18191c'; g.fillRect(x, y, cell, cell); }
  const t = e3canvasTex(c, { aniso: 8, srgb: true, clampS: true, clampT: true });
  return t;
}
function e3RegisterGantry(ctx, z, latin, heb, accent, withCheckerRoad) {
  ctx.S.addAt(z, (ch, B) => {
    const { track, G, own } = ctx;
    const RW = G.RW, P = e3prim();
    const cx = track.getCurveXAt(z), R = track.getHeightAt(z), hd = track.getHeadingAt(z), cs = Math.cos(hd), sn = Math.sin(hd);
    const steel = [0.58, 0.60, 0.63], dark = [0.22, 0.23, 0.25];
    const side = RW + 2.0, H = 11.6;
    [-1, 1].forEach(sd => {
      const x = cx + sd * side * cs, zz = z - sd * side * sn;
      B.steel.addT(P.box, x, R + H / 2, zz, 0, hd, 0, 1.5, H, 1.5, steel);
      B.steel.addT(P.box, x, R + 0.5, zz, 0, hd, 0, 2.4, 1.0, 2.4, dark);
    });
    B.steel.addT(P.box, cx, R + H + 0.4, z, 0, hd, 0, side * 2 + 1.6, 1.4, 1.5, steel);
    B.steel.addT(P.box, cx, R + H + 1.5, z, 0, hd, 0, side * 2 + 1.6, 0.18, 0.18, steel);
    for (let k = -9; k <= 8; k++) { const x = cx + (k + 0.5) * side / 4.5 * cs, zz = z - (k + 0.5) * side / 4.5 * sn; B.steel.addT(P.box, x, R + H + 1.0, zz, 0, hd, k % 2 ? 0.7 : -0.7, 0.09, 1.25, 0.09, steel); }
    B.glow.addT(P.box, cx, R + H - 0.5, z - 0.85, 0, hd, 0, side * 2 - 1.0, 0.16, 0.14, [3.0, 2.8, 2.4]);
    const tex = own.tex(e3BannerTexture(latin, heb, accent));
    const mat = own.mat(new THREE.MeshBasicMaterial({ map: tex }));
    const geo = own.geo(new THREE.PlaneGeometry(side * 2 - 1.6, 3.6));
    const front = new THREE.Mesh(geo, mat);
    front.position.set(cx, R + H - 2.9, z - 0.78); front.rotation.y = hd + Math.PI;
    const back = new THREE.Mesh(geo, mat); back.position.set(cx, R + H - 2.9, z + 0.78); back.rotation.y = hd;
    ch.group.add(front, back);
    if (withCheckerRoad) {
      const ct = own.tex(e3CheckerStrip()); ct.repeat.set(2.75, 1);
      const cm = own.mat(new THREE.MeshBasicMaterial({ map: ct, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      const cg = own.geo(new THREE.PlaneGeometry(G.RW * 2, 2.0)); cg.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(cg, cm); m.position.set(cx, R + 0.015, z + 1.0); m.rotation.y = hd;
      ch.group.add(m);
    } else {
      const lg = own.geo(new THREE.PlaneGeometry(G.RW * 2 - 0.9, 0.45)); lg.rotateX(-Math.PI / 2);
      const lm = own.mat(new THREE.MeshBasicMaterial({ color: 0xe9e9e4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      const m = new THREE.Mesh(lg, lm); m.position.set(cx, R + 0.015, z); m.rotation.y = hd; ch.group.add(m);
    }
  });
}

// ---------------------------------------------------------------------------
// snow particles
// ---------------------------------------------------------------------------
function e3BuildSnow(ctx) {
  const { own, hi, group } = ctx;
  const N = hi ? 560 : 260;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  const rnd = e3rng(8080);
  const SX = 60, SY = 28, SZ = 100;
  for (let i = 0; i < N; i++) { pos[i * 3] = (rnd() - 0.5) * SX; pos[i * 3 + 1] = rnd() * SY; pos[i * 3 + 2] = rnd() * SZ - 25; vel[i * 3] = 0.6 + rnd() * 0.9; vel[i * 3 + 1] = -(1.4 + rnd() * 1.6); vel[i * 3 + 2] = (rnd() - 0.5) * 0.6; }
  const geo = own.geo(new THREE.BufferGeometry());
  const attr = new THREE.BufferAttribute(new Float32Array(N * 3), 3); attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = own.mat(new THREE.PointsMaterial({ map: e3softDot(), size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.92, depthWrite: false, color: 0xffffff, fog: true }));
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5;
  group.add(pts);
  const arr = attr.array;
  const ox = { x: 0, y: 0, z: 0 };
  ctx.updaters.push((dt, time, focus) => {
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
      // positions are stored relative to the focus box, wrapped
      let x = pos[o], y = pos[o + 1], z = pos[o + 2];
      pos[o] = x = ((x + SX / 2) % SX + SX) % SX - SX / 2;
      pos[o + 1] = y = ((y % SY) + SY) % SY;
      pos[o + 2] = z = (((z + 25) % SZ) + SZ) % SZ - 25;
      arr[o] = focus.x + x; arr[o + 1] = focus.y - 6 + y; arr[o + 2] = focus.z + z;
    }
    attr.needsUpdate = true;
  });
}

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------
function e3SpecialInit(ctx) {
  e3WaterInit(ctx);
  e3RegisterGantry(ctx, ctx.track.length, 'FINISH', 'סיום', '#ffd23a', true);
  e3RegisterGantry(ctx, 104, 'START', 'זינוק', '#4ade80', false);
  if (ctx.T.key === 'snow') e3BuildSnow(ctx);
  if (ctx.T.key === 'city' && typeof e3CityInit === 'function') e3CityInit(ctx);
}
function* e3SpecialChunk(ctx, ch) {
  e3WaterChunk(ctx, ch);
  if (e3tick()) yield;
  if (ctx.T.key === 'city' && typeof e3CityChunk === 'function') yield* e3CityChunk(ctx, ch);
}

// ============================================================================
// [p10_city]
// ============================================================================
// p10: Tokyo-style midnight city: towers with lit windows, rooftop beacons,
//      street lamps + wet-road light pools/streaks, ad billboards, elevated
//      rail line with a moving train, ground-level city lights, service-area decks
// ============================================================================

function e3AdAtlas() {
  const C = E3.cache.tex;
  if (C.ads) return C.ads;
  const c = e3canvas(1024, 1024), g = c.getContext('2d');
  const defs = [
    { t: 'RAMEN', bg: ['#b3121a', '#e8322a'], fg: '#ffe9a8', sub: '24H' },
    { t: 'TURBO COLA', bg: ['#0a3d91', '#1e7bff'], fg: '#ffffff', sub: 'ICE COLD' },
    { t: 'NOVA TECH', bg: ['#04141c', '#06303d'], fg: '#4cf2ff', sub: 'FUTURE NOW' },
    { t: 'מבצע ענק!', bg: ['#7a0a58', '#d6258c'], fg: '#ffffff', sub: 'עד 50% הנחה', heb: true },
    { t: 'SUSHI BAR', bg: ['#1b1b1b', '#3b2a12'], fg: '#ffb347', sub: 'OPEN LATE' },
    { t: 'HOTEL SKY', bg: ['#0b0f26', '#1a2250'], fg: '#ffd66b', sub: 'ROOMS' },
    { t: 'ARCADE', bg: ['#2a0b5a', '#6a1fd1'], fg: '#7bffb0', sub: 'PLAY 24H' },
    { t: 'NIGHT MARKET', bg: ['#10351f', '#1d7a43'], fg: '#fff6c2', sub: 'FRESH' }
  ];
  defs.forEach((d, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    const gr = g.createLinearGradient(x, y, x + 512, y + 256); gr.addColorStop(0, d.bg[0]); gr.addColorStop(1, d.bg[1]);
    g.fillStyle = gr; g.fillRect(x, y, 512, 256);
    g.strokeStyle = d.fg; g.lineWidth = 6; g.strokeRect(x + 8, y + 8, 496, 240);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = d.fg; g.shadowBlur = 18;
    g.fillStyle = d.fg; g.font = 'bold 84px Arial, sans-serif'; if (d.heb) g.direction = 'rtl'; else g.direction = 'ltr';
    g.fillText(d.t, x + 256, y + 108, 470);
    g.shadowBlur = 0; g.font = 'bold 38px Arial, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillText(d.sub, x + 256, y + 192, 440);
    g.direction = 'ltr';
  });
  const t = e3canvasTex(c, { aniso: 8, srgb: true, clampS: true, clampT: true });
  return (C.ads = t);
}
const e3AdCell = k => { const u0 = (k % 2) * 0.5, v1 = 1 - Math.floor(k / 2) * 0.25; return [u0, v1 - 0.25, u0 + 0.5, v1]; };

function e3CityInit(ctx) {
  const { own, hi, T, G, track } = ctx;
  const C = ctx.C = {};
  const fac = e3FacadeTextures();
  C.bldgMats = fac.map(tx => own.mat(new THREE.MeshBasicMaterial({ map: tx, vertexColors: true })));
  C.adMat = own.mat(new THREE.MeshBasicMaterial({ map: e3AdAtlas(), vertexColors: true, side: THREE.DoubleSide }));
  C.beaconMat = own.mat(new THREE.PointsMaterial({ map: e3softDot(), color: 0xff2a22, size: 11, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
  C.haloMat = own.mat(new THREE.PointsMaterial({ map: e3softDot(), color: 0xffb860, size: 8.5, sizeAttenuation: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
  C.lightsMat = own.mat(new THREE.PointsMaterial({ map: e3softDot(), size: 3.6, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
  ctx.updaters.push((dt, t) => { const ph = (t * 0.9) % 1; C.beaconMat.opacity = ph < 0.22 ? 1 : 0.06; });
  // rail line: train (merged geometry, moved every frame)
  const b = new E3Geo(false);
  const carLen = 19, gap = 0.9, cars = 6;
  const body = [0.42, 0.44, 0.50], stripe = [0.7, 0.12, 0.1], win = [2.4, 2.1, 1.6];
  for (let i = 0; i < cars; i++) {
    const z0 = -i * (carLen + gap), P = e3prim();
    b.addT(P.box, 0, 2.0, z0 - carLen / 2, 0, 0, 0, 3.0, 3.1, carLen, body);
    b.addT(P.box, 0, 1.0, z0 - carLen / 2, 0, 0, 0, 3.04, 0.35, carLen + 0.02, stripe);
    b.addT(P.box, 0, 2.55, z0 - carLen / 2, 0, 0, 0, 3.05, 0.9, carLen - 1.0, win);
  }
  const tg = own.geo(b.build());
  C.train = new THREE.Mesh(tg, own.mat(new THREE.MeshBasicMaterial({ vertexColors: true })));
  C.train.frustumCulled = false;
  ctx.group.add(C.train);
  const laneOff = -150;
  ctx.updaters.push((dt, t, focus) => {
    const span = 2000, zFront = focus.z - 400 + (((t * 33) % span));
    const hd = track.getHeadingAt(zFront), cx = track.getCurveXAt(zFront);
    const deckY = track.getHeightAt(zFront) + 5.4 + 1.2;
    C.train.position.set(cx + laneOff, deckY, zFront);
    C.train.rotation.y = hd;
  });
  C.stationNear = ctx.S.stationNear;
}

function* e3CityChunk(ctx, ch) {
  const { T, G, track, own, hi, C } = ctx;
  const B = ch.builders, P = e3prim();
  const rnd = e3rng(e3strHash(track.config.id) * 7 + ch.c * 313);
  const sample = ch.sample;
  const tmp = { y: 0, ny: 1, s: 0 };
  const gy = (x, z) => { sample(x, z, tmp); return tmp.y; };
  const RW = G.RW;

  // ---------- towers ----------
  const bd = [new E3Geo(false), new E3Geo(false), new E3Geo(false)];
  const ads = new E3Geo(false);
  const beacons = [];
  const rows = hi
    ? [{ a0: 22, a1: 66, wMin: 16, wMax: 34, hMin: 26, hMax: 105, gap: [3, 12] }, { a0: 74, a1: 200, wMin: 24, wMax: 52, hMin: 60, hMax: 190, gap: [6, 22] }, { a0: 215, a1: 700, wMin: 36, wMax: 84, hMin: 90, hMax: 300, gap: [10, 48] }]
    : [{ a0: 22, a1: 66, wMin: 18, wMax: 36, hMin: 26, hMax: 105, gap: [5, 16] }, { a0: 74, a1: 220, wMin: 28, wMax: 56, hMin: 60, hMax: 190, gap: [10, 30] }];
  const cluster = (x, z) => 0.55 + 0.9 * Math.max(0, G.n2.fbm(x / 420 + 3, z / 420 - 7, 2, 2, 0.5) * 0.5 + 0.5 - 0.15);
  for (const side of [-1, 1]) {
    for (let ri = 0; ri < rows.length; ri++) {
      if (e3tick()) yield;
      const row = rows[ri];
      let z = ch.z0 + rnd() * 6;
      const a1 = (side < 0 && ri === 1) ? 122 : row.a1, a0 = (side < 0 && ri === 2) ? 192 : row.a0;
      while (z < ch.z1) {
        const dl = row.wMin + rnd() * (row.wMax - row.wMin);
        const w = row.wMin + rnd() * (row.wMax - row.wMin);
        const zc = z + dl / 2;
        z += dl + row.gap[0] + rnd() * (row.gap[1] - row.gap[0]);
        if (zc > ch.z1 + 5) break;
        let amin = a0;
        if (ctx.S.stationNear(zc, 130)) { if (ri === 0) continue; amin = Math.max(a0, 52); }
        if (a1 - amin < w) continue;
        const a = amin + w / 2 + rnd() * Math.max(0, (a1 - amin) - w);
        const hd = track.getHeadingAt(zc), cxz = track.getCurveXAt(zc);
        const bx = cxz + side * a;
        const gh = gy(bx, zc);
        let h = (row.hMin + (row.hMax - row.hMin) * Math.pow(rnd(), 1.7)) * cluster(bx, zc);
        h = Math.max(row.hMin * 0.8, h);
        const v = Math.floor(rnd() * 3);
        const yaw = hd + (rnd() < 0.12 ? (rnd() - 0.5) * 0.7 : 0);
        const cs = Math.cos(yaw), sn = Math.sin(yaw);
        const hw = w / 2, hdz = dl / 2;
        const y0 = gh - 4, y1 = gh + h;
        const lit = 0.85 + rnd() * 0.65;
        const corners = [[-hw, -hdz], [hw, -hdz], [hw, hdz], [-hw, hdz]].map(([lx, lz]) => [bx + lx * cs + lz * sn, bz(lx, lz)]);
        function bz(lx, lz) { return zc - lx * sn + lz * cs; }
        const u0 = Math.floor(rnd() * 8) / 8, vv0 = Math.floor(rnd() * 16) / 16;
        const faceB = [0.55 * lit, 0.8 * lit, 0.45 * lit, 0.7 * lit];
        for (let f = 0; f < 4; f++) {
          const pa = corners[f], pb = corners[(f + 1) % 4];
          const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
          const ur = len / 17.6, vr = (y1 - y0) / 51.2;
          const dark = [0.12 * lit, 0.12 * lit, 0.14 * lit], top = [faceB[f], faceB[f], faceB[f] * 1.03];
          const nx = (pb[1] - pa[1]) / len, nz = -(pb[0] - pa[0]) / len;
          bd[v].quadV([pa[0], y0, pa[1]], [pb[0], y0, pb[1]], [pb[0], y1, pb[1]], [pa[0], y1, pa[1]], dark, dark, top, top, [u0, vv0, u0 + ur, vv0 + vr], [nx, 0, nz]);
        }
        // roof
        const rc = [0.035, 0.04, 0.05];
        bd[v].quad([corners[0][0], y1, corners[0][1]], [corners[1][0], y1, corners[1][1]], [corners[2][0], y1, corners[2][1]], [corners[3][0], y1, corners[3][1]], rc, [0.0, 0.0, 0.01, 0.01], [0, 1, 0]);
        // roof boxes
        if (rnd() < 0.8) { bd[v].addT(P.box, bx + (rnd() - 0.5) * hw, y1 + 1.2, zc + (rnd() - 0.5) * hdz, 0, yaw, 0, w * (0.18 + rnd() * 0.2), 2.4, dl * (0.18 + rnd() * 0.2), [0.07, 0.075, 0.09], [0, 0, 0.01, 0.01]); }
        // antenna + aviation light
        if (h > 105 || (h > 55 && rnd() < 0.25)) {
          B.steel.addT(P.box, bx, y1 + 6, zc, 0, 0, 0, 0.35, 12, 0.35, [0.25, 0.25, 0.28]);
          beacons.push(bx, y1 + 12.4, zc);
        }
        // neon sign on the road-facing wall of near towers
        if (ri === 0 && rnd() < 0.5 && h > 30) {
          const k = Math.floor(rnd() * 8), sw = 6 + rnd() * 6, sh = sw * 0.5 * (1 + rnd());
          const fx = bx - side * (hw + 0.25) * 1.0, sy = gh + 14 + rnd() * Math.min(40, h - 30);
          const hh = sh;
          const ra = Math.cos(hd), rb = -Math.sin(hd);
          const nrm = [-side, 0, 0];
          ads.quadV([fx, sy, zc - sw / 2], [fx, sy, zc + sw / 2], [fx, sy + hh, zc + sw / 2], [fx, sy + hh, zc - sw / 2], [1.7, 1.7, 1.7], [1.7, 1.7, 1.7], [1.7, 1.7, 1.7], [1.7, 1.7, 1.7], e3AdCell(k), nrm);
        }
      }
    }
  }
  if (e3tick()) yield;
  bd.forEach((b, i) => { if (!b.empty) { const m = new THREE.Mesh(own.geo(b.build()), C.bldgMats[i]); m.matrixAutoUpdate = false; ch.group.add(m); } });
  if (beacons.length) {
    const g = own.geo(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3)); g.computeBoundingSphere();
    ch.group.add(new THREE.Points(g, C.beaconMat));
  }

  if (e3tick()) yield;
  // ---------- street lamps + wet-road light pools / streaks ----------
  const lampEvery = hi ? 40 : 80;
  const halos = [];
  for (let z = Math.ceil(ch.z0 / lampEvery) * lampEvery; z < ch.z1; z += lampEvery) {
    if (ctx.S.stationNear(z, 78)) continue;
    const cx = track.getCurveXAt(z), R = track.getHeightAt(z), hd = track.getHeadingAt(z), cs = Math.cos(hd), sn = Math.sin(hd);
    [-1, 1].forEach(sd => {
      const px = cx + sd * (RW - 0.15) * cs, pz = z - sd * (RW - 0.15) * sn;
      B.steel.addT(P.box, px, R + 5.4, pz, 0, hd, 0, 0.26, 9.0, 0.26, [0.32, 0.33, 0.36]);
      const hx = cx + sd * (RW - 2.6) * cs, hz = z - sd * (RW - 2.6) * sn;
      B.steel.addT(P.box, (px + hx) / 2, R + 9.9, (pz + hz) / 2, 0, hd, 0, 2.6, 0.14, 0.14, [0.32, 0.33, 0.36]);
      B.glow.addT(P.box, hx, R + 9.8, hz, 0, hd, 0, 1.2, 0.1, 0.45, [8.0, 5.6, 2.6]);
      halos.push(hx, R + 9.7, hz);
      // light pool on the road
      const pxm = cx + sd * 6.0 * cs, pzm = z - sd * 6.0 * sn, y = R + 0.035;
      const hw = 8.0, hl = 12.0;
      B.pool.quad([pxm - hw, y, pzm - hl], [pxm + hw, y, pzm - hl], [pxm + hw, y, pzm + hl], [pxm - hw, y, pzm + hl], [0.11, 0.075, 0.032], [0, 0, 1, 1], [0, 1, 0]);
      // reflection streak (toward the camera)
      const sx = cx + sd * 4.4 * cs, sz = z - sd * 4.4 * sn, sy = R + 0.04;
      B.streak.quad([sx - 1.0, sy, sz - 34], [sx + 1.0, sy, sz - 34], [sx + 1.0, sy, sz + 1], [sx - 1.0, sy, sz + 1], [0.30, 0.19, 0.085], [0, 0, 1, 1], [0, 1, 0]);
    });
  }

  // ---------- roadside ad boards (every ~240 m, alternating sides) ----------
  for (let z = Math.ceil(ch.z0 / 240) * 240 + 77; z < ch.z1; z += 240) {
    if (ctx.S.stationNear(z, 130)) continue;
    const k = Math.floor(rnd() * 8), sd = (Math.round(z / 240) % 2) ? 1 : -1;
    const cx = track.getCurveXAt(z), hd = track.getHeadingAt(z), R = track.getHeightAt(z);
    const x = cx + sd * (RW + 7.5), w = 16, h = 8, y = R + 11;
    B.steel.addT(P.box, x, R + 5, z, 0, hd, 0, 0.7, 11, 0.7, [0.3, 0.31, 0.34]);
    const rx = -Math.cos(hd), rz = Math.sin(hd), f = [-Math.sin(hd), 0, -Math.cos(hd)];
    ads.quadV([x - rx * w / 2, y, z - rz * w / 2 - 0.4], [x + rx * w / 2, y, z + rz * w / 2 - 0.4], [x + rx * w / 2, y + h, z + rz * w / 2 - 0.4], [x - rx * w / 2, y + h, z - rz * w / 2 - 0.4], [1.5, 1.5, 1.5], [1.5, 1.5, 1.5], [1.5, 1.5, 1.5], [1.5, 1.5, 1.5], e3AdCell(k), f);
    B.steel.addT(P.box, x, y + h * 0.5, z + 0.1, 0, hd, 0, w + 0.4, h + 0.4, 0.2, [0.2, 0.2, 0.22]);
  }

  if (e3tick()) yield;
  // ---------- service-area decks beside the road (city stations) ----------
  G.stz.forEach(sz => {
    const za = Math.max(ch.z0, sz - 95), zb = Math.min(ch.z1, sz + 95);
    if (zb <= za) return;
    const cc = [0.50, 0.50, 0.49], topc = [0.20, 0.205, 0.22], dk = [0.30, 0.30, 0.30];
    for (let z = za; z < zb; z += 5) {
      const z2 = Math.min(zb, z + 5);
      const cxA = track.getCurveXAt(z), cxB = track.getCurveXAt(z2), yA = track.getHeightAt(z) - 0.32, yB = track.getHeightAt(z2) - 0.32;
      [-1, 1].forEach(sd => {
        const l0 = sd * RW, l1 = sd * 42;
        B.concrete.quad([cxA + l0, yA, z], [cxA + l1, yA, z], [cxB + l1, yB, z2], [cxB + l0, yB, z2], topc, null, [0, 1, 0]);
        B.concrete.quad([cxA + l1, yA, z], [cxA + l1, yA - 1.6, z], [cxB + l1, yB - 1.6, z2], [cxB + l1, yB, z2], cc, null, [sd, 0, 0]);
        B.concrete.quad([cxA + l0, yA - 1.6, z], [cxA + l1, yA - 1.6, z], [cxB + l1, yB - 1.6, z2], [cxB + l0, yB - 1.6, z2], dk, null, [0, -1, 0]);
        // parapet on the outer edge
        B.concrete.addT(P.box, (cxA + cxB) / 2 + sd * 41.6, yA + 0.5, (z + z2) / 2, 0, 0, 0, 0.7, 1.0, 5.05, [0.62, 0.62, 0.6]);
      });
    }
    // deck lamps (warm light pools on the service deck)
    for (const z of [sz - 84, sz - 92, sz + 84, sz + 92]) if (z >= za && z <= zb) [-1, 1].forEach(sd => {
      const cx = track.getCurveXAt(z), y = track.getHeightAt(z), px = cx + sd * 24;
      B.steel.addT(P.box, px, y + 4.2, z, 0, 0, 0, 0.24, 8.4, 0.24, [0.4, 0.41, 0.44]);
      B.glow.addT(P.box, px - sd * 1.0, y + 8.3, z, 0, 0, 0, 2.4, 0.1, 0.5, [8.0, 5.8, 3.0]);
      halos.push(px - sd * 1.0, y + 8.2, z);
      B.pool.quad([px - 11, y + 0.04, z - 15], [px + 11, y + 0.04, z - 15], [px + 11, y + 0.04, z + 15], [px - 11, y + 0.04, z + 15], [0.16, 0.115, 0.055], [0, 0, 1, 1], [0, 1, 0]);
    });
    // end parapets + columns
    [-1, 1].forEach(sd => {
      [za, zb].forEach(zz => { if (zz > ch.z0 + 0.01 && zz < ch.z1 - 0.01 || (zz === sz - 95 || zz === sz + 95)) { const cx = track.getCurveXAt(zz), y = track.getHeightAt(zz); B.concrete.addT(P.box, cx + sd * 26, y + 0.5, zz, 0, 0, 0, 30, 1.0, 0.7, [0.62, 0.62, 0.6]); } });
      for (let z = Math.ceil(za / 18) * 18; z <= zb; z += 18) for (const l of [14, 28, 39]) {
        const cx = track.getCurveXAt(z), y = track.getHeightAt(z), g = gy(cx + sd * l, z);
        B.concrete.addT(P.box, cx + sd * l, (y - 1.6 + g) / 2 - 0.5, z, 0, 0, 0, 1.8, y - 1.6 - g + 1.0, 1.8, [0.46, 0.46, 0.45]);
      }
    });
  });

  if (e3tick()) yield;
  // ---------- elevated rail line (right side) ----------
  {
    const off = -150, deckW = 9;
    const stepZ = 15;
    for (let z = ch.z0; z < ch.z1; z += stepZ) {
      const z2 = z + stepZ, cxA = track.getCurveXAt(z) + off, cxB = track.getCurveXAt(z2) + off;
      const yA = track.getHeightAt(z) + 5.4, yB = track.getHeightAt(z2) + 5.4;
      const cc = [0.44, 0.44, 0.45];
      B.concrete.quad([cxA - deckW / 2, yA, z], [cxA + deckW / 2, yA, z], [cxB + deckW / 2, yB, z2], [cxB - deckW / 2, yB, z2], [0.22, 0.22, 0.23], null, [0, 1, 0]);
      [-1, 1].forEach(sd => B.concrete.quad([cxA + sd * deckW / 2, yA, z], [cxA + sd * deckW / 2, yA - 1.7, z], [cxB + sd * deckW / 2, yB - 1.7, z2], [cxB + sd * deckW / 2, yB, z2], cc, null, [sd, 0, 0]));
      B.concrete.quad([cxA - deckW / 2, yA - 1.7, z], [cxA + deckW / 2, yA - 1.7, z], [cxB + deckW / 2, yB - 1.7, z2], [cxB - deckW / 2, yB - 1.7, z2], [0.25, 0.25, 0.26], null, [0, -1, 0]);
      [-1, 1].forEach(sd => B.concrete.quad([cxA + sd * (deckW / 2 - 0.1), yA + 0.7, z], [cxA + sd * (deckW / 2 - 0.1), yA, z], [cxB + sd * (deckW / 2 - 0.1), yB, z2], [cxB + sd * (deckW / 2 - 0.1), yB + 0.7, z2], [0.5, 0.5, 0.5], null, [-sd, 0, 0]));
      // two rails
      [-0.8, 0.8].forEach(rx => B.steel.quad([cxA + rx - 0.04, yA + 0.2, z], [cxA + rx + 0.04, yA + 0.2, z], [cxB + rx + 0.04, yB + 0.2, z2], [cxB + rx - 0.04, yB + 0.2, z2], [0.55, 0.55, 0.58], null, [0, 1, 0]));
    }
    for (let z = Math.ceil(ch.z0 / 30) * 30; z < ch.z1; z += 30) {
      const cx = track.getCurveXAt(z) + off, y = track.getHeightAt(z) + 5.4, g = gy(cx, z);
      B.concrete.addT(P.box, cx, (y - 1.7 + g) / 2, z, 0, 0, 0, 2.2, y - 1.7 - g + 0.8, 2.2, [0.42, 0.42, 0.43]);
      B.steel.addT(P.box, cx - 3.2, y + 3.0, z, 0, 0, 0, 0.2, 6, 0.2, [0.3, 0.3, 0.33]);   // catenary mast
      B.steel.addT(P.box, cx - 1.6, y + 5.8, z, 0, 0, 0, 3.4, 0.15, 0.15, [0.3, 0.3, 0.33]);
    }
  }

  if (e3tick()) yield;
  // ---------- city lights at street level (additive points) ----------
  if (hi) {
    const n = 520, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let k = 0;
    const palette = [[1.0, 0.75, 0.4], [1.0, 0.55, 0.25], [0.7, 0.85, 1.0], [1.0, 0.9, 0.8], [1.0, 0.35, 0.3], [0.5, 1.0, 0.8]];
    for (let i = 0; i < n; i++) {
      const z = ch.z0 + rnd() * E3.CL, a = 28 + Math.pow(rnd(), 1.2) * 560, sd = rnd() < 0.5 ? -1 : 1;
      const x = track.getCurveXAt(z) + sd * a;
      pos[k * 3] = x; pos[k * 3 + 1] = gy(x, z) + 0.8 + rnd() * 2; pos[k * 3 + 2] = z;
      const c = palette[Math.floor(rnd() * palette.length)], b = 0.4 + rnd() * 0.6;
      col[k * 3] = c[0] * b; col[k * 3 + 1] = c[1] * b; col[k * 3 + 2] = c[2] * b; k++;
    }
    const g = own.geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeBoundingSphere();
    ch.group.add(new THREE.Points(g, C.lightsMat));
  }
  if (!ads.empty) { const m = new THREE.Mesh(own.geo(ads.build()), C.adMat); m.matrixAutoUpdate = false; ch.group.add(m); }
  if (halos.length) {
    const hg = own.geo(new THREE.BufferGeometry()); hg.setAttribute('position', new THREE.Float32BufferAttribute(halos, 3)); hg.computeBoundingSphere();
    ch.group.add(new THREE.Points(hg, C.haloMat));
  }

}

// ============================================================================
// [p09_build]
// ============================================================================
// p09: env3DFactory.build / update / dispose   (lazy chunked world)
// ============================================================================

window.env3DFactory = {
  version: 2,
  lastBuildInfo: null,
  _cache: E3.cache,   // diagnostics only
  // free all cached heavy textures / IBL (call once when leaving the game page; normally never needed)
  releaseCaches() {
    const C = E3.cache;
    Object.keys(C.tex).forEach(k => { const v = C.tex[k]; if (v && v.dispose) v.dispose(); else if (v) Object.keys(v).forEach(kk => v[kk] && v[kk].dispose && v[kk].dispose()); });
    Object.keys(C.env).forEach(k => { if (C.env[k].tex) C.env[k].tex.dispose(); });
    if (C.shadowMap) { C.shadowMap.dispose(); C.shadowMap = null; }
    C.tex = {}; C.env = {};
  },
  build(scene, track, renderer) {
    // safety net: a previous world built into this scene is disposed (the game also calls env.dispose() itself)
    if (scene.userData && scene.userData.__env3d) { try { scene.userData.__env3d.dispose(); } catch (e) { /* already gone */ } scene.userData.__env3d = null; }
    const tStart = performance.now();
    const hi = !(window.world3DFactory && window.world3DFactory.quality === 'low');
    const T = E3THEMES[track.config.envType] || E3THEMES.alpine;
    const own = new E3Own();
    const group = new THREE.Group();
    group.name = 'env3d';
    scene.add(group);
    const info = { quality: hi ? 'high' : 'low', theme: T.key, stages: {} };
    const lap = (name, t) => { info.stages[name] = +(performance.now() - t).toFixed(1); };

    let t = performance.now();
    const noiseTex = e3NoiseTex(renderer);
    const roadTex = e3RoadTextures(T.road.kind, hi, renderer);
    const envInfo = e3Environment(renderer, T, noiseTex);
    lap('textures+ibl', t);

    const prev = { env: scene.environment, bg: scene.background, fog: scene.fog, exposure: renderer.toneMappingExposure };
    scene.environment = envInfo.tex;
    const fogCol = new THREE.Color(T.fog.color[0], T.fog.color[1], T.fog.color[2]);   // r128 mixes fog after tone-mapping/encoding: display-space colour
    const bgCol = fogCol.clone();
    scene.background = bgCol;
    const fog = new THREE.FogExp2(fogCol, T.fog.density);
    scene.fog = fog;
    renderer.toneMappingExposure = T.exposure;

    // ---- sky ----
    const skyMat = own.mat(e3SkyMaterial(T, noiseTex, hi));
    const sky = new THREE.Mesh(own.geo(new THREE.SphereGeometry(1400, 32, 20)), skyMat);
    sky.frustumCulled = false; sky.renderOrder = 1000;   // drawn last, depth = far plane: only pixels not covered by the world are shaded
    group.add(sky);

    // ---- lights ----
    const lights = e3Lights(T, hi, group, own);

    // ---- ground model, materials, lazily built chunks ----
    t = performance.now();
    const G = new E3Ground(track, T, hi);
    const terrMat = own.mat(e3TerrainMaterial(T, hi, noiseTex));
    const chunks = e3MakeChunks(G, group);
    const M = e3MakeMaterials(T, hi, roadTex, own, envInfo);
    const ctx = { scene, track, renderer, T, G, own, hi, group, chunks, M, noiseTex, sky, lights, terrMat, updaters: [], visHooks: [], disposers: [] };
    e3PropsInit(ctx);
    e3SpecialInit(ctx);
    lap('setup', t);

    // each chunk is built by one generator that yields whenever the time slice is used up (E3.deadline)
    function* chunkGen(ch) {
      E3.region = 'terrain'; yield* e3TerrainChunk(ctx, ch);
      E3.region = 'road'; ch.builders = e3ChunkBuilders();
      yield* e3RoadChunk(ctx, ch);
      E3.region = 'props'; yield* e3PropsChunk(ctx, ch);
      E3.region = 'special'; yield* e3SpecialChunk(ctx, ch);
      E3.region = 'flush'; yield* e3FlushChunk(ctx, ch);
      ch.ready = true;
    }
    const slice = (ch, budgetMs) => {
      if (ch.ready) return false;
      if (!ch.gen) ch.gen = chunkGen(ch);
      E3.deadline = budgetMs === Infinity ? Infinity : performance.now() + budgetMs;
      const t0 = performance.now();
      ch.gen.next();
      const d = performance.now() - t0; if (d > ctx.worstSliceMs) ctx.worstSliceMs = d;
      if (d > 8 && budgetMs !== Infinity) { (ctx.slowSlices = ctx.slowSlices || []).push([+d.toFixed(1), E3.region]); }
      if (ch.ready) ch.gen = null;
      return true;
    };
    ctx.worstSliceMs = 0;
    const ensureChunk = ch => { if (!ch.ready) slice(ch, Infinity); };
    ctx.ensureChunk = ensureChunk;

    // ---- runtime ----
    let time = 0;
    const AHEAD = hi ? 1500 : 1050, BEHIND = 220, NEEDNOW = 700, PREFETCH = AHEAD + 700;
    const c0 = chunks[0].c;
    const idxOf = z => e3clamp(Math.floor(z / E3.CL) - c0, 0, chunks.length - 1);
    let chunkMs = 0, chunkCount = 0;
    const env = {
      group, info, ground: G, theme: T,
      get chunksBuilt() { let n = 0; for (let i = 0; i < chunks.length; i++) if (chunks[i].ready) n++; return n; },
      // compile every shader program used by the world now (call behind the loading screen; later races reuse the programs)
      warmup(camera) { const t0 = performance.now(); try { renderer.compile(scene, camera); } catch (e) { /* ignore */ } return +(performance.now() - t0).toFixed(1); },
      // build every chunk now (QA / benchmarking only)
      buildAll() { const t0 = performance.now(); chunks.forEach(ensureChunk); return performance.now() - t0; },
      update(dt, focus) {
        time += dt;
        const fz = focus.z;
        sky.position.set(focus.x, 0, focus.z);
        skyMat.uniforms.uTime.value = time;
        skyMat.uniforms.uWind.value.set(time * T.sky.cloud.speed, time * T.sky.cloud.speed * 0.35);
        lights.place(focus);
        terrMat.userData.time.value = time;
        // lazy building: whatever is needed right now is built synchronously, the lookahead is spread over frames
        const iA = idxOf(fz - BEHIND), iB = idxOf(fz + NEEDNOW);
        for (let i = iA; i <= iB; i++) if (!chunks[i].ready) { const t0 = performance.now(); ensureChunk(chunks[i]); chunkMs += performance.now() - t0; chunkCount++; }
        const iP = idxOf(fz + PREFETCH);
        for (let i = iB + 1; i <= iP; i++) {
          if (chunks[i].ready) continue;
          slice(chunks[i], 2.2);          // lookahead: ~2 ms of work per frame, spread over many frames
          break;
        }
        for (let i = 0; i < chunks.length; i++) {
          const ch = chunks[i];
          const vis = ch.ready && ch.z1 > fz - BEHIND && ch.z0 < fz + AHEAD;
          if (ch.group.visible !== vis) ch.group.visible = vis;
          ch.dist = vis ? Math.max(0, ch.z0 - fz, fz - ch.z1) : 1e9;
          if (hi && ch.recv) { const r = ch.dist < 130; for (let k = 0; k < ch.recv.length; k++) if (ch.recv[k].receiveShadow !== r) ch.recv[k].receiveShadow = r; }
        }
        e3PropsVis(ctx, fz, chunks);
        for (let i = 0; i < ctx.visHooks.length; i++) ctx.visHooks[i](fz, chunks);
        for (let i = 0; i < ctx.updaters.length; i++) ctx.updaters[i](dt, time, focus);
      },
      stats() { return { slow: ctx.slowSlices, chunksBuilt: this.chunksBuilt, chunksTotal: chunks.length, syncChunkMs: chunkMs, syncChunks: chunkCount, worstSliceMs: ctx.worstSliceMs }; },
      dispose() {
        if (this.disposed) return; this.disposed = true;
        if (scene.userData && scene.userData.__env3d === this) scene.userData.__env3d = null;
        if (group.parent) group.parent.remove(group);
        ctx.disposers.forEach(f => f());
        lights.dispose();
        group.traverse(o => { if (o.isInstancedMesh && o.dispose) o.dispose(); });
        own.dispose();
        if (scene.environment === envInfo.tex) scene.environment = prev.env;
        if (scene.fog === fog) scene.fog = prev.fog;
        if (scene.background === bgCol) scene.background = prev.bg;
        renderer.toneMappingExposure = prev.exposure;
      }
    };
    env.update(0, new THREE.Vector3(track.getCurveXAt(80), track.getHeightAt(80), 80));
    if (scene.userData) scene.userData.__env3d = env;
    info.buildMs = +(performance.now() - tStart).toFixed(1);
    info.initialChunks = env.chunksBuilt;
    window.env3DFactory.lastBuildInfo = info;
    return env;
  }
};

})();
