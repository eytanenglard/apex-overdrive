/* ============================================================================
 * APEX OVERDRIVE - pit3d.js  (MODULE 2: gas stations + pit garages with crews)
 * ----------------------------------------------------------------------------
 *   const ctrl = window.pit3DFactory.createStation(stationData, track, scene?)
 *   ctrl.group / parkLaneX / parkLocalZ / update(dt, focus) / prepare(veh)
 *   ctrl.startService(veh, kind, onProgress, onDone) / cancel() / cheer()
 *
 * Everything is procedural (geometry + CanvasTexture).  People are built from
 * a handful of shared vertex-coloured geometries and animated procedurally
 * (walk cycle, squat, 2-bone arm IK onto tools/wheels).  Every service is a
 * deterministic function of time (scripted segments), restore is explicit.
 * three.js r128 (global build): no CapsuleGeometry, outputEncoding.
 * ========================================================================== */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') { console.error('pit3d: THREE is missing'); return; }
  const T = THREE;

  // ------------------------------------------------------------------ utils
  const PI = Math.PI, TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const seg01 = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; t = clamp(t, 0, 1); return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const pingpong = (t) => 1 - Math.abs(1 - 2 * (t - Math.floor(t)));
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };

  const _v1 = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3(), _v4 = new T.Vector3(), _v5 = new T.Vector3();
  const _q1 = new T.Quaternion(), _q2 = new T.Quaternion();
  const _m1 = new T.Matrix4(), _m2 = new T.Matrix4(), _n3 = new T.Matrix3();
  const _e1 = new T.Euler(), _c1 = new T.Color();
  const AX = new T.Vector3(1, 0, 0), AY = new T.Vector3(0, 1, 0), AZ = new T.Vector3(0, 0, 1);

  function trs(x, y, z, sx, sy, sz, rx, ry, rz) {
    _e1.set(rx || 0, ry || 0, rz || 0, 'YXZ');
    _q2.setFromEuler(_e1);
    return _m2.compose(_v5.set(x, y, z), _q2, _v4.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz));
  }

  const isLow = () => !!(window.world3DFactory && window.world3DFactory.quality === 'low');

  // ------------------------------------------------------- shared geometries
  let G = null;
  function geos() {
    if (G) return G;
    G = {};
    G.box = new T.BoxGeometry(1, 1, 1);
    G.cyl = new T.CylinderGeometry(1, 1, 1, 14, 1);
    G.cyl8 = new T.CylinderGeometry(1, 1, 1, 8, 1);
    G.cyl6 = new T.CylinderGeometry(1, 1, 1, 6, 1);
    G.cone = new T.ConeGeometry(1, 1, 16, 1);
    G.sph = new T.SphereGeometry(1, 12, 9);
    G.sphS = new T.SphereGeometry(1, 8, 6);
    G.hemi = new T.SphereGeometry(1, 12, 6, 0, TAU, 0, PI / 2);
    G.quad = new T.PlaneGeometry(1, 1);
    G.torus = new T.TorusGeometry(1, 0.2, 8, 20);
    return G;
  }

  // ------------------------------------- tiny geometry merger (vertex colours)
  class GB {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; }
    add(geo, color, m) {
      const pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv, ca = geo.attributes.color;
      _n3.getNormalMatrix(m);
      const own = color === null && !!ca;
      if (!own) _c1.set(color === null ? 0xffffff : color);
      for (let k = 0; k < pa.count; k++) {
        _v1.fromBufferAttribute(pa, k).applyMatrix4(m);
        this.p.push(_v1.x, _v1.y, _v1.z);
        _v2.fromBufferAttribute(na, k).applyMatrix3(_n3).normalize();
        this.n.push(_v2.x, _v2.y, _v2.z);
        this.u.push(ua ? ua.getX(k) : 0, ua ? ua.getY(k) : 0);
        if (own) this.c.push(ca.getX(k), ca.getY(k), ca.getZ(k)); else this.c.push(_c1.r, _c1.g, _c1.b);
      }
      if (geo.index) { for (let k = 0; k < geo.index.count; k++) this.i.push(geo.index.getX(k) + this.v); }
      else { for (let k = 0; k < pa.count; k++) this.i.push(this.v + k); }
      this.v += pa.count;
      return this;
    }
    geo(g, color, x, y, z, sx, sy, sz, rx, ry, rz) { return this.add(g, color, trs(x, y, z, sx, sy, sz, rx, ry, rz)); }
    box(color, x, y, z, sx, sy, sz, rx, ry, rz) { return this.add(geos().box, color, trs(x, y, z, sx, sy, sz, rx, ry, rz)); }
    cyl(color, x, y, z, rx, h, rz, ax, ay, az) { return this.add(geos().cyl, color, trs(x, y, z, rx, h, rz, ax, ay, az)); }
    cyl8(color, x, y, z, rx, h, rz, ax, ay, az) { return this.add(geos().cyl8, color, trs(x, y, z, rx, h, rz, ax, ay, az)); }
    sph(color, x, y, z, rx, ry, rz) { return this.add(geos().sph, color, trs(x, y, z, rx, ry === undefined ? rx : ry, rz === undefined ? rx : rz)); }
    sphS(color, x, y, z, rx, ry, rz) { return this.add(geos().sphS, color, trs(x, y, z, rx, ry === undefined ? rx : ry, rz === undefined ? rx : rz)); }
    cone(color, x, y, z, rx, h, rz, ax, ay, az) { return this.add(geos().cone, color, trs(x, y, z, rx, h, rz, ax, ay, az)); }
    hemi(color, x, y, z, rx, ry, rz, ax, ay, az) { return this.add(geos().hemi, color, trs(x, y, z, rx, ry, rz, ax, ay, az)); }
    build() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setIndex(new T.BufferAttribute(this.v > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i), 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
  }
  function taperGeo(rTop, rBot, len, seg) {
    const g = new T.CylinderGeometry(rTop, rBot, len, seg || 8, 1);
    g.translate(0, -len / 2, 0);
    return g;
  }

  // ------------------------------------------------------------- materials
  let MATS = null;
  function mats() {
    const low = isLow();
    if (MATS && MATS.low === low) return MATS;
    const std = (o) => { if (low) { const l = Object.assign({}, o); delete l.roughness; delete l.metalness; delete l.envMapIntensity; return new T.MeshLambertMaterial(l); } return new T.MeshStandardMaterial(Object.assign({ roughness: 0.75, metalness: 0.05 }, o)); };
    const M = { low };
    M.solid = std({ vertexColors: true, roughness: 0.78, metalness: 0.04, envMapIntensity: 0.3 });
    M.metal = low ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85, envMap: (window.world3DFactory && window.world3DFactory.envMap) || null, envMapIntensity: 0.9 });
    M.paint = low ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2, envMap: (window.world3DFactory && window.world3DFactory.envMap) || null, envMapIntensity: 0.45 });
    M.person = std({ vertexColors: true, roughness: 0.86, metalness: 0.02, envMapIntensity: 0.35 });
    M.emis = new T.MeshBasicMaterial({ vertexColors: true });
    M.glass = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false });
    M.rubber = std({ color: 0x17181b, roughness: 0.92, metalness: 0 });
    M.hose = std({ color: 0x24262a, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.15 });
    M.steel = low ? new T.MeshLambertMaterial({ color: 0xaab2bb }) : new T.MeshStandardMaterial({ color: 0xaab2bb, roughness: 0.3, metalness: 0.9, envMap: (window.world3DFactory && window.world3DFactory.envMap) || null });
    M.shadow = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
    M.glowAdd = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
    MATS = M;
    return M;
  }
  const solidMat = (color, o) => { const low = isLow(); return low ? new T.MeshLambertMaterial(Object.assign({ color }, o || {})) : new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.1 }, o || {})); };

  // -------------------------------------------------------------- textures
  function canvasTex(w, h, draw, opts) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    draw(ctx, w, h);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    const r = window.world3DFactory && window.world3DFactory.renderer;
    t.anisotropy = r && r.capabilities ? Math.min(8, r.capabilities.getMaxAnisotropy()) : 4;
    if (opts) Object.assign(t, opts);
    return t;
  }
  const FONT = '"Rubik","Heebo","Segoe UI",Arial,sans-serif';
  function heb(ctx, text, x, y, font, color, align) {
    ctx.save(); ctx.direction = 'rtl'; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.font = font; ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  const TEX = {};
  function glowTex() {
    if (TEX.glow) return TEX.glow;
    return (TEX.glow = canvasTex(64, 64, (c) => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    }));
  }
  function hexTex() {
    if (TEX.hex) return TEX.hex;
    return (TEX.hex = canvasTex(256, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      const R = 22, hh = R * Math.sqrt(3);
      c.strokeStyle = 'rgba(120,235,255,0.95)'; c.lineWidth = 3;
      for (let row = -1; row < h / hh + 1; row++) for (let col = -1; col < w / (R * 1.5) + 1; col++) {
        const cx = col * R * 1.5, cy = row * hh + (col % 2 ? hh / 2 : 0);
        c.beginPath();
        for (let k = 0; k < 6; k++) { const a = k * PI / 3; const px = cx + R * Math.cos(a), py = cy + R * Math.sin(a); k ? c.lineTo(px, py) : c.moveTo(px, py); }
        c.closePath(); c.stroke();
        if (((row * 7 + col * 3) % 5) === 0) { c.fillStyle = 'rgba(80,200,255,0.35)'; c.fill(); }
      }
    }, { wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping }));
  }
  function dashTex() {
    if (TEX.dash) return TEX.dash;
    return (TEX.dash = canvasTex(8, 64, (c, w, h) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) { const g = c.createLinearGradient(0, i * 16, 0, i * 16 + 16); g.addColorStop(0, 'rgba(255,190,40,0)'); g.addColorStop(0.5, 'rgba(255,200,60,1)'); g.addColorStop(1, 'rgba(255,190,40,0)'); c.fillStyle = g; c.fillRect(0, i * 16, w, 16); }
    }, { wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping }));
  }

  // ====================================================== particles (instanced)
  class Fx {
    constructor(parent) {
      const low = isLow(), g = geos();
      const mk = (geo, mat, cap) => {
        const m = new T.InstancedMesh(geo, mat, cap);
        m.instanceMatrix.setUsage(T.DynamicDrawUsage);
        m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        m.instanceColor.setUsage(T.DynamicDrawUsage);
        m.frustumCulled = false; m.count = 0; m.renderOrder = 6;
        parent.add(m);
        const P = [];
        for (let i = 0; i < cap; i++) P.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.05, len: 0, r: 1, g: 1, b: 1, grav: 0, drag: 0, grow: 0, ax: 0, ay: 0, vax: 0, vay: 0, bounce: 0 });
        return { mesh: m, P, n: 0, cap };
      };
      this.add = mk(g.box, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthWrite: false }), low ? 90 : 240);
      this.soft = mk(g.sphS, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34, depthWrite: false }), low ? 20 : 56);
      this.conf = mk(g.quad, new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide }), low ? 40 : 110);
      this.sp = [];
      const NS = low ? 20 : 48;
      for (let i = 0; i < NS; i++) {
        const m = new T.SpriteMaterial({ map: glowTex(), color: 0xffffff, blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
        const sp = new T.Sprite(m); sp.visible = false; sp.renderOrder = 6; parent.add(sp);
        this.sp.push({ s: sp, m, on: false, life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.1, grav: 0, grow: 0, a: 1 });
      }
      this.active = false;
    }
    _take(pl) { if (pl.n >= pl.cap) return null; const p = pl.P[pl.n++]; this.active = true; p.grow = 0; p.len = 0; p.bounce = 0; p.drag = 0; p.grav = 0; p.vax = 0; p.vay = 0; return p; }
    /** streak spark (additive); len>0 stretches along velocity */
    spark(x, y, z, vx, vy, vz, life, size, color, len) {
      const p = this._take(this.add); if (!p) return;
      _c1.set(color === undefined ? 0xffc060 : color);
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = p.max = life; p.size = size; p.len = len === undefined ? 5 : len;
      p.r = _c1.r; p.g = _c1.g; p.b = _c1.b; p.grav = 9; p.bounce = 1; p.drag = 0.4;
    }
    /** soft additive glow sprite (flash / droplet) */
    glow(x, y, z, vx, vy, vz, life, size, color, grav, grow) {
      let q = null; for (let i = 0; i < this.sp.length; i++) if (!this.sp[i].on) { q = this.sp[i]; break; }
      if (!q) return;
      _c1.set(color === undefined ? 0xffffff : color);
      q.on = true; q.life = q.max = life; q.x = x; q.y = y; q.z = z; q.vx = vx; q.vy = vy; q.vz = vz; q.size = size; q.grav = grav || 0; q.grow = grow || 0.0;
      q.m.color.copy(_c1); q.s.visible = true; q.s.position.set(x, y, z); q.s.scale.set(size, size, 1); q.m.opacity = 0.8; this.active = true;
    }
    puff(x, y, z, vx, vy, vz, life, size, grow, shade) {
      const p = this._take(this.soft); if (!p) return;
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = p.max = life; p.size = size; p.grow = grow || 2.2;
      const s = shade === undefined ? 0.8 : shade; p.r = s; p.g = s * 0.97; p.b = s * 0.92; p.drag = 1.2;
    }
    confetti(x, y, z, vx, vy, vz, color) {
      const p = this._take(this.conf); if (!p) return;
      _c1.set(color);
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = p.max = rnd(1.6, 2.6); p.size = rnd(0.07, 0.12);
      p.r = _c1.r; p.g = _c1.g; p.b = _c1.b; p.grav = 3.2; p.drag = 1.4; p.ax = rnd(0, TAU); p.ay = rnd(0, TAU); p.vax = rnd(-9, 9); p.vay = rnd(-9, 9);
    }
    burst(x, y, z, n, speed, color, dx, dy, dz, spread) {
      for (let i = 0; i < n; i++) {
        _v1.set(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize();
        if (dx !== undefined) { _v1.multiplyScalar(spread === undefined ? 0.6 : spread).add(_v2.set(dx, dy, dz)).normalize(); }
        const s = speed * rnd(0.5, 1.2);
        this.spark(x, y, z, _v1.x * s, _v1.y * s, _v1.z * s, rnd(0.25, 0.6), 0.025, color);
      }
    }
    update(dt) {
      if (!this.active) return;
      const a = this._run(this.add, dt, 1), s = this._run(this.soft, dt, 2), c = this._run(this.conf, dt, 3);
      let g = false;
      for (let i = 0; i < this.sp.length; i++) {
        const q = this.sp[i]; if (!q.on) continue;
        q.life -= dt; if (q.life <= 0) { q.on = false; q.s.visible = false; continue; }
        g = true; q.vy -= q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        const f = q.life / q.max; q.s.position.set(q.x, q.y, q.z);
        const sz = q.size * (q.grow ? 1 + q.grow * (1 - f) : 0.75 + 0.25 * f); q.s.scale.set(sz, sz, 1); q.m.opacity = 0.85 * Math.min(1, f * 2.2);
      }
      this.active = a || s || c || g;
    }
    _run(pl, dt, kind) {
      const P = pl.P, mesh = pl.mesh;
      let n = pl.n;
      if (!n && !pl.had) return false;
      for (let i = 0; i < n;) {
        const p = P[i];
        p.life -= dt;
        if (p.life <= 0) { P[i] = P[n - 1]; P[n - 1] = p; n--; continue; }
        p.vy -= p.grav * dt;
        if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; p.vz *= d; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.bounce && p.y < 0.03) { p.y = 0.03; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
        const f = p.life / p.max;
        let s = p.size;
        if (p.grow) s *= 1 + (p.grow - 1) * (1 - f);
        let k = 1;
        if (kind === 1) { k = clamp(f * 2.4, 0, 1); }
        if (kind === 2) { s *= clamp(f / 0.35, 0, 1); }
        if (kind === 3) { s *= clamp(f / 0.2, 0, 1); }
        if (kind === 1 && p.len > 0) {
          const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
          if (sp > 0.05) { _v3.set(p.vx / sp, p.vy / sp, p.vz / sp); _q1.setFromUnitVectors(AZ, _v3); } else _q1.identity();
          _v4.set(s, s, s * (1 + p.len * Math.min(1, sp * 0.18)));
        } else if (kind === 3) {
          p.ax += p.vax * dt; p.ay += p.vay * dt; _e1.set(p.ax, p.ay, 0); _q1.setFromEuler(_e1); _v4.set(s, s, s);
        } else { _q1.identity(); _v4.set(s, s, s); }
        _m1.compose(_v3.set(p.x, p.y, p.z), _q1, _v4);
        mesh.setMatrixAt(i, _m1);
        mesh.instanceColor.setXYZ(i, p.r * k, p.g * k, p.b * k);
        i++;
      }
      const changed = n !== pl.n || n > 0;
      pl.had = n > 0; pl.n = n; mesh.count = n; mesh.visible = n > 0;
      if (changed) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
      return n > 0;
    }
    clear() { for (const pl of [this.add, this.soft, this.conf]) { pl.n = 0; pl.mesh.count = 0; pl.had = false; } for (const q of this.sp) { q.on = false; q.s.visible = false; } this.active = false; }
  }

  // ================================================================ people
  const HIP_Y = 0.99, UA = 0.29, FA = 0.29;
  const SKINS = [0xf1c6a0, 0xd9a577, 0xb9784f, 0x7d4c32];
  const HAIRS = [0x2a1a10, 0x4a3020, 0x151515, 0xb07a3a, 0x7a2e1a];
  const PERSON_GEO = {};
  function personGeos(s) {
    const key = [s.top, s.accent, s.pants, s.skin, s.hair, s.hat, s.hatColor, s.vest, s.glove, s.pack, s.sleeve, s.belt].join('|');
    if (PERSON_GEO[key]) return PERSON_GEO[key];
    const top = s.top, accent = s.accent, pants = s.pants, skin = s.skin, hair = s.hair;
    const glove = s.glove !== undefined ? s.glove : 0x2b2d31, sleeve = s.sleeve !== undefined ? s.sleeve : top;
    const o = {};
    let b = new GB();
    b.box(pants, 0, -0.02, 0, 0.33, 0.2, 0.21).box(s.belt || 0x26272b, 0, 0.075, 0, 0.345, 0.04, 0.225);
    o.pelvis = b.build();
    b = new GB(); b.add(taperGeo(0.1, 0.073, 0.46, 8), pants, trs(0, 0, 0)).sphS(pants, 0, 0, 0, 0.1).sphS(pants, 0, -0.46, 0, 0.076);
    o.thigh = b.build();
    b = new GB(); b.add(taperGeo(0.073, 0.056, 0.455, 8), pants, trs(0, 0, 0));
    o.shin = b.build();
    b = new GB(); b.box(0x1d1b1a, 0, -0.035, 0.065, 0.105, 0.085, 0.27).box(0x4a4a4c, 0, -0.077, 0.065, 0.11, 0.02, 0.275);
    o.boot = b.build();
    b = new GB(); b.add(taperGeo(0.073, 0.056, 0.455, 8), pants, trs(0, 0, 0)).box(0x1d1b1a, 0, -0.455 - 0.035, 0.065, 0.105, 0.085, 0.27).box(0x4a4a4c, 0, -0.455 - 0.077, 0.065, 0.11, 0.02, 0.275);
    o.shinBoot = b.build();
    // torso (pivot at belt level, extends +Y)
    b = new GB();
    b.cyl(top, 0, 0.3, 0, 0.205, 0.5, 0.138);
    if (s.vest) b.cyl(s.vest, 0, 0.31, 0, 0.215, 0.44, 0.146);
    b.cyl(accent, 0, 0.2, 0, 0.221, 0.045, 0.149).cyl(accent, 0, 0.4, 0, 0.221, 0.045, 0.149);
    b.sph(top, 0.235, 0.52, 0, 0.085).sph(top, -0.235, 0.52, 0, 0.085);
    b.cyl(skin, 0, 0.585, 0, 0.042, 0.1, 0.042).cyl(top, 0, 0.55, 0, 0.085, 0.05, 0.065);
    b.box(accent, 0.1, 0.38, 0.144, 0.09, 0.05, 0.012);
    if (s.pack) b.box(s.pack, 0, 0.32, -0.16, 0.22, 0.3, 0.1);
    o.torso = b.build();
    // head (pivot at neck base)
    b = new GB();
    b.sph(skin, 0, 0.14, 0, 0.1, 0.116, 0.106).sphS(skin, 0.1, 0.14, 0, 0.02, 0.035, 0.025).sphS(skin, -0.1, 0.14, 0, 0.02, 0.035, 0.025);
    b.box(skin, 0, 0.125, 0.105, 0.026, 0.03, 0.03);
    b.sphS(0x15151a, 0.037, 0.155, 0.093, 0.013).sphS(0x15151a, -0.037, 0.155, 0.093, 0.013);
    b.box(0x8a3a30, 0, 0.095, 0.098, 0.045, 0.009, 0.012);
    if (s.hat === 'cap') { b.hemi(s.hatColor, 0, 0.15, -0.004, 0.118, 0.112, 0.122).box(s.hatColor, 0, 0.176, 0.112, 0.12, 0.012, 0.08); }
    else if (s.hat === 'helmet') { b.hemi(s.hatColor, 0, 0.15, -0.004, 0.13, 0.13, 0.135).box(accent, 0, 0.275, 0, 0.034, 0.012, 0.22).box(0x15202e, 0, 0.205, 0.108, 0.15, 0.03, 0.03).box(s.hatColor, 0, 0.19, 0.125, 0.15, 0.012, 0.06); }
    else { b.hemi(hair, 0, 0.145, -0.01, 0.108, 0.1, 0.113); }
    o.head = b.build();
    b = new GB(); b.add(taperGeo(0.064, 0.054, UA, 8), sleeve, trs(0, 0, 0)).sphS(sleeve, 0, -UA, 0, 0.058);
    o.uarm = b.build();
    for (const side of [1, -1]) {
      b = new GB();
      b.add(taperGeo(0.054, 0.046, 0.25, 8), sleeve, trs(0, 0, 0));
      b.sph(glove, 0, -0.275, 0.004, 0.06, 0.066, 0.063).cyl8(glove, -0.034 * side, -0.31, 0.012, 0.016, 0.07, 0.016, 0, 0, 0.35 * side);
      o['farm' + (side > 0 ? 'L' : 'R')] = b.build();
    }
    return (PERSON_GEO[key] = o);
  }

  let BLOB_TEX = null, BLOB_MAT = null;
  function blobMat() {
    if (!BLOB_MAT) {
      BLOB_TEX = canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
      BLOB_MAT = new T.MeshBasicMaterial({ map: BLOB_TEX, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    }
    return BLOB_MAT;
  }
  const BLOB_GEO = (() => { const g = new T.PlaneGeometry(1, 1); g.rotateX(-PI / 2); return g; })();

  class Person {
    constructor(spec) {
      const pg = personGeos(spec), M = mats();
      this.spec = spec;
      this.seed = rnd(0, 100);
      const root = this.root = new T.Group();
      const body = this.body = new T.Group(); body.scale.setScalar(spec.scale || 1.04); root.add(body);
      const hips = this.hips = new T.Group(); hips.position.y = HIP_Y; body.add(hips);
      const shadows = !isLow();
      const add = (parent, geo, cast) => { const m = new T.Mesh(geo, M.person); m.castShadow = !!cast && shadows; parent.add(m); return m; };
      add(hips, pg.pelvis, false);
      this.legs = [];
      for (const s of [1, -1]) {
        const hip = new T.Group(); hip.position.set(0.1 * s, -0.02, 0); hips.add(hip);
        add(hip, pg.thigh, false);
        const knee = new T.Group(); knee.position.y = -0.46; hip.add(knee);
        const foot = new T.Group(); foot.position.y = -0.455; knee.add(foot);
        if (isLow()) add(knee, pg.shinBoot, false); else { add(knee, pg.shin, false); add(foot, pg.boot, false); }
        this.legs.push({ hip, knee, foot, s });
      }
      const torso = this.torso = new T.Group(); torso.position.y = 0.04; hips.add(torso);
      add(torso, pg.torso, true);
      const neck = this.neck = new T.Group(); neck.position.y = 0.6; neck.rotation.order = 'YXZ'; neck.scale.setScalar(1.25); torso.add(neck);
      add(neck, pg.head, true);
      this.arms = [];
      for (const s of [1, -1]) {
        const sh = new T.Group(); sh.position.set(0.235 * s, 0.52, 0); torso.add(sh);
        add(sh, pg.uarm, false);
        const el = new T.Group(); el.position.y = -UA; sh.add(el);
        add(el, s > 0 ? pg.farmL : pg.farmR, false);
        this.arms.push({ sh, el, s });
      }
      const blob = new T.Mesh(BLOB_GEO, blobMat()); blob.scale.set(0.9, 1, 0.9); blob.position.y = 0.05; blob.renderOrder = 2; root.add(blob);
      this.blob = blob;
      root.userData.person = this;
      // placement + state
      this.x = 0; this.z = 0; this.yaw = 0; this.faceYaw = 0;
      this.mode = 'idle'; this.target = null; this.speed = 2.1; this.phase = rnd(0, 6);
      this.idleFn = IDLE.stand; this.time = rnd(0, 20);
      this.script = null; this._segIdx = -1; this._bl = null; this._last = new Float32Array(26); this._hasPose = false;
      this.tm = new T.Matrix4(); this.ti = new T.Matrix4(); this._dirty = true;
      this.role = ''; this.item = null;
    }
    // ---- placement
    place(x, z, yaw) { this.x = x; this.z = z; this.yaw = yaw; this.root.position.set(x, this.lift || 0, z); this.root.rotation.y = yaw; this._dirty = true; return this; }
    turn(target, dt, rate) { this.yaw += clamp(angDiff(this.yaw, target), -(rate || 9) * dt, (rate || 9) * dt); this.root.rotation.y = this.yaw; this._dirty = true; }
    teleport(x, z, yaw) { this.place(x, z, yaw); this.faceYaw = yaw; this.mode = 'idle'; this.target = null; return this; }
    goTo(x, z, faceYaw, speed) { this.target = { x, z }; this.faceYaw = faceYaw; this.speed = speed || 2.2; this.mode = 'goto'; }
    // ---- pose primitives (all additive on top of neutral())
    neutral() {
      this.body.rotation.set(0, 0, 0); this.body.position.set(0, 0, 0);
      this.hips.position.set(0, HIP_Y, 0); this.hips.rotation.set(0, 0, 0);
      this.torso.rotation.set(0, 0, 0); this.neck.rotation.set(0, 0, 0);
      for (const l of this.legs) { l.hip.rotation.set(0, 0, 0); l.knee.rotation.set(0, 0, 0); l.foot.rotation.set(0, 0, 0); }
      for (const a of this.arms) { a.sh.rotation.set(0.03, 0, 0.1 * a.s); a.el.rotation.set(-0.18, 0, 0); }
      this._dirty = true;
    }
    stride(ph, amp) {
      const s = Math.sin(ph), c = Math.cos(ph);
      const L = this.legs[0], R = this.legs[1];
      L.hip.rotation.x = -0.62 * amp * s; R.hip.rotation.x = 0.62 * amp * s;
      L.knee.rotation.x = amp * (0.1 + 0.85 * Math.max(0, c)); R.knee.rotation.x = amp * (0.1 + 0.85 * Math.max(0, -c));
      L.foot.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x); R.foot.rotation.x = -(R.hip.rotation.x + R.knee.rotation.x);
      this.arms[0].sh.rotation.x = 0.5 * amp * s; this.arms[1].sh.rotation.x = -0.5 * amp * s;
      this.arms[0].el.rotation.x = -0.25 * amp - 0.22 * amp * Math.max(0, -s); this.arms[1].el.rotation.x = -0.25 * amp - 0.22 * amp * Math.max(0, s);
      this.hips.position.y = HIP_Y - 0.03 * amp * Math.abs(s);
      this.torso.rotation.y = 0.12 * amp * s; this.torso.rotation.x = 0.05 * amp;
      this._dirty = true;
    }
    /** both feet planted, hip joint at height H (0.25..0.97) */
    squat(H, stance) {
      const a = 0.46, b = 0.455;
      const d = clamp(H - 0.0775, 0.3, a + b - 0.002);
      const kf = PI - Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
      const al = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
      for (const l of this.legs) { l.hip.rotation.x = -al; l.knee.rotation.x = kf; l.foot.rotation.x = al - kf; if (stance) l.hip.rotation.z = -l.s * stance; }
      this.hips.position.y = H + 0.02;
      this._dirty = true;
    }
    /** one leg forward lunge/kneel: front leg flexed, back knee near floor */
    lunge(H) {
      const a = 0.46, b = 0.455;
      const d = clamp(H - 0.0775, 0.3, a + b - 0.002);
      const kf = PI - Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
      const al = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
      const F = this.legs[0], B = this.legs[1];
      F.hip.rotation.x = -al - 0.35; F.knee.rotation.x = kf; F.foot.rotation.x = al + 0.35 - kf;
      B.hip.rotation.x = 0.25 + (0.97 - H) * 0.35; B.knee.rotation.x = 1.45; B.foot.rotation.x = -(B.hip.rotation.x + B.knee.rotation.x) + 0.2;
      this.hips.position.y = H + 0.02;
      this._dirty = true;
    }
    /** lying on the back (face up), head toward local -Z, hips at root origin */
    lieOnBack(h) {
      this.body.rotation.x = -PI / 2;
      this.body.position.set(0, h === undefined ? 0.2 : h, HIP_Y * this.body.scale.x);
      for (const l of this.legs) { l.hip.rotation.x = -0.1; l.knee.rotation.x = 0.1; l.foot.rotation.x = 0; }
      this._dirty = true;
    }
    bend(torsoX, headX, torsoY) { this.torso.rotation.x = torsoX; this.neck.rotation.x = headX === undefined ? -torsoX * 0.55 : headX; if (torsoY !== undefined) this.torso.rotation.y = torsoY; this._dirty = true; }
    sync() {
      this.root.updateMatrix(); this.body.updateMatrix(); this.hips.updateMatrix(); this.torso.updateMatrix();
      this.tm.copy(this.root.matrix).multiply(this.body.matrix).multiply(this.hips.matrix).multiply(this.torso.matrix);
      this.ti.copy(this.tm).invert(); this._dirty = false;
    }
    /** station-local point of a torso-local offset (for tools in front of the chest etc.) */
    torsoPoint(lx, ly, lz, out) { if (this._dirty) this.sync(); return out.set(lx, ly, lz).applyMatrix4(this.tm); }
    /** head look at station-local point */
    look(x, y, z, maxYaw) {
      if (this._dirty) this.sync();
      _v1.set(x, y, z).applyMatrix4(this.ti);
      const yaw = clamp(Math.atan2(_v1.x, _v1.z), -(maxYaw || 1.1), maxYaw || 1.1);
      const pit = clamp(Math.atan2(0.75 - _v1.y, Math.hypot(_v1.x, _v1.z)), -0.6, 0.7);
      this.neck.rotation.set(pit, yaw, 0);
    }
    /** 2-bone IK, target in station-local space */
    reach(k, x, y, z, px, py, pz) {
      if (this._dirty) this.sync();
      _v1.set(x, y, z).applyMatrix4(this.ti);
      this.reachLocal(k, _v1.x, _v1.y, _v1.z, px, py, pz);
    }
    /** 2-bone IK, target in torso-local space */
    reachLocal(k, tx, ty, tz, px, py, pz) {
      const A = this.arms[k], sp = A.sh.position;
      let vx = tx - sp.x, vy = ty - sp.y, vz = tz - sp.z;
      let d = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-4;
      const ux = vx / d, uy = vy / d, uz = vz / d;
      d = clamp(d, 0.09, UA + FA - 0.006);
      if (px === undefined) { px = 0.55 * A.s; py = -0.8; pz = -0.35; }
      const dot = px * ux + py * uy + pz * uz;
      let nx = px - ux * dot, ny = py - uy * dot, nz = pz - uz * dot;
      let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 1e-4) { nx = 0.0; ny = 0; nz = -1; const dd = nz * uz; nx -= ux * dd; ny -= uy * dd; nz -= uz * dd; nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; }
      nx /= nl; ny /= nl; nz /= nl;
      const cosA = clamp((UA * UA + d * d - FA * FA) / (2 * UA * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
      const e1x = ux * cosA + nx * sinA, e1y = uy * cosA + ny * sinA, e1z = uz * cosA + nz * sinA;
      const e2x = (ux * d - e1x * UA) / FA, e2y = (uy * d - e1y * UA) / FA, e2z = (uz * d - e1z * UA) / FA;
      // hinge axis w = u x n
      let wx = uy * nz - uz * ny, wy = uz * nx - ux * nz, wz = ux * ny - uy * nx;
      const wl = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1; wx /= wl; wy /= wl; wz /= wl;
      // Y = -e1 ; Z = X x Y
      const yx = -e1x, yy = -e1y, yz = -e1z;
      const zx = wy * yz - wz * yy, zy = wz * yx - wx * yz, zz = wx * yy - wy * yx;
      _m1.makeBasis(_v2.set(wx, wy, wz), _v3.set(yx, yy, yz), _v4.set(zx, zy, zz));
      A.sh.quaternion.setFromRotationMatrix(_m1);
      const ey = e2x * yx + e2y * yy + e2z * yz, ez = e2x * zx + e2y * zy + e2z * zz;
      A.el.rotation.set(Math.atan2(-ez, -ey), 0, 0);
    }
    /** station-local position of the hand (wrist end) after the pose is final */
    handPos(k, out) {
      this.root.updateMatrixWorld(true);
      return out.set(0, -FA - 0.02, 0).applyMatrix4(this.arms[k].el.matrixWorld);
    }
    // ---- pose blending (transition between script segments)
    snapshot(a) {
      let i = 0;
      a[i++] = this.hips.position.y;
      a[i++] = this.torso.rotation.x; a[i++] = this.torso.rotation.y; a[i++] = this.torso.rotation.z;
      a[i++] = this.neck.rotation.x; a[i++] = this.neck.rotation.y; a[i++] = this.neck.rotation.z;
      a[i++] = this.body.rotation.x; a[i++] = this.body.position.y; a[i++] = this.body.position.z;
      for (const l of this.legs) { a[i++] = l.hip.rotation.x; a[i++] = l.knee.rotation.x; a[i++] = l.foot.rotation.x; }
      for (const r of this.arms) { const q = r.sh.quaternion; a[i++] = q.x; a[i++] = q.y; a[i++] = q.z; a[i++] = q.w; a[i++] = r.el.rotation.x; }
    }
    blendFrom(a, k) {
      let i = 0;
      this.hips.position.y = lerp(a[i++], this.hips.position.y, k);
      const t = this.torso.rotation; t.set(lerp(a[i++], t.x, k), lerp(a[i++], t.y, k), lerp(a[i++], t.z, k));
      const n = this.neck.rotation; n.set(lerp(a[i++], n.x, k), lerp(a[i++], n.y, k), lerp(a[i++], n.z, k));
      this.body.rotation.x = lerp(a[i++], this.body.rotation.x, k); this.body.position.y = lerp(a[i++], this.body.position.y, k); this.body.position.z = lerp(a[i++], this.body.position.z, k);
      for (const l of this.legs) { l.hip.rotation.x = lerp(a[i++], l.hip.rotation.x, k); l.knee.rotation.x = lerp(a[i++], l.knee.rotation.x, k); l.foot.rotation.x = lerp(a[i++], l.foot.rotation.x, k); }
      for (const r of this.arms) { _q1.set(a[i], a[i + 1], a[i + 2], a[i + 3]); i += 4; _q1.slerp(r.sh.quaternion, k); r.sh.quaternion.copy(_q1); r.el.rotation.x = lerp(a[i++], r.el.rotation.x, k); }
      this._dirty = true;
    }
    // ---- frame update
    /** run scripted segments; t = seconds since service start */
    runScript(t, dt) {
      const S = this.script;
      let idx = 0;
      for (let i = 0; i < S.length; i++) if (t >= S[i].a) idx = i;
      const sg = S[idx];
      if (idx !== this._segIdx) { this._segIdx = idx; if (this._hasPose) this._bl = { k: 0 }; }
      this.neutral();
      sg.fn(clamp((t - sg.a) / Math.max(1e-4, sg.b - sg.a), 0, 1), t, dt, this);
      if (this._dirty) this.sync();
      if (this._bl) { this._bl.k += dt / 0.17; this.blendFrom(this._last, sstep(this._bl.k)); if (this._bl.k >= 1) this._bl = null; }
      this.snapshot(this._last); this._hasPose = true;
    }
    /** idle / goto behaviour */
    tick(dt) {
      this.time += dt;
      if (this.mode === 'goto' && this.target) {
        const dx = this.target.x - this.x, dz = this.target.z - this.z, dist = Math.hypot(dx, dz);
        const step = this.speed * dt;
        let amp = clamp(this.speed / 1.8, 0.7, 1.5);
        if (dist <= step) { this.place(this.target.x, this.target.z, this.yaw); this.mode = 'idle'; this.target = null; amp = 0; }
        else {
          this.place(this.x + dx / dist * step, this.z + dz / dist * step, this.yaw);
          const want = Math.atan2(dx, dz);
          this.yaw += clamp(angDiff(this.yaw, want), -9 * dt, 9 * dt); this.root.rotation.y = this.yaw;
          this.phase += step * 3.93;
        }
        this.neutral();
        if (amp > 0) this.stride(this.phase, amp);
      } else {
        const dy = angDiff(this.yaw, this.faceYaw);
        if (Math.abs(dy) > 1e-3) { this.yaw += clamp(dy, -7 * dt, 7 * dt); this.root.rotation.y = this.yaw; }
        this.neutral();
        this.idleFn(this, this.time, dt);
      }
      if (this._dirty) this.sync();
      if (this._bl) { this._bl.k += dt / 0.22; this.blendFrom(this._last, sstep(this._bl.k)); if (this._bl.k >= 1) this._bl = null; if (this._dirty) this.sync(); }
      this.snapshot(this._last); this._hasPose = true;
    }
    setScript(segs) { this.script = segs; this._segIdx = -1; this._bl = null; this.mode = 'script'; }
    endScript() { this.script = null; this._segIdx = -1; this.mode = 'idle'; this._bl = this._hasPose ? { k: 0 } : null; }
  }

  // idle behaviours -----------------------------------------------------------
  const sinT = Math.sin;
  const IDLE = {
    stand(p, t) {
      p.torso.rotation.x = 0.02 + 0.015 * sinT(t * 1.6 + p.seed); p.neck.rotation.y = 0.35 * sinT(t * 0.45 + p.seed); p.neck.rotation.x = 0.05 * sinT(t * 0.7 + p.seed);
      p.arms[0].sh.rotation.x = 0.04 * sinT(t * 1.1 + p.seed);
    },
    hips(p, t) {
      p.torso.rotation.x = 0.02; p.neck.rotation.y = 0.4 * sinT(t * 0.4 + p.seed);
      p.reachLocal(0, 0.27, 0.12, 0.05, 1.2, -0.2, -0.3); p.reachLocal(1, -0.27, 0.12, 0.05, -1.2, -0.2, -0.3);
    },
    crossed(p, t) {
      p.torso.rotation.x = 0.03; p.neck.rotation.y = 0.5 * sinT(t * 0.35 + p.seed);
      p.reachLocal(0, -0.12, 0.28, 0.17, 0.2, -1, 0.1); p.reachLocal(1, 0.12, 0.34, 0.2, -0.2, -1, 0.1);
    },
    ready(p, t) {   // athletic ready stance, hands forward
      p.squat(0.82); p.torso.rotation.x = 0.28; p.neck.rotation.x = -0.25 + 0.04 * sinT(t * 2 + p.seed);
      p.reachLocal(0, 0.2, 0.2, 0.3); p.reachLocal(1, -0.2, 0.2, 0.3);
    },
    wave(p, t) {
      p.torso.rotation.x = 0.02; p.neck.rotation.y = 0.15 * sinT(t * 1.3);
      p.arms[0].sh.rotation.set(-2.7, 0, 0.35); p.arms[0].el.rotation.x = -0.35 + 0.5 * sinT(t * 9);
      p.arms[0].sh.rotation.z = 0.35 + 0.18 * sinT(t * 9);
    },
    cheer(p, t) {
      const j = Math.abs(sinT(t * 7 + p.seed)); p.hips.position.y = HIP_Y + 0.1 * j;
      p.legs[0].knee.rotation.x = 0.3 * (1 - j); p.legs[1].knee.rotation.x = 0.3 * (1 - j);
      p.arms[0].sh.rotation.set(-2.9 + 0.3 * sinT(t * 7 + p.seed), 0, 0.4); p.arms[1].sh.rotation.set(-2.9 + 0.3 * sinT(t * 7 + p.seed + 1.5), 0, -0.4);
      p.arms[0].el.rotation.x = -0.25; p.arms[1].el.rotation.x = -0.25; p.neck.rotation.x = -0.25; p.torso.rotation.x = -0.05;
    },
    pump(p, t) {    // tyre inflating: crouched, pumping
      p.squat(0.5); p.torso.rotation.x = 0.7; p.neck.rotation.x = -0.4;
      const k = sinT(t * 5);
      p.reach(0, p.x + sinT(p.yaw) * 0.45, 0.35 + 0.18 * k, p.z + Math.cos(p.yaw) * 0.45);
      p.reach(1, p.x + sinT(p.yaw) * 0.47, 0.35 + 0.18 * k, p.z + Math.cos(p.yaw) * 0.47);
    },
    wipe(p, t) {    // wiping a surface in front with a rag
      p.torso.rotation.x = 0.18; p.neck.rotation.x = 0.1; const k = sinT(t * 4.2);
      p.reachLocal(0, 0.1 + 0.12 * k, 0.4 + 0.1 * Math.abs(k), 0.36, 0.5, -1, 0);
      p.reachLocal(1, -0.25, 0.16, 0.12, -1, -1, -0.2);
    },
    clip(p, t) {    // reading a clipboard
      p.torso.rotation.x = 0.06; p.neck.rotation.x = 0.28; p.neck.rotation.y = 0.3 * sinT(t * 0.5 + p.seed);
      p.reachLocal(1, -0.1, 0.24, 0.27, -0.4, -1, -0.2); p.reachLocal(0, 0.1, 0.3, 0.26, 0.4, -1, -0.2);
    }
  };

  window.pit3DFactory = window.pit3DFactory || {};
  window.pit3DFactory._internals = { Person, Fx, GB, geos, mats, IDLE, personGeos, SKINS, HAIRS, canvasTex, trs, T };

  // ============================================ station textures (cached)
  function icoPump(c, x, y, s, col) {
    c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 6; c.lineCap = 'round';
    rrect(c, -22, -34, 34, 68, 6); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(-16, -26, 22, 18);
    c.beginPath(); c.moveTo(12, -18); c.lineTo(24, -10); c.lineTo(24, 14); c.arc(30, 14, 6, PI, 0); c.lineTo(36, -16); c.stroke();
    c.fillStyle = col; c.fillRect(-28, 34, 46, 7);
    c.restore();
  }
  function icoWrench(c, x, y, s, col) {
    c.save(); c.translate(x, y); c.rotate(-0.7); c.scale(s, s); c.fillStyle = col; c.strokeStyle = col;
    c.lineWidth = 15; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 12); c.lineTo(0, 60); c.stroke();
    c.beginPath(); c.arc(0, -12, 24, 0.55 * PI, 2.45 * PI); c.lineWidth = 17; c.stroke();
    c.clearRect(-10, -48, 20, 28);
    c.restore();
  }
  function icoCheck(c, x, y, s, col) { c.save(); c.translate(x, y); c.scale(s, s); c.strokeStyle = col; c.lineWidth = 16; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(-26, 2); c.lineTo(-8, 22); c.lineTo(28, -24); c.stroke(); c.restore(); }

  function texFascia() {
    if (TEX.fascia) return TEX.fascia;
    return (TEX.fascia = canvasTex(2048, 160, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#e23a2c'); g.addColorStop(1, '#b81f17'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffc20e'; c.fillRect(0, h - 20, w, 11); c.fillStyle = '#fff'; c.fillRect(0, h - 8, w, 8);
      c.save(); c.font = `900 108px ${FONT}`; c.textBaseline = 'middle'; c.textAlign = 'center';
      c.lineWidth = 8; c.strokeStyle = '#7d1008'; c.fillStyle = '#ffd21a'; c.strokeText('OCTANE', w * 0.5 - 520, h / 2 - 8); c.fillText('OCTANE', w * 0.5 - 520, h / 2 - 8); c.restore();
      icoPump(c, w * 0.5 - 900, h / 2 - 6, 1.0, '#ffd21a');
      heb(c, 'תחנת דלק', w * 0.5 + 40, h / 2 - 8, `800 100px ${FONT}`, '#ffffff');
      heb(c, 'פתוח 24 שעות', w * 0.5 + 640, h / 2 - 8, `700 66px ${FONT}`, '#ffe9a8');
      icoPump(c, w * 0.5 + 960, h / 2 - 6, 1.0, '#ffd21a');
    }));
  }
  function texPylon(kind) {
    const key = 'pylon' + kind; if (TEX[key]) return TEX[key];
    return (TEX[key] = canvasTex(512, 900, (c, w, h) => {
      c.fillStyle = '#f4f4ee'; c.fillRect(0, 0, w, h);
      const isFuel = kind === 'fuel';
      c.fillStyle = isFuel ? '#d2281f' : '#1b55c4'; rrect(c, 0, 0, w, 330, 0); c.fill();
      c.fillStyle = '#ffc20e'; c.fillRect(0, 322, w, 14);
      if (isFuel) {
        c.fillStyle = '#ffc20e'; c.beginPath(); c.arc(w / 2, 150, 118, 0, TAU); c.fill(); c.fillStyle = '#d2281f'; c.beginPath(); c.arc(w / 2, 150, 98, 0, TAU); c.fill();
        c.save(); c.font = `900 64px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffd21a'; c.fillText('OCTANE', w / 2, 154); c.restore();
        heb(c, 'תחנת דלק', w / 2, 292, `800 52px ${FONT}`, '#fff');
        const rows = [['אוקטן 95', '7.29'], ['אוקטן 98', '7.89'], ['סולר', '7.05']];
        rows.forEach((r, i) => { const y = 380 + i * 120; c.fillStyle = '#16181c'; rrect(c, 24, y, w - 48, 100, 12); c.fill(); heb(c, r[0], w - 50, y + 50, `700 44px ${FONT}`, '#ffffff', 'right'); c.save(); c.font = `800 62px "Courier New",monospace`; c.fillStyle = '#5dff8e'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(r[1], 44, y + 52); c.restore(); });
        c.fillStyle = '#16a34a'; c.fillRect(0, 760, w, 140); heb(c, 'פתוח כל היום', w / 2, 830, `800 64px ${FONT}`, '#fff');
      } else {
        icoWrench(c, w / 2, 130, 2.0, '#ffd21a');
        heb(c, 'מוסך', w / 2, 270, `900 100px ${FONT}`, '#fff');
        c.save(); c.font = `800 52px ${FONT}`; c.textAlign = 'center'; c.fillStyle = '#16181c'; c.fillText('APEX PIT', w / 2, 420); c.restore();
        const rows = ['החלפת צמיגים', 'טורבו ובולמים', 'מגן אנרגיה'];
        rows.forEach((r, i) => { const y = 470 + i * 100; c.fillStyle = '#1b55c4'; rrect(c, 28, y, w - 56, 82, 12); c.fill(); heb(c, r, w / 2, y + 42, `700 46px ${FONT}`, '#fff'); });
        c.fillStyle = '#ffc20e'; c.fillRect(0, 790, w, 110); heb(c, 'צוות פיט מקצועי', w / 2, 846, `800 56px ${FONT}`, '#16181c');
      }
    }));
  }
  function texGarageSign() {
    if (TEX.garSign) return TEX.garSign;
    return (TEX.garSign = canvasTex(1536, 384, (c, w, h) => {
      c.fillStyle = '#1b55c4'; c.fillRect(0, 0, w, h);
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#fff'; c.lineWidth = 16; c.strokeRect(14, 14, w - 28, h - 28);
      c.strokeStyle = '#ffc20e'; c.lineWidth = 6; c.strokeRect(34, 34, w - 68, h - 68);
      icoWrench(c, 250, 190, 3.0, '#ffd21a');
      heb(c, 'מוסך', 900, 170, `900 210px ${FONT}`, '#ffffff');
      c.save(); c.font = `800 62px ${FONT}`; c.textAlign = 'center'; c.fillStyle = '#ffd21a'; c.fillText('APEX PIT CREW', 1210, 118); c.restore();
      heb(c, 'צמיגים • טורבו • בולמים • מגן', 1210, 262, `700 50px ${FONT}`, '#ffffff');
    }));
  }
  function texShop() {
    if (TEX.shop) return TEX.shop;
    return (TEX.shop = canvasTex(1024, 256, (c, w, h) => {
      c.fillStyle = '#2a2f38'; c.fillRect(0, 0, w, h);
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fff0c4'); g.addColorStop(1, '#ffd890'); c.fillStyle = g; c.fillRect(20, 62, w - 40, h - 74);
      const cols = ['#d2281f', '#ffc20e', '#1b8f4a', '#1b55c4', '#f4f4ee', '#ff7a14'];
      for (let r = 0; r < 3; r++) for (let i = 0; i < 18; i++) { c.fillStyle = cols[(i * 3 + r * 5) % cols.length]; c.fillRect(30 + i * 53, 84 + r * 48, 34, 34 - (i % 3) * 4); }
      c.fillStyle = 'rgba(40,46,56,0.95)'; c.fillRect(w / 2 - 64, 62, 128, h - 74);
      c.fillStyle = 'rgba(190,230,255,0.55)'; c.fillRect(w / 2 - 54, 70, 50, h - 90); c.fillRect(w / 2 + 4, 70, 50, h - 90);
      c.fillStyle = '#d2281f'; c.fillRect(0, 0, w, 54); c.fillStyle = '#ffc20e'; c.fillRect(0, 50, w, 6);
      heb(c, 'חנות נוחות • קפה • חטיפים', w / 2, 28, `800 38px ${FONT}`, '#ffffff');
      for (let i = 0; i <= 8; i++) { c.fillStyle = '#1a1d22'; c.fillRect(20 + i * ((w - 40) / 8) - 3, 62, 6, h - 74); }
    }));
  }
  function texRoadSign(kind, dist) {
    const key = 'rs' + kind + dist; if (TEX[key]) return TEX[key];
    return (TEX[key] = canvasTex(512, 256, (c, w, h) => {
      c.fillStyle = '#0d56a8'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 10; rrect(c, 8, 8, w - 16, h - 16, 18); c.stroke();
      if (kind === 'fuel') { icoPump(c, 96, 110, 1.35, '#ffffff'); heb(c, 'תחנת דלק', 330, 90, `900 76px ${FONT}`, '#ffffff'); }
      else { icoWrench(c, 96, 100, 1.9, '#ffffff'); heb(c, 'מוסך מרוצים', 330, 90, `900 70px ${FONT}`, '#ffffff'); }
      c.fillStyle = '#ffc20e'; c.fillRect(24, 168, w - 48, 6);
      c.save(); c.font = `900 70px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#ffd21a'; c.fillText(dist + ' m', w / 2, 212); c.restore();
    }));
  }
  function texBay(kind) {
    const key = 'bay' + kind; if (TEX[key]) return TEX[key];
    return (TEX[key] = canvasTex(512, 1024, (c, w, h) => {
      const S = w / 7, X = (xm) => (3.5 - xm) * S, Z = (zm) => (7 - zm) * S;
      c.clearRect(0, 0, w, h);
      if (kind === 'pit') {
        c.fillStyle = 'rgba(25,80,190,0.50)'; c.fillRect(X(2.9), Z(5.3), 5.8 * S, 10.6 * S);
        c.strokeStyle = '#f2f2ee'; c.lineWidth = 11; c.strokeRect(X(2.9), Z(5.3), 5.8 * S, 10.6 * S);
        c.strokeStyle = '#ffc20e'; c.lineWidth = 8; c.strokeRect(X(2.55), Z(4.95), 5.1 * S, 9.9 * S);
        c.fillStyle = '#ffc20e'; c.fillRect(X(2.55), Z(5.5) - 5, 5.1 * S, 18);
        c.save(); c.translate(X(0), Z(-4.1)); c.rotate(PI); c.font = `900 120px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillText('PIT', 0, 0); c.restore();
        c.save(); c.translate(X(0), Z(4.3)); c.rotate(PI); c.font = `800 52px ${FONT}`; c.direction = 'rtl'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillText('מוסך', 0, 0); c.restore();
      } else {
        c.strokeStyle = '#f2f2ee'; c.lineWidth = 11; c.strokeRect(X(2.5), Z(4.7), 5.0 * S, 9.4 * S);
        c.fillStyle = '#ffc20e'; c.fillRect(X(2.5), Z(5.0) - 6, 5.0 * S, 22);
        for (let i = 0; i < 9; i++) { c.fillStyle = i % 2 ? '#16181c' : '#ffc20e'; c.fillRect(X(2.5) + i * (5.0 * S / 9), Z(5.0) + 16, 5.0 * S / 9, 14); }
        c.save(); c.translate(X(0), Z(5.9)); c.rotate(PI); c.font = `800 62px ${FONT}`; c.direction = 'rtl'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = 'rgba(255,255,255,0.92)'; c.fillText('תדלוק', 0, 0); c.restore();
        c.save(); c.translate(X(0), Z(-5.9)); c.rotate(PI); c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.moveTo(0, 38); c.lineTo(46, -10); c.lineTo(18, -10); c.lineTo(18, -44); c.lineTo(-18, -44); c.lineTo(-18, -10); c.lineTo(-46, -10); c.closePath(); c.fill(); c.restore();
      }
    }));
  }
  function texDoor() {
    if (TEX.door) return TEX.door;
    return (TEX.door = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#d5d9de'; c.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) { c.fillStyle = 'rgba(0,0,0,0.20)'; c.fillRect(0, y, w, 3); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, y + 3, w, 2); }
      c.fillStyle = 'rgba(30,50,70,0.8)'; for (let i = 0; i < 4; i++) c.fillRect(24 + i * 58, 36, 48, 24);
      c.fillStyle = '#1b55c4'; c.fillRect(0, 0, 10, h); c.fillRect(w - 10, 0, 10, h);
    }));
  }
  function texFacade() {
    if (TEX.facade) return TEX.facade;
    return (TEX.facade = canvasTex(512, 256, (c, w, h) => {
      c.fillStyle = '#eef0f2'; c.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 64) { c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(x, 0, 3, h); }
      c.fillStyle = '#1b55c4'; c.fillRect(0, h * 0.78, w, h * 0.22); c.fillStyle = '#fff'; c.fillRect(0, h * 0.78 - 6, w, 6);
      c.fillStyle = '#ffc20e'; c.fillRect(0, 0, w, 14);
    }));
  }
  function texSlab() {
    if (TEX.slab) return TEX.slab;
    return (TEX.slab = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#80817c'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) { const g = 100 + Math.random() * 40; c.fillStyle = `rgba(${g},${g},${g - 4},0.35)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      c.fillStyle = 'rgba(40,40,40,0.55)'; c.fillRect(0, 0, w, 3); c.fillRect(0, 0, 3, h);
    }, { wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping }));
  }
  function texBubble(kind) {
    const key = 'bub' + kind; if (TEX[key]) return TEX[key];
    return (TEX[key] = canvasTex(128, 128, (c) => {
      c.fillStyle = 'rgba(255,255,255,0.96)'; c.beginPath(); c.arc(64, 60, 52, 0, TAU); c.fill(); c.beginPath(); c.moveTo(48, 104); c.lineTo(64, 122); c.lineTo(76, 100); c.fill();
      c.fillStyle = kind === 'ok' ? '#1fa653' : '#e23a2c'; c.beginPath(); c.arc(64, 60, 44, 0, TAU); c.fill();
      icoCheck(c, 64, 62, 1.15, '#fff');
    }));
  }
  function pumpDisplay(label) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
    const ctx = cv.getContext('2d');
    const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding;
    const o = { tex, ctx, lastTxt: '' };
    o.draw = (litres, price, full) => {
      const txt = litres.toFixed(2) + '|' + price.toFixed(2) + (full ? 'F' : '');
      if (txt === o.lastTxt) return; o.lastTxt = txt;
      ctx.fillStyle = '#04181a'; ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = '#0a2e30'; ctx.fillRect(6, 6, 244, 116);
      ctx.save(); ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.font = `700 22px ${FONT}`; ctx.fillStyle = '#7ad8c8'; ctx.fillText('ליטר', 244, 24); ctx.fillText('מחיר ₪', 244, 80); ctx.restore();
      ctx.font = 'bold 40px "Courier New",monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillStyle = full ? '#ffe45e' : '#6bff9a'; ctx.fillText(litres.toFixed(2).padStart(6, ' '), 14, 40);
      ctx.fillStyle = full ? '#ffe45e' : '#6bff9a'; ctx.fillText(price.toFixed(2).padStart(6, ' '), 14, 96);
      tex.needsUpdate = true;
    };
    o.draw(0, 0, false);
    return o;
  }

  // ================================================= static building helpers
  const BX = (gb, c, x, y0, z, w, h, d, ry) => gb.box(c, x, y0 + h / 2, z, w, h, d, 0, ry || 0, 0);
  const CY = (gb, c, x, y0, z, r, h) => gb.cyl(c, x, y0 + h / 2, z, r, h, r);
  const CYX = (gb, c, x, y, z, r, len) => gb.cyl(c, x, y, z, r, len, r, 0, 0, PI / 2);     // axis along X
  const CYZ = (gb, c, x, y, z, r, len) => gb.cyl(c, x, y, z, r, len, r, PI / 2, 0, 0);     // axis along Z
  function Batches() { return { solid: new GB(), metal: new GB(), paint: new GB(), emis: new GB(), glass: new GB() }; }
  function flush(S, parent, cast, recv) {
    const M = mats(), out = {};
    for (const k of Object.keys(S)) {
      if (!S[k].v) continue;
      const m = new T.Mesh(S[k].build(), M[k]);
      m.castShadow = !!cast && !isLow() && k !== 'emis' && k !== 'glass';
      m.receiveShadow = !!recv && !isLow() && k !== 'emis' && k !== 'glass';
      m.matrixAutoUpdate = false; m.updateMatrix();
      parent.add(m); out[k] = m;
    }
    return out;
  }
  function quad(parent, mat, w, h, x, y, z, ry, rx) {
    const m = new T.Mesh(geos().quad, mat);
    m.scale.set(w, h, 1); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0);
    parent.add(m); return m;
  }
  const basicTex = (tex, o) => new T.MeshBasicMaterial(Object.assign({ map: tex, toneMapped: true }, o || {}));
  function topPlane(parent, x0, x1, z0, z1, y) {
    const w = x1 - x0, d = z1 - z0;
    const g = new T.PlaneGeometry(w, d); g.rotateX(-PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 4, uv.getY(i) * d / 4);
    const low = isLow();
    const m = new T.Mesh(g, low ? new T.MeshLambertMaterial({ map: texSlab() }) : new T.MeshStandardMaterial({ map: texSlab(), roughness: 0.95, metalness: 0, envMapIntensity: 0.25 }));
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = !low; parent.add(m); return m;
  }
  function slab(S, parent, x0, x1, z0, z1) {
    BX(S.solid, 0x8d8e8a, (x0 + x1) / 2, -3, (z0 + z1) / 2, x1 - x0, 3.06, z1 - z0);
    topPlane(parent, x0, x1, z0, z1, 0.063);
  }
  function glowSprite(color, size, parent) {
    const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex(), color, blending: T.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    s.scale.set(size, size, 1); if (parent) parent.add(s); return s;
  }
  function orient(obj, zx, zy, zz, yx, yy, yz) {   // obj +Z -> z-vector, +Y as close as possible to y-hint
    _v1.set(zx, zy, zz).normalize();
    _v2.set(yx, yy, yz); _v2.addScaledVector(_v1, -_v2.dot(_v1));
    if (_v2.lengthSq() < 1e-6) _v2.set(0, 0, 1).addScaledVector(_v1, -_v1.z);
    _v2.normalize(); _v3.crossVectors(_v2, _v1);
    _m1.makeBasis(_v3, _v2, _v1); obj.quaternion.setFromRotationMatrix(_m1);
  }
  /** local offset of an object (parent = content frame) in content coordinates */
  function P2C(obj, lx, ly, lz, out) { obj.updateMatrix(); return out.set(lx, ly, lz).applyMatrix4(obj.matrix); }

  // ----------------------------------------------------------- pump model
  let PUMP_GEO = null, PUMP_DUMMY = null;
  function pumpGeometry() {
    if (PUMP_GEO) return PUMP_GEO;
    const b = new GB();
    BX(b, 0x34373c, 0, 0, 0, 0.76, 0.1, 1.1);
    BX(b, 0xf1f1ec, 0, 0.1, 0, 0.56, 1.45, 0.92);
    BX(b, 0xd2281f, 0, 0.1, 0, 0.6, 0.3, 0.96);
    BX(b, 0xffc20e, 0, 0.4, 0, 0.6, 0.06, 0.96);
    BX(b, 0xd2281f, 0, 1.55, 0, 0.64, 0.22, 1.0);
    BX(b, 0xe6e6e0, 0, 1.77, 0, 0.5, 0.07, 0.86);
    BX(b, 0x15191d, 0.283, 0.82, 0, 0.04, 0.5, 0.74);
    BX(b, 0x2a2d32, 0.31, 0.5, 0.3, 0.1, 0.26, 0.2);
    BX(b, 0xffc20e, 0.292, 0.7, -0.26, 0.02, 0.1, 0.22);
    BX(b, 0x2a2d32, 0.0, 0.1, 0.0, 0.52, 0.02, 0.88);
    return (PUMP_GEO = b.build());
  }
  function pumpDummyGeometry() {     // nozzle hanging in its holster + hose loop (idle pumps)
    if (PUMP_DUMMY) return PUMP_DUMMY;
    const b = new GB();
    BX(b, 0x15171a, 0.36, 0.52, 0.3, 0.06, 0.26, 0.07);
    b.cyl8(0x9aa0a8, 0.44, 0.66, 0.3, 0.014, 0.22, 0.014, 0, 0, 0.9);
    const pts = []; for (let i = 0; i <= 8; i++) { const u = i / 8; pts.push([0.33 + Math.sin(u * PI) * 0.22, 0.72 - Math.sin(u * PI * 0.9) * 0.42 - u * 0.1, 0.3 - u * 0.55]); }
    for (let i = 0; i < 8; i++) {
      const a = pts[i], c = pts[i + 1]; const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2, mz = (a[2] + c[2]) / 2;
      _v1.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]); const len = _v1.length(); _v1.normalize(); _q1.setFromUnitVectors(AY, _v1);
      _e1.setFromQuaternion(_q1, 'YXZ'); b.cyl8(0x1c1e22, mx, my, mz, 0.022, len * 1.1, 0.022, _e1.x, _e1.y, _e1.z);
    }
    return (PUMP_DUMMY = b.build());
  }

  // =========================================================== FUEL STATION
  function buildFuelStatic(C) {
    const S = Batches(), con = C.content, low = isLow();
    const white = 0xf2f2ee, red = 0xd2281f, yellow = 0xffc20e, grey = 0xb4b5b1;
    // forecourt slabs, curbs
    slab(S, con, -36, -11.3, -16, 13);
    slab(S, con, 11.3, 28, -16, 12);
    BX(S.solid, 0xc4c5c1, -11.15, 0, -1.5, 0.34, 0.14, 29.5);
    BX(S.solid, 0xc4c5c1, 11.15, 0, -2, 0.34, 0.14, 28);
    // canopy
    BX(S.paint, white, 0, 6.15, 0, 34, 0.7, 16);
    BX(S.solid, 0xcfd1d3, 0, 5.98, 0, 33.4, 0.17, 15.4);
    for (const sz of [-1, 1]) { BX(S.paint, red, 0, 6.05, sz * 8.1, 34.5, 0.92, 0.3); BX(S.paint, yellow, 0, 6.52, sz * 8.27, 34.6, 0.14, 0.06); }
    for (const sx of [-1, 1]) { BX(S.paint, red, sx * 17.1, 6.05, 0, 0.3, 0.92, 16.5); BX(S.paint, yellow, sx * 17.27, 6.52, 0, 0.06, 0.14, 16.6); }
    for (const px of [-14.4, 14.4]) for (const pz of [-5.5, 5.5]) {
      CY(S.paint, white, px, 0.0, pz, 0.42, 6.0); CY(S.paint, red, px, 0.0, pz, 0.46, 1.1); CY(S.paint, yellow, px, 1.1, pz, 0.46, 0.16);
      BX(S.solid, 0x6b6e72, px, 0.06, pz, 1.05, 0.12, 1.05);
    }
    // under-canopy light panels
    for (const lz of [-3.3, 3.3]) for (const lx of [-12.5, -7, -2.2, 2.2, 7, 12.5]) BX(S.emis, 0xcfc8b2, lx, 5.9, lz, 2.6, 0.06, 0.9);
    // pump islands + pumps
    C.pumps = [];
    const pumpDefs = [[-12.4, -1.6, 0.3], [-12.4, 4.2, 0.3], [12.4, -1.6, PI - 0.3], [12.4, 4.2, PI - 0.3]];
    pumpDefs.forEach((d, i) => {
      const [ix, iz, ry] = d, sgn = ix < 0 ? 1 : -1;
      BX(S.solid, grey, ix, 0.06, iz, 1.35, 0.18, 3.5);
      BX(S.solid, yellow, ix + sgn * 0.62, 0.24, iz, 0.1, 0.05, 3.5);
      BX(S.solid, 0x2a2d32, ix, 0.24, iz, 0.1, 0.01, 3.5);
      const pg = pumpGeometry();
      S.paint.add(pg, null, trs(ix, 0.24, iz, 1, 1, 1, 0, ry, 0));
      if (i !== 0) S.paint.add(pumpDummyGeometry(), null, trs(ix, 0.24, iz, 1, 1, 1, 0, ry, 0));
      // display (own texture)
      const disp = pumpDisplay();
      const dg = new T.Group(); dg.position.set(ix, 0.24, iz); dg.rotation.y = ry; con.add(dg);
      const dm = quad(dg, new T.MeshBasicMaterial({ map: disp.tex }), 0.7, 0.44, 0.306, 1.06, 0, PI / 2);
      if (i === 1) disp.draw(0, 0, false);
      const pm = new T.Matrix4().makeRotationY(ry);
      const port = new T.Vector3(0.28, 1.05, 0.0).applyMatrix4(pm).add(new T.Vector3(ix, 0.24, iz));
      const holster = new T.Vector3(0.36, 0.7, 0.3).applyMatrix4(pm).add(new T.Vector3(ix, 0.24, iz));
      C.pumps.push({ x: ix, z: iz, ry, disp, port, holster, group: dg, normal: new T.Vector3(Math.cos(ry), 0, -Math.sin(ry)), side: sgn });
    });
    // shop
    BX(S.paint, 0xeceae4, -27, 0, 1, 11, 4.3, 15);
    BX(S.paint, red, -27, 4.3, 1, 11.5, 0.55, 15.5); BX(S.paint, yellow, -21.15, 4.45, 1, 0.1, 0.14, 15.5);
    BX(S.paint, red, -20.2, 3.5, 1, 1.9, 0.16, 15);       // little awning
    BX(S.solid, 0x3a3d42, -27, 4.85, 1, 6, 0.8, 5);       // roof unit
    for (const az of [-5.8, 7.8]) BX(S.solid, 0x6b6e72, -20.3, 0, az, 0.18, 3.5, 0.18);
    const shopMesh = quad(con, new T.MeshBasicMaterial({ map: texShop() }), 14.2, 3.55, -21.57, 1.85, 1.0, PI / 2);
    // shop sign on awning front (small) - OCTANE
    // right side extras: bins, tyre stack, air post
    for (const bz of [-4.5, 6.0]) { CY(S.solid, 0x2d6a4f, -17.5, 0.06, bz, 0.34, 0.95); CY(S.solid, 0x1f4a37, -17.5, 1.01, bz, 0.37, 0.06); }
    // tyre stack (upright cylinders, axis Y)
    tyreStackUp(S.solid, -16.8, 0.06, -5.5, 4);
    tyreStackUp(S.solid, -16.0, 0.06, -9.2, 3);
    // air / water post
    BX(S.paint, 0x1b55c4, -15.5, 0.06, 7.8, 0.4, 1.3, 0.35); BX(S.emis, 0x9fe9ff, -15.29, 1.0, 7.8, 0.02, 0.2, 0.22);
    // left side: tyre stack, bins, flags
    tyreStackUp(S.solid, 17.5, 0.06, 6.0, 4);
    CY(S.solid, 0xd2281f, 14.8, 0.06, 7.6, 0.34, 0.95);
    // fire extinguisher stand + bucket station near pump 2 (right)
    BX(S.paint, red, -12.3, 0.06, 7.6, 0.3, 0.8, 0.3);
    // pylon (price sign) - pole + box
    CY(S.metal, 0x9aa0a8, 15.8, 0, -11.5, 0.24, 8.2); CY(S.metal, 0x9aa0a8, 15.8, 0, -11.5, 0.5, 0.5);
    BX(S.paint, white, 15.8, 2.7, -11.5, 3.5, 6.1, 0.36);
    BX(S.paint, red, 15.8, 8.8, -11.5, 3.7, 0.22, 0.46);
    BX(S.solid, 0x6b6e72, 15.8, 0.0, -11.5, 1.4, 0.3, 1.4);
    // flag poles
    C.flags = [];
    [[-4, 0xd2281f], [-1.6, 0xffc20e], [0.8, 0xf4f4ee]].forEach(([fz, fc], i) => {
      const px = 19.5, pz = fz - 8;
      CY(S.metal, 0xcfd3d8, px, 0, pz, 0.07, 8.0);
      const fg = new T.Mesh(geos().quad, new T.MeshBasicMaterial({ color: fc, side: T.DoubleSide }));
      fg.scale.set(1.8, 1.05, 1); fg.position.set(px, 7.3, pz + 0.95); fg.rotation.y = PI / 2; con.add(fg); C.flags.push({ m: fg, ph: i * 1.7, z: pz + 0.9 });
    });
    // cones along the lane edge
    flush(S, con, true, true);
    // painted bay on the road (parking lane x=-7)
    const bay = new T.Mesh(geos().quad, new T.MeshBasicMaterial({ map: texBay('fuel'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    bay.geometry = bay.geometry.clone(); bay.geometry.rotateX(-PI / 2); bay.geometry.rotateY(PI);
    bay.scale.set(7, 1, 14); bay.position.set(C.parkLaneX, 0.035, 0); bay.renderOrder = 1; con.add(bay);
    C.bay = bay;
    // pool lights spots
    C.lightSpots = [new T.Vector3(-7, 5.2, 0), new T.Vector3(7, 5.2, 0)];
  }

  // ============================================================ PIT GARAGE
  function tyreStackUp(gb, x, y0, z, n, r) { for (let i = 0; i < n; i++) { CY(gb, 0x17181b, x, y0 + i * 0.27, z, r || 0.38, 0.26); CY(gb, 0x6e7378, x, y0 + 0.01 + i * 0.27, z, 0.2, 0.27); } }
  function buildGarageStatic(C) {
    const S = Batches(), con = C.content;
    const white = 0xf2f2ee, blue = 0x1b55c4, navy = 0x10244d, yellow = 0xffc20e, red = 0xd2281f;
    slab(S, con, 11.3, 38, -18, 18);
    BX(S.solid, 0xc4c5c1, 11.15, 0, 0, 0.34, 0.14, 36);
    // building shell
    BX(S.paint, 0xe9ebed, 27.5, 0, 1.5, 17, 6.4, 22);                    // x 19..36 z -9.5..12.5
    BX(S.paint, blue, 27.5, 6.4, 1.5, 17.5, 0.55, 22.5);
    BX(S.paint, yellow, 18.7, 6.58, 1.5, 0.12, 0.14, 22.5);
    BX(S.solid, 0x3a3d42, 27, 6.95, 4, 6, 1.0, 5);
    // awning (cantilever roof over the forecourt)
    BX(S.paint, white, 15.7, 4.35, 1.5, 6.6, 0.3, 22);
    BX(S.paint, blue, 12.45, 4.35, 1.5, 0.22, 0.46, 22);
    for (const bz of [-8, -2, 5, 11]) b45(S.metal, 0x8c929a, 16.5, 3.62, bz);
    for (const lz of [-7.2, -4.4, -1.6, 1.2, 4.0, 6.8, 9.6]) for (const lx of [13.9, 16.9]) BX(S.emis, 0xd6e0e6, lx, 4.27, lz, 0.14, 0.06, 2.2);
    // door frames + wall lamps
    for (const dz of [-6, 1.5, 9]) { BX(S.paint, blue, 18.93, 0.06, dz - 2.7, 0.14, 4.3, 0.34); BX(S.paint, blue, 18.93, 0.06, dz + 2.7, 0.14, 4.3, 0.34); BX(S.paint, blue, 18.93, 4.1, dz, 0.14, 0.34, 5.8); BX(S.emis, 0xfff2d0, 18.8, 4.5, dz, 0.16, 0.12, 0.5); }
    // pit wall with painted stripes + tyres on top
    for (const [z0, z1] of [[-12.2, -3.4], [3.4, 12.2]]) {
      const n = Math.round((z1 - z0) / 1.1), seg = (z1 - z0) / n;
      for (let i = 0; i < n; i++) BX(S.paint, i % 2 ? white : blue, 11.95, 0.06, z0 + seg * (i + 0.5), 0.5, 1.0, seg);
      BX(S.solid, 0x2a2d32, 11.95, 1.06, (z0 + z1) / 2, 0.58, 0.07, z1 - z0);
    }
    for (const z of (isLow() ? [-11.5, 11.5] : [-11.5, -10.4, 11.5, 10.4])) tyreStackUp(S.solid, 11.95, 1.13, z, 3, 0.4);
    // tyre rack wall (blue/white) under the awning: upright tyres facing the road
    const rz0 = -9.0, rz1 = -3.6;
    for (const rz of [rz0, rz1]) { BX(S.paint, blue, 14.2, 0.06, rz, 0.16, 2.7, 0.16); BX(S.paint, blue, 14.9, 0.06, rz, 0.16, 2.7, 0.16); }
    for (let tier = 0; tier < (isLow() ? 2 : 3); tier++) {
      BX(S.paint, white, 14.55, 0.06 + 0.12 + tier * 0.86, (rz0 + rz1) / 2, 1.0, 0.08, rz1 - rz0 + 0.3);
      for (let k = 0; k < 6; k++) { const tz = rz0 + 0.45 + k * ((rz1 - rz0 - 0.9) / 5); CYX(S.solid, 0x17181b, 14.55, 0.06 + 0.2 + tier * 0.86 + 0.37, tz, 0.37, 0.7); CYX(S.metal, 0xcfd3d8, 14.19, 0.06 + 0.2 + tier * 0.86 + 0.37, tz, 0.22, 0.04); }
    }
    BX(S.paint, blue, 14.55, 2.78, (rz0 + rz1) / 2, 1.1, 0.16, rz1 - rz0 + 0.5);
    // tool carts, drums, compressor, extinguisher
    for (const [cx, cz, cc] of [[14.0, 5.6, red], [14.0, -1.9, blue]]) { BX(S.paint, cc, cx, 0.2, cz, 0.6, 0.85, 1.1); BX(S.metal, 0xb8bec6, cx, 1.05, cz, 0.66, 0.05, 1.16); for (let k = 0; k < 4; k++) BX(S.metal, 0x2a2d32, cx - 0.31, 0.32 + k * 0.2, cz, 0.02, 0.1, 0.9); for (const wx of [-0.22, 0.22]) for (const wz of [-0.4, 0.4]) CYZ(S.solid, 0x15171a, cx + wx, 0.12, cz + wz, 0.08, 0.06); }
    for (const [dx, dz, dc] of [[18.0, -9.8, 0x1b55c4], [18.0, -8.9, 0xd2281f], [18.0, 12.6, 0x1b55c4]]) { CY(S.paint, dc, dx, 0.06, dz, 0.32, 0.9); CY(S.metal, 0x8c929a, dx, 0.96, dz, 0.33, 0.04); }
    CYZ(S.paint, red, 15.4, 0.6, 11.4, 0.34, 1.3); BX(S.metal, 0x8c929a, 15.4, 0.06, 10.9, 0.5, 0.3, 0.1); BX(S.metal, 0x8c929a, 15.4, 0.06, 11.9, 0.5, 0.3, 0.1);
    CY(S.paint, red, 18.5, 0.06, 4.9, 0.1, 0.6); BX(S.solid, 0x2a2d32, 18.8, 0.0, 4.9, 0.04, 0.8, 0.2);
    // jack stands + traffic cones along the lane boundary
    { const lowQ = isLow(), nC = lowQ ? 5 : 9, st = lowQ ? 4.5 : 2.5; for (let i = 0; i < nC; i++) { const cz = -9 + i * st; cone(S, 3.95, cz); } }
    for (const [cx, cz] of [[12.7, -13], [12.7, 13], [9.5, -13.5], [9.5, 13.5]]) cone(S, cx, cz);
    // traffic light mast (static parts)
    CY(S.metal, 0x5b6068, 11.45, 0, 5.4, 0.08, 4.4);
    BX(S.solid, 0x202226, 11.45, 3.55, 5.4, 0.46, 1.25, 0.46);
    BX(S.solid, 0x202226, 11.45, 3.55, 5.4, 0.2, 0.2, 0.2);
    // pylon
    CY(S.metal, 0x9aa0a8, 15.8, 0, -13.5, 0.24, 8.2); BX(S.paint, white, 15.8, 2.7, -13.5, 3.5, 6.1, 0.36); BX(S.paint, blue, 15.8, 8.8, -13.5, 3.7, 0.22, 0.46); BX(S.solid, 0x6b6e72, 15.8, 0.0, -13.5, 1.4, 0.3, 1.4);
    flush(S, con, true, true);
    // textured planes: doors, interior, facade, signs
    const doorMat = new T.MeshStandardMaterial({ map: texDoor(), roughness: 0.6, metalness: 0.4 });
    const doorMatL = isLow() ? new T.MeshLambertMaterial({ map: texDoor() }) : doorMat;
    quad(con, new T.MeshStandardMaterial({ map: texFacade(), roughness: 0.8 }), 22.4, 6.2, 18.96, 3.16, 1.5, -PI / 2).material = isLow() ? new T.MeshLambertMaterial({ map: texFacade() }) : new T.MeshStandardMaterial({ map: texFacade(), roughness: 0.8 });
    quad(con, doorMatL, 5.0, 4.0, 18.9, 2.06, -6, -PI / 2);
    quad(con, doorMatL, 5.0, 4.0, 18.9, 2.06, 9, -PI / 2);
    const door2 = quad(con, doorMatL, 5.0, 0.9, 18.9, 3.6, 1.5, -PI / 2);
    quad(con, new T.MeshBasicMaterial({ map: texInterior() }), 5.0, 3.2, 18.92, 1.66, 1.5, -PI / 2);
    quad(con, new T.MeshBasicMaterial({ map: texGarageSign() }), 9.4, 2.35, 18.86, 5.3, 1.5, -PI / 2);
    const roofSign = new T.Group(); roofSign.position.set(21.5, 8.3, -3.5); roofSign.rotation.y = -2.45; con.add(roofSign);
    quad(roofSign, new T.MeshBasicMaterial({ map: texGarageSign(), side: T.DoubleSide }), 11.0, 2.75, 0, 0, 0, 0);
    { const sb = new GB(); BX(sb, 0x2a2d32, 0, -1.7, -0.06, 11.4, 0.2, 0.12); BX(sb, 0x2a2d32, -4.5, -1.7, -0.06, 0.2, 1.6, 0.12); BX(sb, 0x2a2d32, 4.5, -1.7, -0.06, 0.2, 1.6, 0.12); const m = new T.Mesh(sb.build(), mats().solid); roofSign.add(m); }
    // pylon sign faces
    const py = texPylon('parts');
    quad(con, new T.MeshBasicMaterial({ map: py }), 3.3, 5.8, 15.8, 5.75, -13.5 - 0.19, PI);
    quad(con, new T.MeshBasicMaterial({ map: py }), 3.3, 5.8, 15.8, 5.75, -13.5 + 0.19, 0);
    // painted pit bay
    const bay = new T.Mesh(geos().quad.clone(), new T.MeshBasicMaterial({ map: texBay('pit'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    bay.geometry.rotateX(-PI / 2); bay.geometry.rotateY(PI);
    bay.scale.set(7, 1, 14); bay.position.set(C.parkLaneX, 0.035, 0); bay.renderOrder = 1; con.add(bay);
    C.bay = bay;
    C.lightSpots = [new T.Vector3(16, 3.9, -3), new T.Vector3(16, 3.9, 6)];
  }
  function b45(gb, c, x, y, z) { gb.box(c, x, y, z, 5.15, 0.1, 0.1, 0, 0, -0.245); }
  // helper cone
  function cone(S, x, z) { S.paint.cone(0xff6a10, x, 0.38, z, 0.17, 0.62, 0.17); BX(S.solid, 0x2a2d32, x, 0.0, z, 0.42, 0.05, 0.42); S.paint.cone(0xffffff, x, 0.42, z, 0.115, 0.14, 0.115); }
  function texInterior() {
    if (TEX.interior) return TEX.interior;
    return (TEX.interior = canvasTex(512, 410, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fff3d6'); g.addColorStop(1, '#c9b995'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = '#2a2d32'; c.fillRect(0, 0, w, 24);
      for (let i = 0; i < 5; i++) { c.fillStyle = '#ffffff'; c.fillRect(30 + i * 100, 8, 60, 8); }
      for (let r = 0; r < 3; r++) { c.fillStyle = '#6b7078'; c.fillRect(24, 120 + r * 80, w - 48, 6); for (let i = 0; i < 9; i++) { c.fillStyle = ['#1b55c4', '#d2281f', '#ffc20e', '#ececec'][(i + r) % 4]; c.fillRect(34 + i * 52, 84 + r * 80, 38, 34); } }
      c.fillStyle = '#16181c'; c.beginPath(); c.arc(w - 90, h - 70, 46, 0, TAU); c.fill(); c.fillStyle = '#8a9099'; c.beginPath(); c.arc(w - 90, h - 70, 22, 0, TAU); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.30)'; c.fillRect(0, h - 28, w, 28);
    }));
  }

  // ==================================================== dynamic props / tools
  class Hose {
    constructor(parent, radius, segs) {
      this.segs = segs || 22; this.rad = 6; this.r = radius || 0.028;
      const nR = this.rad + 1, nV = (this.segs + 1) * nR;
      const g = new T.BufferGeometry();
      this.pos = new Float32Array(nV * 3); this.nor = new Float32Array(nV * 3); const uv = new Float32Array(nV * 2), idx = [];
      for (let i = 0; i <= this.segs; i++) for (let j = 0; j < nR; j++) { uv[(i * nR + j) * 2] = j / this.rad; uv[(i * nR + j) * 2 + 1] = i / this.segs; }
      for (let i = 0; i < this.segs; i++) for (let j = 0; j < this.rad; j++) { const a = i * nR + j, b = a + nR; idx.push(a, b, a + 1, b, b + 1, a + 1); }
      g.setAttribute('position', new T.BufferAttribute(this.pos, 3)); g.setAttribute('normal', new T.BufferAttribute(this.nor, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2)); g.setIndex(idx);
      this.geo = g;
      this.mesh = new T.Mesh(g, mats().hose); this.mesh.frustumCulled = false; this.mesh.castShadow = false;
      this.flowMat = new T.MeshBasicMaterial({ map: dashTex(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, color: 0xffffff });
      this.flowMat.map = dashTex().clone(); this.flowMat.map.needsUpdate = true; this.flowMat.map.repeat.set(1, 7); this.flowMat.color.setHex(0xc86a10);
      this.flow = new T.Mesh(g, this.flowMat); this.flow.frustumCulled = false; this.flow.visible = false; this.flow.renderOrder = 3;
      parent.add(this.mesh); parent.add(this.flow);
      this.pts = []; for (let i = 0; i <= this.segs; i++) this.pts.push(new T.Vector3());
      this.c = new T.Vector3();
    }
    /** quadratic bezier a->b with sag; clamped to the floor */
    set(a, b, sag, bendX, bendZ) {
      const P = this.pts, n = this.segs, c = this.c;
      c.set((a.x + b.x) / 2 + (bendX || 0), (a.y + b.y) / 2 - 2 * sag, (a.z + b.z) / 2 + (bendZ || 0));
      for (let i = 0; i <= n; i++) {
        const u = i / n, k = 1 - u;
        P[i].set(k * k * a.x + 2 * k * u * c.x + u * u * b.x, k * k * a.y + 2 * k * u * c.y + u * u * b.y, k * k * a.z + 2 * k * u * c.z + u * u * b.z);
        if (P[i].y < 0.08 + this.r) P[i].y = 0.08 + this.r;
      }
      this._build();
    }
    _build() {
      const P = this.pts, n = this.segs, nR = this.rad + 1, pos = this.pos, nor = this.nor, r = this.r;
      for (let i = 0; i <= n; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n, i + 1)];
        _v1.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
        _v2.set(0, 1, 0); if (Math.abs(_v1.y) > 0.92) _v2.set(1, 0, 0);
        _v3.crossVectors(_v2, _v1).normalize(); _v4.crossVectors(_v1, _v3);
        for (let j = 0; j < nR; j++) {
          const an = (j / this.rad) * TAU, cs = Math.cos(an), sn = Math.sin(an);
          const nx = _v3.x * cs + _v4.x * sn, ny = _v3.y * cs + _v4.y * sn, nz = _v3.z * cs + _v4.z * sn;
          const o = (i * nR + j) * 3;
          pos[o] = P[i].x + nx * r; pos[o + 1] = P[i].y + ny * r; pos[o + 2] = P[i].z + nz * r;
          nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        }
      }
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
    }
  }

  let PROP_GEO = null;
  function propGeos() {
    if (PROP_GEO) return PROP_GEO;
    const o = {};
    let b = new GB();                                   // nozzle: +Z = spout
    b.box(0x16181b, 0, 0.0, -0.01, 0.05, 0.1, 0.2).box(0x16181b, 0, -0.095, -0.07, 0.035, 0.12, 0.045).box(0x16181b, 0, -0.045, -0.04, 0.035, 0.025, 0.1);
    b.box(0xd2281f, 0, 0.055, 0.0, 0.052, 0.02, 0.16).cyl8(0xaab2bb, 0, -0.0, 0.17, 0.014, 0.25, 0.014, PI / 2, 0, 0).cyl8(0x2a2d32, 0, 0.0, -0.12, 0.022, 0.06, 0.022, PI / 2, 0, 0);
    o.nozzle = b.build();
    b = new GB();                                       // wheel gun: +Z = socket
    b.cyl8(0xffc20e, 0, 0.0, -0.03, 0.05, 0.22, 0.05, PI / 2, 0, 0).cyl8(0x2a2d32, 0, 0.0, -0.17, 0.056, 0.05, 0.056, PI / 2, 0, 0).cyl8(0xaab2bb, 0, 0.0, 0.105, 0.034, 0.06, 0.034, PI / 2, 0, 0);
    b.box(0x2a2d32, 0, -0.1, -0.06, 0.04, 0.13, 0.055).box(0xd2281f, 0, 0.0, 0.03, 0.056, 0.058, 0.07).cyl8(0x1c1e22, 0, -0.04, -0.23, 0.014, 0.12, 0.014, PI / 2, 0, 0);
    o.gun = b.build();
    b = new GB();                                       // floor jack (long axis X, handle toward +X, ram at x=0)
    BX(b, 0xd2281f, 0.3, 0.07, 0, 0.95, 0.1, 0.5).box(0x2a2d32, 0.0, 0.2, 0, 0.2, 0.26, 0.24).box(0x2a2d32, 0.6, 0.21, 0, 0.16, 0.2, 0.2);
    for (const wx of [-0.1, 0.72]) for (const wz of [-0.2, 0.2]) b.cyl8(0x15171a, wx, 0.055, wz, 0.055, 0.06, 0.055, PI / 2, 0, 0);
    o.jack = b.build();
    b = new GB();
    b.cyl8(0x9aa0a8, 0.5, 0, 0, 0.022, 1.0, 0.022, 0, 0, PI / 2).cyl8(0x15171a, 0.92, 0.0, 0, 0.032, 0.24, 0.032, 0, 0, PI / 2);
    o.jackHandle = b.build();
    b = new GB();                                       // creeper (long axis X)
    BX(b, 0x1b55c4, 0, 0.05, 0, 1.05, 0.05, 0.5).box(0x2a2d32, 0.42, 0.115, 0, 0.18, 0.12, 0.3);
    for (const wx of [-0.4, 0.4]) for (const wz of [-0.2, 0.2]) b.cyl8(0x15171a, wx, 0.04, wz, 0.04, 0.05, 0.04, PI / 2, 0, 0);
    o.creeper = b.build();
    b = new GB();                                       // tyre cart
    BX(b, 0x1b55c4, 0, 0.14, 0, 0.9, 0.07, 0.9);
    for (const wx of [-0.38, 0.38]) for (const wz of [-0.38, 0.38]) b.cyl8(0x15171a, wx, 0.07, wz, 0.07, 0.06, 0.07, PI / 2, 0, 0);
    BX(b, 0x8c929a, 0.44, 0.17, -0.38, 0.05, 0.85, 0.05); BX(b, 0x8c929a, 0.44, 0.17, 0.38, 0.05, 0.85, 0.05); BX(b, 0x8c929a, 0.44, 0.97, 0, 0.05, 0.05, 0.8);
    o.cart = b.build();
    b = new GB();                                       // squeegee (blade at y -0.18, face +Z)
    b.cyl8(0x9aa0a8, 0, -0.07, 0, 0.012, 0.3, 0.012).box(0xd2281f, 0, -0.2, 0, 0.3, 0.025, 0.035).box(0x15171a, 0, -0.223, 0, 0.3, 0.012, 0.012);
    o.squeegee = b.build();
    b = new GB();                                       // tablet
    b.box(0x16181b, 0, 0, 0, 0.27, 0.19, 0.022).box(0x38d8ff, 0, 0.0, 0.013, 0.24, 0.16, 0.004);
    o.tablet = b.build();
    b = new GB();                                       // clipboard
    b.box(0x7a5a3a, 0, 0, 0, 0.24, 0.32, 0.02).box(0xffffff, 0, 0, 0.012, 0.2, 0.28, 0.004).box(0x2a2d32, 0, 0.15, 0.016, 0.08, 0.03, 0.02);
    o.clip = b.build();
    b = new GB();                                       // torch
    b.cyl8(0xd2281f, 0, 0, -0.07, 0.03, 0.22, 0.03, PI / 2, 0, 0).cyl8(0xaab2bb, 0, 0, 0.1, 0.012, 0.16, 0.012, PI / 2, 0, 0).box(0x2a2d32, 0, -0.09, -0.07, 0.03, 0.12, 0.04);
    o.torch = b.build();
    b = new GB();                                       // turbo unit (Y up)
    b.cyl8(0x3a4048, 0, 0, 0, 0.17, 0.32, 0.17, PI / 2, 0, 0).add(geos().torus, 0x6b7480, trs(0, 0, 0, 0.21, 0.21, 0.21, 0, PI / 2, 0));
    b.cyl8(0x9aa0a8, 0.2, 0.0, 0.0, 0.09, 0.22, 0.09, 0, 0, PI / 2).cyl8(0xc9ced4, 0.0, 0.0, 0.0, 0.06, 0.5, 0.06, 0, 0, PI / 2);
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; b.box(0x2d333a, 0.0, Math.sin(a) * 0.19, Math.cos(a) * 0.19, 0.34, 0.03, 0.05, a, 0, 0); }
    o.turbo = b.build();
    b = new GB();                                       // crane (boom toward +X, mast at x=0)
    BX(b, 0xd2281f, 0.45, 0.1, -0.55, 1.5, 0.12, 0.12); BX(b, 0xd2281f, 0.45, 0.1, 0.55, 1.5, 0.12, 0.12); BX(b, 0xd2281f, -0.25, 0.1, 0, 0.12, 0.12, 1.2);
    BX(b, 0xd2281f, -0.15, 0.1, 0, 0.16, 2.1, 0.16);
    b.box(0xd2281f, 0.7, 2.14, 0, 1.75, 0.12, 0.14).box(0x2a2d32, 0.2, 1.75, 0, 1.15, 0.07, 0.07, 0, 0, 0.7);
    for (const wx of [-0.2, 1.1]) for (const wz of [-0.55, 0.55]) b.cyl8(0x15171a, wx, 0.07, wz, 0.07, 0.07, 0.07, PI / 2, 0, 0);
    o.crane = b.build();
    return (PROP_GEO = o);
  }
  function propMesh(geo, mat, parent) { const m = new T.Mesh(geo, mat); m.castShadow = !isLow(); if (parent) parent.add(m); return m; }
  const NUT_GEO = {}, RING_GEO = {};
  let RING_MAT = null, FLAP_DARK = null;
  function nutRing(width, r, sign) {
    const g = new T.Group();
    const M = mats(), gg = geos();
    const m1 = new T.Mesh(gg.cyl8, M.steel); m1.scale.set(r * 0.22, 0.03, r * 0.22); m1.rotation.z = PI / 2; m1.position.x = sign * (width / 2 + 0.018); g.add(m1);
    const key = r.toFixed(2);
    if (!NUT_GEO[key]) { const b = new GB(); for (let i = 0; i < 5; i++) { const a = i * TAU / 5; b.cyl8(0x6f7780, 0, Math.sin(a) * r * 0.36, Math.cos(a) * r * 0.36, r * 0.07, 0.05, r * 0.07, 0, 0, PI / 2); } NUT_GEO[key] = b.build(); }
    const m2 = new T.Mesh(NUT_GEO[key], M.metal); m2.position.x = sign * (width / 2 + 0.012); g.add(m2);
    return g;
  }
  function newTyreFx(width, r, sign) {                 // sticker ring + glow shell for the "new" wheel
    const g = new T.Group();
    const key = r.toFixed(2);
    if (!RING_GEO[key]) RING_GEO[key] = new T.RingGeometry(r * 0.8, r * 0.88, 28);
    if (!RING_MAT) RING_MAT = new T.MeshBasicMaterial({ color: 0xffe14a, side: T.DoubleSide });
    const ring = new T.Mesh(RING_GEO[key], RING_MAT);
    ring.rotation.y = PI / 2; ring.position.x = sign * (width / 2 + 0.012); g.add(ring);
    const shell = new T.Mesh(geos().cyl, new T.MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.0, blending: T.AdditiveBlending, depthWrite: false }));
    shell.scale.set(r * 1.08, width * 1.1, r * 1.08); shell.rotation.z = PI / 2; g.add(shell);
    g.userData.ring = ring; g.userData.shell = shell;
    return g;
  }

  // ================================================================ shared lights
  const LPOOL = { lights: null, owner: null, fade: 0 };
  function ensureLights() {
    if (LPOOL.lights || isLow()) return LPOOL.lights;
    LPOOL.lights = [0, 1].map(() => { const l = new T.PointLight(0xfff0d0, 0, 26, 2); l.castShadow = false; return l; });
    return LPOOL.lights;
  }
  function inScene(o) { while (o) { if (o.isScene) return true; o = o.parent; } return false; }

  // ====================================================== car measurement
  const RC = new T.Raycaster();
  function probe(K, ox, oy, oz, dx, dy, dz) {
    const bg = K.veh.bodyGroup;
    _v1.set(ox, oy, oz).applyMatrix4(bg.matrixWorld);
    _v2.set(dx, dy, dz).transformDirection(bg.matrixWorld);
    RC.set(_v1, _v2); RC.near = 0; RC.far = 40;
    const hits = RC.intersectObjects(K.meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    _m1.copy(bg.matrixWorld).invert();
    const p = h.point.clone().applyMatrix4(_m1);
    const n = new T.Vector3(0, 1, 0);
    if (h.face) n.copy(h.face.normal).transformDirection(h.object.matrixWorld).transformDirection(_m1);
    return { p, n, obj: h.object };
  }
  function paintOf(obj) {
    const m = obj && obj.material; const mm = Array.isArray(m) ? m[0] : m;
    return mm && mm.color && !mm.transparent ? mm.color.clone() : new T.Color(0xd8dce2);
  }
  function measureCar(C, veh) {
    const K = { veh, wheels: [], meshes: [], bike: false, lift: 0, x: C.parkLaneX, z: 0, yaw: 0, cos: 1, sin: 0 };
    const bg = veh.bodyGroup;
    veh.root.updateWorldMatrix(true, true);
    C.content.updateWorldMatrix(true, false);
    const inv = new T.Matrix4().copy(C.content.matrixWorld).invert();
    const rp = veh.root.getWorldPosition(new T.Vector3()).applyMatrix4(inv);
    const fw = new T.Vector3(0, 0, 1).transformDirection(veh.root.matrixWorld).transformDirection(inv);
    if (Math.abs(rp.x - C.parkLaneX) < 3 && Math.abs(rp.z) < 6) { K.x = rp.x; K.z = rp.z; K.yaw = Math.atan2(fw.x, fw.z); }
    K.cos = Math.cos(K.yaw); K.sin = Math.sin(K.yaw);
    const wset = new Set();
    veh.wheels.forEach((w) => {
      wset.add(w);
      const ud = w.userData || {};
      const par = w.parent;
      let home;
      if (ud.home && ud.home.isVector3) home = ud.home.clone();
      else if (par === bg) home = w.position.clone();
      else home = bg.worldToLocal(w.getWorldPosition(new T.Vector3()));
      let r = ud.radius, wd = ud.width;
      if (!r || !wd) { const b = new T.Box3().setFromObject(w); const sz = b.getSize(new T.Vector3()); r = r || sz.y / 2; wd = wd || Math.max(0.18, sz.x * 0.98); }
      const side = ud.side !== undefined ? ud.side : (Math.abs(home.x) < 0.08 ? 0 : Math.sign(home.x));
      K.wheels.push({ w, home, parent0: par, pos0: w.position.clone(), r: clamp(r, 0.25, 1.0), width: clamp(wd, 0.15, 0.8), side, isFront: ud.isFront !== undefined ? !!ud.isFront : home.z > 0 });
    });
    K.bike = K.wheels.length < 4 || K.wheels.every((w) => w.side === 0);
    const skip = new Set(veh.flameMeshes || []); if (veh.shieldMesh) skip.add(veh.shieldMesh);
    bg.traverse((o) => {
      if (!o.isMesh || !o.visible || skip.has(o)) return;
      let p = o.parent; while (p && p !== bg) { if (wset.has(p)) return; p = p.parent; }
      if (veh.wingsGroup && (o.parent === veh.wingsGroup)) return;
      const mt = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mt && mt.blending === T.AdditiveBlending) return;
      K.meshes.push(o);
    });
    let zf = -9, zr = 9, hx = 0.9;
    K.wheels.forEach((w) => { zf = Math.max(zf, w.home.z); zr = Math.min(zr, w.home.z); hx = Math.max(hx, Math.abs(w.home.x) + w.width / 2); });
    K.frontZ = zf; K.rearZ = zr; K.track = K.wheels.length ? Math.max(...K.wheels.map((w) => Math.abs(w.home.x))) : 1.3;
    K.wheelR = K.wheels.length ? K.wheels[0].r : 0.58;
    const pn = probe(K, 0, 0.6, 7, 0, 0, -1); K.noseZ = pn ? pn.p.z : zf + 0.95;
    const pt = probe(K, 0, 0.6, -7, 0, 0, 1); K.tailZ = pt ? pt.p.z : zr - 0.95;
    const pr = probe(K, 0, 7, 0, 0, -1, 0); K.topY = pr ? pr.p.y : 1.5;
    const pc = probe(K, 0, 0.02, 0.1, 0, 1, 0); K.clear = pc ? clamp(pc.p.y, 0.14, 0.9) : K.wheelR * 0.55;
    // body half width near the middle
    const ps = probe(K, -4, K.bike ? 0.9 : 0.8, 0, 1, 0, 0), ps2 = probe(K, 4, K.bike ? 0.9 : 0.8, 0, -1, 0, 0);
    K.halfW = Math.max(ps ? Math.abs(ps.p.x) : 0, ps2 ? Math.abs(ps2.p.x) : 0) || (K.bike ? 0.4 : hx - 0.2);
    K.paint = paintOf(ps && ps.obj);
    // fuel port: on the side facing the pump (-X), rear fender (cars) / tank side (bikes)
    const side = C.type === 'fuel' ? -1 : 1;
    const pz = K.bike ? 0.15 : zr * 0.68, py = K.bike ? 1.0 : Math.min(K.topY * 0.62, K.wheelR * 1.7);
    let pp = probe(K, side * 5, py, pz, -side, 0, 0);
    if (!pp) pp = { p: new T.Vector3(side * (K.halfW - 0.02), py, pz), n: new T.Vector3(side, 0, 0) };
    if (Math.abs(pp.n.x) < 0.3) pp.n.set(side * 0.95, 0.1, 0).normalize();
    K.port = pp; K.paint = paintOf(pp.obj || (ps && ps.obj));
    // windscreen (front-high ray)
    let ws = probe(K, 0, 3.2, K.noseZ + 3.0, 0, -0.55, -1);
    if (!ws) ws = { p: new T.Vector3(0, K.topY * 0.75, K.noseZ - 1.6), n: new T.Vector3(0, 0.6, 0.8).normalize() };
    K.ws = ws;
    // rear deck (turbo hatch): from above, or bike side
    if (K.bike) { const dz = zf - 0.45; let dk = probe(K, 0, 6, dz, 0, -1, 0); if (!dk) dk = { p: new T.Vector3(0, 1.15, dz), n: new T.Vector3(0, 1, 0) }; K.deck = dk; }
    else { const dz = K.noseZ - 0.95, dx = 0.34; let dk = probe(K, dx, 6, dz, 0, -1, 0); if (!dk) dk = { p: new T.Vector3(dx, K.topY * 0.7, dz), n: new T.Vector3(0, 1, 0) }; K.deck = dk; }
    K.deck.paint = paintOf(K.deck.obj);
    return K;
  }
  // car-local (bodyGroup) point -> content frame (includes the body lift)
  function toC(K, lx, ly, lz, out) { out.x = K.x + lx * K.cos + lz * K.sin; out.z = K.z - lx * K.sin + lz * K.cos; out.y = ly + K.lift; return out; }
  function dirC(K, lx, ly, lz, out) { out.x = lx * K.cos + lz * K.sin; out.z = -lx * K.sin + lz * K.cos; out.y = ly; return out; }
  function setWheel(w, x, y, z, ax, ay, az, spin) {
    w.position.set(x, y, z);
    _v1.set(ax, ay, az); _q1.setFromUnitVectors(AX, _v1);
    if (spin) { _q2.setFromAxisAngle(AX, spin); _q1.multiply(_q2); }
    w.quaternion.copy(_q1);
  }
  const yawTo = (fx, fz, tx, tz) => Math.atan2(tx - fx, tz - fz);
  function walkSeg(p, ax, az, bx, bz, u, dur, faceY) {
    const e = lerp(u, sstep(u), 0.6), dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    const yaw = d > 0.02 ? Math.atan2(dx, dz) : p.yaw;
    const fy = faceY === undefined ? yaw : yaw + angDiff(yaw, faceY) * sstep((u - 0.65) / 0.35);
    p.place(ax + dx * e, az + dz * e, fy);
    p.stride(e * d * 3.93, clamp(d / Math.max(0.2, dur) / 1.8, 0.0, 1.7) * (u > 0 && u < 1 ? 1 : 0.0));
  }

  // ============================================================ props builders
  function buildFuelProps(C) {
    const M = mats(), pg = propGeos(), P = C.P, con = C.content, pump = C.pumps[0];
    P.flapMat = solidMat(0xdddddd, { metalness: 0.3, roughness: 0.35 });
    P.nozzle = new T.Group(); propMesh(pg.nozzle, M.paint, P.nozzle); con.add(P.nozzle);
    P.tipGlow = glowSprite(0xffb030, 0.28, P.nozzle); P.tipGlow.position.set(0, 0, 0.3); P.tipGlow.visible = false;
    P.hose = new Hose(con, 0.027, 22);
    P.pole = new T.Mesh(geos().cyl, M.steel); P.pole.scale.set(0.015, 1, 0.015); P.pole.visible = false; con.add(P.pole);
    P.blade = new T.Mesh(pg.squeegee, M.paint); P.blade.visible = false; con.add(P.blade);
    P.bubble = new T.Sprite(new T.SpriteMaterial({ map: texBubble('ok'), transparent: true, depthWrite: false, fog: false })); P.bubble.visible = false; P.bubble.scale.set(0.01, 0.01, 1); con.add(P.bubble);
    P.hol = { pos: pump.holster.clone(), dir: new T.Vector3().copy(pump.normal).multiplyScalar(0.3).add(new T.Vector3(0, -0.95, 0)).normalize() };
    C.nozzleSet(P.hol.pos, P.hol.dir, pump.normal);
    C.hoseSet(0.5);
  }
  function buildGarageProps(C) {
    const M = mats(), pg = propGeos(), P = C.P, con = C.content, g = geos();
    P.jacks = [0, 1].map(() => {
      const grp = new T.Group(); propMesh(pg.jack, M.paint, grp);
      const ram = new T.Mesh(g.cyl, M.steel); ram.scale.set(0.034, 0.1, 0.034); grp.add(ram);
      const saddle = new T.Mesh(g.cyl, M.rubber); saddle.scale.set(0.11, 0.035, 0.11); grp.add(saddle);
      const handle = new T.Group(); handle.position.set(0.65, 0.21, 0); propMesh(pg.jackHandle, M.metal, handle); grp.add(handle);
      grp.visible = false; con.add(grp);
      const j = { grp, ram, saddle, handle };
      j.setLift = (h) => { ram.scale.y = Math.max(0.02, h); ram.position.set(0, 0.16 + h / 2, 0); saddle.position.set(0, 0.16 + h + 0.015, 0); j.top = 0.16 + h + 0.03; };
      j.setLift(0.05);
      return j;
    });
    P.guns = [0, 1, 2, 3, 4, 5].map(() => { const grp = new T.Group(); propMesh(pg.gun, M.paint, grp); grp.visible = false; con.add(grp); return grp; });
    P.bubble = new T.Sprite(new T.SpriteMaterial({ map: texBubble('ok'), transparent: true, depthWrite: false, fog: false })); P.bubble.visible = false; P.bubble.scale.set(0.01, 0.01, 1); con.add(P.bubble);
    // traffic light lamps (red / amber / green), two faces
    P.lampMats = { red: new T.MeshBasicMaterial({ color: 0x401010 }), amber: new T.MeshBasicMaterial({ color: 0x40300a }), green: new T.MeshBasicMaterial({ color: 0x0c3a1a }) };
    P.lampGlow = { red: [], amber: [], green: [] };
    [['red', 4.0, 0xff3322], ['amber', 3.55, 0xffb020], ['green', 3.1, 0x33ff77]].forEach(([k, y, col]) => {
      for (const face of [0, 1]) {
        const m = new T.Mesh(g.sphS, P.lampMats[k]); m.scale.set(0.13, 0.13, 0.08);
        if (face === 0) m.position.set(11.45, y - 0.0, 5.4 - 0.22); else m.position.set(11.45 - 0.22, y, 5.4);
        if (face === 1) m.scale.set(0.08, 0.13, 0.13);
        con.add(m);
        const gs = glowSprite(col, 0.95); gs.position.copy(m.position); gs.position.z -= face === 0 ? 0.1 : 0; gs.position.x -= face === 1 ? 0.1 : 0; gs.visible = false; con.add(gs); P.lampGlow[k].push(gs);
      }
    });
    C.setLamp('amber');
  }
  function addPerson(C, role, spec, x, z, yaw, idle) {
    const p = new Person(spec); p.role = role; p.home = { x, z, yaw }; p.baseIdle = idle; p.idleFn = idle; p.teleport(x, z, yaw);
    C.crewGroup.add(p.root); C.crew.push(p); C.R[role] = p; return p;
  }
  const OCT = (o) => Object.assign({ top: 0xd2281f, accent: 0xffc20e, pants: 0x25282e, hat: 'cap', hatColor: 0xffc20e, glove: 0xf4f4f0, sleeve: 0xf4f4f0 }, o);
  const PIT = (o) => Object.assign({ top: 0x1f5fd0, accent: 0xf4f4f0, pants: 0x173a86, hat: 'helmet', hatColor: 0xf4f4f0, glove: 0x15181c, sleeve: 0xf4f4f0, belt: 0xf4f4f0 }, o);
  function holdItem(p, k, mesh, x, y, z, rx) { p.arms[k].el.add(mesh); mesh.position.set(x, y, z); mesh.rotation.x = rx || 0; return mesh; }
  function crewFuel(C) {
    const S = SKINS, H = HAIRS, pg = propGeos(), M = mats();
    addPerson(C, 'attendant', OCT({ skin: S[1], hair: H[0] }), -10.8, -0.6, PI / 2, IDLE.stand);
    addPerson(C, 'cleaner', OCT({ skin: S[0], hair: H[3], hatColor: 0xf4f4f0 }), -10.7, 3.0, PI / 2, IDLE.hips);
    addPerson(C, 'wiper', OCT({ skin: S[3], hair: H[2] }), -11.0, 4.2, -PI / 2, IDLE.wipe);
    const sup = addPerson(C, 'supervisor', { top: 0xf4f4f0, accent: 0x1b55c4, pants: 0x14234a, skin: S[2], hair: H[1], hat: 'helmet', hatColor: 0xf4f4f0, vest: 0xd7ff2b, glove: 0x2b2d31, sleeve: 0xf4f4f0 }, -19.2, 3.2, PI / 2, IDLE.clip);
    holdItem(sup, 1, propMesh(pg.clip, M.paint), 0.0, -0.27, 0.1, -0.4);
    addPerson(C, 'greeter', OCT({ top: 0xffc20e, accent: 0xd2281f, hatColor: 0xd2281f, skin: S[0], hair: H[4], sleeve: 0xffc20e }), 12.8, -9.2, PI, IDLE.wave);
    addPerson(C, 'tyreguy', { top: 0x1f5fd0, accent: 0xf4f4f0, pants: 0x1f5fd0, skin: S[2], hair: H[2], hat: 'cap', hatColor: 0xffc20e, glove: 0xffc20e, sleeve: 0x1f5fd0 }, 18.9, 7.4, -2.4, IDLE.pump);
  }
  function crewGarage(C) {
    const S = SKINS, H = HAIRS, pg = propGeos(), M = mats();
    const row = [
      ['jackF', { hatColor: 0xd2281f }, -5.4, IDLE.hips], ['wheel0', {}, -4.2, IDLE.crossed], ['wheel1', {}, -3.0, IDLE.stand], ['chief', { hatColor: 0xf4f4f0, accent: 0xffc20e }, -1.8, IDLE.clip],
      ['mechA', { hatColor: 0xffc20e }, -0.6, IDLE.crossed], ['mechB', { hatColor: 0xffc20e }, 0.6, IDLE.hips], ['support', { hatColor: 0x2fae4d }, 1.8, IDLE.stand],
      ['wheel2', {}, 3.0, IDLE.hips], ['wheel3', {}, 4.2, IDLE.crossed], ['jackR', { hatColor: 0xd2281f }, 5.4, IDLE.stand]
    ];
    row.forEach((r, i) => addPerson(C, r[0], PIT(Object.assign({ skin: S[i % 4], hair: H[(i * 2) % 5] }, r[1])), 12.9, r[2], -PI / 2, r[3]));
    C.R.wheelmen = [C.R.wheel0, C.R.wheel1, C.R.wheel2, C.R.wheel3];
    holdItem(C.R.chief, 1, propMesh(pg.tablet, M.paint), 0.0, -0.27, 0.1, -0.35);
  }

  // ================================================================ STATION
  class Station {
    constructor(data, track, scene) {
      this.data = data; this.track = track; this.scene = scene || null;
      this.type = data.type === 'fuel' ? 'fuel' : 'parts';
      const z = data.z, cx = track.getCurveXAt(z), cy = track.getHeightAt(z);
      this.heading = track.getHeadingAt(z); this.wx = cx; this.wz = z;
      this.group = new T.Group(); this.group.name = 'pitStation_' + data.id; this.group.position.set(cx, cy, z);
      this.content = new T.Group(); this.content.name = 'pitContent'; this.content.rotation.y = this.heading; this.group.add(this.content);
      this.crewGroup = new T.Group(); this.crewGroup.name = 'pitCrew'; this.content.add(this.crewGroup);
      this.parkLaneX = this.type === 'fuel' ? -7 : 7; this.parkLocalZ = 0;
      this.fx = new Fx(this.content);
      this.crew = []; this.R = {}; this.P = {}; this.svc = null; this.K = null;
      this.dist = 1e9; this.time = 0; this.cheerT = 0; this.cheerBurst = 0; this.lampMode = 'amber'; this.lampT = 0; this.relT = 0;
      if (this.type === 'fuel') buildFuelStatic(this); else buildGarageStatic(this);
      this._approachSigns();
      if (this.type === 'fuel') { buildFuelProps(this); crewFuel(this); } else { buildGarageProps(this); buildGarageProps2(this); crewGarage(this); }
      this._initLights();
      this.group.userData.pit = this;
    }
    // ---- approach signs at local z = -280 / -140
    _approachSigns() {
      const tr = this.track, z0 = this.data.z, cx0 = this.group.position.x, cy0 = this.group.position.y;
      for (const dz of [-280, -140]) {
        const z = z0 + dz, x = tr.getCurveXAt(z) - cx0 + (this.type === 'fuel' ? -13.2 : 13.2), y = tr.getHeightAt(z) - cy0;
        const g = new T.Group(); g.position.set(x, y, dz); g.rotation.y = tr.getHeadingAt(z);
        const sb = new GB(); CY(sb, 0x8c929a, -2.0, 0, 0, 0.09, 4.9); CY(sb, 0x8c929a, 2.0, 0, 0, 0.09, 4.9); BX(sb, 0x0d56a8, 0, 2.2, 0.02, 5.2, 2.7, 0.14);
        g.add(new T.Mesh(sb.build(), mats().solid));
        quad(g, new T.MeshBasicMaterial({ map: texRoadSign(this.type === 'fuel' ? 'fuel' : 'garage', Math.abs(dz)) }), 5.0, 2.5, 0, 3.55, -0.1, PI);
        this.group.add(g);
      }
    }
    // ---- shared point lights (2 in the whole scene)
    _initLights() {
      const L = ensureLights(); if (!L) return;
      if (!LPOOL.owner || !inScene(L[0])) this._takeLights(true);
    }
    _takeLights(first) {
      const L = LPOOL.lights;
      L.forEach((l, i) => { if (l.parent) l.parent.remove(l); this.content.add(l); l.position.copy(this.lightSpots[i]); });
      LPOOL.owner = this; if (first) L.forEach((l) => { l.intensity = 0; });
    }
    _lightsUpdate(dt) {
      const L = LPOOL.lights; if (!L) return;
      if (LPOOL.owner !== this) {
        if (this.dist < 150 && (!LPOOL.owner || LPOOL.owner.dist > this.dist + 20 || !inScene(L[0]))) { this._takeLights(false); } else return;
      }
      const target = this.dist < 140 ? (this.type === 'fuel' ? 1.15 : 0.95) : 0;
      for (const l of L) l.intensity += (target - l.intensity) * Math.min(1, dt * 4);
    }
    // ---- traffic light
    setLamp(mode) {
      this.lampMode = mode; const P = this.P; if (!P.lampMats) return;
      const on = { red: 0xff3322, amber: 0xffb020, green: 0x33ff77 }, off = { red: 0x401010, amber: 0x40300a, green: 0x0c3a1a };
      for (const k of ['red', 'amber', 'green']) {
        const lit = mode === k || (mode === 'amber' && k === 'amber' && ((this.lampT * 1.6) | 0) % 2 === 0);
        P.lampMats[k].color.setHex(lit ? on[k] : off[k]); for (const s of P.lampGlow[k]) s.visible = lit;
      }
    }
    // ---- nozzle / hose helpers (fuel)
    nozzleSet(pos, dir, upHint) { const n = this.P.nozzle; n.position.copy(pos); orient(n, dir.x, dir.y, dir.z, upHint.x, upHint.y, upHint.z); n.updateMatrix(); }
    hoseSet(sag, bx, bz) { const P = this.P; P2C(P.nozzle, 0, 0, -0.16, _v5); P.hose.set(this.pumps[0].port, _v5, sag, bx || 0, bz || 0); }
    // ---- frame update
    update(dt, focus) {
      if (focus) { const dx = focus.x - this.wx, dz = focus.z - this.wz; this.dist = Math.sqrt(dx * dx + dz * dz); } else this.dist = 0;
      const near = this.dist < 300 || !!this.svc;
      const showCrew = this.dist < 175 || !!this.svc;
      if (this.crewGroup.visible !== showCrew) this.crewGroup.visible = showCrew;
      dt = Math.min(Math.max(dt || 0, 0), 0.05);
      this._lightsUpdate(dt);
      if (!near) return;
      this.time += dt; this.lampT += dt;
      if (this.svc) this._stepService(dt);
      else {
        if (this.dist < 170 || this.K) for (const p of this.crew) p.tick(dt);
        this._cheerTick(dt);
        if (this.K && this.cheerT <= 0) {            // car drove away -> crew go back to their posts
          this.relT += dt;
          if (this.relT > 0.5) {
            this.relT = 0; const rp = this.K.veh.root.position, h = this.heading, c = Math.cos(h), sn = Math.sin(h);
            const lx = (rp.x - this.wx) * c - (rp.z - this.wz) * sn, lz = (rp.x - this.wx) * sn + (rp.z - this.wz) * c;
            if (Math.abs(lx - this.K.x) > 3 || Math.abs(lz - this.K.z) > 8) this.release();
          }
        }
      }
      this.fx.update(dt);
      if (this.dist < 220) this._ambient(dt);
    }
    _ambient() {
      if (this.type === 'parts' && this.lampMode === 'amber') this.setLamp('amber');
      if (this.flags) for (const f of this.flags) { f.m.rotation.y = PI / 2 + 0.3 * Math.sin(this.time * 3 + f.ph); f.m.scale.x = 1.7 + 0.15 * Math.sin(this.time * 5 + f.ph); }
      if (this.type === 'fuel' && this.dist < 90) { // greeter faces the oncoming car
        const g = this.R.greeter; if (g && this.K === null) g.faceYaw = PI;
      }
    }
    _cheerTick(dt) {
      if (this.cheerT <= 0) return;
      this.cheerT -= dt;
      const K = this.K, bx = K ? K.x : this.parkLaneX;
      if (this.cheerBurst > 0) {
        this.cheerBurst -= dt; const n = Math.ceil(70 * dt);
        const cols = [0xff3b30, 0xffc20e, 0x34c759, 0x38d8ff, 0xffffff, 0xff7ab8];
        for (let i = 0; i < n; i++) this.fx.confetti(bx + rnd(-7, 7), rnd(5.5, 7.5), rnd(-6, 6), rnd(-1.5, 1.5), rnd(0, 2), rnd(-1.5, 1.5), cols[(Math.random() * cols.length) | 0]);
      }
      if (this.cheerT <= 0) { for (const p of this.crew) p.idleFn = p.baseIdle; if (this.type === 'parts') this.setLamp(this.K ? 'green' : 'amber'); }
    }
    cheer() {
      if (this.svc) return;
      this.cheerT = 3.0; this.cheerBurst = 1.1;
      for (const p of this.crew) { p.idleFn = IDLE.cheer; if (p.mode === 'goto') { p.mode = 'idle'; p.target = null; } p.faceYaw = this.type === 'fuel' ? PI : -PI / 2 + (p.seed % 1 > 0.5 ? 0.3 : -0.3); }
      if (this.type === 'parts') this.setLamp('green');
    }
    // ---- crew staging
    _crewReady(walk) {
      const K = this.K; if (!K) return;
      const go = (p, x, z, yaw, idle) => { p.baseIdle = idle || p.baseIdle; p.idleFn = p.baseIdle; if (walk) p.goTo(x, z, yaw, 2.5); else p.teleport(x, z, yaw); };
      if (this.type === 'fuel') {
        const pump = this.pumps[0], A = this.R.attendant;
        go(A, pump.holster.x + pump.normal.x * 0.85, pump.holster.z + pump.normal.z * 0.85, yawTo(0, 0, -pump.normal.x, -pump.normal.z), IDLE.stand);
        go(this.R.cleaner, K.x - 3.4, K.noseZ ? K.z + K.noseZ + 0.2 : 2.6, PI / 2, IDLE.hips);
        return;
      }
      const toC2 = (lx, lz) => toC(K, lx, 0, lz, new T.Vector3());
      const faceCar = (px, pz) => yawTo(px, pz, K.x, K.z);
      K.wheels.forEach((w, i) => {
        const p = this.R.wheelmen[i]; if (!p) return;
        const o = w.side || 1;
        const hx = toC2(w.home.x, w.home.z), pxz = toC2(w.home.x + o * (w.width / 2 + 0.95), w.home.z);
        go(p, pxz.x, pxz.z, yawTo(pxz.x, pxz.z, hx.x, hx.z), IDLE.ready);
      });
      for (let i = K.wheels.length; i < 4; i++) { const p = this.R.wheelmen[i], px = K.x + 3.6, pz = (i % 2 ? -1 : 1) * (1.0 + (i > 2 ? 1.4 : 0)); go(p, px, pz, faceCar(px, pz), IDLE.crossed); }
      const jz = [K.frontZ + (K.bike ? -0.75 : 0), K.rearZ + (K.bike ? 0.75 : 0)];
      go(this.R.jackF, K.x + 3.0, K.z + jz[0], PI * -0.5, IDLE.hips); go(this.R.jackR, K.x + 3.0, K.z + jz[1], PI * -0.5, IDLE.hips);
      go(this.R.chief, K.x + 3.7, K.z + 0.0, -PI / 2, IDLE.clip);
      go(this.R.mechA, K.x + 3.9, K.z + 3.3, faceCar(K.x + 3.9, K.z + 3.3), IDLE.crossed); go(this.R.mechB, K.x + 3.9, K.z - 3.3, faceCar(K.x + 3.9, K.z - 3.3), IDLE.hips);
      go(this.R.support, K.x + 4.6, K.z + 1.8, -PI / 2, IDLE.stand);
    }
    /** crew return to their posts (called automatically when the car has left) */
    release() {
      if (this.svc) return;
      this.K = null; this.cheerT = 0;
      for (const p of this.crew) { p.idleFn = p.baseIdle; p.goTo(p.home.x, p.home.z, p.home.yaw, 2.2); }
      if (this.type === 'parts') this.setLamp('amber');
    }
    _resetCrew() {
      this.cheerT = 0;
      if (this.K) this._crewReady(false); else for (const p of this.crew) { p.idleFn = p.baseIdle; p.teleport(p.home.x, p.home.z, p.home.yaw); }
    }
    prepare(veh) {
      if (this.svc) return;
      this.K = measureCar(this, veh);
      this.cheerT = 0; for (const p of this.crew) p.idleFn = p.baseIdle;
      this._crewReady(true);
      if (this.type === 'parts') this.setLamp('red');
    }
    startService(veh, kind, onProgress, onDone) {
      if (this.svc) this._finishService(true);
      const ok = this.type === 'fuel' ? kind === 'fuel' : (kind === 'tires' || kind === 'turbo' || kind === 'suspension' || kind === 'shield');
      if (!ok) { if (onProgress) onProgress(1); if (onDone) onDone(); return; }
      const hadK = !!this.K && this.K.veh === veh;
      this.K = measureCar(this, veh);
      if (!hadK) this._crewReady(false);
      this.cheerT = 0; for (const p of this.crew) { p.idleFn = p.baseIdle; }
      const build = { fuel: svcFuel, tires: svcTires, turbo: svcTurbo, suspension: svcSuspension, shield: svcShield }[kind];
      const s = build(this, this.K);
      s.t = 0; s.onProgress = onProgress; s.onDone = onDone; s.lastU = 0;
      this.svc = s;
      for (const p of s.actors) p.mode = 'script';
      if (this.type === 'parts') this.setLamp('red');
      this._stepService(0);
    }
    _stepService(dt) {
      const s = this.svc; s.t = Math.min(s.D, s.t + dt); const t = s.t;
      if (s.step) s.step(t, dt);
      for (const p of s.actors) p.runScript(t, dt);
      for (const p of this.crew) if (!p.script) p.tick(dt);
      if (s.post) s.post(t, dt);
      const u = t / s.D;
      if (s.onProgress && (u > s.lastU || u === 0)) { s.lastU = u; s.onProgress(u); }
      if (t >= s.D) this._finishService(false);
    }
    _finishService(cancelled) {
      const s = this.svc; if (!s) return; this.svc = null;
      for (let i = s.undo.length - 1; i >= 0; i--) { try { s.undo[i](); } catch (e) { console.error('pit3d undo', e); } }
      for (const p of s.actors) p.endScript();
      if (this.K) this.K.lift = 0;
      if (cancelled) { this.fx.clear(); this._resetCrew(); if (this.type === 'parts') this.setLamp('red'); }
      else {
        this.cheerT = 2.4; this.cheerBurst = 0.5; for (const p of this.crew) { p.idleFn = IDLE.cheer; }
        if (this.type === 'parts') this.setLamp('green');
        if (s.onProgress) s.onProgress(1);
        if (s.onDone) s.onDone();
      }
    }
    /** suggested cinematic camera for a service. u = progress 0..1. returns false when no car is staged */
    serviceCamera(kind, u, camera) {
      const K = this.K; if (!K) return false;
      const P = SERVICE_CAMS[kind] || SERVICE_CAMS.tires;
      const k = sstep(clamp(u, 0, 1)), az = lerp(P.az0, P.az1, k) * PI / 180, el = P.el * PI / 180, rad = lerp(P.r0, P.r1, k);
      _v1.set(K.x + P.cx, P.cy, K.z + P.cz);
      _v2.set(_v1.x + Math.sin(az) * Math.cos(el) * rad, _v1.y + Math.sin(el) * rad, _v1.z + Math.cos(az) * Math.cos(el) * rad);
      this.content.updateWorldMatrix(true, false);
      this.content.localToWorld(_v2); this.content.localToWorld(_v1);
      camera.position.copy(_v2); camera.lookAt(_v1);
      return true;
    }
    dispose() {
      this.cancel();
      if (LPOOL.owner === this) { LPOOL.lights.forEach((l) => { if (l.parent) l.parent.remove(l); l.intensity = 0; }); LPOOL.owner = null; }
      if (this.group.parent) this.group.parent.remove(this.group);
    }
    cancel() {
      if (this.svc) this._finishService(true);
      else { this.cheerT = 0; this.fx.clear(); for (const p of this.crew) p.idleFn = p.baseIdle; if (this.type === 'parts') this.setLamp(this.K ? 'red' : 'amber'); }
    }
  }

  // suggested cameras (content frame, angles in degrees from +Z toward +X; negative = lane side of the garage / pump side of the fuel station)
  const SERVICE_CAMS = {
    fuel: { az0: 62, az1: 118, el: 17, r0: 8.4, r1: 7.4, cx: -1.1, cy: 0.9, cz: -0.4 },
    tires: { az0: -130, az1: -52, el: 21, r0: 8.8, r1: 8.2, cx: 0, cy: 0.8, cz: 0 },
    turbo: { az0: -58, az1: -22, el: 19, r0: 8.6, r1: 8.0, cx: 0, cy: 0.9, cz: 1.3 },
    suspension: { az0: -84, az1: -46, el: 11, r0: 8.8, r1: 8.2, cx: -0.3, cy: 0.55, cz: 0 },
    shield: { az0: -50, az1: -18, el: 16, r0: 8.4, r1: 7.8, cx: 0, cy: 0.8, cz: 1.4 }
  };
  // ======================================================== service helpers
  /** walk from a to b (u 0..1) with smooth turning toward yawD; call every frame */
  function walkTo(p, ax, az, bx, bz, u, dur, dt, yawD, rate) {
    const e = lerp(u, sstep(u), 0.55), dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    const y0 = p.yaw;
    p.place(ax + dx * e, az + dz * e, y0);
    const moving = u > 0 && u < 1 && d > 0.05;
    const want = yawD !== undefined ? yawD : (d > 0.05 ? Math.atan2(dx, dz) : y0);
    p.turn(want, dt, rate || 12);
    if (moving) p.stride(e * d * 3.93, clamp(d / Math.max(0.2, dur) / 1.8, 0.5, 1.7));
  }
  function mix3(a, b, k, out) { return out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k); }
  const win = (t, a, b, c, d) => sstep(seg01(t, a, b)) * (1 - sstep(seg01(t, c, d)));   // 0 -> 1 on [a,b], 1 -> 0 on [c,d]

  function makeFlap(C, K) {
    const g = new T.Group(), M = mats();
    if (!FLAP_DARK) FLAP_DARK = new T.MeshBasicMaterial({ color: 0x050607 });
    const dark = new T.Mesh(geos().cyl8, FLAP_DARK); dark.scale.set(0.085, 0.01, 0.085); dark.rotation.x = PI / 2; dark.position.z = 0.003; g.add(dark);
    const ring = new T.Mesh(geos().torus, M.steel); ring.scale.set(0.058, 0.058, 0.058); ring.position.z = 0.008; g.add(ring);
    const pivot = new T.Group(); pivot.position.x = 0.1; g.add(pivot);
    C.P.flapMat.color.copy(K.paint);
    const lid = new T.Mesh(geos().box, C.P.flapMat); lid.scale.set(0.2, 0.19, 0.014); lid.position.set(-0.1, 0, 0.012); pivot.add(lid);
    g.position.copy(K.port.p).addScaledVector(K.port.n, 0.005);
    orient(g, K.port.n.x, K.port.n.y, K.port.n.z, 0, 1, 0);
    return { group: g, pivot };
  }

  // ============================================================ SERVICE: FUEL
  function svcFuel(C, K) {
    const veh = K.veh, P = C.P, R = C.R, pump = C.pumps[0], fx = C.fx, A = R.attendant, B = R.cleaner;
    const D = 4.4;
    const svc = { kind: 'fuel', D, undo: [], actors: [A, B], dispT: 0 };
    const V3 = () => new T.Vector3();
    const portC = toC(K, K.port.p.x, K.port.p.y, K.port.p.z, V3());
    const nC = dirC(K, K.port.n.x, 0, K.port.n.z, V3()).normalize();
    const fwdC = dirC(K, 0, 0, 1, V3()), latC = dirC(K, 1, 0, 0, V3());
    const flap = makeFlap(C, K); veh.bodyGroup.add(flap.group);
    const standA = V3().set(portC.x + nC.x * 0.62, 0, portC.z + nC.z * 0.62), yawStand = Math.atan2(-nC.x, -nC.z);
    const ps = V3().set(pump.holster.x + pump.normal.x * 0.85, 0, pump.holster.z + pump.normal.z * 0.85), yawPump = Math.atan2(-pump.normal.x, -pump.normal.z);
    const A0 = { x: A.x, z: A.z }, B0 = { x: B.x, z: B.z };
    const vH = P.hol.pos, dH = P.hol.dir, vC = V3(), dC = V3(), vV = V3(), dV = V3(), vI = V3(), dI = V3(), nv = V3(), nd = V3(), tmp = V3(), tmp2 = V3(), up = V3().set(0, 1, 0);
    vV.copy(portC).addScaledVector(nC, 0.56); dV.copy(nC).multiplyScalar(-1).add(tmp.set(0, -0.12, 0)).normalize();
    vI.copy(portC).addScaledVector(nC, 0.265); dI.copy(nC).multiplyScalar(-1);
    const litresTotal = K.bike ? rnd(12, 17) : rnd(34, 49);
    const T_ = { out: 0.45, walk: 1.15, ins: 1.45, fillEnd: 3.3, wd: 3.55, back0: 3.65, hang: 4.1 };
    // lid edge (closed -> open) helper
    const lidEdge = (th, out) => out.copy(portC).addScaledVector(fwdC, 0.1 - 0.2 * Math.cos(th)).addScaledVector(nC, 0.2 * Math.sin(th) + 0.035);
    // ---- attendant
    A.setScript([{ a: 0, b: D, fn: (u, t, dt, p) => {
      if (t < T_.out) walkTo(p, A0.x, A0.z, ps.x, ps.z, seg01(t, 0, T_.out), T_.out, dt, yawPump);
      else if (t < T_.walk) walkTo(p, ps.x, ps.z, standA.x, standA.z, seg01(t, T_.out, T_.walk), T_.walk - T_.out, dt, yawStand);
      else if (t < T_.back0) { p.place(standA.x, standA.z, p.yaw); p.turn(yawStand, dt, 10); }
      else if (t < T_.hang) walkTo(p, standA.x, standA.z, ps.x, ps.z, seg01(t, T_.back0, T_.hang), T_.hang - T_.back0, dt, yawPump);
      else { p.place(ps.x, ps.z, p.yaw); p.turn(PI + K.yaw, dt, 9); }
      const fueling = t > T_.ins && t < T_.fillEnd;
      p.bend(0.08 + (fueling ? 0.06 + 0.012 * Math.sin(t * 7) : 0));
      // nozzle key poses
      p.torsoPoint(-0.2, 0.17, 0.4, vC); dC.set(Math.sin(p.yaw), -0.5, Math.cos(p.yaw)).normalize();
      let nk;
      if (t < 0.15) { nv.copy(vH); nd.copy(dH); }
      else if (t < 0.5) { nk = sstep(seg01(t, 0.15, 0.5)); mix3(vH, vC, nk, nv); mix3(dH, dC, nk, nd); }
      else if (t < 1.1) { nv.copy(vC); nd.copy(dC); }
      else if (t < 1.3) { nk = sstep(seg01(t, 1.1, 1.3)); mix3(vC, vV, nk, nv); mix3(dC, dV, nk, nd); }
      else if (t < T_.ins) { nk = sstep(seg01(t, 1.3, T_.ins)); mix3(vV, vI, nk, nv); mix3(dV, dI, nk, nd); }
      else if (t < T_.fillEnd) { nv.copy(vI); nd.copy(dI); nv.addScaledVector(nC, 0.004 * Math.sin(t * 40)); }
      else if (t < T_.wd) { nk = sstep(seg01(t, T_.fillEnd, T_.wd)); mix3(vI, vV, nk, nv); mix3(dI, dV, nk, nd); }
      else if (t < 3.8) { nk = sstep(seg01(t, T_.wd, 3.8)); mix3(vV, vC, nk, nv); mix3(dV, dC, nk, nd); }
      else if (t < 4.0) { nv.copy(vC); nd.copy(dC); }
      else { nk = sstep(seg01(t, 4.0, T_.hang + 0.04)); mix3(vC, vH, nk, nv); mix3(dC, dH, nk, nd); }
      C.nozzleSet(nv, nd, up);
      // gaze
      if (t < 0.5) p.look(pump.holster.x, 1.0, pump.holster.z); else if (t < 3.95) p.look(portC.x, portC.y, portC.z); else p.look(K.x, 3, -14);
      // hands
      P2C(P.nozzle, 0, -0.085, -0.05, tmp);
      const thumbK = sstep(seg01(t, 4.05, 4.3));
      if (thumbK > 0) p.torsoPoint(-0.2, 0.98, 0.3, tmp2);
      if (thumbK > 0) mix3(tmp, tmp2, thumbK, tmp);
      p.reach(1, tmp.x, tmp.y, tmp.z);
      // left hand: neutral / flap / hose
      p.torsoPoint(0.26, 0.05, 0.14, tmp2);
      const th = flap.pivot.rotation.y;
      const wO = win(t, 0.7, 0.88, 1.12, 1.28), wH = win(t, 1.25, 1.45, 3.3, 3.5), wC = win(t, 3.42, 3.56, 3.9, 4.02);
      if (wO > 0) mix3(tmp2, lidEdge(th, tmp), wO, tmp2);
      if (wC > 0) mix3(tmp2, lidEdge(th, tmp), wC, tmp2);
      if (wH > 0) { P2C(P.nozzle, 0, -0.01, -0.2, tmp); mix3(tmp2, tmp, wH, tmp2); }
      p.reach(0, tmp2.x, tmp2.y, tmp2.z);
      // bubble
      if (t > 4.12) { P.bubble.visible = true; p.torsoPoint(0, 1.5, 0, tmp); P.bubble.position.copy(tmp); const s = 0.8 * easeOutBack(seg01(t, 4.12, 4.36)); P.bubble.scale.set(s, s, 1); }
    } }]);
    // ---- windscreen cleaner (long squeegee pole)
    const wsC = toC(K, K.ws.p.x, K.ws.p.y, K.ws.p.z, V3()), wsN = dirC(K, K.ws.n.x, K.ws.n.y, K.ws.n.z, V3()).normalize();
    const F = toC(K, 0, 0, K.noseZ + 0.45, V3());
    const surfUp = V3().copy(up).addScaledVector(wsN, -up.dot(wsN)).normalize();
    const yawF = PI + K.yaw, Hh = V3(), Tt = V3(), Tc = V3(), dirP = V3(), pb = V3(), bq = new T.Quaternion();
    B.setScript([{ a: 0, b: D, fn: (u, t, dt, p) => {
      if (t < 0.15) { p.place(B0.x, B0.z, p.yaw); p.turn(yawF, dt, 8); }
      else if (t < 1.05) walkTo(p, B0.x, B0.z, F.x, F.z, seg01(t, 0.15, 1.05), 0.9, dt, yawF);
      else if (t < 3.7) { p.place(F.x, F.z, p.yaw); p.turn(yawF, dt, 8); }
      else if (t < 4.1) walkTo(p, F.x, F.z, F.x + latC.x * 0.8, F.z + latC.z * 0.8, seg01(t, 3.7, 4.1), 0.4, dt, yawF);
      else { p.place(F.x + latC.x * 0.8, F.z + latC.z * 0.8, p.yaw); p.turn(PI, dt, 8); }
      p.bend(0.1);
      p.torsoPoint(0.0, 0.2, 0.3, Hh);
      const k = win(t, 1.0, 1.3, 3.3, 3.65);
      const tau = seg01(t, 1.15, 3.3);
      Tc.set(Hh.x + Math.sin(p.yaw) * 0.8, Hh.y + 1.15, Hh.z + Math.cos(p.yaw) * 0.8);
      const sx = 0.42 * Math.sin(tau * TAU * 1.5), sy = 0.1 * Math.sin(tau * TAU * 3.0 + 1);
      Tt.copy(wsC).addScaledVector(wsN, 0.05).addScaledVector(latC, sx).addScaledVector(surfUp, sy);
      mix3(Tc, Tt, k, Tt);
      dirP.subVectors(Tt, Hh); const len = dirP.length(); dirP.normalize();
      pb.copy(Hh).addScaledVector(dirP, -0.45);
      const L = len + 0.45;
      P.pole.visible = t > 0.12; P.blade.visible = P.pole.visible;
      P.pole.position.copy(pb).addScaledVector(dirP, L / 2); P.pole.scale.set(0.015, L, 0.015); _q1.setFromUnitVectors(AY, dirP); P.pole.quaternion.copy(_q1);
      // squeegee head: local +Y points back along the pole, blade tip touches the glass
      _v2.copy(dirP).negate(); _v1.copy(latC).addScaledVector(_v2, -latC.dot(_v2)).normalize(); _v3.crossVectors(_v1, _v2);
      _m1.makeBasis(_v1, _v2, _v3); P.blade.quaternion.setFromRotationMatrix(_m1);
      P.blade.position.copy(Tt).addScaledVector(dirP, 0.223);
      p.look(Tt.x, Tt.y, Tt.z);
      p.reach(1, Hh.x, Hh.y, Hh.z); p.reach(0, Hh.x + dirP.x * 0.55, Hh.y + dirP.y * 0.55, Hh.z + dirP.z * 0.55);
      if (t > 3.9) p.reachLocal(0, 0.1, 0.98, 0.15);
    } }]);
    // ---- global step: flap, flow, display
    svc.step = (t, dt) => {
      flap.pivot.rotation.y = 1.75 * win(t, 0.85, 1.15, 3.55, 3.9);
      const filling = t > T_.ins && t < T_.fillEnd + 0.05;
      P.hose.flow.visible = filling; if (filling) P.hose.flowMat.map.offset.y -= dt * 2.6;
      P.tipGlow.visible = filling && !K.bike; if (P.tipGlow.visible) P.tipGlow.material.opacity = 0.7 + 0.3 * Math.sin(t * 24);
      svc.dispT += dt;
      if (svc.dispT >= 0.1 || t === 0 || t >= D) {
        svc.dispT = 0; const f = sstep(seg01(t, T_.ins + 0.05, 3.2)); const lit = litresTotal * f;
        pump.disp.draw(lit, lit * 7.29, t >= 3.2);
      }
    };
    let drip = 0, vap = 0, flash1 = false, flash2 = false;
    svc.post = (t, dt) => {
      // hose follows the nozzle
      const holstered = t < 0.2 || t > 4.12;
      const nzDist = _v5.copy(P.nozzle.position).distanceTo(pump.port);
      C.hoseSet(holstered ? 0.5 : clamp(0.62 - nzDist * 0.12, 0.16, 0.5), -nC.x * 0.2, -nC.z * 0.2);
      const filling = t > T_.ins && t < T_.fillEnd;
      if (filling && dt > 0) {
        drip += dt * 11; vap += dt * 5;
        while (drip >= 1) { drip -= 1; fx.glow(portC.x + nC.x * 0.07 + rnd(-0.03, 0.03), portC.y - 0.12, portC.z + rnd(-0.06, 0.06), nC.x * rnd(0.2, 0.7), rnd(-0.2, 0.3), nC.z * rnd(0.2, 0.7) + rnd(-0.2, 0.2), rnd(0.35, 0.6), 0.1, 0xffb23a, 7); }
        while (vap >= 1) { vap -= 1; fx.puff(portC.x + nC.x * 0.1, portC.y + 0.05, portC.z, nC.x * 0.3, rnd(0.4, 0.8), nC.z * 0.3, rnd(0.6, 0.9), 0.07, 3.0, 0.95); }
      }
      if (!flash1 && t >= T_.ins) { flash1 = true; fx.glow(portC.x + nC.x * 0.1, portC.y, portC.z, 0, 0, 0, 0.3, 0.45, 0xffd36a); fx.burst(portC.x + nC.x * 0.1, portC.y, portC.z, 8, 1.8, 0xffd36a, nC.x, 0.2, nC.z); }
      if (!flash2 && t >= 3.2) { flash2 = true; const dx = pump.port.x + pump.normal.x * 0.4; fx.glow(dx, 1.35, pump.port.z, 0, 0, 0, 0.4, 0.8, 0xffe45e); }
    };
    svc.undo.push(() => {
      veh.bodyGroup.remove(flap.group);
      C.nozzleSet(vH, dH, pump.normal); C.hoseSet(0.5);
      P.hose.flow.visible = false; P.tipGlow.visible = false; P.pole.visible = false; P.blade.visible = false; P.bubble.visible = false;
      pump.disp.draw(0, 0, false);
    });
    return svc;
  }

  // ============================================================ SERVICE: TIRES
  function carBounce(t, t0, amp) { const tau = t - t0; return tau > 0 ? Math.max(0, amp * Math.exp(-7 * tau) * Math.sin(tau * 21)) : 0; }
  /** jacks + jack men shared by tires / suspension. returns {step(t,dt), actors, hide()} */
  function setupJacks(C, K, svc, tl) {
    const P = C.P, R = C.R, V3 = () => new T.Vector3();
    const jz = [K.frontZ + (K.bike ? -0.8 : -0.62), K.rearZ + (K.bike ? 0.8 : 0.62)];
    const men = [R.jackF, R.jackR], res = { jz, men };
    const m0 = men.map((p) => ({ x: p.x, z: p.z }));
    P.jacks.forEach((j) => { j.grp.visible = true; j.grp.rotation.y = K.yaw; });
    const jackX = (t) => lerp(0.9, 0.0, sstep(seg01(t, tl.in0, tl.in1)));
    men.forEach((p, i) => {
      const j = P.jacks[i], mp = V3(), grip = V3(), tmp = V3(), tmp2 = V3();
      svc.actors.push(p);
      p.setScript([{ a: 0, b: svc.D, fn: (u, t, dt, pp) => {
        const xo = jackX(t) + 2.3; toC(K, xo, 0, jz[i], mp);
        if (t < tl.in1) walkTo(pp, m0[i].x, m0[i].z, mp.x, mp.z, seg01(t, 0, tl.in1), tl.in1, dt, K.yaw - PI / 2); else { pp.place(mp.x, mp.z, pp.yaw); pp.turn(K.yaw - PI / 2, dt, 10); }
        const act = win(t, tl.in0, tl.in1 + 0.1, svc.D - 0.45, svc.D - 0.2);
        pp.squat(lerp(0.97, 0.78, act)); pp.bend(0.28 * act);
        const phi = j.phi || 0.55; const gl = 1.15;
        P2C(j.grp, 0.65 + gl * Math.cos(phi), 0.21 + gl * Math.sin(phi), 0, grip);
        pp.look(K.x, 0.8, K.z);
        pp.reach(1, grip.x + K.sin * 0.08, grip.y, grip.z + K.cos * 0.08); pp.reach(0, grip.x - K.sin * 0.1, grip.y, grip.z - K.cos * 0.1);
        if (t > svc.D - 0.2) { pp.reachLocal(1, -0.24, 1.0, 0.1); pp.reachLocal(0, 0.24, 1.0, 0.1); }
      } }]);
    });
    res.step = (t, dt, L) => {
      P.jacks.forEach((j, i) => {
        toC(K, jackX(t), 0, jz[i], _v1); j.grp.position.set(_v1.x, 0.0, _v1.z);
        const lifting = win(t, tl.up0, tl.up1, tl.dn0, tl.dn1);
        const pump = seg01(t, tl.up0, tl.up1) < 1 ? Math.sin(seg01(t, tl.up0, tl.up1) * TAU * 3 + i) : (t > tl.dn0 && t < tl.dn1 ? Math.sin(seg01(t, tl.dn0, tl.dn1) * TAU * 1.5) : 0);
        j.phi = 0.62 + 0.3 * pump;
        j.handle.rotation.z = j.phi;
        j.setLift(Math.max(0.03, K.clear + L - 0.19));
        j.grp.visible = true;
      });
    };
    res.hide = () => { P.jacks.forEach((j) => { j.grp.visible = false; }); };
    svc.undo.push(res.hide);
    return res;
  }

  function svcTires(C, K) {
    const veh = K.veh, P = C.P, R = C.R, fx = C.fx, W = K.wheels, n = W.length;
    const D = 4.5, LMAX = 0.36;
    const TL = { A: 0.45, U0: 1.05, U1: 1.65, PULL: 1.8, QS: 2.15, PLACE: 2.25, QN: 2.55, PICK: 2.7, S2: 3.25, MOUNT: 3.5, GUN: 3.9, up0: 0.45, up1: 1.0, dn0: 3.9, dn1: 4.3, in0: 0.0, in1: 0.5 };
    const men = R.wheelmen.slice(0, n);
    const svc = { kind: 'tires', D, undo: [], actors: [] };
    const baseY = veh.bodyGroup.position.y;
    const hasFlat = typeof veh.setFlatTires === 'function';
    const V3 = () => new T.Vector3();
    const latC = dirC(K, 0, 0, 1, V3()), up = V3().set(0, 1, 0);
    const items = W.map((e, i) => {
      const o = e.side || 1;
      const out = dirC(K, o, 0, 0, V3()); out.y = 0; out.normalize();
      const hubG = toC(K, e.home.x, 0, e.home.z, V3());
      const clone = e.w.clone(true); clone.userData = {}; clone.scale.set(1, 1, 1); clone.rotation.set(0, 0, 0); clone.position.set(0, 0, 0);
      const it = { e, i, o, out, hubG, r: e.r, wd: e.width, mounted: false, detached: false, clone };
      it.nutOld = nutRing(e.width, e.r, o); e.w.add(it.nutOld);
      it.nutNew = nutRing(e.width, e.r, o); clone.add(it.nutNew);
      it.fxNew = newTyreFx(e.width, e.r, o); clone.add(it.fxNew);
      const lat = V3().copy(latC).multiplyScalar(e.home.z >= 0 ? 1 : -1);
      it.Pnew = V3().copy(hubG).addScaledVector(out, 2.15);
      it.Ps = V3().copy(it.Pnew).addScaledVector(lat, 1.1);
      it.S = V3().copy(hubG).addScaledVector(out, e.width / 2 + 0.52);
      it.Qs = V3().copy(it.Ps).addScaledVector(out, -0.72); it.Qn = V3().copy(it.Pnew).addScaledVector(out, -0.72);
      it.yawS = Math.atan2(-out.x, -out.z); it.yawOut = Math.atan2(out.x, out.z);
      it.hubFace = V3(); it.hubC = V3(); it.gunning = false; it.spark = 0;
      setWheel(clone, it.Pnew.x, e.r, it.Pnew.z, out.x, 0, out.z, 0.4 * i);
      C.content.add(clone);
      return it;
    });
    if (hasFlat) veh.setFlatTires(true);
    const jacks = setupJacks(C, K, svc, TL);
    // ---- wheel men
    items.forEach((it, i) => {
      const p = men[i]; if (!p) return;
      const e = it.e, wheel = e.w, clone = it.clone, gun = P.guns[i]; gun.visible = true;
      svc.actors.push(p);
      const m0 = { x: p.x, z: p.z };
      const chest = V3(), hip = V3(), gOr = V3(), gDir = V3(), tmp = V3(), tmp2 = V3(), cw = V3(), hov = V3(), wp = V3(), ax = V3(), hd1 = V3(), hd2 = V3();
      p.setScript([{ a: 0, b: D, fn: (u, t, dt, pp) => {
        // ----- body position / facing
        if (t < TL.A) walkTo(pp, m0.x, m0.z, it.S.x, it.S.z, seg01(t, 0, TL.A), TL.A, dt, it.yawS);
        else if (t < TL.PULL) { pp.place(it.S.x, it.S.z, pp.yaw); pp.turn(it.yawS, dt, 10); }
        else if (t < TL.QS) walkTo(pp, it.S.x, it.S.z, it.Qs.x, it.Qs.z, seg01(t, TL.PULL, TL.QS), TL.QS - TL.PULL, dt, it.yawOut, 14);
        else if (t < TL.PLACE) { pp.place(it.Qs.x, it.Qs.z, pp.yaw); pp.turn(it.yawOut, dt, 10); }
        else if (t < TL.QN) walkTo(pp, it.Qs.x, it.Qs.z, it.Qn.x, it.Qn.z, seg01(t, TL.PLACE, TL.QN), TL.QN - TL.PLACE, dt, it.yawOut);
        else if (t < TL.PICK) { pp.place(it.Qn.x, it.Qn.z, pp.yaw); pp.turn(it.yawOut, dt, 10); }
        else if (t < TL.S2) walkTo(pp, it.Qn.x, it.Qn.z, it.S.x, it.S.z, seg01(t, TL.PICK, TL.S2), TL.S2 - TL.PICK, dt, it.yawS, 14);
        else { pp.place(it.S.x, it.S.z, pp.yaw); pp.turn(it.yawS, dt, 10); }
        // ----- crouch / bend
        toC(K, e.home.x, e.home.y, e.home.z, it.hubC);
        it.hubFace.copy(it.hubC).addScaledVector(it.out, e.width / 2 + 0.03);
        const wCr = clamp(win(t, 0.45, 0.7, 1.55, 1.75) + win(t, 3.1, 3.3, 3.85, 4.0), 0, 1);
        const Hs = clamp(it.hubC.y - 0.12, 0.5, 0.9);
        if (wCr > 0.001) pp.squat(lerp(0.97, Hs, wCr), 0);
        const carrying = win(t, TL.PULL, TL.PULL + 0.15, TL.PLACE, TL.PLACE + 0.15) + win(t, TL.PICK - 0.1, TL.PICK + 0.15, TL.MOUNT - 0.05, TL.MOUNT + 0.05);
        pp.bend(0.42 * wCr + 0.16 * clamp(carrying, 0, 1) + 0.05);
        // ----- wheel poses
        const spinOld = 20 * (1 - Math.pow(1 - seg01(t, TL.U0 + 0.05, TL.U1), 2)), spinNew = 20 * (1 - Math.pow(1 - seg01(t, TL.MOUNT, TL.GUN), 2));
        const cfx = Math.sin(pp.yaw), cfz = Math.cos(pp.yaw);
        cw.set(pp.x + cfx * 0.5, 0.98, pp.z + cfz * 0.5);
        if (t >= TL.PULL && !it.mounted) {
          if (t < TL.PLACE) {   // old wheel: hub -> carry
            const k = sstep(seg01(t, TL.PULL, TL.PULL + 0.17));
            wp.set(lerp(it.hubC.x, cw.x, k), lerp(it.hubC.y, cw.y, k), lerp(it.hubC.z, cw.z, k)); setWheel(wheel, wp.x, wp.y, wp.z, it.out.x, 0, it.out.z, 0);
          } else {              // old wheel lowered onto the ground, lying flat
            const k = sstep(seg01(t, TL.PLACE, TL.PLACE + 0.2)), bounce = carBounce(t, TL.PLACE + 0.2, 0.05);
            wp.set(lerp(cw.x, it.Ps.x, k), lerp(cw.y, e.width / 2 + 0.02, k) + bounce, lerp(cw.z, it.Ps.z, k));
            ax.set(it.out.x * (1 - k), k, it.out.z * (1 - k)).normalize(); setWheel(wheel, wp.x, wp.y, wp.z, ax.x, ax.y, ax.z, 0);
          }
        }
        if (!it.mounted) {      // new wheel: stand -> carry -> hub
          if (t < TL.PICK + 0.18) { const k = sstep(seg01(t, TL.QN + 0.1, TL.PICK + 0.18)); wp.set(lerp(it.Pnew.x, cw.x, k), lerp(e.r, cw.y, k), lerp(it.Pnew.z, cw.z, k)); }
          else if (t < TL.S2 - 0.05) wp.copy(cw);
          else { const k = sstep(seg01(t, TL.S2 - 0.05, TL.MOUNT)); hov.copy(it.hubC); wp.set(lerp(cw.x, hov.x, k), lerp(cw.y, hov.y, k), lerp(cw.z, hov.z, k)); }
          setWheel(clone, wp.x, wp.y, wp.z, it.out.x, 0, it.out.z, 0.4 * it.i * (1 - sstep(seg01(t, TL.S2, TL.MOUNT))));
          const gl = it.fxNew.userData.shell.material; gl.opacity = 0.08 + 0.05 * Math.sin(t * 11 + it.i);
        } else {
          clone.rotation.x = spinNew;
          const fxn = it.fxNew.userData; fxn.shell.material.opacity = 0.16 * (1 - sstep(seg01(t, TL.MOUNT, TL.MOUNT + 0.5)));
          fxn.ring.scale.setScalar(Math.max(0.001, 1 - sstep(seg01(t, TL.MOUNT + 0.3, TL.GUN + 0.15))));
        }
        if (!it.detached) wheel.rotation.x = spinOld;
        // ----- gun
        const wAct = clamp(win(t, 0.4, 0.55, 1.6, 1.72) + win(t, 3.1, 3.22, 3.85, 3.97), 0, 1);
        const wHub = clamp(win(t, 1.0, 1.1, 1.62, 1.7) + win(t, 3.42, 3.5, 3.85, 3.92), 0, 1);
        pp.torsoPoint(-0.13, 0.22, 0.34, chest); pp.torsoPoint(-0.2, 0.0, 0.05, hip);
        tmp.copy(it.hubFace).addScaledVector(it.out, 0.135 + 0.012 * Math.sin(t * 60) * (wHub > 0.8 ? 1 : 0));
        mix3(chest, tmp, wHub, gOr); mix3(hip, gOr, wAct, gOr);
        gDir.subVectors(it.hubFace, gOr).normalize(); tmp2.set(0.1, -1, 0.2).normalize(); mix3(tmp2, gDir, wAct, gDir).normalize();
        gun.position.copy(gOr); orient(gun, gDir.x, gDir.y, gDir.z, 0, 1, 0);
        it.gunning = wHub > 0.85 && ((t > TL.U0 + 0.05 && t < TL.U1) || (t > TL.MOUNT && t < TL.GUN));
        // ----- gaze + hands
        pp.look(it.hubFace.x, it.hubFace.y, it.hubFace.z);
        if (wAct > 0.2 || (carrying < 0.2 && t < TL.GUN)) {
          P2C(gun, 0, -0.1, -0.06, hd1); P2C(gun, 0, 0.045, 0.05, hd2);
          pp.reach(1, hd1.x, hd1.y, hd1.z); pp.reach(0, hd2.x, hd2.y, hd2.z);
        } else if (carrying >= 0.2 && t < TL.GUN) {
          const wr = e.r * 0.86, cx = (t >= TL.PICK - 0.1 && !it.mounted) ? clone.position : wheel.position;
          const lv = _v1.set(Math.cos(pp.yaw), 0, -Math.sin(pp.yaw)), s = Math.sign(latC.dot(lv)) || 1;
          hd1.copy(cx).addScaledVector(latC, wr * s); hd2.copy(cx).addScaledVector(latC, -wr * s);
          pp.reach(0, hd1.x, hd1.y, hd1.z); pp.reach(1, hd2.x, hd2.y, hd2.z);
        } else if (t >= TL.GUN) {
          const k = sstep(seg01(t, TL.GUN, TL.GUN + 0.2)); pp.reachLocal(1, -0.24, lerp(0.35, 1.0, k), 0.12);
        }
      } }]);
    });
    // ---- global step
    let lastL = 0;
    svc.step = (t, dt) => {
      const L = LMAX * (sstep(seg01(t, TL.up0, TL.up1)) - sstep(seg01(t, TL.dn0, TL.dn1))) + carBounce(t, TL.dn1, 0.025);
      veh.bodyGroup.position.y = baseY + L; K.lift = L; lastL = L;
      jacks.step(t, dt, Math.max(0, L - 0.0));
      for (const it of items) {
        if (!it.detached && t >= TL.PULL) { it.detached = true; C.content.attach(it.e.w); }
        if (!it.mounted && t >= TL.MOUNT) {
          it.mounted = true; const e = it.e; e.parent0.add(it.clone); it.clone.position.copy(e.pos0); it.clone.quaternion.identity(); it.clone.scale.set(1, 1, 1);
        }
      }
    };
    const flashed = items.map(() => false), placed = items.map(() => false);
    svc.post = (t, dt) => {
      for (const it of items) {
        if (it.gunning && dt > 0) {
          it.spark += dt * 150;
          while (it.spark >= 1) {
            it.spark -= 1; const s = rnd(1.2, 3.2);
            fx.spark(it.hubFace.x + rnd(-0.07, 0.07), it.hubFace.y + rnd(-0.07, 0.07), it.hubFace.z + rnd(-0.07, 0.07), it.out.x * s + rnd(-1, 1), rnd(0.2, 2.6), it.out.z * s + rnd(-1, 1), rnd(0.25, 0.5), 0.028, Math.random() < 0.3 ? 0xffffff : 0xffb14a, 5);
          }
        }
        if (!placed[it.i] && t >= TL.PLACE + 0.18) { placed[it.i] = true; for (let k = 0; k < 4; k++) fx.puff(it.Ps.x + rnd(-0.4, 0.4), 0.1, it.Ps.z + rnd(-0.4, 0.4), rnd(-0.3, 0.3), rnd(0.2, 0.5), rnd(-0.3, 0.3), rnd(0.5, 0.8), 0.18, 3.2, 0.78); }
        if (!flashed[it.i] && t >= TL.MOUNT) { flashed[it.i] = true; fx.glow(it.hubFace.x, it.hubFace.y, it.hubFace.z, 0, 0, 0, 0.4, 0.9, 0xa8ecff); fx.burst(it.hubFace.x, it.hubFace.y, it.hubFace.z, 10, 2.0, 0xffe27a, it.out.x, 0.1, it.out.z, 1.2); }
      }
    };
    svc.undo.push(() => {
      for (const it of items) {
        const e = it.e, w = e.w;
        if (it.clone.parent) it.clone.parent.remove(it.clone);
        it.fxNew.userData.shell.material.dispose();
        w.remove(it.nutOld);
        e.parent0.add(w); w.position.copy(e.pos0); w.rotation.set(0, 0, 0); w.quaternion.identity(); w.scale.set(1, 1, 1);
      }
      veh.bodyGroup.position.y = baseY;
      if (hasFlat) { veh.setFlatTires(false); veh.bodyGroup.position.y = baseY; }
      P.guns.forEach((g) => { g.visible = false; });
    });
    return svc;
  }

  // ======================================================= more garage props
  function texPlate() {
    if (TEX.plate) return TEX.plate;
    return (TEX.plate = canvasTex(256, 128, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#e8f1f7'); g.addColorStop(0.5, '#9fb2c0'); g.addColorStop(1, '#d9e4ec'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(30,140,200,0.85)'; c.lineWidth = 3; const R = 14, hh = R * Math.sqrt(3);
      for (let row = -1; row < h / hh + 1; row++) for (let col = -1; col < w / (R * 1.5) + 1; col++) { const cx = col * R * 1.5, cy = row * hh + (col % 2 ? hh / 2 : 0); c.beginPath(); for (let k = 0; k < 6; k++) { const a = k * PI / 3; const px = cx + R * Math.cos(a), py = cy + R * Math.sin(a); k ? c.lineTo(px, py) : c.moveTo(px, py); } c.closePath(); c.stroke(); }
      c.strokeStyle = '#1b55c4'; c.lineWidth = 10; c.strokeRect(2, 2, w - 4, h - 4);
    }));
  }
  class HelixCurve extends T.Curve {
    constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
    getPoint(t, target) { const a = t * this.turns * TAU; return (target || new T.Vector3()).set(Math.cos(a) * this.r, -this.h / 2 + t * this.h, Math.sin(a) * this.r); }
  }
  const low2 = (m) => (isLow() ? new T.MeshLambertMaterial({ map: m.map, side: m.side }) : m);
  function buildGarageProps2(C) {
    const M = mats(), pg = propGeos(), P = C.P, con = C.content, g = geos();
    // hatch (turbo): dark tray + lid (hinged at the rear edge), unit size 0.58 x 0.62
    const hg = new T.Group();
    { const b = new GB(); BX(b, 0x0c0e11, 0, 0, 0, 0.58, 0.07, 0.62); BX(b, 0x9aa0a8, 0, 0.06, 0.315, 0.62, 0.025, 0.03); BX(b, 0x9aa0a8, 0, 0.06, -0.315, 0.62, 0.025, 0.03); BX(b, 0x9aa0a8, 0.295, 0.06, 0, 0.03, 0.025, 0.62); BX(b, 0x9aa0a8, -0.295, 0.06, 0, 0.03, 0.025, 0.62);
      hg.add(new T.Mesh(b.build(), M.metal)); }
    const hglow = new T.Mesh(g.quad, new T.MeshBasicMaterial({ color: 0x38d8ff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })); hglow.rotation.x = -PI / 2; hglow.position.y = 0.075; hglow.scale.set(0.5, 0.54, 1); hg.add(hglow);
    const lidMat = solidMat(0xdddddd, { metalness: 0.3, roughness: 0.3 });
    const pivot = new T.Group(); pivot.position.set(0, 0.085, -0.31); hg.add(pivot);
    const lid = new T.Mesh(g.box, lidMat); lid.scale.set(0.6, 0.035, 0.64); lid.position.set(0, 0.0, 0.32); pivot.add(lid);
    P.hatch = { grp: hg, pivot, lidMat, glow: hglow };
    // crane
    const cg = new T.Group(); propMesh(pg.crane, M.paint, cg); cg.visible = false; con.add(cg);
    const chain = new T.Mesh(g.cyl, M.steel); chain.scale.set(0.012, 1, 0.012); con.add(chain); chain.visible = false;
    const hook = new T.Mesh(g.box, M.metal); hook.scale.set(0.08, 0.1, 0.06); hook.visible = false; con.add(hook);
    P.crane = { grp: cg, chain, hook };
    // turbo unit
    const tg = new T.Group(); propMesh(pg.turbo, M.metal, tg);
    const core = new T.Mesh(g.sph, new T.MeshBasicMaterial({ color: 0x4fe6ff })); core.scale.set(0.07, 0.07, 0.07); tg.add(core);
    const tglow = glowSprite(0x38d8ff, 0.9); tg.add(tglow); tg.visible = false; con.add(tg);
    P.turbo = { grp: tg, core, glow: tglow };
    // creepers + torch + coilovers
    P.creepers = [0, 1].map(() => { const c = new T.Group(); propMesh(pg.creeper, M.paint, c); c.visible = false; con.add(c); return c; });
    const tr = new T.Group(); propMesh(pg.torch, M.paint, tr); const tglo = glowSprite(0xa8e8ff, 0.5); tglo.position.set(0, 0, 0.22); tr.add(tglo); tr.visible = false; con.add(tr); P.torch = { grp: tr, glow: tglo };
    const hel = new T.TubeGeometry(new HelixCurve(0.07, 0.34, 6), 72, 0.012, 5, false);
    P.coils = [0, 1].map(() => { const c = new T.Group(); const sp = new T.Mesh(hel, solidMat(0xe23a2c, { metalness: 0.5, roughness: 0.3 })); c.add(sp); const dm = new T.Mesh(g.cyl, solidMat(0xe5b800, { metalness: 0.8, roughness: 0.25 })); dm.scale.set(0.022, 0.5, 0.022); c.add(dm); c.visible = false; con.add(c); return c; });
    // shield plates + dome
    const pgeo = new T.PlaneGeometry(1, 1, 14, 1); { const pa = pgeo.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i); pa.setZ(i, 0.55 * x * x); } pgeo.computeVertexNormals(); }
    const plateMat = low2(new T.MeshStandardMaterial({ map: texPlate(), side: T.DoubleSide, metalness: 0.7, roughness: 0.3, emissive: 0x1a90d0, emissiveIntensity: 0.0, envMapIntensity: 0.6 }));
    P.plateMat = plateMat;
    P.plates = [0, 1, 2].map(() => { const m = new T.Mesh(pgeo, plateMat); m.visible = false; con.add(m); return m; });
    P.dome = new T.Mesh(new T.SphereGeometry(1, 28, 16), new T.MeshBasicMaterial({ map: hexTex(), color: 0xbff4ff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }));
    P.dome.visible = false; P.dome.renderOrder = 7; con.add(P.dome);
    P.ring = new T.Mesh(new T.TorusGeometry(1, 0.04, 8, 36), new T.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false })); P.ring.rotation.x = PI / 2; P.ring.visible = false; con.add(P.ring);
  }

  // ============================================================ SERVICE: TURBO
  function svcTurbo(C, K) {
    const veh = K.veh, P = C.P, R = C.R, fx = C.fx, A = R.mechA, B = R.mechB, S = R.support;
    const D = 4.0, V3 = () => new T.Vector3();
    const svc = { kind: 'turbo', D, undo: [], actors: [A, B, S] };
    const dk = K.deck, sc = K.bike ? 0.6 : 1.0, H = P.hatch, CR = P.crane, TB = P.turbo, guns = P.guns;
    // hatch on the deck (child of the car; removed afterwards)
    H.lidMat.color.copy(K.paint); H.grp.scale.setScalar(sc * 0.97); H.grp.position.copy(dk.p);
    { const n = dk.n.clone().normalize(), z = new T.Vector3(0, 0, 1).addScaledVector(n, -n.z).normalize(); orient(H.grp, z.x, z.y, z.z, n.x, n.y, n.z); }
    veh.bodyGroup.add(H.grp); H.pivot.rotation.x = 0; H.glow.material.opacity = 0;
    const deckC = toC(K, dk.p.x, dk.p.y, dk.p.z, V3()), nC = dirC(K, dk.n.x, dk.n.y, dk.n.z, V3()).normalize();
    const f = dirC(K, 0, 0, -1, V3()), lat = dirC(K, 1, 0, 0, V3());     // f = boom direction (from the crane in front toward the car)
    const mastEnd = V3().set(deckC.x - f.x * 1.52, 0, deckC.z - f.z * 1.52), mastStart = V3().set(mastEnd.x - f.x * 1.9, 0, mastEnd.z - f.z * 1.9);
    CR.grp.visible = true; CR.chain.visible = true; CR.hook.visible = true; CR.grp.rotation.y = Math.atan2(-f.z, f.x); TB.grp.visible = true; TB.grp.scale.setScalar(sc);
    const cranePos = V3(), hookP = V3(), seatY = deckC.y + 0.22 * sc + 0.1;
    const craneAt = (t) => mix3(mastStart, mastEnd, sstep(seg01(t, 0.0, 0.6)), cranePos);
    const hookAt = (t, out) => {
      const kA = sstep(seg01(t, 1.05, 1.75)), kB = sstep(seg01(t, 1.75, 2.85));
      const hx = lerp(0.3, 1.5, kA), hy = lerp(1.5, 1.88, kA) - (1.88 - (seatY + 0.4 * sc)) * kB;
      const cp = craneAt(t); return out.set(cp.x + f.x * hx, hy, cp.z + f.z * hx);
    };
    const S0 = { x: S.x, z: S.z }, A0 = { x: A.x, z: A.z }, B0 = { x: B.x, z: B.z };
    const yawF = Math.atan2(f.x, f.z);
    const supM = V3().set(mastEnd.x + lat.x * 0.85 + f.x * 0.25, 0, mastEnd.z + lat.z * 0.85 + f.z * 0.25);
    const halfW = Math.max(0.9, K.halfW);
    const bPos = V3().set(deckC.x + lat.x * (halfW + 0.5 - 0.34), 0, deckC.z + lat.z * (halfW + 0.5 - 0.34)), yawB = Math.atan2(-lat.x, -lat.z);
    const tmp = V3(), tmp2 = V3(), hd = V3(), uPos = V3();
    const unit = TB.grp;
    // support man: carry the unit to the mast, hook it
    S.setScript([{ a: 0, b: D, fn: (u, t, dt, p) => {
      if (t < 0.6) walkTo(p, S0.x, S0.z, supM.x, supM.z, seg01(t, 0, 0.6), 0.6, dt, yawF); else { p.place(supM.x, supM.z, p.yaw); p.turn(yawF, dt, 9); }
      p.bend(0.14);
      if (t <= 1.05) {
        p.torsoPoint(0, 0.3, 0.4, tmp); hookAt(1.04, tmp2); tmp2.y -= 0.4 * sc;
        const k = sstep(seg01(t, 0.6, 1.05)); mix3(tmp, tmp2, k, uPos); unit.position.copy(uPos);
      } else { hookAt(t, tmp); unit.position.set(tmp.x, tmp.y - 0.4 * sc, tmp.z); }
      unit.rotation.set(0, K.yaw, 0);
      p.look(unit.position.x, unit.position.y, unit.position.z);
      if (t < 1.1) { p.reach(0, unit.position.x + lat.x * 0.22, unit.position.y, unit.position.z + lat.z * 0.22); p.reach(1, unit.position.x - lat.x * 0.22, unit.position.y, unit.position.z - lat.z * 0.22); }
      else {
        const k = win(t, 1.05, 1.2, 1.7, 1.9);
        p.torsoPoint(0.26, 0.05, 0.14, tmp2); mix3(tmp2, tmp.set(mastEnd.x + f.x * 0.2, 1.3, mastEnd.z + f.z * 0.2), k, tmp2);
        p.reach(0, tmp2.x, tmp2.y, tmp2.z);
        const up = sstep(seg01(t, 3.2, 3.4));
        p.reachLocal(1, -0.24, lerp(0.15, 1.0, up), 0.12 + 0.1 * (1 - up));
      }
    } }]);
    // mech A: push the crane in, work the hoist lever, then retreat
    A.setScript([{ a: 0, b: D, fn: (u, t, dt, p) => {
      craneAt(t);
      const ox = cranePos.x - f.x * 0.8, oz = cranePos.z - f.z * 0.8;
      if (t < 0.6) { const kk = sstep(seg01(t, 0, 0.6)); p.place(lerp(A0.x, ox, kk), lerp(A0.z, oz, kk), p.yaw); p.stride(kk * 7, kk < 1 && kk > 0 ? 1.2 : 0); }
      else p.place(ox, oz, p.yaw);
      p.turn(yawF, dt, 10); p.bend(0.2);
      const lever = 1.0 + 0.1 * Math.sin(t * 9) * win(t, 1.0, 1.2, 2.8, 3.0);
      p.reach(0, cranePos.x - f.x * 0.15 + lat.x * 0.12, lever, cranePos.z - f.z * 0.15 + lat.z * 0.12); p.reach(1, cranePos.x - f.x * 0.15 - lat.x * 0.12, lever + 0.05, cranePos.z - f.z * 0.15 - lat.z * 0.12);
      p.look(deckC.x, deckC.y, deckC.z);
      if (t > 3.3) { p.reachLocal(0, 0.24, 1.0, 0.1); p.reachLocal(1, -0.24, 1.0, 0.1); }
    } }]);
    // mech B: open the lid, guide the unit, tighten the clamps, close
    const gun = guns[4]; gun.visible = true;
    B.setScript([{ a: 0, b: D, fn: (u, t, dt, p) => {
      if (t < 0.6) walkTo(p, B0.x, B0.z, bPos.x, bPos.z, seg01(t, 0, 0.6), 0.6, dt, yawB); else { p.place(bPos.x, bPos.z, p.yaw); p.turn(yawB, dt, 10); }
      p.squat(0.9); p.bend(0.42 + 0.06 * Math.sin(t * 3));
      tmp.copy(deckC).addScaledVector(nC, 0.1 * sc); p.look(tmp.x, tmp.y, tmp.z);
      const wOpen = win(t, 0.5, 0.65, 1.0, 1.15), wClose = win(t, 3.0, 3.1, 3.55, 3.7), wGuide = win(t, 1.2, 1.5, 2.65, 2.8), wTight = win(t, 2.7, 2.85, 3.0, 3.1);
      const lidP = tmp2.copy(deckC).addScaledVector(f, -0.3 * sc).addScaledVector(nC, 0.12 * sc).addScaledVector(lat, 0.12);
      p.torsoPoint(0.25, 0.05, 0.14, hd);
      mix3(hd, lidP, Math.max(wOpen, wClose), hd);
      mix3(hd, tmp.copy(unit.position).addScaledVector(lat, 0.2 * sc), wGuide, hd);
      p.reach(0, hd.x, hd.y, hd.z);
      p.torsoPoint(-0.2, 0.0, 0.05, tmp); gun.position.copy(tmp); orient(gun, 0, -1, 0.2, 0, 0, 1);
      _v1.copy(unit.position).addScaledVector(lat, 0.2 * sc);
      mix3(tmp, _v1, wTight, tmp); gun.position.copy(tmp); if (wTight > 0.3) orient(gun, -lat.x, -0.2, -lat.z, 0, 1, 0);
      P2C(gun, 0, -0.1, -0.06, tmp2);
      if (wTight > 0.2) p.reach(1, tmp2.x, tmp2.y, tmp2.z);
      else { p.torsoPoint(-0.26, 0.05, 0.14, tmp2); _v1.copy(unit.position).addScaledVector(lat, 0.05 * sc); mix3(tmp2, _v1, wGuide, tmp2); mix3(tmp2, lidP, Math.max(wOpen, wClose), tmp2); p.reach(1, tmp2.x, tmp2.y, tmp2.z); }
    } }]);
    // global step
    svc.step = (t, dt) => {
      craneAt(t); CR.grp.position.set(cranePos.x, 0, cranePos.z);
      hookAt(t, hookP);
      CR.hook.position.copy(hookP); CR.hook.rotation.y = K.yaw;
      const top = 2.08; CR.chain.position.set(hookP.x, (top + hookP.y) / 2, hookP.z); CR.chain.scale.set(0.012, Math.max(0.05, top - hookP.y), 0.012);
      if (t > 1.05) unit.position.set(hookP.x, hookP.y - 0.4 * sc, hookP.z);
      H.pivot.rotation.x = -1.3 * win(t, 0.55, 1.05, 3.05, 3.55);
      const seated = t > 2.85, pulse = 0.5 + 0.5 * Math.sin(t * 16), near = sstep(seg01(t, 2.3, 2.85));
      H.glow.material.opacity = (near * 0.55 + (seated ? 0.35 * pulse : 0)) * (1 - sstep(seg01(t, 3.2, 3.7)));
      TB.core.material.color.setRGB(0.3 + 0.4 * pulse * near, 0.85, 1.0); TB.glow.material.opacity = 0.3 + 0.5 * near * (0.6 + 0.4 * pulse); TB.glow.scale.setScalar((0.55 + 0.5 * near + 0.25 * pulse * near) * sc * 1.2);
      TB.grp.visible = t < 3.3;
    };
    const fl = [false, false]; let acc = 0;
    svc.post = (t, dt) => {
      if (t > 2.7 && t < 3.05 && dt > 0) { acc += dt * 120; while (acc >= 1) { acc -= 1; _v1.copy(unit.position).addScaledVector(lat, 0.2 * sc); const s = rnd(1, 3); fx.spark(_v1.x, _v1.y, _v1.z, lat.x * s + rnd(-1, 1), rnd(0.3, 2.5), lat.z * s + rnd(-1, 1), rnd(0.25, 0.5), 0.026, Math.random() < 0.4 ? 0xffffff : 0xffb14a, 5); } }
      if (!fl[0] && t >= 2.85) { fl[0] = true; fx.glow(deckC.x, deckC.y + 0.2, deckC.z, 0, 0, 0, 0.5, 1.0, 0x5fe4ff); }
      if (!fl[1] && t >= 3.55) { fl[1] = true; P.ring.visible = true; for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; fx.spark(deckC.x, deckC.y + 0.2, deckC.z, Math.cos(a) * 2.6, rnd(0.5, 2), Math.sin(a) * 2.6, rnd(0.4, 0.7), 0.03, 0x7fe9ff, 2); } }
      if (P.ring.visible) { const k = seg01(t, 3.55, 4.0); P.ring.position.set(deckC.x, deckC.y + 0.25, deckC.z); P.ring.scale.setScalar(0.3 + k * 2.4); P.ring.material.opacity = 0.9 * (1 - k); }
    };
    svc.undo.push(() => {
      veh.bodyGroup.remove(H.grp); H.pivot.rotation.x = 0; H.glow.material.opacity = 0;
      CR.grp.visible = false; CR.chain.visible = false; CR.hook.visible = false; TB.grp.visible = false; P.ring.visible = false; gun.visible = false;
    });
    return svc;
  }

  // ======================================================== SERVICE: SUSPENSION
  function svcSuspension(C, K) {
    const veh = K.veh, P = C.P, R = C.R, fx = C.fx, A = R.mechA, B = R.mechB, Ch = R.chief;
    const D = 4.0, LMAX = 0.42, V3 = () => new T.Vector3();
    const TL = { in0: 0, in1: 0.4, up0: 0.35, up1: 0.85, dn0: 3.0, dn1: 3.4 };
    const svc = { kind: 'suspension', D, undo: [], actors: [A, B, Ch] };
    const baseY = veh.bodyGroup.position.y;
    const jacks = setupJacks(C, K, svc, TL);
    const lat = dirC(K, 1, 0, 0, V3());
    const zs = [K.frontZ - 0.15, K.rearZ + 0.15], sides = [1, -1];
    const cr = P.creepers, torch = P.torch, coils = P.coils, gun = P.guns[5]; gun.visible = true;
    const mech = [A, B], starts = mech.map((p) => ({ x: p.x, z: p.z }));
    const tmp = V3(), tmp2 = V3(), hd = V3(), chest = V3();
    mech.forEach((p, i) => {
      const sd = sides[i], zc = zs[i], c = cr[i]; coils[i].visible = false; const txv = V3();
      const yawL = (sd > 0 ? PI / 2 : -PI / 2) + K.yaw;
      const startC = toC(K, sd * 3.6, 0, zc, V3());
      const hipX = (t) => lerp(3.4, 1.55, sstep(seg01(t, 0.95, 1.5))) + 1.9 * sstep(seg01(t, 2.5, 3.0));
      p.setScript([{ a: 0, b: D, fn: (u, t, dt, pp) => {
        const lie = win(t, 0.55, 0.9, 3.0, 3.2);
        if (t < 0.7) walkTo(pp, starts[i].x, starts[i].z, startC.x, startC.z, seg01(t, 0, 0.7), 0.7, dt, yawL);
        else { toC(K, sd * (t < 3.0 ? hipX(t) : hipX(3.0) + 1.0 * sstep(seg01(t, 3.0, 3.4))), 0, zc, tmp); pp.place(tmp.x, tmp.z, pp.yaw); pp.turn(t > 3.25 ? PI + K.yaw : yawL, dt, 12); }
        if (lie > 0.02) { pp.lieOnBack(0.2); pp.body.rotation.x = -PI / 2 * lie; pp.body.position.y = 0.2 * lie; pp.body.position.z = HIP_Y * pp.body.scale.x * lie; }
        c.position.set(pp.x, 0, pp.z); c.rotation.y = (sd > 0 ? 0 : PI) + K.yaw; c.visible = lie > 0.05 || t < 0.5;
        if (t < 0.5) c.position.copy(startC);
        pp.torsoPoint(0, 0.3, 0.1, chest);
        const work = win(t, 1.4, 1.6, 2.4, 2.55);
        const tx = toC(K, sd * 0.85, K.clear + LMAX - 0.05, zc + Math.sin(t * 6 + i) * 0.1 * work, txv);
        if (lie > 0.5) {
          pp.look(tx.x, tx.y, tx.z);
          if (i === 0) {
            torch.grp.position.set(tx.x, tx.y - 0.22, tx.z); orient(torch.grp, 0, 1, 0, 0, 0, 1);
            torch.grp.visible = work > 0.05; torch.glow.visible = work > 0.05;
            P2C(torch.grp, 0, 0, -0.1, hd); pp.reach(1, hd.x, hd.y, hd.z); pp.reach(0, hd.x + lat.x * 0.15, hd.y, hd.z + lat.z * 0.15);
          } else {
            gun.position.set(tx.x, tx.y - 0.2, tx.z); orient(gun, 0, 1, 0, 1, 0, 0); gun.visible = true;
            P2C(gun, 0, -0.1, -0.06, hd); pp.reach(1, hd.x, hd.y, hd.z); P2C(gun, 0, 0.04, 0.05, tmp2); pp.reach(0, tmp2.x, tmp2.y, tmp2.z);
          }
          const cl = coils[i], showC = t > 1.45 && t < 2.35;
          cl.visible = showC; if (showC) { const k = sstep(seg01(t, 1.5, 2.3)); cl.position.set(lerp(chest.x, tx.x, k), lerp(chest.y + 0.12, tx.y - 0.1, k), lerp(chest.z, tx.z, k)); }
        } else if (t > 3.2) { pp.reachLocal(1, -0.24, 1.0, 0.12); pp.reachLocal(0, 0.24, 1.0, 0.12); }
      } }]);
    });
    // chief: checks the tablet beside the car, thumbs up at the end
    const cs = { x: Ch.x, z: Ch.z }, chP = toC(K, 2.9, 0, 0.4, V3());
    Ch.setScript([{ a: 0, b: D, fn: (u, t, dt, p) => {
      if (t < 0.7) walkTo(p, cs.x, cs.z, chP.x, chP.z, seg01(t, 0, 0.7), 0.7, dt, K.yaw - PI / 2); else { p.place(chP.x, chP.z, p.yaw); p.turn(K.yaw - PI / 2, dt, 9); }
      p.bend(0.08); p.look(K.x, 0.9, K.z + 0.5 * Math.sin(t * 2));
      if (t < 3.45) { p.reachLocal(1, -0.12, 0.3, 0.3); p.reachLocal(0, 0.14, 0.34, 0.26); }
      else { p.reachLocal(1, -0.22, 1.0, 0.3); p.reachLocal(0, 0.24, 0.05, 0.14); }
      if (t > 3.5) { P.bubble.visible = true; p.torsoPoint(0, 1.5, 0, tmp); P.bubble.position.copy(tmp); const s = 0.8 * easeOutBack(seg01(t, 3.5, 3.75)); P.bubble.scale.set(s, s, 1); }
    } }]);
    svc.step = (t, dt) => {
      const L = LMAX * (sstep(seg01(t, TL.up0, TL.up1)) - sstep(seg01(t, TL.dn0, TL.dn1))) + carBounce(t, TL.dn1, 0.045) + carBounce(t, TL.dn1 + 0.35, 0.02);
      veh.bodyGroup.position.y = baseY + L; K.lift = L;
      jacks.step(t, dt, Math.max(0, L));
    };
    let acc = 0, acc2 = 0, ek = false; const tAv = V3(), tBv = V3();
    svc.post = (t, dt) => {
      const work = win(t, 1.4, 1.6, 2.4, 2.55);
      if (work > 0.5 && dt > 0) {
        acc += dt * 90; acc2 += dt * 110;
        const tA = toC(K, 0.85, K.clear + LMAX - 0.12, zs[0], tAv), tB = toC(K, -0.85, K.clear + LMAX - 0.12, zs[1], tBv);
        while (acc >= 1) { acc -= 1; fx.spark(tA.x + rnd(-0.06, 0.06), tA.y, tA.z + rnd(-0.06, 0.06), rnd(-1.6, 1.6), rnd(-1, 2.4), rnd(-1.6, 1.6), rnd(0.3, 0.6), 0.026, Math.random() < 0.5 ? 0xaee9ff : 0xffffff, 4); }
        while (acc2 >= 1) { acc2 -= 1; fx.spark(tB.x + rnd(-0.06, 0.06), tB.y, tB.z + rnd(-0.06, 0.06), rnd(-1.6, 1.6), rnd(-1, 2.4), rnd(-1.6, 1.6), rnd(0.3, 0.6), 0.026, Math.random() < 0.3 ? 0xffffff : 0xffb14a, 4); }
      }
      if (!ek && t >= 2.4) { ek = true; for (const zc of zs) { const q = toC(K, 0, K.clear + LMAX, zc, V3()); fx.glow(q.x, q.y, q.z, 0, 0, 0, 0.4, 0.8, 0xffe27a); } }
    };
    svc.undo.push(() => {
      veh.bodyGroup.position.y = baseY; cr.forEach((c) => { c.visible = false; }); torch.grp.visible = false; coils.forEach((c) => { c.visible = false; }); gun.visible = false; P.bubble.visible = false;
      mech.forEach((p) => { p.body.rotation.set(0, 0, 0); p.body.position.set(0, 0, 0); });
    });
    return svc;
  }

  // ============================================================ SERVICE: SHIELD
  function svcShield(C, K) {
    const veh = K.veh, P = C.P, R = C.R, fx = C.fx, V3 = () => new T.Vector3();
    const D = 3.7;
    const w0 = R.wheel0, w1 = R.wheel1, w2 = R.wheel2, w3 = R.wheel3, mA = R.mechA, mB = R.mechB;
    const svc = { kind: 'shield', D, undo: [], actors: [w0, w1, w2, w3, mA, mB] };
    const f = dirC(K, 0, 0, 1, V3()), lat = dirC(K, 1, 0, 0, V3());
    const guns = P.guns, pl = P.plates, tmp = V3(), tmp2 = V3(), hd = V3(), hd2 = V3();
    const plW = Math.max(0.6, K.halfW * 2 * 0.98 + 0.1), plY = K.bike ? 0.75 : 0.62, plH = K.bike ? 0.55 : 0.5;
    const noseC = toC(K, 0, 0, K.noseZ + 0.2, V3());
    pl[0].visible = true; pl[0].scale.set(plW, plH, 1);
    const sideW = 0.9, sideH = K.bike ? 0.5 : 0.48;
    pl[1].visible = !K.bike; pl[2].visible = !K.bike; pl[1].scale.set(sideW, sideH, 1); pl[2].scale.set(sideW, sideH, 1);
    P.plateMat.emissiveIntensity = 0; P.dome.visible = true; P.dome.material.opacity = 0;
    guns.slice(0, 4).forEach((g) => { g.visible = true; });
    const homes = [w0, w1, w2, w3, mA, mB].map((p) => ({ x: p.x, z: p.z }));
    const fp = V3();
    const frontBase = V3().copy(noseC); frontBase.y = plY;
    const frontStart = V3().copy(noseC).addScaledVector(f, 1.5).addScaledVector(lat, 3.4); frontStart.y = 0.95;
    const sideBase = [toC(K, K.halfW + 0.12, 0, K.frontZ - 0.1, V3()), toC(K, -K.halfW - 0.12, 0, K.frontZ - 0.1, V3())];
    sideBase.forEach((v) => { v.y = plY + 0.1; });
    const sideStart = [V3().copy(sideBase[0]).addScaledVector(lat, 2.2), V3().copy(sideBase[1]).addScaledVector(lat, -1.8)];
    const yawToCar = (px, pz) => Math.atan2(K.x - px, K.z - pz);
    [w0, w1].forEach((p, i) => {
      const sd = i === 0 ? 1 : -1, st = homes[i];
      p.setScript([{ a: 0, b: D, fn: (u, t, dt, pp) => {
        const k = sstep(seg01(t, 0.05, 0.95));
        fp.set(lerp(frontStart.x, frontBase.x, k), lerp(frontStart.y, frontBase.y, k), lerp(frontStart.z, frontBase.z, k));
        const endX = frontBase.x + lat.x * sd * (plW / 2 - 0.05) + f.x * 0.55, endZ = frontBase.z + lat.z * sd * (plW / 2 - 0.05) + f.z * 0.55;
        const sx = frontStart.x + lat.x * sd * (plW / 2 - 0.05) + f.x * 0.55, sz = frontStart.z + lat.z * sd * (plW / 2 - 0.05) + f.z * 0.55;
        const kk = sstep(seg01(t, 0.0, 0.3));
        const bx = lerp(st.x, sx, kk), bz = lerp(st.z, sz, kk);
        const px = lerp(bx, endX, k), pz = lerp(bz, endZ, k);
        pp.place(px, pz, pp.yaw); pp.turn(yawToCar(px, pz), dt, 10);
        if ((k > 0 && k < 1) || (kk > 0 && kk < 1)) pp.stride((kk + k) * 6, 1.25);
        pp.bend(0.12); pp.look(fp.x, fp.y, fp.z);
        const hdx = fp.x + lat.x * sd * (plW / 2 - 0.12), hdz = fp.z + lat.z * sd * (plW / 2 - 0.12);
        pp.reach(1, hdx + f.x * 0.1, fp.y - 0.1, hdz + f.z * 0.1); pp.reach(0, hdx + f.x * 0.1, fp.y + 0.12, hdz + f.z * 0.1);
        if (t > 3.0) { pp.reachLocal(1, -0.24, 1.0, 0.1); pp.reachLocal(0, 0.24, 1.0, 0.1); }
        if (i === 0) { pl[0].position.copy(fp); orient(pl[0], -f.x, 0, -f.z, 0, 1, 0); }
      } }]);
    });
    [w2, w3].forEach((p, i) => {
      const sd = i === 0 ? 1 : -1, st = homes[2 + i], gun = guns[i];
      p.userData = { work: 0, bolt: V3() };
      p.setScript([{ a: 0, b: D, fn: (u, t, dt, pp) => {
        const tgt = tmp.copy(frontBase).addScaledVector(lat, sd * (plW / 2 + 0.55)).addScaledVector(f, 0.95);
        const k = sstep(seg01(t, 0.15, 0.9));
        const px = lerp(st.x, tgt.x, k), pz = lerp(st.z, tgt.z, k);
        pp.place(px, pz, pp.yaw); pp.turn(yawToCar(px, pz), dt, 10); if (k < 1 && k > 0) pp.stride(k * 6, 1.2);
        const work = win(t, 0.9, 1.0, 2.25, 2.4);
        pp.squat(lerp(0.97, 0.78, sstep(seg01(t, 0.7, 1.0)) * (1 - sstep(seg01(t, 2.35, 2.55))))); pp.bend(0.3 * work);
        const bolt = p.userData.bolt.copy(frontBase).addScaledVector(lat, sd * (plW / 2 - 0.08)).addScaledVector(f, 0.12); bolt.y = plY + (i ? 0.1 : -0.08);
        pp.torsoPoint(-0.13, 0.22, 0.34, tmp2); hd.copy(bolt).addScaledVector(f, 0.15);
        mix3(tmp2, hd, work, tmp2); gun.position.copy(tmp2); tmp.subVectors(bolt, tmp2).normalize(); orient(gun, tmp.x, tmp.y, tmp.z, 0, 1, 0);
        pp.look(bolt.x, bolt.y, bolt.z);
        P2C(gun, 0, -0.1, -0.06, hd2); pp.reach(1, hd2.x, hd2.y, hd2.z); P2C(gun, 0, 0.045, 0.05, hd2); pp.reach(0, hd2.x, hd2.y, hd2.z);
        if (t > 3.0) { pp.reachLocal(1, -0.24, 1.0, 0.1); pp.reachLocal(0, 0.24, 1.0, 0.1); }
        p.userData.work = work;
      } }]);
    });
    [mA, mB].forEach((p, i) => {
      const sd = i === 0 ? 1 : -1, st = homes[4 + i], plate = pl[1 + i], gun = guns[2 + i];
      p.setScript([{ a: 0, b: D, fn: (u, t, dt, pp) => {
        const k = sstep(seg01(t, 0.1, 0.9));
        const ppos = tmp.set(lerp(sideStart[i].x, sideBase[i].x, k), lerp(0.95, sideBase[i].y, k), lerp(sideStart[i].z, sideBase[i].z, k));
        plate.position.copy(ppos); orient(plate, -lat.x * sd, 0, -lat.z * sd, 0, 1, 0);
        const bx = ppos.x + lat.x * sd * 0.65, bz = ppos.z + lat.z * sd * 0.65;
        const px = lerp(st.x, bx, k), pz = lerp(st.z, bz, k);
        pp.place(px, pz, pp.yaw); pp.turn(yawToCar(px, pz), dt, 10); if (k < 1 && k > 0) pp.stride(k * 6, 1.2);
        pp.bend(0.2);
        const work = win(t, 1.2, 1.3, 2.3, 2.45);
        pp.look(ppos.x, ppos.y, ppos.z);
        pp.torsoPoint(-0.13, 0.22, 0.34, tmp2); hd.copy(ppos).addScaledVector(lat, sd * 0.1).addScaledVector(f, 0.3); mix3(tmp2, hd, work, tmp2);
        gun.position.copy(tmp2); _v1.subVectors(ppos, tmp2); if (_v1.lengthSq() < 1e-4) _v1.set(-lat.x * sd, 0, -lat.z * sd); _v1.normalize(); orient(gun, _v1.x, _v1.y, _v1.z, 0, 1, 0);
        P2C(gun, 0, -0.1, -0.06, hd2);
        if (work > 0.3) { pp.reach(1, hd2.x, hd2.y, hd2.z); P2C(gun, 0, 0.045, 0.05, hd2); pp.reach(0, hd2.x, hd2.y, hd2.z); }
        else { pp.reach(1, ppos.x + lat.x * sd * 0.1 + f.x * 0.05, ppos.y - 0.1, ppos.z + lat.z * sd * 0.1); pp.reach(0, ppos.x + lat.x * sd * 0.1 - f.x * 0.2, ppos.y + 0.1, ppos.z + lat.z * sd * 0.1 - f.z * 0.2); }
        if (t > 3.0) { pp.reachLocal(1, -0.24, 1.0, 0.1); pp.reachLocal(0, 0.24, 1.0, 0.1); }
      } }]);
    });
    svc.step = (t, dt) => {
      P.plateMat.emissiveIntensity = 0.9 * sstep(seg01(t, 2.3, 2.7));
      const s = Math.max(0.001, 1 - sstep(seg01(t, 2.6, 3.0)));
      pl[0].scale.set(plW * s, plH * s, 1); if (!K.bike) { pl[1].scale.set(sideW * s, sideH * s, 1); pl[2].scale.set(sideW * s, sideH * s, 1); }
      const dk = seg01(t, 2.55, 3.55);
      P.dome.position.set(K.x, 0.9 + K.lift, K.z); P.dome.rotation.y = t * 2;
      P.dome.scale.set((K.halfW + 1.2) * (0.6 + dk * 0.8), 1.15 * (0.5 + dk * 0.7), (K.noseZ - K.tailZ) * 0.62 * (0.6 + dk * 0.8));
      P.dome.material.opacity = t > 2.55 ? 0.85 * Math.sin(dk * PI) : 0; P.dome.visible = t > 2.55 && dk < 1;
      if (t >= 3.0) { pl.forEach((m) => { m.visible = false; }); }
    };
    let fl = false, acc = 0;
    svc.post = (t, dt) => {
      [w2, w3].forEach((p) => { const u = p.userData; if (u && u.work > 0.5 && dt > 0) { acc += dt * 70; while (acc >= 1) { acc -= 1; const b = u.bolt; fx.spark(b.x + rnd(-0.05, 0.05), b.y + rnd(-0.05, 0.05), b.z + rnd(-0.05, 0.05), f.x * rnd(1, 3) + rnd(-1, 1), rnd(0, 2.4), f.z * rnd(1, 3) + rnd(-1, 1), rnd(0.25, 0.5), 0.026, Math.random() < 0.35 ? 0xffffff : 0xffb14a, 5); } } });
      if (!fl && t >= 2.6) { fl = true; fx.glow(K.x, 0.9, K.z, 0, 0, 0, 0.5, 1.8, 0x7fe9ff); for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; fx.spark(K.x, 0.7, K.z, Math.cos(a) * 3.4, rnd(0.2, 1.6), Math.sin(a) * 3.4, rnd(0.4, 0.7), 0.03, 0x9ff0ff, 2); } }
    };
    svc.undo.push(() => {
      pl.forEach((m) => { m.visible = false; }); P.plateMat.emissiveIntensity = 0; P.dome.visible = false; P.dome.material.opacity = 0;
      guns.forEach((g) => { g.visible = false; }); [w2, w3].forEach((p) => { if (p.userData) p.userData.work = 0; });
    });
    return svc;
  }

  // ============================================================ FACTORY
  window.pit3DFactory.createStation = function (stationData, track, scene) {
    const st = new Station(stationData, track, scene);
    const ctrl = {
      group: st.group, parkLaneX: st.parkLaneX, parkLocalZ: st.parkLocalZ, station: st,
      update: (dt, focus) => st.update(dt, focus),
      prepare: (veh) => st.prepare(veh),
      startService: (veh, kind, onProgress, onDone) => st.startService(veh, kind, onProgress, onDone),
      cancel: () => st.cancel(),
      cheer: () => st.cheer(),
      release: () => st.release(),
      serviceCamera: (kind, u, camera) => st.serviceCamera(kind, u, camera),
      dispose: () => st.dispose()
    };
    return ctrl;
  };
  window.pit3DFactory.version = 1;
})();
