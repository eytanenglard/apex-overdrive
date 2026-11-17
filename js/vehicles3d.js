// ============================================================================
// APEX OVERDRIVE - vehicles3d.js  (MODULE 1)
// Procedural, lofted, much more realistic vehicles. Replaces
// world3DFactory.createVehicle3D (same return names + new members, see
// dev/vehicles-NOTES.md). three.js r128 (global build). No external files.
// ============================================================================
(function () {
  'use strict';
  const F = window.world3DFactory;
  const T = window.THREE;
  if (!F || !T) { console.warn('[vehicles3d] THREE / world3DFactory missing - not installed'); return; }
  if (F.vehiclesV3) return;
  F.vehiclesV3 = true;
  F.createVehicle3DLegacy = F.createVehicle3D;
  // remember the game's renderer without needing any change in game.js (the lead may also set world3DFactory.renderer)
  if (F.initRendererAndIBL && !F._vehiclesInitWrapped) {
    const origInit = F.initRendererAndIBL; F._vehiclesInitWrapped = true;
    F.initRendererAndIBL = function (renderer, scene) { if (renderer && !F.vehiclesRenderer) F.vehiclesRenderer = renderer; return origInit.apply(this, arguments); };
  }

  const isLow = () => F.quality === 'low';
  const QK = () => (isLow() ? 'L' : 'H');
  const KITS = (F.vehicleKits = F.vehicleKits || {});
  const MATS = (F.vehicleMats = F.vehicleMats || {});
  const TEXS = (F.vehicleTexs = F.vehicleTexs || {});
  const PI = Math.PI;
  const IDENT = new T.Matrix4();

  // --------------------------------------------------------------------------
  // small math helpers
  // --------------------------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const V = (x, y, z) => new T.Vector3(x, y, z);

  // monotone cubic (PCHIP) through (xs, ys)
  function pchip(xs, ys) {
    const n = xs.length;
    if (n === 1) return () => ys[0];
    const h = [], d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0; while (x > xs[i + 1]) i++;
      const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
    };
  }
  // keys: [{z:.., a:.., b:..}, ...]  ->  at(z) => {a,b,...}
  function keyInterp(keys) {
    const ks = keys.slice().sort((p, q) => p.z - q.z);
    const zs = ks.map(k => k.z);
    const props = Object.keys(ks[0]).filter(p => p !== 'z');
    const fn = {};
    props.forEach(p => { fn[p] = pchip(zs, ks.map(k => (k[p] === undefined ? ks[0][p] : k[p]))); });
    return function (z) { const o = {}; for (let i = 0; i < props.length; i++) o[props[i]] = fn[props[i]](z); return o; };
  }

  // --------------------------------------------------------------------------
  // geometry utilities
  // --------------------------------------------------------------------------
  function ensureIndexed(g) {
    if (!g.index) { const n = g.attributes.position.count; const a = new Uint32Array(n); for (let i = 0; i < n; i++) a[i] = i; g.setIndex(new T.BufferAttribute(a, 1)); }
    return g;
  }
  function flipWinding(g) {
    ensureIndexed(g); const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true; return g;
  }
  function mirrorX(g) {
    const c = g.clone(); c.applyMatrix4(new T.Matrix4().makeScale(-1, 1, 1)); return flipWinding(c);
  }
  // merge [{g, m}] into ONE indexed BufferGeometry (position, normal, uv). Mirrored matrices flip winding.
  function merge(list) {
    let nv = 0, ni = 0;
    const prep = list.map(it => {
      const g = it.g; ensureIndexed(g);
      const used = new Int32Array(g.attributes.position.count).fill(-1);
      let cnt = 0; const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) if (used[ia[i]] < 0) used[ia[i]] = cnt++;
      nv += cnt; ni += ia.length;
      return { g, m: it.m || IDENT, used, cnt, c: it.c || null };
    });
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const hasCol = prep.some(it => it.g.attributes.color || it.c);
    const col = hasCol ? new Float32Array(nv * 3).fill(1) : null;
    const idx = nv > 65000 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    const v = new T.Vector3(), nm = new T.Matrix3();
    for (const it of prep) {
      const g = it.g, p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      nm.getNormalMatrix(it.m);
      const flip = it.m.determinant() < 0;
      for (let i = 0; i < p.count; i++) {
        const k = it.used[i]; if (k < 0) continue;
        v.fromBufferAttribute(p, i).applyMatrix4(it.m);
        const o = (vo + k) * 3; pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
        if (n) { v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); nor[o] = v.x; nor[o + 1] = v.y; nor[o + 2] = v.z; }
        if (u) { uv[(vo + k) * 2] = u.getX(i); uv[(vo + k) * 2 + 1] = u.getY(i); }
        if (col && g.attributes.color) { const c = g.attributes.color; col[o] = c.getX(i); col[o + 1] = c.getY(i); col[o + 2] = c.getZ(i); }
        else if (col && it.c) { col[o] = it.c[0]; col[o + 1] = it.c[1]; col[o + 2] = it.c[2]; }
      }
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i += 3) {
        const a = it.used[ia[i]] + vo, b = it.used[ia[i + 1]] + vo, c = it.used[ia[i + 2]] + vo;
        if (flip) { idx[io++] = a; idx[io++] = c; idx[io++] = b; } else { idx[io++] = a; idx[io++] = b; idx[io++] = c; }
      }
      vo += it.cnt;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new T.BufferAttribute(col, 3));
    out.setIndex(new T.BufferAttribute(idx, 1));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }
  const _q = new T.Quaternion(), _e = new T.Euler(), _s = new T.Vector3(), _p = new T.Vector3();
  // transform matrix: position, euler rotation (xyz), scale
  function xf(px, py, pz, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0, 'XYZ'); _q.setFromEuler(_e);
    _s.set(sx === undefined ? 1 : sx, sy === undefined ? (sx === undefined ? 1 : sx) : sy, sz === undefined ? (sx === undefined ? 1 : sx) : sz);
    _p.set(px || 0, py || 0, pz || 0);
    return new T.Matrix4().compose(_p, _q, _s);
  }
  const mirrorM = (m) => new T.Matrix4().makeScale(-1, 1, 1).multiply(m);

  // logical part keys -> shared material buckets (+ linear albedo tint via vertex colours) => fewer draw calls
  const KEYMAP = {
    liner: ['dark', 0.004], trim: ['dark', 0.016], interior: ['dark', 0.03], seat: ['dark', 0.045], glove: ['dark', 0.012], boot: ['dark', 0.016], rubber2: ['dark', 0.012],
    black: ['gloss', 0.018], carbon: ['gloss', 0.055],
    alu: ['metal', 0.40], steel: ['metal', 0.11], lensclear: ['glass', null]
  };
  const KEYTINT = (v) => [v, v, v * 1.08];
  class Kit {
    constructor() { this.b = {}; }
    add(key, g, m) {
      if (F.vehiclesDebug) { const a = g.attributes.position.array; for (let i = 0; i < a.length; i++) if (a[i] !== a[i]) { console.warn('[vehicles3d] NaN geometry for key', key); break; } }
      const km = KEYMAP[key]; let c = null;
      if (km) { key = km[0]; if (km[1] !== null) c = KEYTINT(km[1]); }
      (this.b[key] || (this.b[key] = [])).push({ g, m: m || null, c }); return this;
    }
    addM(key, g, m) { this.add(key, g, m); this.add(key, g, mirrorM(m || IDENT)); return this; } // + mirrored copy
    bake() { const o = {}; for (const k in this.b) o[k] = merge(this.b[k]); return o; }
  }

  // primitives -----------------------------------------------------------------
  const box = (w, h, d) => new T.BoxGeometry(w, h, d);
  function cyl(rt, rb, h, seg, open) { return new T.CylinderGeometry(rt, rb, h, seg || 12, 1, !!open); }
  function cylZ(rt, rb, h, seg, open) { const g = cyl(rt, rb, h, seg, open); g.rotateX(PI / 2); return g; } // axis along +Z (rt end at +Z)
  function cylX(rt, rb, h, seg, open) { const g = cyl(rt, rb, h, seg, open); g.rotateZ(-PI / 2); return g; } // axis along +X (rt end at +X)
  function ell(rx, ry, rz, ws, hs) { const g = new T.SphereGeometry(1, ws || 14, hs || 10); g.scale(rx, ry, rz); return g; }
  function roundBox(w, h, d, r, n) {
    n = n || 2; const g = new T.BoxGeometry(w, h, d, n, n, n);
    const p = g.attributes.position, hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r, v = new T.Vector3(), c = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      c.set(clamp(v.x, -hx, hx), clamp(v.y, -hy, hy), clamp(v.z, -hz, hz));
      v.sub(c); const l = v.length(); if (l > 1e-6) v.multiplyScalar(r / l);
      v.add(c); p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals(); return g;
  }
  // cylinder-like limb between two points (tapered)
  function limb(a, b, r0, r1, seg) {
    const dir = new T.Vector3().subVectors(b, a); const len = dir.length();
    const g = new T.CylinderGeometry(r1, r0, len, seg || 8, 1, false);
    const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
    const m = new T.Matrix4().compose(new T.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new T.Vector3(1, 1, 1));
    g.applyMatrix4(m); return g;
  }
  function tube(pts, r, tseg, rseg, closed) {
    const c = new T.CatmullRomCurve3(pts.map(p => (p.isVector3 ? p : V(p[0], p[1], p[2]))), !!closed, 'catmullrom', 0.3);
    return new T.TubeGeometry(c, tseg || 12, r, rseg || 6, !!closed);
  }
  function lathe(pts, seg) { return new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg || 24); }
  // a flat extruded shape (shape in XY, thickness along Z), centred on z
  function slab(shape, depth, bevel) {
    const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -depth / 2); return g;
  }
  function shapeOf(pts) { const s = new T.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]); s.closePath(); return s; }
  // ribbon (flat strip) following 3D points with given per-point side direction; used for decals / lines
  function strip(P, S, hw, N) {
    const n = P.length, pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i < n; i++) {
      const s = S[i], nn = N ? N[i] : V(0, 1, 0);
      pos.push(P[i].x - s.x * hw, P[i].y - s.y * hw, P[i].z - s.z * hw, P[i].x + s.x * hw, P[i].y + s.y * hw, P[i].z + s.z * hw);
      nor.push(nn.x, nn.y, nn.z, nn.x, nn.y, nn.z); uv.push(0, i / (n - 1), 1, i / (n - 1));
      if (i < n - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); return g;
  }

  // --------------------------------------------------------------------------
  // LOFT: sections along Z -> closed (or open) skin, with material groups
  //   zs: ascending z   ringFn(z,i) -> {x:[], y:[], f:[]}   (all rings equal length)
  //   o.matFn(i,j,allFlag) -> group index (or -1 to drop)   o.closed (default true)
  // returns array of BufferGeometry, one per group (shared vertex data, own index)
  // --------------------------------------------------------------------------
  function loft(zs, ringFn, o) {
    o = o || {};
    const S = zs.length, rings = zs.map((z, i) => ringFn(z, i)), N = rings[0].x.length;
    const closed = o.closed !== false, ng = o.nGroups || 1;
    const pos = new Float32Array((S * N + (o.capStart || o.capEnd ? 2 * (N + 1) : 0)) * 3);
    const uv = new Float32Array(pos.length / 3 * 2);
    for (let i = 0; i < S; i++) for (let j = 0; j < N; j++) {
      const k = i * N + j; pos[k * 3] = rings[i].x[j]; pos[k * 3 + 1] = rings[i].y[j]; pos[k * 3 + 2] = zs[i];
      uv[k * 2] = j / (N - 1); uv[k * 2 + 1] = i / (S - 1);
    }
    const idxAll = [], grp = [];
    for (let g = 0; g < ng; g++) grp.push([]);
    const segs = closed ? N : N - 1;
    const same = (a, b) => { const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2]; return dx * dx + dy * dy + dz * dz < 1e-9; };
    for (let i = 0; i < S - 1; i++) for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % N, a = i * N + j, b = i * N + j2, c = (i + 1) * N + j, d = (i + 1) * N + j2;
      const f = rings[i].f && rings[i + 1].f ? (rings[i].f[j] && rings[i].f[j2] && rings[i + 1].f[j] && rings[i + 1].f[j2] ? 1 : 0) : 0;
      const fa = rings[i].f && rings[i + 1].f ? (rings[i].f[j] || rings[i].f[j2] || rings[i + 1].f[j] || rings[i + 1].f[j2] ? 1 : 0) : 0;
      const gi = o.matFn ? o.matFn(i, j, f, zs[i], zs[i + 1], fa) : 0;
      if (gi < 0) continue;
      const t1 = !(same(a, b) || same(b, c) || same(a, c)), t2 = !(same(b, d) || same(d, c) || same(b, c));
      if (t1) { grp[gi].push(a, b, c); idxAll.push(a, b, c); }
      if (t2) { grp[gi].push(b, d, c); idxAll.push(b, d, c); }
    }
    // caps (flat, own vertices)
    const nor = new Float32Array(pos.length);
    let vc = S * N;
    const addCap = (i, dirz) => {
      const base = vc; let cx = 0, cy = 0;
      for (let j = 0; j < N; j++) { const k = i * N + j; pos[vc * 3] = pos[k * 3]; pos[vc * 3 + 1] = pos[k * 3 + 1]; pos[vc * 3 + 2] = pos[k * 3 + 2]; cx += pos[k * 3]; cy += pos[k * 3 + 1]; vc++; }
      pos[vc * 3] = cx / N; pos[vc * 3 + 1] = cy / N; pos[vc * 3 + 2] = zs[i]; const cen = vc; vc++;
      for (let k = base; k <= cen; k++) { nor[k * 3 + 2] = dirz; }
      const cg = o.capGroup || 0;
      for (let j = 0; j < segs; j++) { const j2 = (j + 1) % N; if (dirz > 0) grp[cg].push(cen, base + j, base + j2); else grp[cg].push(cen, base + j2, base + j); }
    };
    if (o.capEnd) addCap(S - 1, 1);
    if (o.capStart) addCap(0, -1);
    // normals over the skin only (caps keep their own)
    const tmp = new T.BufferGeometry();
    tmp.setAttribute('position', new T.BufferAttribute(pos, 3)); tmp.setIndex(idxAll);
    tmp.computeVertexNormals();
    const tn = tmp.attributes.normal.array;
    for (let k = 0; k < S * N * 3; k++) nor[k] = tn[k];
    // symmetric centre-line normals
    for (let i = 0; i < S; i++) for (let j = 0; j < N; j++) {
      const k = i * N + j;
      if (Math.abs(pos[k * 3]) < 1e-5) { nor[k * 3] = 0; const l = Math.hypot(nor[k * 3 + 1], nor[k * 3 + 2]) || 1; nor[k * 3 + 1] /= l; nor[k * 3 + 2] /= l; }
    }
    const pa = new T.BufferAttribute(pos, 3), na = new T.BufferAttribute(nor, 3), ua = new T.BufferAttribute(uv, 2);
    const out = [];
    for (let g = 0; g < ng; g++) {
      const geo = new T.BufferGeometry(); geo.setAttribute('position', pa); geo.setAttribute('normal', na); geo.setAttribute('uv', ua);
      geo.setIndex(new T.BufferAttribute(new Uint32Array(grp[g]), 1)); out.push(geo);
    }
    return out;
  }

  // half profile from control polygon with quadratic fillets.  P: [[x,y]..], fr: radius per corner, mm: subdivisions per corner (0 = 1 point)
  function halfPoly(P, fr, mm) {
    const X = [P[0][0]], Y = [P[0][1]];
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[i - 1], c = P[i], b = P[i + 1], m = mm[i] || 0, r = fr[i] || 0;
      const ax = a[0] - c[0], ay = a[1] - c[1], bx = b[0] - c[0], by = b[1] - c[1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (m === 0 || !(r > 1e-5) || la < 1e-5 || lb < 1e-5) { for (let k = 0; k <= m; k++) { X.push(c[0]); Y.push(c[1]); } continue; }
      const d = Math.min(r, 0.5 * la, 0.5 * lb);
      const q0x = c[0] + ax / la * d, q0y = c[1] + ay / la * d, q1x = c[0] + bx / lb * d, q1y = c[1] + by / lb * d;
      for (let k = 0; k <= m; k++) { const t = k / m, u = 1 - t; X.push(u * u * q0x + 2 * u * t * c[0] + t * t * q1x); Y.push(u * u * q0y + 2 * u * t * c[1] + t * t * q1y); }
    }
    const L = P[P.length - 1]; X.push(L[0]); Y.push(L[1]);
    return { x: X, y: Y };
  }
  // right half (bottom->top) -> closed ring (right half, then mirrored left half back down); closed=false returns just right+left of an open arch
  function ringFromHalf(h, fl) {
    const n = h.x.length, X = [], Y = [], Fl = [];
    for (let k = 0; k < n; k++) { X.push(h.x[k]); Y.push(h.y[k]); Fl.push(fl ? fl[k] : 0); }
    for (let k = n - 2; k >= 1; k--) { X.push(-h.x[k]); Y.push(h.y[k]); Fl.push(fl ? fl[k] : 0); }
    return { x: X, y: Y, f: Fl };
  }
  // open arch (greenhouse): right half bottom->top then mirrored left half top->bottom (no bottom closure), centre vertex shared
  function archFromHalf(h) {
    const n = h.x.length, X = [], Y = [];
    for (let k = 0; k < n; k++) { X.push(h.x[k]); Y.push(h.y[k]); }
    for (let k = n - 2; k >= 0; k--) { X.push(-h.x[k]); Y.push(h.y[k]); }
    return { x: X, y: Y };
  }
  // z sample list: base step + dense zones [[z0,z1,step],...] + forced z values
  function zSamples(z0, z1, step, zones, forced) {
    const set = [];
    for (let z = z0; z < z1 - 1e-6; z += step) set.push(z);
    set.push(z1);
    (zones || []).forEach(zn => { for (let z = zn[0]; z <= zn[1] + 1e-6; z += zn[2]) if (z > z0 && z < z1) set.push(z); });
    (forced || []).forEach(z => { if (z > z0 && z < z1) set.push(z); });
    set.sort((a, b) => a - b);
    const out = [];
    set.forEach(z => { if (!out.length || z - out[out.length - 1] > 0.0008) out.push(z); });
    return out;
  }

  // vertex-colour helper (used to mix bright / dark areas inside ONE mesh, e.g. rims)
  function paintGeo(g, r, gg, b) {
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3)); return g;
  }

  // --------------------------------------------------------------------------
  // ENVIRONMENT MAP for paint / glass / rims (built once, needs F.renderer)
  // --------------------------------------------------------------------------
  function getEnv() {
    if (F.vehicleEnv) return F.vehicleEnv;
    if (T.PMREMGenerator && !F._vehicleEnvFailed) {
      let rend = F.renderer || F.vehiclesRenderer, own = false;
      try {
        if (!rend) { rend = new T.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false }); own = true; }
        const pm = new T.PMREMGenerator(rend);
        const sc = new T.Scene();
        // sky dome with per-vertex HDR colours (r128 PMREM is RGBE-encoded: custom ShaderMaterials would not be encoded)
        const lats = [-90, -70, -50, -35, -24, -16, -10, -6, -4, -2.5, -1.5, -0.8, 0, 0.8, 1.5, 2.5, 4, 6, 9, 13, 19, 27, 37, 50, 65, 80, 90];
        const colAt = (deg) => {
          const h = Math.sin(deg * PI / 180);
          let r, g, b;
          if (h >= 0) {
            const t = Math.pow(h, 0.45);
            r = lerp(0.62, 0.13, t); g = lerp(0.60, 0.26, t); b = lerp(0.58, 0.62, t);
            const hb = h / 0.07, e = Math.exp(-hb * hb); r += 1.05 * e; g += 0.95 * e; b += 0.82 * e;
          } else {
            const t = clamp(-h * 3.2, 0, 1);
            r = lerp(0.22, 0.03, t); g = lerp(0.20, 0.032, t); b = lerp(0.18, 0.04, t);
            const hg = h / 0.05, e = Math.exp(-hg * hg); r += 1.1 * e; g += 1.0 * e; b += 0.85 * e;
          }
          return [r, g, b];
        };
        const SEG = 40, dp = [], dc = [], di = [];
        lats.forEach((deg, ri) => {
          const la = deg * PI / 180, c = colAt(deg);
          for (let s = 0; s <= SEG; s++) { const a = (s / SEG) * PI * 2; dp.push(Math.cos(la) * Math.cos(a) * 60, Math.sin(la) * 60, Math.cos(la) * Math.sin(a) * 60); dc.push(c[0], c[1], c[2]); }
          if (ri > 0) for (let s = 0; s < SEG; s++) { const a0 = (ri - 1) * (SEG + 1) + s, b0 = a0 + 1, c0 = ri * (SEG + 1) + s, d0 = c0 + 1; di.push(a0, b0, c0, b0, d0, c0); }
        });
        const dg = new T.BufferGeometry(); dg.setAttribute('position', new T.Float32BufferAttribute(dp, 3)); dg.setAttribute('color', new T.Float32BufferAttribute(dc, 3)); dg.setIndex(di);
        const dome = new T.Mesh(dg, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, fog: false }));
        const sunDir = new T.Vector3(0.55, 0.62, 0.56).normalize();
        const sunDisc = (rad, c) => { const m = new T.Mesh(new T.CircleGeometry(rad, 20), new T.MeshBasicMaterial({ color: new T.Color(c[0], c[1], c[2]), side: T.DoubleSide, fog: false })); m.position.copy(sunDir).multiplyScalar(55); m.lookAt(0, 0, 0); sc.add(m); };
        sunDisc(9, [0.9, 0.8, 0.6]); sunDisc(3.2, [5, 4.5, 3.4]);
        sc.add(dome);
        const box = (w, h, x, y, z, ry, rx, c) => {
          const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(c, c, c * 0.97), side: T.DoubleSide }));
          m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); sc.add(m);
        };
        box(34, 7, 0, 16, 0, 0, PI / 2, 3.2);      // long overhead softbox
        box(24, 9, 19, 5.5, 0, PI / 2, 0, 1.5);     // side softboxes
        box(24, 9, -19, 5.5, 0, PI / 2, 0, 1.5);
        box(20, 6, 0, 6, -22, 0, 0, 1.2);           // rear
        box(20, 6, 0, 6, 22, 0, 0, 0.9);            // front
        // PMREM render targets belong to ONE WebGL context. The game also has a separate showroom renderer,
        // so read the result back into a plain DataTexture (RGBE, CubeUV) that every renderer can use.
        const rt = pm.fromScene(sc, 0.03);
        const tw = rt.width, th = rt.height, buf = new Uint8Array(tw * th * 4);
        rend.readRenderTargetPixels(rt, 0, 0, tw, th, buf);
        const dt = new T.DataTexture(buf, tw, th, T.RGBAFormat, T.UnsignedByteType);
        dt.mapping = T.CubeUVReflectionMapping; dt.encoding = T.RGBEEncoding; dt.minFilter = T.NearestFilter; dt.magFilter = T.NearestFilter;
        dt.generateMipmaps = false; dt.flipY = false; dt.name = 'vehicleEnv'; dt.needsUpdate = true;
        F.vehicleEnv = dt;
        pm.dispose(); rt.dispose();
        if (own) { rend.dispose(); if (rend.forceContextLoss) rend.forceContextLoss(); }
        // refresh materials created before the env existed
        for (const k in MATS) { const m = MATS[k]; if (m.userData && m.userData.env) { m.envMap = F.vehicleEnv; m.needsUpdate = true; } }
      } catch (e) { F._vehicleEnvFailed = true; console.warn('[vehicles3d] env map failed, using the stock env map', e); }
    }
    return F.vehicleEnv || F.envMap || null;
  }

  // --------------------------------------------------------------------------
  // textures (cached)
  // --------------------------------------------------------------------------
  function canvasTex(key, w, h, draw, opts) {
    const k = key + '|' + w + 'x' + h;
    if (TEXS[k]) return TEXS[k];
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    if (opts && opts.noSRGB) t.encoding = T.LinearEncoding;
    TEXS[k] = t; return t;
  }
  function plateTex(txt) {
    return canvasTex('plate' + txt, 256, 64, (x, w, h) => {
      x.fillStyle = '#f4c20d'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#1b3f9a'; x.fillRect(0, 0, 26, h);
      x.fillStyle = '#fff'; x.fillRect(7, 14, 12, 3); x.fillRect(7, 47, 12, 3);
      x.strokeStyle = '#111'; x.lineWidth = 3; x.strokeRect(2, 2, w - 4, h - 4);
      x.fillStyle = '#111'; x.font = 'bold 44px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(txt, 142, 34);
    });
  }
  function roundelTex(num, bg, fg) {
    return canvasTex('roundel' + num + bg + fg, 128, 128, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.fillStyle = bg; x.beginPath(); x.arc(64, 64, 60, 0, 7); x.fill();
      x.fillStyle = fg; x.font = 'bold 74px Arial Black, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(num), 64, 70);
    });
  }
  function glowTex(key, stops) {
    return canvasTex('glow' + key, 128, 128, (x, w, h) => {
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      stops.forEach(s => g.addColorStop(s[0], s[1]));
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
  }
  function blobTex() {
    return canvasTex('blob', 128, 128, (x, w, h) => {
      const g = x.createRadialGradient(64, 64, 6, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,0.78)'); g.addColorStop(0.55, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
  }

  // --------------------------------------------------------------------------
  // materials (cached by key + quality). Every env-reactive material gets envMap
  // explicitly, so the game's scene.environment never leaks in.
  // --------------------------------------------------------------------------
  // r128 treats hex colours as linear: convert sRGB hex -> linear so paints look like the colours the designer picked
  function lin(m) { if (m.color) m.color.convertSRGBToLinear(); if (m.emissive) m.emissive.convertSRGBToLinear(); return m; }
  function mat(key, make) {
    const k = key + '|' + QK();
    if (MATS[k]) return MATS[k];
    const m = lin(make()); m.userData = m.userData || {};
    if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) { m.userData.env = true; m.envMap = getEnv(); }
    MATS[k] = m; return m;
  }
  function std(o) { return new T.MeshStandardMaterial(o); }
  function paintMat(hex, o) {
    o = o || {};
    return mat('paint' + hex + (o.tag || ''), () => {
      const c = new T.Color(hex);
      c.multiplyScalar(0.8);
      if (isLow()) return std({ color: c, metalness: o.metal === undefined ? 0.5 : o.metal, roughness: 0.36, envMapIntensity: 1.0 });
      return new T.MeshPhysicalMaterial({ color: c, metalness: o.metal === undefined ? 0.62 : o.metal, roughness: o.rough === undefined ? 0.27 : o.rough, clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: o.env || 1.0 });
    });
  }
  const MAT = {
    dark: () => mat('dark', () => std({ color: 0xffffff, vertexColors: true, metalness: 0.1, roughness: 0.78, envMapIntensity: 0.4 })),
    gloss: () => mat('gloss', () => std({ color: 0xffffff, vertexColors: true, metalness: 0.35, roughness: 0.38, envMapIntensity: 0.9 })),
    metal: () => mat('metal', () => std({ color: 0xffffff, vertexColors: true, metalness: 1.0, roughness: 0.3, envMapIntensity: 1.1 })),
    carbon: () => mat('carbon', () => std({ color: 0x15181d, metalness: 0.35, roughness: 0.42, envMapIntensity: 0.9 })),
    trim: () => mat('trim', () => std({ color: 0x0d0e11, metalness: 0.1, roughness: 0.55, envMapIntensity: 0.6 })),
    rubber: () => mat('rubber', () => std({ color: 0x0c0d0f, metalness: 0.0, roughness: 0.93, envMapIntensity: 0.18 })),
    chrome: () => mat('chrome', () => std({ color: 0xe3e8ee, metalness: 1.0, roughness: 0.1, envMapIntensity: 1.2 })),
    alu: () => mat('alu', () => std({ color: 0xa6afbb, metalness: 1.0, roughness: 0.28, envMapIntensity: 1.1 })),
    steel: () => mat('steel', () => std({ color: 0x59606b, metalness: 0.9, roughness: 0.42, envMapIntensity: 0.9 })),
    liner: () => mat('liner', () => std({ color: 0x07080a, metalness: 0.0, roughness: 1.0, envMapIntensity: 0.1 })),
    interior: () => mat('interior', () => std({ color: 0x15171c, metalness: 0.1, roughness: 0.85, envMapIntensity: 0.35 })),
    seat: () => mat('seat', () => std({ color: 0x1c1f27, metalness: 0.05, roughness: 0.8, envMapIntensity: 0.4 })),
    white: () => mat('white', () => std({ color: 0xf2f4f6, metalness: 0.15, roughness: 0.42, envMapIntensity: 0.9 })),
    black: () => mat('black', () => std({ color: 0x050607, metalness: 0.2, roughness: 0.38, envMapIntensity: 0.7 })),
    glass: () => mat('glass', () => (isLow()
      ? new T.MeshStandardMaterial({ color: 0x16222e, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.4, depthWrite: false, envMapIntensity: 1.2 })
      : new T.MeshPhysicalMaterial({ color: 0x0f1a26, metalness: 0.05, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.4, depthWrite: false, envMapIntensity: 1.9 }))),
    visor: () => mat('visor', () => new T.MeshStandardMaterial({ color: 0x3a4a5c, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false, envMapIntensity: 1.5 })),
    lensclear: () => mat('lensclear', () => new T.MeshStandardMaterial({ color: 0xcfe0f2, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.38, depthWrite: false, envMapIntensity: 1.8 }))
  };
  const SIDE = { dbl: (m) => { m.side = T.DoubleSide; return m; } };

  // --------------------------------------------------------------------------
  // WHEELS  (axle = local X, outer face towards +X; mirrored kit for -X side)
  // --------------------------------------------------------------------------
  function wheelParts(w) {
    const key = ['wk', w.R, w.W, w.rimR, w.style, w.lugs ? 1 : 0, QK()].join('|');
    if (KITS[key]) return KITS[key];
    const R = w.R, W = w.W, ri = w.rimR, sh = R - ri, hi = !isLow();
    const seg = hi ? 30 : 18;
    // --- tyre ---
    const half = [[ri + 0.012, 0.455], [ri + 0.55 * sh, 0.50], [R - 0.006, 0.36]];
    const prof = [[ri - 0.004, 0.4 * W], [ri - 0.004, -0.4 * W]];
    half.forEach(p => prof.push([p[0], -p[1] * W]));
    prof.push([R, 0]);
    for (let i = half.length - 1; i >= 0; i--) prof.push([half[i][0], half[i][1] * W]);
    prof.push([ri - 0.004, 0.4 * W]);
    const tyre = lathe(prof, seg); tyre.rotateZ(-PI / 2);
    let tyreG = tyre;
    if (w.lugs) {
      const list = [{ g: tyre, m: null }], n = hi ? 11 : 8;
      const lug = box(0.30 * W, 0.05, 0.085 * R * 1.3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * PI * 2;
        for (const s of [-1, 1]) {
          const aa = a + (s > 0 ? PI / n : 0);
          const m = xf(0, 0, 0, aa, 0, 0).multiply(xf(s * 0.255 * W, R + 0.006, 0, 0, 0, s * 0.18));
          list.push({ g: lug, m });
        }
      }
      tyreG = merge(list);
    }
    // --- flat variant: squash bottom, bulge sidewalls ---
    const flat = tyreG.clone(); const p = flat.attributes.position, nrm = flat.attributes.normal;
    const D = 0.27 * R, phi0 = 0.95;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rho = Math.hypot(y, z);
      if (rho < 1e-5) continue;
      const phi = Math.acos(clamp(-y / rho, -1, 1));
      if (phi < phi0) {
        const ww = Math.pow(Math.cos((phi / phi0) * PI / 2), 2);
        const t = clamp((rho - ri) / (R - ri), 0, 1.3);
        const nr = rho - D * ww * (0.25 + 0.75 * t) * (rho > ri + 0.01 ? 1 : 0.0);
        p.setXYZ(i, x * (1 + 0.20 * ww * t), y * nr / rho, z * nr / rho * (1 + 0.04 * ww));
      }
    }
    flat.computeVertexNormals(); flat.userData = { drop: D };
    // --- rim (bright spokes + dark barrel in one geometry via vertex colours) ---
    const rl = [];
    const bright = (g) => paintGeo(g, 1, 1, 1), dark = (g) => paintGeo(g, 0.16, 0.16, 0.18);
    // barrel wall (open tube, dark) + outer lip (bright)
    const wall = lathe([[ri - 0.034, 0.42 * W], [ri - 0.034, -0.36 * W]], hi ? 28 : 18); wall.rotateZ(-PI / 2);
    rl.push({ g: dark(wall) });
    const lip = lathe([[ri - 0.046, 0.43 * W], [ri - 0.012, 0.455 * W], [ri + 0.004, 0.42 * W], [ri - 0.034, 0.40 * W]], hi ? 28 : 18); lip.rotateZ(-PI / 2);
    rl.push({ g: bright(lip) });
    const style = w.style;
    const hubR = Math.max(0.045, 0.14 * R);
    // spoke helper: polygon in (radial, tangential) -> extruded axially, centred at axial offset ax, rotated by angle about X
    const SP = new T.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    const spoke = (pts, depth, ax, ang, bev) => { const g = slab(shapeOf(pts), depth, bev || 0); g.applyMatrix4(SP); g.applyMatrix4(xf(ax, 0, 0, ang, 0, 0)); return bright(g); };
    if (style === 'turbine') {
      const n = 10, rr = ri - 0.03;
      for (let i = 0; i < n; i++) rl.push({ g: spoke([[hubR * 0.9, -0.020], [rr, -0.034], [rr, 0.034], [hubR * 0.9, 0.020]], 0.075 * W / 0.3, 0.29 * W, (i / n) * PI * 2) });
    } else if (style === 'y5') {
      const n = 5, rr = ri - 0.03;
      for (let i = 0; i < n; i++) for (const s of [-1, 1]) rl.push({ g: spoke([[hubR * 0.8, -0.018], [rr, -0.036], [rr, 0.036], [hubR * 0.8, 0.018]], 0.07 * W / 0.3, 0.28 * W, (i / n) * PI * 2 + s * 0.20) });
    } else if (style === 'dish') {          // rally steel / beadlock: dished face + bolt ring + holes
      const face = lathe([[hubR * 0.7, 0.26 * W], [ri * 0.55, 0.30 * W], [ri - 0.05, 0.38 * W], [ri - 0.034, 0.42 * W]], hi ? 28 : 18); face.rotateZ(-PI / 2);
      rl.push({ g: bright(face) });
      const holeG = cylX(0.085 * R / 0.4, 0.085 * R / 0.4, 0.014, 6);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2 + 0.26; rl.push({ g: dark(holeG.clone()), m: xf(0.305 * W, Math.cos(a) * ri * 0.66, Math.sin(a) * ri * 0.66, 0, 0, 0) }); }
      const bolt = cylX(0.018, 0.018, 0.024, 5);
      const nb = hi ? 10 : 6;
      for (let i = 0; i < nb; i++) { const a = (i / nb) * PI * 2; rl.push({ g: bright(bolt.clone()), m: xf(0.43 * W, Math.cos(a) * (ri - 0.025), Math.sin(a) * (ri - 0.025), 0, 0, 0) }); }
    } else {                                  // 'blade': 7 swept blades (futuristic)
      const n = 7, rr = ri - 0.03;
      for (let i = 0; i < n; i++) rl.push({ g: spoke([[hubR * 0.8, -0.03], [rr * 0.7, -0.012], [rr, -0.050], [rr, 0.020], [rr * 0.7, 0.030], [hubR * 0.8, 0.03]], 0.06 * W / 0.3, 0.28 * W, (i / n) * PI * 2) });
    }
    // hub: centre-lock nut / cap
    rl.push({ g: bright(cylX(hubR, hubR * 1.05, 0.05 * W / 0.3 + 0.02, 10)), m: xf(0.31 * W, 0, 0) });
    rl.push({ g: dark(cylX(hubR * 0.45, hubR * 0.45, 0.02, 6)), m: xf(0.35 * W, 0, 0) });
    const rim = merge(rl.map(it => ({ g: it.g, m: it.m || null })));
    // --- brake hardware (static, stays when the wheel comes off) ---
    const disc = lathe([[ri * 0.42, -0.012], [ri * 0.87, -0.014], [ri * 0.87, 0.014], [ri * 0.42, 0.012]], hi ? 18 : 12); disc.rotateZ(-PI / 2);
    const hubStub = merge([{ g: cylX(hubR * 1.05, hubR * 1.05, 0.12 * W + 0.04, 8), m: xf(0.12 * W, 0, 0) }, { g: cylX(ri * 0.45, ri * 0.45, 0.05, 12), m: xf(-0.02, 0, 0) }]);
    const caliper = roundBox(0.075 * W / 0.3 + 0.06, ri * 0.40, ri * 0.52, 0.018, 2);
    const out = { tyre: tyreG, tyreFlat: flat, rim, rimM: mirrorX(rim), tyreM: tyreG, tyreFlatM: flat, disc, hubStub, caliper, drop: D, w };
    KITS[key] = out; return out;
  }

  // --------------------------------------------------------------------------
  // DRIVER : helmet kit (head frame: +Z forward, +Y up, origin = head centre)
  // --------------------------------------------------------------------------
  function filterTris(g, keep) {           // drop triangles whose centroid fails keep(cx,cy,cz)
    ensureIndexed(g);
    const p = g.attributes.position, ia = g.index.array, out = [];
    for (let i = 0; i < ia.length; i += 3) {
      const a = ia[i], b = ia[i + 1], c = ia[i + 2];
      const cx = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, cy = (p.getY(a) + p.getY(b) + p.getY(c)) / 3, cz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
      if (keep(cx, cy, cz)) out.push(a, b, c);
    }
    g.setIndex(out); return g;
  }
  function helmetKit(Rh, hi) {
    const key = 'helmet|' + Rh.toFixed(3) + QK();
    if (KITS[key]) return KITS[key];
    const sx = 0.94, sy = 1.0, sz = 1.12;
    const ws = hi ? 22 : 14, hs = hi ? 15 : 9;
    const inOpening = (x, y, z, m) => { m = m || 0; if (z < 0.18 * Rh) return false; const ax = (0.64 * Rh + m) * sx, ay = (0.54 * Rh + m); const dx = x / ax, dy = (y - 0.04 * Rh) / ay; return dx * dx + dy * dy < 1; };
    // shell with face opening and neck hole
    const shell = new T.SphereGeometry(Rh, ws, hs); shell.scale(sx, sy, sz);
    { const yc = -0.60 * Rh, p = shell.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < yc) p.setY(i, yc - 0.0001); }
    filterTris(shell, (x, y, z) => !inOpening(x, y, z) && y > -0.60 * Rh);
    // visor lens (slightly larger than the opening)
    const vis = new T.SphereGeometry(Rh * 1.014, ws, hs); vis.scale(sx, sy, sz);
    filterTris(vis, (x, y, z) => inOpening(x, y, z, 0.035 * Rh));
    // opening trim (rubber seal) following the ellipse on the sphere
    const tp = []; for (let i = 0; i < 28; i++) {
      const a = (i / 28) * PI * 2, x = Math.cos(a) * 0.64 * Rh * sx, y = 0.04 * Rh + Math.sin(a) * 0.54 * Rh;
      const zz = Math.sqrt(Math.max(0.0001, 1 - (x / (Rh * sx)) ** 2 - (y / Rh) ** 2)) * Rh * sz; tp.push(V(x, y, zz));
    }
    const trim = tube(tp, 0.011 * Rh / 0.19, 24, 4, true);
    // inner liner (visible from the side through the opening)
    const liner = new T.SphereGeometry(Rh * 0.955, hi ? 14 : 10, hi ? 9 : 6); liner.scale(sx, sy, sz); flipWinding(liner);
    // stripe over the top (ribbon on the shell)
    const SP = [], SS = [], SN = [];
    for (let i = 0; i <= 22; i++) {
      const a = -0.25 + (i / 22) * (PI + 0.75); // from forward-up over the top to the back
      const y = Math.sin(a) * Rh * 1.006, z = Math.cos(a) * Rh * sz * 1.006;
      if (a < 0.45) continue;
      SP.push(V(0, y, z)); SS.push(V(1, 0, 0)); SN.push(V(0, Math.sin(a), Math.cos(a)));
    }
    const stripe = strip(SP, SS, 0.12 * Rh, SN);
    // hinge screws
    const screw = cylX(0.025 * Rh / 0.19, 0.025 * Rh / 0.19, 0.02, 8);
    // face cap (photo) sits behind the opening
    const Rf = Rh * 0.9, psi = 1.0, rings = 5, segs = 22;
    const fpos = [], fnor = [], fuv = [], fidx = [], xr = Rf * Math.sin(psi);
    fpos.push(0, 0, Rf); fnor.push(0, 0, 1); fuv.push(0.5, 0.5);
    for (let r = 1; r <= rings; r++) for (let s = 0; s < segs; s++) {
      const ps = (r / rings) * psi, al = (s / segs) * PI * 2;
      const x = Rf * Math.sin(ps) * Math.cos(al), y = Rf * Math.sin(ps) * Math.sin(al), z = Rf * Math.cos(ps);
      fpos.push(x, y, z); fnor.push(x / Rf, y / Rf, z / Rf); fuv.push(0.5 + x / (2 * xr), 0.5 + y / (2 * xr));
    }
    for (let s = 0; s < segs; s++) fidx.push(0, 1 + s, 1 + (s + 1) % segs);
    for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
      const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + (s + 1) % segs, c = 1 + r * segs + s, d = 1 + r * segs + (s + 1) % segs;
      fidx.push(a, c, b, b, c, d);
    }
    const face = new T.BufferGeometry();
    face.setAttribute('position', new T.Float32BufferAttribute(fpos, 3)); face.setAttribute('normal', new T.Float32BufferAttribute(fnor, 3)); face.setAttribute('uv', new T.Float32BufferAttribute(fuv, 2)); face.setIndex(fidx);
    // neck + collar
    const neck = cyl(0.60 * Rh, 0.66 * Rh, 0.6 * Rh, 12); neck.translate(0, -0.85 * Rh, -0.05 * Rh);
    const out = { shell, vis, trim, liner, stripe, screw, face, neck, Rh, Rf, xr, sx, sy, sz };
    KITS[key] = out; return out;
  }
  // cartoon face (fallback when there is no photo) -------------------------------------------
  function cartoonFaceTex(expr, skin) {
    return canvasTex('face' + expr + skin, 256, 256, (x, w, h) => {
      x.fillStyle = skin || '#f0c29a'; x.fillRect(0, 0, w, h);
      const g = x.createRadialGradient(128, 120, 30, 128, 128, 150); g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(120,60,20,0.28)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = '#3b2616'; x.beginPath(); x.ellipse(128, 40, 120, 52, 0, 0, PI); x.fill();   // brow shadow / hairline
      // eyes
      const eye = (cx) => {
        x.fillStyle = '#fff'; x.beginPath(); x.ellipse(cx, 112, 26, expr === 'happy' ? 16 : 22, 0, 0, 7); x.fill();
        x.fillStyle = '#2a1608'; x.beginPath(); x.arc(cx + 2, 114, 12, 0, 7); x.fill();
        x.fillStyle = '#fff'; x.beginPath(); x.arc(cx + 7, 109, 4, 0, 7); x.fill();
      };
      eye(86); eye(170);
      x.strokeStyle = '#3b2616'; x.lineWidth = 8; x.lineCap = 'round';
      x.beginPath(); x.moveTo(58, expr === 'ouch' ? 70 : 78); x.lineTo(110, expr === 'ouch' ? 82 : 72); x.moveTo(198, expr === 'ouch' ? 70 : 78); x.lineTo(146, expr === 'ouch' ? 82 : 72); x.stroke();
      x.fillStyle = '#d9826c'; x.beginPath(); x.ellipse(128, 150, 9, 13, 0, 0, 7); x.fill();
      x.strokeStyle = '#7a2d1c'; x.lineWidth = 8;
      x.beginPath();
      if (expr === 'happy') { x.arc(128, 168, 48, 0.12 * PI, 0.88 * PI); x.stroke(); x.fillStyle = '#fff'; x.beginPath(); x.arc(128, 168, 46, 0.14 * PI, 0.86 * PI); x.fill(); }
      else if (expr === 'ouch') { x.fillStyle = '#5b0d12'; x.ellipse(128, 202, 24, 20, 0, 0, 7); x.fill(); }
      else if (expr === 'cool') { x.arc(128, 188, 34, 0.2 * PI, 0.8 * PI); x.stroke(); }
      else { x.moveTo(98, 200); x.quadraticCurveTo(128, 214, 158, 200); x.stroke(); }
    });
  }
  // expression overlays drawn over photo or cartoon (transparent png-ish)
  function overlayTex(expr, lite) {
    return canvasTex('ovl' + expr + (lite ? 'L' : ''), 256, 256, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      if (expr === 'cool') {
        x.fillStyle = 'rgba(8,10,16,0.96)';
        x.beginPath(); x.roundRect ? x.roundRect(40, 84, 78, 52, 18) : x.rect(40, 84, 78, 52); x.fill();
        x.beginPath(); x.roundRect ? x.roundRect(138, 84, 78, 52, 18) : x.rect(138, 84, 78, 52); x.fill();
        x.fillRect(112, 96, 32, 9);
        x.fillStyle = 'rgba(255,255,255,0.35)'; x.fillRect(50, 92, 28, 6); x.fillRect(148, 92, 28, 6);
      } else if (expr === 'ouch') {
        x.fillStyle = 'rgba(255,50,50,0.42)'; x.beginPath(); x.arc(52, 156, 30, 0, 7); x.arc(204, 156, 30, 0, 7); x.fill();
        x.strokeStyle = '#22110a'; x.lineWidth = 11; x.lineCap = 'round';
        if (!lite) [86, 170].forEach(cx => { x.beginPath(); x.moveTo(cx - 20, 100); x.lineTo(cx + 20, 140); x.moveTo(cx + 20, 100); x.lineTo(cx - 20, 140); x.stroke(); });
        if (!lite) { x.fillStyle = '#5b0d12'; x.beginPath(); x.ellipse(128, 192, 26, 20, 0, 0, 7); x.fill(); x.fillStyle = '#e24d57'; x.beginPath(); x.ellipse(128, 200, 14, 8, 0, 0, 7); x.fill(); }
        x.fillStyle = 'rgba(120,205,255,0.95)'; x.beginPath(); x.moveTo(196, 62); x.quadraticCurveTo(222, 100, 196, 112); x.quadraticCurveTo(170, 100, 196, 62); x.fill();
        x.strokeStyle = '#ffdd33'; x.lineWidth = 7; for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(44 + i * 14, 62); x.lineTo(60 + i * 14, 84); x.stroke(); }
      } else if (expr === 'happy') {
        x.fillStyle = 'rgba(255,110,140,0.40)'; x.beginPath(); x.arc(54, 158, 28, 0, 7); x.arc(202, 158, 28, 0, 7); x.fill();
        x.strokeStyle = '#ffe14a'; x.lineWidth = 8; x.lineCap = 'round';
        const spark = (cx, cy, r) => { x.beginPath(); x.moveTo(cx - r, cy); x.lineTo(cx + r, cy); x.moveTo(cx, cy - r); x.lineTo(cx, cy + r); x.stroke(); };
        spark(50, 84, 15); spark(206, 84, 15); spark(128, 56, 11);
      }
    });
  }

  // --------------------------------------------------------------------------
  // human body parts (static pose), merged into suit / accent / glove / boot buckets
  // --------------------------------------------------------------------------
  function humanKit(kit, P, sc) {
    sc = sc || 1;
    const r = (v) => v * sc;
    const hip = P.hip, ch = P.chest, hd = P.neck;
    // pelvis + abdomen + chest + shoulders + neck
    kit.add('suit', ell(r(0.215), r(0.15), r(0.19), 10, 7), xf(hip.x, hip.y, hip.z));
    kit.add('suit', limb(hip, ch, r(0.19), r(0.20), 9));
    const dirUp = new T.Vector3().subVectors(P.neck, ch).normalize();
    const chestM = new T.Matrix4().compose(ch.clone().add(dirUp.clone().multiplyScalar(r(0.05))), new T.Quaternion().setFromUnitVectors(V(0, 1, 0), dirUp), V(1, 1, 1));
    kit.add('suit', ell(r(0.255), r(0.235), r(0.17), 12, 8), chestM);
    kit.add('accent', box(r(0.30), r(0.07), r(0.012)), new T.Matrix4().compose(ch.clone().add(V(0, r(0.06), r(0.17))), new T.Quaternion().setFromUnitVectors(V(0, 1, 0), dirUp), V(1, 1, 1)));
    [-1, 1].forEach(s => {
      const sh = P.shoulder(s), el = P.elbow(s), wr = P.wrist(s), kn = P.knee(s), an = P.ankle(s), hp = V(hip.x + s * r(0.105), hip.y, hip.z);
      kit.add('suit', ell(r(0.085), r(0.085), r(0.085), 8, 6), xf(sh.x, sh.y, sh.z));
      kit.add('suit', limb(sh, el, r(0.075), r(0.062), 8));
      kit.add('suit', limb(el, wr, r(0.062), r(0.05), 8));
      kit.add('accent', limb(sh.clone().lerp(el, 0.5), sh.clone().lerp(el, 0.62), r(0.0775), r(0.0775), 8));
      kit.add('glove', ell(r(0.058), r(0.052), r(0.074), 8, 6), xf(wr.x, wr.y, wr.z + r(0.02), 0.3, 0, 0));
      if (kn) {
        kit.add('suit', limb(hp, kn, r(0.115), r(0.088), 8));
        kit.add('suit', ell(r(0.088), r(0.088), r(0.088), 8, 6), xf(kn.x, kn.y, kn.z));
        kit.add('suit', limb(kn, an, r(0.086), r(0.062), 8));
        kit.add('boot', ell(r(0.075), r(0.065), r(0.14), 8, 6), xf(an.x, an.y - r(0.03), an.z + r(0.12)));
      }
    });
    kit.add('suit', cyl(r(0.07), r(0.085), r(0.16), 8), xf(hd.x, hd.y, hd.z));
  }

  // --------------------------------------------------------------------------
  // CAR SHELL: lower body loft (arches, door trough) + greenhouse loft
  // --------------------------------------------------------------------------
  function halfSideX(h, y) { let best = -1; for (let k = 0; k < h.x.length - 1; k++) { const y0 = h.y[k], y1 = h.y[k + 1]; if ((y - y0) * (y - y1) <= 0 && Math.abs(y1 - y0) > 1e-6) { const x = h.x[k] + (h.x[k + 1] - h.x[k]) * (y - y0) / (y1 - y0); if (x > best) best = x; } } return best; }
  function halfTopY(h, x) { let best = -1; for (let k = 0; k < h.x.length - 1; k++) { const x0 = h.x[k], x1 = h.x[k + 1]; if ((x - x0) * (x - x1) <= 0 && Math.abs(x1 - x0) > 1e-6) { const y = h.y[k] + (h.y[k + 1] - h.y[k]) * (x - x0) / (x1 - x0); if (y > best) best = y; } } return best; }

  function carShell(K, sp) {
    const hi = !isLow(), at = keyInterp(sp.keys);
    const mmA1 = hi ? 2 : 1, mmA2 = hi ? 3 : 2, mmA3 = hi ? 3 : 2;
    const cnt = [1, 1, 1, mmA1 + 1, mmA2 + 1, mmA3 + 1, 1, 2, 2, 1];
    const start = []; let s0 = 0; cnt.forEach(c => { start.push(s0); s0 += c; });
    const jBottom = start[3] + mmA1, hN = s0;     // dark below this segment, half length
    const arches = sp.arches.map(a => { const yb = at(a.z).yb; return Object.assign({ rs: Math.sqrt(Math.max(0.0001, a.R * a.R - Math.pow(a.cy - yb, 2))) }, a); });
    const halves = {};
    function half(z) {
      const p = at(z), xin = Math.min(p.xin, p.wb - 0.05);
      const tr = clamp(p.wi / 0.12, 0, 1), wi = p.wi < 0.02 ? 0 : p.wi;
      const yA4 = lerp(p.ytc, p.yt, tr), yF = lerp(p.ytc, p.yf, tr);
      const m3x = lerp(p.wt * 0.55, 0.5 * (p.wt + wi), tr), m3y = lerp(p.ytc + (p.yt - p.ytc) * 0.14, p.yt, tr);
      const P = [[0, p.yb], [xin - 0.03, p.yb], [xin + 0.02, p.yb], [p.wb, p.yb], [p.w, p.ys], [p.wt, p.yt], [m3x, m3y], [wi, yA4], [wi, yF], [0, yF]];
      const fr = [0, 0, 0, p.rb, p.rs, p.rt, 0, 0.025, 0.025, 0], mm = [0, 0, 0, mmA1, mmA2, mmA3, 0, 1, 1, 0];
      const h = halfPoly(P, fr, mm), f = new Array(h.x.length).fill(0);
      for (const a of arches) {
        const dz = z - a.z;
        if (Math.abs(dz) < a.rs) {
          const archY = a.cy + Math.sqrt(a.R * a.R - dz * dz);
          for (let k = 0; k < start[6]; k++) if (h.x[k] >= xin + 0.005 && h.y[k] < archY) { h.y[k] = Math.min(archY, p.yt - 0.03); f[k] = 1; }
        }
      }
      h.f = f; h.wi = wi; return h;
    }
    const ring = (z) => { const h = half(z); return ringFromHalf(h, h.f); };
    const forced = [], zones = (sp.zones || []).slice();
    arches.forEach(a => { forced.push(a.z - a.rs - 0.0012, a.z - a.rs + 0.0012, a.z + a.rs - 0.0012, a.z + a.rs + 0.0012); zones.push([a.z - a.rs, a.z + a.rs, hi ? 0.1 : 0.16]); });
    (sp.forced || []).forEach(z => forced.push(z));
    zones.push([sp.z1 - 0.5, sp.z1, hi ? 0.1 : 0.16], [sp.z0, sp.z0 + 0.45, hi ? 0.1 : 0.16]);
    const zs = zSamples(sp.z0, sp.z1, hi ? 0.32 : 0.4, zones, forced);
    const Nh = 2 * hN - 2;
    const matFn = (i, j, flag, za, zb, fany) => {
      const hs = j < hN - 1 ? j : 2 * hN - 3 - j;
      if (hs === 0 || (hs < start[3] && !fany)) return -1;                 // invisible floor
      const wi = at((za + zb) / 2).wi;
      if (wi > 0.05 && hs >= start[7]) return 2;                 // inner door wall / floor
      if (hs < jBottom || flag) return 1;                        // underbody + arch liner
      return 0;
    };
    const geos = loft(zs, ring, { nGroups: 3, matFn, capStart: true, capEnd: true, capGroup: 0 });
    K.add('paint', geos[0]); K.add('liner', geos[1]); K.add('interior', geos[2]);
    const out = { at, half, arches, zs, start };
    // --- greenhouse ---
    if (sp.gh) {
      const g = sp.gh, ga = keyInterp(g.keys), rr = g.rr || 0.17, mmR = hi ? 3 : 2;
      const gring = (z) => {
        const p = ga(z);
        const P = [[p.wb, p.yb], [p.wm, p.yb + (p.yr - p.yb) * (g.fm || 0.5)], [p.wr, p.yr], [0, p.yrc]];
        return archFromHalf(halfPoly(P, [0, 0, Math.min(rr, Math.max(0.01, (p.yr - p.yb) * 0.9)), 0], [0, 0, mmR, 0]));
      };
      const gz = zSamples(g.z0, g.z1, hi ? 0.14 : 0.22, g.zones || [], g.forced || []);
      const hG = 3 + mmR + 1 + 1 - 0; // right half points: G0,G1,fillet(mmR+1),G3 = 3 + mmR + 1
      const hh = 2 + (mmR + 1) + 1;
      const gm = (i, j, f, za, zb) => {
        const hs = j < hh - 1 ? j : 2 * hh - 3 - j, zm = (za + zb) / 2;
        const ws = zm > g.zRoofF, rw = zm < g.zRoofR;
        const bpil = g.zB && zm < g.zB[0] && zm > g.zB[1];
        if (bpil && hs <= 4) return 1;
        if (ws) { if (hs === 2 || hs === 3) return 1; return 0; }          // A pillar paint, glass otherwise
        if (rw) { if (g.solidQuarter && hs <= 3) return 1; if (hs === 2 || hs === 3) return 1; return 0; }
        return hs >= 2 ? 1 : 0;                                              // roof panel + rails
      };
      const gg = loft(gz, gring, { nGroups: 2, matFn: gm, closed: false });
      K.add('glass', gg[0]); K.add(g.roofMat || 'paint', gg[1]);
      out.gz = gz; out.ga = ga;
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // helpers shared by all car builders
  // --------------------------------------------------------------------------
  function newRaw() { return { K: new Kit(), Lt: new Kit(), dec: [], wheelDefs: [], exhausts: [], beams: [], anchors: {} }; }

  function addWheels(raw, w) {            // w: {R,rimR,style,lugs,front:{x,z,W},rear:{x,z,W}}
    [[w.front, true], [w.rear, false]].forEach(([d, isFront]) => {
      [1, -1].forEach(side => {
        raw.wheelDefs.push({ x: side * d.x, y: w.R, z: d.z, side, isFront, R: w.R, W: d.W, rimR: w.rimR, style: w.style, lugs: !!w.lugs });
      });
    });
  }
  // brake hardware + hub (static), built per wheel def
  function brakeHardware(raw, wd, calColor) {
    const wp = wheelParts({ R: wd.R, W: wd.W, rimR: wd.rimR, style: wd.style, lugs: wd.lugs });
    const at = wd.side;
    raw.K.add('alu', wp.disc, xf(wd.x, wd.y, wd.z));
    raw.K.add('steel', wp.hubStub, xf(wd.x, wd.y, wd.z, 0, 0, 0, at, 1, 1));
    const th = -0.55, rr = wd.rimR * 0.62;
    raw.K.add(calColor || 'caliper', wp.caliper, xf(wd.x, wd.y + Math.cos(th) * rr, wd.z + Math.sin(th) * rr, th, 0, 0));
  }

  // seat (bucket) + belts
  function bucketSeat(K, x, y, z, s) {
    s = s || 1;
    K.add('seat', roundBox(0.50 * s, 0.10 * s, 0.56 * s, 0.04, 2), xf(x, y, z));
    K.add('seat', roundBox(0.50 * s, 0.66 * s, 0.14 * s, 0.05, 2), xf(x, y + 0.34 * s, z - 0.27 * s, -0.16, 0, 0));
    [-1, 1].forEach(sd => K.add('seat', roundBox(0.075 * s, 0.50 * s, 0.17 * s, 0.03, 1), xf(x + sd * 0.235 * s, y + 0.28 * s, z - 0.19 * s, -0.16, 0, 0)));
    K.add('seat', roundBox(0.30 * s, 0.22 * s, 0.10 * s, 0.04, 2), xf(x, y + 0.74 * s, z - 0.32 * s, -0.2, 0, 0));
  }

  // key helpers
  const kb = (z, w, wb, ys, yb, yt, ytc, wt, wi, yf, rb, rs, rt, xin) => ({ z, w, wb, ys, yb, yt, ytc, wt, wi, yf, rb, rs, rt, xin });
  const gk = (z, yb, yr, yrc, wb, wm, wr) => ({ z, yb, yr, yrc, wb, wm, wr });
  const NEXT_PLACEHOLDER = null;

  // --------------------------------------------------------------------------
  // GT3 COUPE  (apex_viper)
  // --------------------------------------------------------------------------
  function buildGT3(cfg) {
    const raw = newRaw(), K = raw.K, Lt = raw.Lt, hi = !isLow();
    const sp = {
      z0: -2.52, z1: 2.46,
      keys: [
        kb(2.46, .56, .34, .30, .20, .42, .42, .42, 0, .42, .05, .10, .12, .20),
        kb(2.36, .80, .52, .34, .17, .52, .52, .62, 0, .52, .07, .14, .16, .30),
        kb(2.15, .97, .70, .40, .13, .66, .60, .78, 0, .60, .08, .16, .17, .45),
        kb(1.85, 1.05, .80, .50, .13, .92, .72, .95, 0, .72, .08, .22, .18, .77),
        kb(1.45, 1.09, .83, .56, .13, 1.00, .76, .995, 0, .76, .08, .24, .18, .77),
        kb(1.08, 1.07, .83, .58, .13, .97, .79, .975, 0, .79, .08, .24, .17, .77),
        kb(0.92, 1.04, .83, .60, .13, .91, .84, .94, 0, .84, .08, .22, .14, .77),
        kb(0.84, 1.03, .83, .62, .13, .885, .86, .93, 0, .86, .08, .18, .10, .77),
        kb(0.70, 1.03, .83, .62, .13, .875, .875, .975, .875, .34, .08, .16, .04, .77),
        kb(-0.65, 1.03, .83, .62, .13, .875, .875, .975, .875, .34, .08, .16, .04, .77),
        kb(-0.80, 1.05, .83, .62, .13, .93, .93, .985, 0, .93, .08, .20, .12, .77),
        kb(-1.13, 1.12, .84, .62, .13, .97, .96, 1.04, 0, .96, .08, .22, .14, .77),
        kb(-1.50, 1.17, .86, .64, .13, 1.00, .98, 1.08, 0, .98, .08, .22, .14, .77),
        kb(-1.87, 1.14, .84, .62, .13, .99, 1.0, 1.04, 0, 1.0, .08, .20, .14, .77),
        kb(-2.20, 1.07, .80, .60, .17, .95, .99, .96, 0, .99, .08, .20, .14, .60),
        kb(-2.40, 1.04, .78, .60, .22, .92, .96, .92, 0, .96, .07, .14, .12, .50),
        kb(-2.52, .98, .72, .60, .28, .88, .91, .84, 0, .91, .05, .09, .09, .40)
      ],
      arches: [{ z: 1.45, cy: 0.40, R: 0.455 }, { z: -1.50, cy: 0.40, R: 0.455 }],
      zones: [[0.64, 0.92, 0.07], [-0.92, -0.6, 0.07]],
      gh: {
        z0: -1.30, z1: 0.84, zRoofF: 0.14, zRoofR: -0.45, rr: 0.17, fm: 0.5, solidQuarter: true,
        keys: [
          gk(0.84, .875, .878, .88, .93, .93, .93), gk(0.62, .875, .985, .995, .93, .91, .87), gk(0.40, .875, 1.10, 1.115, .93, .89, .80),
          gk(0.14, .875, 1.25, 1.275, .93, .87, .72), gk(-0.15, .875, 1.285, 1.31, .93, .87, .70), gk(-0.45, .885, 1.275, 1.30, .94, .88, .70),
          gk(-0.75, .93, 1.20, 1.22, .96, .90, .76), gk(-1.00, .95, 1.09, 1.105, .98, .93, .84), gk(-1.30, .968, .972, .975, 1.0, .98, .96)
        ], zones: [[0.1, 0.9, 0.1]]
      }
    };
    const shell = carShell(K, sp);
    // wheels
    addWheels(raw, { R: 0.40, rimR: 0.292, style: 'turbine', front: { x: 0.965, z: 1.45, W: 0.30 }, rear: { x: 0.99, z: -1.50, W: 0.37 } });
    if (hi) raw.wheelDefs.forEach(wd => brakeHardware(raw, wd, 'caliper'));
    raw.caliperColor = 0xd8141c; raw.rimColor = 0xd6dbe2;

    // ---- interior ----
    const dx = 0.38;
    K.add('interior', roundBox(1.78, 0.20, 0.46, 0.06, 2), xf(0, 0.74, 0.62, -0.12, 0, 0));
    if (hi) { K.add('trim', roundBox(0.46, 0.15, 0.14, 0.04, 2), xf(dx, 0.87, 0.52));
    K.add('interior', roundBox(0.26, 0.20, 1.0, 0.05, 2), xf(0, 0.44, -0.10));
    bucketSeat(K, dx, 0.34, -0.20); bucketSeat(K, -dx, 0.34, -0.20); } else bucketSeat(K, dx, 0.34, -0.20);
    const swM = xf(dx, 0.80, 0.34, -0.45, 0, 0);
    K.add('trim', new T.TorusGeometry(0.15, 0.021, 8, hi ? 22 : 14), swM);
    K.add('trim', cyl(0.045, 0.045, 0.04, 10), xf(dx, 0.80, 0.335, 1.1, 0, 0));
    K.add('trim', limb(V(dx, 0.80, 0.34), V(dx, 0.70, 0.55), 0.025, 0.03, 6));
    const cageA = (a, b) => { if (hi) K.add('steel', limb(V(a[0], a[1], a[2]), V(b[0], b[1], b[2]), 0.022, 0.022, 6)); };
    [-1, 1].forEach(s => {
      cageA([s * 0.84, 0.40, -0.66], [s * 0.78, 1.14, -0.64]); cageA([s * 0.78, 1.14, -0.64], [s * 0.64, 1.20, 0.10]);
      cageA([s * 0.82, 0.86, 0.78], [s * 0.64, 1.20, 0.12]); cageA([s * 0.90, 0.60, 0.66], [s * 0.90, 0.64, -0.62]); cageA([s * 0.90, 0.78, 0.55], [s * 0.90, 0.80, -0.62]);
    });
    cageA([-0.78, 1.14, -0.64], [0.78, 1.14, -0.64]); cageA([-0.78, 1.14, -0.64], [0.78, 0.5, -0.66]); cageA([0.78, 1.14, -0.64], [-0.78, 0.5, -0.66]);

    // ---- driver ----
    const drv = { hip: V(dx, 0.42, -0.22), chest: V(dx, 0.66, -0.19), neck: V(dx, 0.90, -0.17), head: V(dx, 1.06, -0.15), Rh: 0.19, type: 'car' };
    const wristY = 0.82;
    drv.shoulder = (s) => V(dx + s * 0.205, 0.84, -0.19); drv.elbow = (s) => V(dx + s * 0.30, 0.64, 0.02); drv.wrist = (s) => V(dx + s * 0.15, wristY, 0.33);
    drv.knee = (s) => V(dx + s * 0.13, 0.62, 0.30); drv.ankle = (s) => V(dx + s * 0.13, 0.30, 0.62);
    humanKit(raw.K, { hip: drv.hip, chest: drv.chest, neck: drv.neck, shoulder: drv.shoulder, elbow: drv.elbow, wrist: drv.wrist, knee: drv.knee, ankle: drv.ankle }, 1.12);
    raw.driver = drv;
    // ---- exterior details (placed on the real lofted surface) ----
    const hf = (z) => shell.half(z);
    const topY = (z, x) => halfTopY(hf(z), Math.abs(x));
    const sideX = (z, y) => halfSideX(hf(z), y);
    const slopeZ = (z, x) => Math.atan2(topY(z + 0.06, x) - topY(z - 0.06, x), 0.12);
    const ST = V(0, 1, 0);
    // splitter + endplates
    const spl = slab(shapeOf([[-0.78, -2.50], [0.78, -2.50], [0.99, -2.34], [1.03, -2.02], [-1.03, -2.02], [-0.99, -2.34]]), 0.035, 0.006);
    K.add('trim', spl, xf(0, 0.115, 0, -PI / 2, 0, 0));
    [-1, 1].forEach(s => K.add('trim', roundBox(0.018, 0.075, 0.42, 0.006, 2), xf(s * 1.03, 0.15, 2.22)));
    // front fascia: big intake + side intakes + grille slats
    K.add('black', roundBox(0.80, 0.15, 0.10, 0.05, 2), xf(0, 0.31, 2.44, 0.0, 0, 0));
    [-1, 1].forEach(s => { K.add('black', roundBox(0.20, 0.10, 0.16, 0.04, 2), xf(s * 0.60, 0.31, 2.30, 0, s * 0.45, 0)); });
    if (hi) for (let i = 0; i < 4; i++) K.add('carbon', box(0.70, 0.012, 0.03), xf(0, 0.265 + i * 0.03, 2.495));
    // headlight pods (on the fender tops), LED rings
    [-1, 1].forEach(s => {
      const z = 2.06, x = 0.70, y = topY(z, x), sl = slopeZ(z, x);
      K.add('chrome', ell(0.17, 0.085, 0.17, 12, 6), xf(s * x, y - 0.012, z, -sl, 0, 0));
      Lt.add('head', ell(0.125, 0.045, 0.125, 12, 6), xf(s * x, y + 0.048, z, -sl, 0, 0));
      Lt.add('drl', tube([[-0.13, 0, 0.03], [-0.06, 0, 0.10], [0.06, 0, 0.10], [0.13, 0, 0.03]].map(p => V(p[0], p[1], p[2])), 0.011, 8, 5), xf(s * x, y + 0.045, z, -sl, 0, 0));
      raw.beams.push({ x: s * x, z: 2.2, w: 3.0, len: 14 });
      // amber indicator
      Lt.add('amber', box(0.10, 0.025, 0.05), xf(s * 0.9, topY(1.96, 0.9) - 0.004, 1.96, -slopeZ(1.96, 0.9), 0, 0));
    });
    // hood: louvre vents, hood pins, centre stripe, shut line
    if (hi) for (let i = 0; i < 5; i++) K.add('black', box(0.34, 0.01, 0.022), xf(0, topY(1.55 + i * 0.045, 0.1) + 0.006, 1.55 + i * 0.045, -slopeZ(1.55 + i * 0.045, 0.1), 0, 0));
    [[-0.38, 2.22], [0.38, 2.22], [-0.44, 1.02], [0.44, 1.02]].forEach(p => K.add('chrome', cyl(0.022, 0.022, 0.014, 8), xf(p[0], topY(p[1], p[0]) + 0.004, p[1], -slopeZ(p[1], p[0]), 0, 0)));
    const stripe = (z0, z1, hw, yOff, n) => {
      const P = [], S = [], Nn = [];
      for (let i = 0; i <= n; i++) { const z = lerp(z0, z1, i / n), y = topY(z, 0.001) + yOff; P.push(V(0, y, z)); S.push(V(1, 0, 0)); Nn.push(V(0, 1, 0)); }
      return strip(P, S, hw, Nn);
    };
    K.add('white', stripe(0.97, 2.40, 0.13, 0.006, 16)); K.add('white', stripe(-2.46, -1.28, 0.13, 0.006, 12));
    {
      const ga = shell.ga, P = [], S = [], Nn = [];
      for (let i = 0; i <= 14; i++) { const z = lerp(-0.42, 0.13, i / 14), p = ga(z); P.push(V(0, p.yrc + 0.004, z)); S.push(V(1, 0, 0)); Nn.push(V(0, 1, 0)); }
      K.add('white', strip(P, S, 0.13, Nn));
    }
    // mirrors
    if (hi) [-1, 1].forEach(s => {
      const mx = 1.05, my = 0.97, mz = 0.55;
      K.add('paint', roundBox(0.20, 0.105, 0.13, 0.045, 3), xf(s * mx, my, mz, 0, s * 0.18, 0));
      K.add('black', roundBox(0.15, 0.085, 0.02, 0.012, 2), xf(s * (mx - 0.01), my, mz - 0.07, 0, s * 0.18 + PI, 0));
      K.add('black', limb(V(s * 0.93, 0.88, 0.62), V(s * 0.99, 0.94, mz), 0.017, 0.015, 6));
    });
    // door shut lines + handles + side intakes + number roundels
    [-1, 1].forEach(s => {
      const line = (pts, hw) => {
        const P = [], S = [], Nn = [];
        pts.forEach((q, i) => { const x = sideX(q[0], q[1]) + 0.004; P.push(V(s * x, q[1], q[0])); });
        for (let i = 0; i < P.length; i++) { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; const t = b.clone().sub(a).normalize(); const n = V(s, 0, 0); S.push(n.clone().cross(t).normalize()); Nn.push(n); }
        return strip(P, S, hw, Nn);
      };
      const pts = [];
      for (let i = 0; i <= 8; i++) pts.push([0.62 - 0.02 * Math.sin(i / 8 * PI), lerp(0.26, 0.82, i / 8)]);
      for (let i = 1; i <= 8; i++) pts.push([lerp(0.62, -0.55, i / 8), 0.82 + 0.0]);
      if (hi) {
      K.add('black', line(pts.slice(0, 9), 0.0045)); K.add('black', line([[0.60, 0.26], [0.2, 0.235], [-0.2, 0.235], [-0.55, 0.26]], 0.0045)); K.add('black', line([[-0.55, 0.26], [-0.56, 0.4], [-0.56, 0.6], [-0.56, 0.82]], 0.0045));
      K.add('black', roundBox(0.012, 0.045, 0.16, 0.005, 2), xf(s * (sideX(-0.38, 0.66) + 0.003), 0.66, -0.38));
      K.add('black', roundBox(0.03, 0.26, 0.36, 0.03, 3), xf(s * (sideX(-1.02, 0.60) - 0.005), 0.60, -1.02));
      for (let i = 0; i < 5; i++) K.add('carbon', box(0.034, 0.012, 0.30), xf(s * (sideX(-1.02, 0.52 + i * 0.045) + 0.0), 0.50 + i * 0.045, -1.02));
      }
      let rx = 0; [0.34, 0.42, 0.50, 0.58, 0.66].forEach(yy => { rx = Math.max(rx, sideX(0.04, yy)); }); rx += 0.006;
      raw.dec.push({ geo: new T.PlaneGeometry(0.34, 0.34), m: xf(s * rx, 0.50, 0.04, 0, s * PI / 2, 0), roundel: [7, '#ffffff', '#0b1220'] });
    });
    raw.dec.push({ geo: new T.PlaneGeometry(0.30, 0.30), m: xf(0, topY(1.35, 0) + 0.008, 1.35, -slopeZ(1.35, 0) - PI / 2, 0, 0), roundel: [7, '#ffffff', '#0b1220'] });
    // tail: lights, plate, exhaust, diffuser
    [-1, 1].forEach(s => {
      Lt.add('tail', roundBox(0.46, 0.09, 0.05, 0.03, 3), xf(s * 0.45, 0.70, -2.52));
      Lt.add('tail', tube([[-0.22, 0, 0], [0, 0.0, 0.02], [0.22, 0.01, 0]].map(p => V(p[0], p[1], p[2])), 0.012, 6, 5), xf(s * 0.45, 0.60, -2.545));
      K.add('chrome', lathe([[0.062, 0.0], [0.062, 0.14], [0.05, 0.14], [0.05, 0.0]], 12), xf(s * 0.30, 0.40, -2.47, -PI / 2, 0, 0));
      K.add('black', cyl(0.05, 0.05, 0.08, 10), xf(s * 0.30, 0.40, -2.53, PI / 2, 0, 0));
      raw.exhausts.push({ x: s * 0.30, y: 0.40, z: -2.62, r: 0.8 });
    });
    Lt.add('tail', roundBox(0.5, 0.03, 0.04, 0.012, 2), xf(0, 0.70, -2.53));
    raw.dec.push({ geo: new T.PlaneGeometry(0.50, 0.125), m: xf(0, 0.50, -2.53, 0, PI, 0), plate: '12-345-67' });
    K.add('carbon', slab(shapeOf([[-0.86, 2.22], [0.86, 2.22], [0.74, 2.58], [-0.74, 2.58]]), 0.03, 0.004), xf(0, 0.25, 0, -PI / 2, 0, 0));
    if (hi) for (let i = -3; i <= 3; i++) K.add('carbon', box(0.016, 0.12, 0.36), xf(i * 0.2, 0.22, -2.36, 0.0, 0, 0));
    // engine-cover louvres
    if (hi) for (let i = 0; i < 6; i++) K.add('black', box(0.7, 0.01, 0.025), xf(0, topY(-1.45 - i * 0.07, 0.1) + 0.006, -1.45 - i * 0.07, -slopeZ(-1.45 - i * 0.07, 0.1), 0, 0));
    // REAR WING (swan-neck uprights + two-element plane + endplates)
    {
      const wy = 1.30, wz = -2.36;
      const af = shapeOf([[0.0, 0.0], [0.03, -0.035], [0.20, -0.06], [0.48, -0.045], [0.52, 0.0], [0.48, 0.012], [0.2, 0.018], [0.03, 0.022]]);
      const plane = slab(af, 1.84, 0.004); plane.translate(-0.26, 0, 0); plane.rotateY(PI / 2);
      K.add('carbon', plane, xf(0, wy, wz + 0.26, 0.20, 0, 0));
      const flap = slab(shapeOf([[0.0, 0.0], [0.02, -0.02], [0.22, -0.035], [0.26, 0.0], [0.22, 0.01]]), 1.78, 0.003); flap.translate(-0.13, 0, 0); flap.rotateY(PI / 2);
      K.add('paint', flap, xf(0, wy + 0.085, wz - 0.06, 0.55, 0, 0));
      [-1, 1].forEach(s => {
        K.add('carbon', slab(shapeOf([[-0.30, -0.10], [0.20, -0.13], [0.28, 0.13], [-0.22, 0.12]]), 0.022, 0.003), xf(s * 0.92, wy + 0.04, wz - 0.02, 0, PI / 2, 0));
        K.add('paint', slab(shapeOf([[-0.26, -0.07], [0.17, -0.09], [0.24, 0.09], [-0.19, 0.08]]), 0.006, 0.0), xf(s * 0.934, wy + 0.04, wz - 0.02, 0, PI / 2, 0));
        K.add('carbon', limb(V(s * 0.55, topY(-2.05, 0.55) - 0.01, -2.02), V(s * 0.55, wy - 0.04, wz + 0.05), 0.026, 0.02, 8));
        K.add('carbon', limb(V(s * 0.55, wy - 0.04, wz + 0.05), V(s * 0.55, wy - 0.01, wz - 0.12), 0.02, 0.018, 8));
      });
    }
    // wipers
    if (hi) [0.0, 1.0].forEach((o, i) => K.add('black', limb(V(0.05 - 0.0 + i * 0.0, 0.89, 0.80), V(0.62 + i * 0.0 - 0.0, 0.95, 0.77), 0.007, 0.007, 4)));
    raw.rimColor = 0x9ea6b4; raw.flameColor = 0x45b6ff;
    raw.dims = { halfWidth: 1.17, length: 5.0, height: 1.30, wheelRadius: 0.40, wheelTrack: 0.98, frontZ: 1.45, rearZ: -1.50, zFront: 2.46, zRear: -2.52 };
    raw.shell = shell; raw.sp = sp;
    return raw;
  }


  // --------------------------------------------------------------------------
  // RALLY PICK-UP  (titan_buggy)
  // --------------------------------------------------------------------------
  function buildTruck(cfg) {
    const raw = newRaw(), K = raw.K, Lt = raw.Lt, hi = !isLow();
    const sp = {
      z0: -2.66, z1: 2.68,
      keys: [
        kb(2.68, .96, .84, .95, .60, 1.16, 1.16, .88, 0, 1.16, .09, .14, .14, .55),
        kb(2.58, 1.04, .90, 1.00, .54, 1.22, 1.22, .96, 0, 1.22, .09, .14, .14, .60),
        kb(2.30, 1.08, .92, 1.02, .48, 1.27, 1.25, 1.00, 0, 1.25, .09, .14, .12, .70),
        kb(1.95, 1.18, .96, 1.02, .46, 1.40, 1.25, 1.09, 0, 1.25, .09, .14, .16, .80),
        kb(1.62, 1.26, .99, 1.00, .46, 1.46, 1.27, 1.15, 0, 1.27, .09, .12, .16, .80),
        kb(1.28, 1.20, .97, 1.00, .46, 1.40, 1.28, 1.10, 0, 1.28, .09, .14, .14, .80),
        kb(1.10, 1.12, .95, 1.02, .46, 1.34, 1.30, 1.05, 0, 1.30, .08, .12, .10, .80),
        kb(0.98, 1.11, .95, 1.04, .46, 1.40, 1.40, 1.07, 0, 1.40, .08, .10, .06, .80),
        kb(0.90, 1.11, .95, 1.04, .46, 1.42, 1.42, 1.07, 1.0, .80, .08, .10, .04, .80),
        kb(-0.46, 1.11, .95, 1.04, .46, 1.42, 1.42, 1.07, 1.0, .80, .08, .10, .04, .80),
        kb(-0.56, 1.11, .95, 1.04, .46, 1.34, 1.34, 1.07, 0, 1.34, .08, .10, .06, .80),
        kb(-0.64, 1.12, .95, 1.04, .46, 1.31, 1.31, 1.08, .98, .90, .08, .10, .04, .80),
        kb(-1.20, 1.14, .96, 1.04, .46, 1.31, 1.31, 1.09, .98, .90, .08, .10, .04, .80),
        kb(-1.55, 1.27, .99, 1.02, .46, 1.46, 1.31, 1.16, .98, .90, .09, .12, .14, .80),
        kb(-2.00, 1.14, .96, 1.02, .46, 1.31, 1.31, 1.09, .98, .90, .08, .10, .04, .80),
        kb(-2.52, 1.10, .94, 1.02, .52, 1.31, 1.31, 1.05, .98, .90, .08, .10, .04, .80),
        kb(-2.60, 1.08, .92, 1.0, .56, 1.30, 1.30, 1.04, .98, .90, .08, .10, .04, .80),
        kb(-2.66, 1.04, .88, .98, .58, 1.28, 1.28, 1.0, 0, 1.28, .08, .12, .10, .70)
      ],
      arches: [{ z: 1.62, cy: 0.56, R: 0.69 }, { z: -1.55, cy: 0.56, R: 0.69 }],
      zones: [[0.8, 1.15, 0.07], [-0.7, -0.4, 0.08], [-2.7, -2.5, 0.07]],
      gh: {
        z0: -0.60, z1: 1.06, zRoofF: 0.36, zRoofR: -0.42, rr: 0.2, fm: 0.5, solidQuarter: false, zB: [-0.05, -0.2],
        keys: [
          gk(-0.60, 1.40, 1.42, 1.43, 1.02, 1.02, 1.02), gk(-0.56, 1.42, 1.62, 1.63, 1.03, 1.0, .96), gk(-0.46, 1.42, 1.84, 1.87, 1.03, .98, .88),
          gk(0.0, 1.42, 1.90, 1.93, 1.03, .98, .84), gk(0.36, 1.42, 1.90, 1.93, 1.03, .98, .84), gk(0.62, 1.42, 1.72, 1.74, 1.03, .99, .90),
          gk(0.85, 1.42, 1.52, 1.53, 1.05, 1.02, 1.0), gk(1.06, 1.38, 1.40, 1.41, 1.05, 1.05, 1.05)
        ], zones: [[-0.6, 1.06, 0.1]]
      }
    };
    const shell = carShell(K, sp);
    addWheels(raw, { R: 0.56, rimR: 0.355, style: 'dish', lugs: true, front: { x: 1.03, z: 1.62, W: 0.44 }, rear: { x: 1.03, z: -1.55, W: 0.46 } });
    if (hi) raw.wheelDefs.forEach(wd => brakeHardware(raw, wd, 'caliper'));
    raw.caliperColor = 0x222831; raw.rimColor = 0x6b7380; raw.accentColor = 0x1b1f27;
    // interior: seats, dash, wheel, cage
    const dx = 0.40;
    K.add('interior', roundBox(1.9, 0.26, 0.5, 0.06, 2), xf(0, 1.10, 0.86, -0.1, 0, 0));
    if (hi) { K.add('trim', roundBox(0.5, 0.17, 0.14, 0.04, 2), xf(dx, 1.26, 0.74));
    K.add('interior', roundBox(0.3, 0.28, 1.2, 0.05, 2), xf(0, 0.88, 0.0));
    bucketSeat(K, dx, 0.84, 0.0, 1.1); bucketSeat(K, -dx, 0.84, 0.0, 1.1);
    K.add('seat', roundBox(1.8, 0.45, 0.14, 0.05, 2), xf(0, 1.20, -0.50)); } else bucketSeat(K, dx, 0.84, 0.0, 1.1);
    K.add('trim', new T.TorusGeometry(0.17, 0.024, 8, hi ? 22 : 14), xf(dx, 1.16, 0.58, -0.7, 0, 0));
    K.add('trim', limb(V(dx, 1.12, 0.60), V(dx, 1.0, 0.8), 0.03, 0.035, 6));
    const cage = (a, b) => { if (hi) K.add('steel', limb(V(a[0], a[1], a[2]), V(b[0], b[1], b[2]), 0.026, 0.026, 6)); };
    [-1, 1].forEach(s => {
      cage([s * 0.98, 0.85, -0.48], [s * 0.90, 1.78, -0.46]); cage([s * 0.90, 1.78, -0.46], [s * 0.82, 1.80, 0.55]); cage([s * 0.96, 1.30, 0.86], [s * 0.82, 1.80, 0.56]);
      cage([s * 1.0, 1.0, 0.7], [s * 1.0, 1.05, -0.45]); cage([s * 1.0, 1.25, 0.7], [s * 1.0, 1.28, -0.45]);
    });
    cage([-0.90, 1.78, -0.46], [0.90, 1.78, -0.46]); cage([-0.82, 1.80, 0.56], [0.82, 1.80, 0.56]); cage([-0.9, 1.78, -0.46], [0.9, 1.0, -0.47]);
    const drv = { hip: V(dx, 0.98, -0.08), chest: V(dx, 1.22, -0.05), neck: V(dx, 1.46, -0.03), head: V(dx, 1.62, -0.02), Rh: 0.19, type: 'car' };
    drv.shoulder = (s) => V(dx + s * 0.205, 1.40, -0.05); drv.elbow = (s) => V(dx + s * 0.31, 1.18, 0.15); drv.wrist = (s) => V(dx + s * 0.16, 1.22, 0.49);
    drv.knee = (s) => V(dx + s * 0.13, 1.12, 0.40); drv.ankle = (s) => V(dx + s * 0.13, 0.78, 0.72);
    humanKit(K, { hip: drv.hip, chest: drv.chest, neck: drv.neck, shoulder: drv.shoulder, elbow: drv.elbow, wrist: drv.wrist, knee: drv.knee, ankle: drv.ankle }, 1.12);
    raw.driver = drv;

    // ---- exterior ----
    const hf = (z) => shell.half(z);
    const topY = (z, x) => halfTopY(hf(z), Math.abs(x));
    const sideX = (z, y) => halfSideX(hf(z), y);
    const slopeZ = (z, x) => Math.atan2(topY(z + 0.06, x) - topY(z - 0.06, x), 0.12);
    // front: grille, bumper, lights, skid plate
    K.add('black', roundBox(1.46, 0.46, 0.14, 0.05, 3), xf(0, 0.92, 2.64));
    if (hi) for (let i = 0; i < 5; i++) K.add('carbon', box(1.36, 0.028, 0.05), xf(0, 0.78 + i * 0.09, 2.715));
    K.add('black', roundBox(2.0, 0.26, 0.34, 0.07, 3), xf(0, 0.62, 2.60));
    K.add('steel', limb(V(-0.8, 0.5, 2.62), V(0.8, 0.5, 2.62), 0.035, 0.035, 8)); K.add('steel', roundBox(1.2, 0.07, 0.5, 0.03, 2), xf(0, 0.44, 2.45, 0.1, 0, 0));
    [-1, 1].forEach(s => {
      Lt.add('head', roundBox(0.34, 0.13, 0.06, 0.04, 3), xf(s * 0.82, 1.02, 2.68, 0, s * 0.18, 0));
      Lt.add('drl', roundBox(0.34, 0.035, 0.05, 0.015, 2), xf(s * 0.82, 0.89, 2.68, 0, s * 0.18, 0));
      Lt.add('head', ell(0.07, 0.07, 0.04, 10, 6), xf(s * 0.62, 0.62, 2.78));
      Lt.add('amber', box(0.12, 0.04, 0.04), xf(s * 1.0, 0.64, 2.70, 0, s * 0.5, 0));
      K.add('trim', roundBox(0.40, 0.19, 0.04, 0.05, 3), xf(s * 0.82, 1.02, 2.67, 0, s * 0.18, 0));
      raw.beams.push({ x: s * 0.82, z: 2.9, w: 3.4, len: 15 });
    });
    // hood: vents, scoop, black decal band
    for (let i = 0; i < 4; i++) K.add('black', box(0.5, 0.012, 0.03), xf(0, topY(1.82 - i * 0.06, 0.2) + 0.006, 1.82 - i * 0.06, -slopeZ(1.82 - i * 0.06, 0.2), 0, 0));
    K.add('black', roundBox(0.78, 0.08, 0.5, 0.03, 2), xf(0, topY(2.18, 0.2) + 0.02, 2.18, -slopeZ(2.18, 0.2), 0, 0));
    K.add('black', slab(shapeOf([[-0.46, -2.55], [0.46, -2.55], [0.40, -1.0], [-0.40, -1.0]]), 0.006), xf(0, 1.19, 0, -PI / 2 + 0.0, 0, 0));
    // flares around the arches (bolt-on look)
    raw.wheelDefs.forEach(wd => {
      const s = wd.side, R2 = 0.69 + 0.03;
      const fl = new T.TorusGeometry(R2, 0.038, 4, hi ? 20 : 12, PI); fl.rotateY(PI / 2);
      K.add('black', fl, xf(s * (sideX(wd.z, 0.9) - 0.01), wd.y, wd.z));
      K.add('black', cyl(0.012, 0.012, 0.03, 6), xf(s * (sideX(wd.z, 1.1) + 0.0), wd.y + 0.5, wd.z + 0.4, 0, 0, PI / 2));
      K.add('black', roundBox(0.02, 0.3, 0.32, 0.01, 2), xf(wd.x, 0.48, wd.z - 0.62));
    });
    // side steps, mirrors, handles, snorkel
    [-1, 1].forEach(s => {
      K.add('steel', roundBox(0.14, 0.05, 1.5, 0.02, 2), xf(s * 1.10, 0.52, 0.2));
      if (hi) K.add('black', roundBox(0.20, 0.17, 0.12, 0.05, 2), xf(s * 1.28, 1.52, 0.98));
      if (hi) K.add('black', limb(V(s * 1.05, 1.42, 0.92), V(s * 1.22, 1.50, 0.98), 0.02, 0.02, 6));
      K.add('black', roundBox(0.014, 0.05, 0.16, 0.006, 2), xf(s * (sideX(0.1, 1.15) + 0.004), 1.15, 0.1));
      K.add('black', roundBox(0.014, 0.05, 0.16, 0.006, 2), xf(s * (sideX(-0.82, 1.10) + 0.004), 1.15, -0.82));
      let rx = 0; [0.78, 0.9, 1.0, 1.1, 1.2].forEach(yy => { rx = Math.max(rx, sideX(0.4, yy)); }); rx += 0.006;
      raw.dec.push({ geo: new T.PlaneGeometry(0.42, 0.42), m: xf(s * rx, 0.99, 0.4, 0, s * PI / 2, 0), roundel: [9, '#ffffff', '#0b1220'] });
    });
    K.add('black', limb(V(-1.12, 1.45, 0.98), V(-1.12, 1.9, 0.7), 0.045, 0.04, 8)); K.add('black', cyl(0.06, 0.06, 0.14, 8), xf(-1.12, 1.93, 0.65, 0.9, 0, 0));
    // roof light bar
    {
      K.add('black', box(1.5, 0.09, 0.12), xf(0, 1.99, 0.28, 0.1, 0, 0));
      for (let i = -3; i <= 3; i++) Lt.add('head', box(0.17, 0.065, 0.04), xf(i * 0.2, 1.99, 0.35, 0.1, 0, 0));
      [-1, 1].forEach(s => K.add('black', box(0.06, 0.06, 0.1), xf(s * 0.62, 1.95, 0.28)));
    }
    // bed: roll bar + spare tyre + tail lights + tailgate + exhaust
    {
      const wp = wheelParts({ R: 0.56, W: 0.46, rimR: 0.355, style: 'dish', lugs: true });
      const spare = wp.tyre.clone(); spare.rotateY(PI / 2);
      K.add('rubber', spare, xf(0, 1.35, -1.22, 0, 0, 0, 0.9, 0.9, 0.9)); K.add('steel', cyl(0.22, 0.22, 0.18, 14), xf(0, 1.35, -1.22, PI / 2, 0, 0));
      const rb = (a, b) => K.add('black', limb(V(a[0], a[1], a[2]), V(b[0], b[1], b[2]), 0.034, 0.034, 8));
      [-1, 1].forEach(s => { rb([s * 0.97, 1.30, -0.70], [s * 0.92, 1.86, -0.78]); rb([s * 0.92, 1.86, -0.78], [s * 0.92, 1.88, -1.55]); rb([s * 0.92, 1.88, -1.55], [s * 0.98, 1.31, -1.62]); });
      rb([-0.92, 1.86, -0.78], [0.92, 1.86, -0.78]);
      [-1, 1].forEach(s => Lt.add('head', roundBox(0.12, 0.12, 0.08, 0.03, 2), xf(s * 0.48, 1.90, -0.82)));
      [-1, 1].forEach(s => Lt.add('tail', roundBox(0.09, 0.36, 0.06, 0.03, 3), xf(s * 0.95, 1.05, -2.68)));
      K.add('black', roundBox(1.6, 0.05, 0.08, 0.02, 2), xf(0, 1.31, -2.62));
      raw.dec.push({ geo: new T.PlaneGeometry(0.5, 0.125), m: xf(0, 0.86, -2.675, 0, PI, 0), plate: '98-765-43' });
      K.add('chrome', lathe([[0.07, 0.0], [0.07, 0.22], [0.056, 0.22], [0.056, 0.0]], 12), xf(-0.78, 0.55, -2.42, -PI / 2, 0, 0));
      raw.exhausts.push({ x: -0.78, y: 0.55, z: -2.64, r: 0.9 });
      K.add('steel', roundBox(0.5, 0.06, 0.25, 0.02, 2), xf(0, 0.55, -2.64));
      K.add('black', roundBox(0.14, 0.5, 0.02, 0.01, 2), xf(-1.2, 0.5, -2.2)); K.add('black', roundBox(0.14, 0.5, 0.02, 0.01, 2), xf(1.2, 0.5, -2.2));
    }
    raw.suitFrom = 'driver'; raw.flameColor = 0xff9a2a;
    raw.dims = { halfWidth: 1.28, length: 5.34, height: 2.0, wheelRadius: 0.56, wheelTrack: 1.03, frontZ: 1.62, rearZ: -1.55, zFront: 2.76, zRear: -2.7 };
    raw.shell = shell; raw.sp = sp;
    return raw;
  }

  // --------------------------------------------------------------------------
  // generic ring loft (rings = arrays of Vector3 around a closed section)
  // --------------------------------------------------------------------------
  function ringLoft(rings, capEnd) {
    const S = rings.length, N = rings[0].length, pos = [], idx = [];
    rings.forEach(r => r.forEach(p => pos.push(p.x, p.y, p.z)));
    for (let i = 0; i < S - 1; i++) for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N, a = i * N + j, b = i * N + j2, c = (i + 1) * N + j, d = (i + 1) * N + j2;
      idx.push(a, b, c, b, d, c);
    }
    if (capEnd) {
      const cen = new T.Vector3(); rings[S - 1].forEach(p => cen.add(p)); cen.multiplyScalar(1 / N);
      const ci = pos.length / 3; pos.push(cen.x, cen.y, cen.z);
      for (let j = 0; j < N; j++) idx.push(ci, (S - 1) * N + (j + 1) % N, (S - 1) * N + j);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const uv = new Float32Array(pos.length / 3 * 2); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    return g;
  }
  function naca(t, n) {   // closed airfoil ring points in (x 0..1, y), thickness t
    const up = [], lo = [];
    for (let i = 0; i <= n; i++) {
      const x = 0.5 * (1 - Math.cos(PI * i / n));
      const y = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x);
      up.push([x, y]); lo.push([x, -y]);
    }
    const ring = []; for (let i = 0; i <= n; i++) ring.push(up[i]); for (let i = n - 1; i >= 1; i--) ring.push(lo[i]);
    return ring;
  }

  // --------------------------------------------------------------------------
  // FLYING ROADSTER (tesla_sky_x)
  // --------------------------------------------------------------------------
  function buildRoadster(cfg) {
    const raw = newRaw(), K = raw.K, Lt = raw.Lt, hi = !isLow();
    const sp = {
      z0: -2.28, z1: 2.30,
      keys: [
        kb(2.30, .52, .36, .30, .17, .40, .40, .40, 0, .40, .05, .09, .10, .2),
        kb(2.18, .78, .58, .34, .13, .47, .46, .62, 0, .46, .07, .12, .14, .3),
        kb(1.90, .94, .74, .42, .12, .64, .54, .80, 0, .54, .08, .16, .16, .6),
        kb(1.55, 1.00, .80, .48, .12, .86, .61, .90, 0, .61, .08, .20, .16, .72),
        kb(1.40, 1.02, .82, .50, .12, .90, .63, .92, 0, .63, .08, .20, .16, .72),
        kb(1.10, 1.00, .80, .52, .12, .85, .67, .90, 0, .67, .08, .18, .14, .72),
        kb(0.86, .98, .80, .54, .12, .79, .73, .88, 0, .73, .08, .16, .10, .72),
        kb(0.76, .97, .80, .54, .12, .78, .78, .90, .76, .28, .08, .16, .04, .72),
        kb(-0.78, .97, .80, .54, .12, .78, .78, .90, .76, .28, .08, .16, .04, .72),
        kb(-0.90, 1.0, .80, .56, .12, .90, .82, .92, 0, .82, .08, .16, .12, .72),
        kb(-1.15, 1.02, .80, .58, .12, 1.03, .84, .94, 0, .84, .08, .16, .14, .72),
        kb(-1.38, 1.06, .83, .58, .12, 1.00, .80, .98, 0, .80, .08, .18, .14, .72),
        kb(-1.80, 1.00, .76, .56, .14, .86, .76, .88, 0, .76, .08, .16, .12, .72),
        kb(-2.10, .88, .62, .50, .20, .76, .72, .72, 0, .72, .07, .12, .12, .55),
        kb(-2.28, .70, .48, .46, .26, .68, .68, .56, 0, .68, .06, .10, .10, .35)
      ],
      arches: [{ z: 1.40, cy: 0.38, R: 0.435 }, { z: -1.38, cy: 0.38, R: 0.435 }],
      zones: [[0.62, 0.9, 0.07], [-1.0, -0.7, 0.07]],
      gh: {
        z0: 0.28, z1: 0.77, zRoofF: -9, zRoofR: -10, rr: 0.12, fm: 0.5, roofMat: 'paint2',
        keys: [gk(0.28, .78, 1.10, 1.13, .80, .78, .72), gk(0.50, .78, .96, .98, .84, .83, .80), gk(0.77, .78, .785, .79, .90, .90, .90)],
        zones: [[0.28, 0.77, 0.07]]
      }
    };
    const shell = carShell(K, sp);
    addWheels(raw, { R: 0.38, rimR: 0.272, style: 'blade', front: { x: 0.93, z: 1.40, W: 0.28 }, rear: { x: 0.96, z: -1.38, W: 0.34 } });
    if (hi) raw.wheelDefs.forEach(wd => brakeHardware(raw, wd, 'caliper'));
    raw.caliperColor = 0x0ea5e9; raw.rimColor = 0xffc21a; raw.accentColor = 0x0b2a4a;
    // interior
    const dx = 0.32;
    K.add('interior', roundBox(1.6, 0.18, 0.4, 0.06, 2), xf(0, 0.68, 0.64, -0.12, 0, 0));
    if (hi) { K.add('trim', roundBox(0.5, 0.12, 0.12, 0.04, 2), xf(dx, 0.80, 0.52));
    K.add('interior', roundBox(0.24, 0.18, 0.9, 0.05, 2), xf(0, 0.42, -0.12));
    bucketSeat(K, dx, 0.36, -0.26); bucketSeat(K, -dx, 0.36, -0.26); } else bucketSeat(K, dx, 0.36, -0.26);
    K.add('trim', new T.TorusGeometry(0.14, 0.02, 8, hi ? 20 : 12), xf(dx, 0.76, 0.34, -0.5, 0, 0));
    K.add('trim', limb(V(dx, 0.74, 0.35), V(dx, 0.64, 0.55), 0.024, 0.028, 6));
    const drv = { hip: V(dx, 0.42, -0.30), chest: V(dx, 0.68, -0.27), neck: V(dx, 0.92, -0.24), head: V(dx, 1.08, -0.22), Rh: 0.19, type: 'car' };
    drv.shoulder = (s) => V(dx + s * 0.205, 0.86, -0.27); drv.elbow = (s) => V(dx + s * 0.30, 0.66, -0.06); drv.wrist = (s) => V(dx + s * 0.15, 0.76, 0.30);
    drv.knee = (s) => V(dx + s * 0.13, 0.62, 0.22); drv.ankle = (s) => V(dx + s * 0.13, 0.30, 0.56);
    humanKit(K, { hip: drv.hip, chest: drv.chest, neck: drv.neck, shoulder: drv.shoulder, elbow: drv.elbow, wrist: drv.wrist, knee: drv.knee, ankle: drv.ankle }, 1.12);
    raw.driver = drv;

    const hf = (z) => shell.half(z);
    const topY = (z, x) => halfTopY(hf(z), Math.abs(x));
    const sideX = (z, y) => halfSideX(hf(z), y);
    const slopeZ = (z, x) => Math.atan2(topY(z + 0.06, x) - topY(z - 0.06, x), 0.12);
    // nose: slim LED eyes, blue splitter, intake
    K.add('paint2', slab(shapeOf([[-0.66, -2.28], [0.66, -2.28], [0.86, -2.12], [0.9, -1.8], [-0.9, -1.8], [-0.86, -2.12]]), 0.03, 0.005), xf(0, 0.115, 0, -PI / 2, 0, 0));
    K.add('black', roundBox(0.6, 0.07, 0.12, 0.03, 3), xf(0, 0.25, 2.2));
    [-1, 1].forEach(s => {
      const z = 1.93, x = 0.66, y = topY(z, x), sl = slopeZ(z, x);
      K.add('black', roundBox(0.30, 0.04, 0.12, 0.018, 2), xf(s * x, y + 0.0, z, -sl, s * -0.25, 0));
      Lt.add('head', tube([[-0.14, 0, 0], [-0.04, 0.0, 0.02], [0.08, 0.0, 0.06], [0.16, 0.0, 0.14]].map(p => V(p[0] * s, p[1], p[2])), 0.016, 8, 5), xf(s * x, y + 0.025, z - 0.04, -sl, 0, 0));
      raw.beams.push({ x: s * x, z: 2.2, w: 3.0, len: 14 });
      // side blue gill lights + blue sill stripe
      Lt.add('blue', roundBox(0.012, 0.016, 0.70, 0.006, 2), xf(s * (sideX(-1.0, 0.56) + 0.004), 0.56, -1.0));
      Lt.add('blue', roundBox(0.012, 0.016, 0.70, 0.006, 2), xf(s * (sideX(-1.0, 0.50) + 0.004), 0.50, -1.0));
      K.add('paint2', roundBox(0.01, 0.03, 2.2, 0.004, 2), xf(s * (sideX(0.4, 0.30) + 0.004), 0.30, 0.2));
      // rear: thrusters
      K.add('chrome', lathe([[0.15, 0.0], [0.15, 0.10], [0.125, 0.10], [0.125, 0.0]], 18), xf(s * 0.46, 0.55, -2.20, -PI / 2, 0, 0));
      K.add('black', cyl(0.125, 0.125, 0.06, 14), xf(s * 0.46, 0.55, -2.28, PI / 2, 0, 0));
      Lt.add('blue', new T.CircleGeometry(0.115, 18), xf(s * 0.46, 0.55, -2.33, 0, PI, 0));
      raw.exhausts.push({ x: s * 0.46, y: 0.55, z: -2.34, r: 1.0 });
      // tail lights: full-width LED bar halves
      Lt.add('tail', roundBox(0.46, 0.04, 0.04, 0.015, 2), xf(s * 0.31, 0.80, -2.22, 0, 0, 0));
      // fins
      K.add('paint', slab(shapeOf([[-0.2, 0], [0.2, 0], [0.12, 0.14], [-0.2, 0.18]]), 0.02, 0.003), xf(s * 0.95, topY(-1.4, 0.9) + 0.0, -1.5, 0, PI / 2, 0));
    });
    Lt.add('tail', roundBox(0.44, 0.04, 0.04, 0.015, 2), xf(0, 0.80, -2.215));
    raw.dec.push({ geo: new T.PlaneGeometry(0.46, 0.115), m: xf(0, 0.57, -2.275, 0, PI, 0), plate: '55-123-45' });
    // blue centre racing stripe
    {
      const stripeP = (z0, z1, hw, n) => { const P = [], S = [], Nn = []; for (let i = 0; i <= n; i++) { const z = lerp(z0, z1, i / n); P.push(V(0, topY(z, 0.001) + 0.006, z)); S.push(V(1, 0, 0)); Nn.push(V(0, 1, 0)); } return strip(P, S, hw, Nn); };
      K.add('paint2', stripeP(0.90, 2.22, 0.10, 14)); K.add('paint2', stripeP(-2.22, -1.0, 0.07, 12));
    }
    // wings (deployable)
    raw.buildWings = function (Rm, env) {
      const key = 'wings' + QK();
      let kit = KITS[key];
      if (!kit) {
        const n = hi ? 12 : 8, rings = [];
        const x0 = 0.93, x1 = 4.4;
        const prof = naca(0.11, 8);
        for (let i = 0; i <= n; i++) {
          const s = i / n;
          const x = lerp(x0, x1, s), chord = lerp(2.0, 0.55, Math.pow(s, 0.85)), zle = lerp(0.35, -1.75, Math.pow(s, 1.25)), y = 0.60 + 0.55 * s * s, th = lerp(1.0, 0.55, s);
          const r = prof.map(p => V(x, y + p[1] * chord * th * 0.9 - (p[0] * chord * 0.04), zle - p[0] * chord));
          rings.push(r);
        }
        const g = ringLoft(rings, true);
        const edge = (() => { const P = []; for (let i = 0; i <= n; i++) { const s = i / n; P.push(V(lerp(x0, x1, s) + 0.0, 0.60 + 0.55 * s * s + 0.015, lerp(0.35, -1.75, Math.pow(s, 1.25)) + 0.01)); } return tube(P, 0.022, 14, 5, false); })();
        kit = { wing: g, wingM: mirrorX(g), edge, edgeM: mirrorX(edge) };
        KITS[key] = kit;
      }
      const grp = new T.Group(); grp.name = 'wings';
      const wm = Rm('paint');
      const eMat = mat('wingedge', () => new T.MeshBasicMaterial({ color: 0x38c8ff, toneMapped: false }));
      const bm = mat('wingblue', () => std({ color: 0x0b5fa8, metalness: 0.6, roughness: 0.3, emissive: 0x0a4a88, emissiveIntensity: 0.8, envMapIntensity: 1.0 }));
      [[kit.wing, kit.edge], [kit.wingM, kit.edgeM]].forEach(pair => { const m = new T.Mesh(pair[0], wm); m.castShadow = hi; const e = new T.Mesh(pair[1], eMat); grp.add(m, e); });
      return grp;
    };
    raw.suitFrom = 'driver'; raw.flameColor = 0x2fb6ff; raw.isRoadster = true;
    raw.dims = { halfWidth: 1.06, length: 4.7, height: 1.2, wheelRadius: 0.38, wheelTrack: 0.95, frontZ: 1.40, rearZ: -1.38, zFront: 2.30, zRear: -2.34 };
    raw.shell = shell; raw.sp = sp;
    return raw;
  }

  // --------------------------------------------------------------------------
  // MOTORCYCLES (cyber_ninja = green superbike, plasma_hawk = purple hyper-bike)
  // --------------------------------------------------------------------------
  const bk = (z, w, wb, yb, ys, yt, ytc, wt, rb, rs, rt) => ({ z, w, wb, yb, ys, yt, ytc, wt, rb, rs, rt });
  function bikeRingFn(at, mm) {
    return (z) => {
      const p = at(z);
      const P = [[0, p.yb], [p.wb, p.yb], [p.w, p.ys], [p.wt, p.yt], [0, p.ytc]];
      return ringFromHalf(halfPoly(P, [0, p.rb, p.rs, p.rt, 0], [0, mm[0], mm[1], mm[2], 0]));
    };
  }
  function buildBike(cfg) {
    const raw = newRaw(), K = raw.K, Lt = raw.Lt, hi = !isLow();
    const hyper = cfg.id === 'plasma_hawk';
    const R = 0.62, zF = 1.50, zR = -1.43, WF = 0.27, WR = 0.44;
    // ---- wheels ----
    [[zF, WF, true], [zR, WR, false]].forEach(([z, W, isF]) => raw.wheelDefs.push({ x: 0, y: R, z, side: 1, isFront: isF, R, W, rimR: 0.44, style: 'y5', lugs: false }));
    raw.rimColor = hyper ? 0x9d8cc8 : 0x9aa4b0; raw.caliperColor = 0xdd1d26; raw.flameColor = hyper ? 0xb86bff : 0x45ff9a;
    // ---- fairing (side panels + nose) ----
    const fk = hyper ? [
      bk(1.80, .08, .05, 1.26, 1.34, 1.43, 1.45, .06, .02, .04, .05),
      bk(1.68, .20, .14, 1.15, 1.30, 1.52, 1.56, .13, .05, .09, .09),
      bk(1.42, .31, .22, 1.02, 1.28, 1.64, 1.72, .20, .06, .12, .12),
      bk(1.12, .37, .26, .84, 1.16, 1.72, 1.80, .22, .06, .14, .14),
      bk(0.78, .37, .24, .74, 1.06, 1.60, 1.64, .24, .06, .12, .12),
      bk(0.38, .33, .20, .86, 1.08, 1.46, 1.48, .21, .06, .12, .10),
      bk(0.00, .27, .14, 1.04, 1.12, 1.30, 1.32, .16, .05, .09, .07),
      bk(-0.22, .20, .10, 1.18, 1.22, 1.28, 1.29, .10, .04, .06, .05)
    ] : [
      bk(1.76, .10, .06, 1.27, 1.35, 1.45, 1.47, .08, .02, .05, .06),
      bk(1.64, .21, .14, 1.17, 1.32, 1.52, 1.56, .14, .05, .09, .09),
      bk(1.40, .30, .21, 1.06, 1.28, 1.62, 1.68, .21, .06, .11, .12),
      bk(1.12, .35, .24, .90, 1.16, 1.68, 1.74, .22, .06, .13, .13),
      bk(0.78, .35, .23, .80, 1.05, 1.58, 1.62, .23, .06, .12, .12),
      bk(0.38, .32, .20, .90, 1.10, 1.44, 1.47, .20, .06, .12, .10),
      bk(0.00, .26, .14, 1.06, 1.14, 1.32, 1.34, .15, .05, .10, .08),
      bk(-0.22, .20, .10, 1.18, 1.22, 1.28, 1.29, .10, .04, .06, .05)
    ];
    {
      const at = keyInterp(fk), fz = zSamples(-0.22, fk[0].z, hi ? 0.2 : 0.3, [[1.3, 1.8, 0.07]], []);
      const g = loft(fz, bikeRingFn(at, hi ? [2, 3, 3] : [1, 2, 2]), {
        nGroups: 3, capStart: true, capEnd: true, capGroup: 0,
        matFn: (i, j, f, za, zb) => { const hh = hi ? 13 : 10, hs = j < hh - 1 ? j : 2 * hh - 3 - j; return hs <= (hi ? 2 : 1) ? 1 : (hs >= (hi ? 8 : 6) && za > 1.5 ? 2 : 0); }
      });
      K.add('paint', g[0]); K.add('black', g[1]); K.add('paint2', g[2]);
    }
    // ---- tank + seat + tail (one loft) ----
    const tk = hyper ? [
      bk(1.00, .17, .12, 1.22, 1.50, 1.62, 1.66, .13, .04, .06, .06),
      bk(0.70, .24, .15, 1.12, 1.46, 1.66, 1.72, .17, .05, .09, .10),
      bk(0.25, .27, .17, 1.07, 1.44, 1.62, 1.68, .19, .06, .10, .11),
      bk(-0.25, .23, .15, 1.12, 1.38, 1.50, 1.54, .16, .05, .08, .08),
      bk(-0.62, .21, .14, 1.20, 1.34, 1.44, 1.46, .14, .05, .07, .07),
      bk(-1.05, .20, .14, 1.26, 1.40, 1.50, 1.53, .13, .05, .07, .07),
      bk(-1.60, .17, .11, 1.30, 1.46, 1.62, 1.68, .10, .04, .06, .06),
      bk(-2.00, .09, .06, 1.38, 1.50, 1.58, 1.62, .06, .02, .04, .04)
    ] : [
      bk(1.00, .17, .12, 1.20, 1.46, 1.60, 1.63, .13, .04, .06, .06),
      bk(0.70, .24, .15, 1.10, 1.44, 1.63, 1.68, .17, .05, .09, .10),
      bk(0.25, .26, .17, 1.05, 1.42, 1.60, 1.64, .19, .06, .10, .11),
      bk(-0.25, .22, .15, 1.10, 1.36, 1.50, 1.52, .16, .05, .08, .08),
      bk(-0.62, .21, .14, 1.18, 1.32, 1.43, 1.45, .14, .05, .07, .07),
      bk(-1.05, .19, .13, 1.24, 1.36, 1.46, 1.49, .12, .04, .07, .07),
      bk(-1.55, .16, .10, 1.28, 1.40, 1.52, 1.56, .10, .04, .06, .06),
      bk(-1.98, .09, .06, 1.34, 1.42, 1.48, 1.50, .06, .02, .04, .04)
    ];
    {
      const at = keyInterp(tk), tz = zSamples(-1.98, 1.0, hi ? 0.24 : 0.34, [], []);
      const g = loft(tz, bikeRingFn(at, hi ? [2, 3, 3] : [1, 2, 2]), {
        nGroups: 3, capStart: true, capEnd: true, capGroup: 0,
        matFn: (i, j, f, za, zb) => { const hh = hi ? 13 : 10, hs = j < hh - 1 ? j : 2 * hh - 3 - j; const zm = (za + zb) / 2; if (hs <= 1) return 1; if (hs >= (hi ? 8 : 6) && zm < -0.05 && zm > -1.25) return 2; return 0; }
      });
      K.add('paint', g[0]); K.add('black', g[1]); K.add('black', g[2]);
    }
    // ---- windscreen ----
    {
      const wk = hyper ? [gk(1.22, 1.70, 1.74, 1.75, .17, .16, .14), gk(1.04, 1.70, 1.86, 1.87, .21, .20, .17), gk(0.78, 1.68, 1.98, 1.99, .20, .19, .14), gk(0.60, 1.62, 1.66, 1.67, .16, .15, .12)]
        : [gk(1.22, 1.68, 1.72, 1.73, .18, .17, .15), gk(1.04, 1.68, 1.84, 1.85, .21, .20, .17), gk(0.76, 1.66, 1.94, 1.95, .20, .19, .14), gk(0.60, 1.60, 1.64, 1.65, .16, .15, .12)];
      const ga = keyInterp(wk), mmR = 2;
      const gz = zSamples(0.60, 1.22, 0.1, [], []);
      const gg = loft(gz, (z) => { const p = ga(z); const P = [[p.wb, p.yb], [p.wm, p.yb + (p.yr - p.yb) * 0.5], [p.wr, p.yr], [0, p.yrc]]; return archFromHalf(halfPoly(P, [0, 0, 0.08, 0], [0, 0, mmR, 0])); }, { nGroups: 1, closed: false });
      K.add('glass', gg[0]);
    }
    // ---- fork, bars, front end ----
    const head = V(0, 1.50, 1.10), axle = V(0, R, zF);
    [-1, 1].forEach(s => {
      const top = V(s * 0.17, 1.50, 1.10), mid = V(s * 0.17, 1.02, 1.30 + 0.0), bot = V(s * 0.18, R, zF);
      const up = V(s * 0.17, 1.50, 1.07), dn = V(s * 0.17, 0.98, 1.27);
      K.add('steel', limb(up, dn, 0.036, 0.036, 8)); K.add('metal', limb(dn, V(s * 0.17, R, zF), 0.044, 0.04, 8));
      K.add('chrome', cylX(0.05, 0.05, 0.04, 8), xf(s * 0.17, R, zF));
      K.add('black', limb(V(s * 0.17, 1.52, 1.08), V(s * 0.36, 1.58, 0.93), 0.026, 0.022, 6));
      K.add('black', cylX(0.034, 0.034, 0.17, 8), xf(s * 0.40, 1.585, 0.91));
      K.add('black', limb(V(s * 0.40, 1.59, 0.95), V(s * 0.50, 1.62, 1.10), 0.01, 0.008, 4));
      // front disc + caliper
      if (hi) { K.add('alu', lathe([[0.18, -0.01], [0.40, -0.012], [0.40, 0.012], [0.18, 0.01]], 18).rotateZ(-PI / 2), xf(s * 0.10, R, zF));
      K.add('caliper', roundBox(0.075, 0.13, 0.17, 0.02, 2), xf(s * 0.13, R + 0.30 * Math.cos(0.5), zF - 0.30 * Math.sin(0.5), -0.5, 0, 0)); }
      // mirrors
      if (hi) { K.add('paint2', roundBox(0.19, 0.095, 0.075, 0.035, 2), xf(s * 0.46, 1.80, 0.96, 0, 0, s * 0.1));
      K.add('black', limb(V(s * 0.28, 1.68, 1.03), V(s * 0.42, 1.78, 0.97), 0.014, 0.012, 5)); }
    });
    K.add('steel', cylX(0.03, 0.03, 0.38, 8), xf(0, 1.50, 1.10));
    // front fender
    {
      const fg = new T.TorusGeometry(R + 0.065, 0.075, 6, hi ? 14 : 8, 1.7); fg.rotateZ(PI / 2 - 0.55); fg.rotateY(PI / 2); fg.scale(1.7, 1.0, 1.0);
      K.add('paint2', fg, xf(0, R, zF + 0.04));
    }
    // headlights / nose
    [-1, 1].forEach(s => {
      Lt.add('head', ell(0.095, 0.058, 0.09, 12, 6), xf(s * 0.12, 1.43, 1.60, 0.15, s * -0.45, 0));
      K.add('black', ell(0.12, 0.075, 0.09, 12, 6), xf(s * 0.12, 1.43, 1.585, 0.15, s * -0.45, 0));
      Lt.add('drl', tube([[0, 0, 0], [0.04, 0.02, 0.01], [0.09, 0.03, 0.0]].map(p => V(p[0] * s, p[1], p[2])), 0.011, 6, 4), xf(s * 0.11, 1.50, 1.62, 0.1, s * -0.45, 0));
      raw.beams.push({ x: s * 0.12, z: 1.9, w: 2.0, len: 12 });
    });
    K.add('black', roundBox(0.3, 0.11, 0.08, 0.03, 2), xf(0, 1.34, 1.70));
    raw.dec.push({ geo: new T.PlaneGeometry(0.30, 0.26), m: xf(0, 1.56, 1.671, -0.2, 0, 0), roundel: [hyper ? 4 : 1, '#ffffff', '#0b1220'] });
    // ---- engine, frame, swingarm, exhaust, chain ----
    K.add('steel', roundBox(0.38, 0.40, 0.50, 0.05, 2), xf(0, 0.92, 0.05));
    K.add('gloss', roundBox(0.34, 0.20, 0.44, 0.04, 2), xf(0, 1.14, 0.08));
    K.add('metal', roundBox(0.32, 0.24, 0.34, 0.05, 2), xf(0, 0.74, -0.30));
    [-1, 1].forEach(s => {
      K.add('metal', limb(V(s * 0.21, 1.46, 1.00), V(s * 0.22, 1.06, -0.50), 0.05, 0.045, 6));
      K.add('metal', limb(V(s * 0.22, 1.06, -0.50), V(s * 0.20, 0.88, -0.60), 0.05, 0.05, 6));
      K.add('metal', limb(V(s * 0.20, 0.88, -0.58), V(s * 0.25, R, zR), 0.062, 0.05, 6));
      K.add('steel', limb(V(s * 0.15, 1.20, -0.55), V(s * 0.12, 1.30, -1.60), 0.035, 0.03, 6));
      K.add('steel', cylX(0.07, 0.07, 0.06, 8), xf(s * 0.25, R, zR));
      K.add('black', roundBox(0.02, 0.05, 0.12, 0.01, 1), xf(s * 0.34, 0.72, -0.66));
      K.add('black', limb(V(s * 0.30, 0.72, -0.64), V(s * 0.38, 0.72, -0.64), 0.022, 0.022, 6));
    });
    if (hi) { K.add('alu', lathe([[0.17, -0.01], [0.36, -0.012], [0.36, 0.012], [0.17, 0.01]], 18).rotateZ(-PI / 2), xf(-0.18, R, zR));
    K.add('caliper', roundBox(0.06, 0.1, 0.14, 0.02, 2), xf(-0.20, R + 0.2, zR - 0.22)); }
    K.add('black', limb(V(0, 1.20, -0.82), V(0, 0.82, -0.62), 0.03, 0.03, 6)); K.add('steel', limb(V(0, 1.12, -0.80), V(0, 0.88, -0.65), 0.05, 0.05, 8));
    // chain + sprocket
    if (hi) { K.add('black', limb(V(0.31, 0.62, zR), V(0.31, 0.82, -0.52), 0.014, 0.014, 4)); K.add('black', limb(V(0.31, 0.60, zR), V(0.31, 0.64, -0.52), 0.014, 0.014, 4)); }
    K.add('steel', cylX(0.17, 0.17, 0.03, 12), xf(0.31, R, zR)); K.add('steel', cylX(0.09, 0.09, 0.03, 10), xf(0.31, 0.72, -0.52));
    // exhaust
    if (hyper) {
      [-1, 1].forEach(s => {
        K.add('black', tube([[s * 0.16, 0.76, 0.1], [s * 0.2, 0.62, -0.2], [s * 0.25, 0.7, -0.7], [s * 0.26, 0.84, -1.15]].map(p => V(p[0], p[1], p[2])), 0.04, 12, 6));
        K.add('gloss', cylZ(0.10, 0.082, 0.95, hi ? 14 : 8), xf(s * 0.27, 1.0, -1.45, -0.18, s * 0.05, 0));
        K.add('chrome', lathe([[0.1, 0.0], [0.1, 0.1], [0.082, 0.1], [0.082, 0.0]], 12), xf(s * 0.27, 1.07, -1.93, -PI / 2 - 0.18, 0, 0));
        raw.exhausts.push({ x: s * 0.27, y: 1.09, z: -2.02, r: 0.95 });
      });
    } else {
      K.add('black', tube([[0.0, 0.78, 0.15], [-0.05, 0.62, -0.2], [-0.2, 0.7, -0.7], [-0.27, 0.82, -1.1]].map(p => V(p[0], p[1], p[2])), 0.045, 12, 6));
      K.add('metal', cylZ(0.115, 0.095, 1.05, hi ? 14 : 8), xf(-0.29, 0.98, -1.40, -0.14, 0, 0));
      K.add('black', lathe([[0.115, 0.0], [0.115, 0.12], [0.095, 0.12], [0.095, 0.0]], 12), xf(-0.29, 1.04, -1.92, -PI / 2 - 0.14, 0, 0));
      raw.exhausts.push({ x: -0.29, y: 1.04, z: -2.0, r: 1.0 });
      K.add('metal', cylZ(0.085, 0.07, 0.8, 10), xf(0.29, 0.92, -1.30, -0.12, 0, 0));
      raw.exhausts.push({ x: 0.29, y: 0.98, z: -1.80, r: 0.8 });
    }
    // tail light, plate
    Lt.add('tail', roundBox(0.22, 0.05, 0.05, 0.02, 2), xf(0, 1.45, -2.0));
    Lt.add('tail', tube([[-0.1, 0, 0], [0, 0, 0.0], [0.1, 0, 0]].map(p => V(p[0], p[1], p[2])), 0.012, 4, 4), xf(0, 1.40, -2.025));
    K.add('black', roundBox(0.34, 0.025, 0.4, 0.01, 1), xf(0, 1.16, -1.82, -0.5, 0, 0));
    raw.dec.push({ geo: new T.PlaneGeometry(0.30, 0.13), m: xf(0, 1.20, -1.99, -0.12, PI, 0), plate: '31-415-92' });
    // winglets (hyper) / fairing vents (super)
    [-1, 1].forEach(s => {
      if (hyper) {
        K.add('carbon', slab(shapeOf([[0, -0.11], [0.74, -0.20], [0.72, 0.0], [0.0, 0.13]]), 0.018, 0.003), xf(s * 0.30, 1.27, 1.22, -PI / 2, 0, 0, s, 1, 1));
        K.add('carbon', slab(shapeOf([[0, -0.09], [0.58, -0.16], [0.56, 0.0], [0.0, 0.11]]), 0.018, 0.003), xf(s * 0.30, 1.06, 1.18, -PI / 2, 0, 0, s, 1, 1));
        Lt.add('blue', box(0.74, 0.016, 0.016), xf(s * 0.67, 1.279, 1.07));
      } else {
        if (hi) { for (let i = 0; i < 3; i++) K.add('black', box(0.012, 0.012, 0.24), xf(s * 0.318, 1.03 - i * 0.045, 0.40 + 0.0)); K.add('black', roundBox(0.012, 0.07, 0.2, 0.01, 1), xf(s * 0.335, 0.86, 0.86)); }
      }
      // foot pegs
      K.add('steel', limb(V(s * 0.28, 0.76, -0.60), V(s * 0.42, 0.76, -0.60), 0.02, 0.02, 5));
    });
    // stripes on tank
    {
      const ts = keyInterp(tk), ST = (z0, z1, hw, n) => { const P = [], S = [], Nn = []; for (let i = 0; i <= n; i++) { const z = lerp(z0, z1, i / n), p = ts(z); P.push(V(0, p.ytc + 0.005, z)); S.push(V(1, 0, 0)); Nn.push(V(0, 1, 0)); } return strip(P, S, hw, Nn); };
      K.add(hyper ? 'paint2' : 'white', ST(-0.22, 0.98, 0.04, 8));
      const fs = keyInterp(fk), SF = (z0, z1, hw, n) => { const P = [], S = [], Nn = []; for (let i = 0; i <= n; i++) { const z = lerp(z0, z1, i / n), p = fs(z); P.push(V(0, p.ytc + 0.005, z)); S.push(V(1, 0, 0)); Nn.push(V(0, 1, 0)); } return strip(P, S, hw, Nn); };
      K.add(hyper ? 'paint2' : 'white', SF(1.2, 1.74, 0.035, 6));
    }
    // ---- rider ----
    const rS = hyper ? 0.0 : 0.0;
    const drv = { hip: V(0, 1.40, -0.80), chest: V(0, 1.72, -0.20), neck: V(0, 1.90, 0.28), head: V(0, 2.04, 0.50), Rh: 0.235, type: 'bike', pitch: 0.18 };
    drv.shoulder = (s) => V(s * 0.25, 1.82, 0.12); drv.elbow = (s) => V(s * 0.40, 1.60, 0.62); drv.wrist = (s) => V(s * 0.38, 1.575, 0.92);
    drv.knee = (s) => V(s * 0.32, 1.20, -0.02); drv.ankle = (s) => V(s * 0.32, 0.80, -0.62);
    humanKit(K, { hip: drv.hip, chest: drv.chest, neck: drv.neck, shoulder: drv.shoulder, elbow: drv.elbow, wrist: drv.wrist, knee: drv.knee, ankle: drv.ankle }, 1.6);
    raw.driver = drv; raw.suitFrom = 'dark'; raw.accentFrom = 'paint';
    raw.dims = { halfWidth: 0.55, length: 4.1, height: 2.28, wheelRadius: R, wheelTrack: 0.0, frontZ: zF, rearZ: zR, zFront: 1.82, zRear: -2.06 };
    return raw;
  }

  // --------------------------------------------------------------------------
  // KIT cache + INSTANCING
  // --------------------------------------------------------------------------
  const BUILDERS = { apex_viper: buildGT3, titan_buggy: buildTruck, tesla_sky_x: buildRoadster, cyber_ninja: buildBike, plasma_hawk: buildBike, bike: buildBike, car: buildGT3, truck: buildTruck, tesla: buildRoadster };
  function getKit(cfg) {
    const key = 'veh|' + cfg.id + '|' + QK();
    if (KITS[key]) return KITS[key];
    const b = BUILDERS[cfg.id] || BUILDERS[cfg.kind] || buildGT3;
    const raw = b(cfg);
    raw.geos = raw.K.bake(); raw.lgeos = raw.Lt.bake();
    delete raw.K; delete raw.Lt;
    KITS[key] = raw; return raw;
  }
  const CAST = { paint: 1, paint2: 1, gloss: 1, dark: 1, metal: 1, white: 1, chrome: 1, suit: 1, rubber: 1 };

  function shieldMaterial() {
    return mat('shield', () => new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.FrontSide,
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: [
        'varying vec3 vN; varying vec3 vV; varying vec3 vP;',
        'void main(){',
        ' float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.3);',
        ' vec3 p = normalize(vP); float la = asin(clamp(p.y,-1.0,1.0)) * 9.0; float lo = atan(p.z,p.x) * 7.0 + floor(la) * 0.5;',
        ' vec2 g = abs(fract(vec2(la, lo)) - 0.5); float line = smoothstep(0.43, 0.5, max(g.x, g.y * 0.9));',
        ' vec3 col = vec3(0.15,0.85,1.0) * (fr * 1.1 + line * (0.18 + fr * 0.7)) + vec3(0.05,0.3,0.5) * 0.12;',
        ' gl_FragColor = vec4(col, 1.0);',
        '}'].join('\n')
    }));
  }

  function beamTex() {
    return canvasTex('beam', 64, 256, (x, w, h) => {
      const g = x.createLinearGradient(0, h, 0, 0); g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      const m = x.createLinearGradient(0, 0, w, 0); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.5, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)');
      x.globalCompositeOperation = 'destination-out'; x.fillStyle = m; x.fillRect(0, 0, w, h);
    });
  }
  // exhaust flame: base at origin, tip at +Y, vertex colours fade to black (additive => fades out)
  function flameGeometry() {
    const g1 = new T.ConeGeometry(0.14, 0.58, 10, 1, true); g1.translate(0, 0.29, 0); flipWinding(g1);
    const g2 = new T.ConeGeometry(0.07, 0.38, 8, 1, true); g2.translate(0, 0.19, 0); flipWinding(g2);
    const col = (g, hot) => {
      const p = g.attributes.position, a = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const t = clamp(p.getY(i) / (hot ? 0.38 : 0.58), 0, 1), k = Math.pow(1 - t, 1.3) * (hot ? 1.0 : 0.85); a[i * 3] = (hot ? 1.0 : 0.55) * k + (hot ? 0.5 : 0) * k; a[i * 3 + 1] = (hot ? 1.0 : 0.75) * k; a[i * 3 + 2] = k; }
      g.setAttribute('color', new T.BufferAttribute(a, 3)); return g;
    };
    return merge([{ g: col(g1, false) }, { g: col(g2, true) }]);
  }

  function instantiate(raw, cfg, acc, opts) {
    const env = getEnv(), hi = !isLow(), shadows = hi;
    const hasGold = acc.indexOf('gold_rims') >= 0 || !!cfg.isFlyingTesla;
    const hasNeon = acc.indexOf('neon_cyan_glow') >= 0 || !!cfg.isFlyingTesla;
    const hasPlasma = acc.indexOf('plasma_flame') >= 0;
    const root = new T.Group(); root.name = 'veh_' + cfg.id;
    const bodyGroup = new T.Group(); root.add(bodyGroup);
    const chassis = new T.Group(); chassis.name = 'chassis'; bodyGroup.add(chassis);

    const R = (key) => {
      switch (key) {
        case 'paint': return paintMat(cfg.color);
        case 'paint2': return paintMat(cfg.secondaryColor || '#1e293b', { tag: 's', metal: 0.4, rough: 0.4 });
        case 'caliper': return mat('caliper' + raw.caliperColor, () => std({ color: raw.caliperColor || 0xd8141c, metalness: 0.35, roughness: 0.42, envMapIntensity: 0.8 }));
        case 'suit': { const hx = raw.suitFrom === 'dark' ? '#14171f' : (raw.suitFrom === 'paint' ? cfg.color : (opts.driverColor || cfg.color || '#ffcc00')); return mat('suit' + hx, () => std({ color: new T.Color(hx).multiplyScalar(raw.suitFrom === 'dark' ? 1 : 0.85), metalness: raw.suitFrom === 'dark' ? 0.25 : 0.12, roughness: raw.suitFrom === 'dark' ? 0.4 : 0.55, envMapIntensity: 0.55 })); }
        case 'accent': { if (raw.accentFrom === 'paint') return paintMat(cfg.color, { tag: 'a', metal: 0.3, rough: 0.4 }); const hx = raw.accentColor || 0xf4f6f8; return mat('accent' + hx, () => std({ color: hx, metalness: 0.1, roughness: 0.5, envMapIntensity: 0.5 })); }
        case 'glove': return mat('glove', () => std({ color: 0x0c0d10, metalness: 0.1, roughness: 0.6, envMapIntensity: 0.4 }));
        case 'boot': return mat('boot', () => std({ color: 0x0f1013, metalness: 0.1, roughness: 0.55, envMapIntensity: 0.4 }));
        default: return (MAT[key] || MAT.trim)();
      }
    };
    const meshOf = (geo, material, parent, cast) => { const m = new T.Mesh(geo, material); m.castShadow = !!(cast && shadows); parent.add(m); return m; };
    for (const key in raw.geos) {
      const m = meshOf(raw.geos[key], R(key), chassis, CAST[key]);
      if (key === 'glass') m.renderOrder = 3;
    }
    // per-instance light materials
    const headMat = lin(new T.MeshStandardMaterial({ color: 0xeaf3ff, emissive: 0xcfe3ff, emissiveIntensity: 0.3, roughness: 0.12, metalness: 0.1, envMap: env, envMapIntensity: 1.2 }));
    const tailMat = lin(new T.MeshStandardMaterial({ color: 0x70070f, emissive: 0xff1424, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.1, envMap: env, envMapIntensity: 0.8 }));
    const amberMat = lin(new T.MeshStandardMaterial({ color: 0x7a3a00, emissive: 0xff8a00, emissiveIntensity: 0.3, roughness: 0.3, envMap: env, envMapIntensity: 0.8 }));
    const blueMat = lin(new T.MeshStandardMaterial({ color: 0x0a3b66, emissive: 0x2ab4ff, emissiveIntensity: 1.7, roughness: 0.3, envMap: env, envMapIntensity: 0.8 }));
    const lightMats = { head: headMat, tail: tailMat, amber: amberMat, drl: headMat, white: headMat, blue: blueMat };
    for (const key in raw.lgeos) meshOf(raw.lgeos[key], lightMats[key] || headMat, chassis, false);
    // decals
    (raw.dec || []).forEach(d => {
      let tex = null;
      if (d.plate) tex = plateTex(d.plate); else if (d.roundel) tex = roundelTex(d.roundel[0], d.roundel[1], d.roundel[2]);
      const dm = mat('dec|' + (d.plate || d.roundel.join(',')), () => new T.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.0, transparent: !!d.roundel, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: 0.5 }));
      const m = new T.Mesh(d.geo, dm); if (d.m) { m.matrixAutoUpdate = false; m.matrix.copy(d.m); } chassis.add(m);
    });

    // wheels
    const wheels = [];
    const rimMat = mat('rim' + (hasGold ? 'G' : raw.rimColor), () => std({ color: hasGold ? 0xffc21a : (raw.rimColor || 0xd6dbe2), metalness: 1.0, roughness: hasGold ? 0.2 : 0.26, vertexColors: true, envMapIntensity: 1.25 }));
    raw.wheelDefs.forEach(wd => {
      const wp = wheelParts({ R: wd.R, W: wd.W, rimR: wd.rimR, style: wd.style, lugs: wd.lugs });
      const g = new T.Group(); g.name = 'wheel'; g.position.set(wd.x, wd.y, wd.z);
      const rim = new T.Mesh(wd.side > 0 ? wp.rim : wp.rimM, rimMat);
      const holder = new T.Group();
      const tyre = new T.Mesh(wp.tyre, MAT.rubber()); tyre.castShadow = shadows;
      const tyreFlat = new T.Mesh(wp.tyreFlat, MAT.rubber()); tyreFlat.visible = false; tyreFlat.castShadow = shadows;
      holder.add(tyre, tyreFlat); g.add(rim, holder); bodyGroup.add(g);
      // userData stays plain data (Object3D.clone JSON-copies it); the live parts live in a hidden property
      g.userData = { home: g.position.clone(), side: wd.side, isFront: wd.isFront, radius: wd.R, width: wd.W, drop: wp.drop, flat: false };
      Object.defineProperty(g, '_v3', { value: { tyre, tyreFlat, holder }, enumerable: false });
      const rot = g.rotation, orig = rot._onChangeCallback;
      rot._onChange(function () { orig(); if (g.userData.flat) holder.rotation.x = -rot.x; });
      // clones (pit crew "new wheel") must always look normal, even if this wheel is currently flat
      g.clone = function (rec) { const c = T.Group.prototype.clone.call(this, rec); const hh = c.children[1]; if (hh && hh.children.length === 2) { hh.children[0].visible = true; hh.children[1].visible = false; hh.rotation.x = 0; } return c; };
      wheels.push(g);
    });
    const dims = Object.assign({}, raw.dims);
    dims.wheelDrop = wheels[0] ? wheels[0].userData.drop : 0.1;

    const driver = buildDriver(raw, cfg, opts, chassis, env);

    // flames
    const flameMeshes = [];
    const flameCol = hasPlasma ? 0xd946ef : (raw.flameColor || 0x35c8ff);
    const flameGeo = KITS['flame' + QK()] || (KITS['flame' + QK()] = flameGeometry());
    const flameMat = mat('flame' + flameCol, () => new T.MeshBasicMaterial({ color: flameCol, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    (raw.exhausts || []).forEach(ex => {
      const f = new T.Mesh(flameGeo, flameMat); f.position.set(ex.x, ex.y, ex.z); f.rotation.x = -PI / 2; f.scale.set(ex.r || 1, 1, ex.r || 1); f.frustumCulled = false;
      bodyGroup.add(f); flameMeshes.push(f);
    });

    // wings (flying roadster)
    let wingsGroup = null;
    if (raw.buildWings) {
      wingsGroup = raw.buildWings(R, env);
      const wsc = wingsGroup.scale, v3set = T.Vector3.prototype.set;
      wsc.set = function (x, y, z) { v3set.call(this, x, y, z); wingsGroup.visible = x > 0.05; return this; };   // hidden while folded (game uses scale.set)
      wsc.set(0.01, 1, 1); bodyGroup.add(wingsGroup);
    }

    // shield / holo ring / blob shadow / underglow / beams
    const shieldGeo = KITS.shieldGeo || (KITS.shieldGeo = new T.SphereGeometry(1, 28, 18));
    const shieldMesh = new T.Mesh(shieldGeo, shieldMaterial()); shieldMesh.scale.setScalar(Math.max(2.9, dims.length * 0.6)); shieldMesh.position.y = 1.1; shieldMesh.visible = false; root.add(shieldMesh);
    const unitPlane = KITS.unitPlane || (KITS.unitPlane = new T.PlaneGeometry(1, 1));
    const holoRing = new T.Mesh(KITS.holoGeo || (KITS.holoGeo = new T.PlaneGeometry(0.01, 0.01)), mat('holo', () => new T.MeshBasicMaterial({ visible: false }))); holoRing.visible = false; root.add(holoRing);
    const zc = (dims.zFront + dims.zRear) / 2;
    const blob = new T.Mesh(unitPlane, mat('blob', () => new T.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: hi ? 0.5 : 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    blob.rotation.x = -PI / 2; blob.scale.set(dims.halfWidth * 2 + 0.6, dims.length + 0.9, 1); blob.position.set(0, 0.025, zc); blob.renderOrder = -1; root.add(blob);
    if (hasNeon) {
      const col = cfg.isFlyingTesla ? 0xffd24a : 0x16e8ff;
      const nm = mat('neon' + col, () => new T.MeshBasicMaterial({ map: glowTex('neon', [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]), color: col, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
      const ng = new T.Mesh(unitPlane, nm); ng.rotation.x = -PI / 2; ng.scale.set(dims.halfWidth * 2 + 1.5, dims.length + 1.4, 1); ng.position.set(0, 0.045, zc); ng.renderOrder = 0; root.add(ng);
      const barMat = mat('neonbar' + col, () => new T.MeshBasicMaterial({ color: col, toneMapped: false }));
      [-1, 1].forEach(s => { const b = new T.Mesh(box(0.05, 0.03, dims.length * 0.62), barMat); b.position.set(s * (dims.halfWidth - 0.14), 0.12, zc); chassis.add(b); });
    }
    const beams = new T.Group(); beams.visible = false; root.add(beams);
    (raw.beams || []).forEach(bm => {
      const bgk = 'beamgeo' + (bm.w || 3.4) + 'x' + (bm.len || 13);
      const m = new T.Mesh(KITS[bgk] || (KITS[bgk] = new T.PlaneGeometry(bm.w || 3.4, bm.len || 13)), mat('beam', () => new T.MeshBasicMaterial({ map: beamTex(), color: 0xfff1cf, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
      m.rotation.x = -PI / 2; m.position.set(bm.x, 0.05, bm.z + (bm.len || 13) / 2); m.renderOrder = 1; beams.add(m);
    });

    // state API
    let night = !!opts.nightLights, brake = false, flatOn = false;
    const applyLights = () => {
      headMat.emissiveIntensity = night ? 3.4 : 0.85; amberMat.emissiveIntensity = night ? 0.9 : 0.3;
      tailMat.emissiveIntensity = brake ? 3.6 : (night ? 1.8 : 0.55);
      beams.visible = night; driver.setNight(night);
    };
    const setFlat = (flag) => {
      flatOn = !!flag;
      wheels.forEach(w => {
        const ud = w.userData, v3 = w._v3; ud.flat = flatOn; v3.tyre.visible = !flatOn; v3.tyreFlat.visible = flatOn;
        v3.holder.rotation.x = flatOn ? -w.rotation.x : 0;
        if (w.parent === bodyGroup) { w.position.copy(ud.home); if (flatOn) w.position.y -= ud.drop; }
      });
      chassis.position.y = flatOn ? -dims.wheelDrop : 0;
    };
    applyLights();

    const faceCamAnchor = new T.Object3D(); faceCamAnchor.name = 'faceCamAnchor';
    faceCamAnchor.position.copy(raw.driver.head).add(new T.Vector3(0, 0.03, 1.0)); chassis.add(faceCamAnchor);

    return {
      root, bodyGroup, wheels, flameMeshes, wingsGroup, shieldMesh, holoRing,
      dims, driver: driver.api, faceCamAnchor, chassis,
      setFlatTires: setFlat, setBrakeLights(on) { brake = !!on; applyLights(); }, setNightLights(on) { night = !!on; applyLights(); },
      isFlat() { return flatOn; }, kitId: cfg.id
    };
  }

  // --------------------------------------------------------------------------
  // DRIVER head group (helmet + photo face) + API
  // --------------------------------------------------------------------------
  function buildDriver(raw, cfg, opts, chassis, env) {
    const d = raw.driver, hi = !isLow(), hk = helmetKit(d.Rh, hi);
    const col = opts.driverColor || cfg.color || '#ffcc00';
    const SKINS = ['#f0c29a', '#e3b184', '#c98f60', '#a8734a', '#7d5136'];
    const skin = opts.skinTone || SKINS[(Math.random() * SKINS.length) | 0];
    const head = new T.Group(); head.name = 'driverHead'; head.position.copy(d.head);
    if (d.pitch) head.rotation.x = d.pitch; if (d.yaw) head.rotation.y = d.yaw;
    const shellMat = mat('helmet' + col, () => (hi
      ? new T.MeshPhysicalMaterial({ color: new T.Color(col), metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 })
      : std({ color: new T.Color(col), metalness: 0.3, roughness: 0.4, envMapIntensity: 1.0 })));
    const castS = hi;
    const add = (geo, m, order) => { const me = new T.Mesh(geo, m); if (order) me.renderOrder = order; head.add(me); return me; };
    const shell = add(hk.shell, shellMat); shell.castShadow = castS;
    add(hk.trim, MAT.black());
    add(hk.liner, MAT.interior());
    { const nh = raw.suitFrom === 'dark' ? '#14171f' : (raw.suitFrom === 'paint' ? cfg.color : col); add(hk.neck, mat('suit' + nh, () => std({ color: new T.Color(nh), roughness: 0.55, metalness: 0.12, envMapIntensity: 0.5 }))); }
    const stripeMat = mat('stripe', () => { const m = std({ color: 0xf4f6f8, roughness: 0.4, metalness: 0.2, envMapIntensity: 0.8 }); m.side = T.DoubleSide; return m; });
    add(hk.stripe, stripeMat);
    [-1, 1].forEach(s => { const sc = new T.Mesh(hk.screw, MAT.chrome()); sc.position.set(s * hk.Rh * 0.93, 0.08 * hk.Rh, 0.12 * hk.Rh); head.add(sc); });
    const faceMat = new T.MeshBasicMaterial({ map: cartoonFaceTex('neutral', skin) });
    const faceGeo = hk.face.clone();
    const face = add(faceGeo, faceMat);
    const ovMat = new T.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const ov = new T.Mesh(hk.face, ovMat); ov.scale.setScalar(1.012); ov.visible = false; ov.renderOrder = 3; head.add(ov);
    add(hk.vis, MAT.visor(), 4);
    chassis.add(head);

    const baseUV = Array.from(hk.face.attributes.uv.array);
    let tex = null, expr = 'neutral', night = false;
    const applyUV = (t) => {
      const uv = faceGeo.attributes.uv; let aspect = 1;
      const im = t && t.image; if (im) { const w = im.naturalWidth || im.videoWidth || im.width, h = im.naturalHeight || im.videoHeight || im.height; if (w && h) aspect = w / h; }
      for (let i = 0; i < uv.count; i++) {
        let u = baseUV[i * 2], v = baseUV[i * 2 + 1];
        if (aspect > 1) u = 0.5 + (u - 0.5) / aspect; else if (aspect < 1) v = 0.5 + (v - 0.5) * aspect;
        uv.setXY(i, u, v);
      }
      uv.needsUpdate = true;
    };
    const apply = () => {
      faceMat.map = tex || cartoonFaceTex(expr, skin); faceMat.needsUpdate = true;
      const showOv = expr !== 'neutral' && (!!tex || expr === 'cool' || expr === 'ouch' || expr === 'happy');
      ov.visible = showOv; if (showOv) { ovMat.map = overlayTex(expr, !tex); ovMat.needsUpdate = true; }
      faceMat.color.setScalar(night ? 0.7 : 1.0);
    };
    const api = {
      head,
      setTexture(t) {
        tex = t || null;
        if (tex) { if (tex.encoding !== T.sRGBEncoding) { tex.encoding = T.sRGBEncoding; tex.needsUpdate = true; } applyUV(tex); } else applyUV(null);
        apply();
      },
      setExpression(e) { expr = (e === 'happy' || e === 'ouch' || e === 'cool') ? e : 'neutral'; apply(); }
    };
    if (opts.driverTexture) api.setTexture(opts.driverTexture); else apply();
    return { api, setNight(on) { night = !!on; apply(); } };
  }

  // --------------------------------------------------------------------------
  // PUBLIC ENTRY
  // --------------------------------------------------------------------------
  F.createVehicle3D = function (vehConfig, equippedAccessories, opts) {
    const cfg = vehConfig || window.VEHICLES[0];
    const acc = Array.isArray(equippedAccessories) ? equippedAccessories : [];
    opts = opts || {};
    return instantiate(getKit(cfg), cfg, acc, opts);
  };
  // optional: build all geometry kits up-front (e.g. during the loading screen) so the first race does not hitch (~100-250 ms each)
  F.prewarmVehicles = function (cfgs) { (cfgs || window.VEHICLES || []).forEach(c => getKit(c)); getEnv(); };
  F.vehicles3DInfo = { version: 1 };
  F._vehiclesInternals = { wheelParts, roundBox, merge, xf, loft, carShell, getKit, KITS, MATS };
})();
