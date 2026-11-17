// ============================================================================
// APEX OVERDRIVE 3D - AAA Post-Processing (UnrealBloomPass), Game Feel Stack
// (TweenManager, ShakeRig, Hitstop, Squash & Stretch, FOV Punch) & 3D VFX
// Built per threejs-game-director, threejs-gameplay-systems & aaa-graphics
// ============================================================================

const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = t => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

class TweenManager {
  constructor() {
    this.tweens = [];
  }
  tween(durationSec, onUpdate, easing = easeOutCubic, onComplete = null) {
    this.tweens.push({ elapsed: 0, duration: durationSec, easing, onUpdate, onComplete });
  }
  update(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.elapsed += dt;
      const k = Math.min(tw.elapsed / tw.duration, 1);
      tw.onUpdate(tw.easing(k));
      if (tw.elapsed >= tw.duration) {
        if (tw.onComplete) tw.onComplete();
        this.tweens.splice(i, 1);
      }
    }
  }
}

function pseudoNoise(t, seed) {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

class ShakeRig {
  constructor() {
    this.trauma = 0;
    this.time = 0;
  }
  addTrauma(amount) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }
  update(dt, camera) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - 1.45 * dt);
    if (this.trauma <= 0) return;
    const shake = this.trauma * this.trauma;
    const freq = this.time * 32;
    camera.position.x += 0.55 * shake * pseudoNoise(freq, 1);
    camera.position.y += 0.45 * shake * pseudoNoise(freq, 2);
    camera.rotation.z += 0.08 * shake * pseudoNoise(freq, 3);
  }
}

class ApexOverdrive3DGame {
  constructor() {
    this.bgCanvas = document.getElementById('bg-canvas');
    this.gameCanvas = document.getElementById('game-canvas');
    this.fxctx = this.gameCanvas.getContext('2d');
    this.showroomCanvas = document.getElementById('showroom-canvas');

    this.state = 'menu';
    this.keys = {};
    this.floatingTexts = [];
    this.vfxParticles3D = [];
    this.cameraMode = 0; // 0 = Chase, 1 = Action Close, 2 = Hood/Cockpit, 3 = Driver cam (front, shows the driver's face)
    this.pitTarget = null; // { st, ctrl, laneX, z } while a pit stop is in progress
    this.panel = null; // question panel state (see game-pit.js)
    this.stationCtrls = [];
    this.camShift = 0;
    this.pitCamTime = 0;
    this.perfSamples = [];
    this._focus = new THREE.Vector3();
    this._tmpV = new THREE.Vector3();
    this.quality = this.detectInitialQuality();

    // Game Feel Systems (per game-feel.md)
    this.tweens = new TweenManager();
    this.shakeRig = new ShakeRig();
    this.timeScale = 1.0;
    this.hitstopRemaining = 0;
    this.baseFov = 60;
    this.fovPunch = 0;

    // Multiplayer BroadcastChannel
    this.netChannel = null;
    this.onlinePeers = new Map();
    this.initNetworkChannel();

    // Initialize Three.js + Post-Processing + Showroom
    this.initThreeEngine();
    this.initShowroom3D();
    this.buildMenuDemoWorld();

    this.bindEvents();
    this.refreshAllUI();

    this.lastFrameTime = performance.now();
    requestAnimationFrame(ts => this.masterLoop(ts));
  }

  initThreeEngine() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.bgCanvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.5, 1600);

    window.world3DFactory.quality = this.quality;
    window.world3DFactory.initRendererAndIBL(this.renderer, this.scene);

    // Setup Post-Processing Chain (EffectComposer + RenderPass + UnrealBloomPass) - skipped on weak computers
    if (this.quality === 'high' && THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass) {
      this.composer = new THREE.EffectComposer(this.renderer);
      this.renderPass = new THREE.RenderPass(this.scene, this.camera);
      this.bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.38, // bloom strength (kept low: bright forecourts and sun glare must not wash the picture out)
        0.38, // radius
        0.92  // threshold (only really bright lights, flames and the sun bloom)
      );
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloomPass);
    }
  }

  renderMainScene() {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    if (this.renderer && this.renderer.info) {
      const info = this.renderer.info;
      window.__THREE_GAME_DIAGNOSTICS__ = {
        state: this.state,
        renderer: {
          calls: info.render ? info.render.calls : 0,
          triangles: info.render ? info.render.triangles : 0,
          geometries: info.memory ? info.memory.geometries : 0,
          textures: info.memory ? info.memory.textures : 0
        }
      };
    }
  }

  // Game Feel Helpers (Hitstop, Squash-and-Stretch, FOV Punch, 3D Sparks)
  triggerHitstop(durationMs = 65, scale = 0.06) {
    this.hitstopRemaining = Math.max(this.hitstopRemaining, durationMs / 1000);
    this.timeScale = scale;
  }

  punchFov(degrees) {
    this.fovPunch = Math.min(14, this.fovPunch + degrees);
  }

  squashVehicle(targetGroup, squashY = 0.85, durationSec = 0.2) {
    if (!targetGroup) return;
    const startXZ = 1 / Math.sqrt(squashY);
    this.tweens.tween(
      durationSec,
      t => {
        const y = squashY + (1 - squashY) * t;
        const xz = startXZ + (1 - startXZ) * t;
        targetGroup.scale.set(xz, y, xz);
      },
      easeOutBack
    );
  }

  getSharedParticleMat(colorHex) {
    if (!this.particleMats) this.particleMats = new Map();
    if (!this.particleMats.has(colorHex)) {
      this.particleMats.set(
        colorHex,
        new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.88 })
      );
    }
    return this.particleMats.get(colorHex);
  }

  spawn3DBurst(worldX, worldY, worldZ, colorHex = 0xffaa00, count = 16) {
    if (!this.scene) return;
    if (!this.sharedSparkGeo) this.sharedSparkGeo = new THREE.BoxGeometry(0.12, 0.12, 0.36);
    const mat = this.getSharedParticleMat(colorHex);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sharedSparkGeo, mat);
      m.position.set(worldX, worldY, worldZ);
      this.scene.add(m);
      this.vfxParticles3D.push({
        mesh: m,
        vx: (Math.random() - 0.5) * 26,
        vy: Math.random() * 18 + 4,
        vz: (Math.random() - 0.3) * 32,
        life: 0.55 + Math.random() * 0.35
      });
    }
  }

  spawnExhaustTrailShard(worldX, worldY, worldZ, isBoosting = false) {
    if (!this.scene || this.vfxParticles3D.length > 75) return;
    if (!this.sharedShardGeo) {
      this.sharedShardGeo = new THREE.ConeGeometry(0.32, 0.72, 3);
      this.sharedShardGeo.rotateX(Math.PI / 2);
    }
    const colorHex = isBoosting ? 0x00f0ff : 0xfbbf24;
    const mat = this.getSharedParticleMat(colorHex);
    const m = new THREE.Mesh(this.sharedShardGeo, mat);
    m.position.set(
      worldX + (Math.random() - 0.5) * 1.4,
      worldY + 0.22 + Math.random() * 0.3,
      worldZ - 2.9 - Math.random() * 0.9
    );
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.scene.add(m);
    this.vfxParticles3D.push({
      mesh: m,
      vx: (Math.random() - 0.5) * 5.5,
      vy: 1.5 + Math.random() * 2.5,
      vz: -12 - Math.random() * 10,
      life: 0.28 + Math.random() * 0.16,
      noGravity: true
    });
  }

  update3DParticles(dt) {
    for (let i = this.vfxParticles3D.length - 1; i >= 0; i--) {
      const p = this.vfxParticles3D[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.vfxParticles3D.splice(i, 1);
        continue;
      }
      if (!p.noGravity) p.vy -= 38 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += 8 * dt;
      p.mesh.rotation.y += 6 * dt;
      p.mesh.scale.setScalar(Math.max(0.1, p.life * 1.5));
    }
  }

  initShowroom3D() {
    if (!this.showroomCanvas) return;
    const w = this.showroomCanvas.clientWidth || 440;
    const h = this.showroomCanvas.clientHeight || 210;

    this.showroomRenderer = new THREE.WebGLRenderer({
      canvas: this.showroomCanvas,
      antialias: true,
      alpha: true
    });
    this.showroomRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.showroomRenderer.setSize(w, h);
    this.showroomRenderer.outputEncoding = THREE.sRGBEncoding;
    this.showroomRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.showroomRenderer.toneMappingExposure = 1.25;

    this.showroomScene = new THREE.Scene();
    if (window.world3DFactory.envMap) {
      this.showroomScene.environment = window.world3DFactory.envMap;
    }

    this.showroomCamera = new THREE.PerspectiveCamera(40, w / h, 0.5, 100);
    this.showroomCamera.position.set(4.9, 2.35, 5.6);
    this.showroomCamera.lookAt(0, 0.85, 0);

    const amb = new THREE.AmbientLight(0xffffff, 0.9);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(6, 12, 8);
    const rimLight = new THREE.PointLight(0x00f0ff, 2.2, 24);
    rimLight.position.set(-5, 4, -5);
    this.showroomScene.add(amb, keyLight, rimLight);

    const discGeo = new THREE.CylinderGeometry(3.45, 3.65, 0.25, 48);
    const discMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b1120,
      metalness: 0.85,
      roughness: 0.15,
      clearcoat: 1.0
    });
    this.turntableMesh = new THREE.Mesh(discGeo, discMat);
    this.turntableMesh.position.y = -0.12;
    this.showroomScene.add(this.turntableMesh);

    const ringGeo = new THREE.TorusGeometry(3.52, 0.055, 12, 64);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.02;
    this.showroomScene.add(ringMesh);

    this.rebuildShowroomVehicle();
  }

  rebuildShowroomVehicle() {
    if (!this.showroomScene) return;
    if (this.showroomVehObj) {
      this.showroomScene.remove(this.showroomVehObj.root);
    }
    const st = window.playerStore.state;
    const activeId = this.previewVehId || st.selectedVehicle;
    const vehCfg = window.VEHICLES.find(v => v.id === activeId) || window.VEHICLES[0];
    this.showroomVehObj = this.makeVehicle(vehCfg, st.equippedAccessories, true);
    if (this.showroomVehObj.wingsGroup) {
      this.showroomVehObj.wingsGroup.scale.set(1, 1, 1);
    }
    this.showroomScene.add(this.showroomVehObj.root);
  }

  buildMenuDemoWorld() {
    this.disposeCurrentWorld();
    this.track = new window.TrackBuilder(window.TRACKS[0]);
    this.sceneRefs = window.world3DFactory.buildTrackScene(this.scene, this.track, this.renderer);
    this.stationCtrls = this.sceneRefs.stationVisuals || [];

    const demoVehCfg = window.VEHICLES.find(v => v.id === window.playerStore.state.selectedVehicle) || window.VEHICLES[1];
    this.demoCar = this.makeVehicle(demoVehCfg, window.playerStore.state.equippedAccessories, true);
    this.scene.add(this.demoCar.root);
    this.demoZ = 200;
  }

  initNetworkChannel() {
    if ('BroadcastChannel' in window) {
      try {
        this.netChannel = new BroadcastChannel('apex_overdrive_net_v2');
        this.peerId = 'peer_' + Math.random().toString(36).slice(2, 8);
        this.netChannel.onmessage = ev => {
          const data = ev.data;
          if (!data || data.peerId === this.peerId) return;
          if (data.type === 'hello' || data.type === 'pos') {
            this.onlinePeers.set(data.peerId, {
              id: data.peerId,
              name: data.name || 'שחקן ברשת',
              vehId: data.vehId || 'apex_viper',
              z: data.z || 80,
              laneX: data.laneX || 0,
              vz: data.vz || 0,
              lastSeen: Date.now()
            });
          }
        };
        setInterval(() => {
          if (this.netChannel) {
            this.netChannel.postMessage({
              type: 'hello',
              peerId: this.peerId,
              name: window.playerStore.state.playerName,
              vehId: window.playerStore.state.selectedVehicle,
              z: this.player ? this.player.z : 80
            });
          }
        }, 1200);
      } catch (e) {}
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h);
      if (this.composer) this.composer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.gameCanvas.width = w;
      this.gameCanvas.height = h;
    });
    this.gameCanvas.width = window.innerWidth;
    this.gameCanvas.height = window.innerHeight;

    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (this.state === 'racing') {
        if (e.code === 'KeyT') this.tryActivateTeslaSkyMode();
        if (e.code === 'KeyE') this.tryManualPitStop();
        if (e.code === 'Space') this.tryJump();
        if (e.code === 'KeyC') this.cycleCameraMode();
      }
    });

    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });
  }

  cycleCameraMode() {
    this.cameraMode = (this.cameraMode + 1) % 4;
    const names = ['מצלמת מרדף', 'מצלמה קרובה', 'מצלמת קוקפיט', 'מצלמת נהג: רואים את הפנים שלכם!'];
    this.showToast(`🎥 ${names[this.cameraMode]}`);
    window.soundFX.playTone(680, 0.08, 'triangle', 0.1);
  }

  // ==========================================================================
  // UI Navigation & Garage / Shop Rendering
  // ==========================================================================
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');

    if (screenId === 'none') {
      document.getElementById('hud-layer').classList.add('active');
      this.gameCanvas.classList.add('active');
    } else {
      document.getElementById('hud-layer').classList.remove('active');
      this.gameCanvas.classList.remove('active');
      if (this.state !== 'menu') {
        this.state = 'menu';
        window.soundFX.stopEngineSound();
        this.buildMenuDemoWorld();
      }
    }
    this.refreshAllUI();
  }

  refreshAllUI() {
    const st = window.playerStore.state;
    document.querySelectorAll('.wallet-points-val').forEach(el => {
      el.textContent = st.points.toLocaleString();
    });
    document.querySelectorAll('.wallet-wins-val').forEach(el => {
      el.textContent = st.wins;
    });

    this.renderTitleQuickVehicles();
    this.renderSelectedVehicleStats();
    this.renderGarageScreen();
    this.renderLobbyScreen();
    this.rebuildShowroomVehicle();
  }

  renderTitleQuickVehicles() {
    const container = document.getElementById('quick-vehicle-selector');
    if (!container) return;
    const st = window.playerStore.state;
    container.innerHTML = window.VEHICLES.map(v => {
      const owned = st.ownedVehicles.includes(v.id);
      const selected = (this.previewVehId || st.selectedVehicle) === v.id;
      return `
        <div class="veh-chip ${selected ? 'selected' : ''} ${v.isFlyingTesla ? 'tesla-chip' : ''}"
             onclick="window.game.selectOrPreviewVehicle('${v.id}')">
          <span class="v-name">${v.name}</span>
          <span class="v-type">${owned ? v.kindLabel : `🔒 ${v.price} נק׳`}</span>
        </div>
      `;
    }).join('');
  }

  selectOrPreviewVehicle(vehId) {
    const st = window.playerStore.state;
    this.previewVehId = vehId;
    if (st.ownedVehicles.includes(vehId)) {
      st.selectedVehicle = vehId;
      window.playerStore.save();
      window.soundFX.playTone(620, 0.09, 'triangle', 0.1);
    } else {
      this.showToast(`תצוגת 3D של הרכב — ניתן לרכוש במוסך או לצאת לטיסת מבחן!`);
    }
    this.refreshAllUI();
  }

  renderSelectedVehicleStats() {
    const st = window.playerStore.state;
    const activeId = this.previewVehId || st.selectedVehicle;
    const v = window.VEHICLES.find(x => x.id === activeId) || window.VEHICLES[0];

    const nameEl = document.getElementById('showroom-veh-name');
    const tagEl = document.getElementById('showroom-veh-tag');
    const descEl = document.getElementById('showroom-veh-desc');
    const barsEl = document.getElementById('showroom-stats-bars');

    if (nameEl) nameEl.textContent = v.name;
    if (tagEl) tagEl.textContent = `${v.enName} • ${v.kindLabel}`;
    if (descEl) descEl.textContent = v.desc;

    if (barsEl) {
      const items = [
        { label: 'מהירות מרבית', val: v.stats.speed },
        { label: 'האצה וטורבו', val: v.stats.accel },
        { label: 'שליטה אווירית (סלטות)', val: v.stats.airControl },
        { label: 'קיבולת מיכל דלק', val: v.stats.fuelCap }
      ];
      barsEl.innerHTML = items.map(it => `
        <div class="stat-row">
          <div class="stat-label"><span>${it.label}</span><span>${it.val}%</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${it.val}%"></div></div>
        </div>
      `).join('');
    }
  }

  renderGarageScreen() {
    const st = window.playerStore.state;

    const vGrid = document.getElementById('garage-vehicles-grid');
    if (vGrid) {
      vGrid.innerHTML = window.VEHICLES.map(v => {
        const owned = st.ownedVehicles.includes(v.id);
        const selected = st.selectedVehicle === v.id;
        return `
          <div class="game-card ${selected ? 'selected' : ''} ${!owned ? 'locked' : ''} ${v.isFlyingTesla ? 'tesla-special' : ''}">
            ${owned ? '<span class="owned-ribbon">שלכם</span>' : ''}
            <div>
              <span class="card-badge ${v.isFlyingTesla ? 'gold' : ''}">${v.kindLabel}</span>
              ${this.vehicleThumbHtml(v)}
              <h3 style="margin-top:8px;font-size:1.2rem;">${v.name}</h3>
              <div style="margin-top:6px;">${owned ? '<span class="price-tag free">✓ ברשותכם</span>' : `<span class="price-tag">🪙 ${v.price}</span>`}</div>
              <p style="color:var(--text-muted);font-size:0.86rem;margin-top:6px;">${v.desc}</p>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:10px;color:#b8c7e8;">
                <span>מהירות: ${v.stats.speed}</span>
                <span>אוויר: ${v.stats.airControl}</span>
                <span>דלק: ${v.stats.fuelCap}</span>
              </div>
              <button class="btn ${selected ? 'btn-cyber' : owned ? 'btn-primary' : 'btn-gold'} btn-sm"
                      style="width:100%"
                      onclick="window.game.handleVehicleAction('${v.id}')">
                ${selected ? '✓ הרכב הפעיל שלכם' : owned ? 'בחרו רכב זה' : `🛒 קנו ב-${v.price} נקודות`}
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    const aGrid = document.getElementById('garage-accessories-grid');
    if (aGrid) {
      aGrid.innerHTML = window.ACCESSORIES.map(acc => {
        const owned = st.ownedAccessories.includes(acc.id);
        const equipped = st.equippedAccessories.includes(acc.id);
        return `
          <div class="game-card ${equipped ? 'selected' : ''} ${acc.isTeslaUnlock ? 'tesla-special' : ''}">
            <div>
              <span class="card-badge ${acc.isTeslaUnlock ? 'gold' : ''}">${acc.category}</span>
              <h3 style="margin-top:8px;font-size:1.1rem;">${acc.name}</h3>
              <p style="color:var(--text-muted);font-size:0.84rem;margin-top:6px;">${acc.effectText}</p>
            </div>
            <button class="btn ${equipped ? 'btn-cyber' : owned ? 'btn-primary' : 'btn-gold'} btn-sm"
                    style="width:100%"
                    onclick="window.game.handleAccessoryAction('${acc.id}')">
              ${equipped ? '✓ מותקן על הרכב (לחץ להסרה)' : owned ? 'התקן על הרכב' : `רכוש ב-${acc.price} נקודות`}
            </button>
          </div>
        `;
      }).join('');
    }

    const tGrid = document.getElementById('garage-tracks-grid');
    if (tGrid) {
      tGrid.innerHTML = window.TRACKS.map(t => {
        const owned = st.ownedTracks.includes(t.id);
        const selected = st.selectedTrack === t.id;
        return `
          <div class="game-card ${selected ? 'selected' : ''} ${!owned ? 'locked' : ''}">
            <div>
              <span class="card-badge">${t.difficulty}</span>
              <h3 style="margin-top:8px;font-size:1.15rem;">${t.name}</h3>
              <p style="color:var(--text-muted);font-size:0.84rem;margin-top:6px;">${t.desc}</p>
            </div>
            <button class="btn ${selected ? 'btn-cyber' : owned ? 'btn-primary' : 'btn-gold'} btn-sm"
                    style="width:100%"
                    onclick="window.game.handleTrackAction('${t.id}')">
              ${selected ? '✓ המסלול הנבחר' : owned ? 'בחר מסלול' : `פתח מסלול ב-${t.price} נקודות`}
            </button>
          </div>
        `;
      }).join('');
    }
  }

  renderLobbyScreen() {
    const st = window.playerStore.state;

    document.querySelectorAll('[data-mode-card]').forEach(el => {
      const m = el.getAttribute('data-mode-card');
      el.classList.toggle('selected', st.selectedMode === m);
    });

    document.querySelectorAll('[data-grade-card]').forEach(el => {
      const g = el.getAttribute('data-grade-card');
      el.classList.toggle('selected', st.mathGrade === g);
    });

    const lobbyTracks = document.getElementById('lobby-tracks-grid');
    if (lobbyTracks) {
      lobbyTracks.innerHTML = window.TRACKS.map(t => {
        const owned = st.ownedTracks.includes(t.id);
        const selected = st.selectedTrack === t.id;
        return `
          <div class="game-card ${selected ? 'selected' : ''} ${!owned ? 'locked' : ''}"
               onclick="window.game.handleTrackAction('${t.id}')">
            <div>
              <span class="card-badge">${t.difficulty}</span>
              <h4 style="margin-top:6px;font-size:1.05rem;">${t.name}</h4>
              <p style="color:var(--text-muted);font-size:0.8rem;margin-top:4px;">${t.desc}</p>
            </div>
            <div style="font-size:0.82rem;font-weight:800;color:${owned ? 'var(--neon-cyan)' : 'var(--tesla-gold)'}">
              ${selected ? '✓ מסלול 3D נבחר למרוץ' : owned ? 'לחץ לבחירה' : `🔒 נעול (${t.price} נק׳)`}
            </div>
          </div>
        `;
      }).join('');
    }

    const onlineStatusEl = document.getElementById('lobby-online-status');
    if (onlineStatusEl) {
      const activePeers = Array.from(this.onlinePeers.values()).filter(p => Date.now() - p.lastSeen < 5000);
      if (activePeers.length > 0) {
        onlineStatusEl.textContent = `🟢 נמצאו ${activePeers.length} שחקנים מחוברים ברשת המקומית + השלמת נהגי AI אוטומטית!`;
      } else {
        onlineStatusEl.textContent = `🤖 מחפש שחקנים... במידה ואין מספיק שחקנים בחדר, נהגי ה-AI החכמים ישלימו את הזינוק אוטומטית!`;
      }
    }
  }

  handleVehicleAction(vehId) {
    const res = window.playerStore.buyVehicle(vehId);
    if (res.ok) {
      this.previewVehId = vehId;
      window.soundFX.playCorrectAnswer();
    } else {
      window.soundFX.playWrongAnswer();
    }
    this.showToast(res.msg);
    this.refreshAllUI();
  }

  handleAccessoryAction(accId) {
    const res = window.playerStore.buyAccessory(accId);
    if (res.ok) window.soundFX.playCorrectAnswer();
    else window.soundFX.playWrongAnswer();
    this.showToast(res.msg);
    this.refreshAllUI();
  }

  handleTrackAction(trackId) {
    const res = window.playerStore.buyTrack(trackId);
    if (res.ok) window.soundFX.playTone(720, 0.12, 'triangle', 0.12);
    else window.soundFX.playWrongAnswer();
    this.showToast(res.msg);
    this.refreshAllUI();
  }

  selectMode(mode) {
    window.playerStore.state.selectedMode = mode;
    window.playerStore.save();
    window.soundFX.playTone(540, 0.1, 'triangle', 0.1);
    this.refreshAllUI();
  }

  selectMathGrade(grade) {
    window.playerStore.state.mathGrade = grade;
    window.playerStore.save();
    window.soundFX.playTone(640, 0.1, 'triangle', 0.1);
    this.refreshAllUI();
  }

  showToast(msg) {
    const toast = document.getElementById('cyber-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  // ==========================================================================
  // 3D Race Initialization & Entities
  // ==========================================================================
  startRace(forceTeslaTest = false) {
    const st = window.playerStore.state;
    const trackCfg = window.TRACKS.find(t => t.id === st.selectedTrack) || window.TRACKS[0];

    this.disposeCurrentWorld();
    this.track = new window.TrackBuilder(trackCfg);
    this.sceneRefs = window.world3DFactory.buildTrackScene(this.scene, this.track, this.renderer);
    this.stationCtrls = this.sceneRefs.stationVisuals || [];
    this.pitTarget = null;
    this.panel = null;
    this.hidePitPanel();

    const vehId = forceTeslaTest ? 'tesla_sky_x' : st.selectedVehicle;
    const vehCfg = window.VEHICLES.find(v => v.id === vehId) || window.VEHICLES[0];

    let speedBonus = 0;
    let accelBonus = 0;
    let fuelBonus = 0;
    st.equippedAccessories.forEach(accId => {
      const acc = window.ACCESSORIES.find(a => a.id === accId);
      if (acc && acc.statBonus) {
        speedBonus += acc.statBonus.speed || 0;
        accelBonus += acc.statBonus.accel || 0;
        fuelBonus += acc.statBonus.fuelCap || 0;
      }
    });

    const veh3D = this.makeVehicle(vehCfg, st.equippedAccessories, true);
    this.scene.add(veh3D.root);

    this.player = {
      id: 'player',
      name: st.playerName || 'אתה',
      veh: vehCfg,
      meshObj: veh3D,
      z: 90,
      laneX: 0,
      y: this.track.getHeightAt(90),
      vz: 0,
      vx: 0,
      vy: 0,
      pitch: 0,
      roll: 0,
      yaw: 0,
      onGround: true,
      inLoop: false,
      loopAngle: 0,
      activeLoop: null,

      flatTires: false,
      streak: 0,

      maxSpeed: 108 + (vehCfg.stats.speed + speedBonus) * 0.65,
      accelRate: 65 + (vehCfg.stats.accel + accelBonus) * 0.48,
      airTurnRate: 3.8 + vehCfg.stats.airControl * 0.026,
      maxFuel: 100 + fuelBonus,
      fuel: 100 + fuelBonus,
      nitro: 100,
      health: 100,
      shieldActive: false,

      airCumulativePitch: 0,
      flipsCount: 0,
      invulnerableTimer: 0,

      canUseTeslaSky: forceTeslaTest || vehCfg.isFlyingTesla || window.playerStore.hasTeslaUnlocked(),
      teslaCharges: 1,
      inSkyMode: false,
      skyTimerSec: 0,

      finished: false,
      finishTimeMs: 0
    };

    // Build 3D Rivals
    this.rivals = [];
    if (st.selectedMode !== 'time_trial') {
      const aiProfiles = [
        { name: 'קאי (Ducati V4R)', vehId: 'plasma_hawk', skill: 0.94, color: '#8b5cf6', startLane: -5.5 },
        { name: 'נועה (Porsche GT3)', vehId: 'apex_viper', skill: 0.89, color: '#e11d48', startLane: 5.5 },
        { name: 'רייזר (Raptor 4X4)', vehId: 'titan_buggy', skill: 0.84, color: '#f59e0b', startLane: -3.2 }
      ];

      const activePeers = Array.from(this.onlinePeers.values()).filter(p => Date.now() - p.lastSeen < 6000);
      activePeers.slice(0, 3).forEach((peer, idx) => {
        const v = window.VEHICLES.find(x => x.id === peer.vehId) || window.VEHICLES[1];
        const rMesh = this.makeVehicle(v, [], false);
        this.scene.add(rMesh.root);
        this.rivals.push({
          id: peer.id,
          name: `${peer.name} (אונליין)`,
          isOnlinePeer: true,
          veh: v,
          meshObj: rMesh,
          z: 82 - idx * 12,
          laneX: idx % 2 === 0 ? -5 : 5,
          y: 0,
          vz: 80,
          baseSpeed: this.player.maxSpeed * 0.92,
          color: v.color,
          finished: false,
          finishTimeMs: 0
        });
      });

      const neededAI = Math.max(0, 3 - this.rivals.length);
      for (let i = 0; i < neededAI; i++) {
        const prof = aiProfiles[i];
        const v = window.VEHICLES.find(x => x.id === prof.vehId) || window.VEHICLES[0];
        const rMesh = this.makeVehicle(v, [], false);
        this.scene.add(rMesh.root);
        this.rivals.push({
          id: `ai_${i}`,
          name: prof.name,
          isOnlinePeer: false,
          veh: v,
          meshObj: rMesh,
          z: 82 - i * 14,
          laneX: prof.startLane,
          targetLaneX: prof.startLane,
          y: 0,
          vz: 0,
          baseSpeed: this.player.maxSpeed * prof.skill,
          skill: prof.skill,
          color: prof.color,
          finished: false,
          finishTimeMs: 0
        });
      }
    }

    this.floatingTexts = [];
    this.bonusTimeSavedSec = 0;
    this.raceElapsedMs = 0;

    this.showScreen('none');
    this.setupMinimapMarkers();
    this.updateTeslaButtonVisibility();

    this.state = 'countdown';
    this.countdownVal = 3;
    window.soundFX.playCountdown(false);
    window.soundFX.startMusic();

    if (forceTeslaTest) {
      setTimeout(() => {
        if (this.state === 'racing') this.tryActivateTeslaSkyMode();
      }, 3400);
    }

    clearInterval(this.countdownInterval);
    this.countdownInterval = setInterval(() => {
      this.countdownVal--;
      if (this.countdownVal > 0) {
        window.soundFX.playCountdown(false);
      } else if (this.countdownVal === 0) {
        window.soundFX.playCountdown(true);
        this.state = 'racing';
        this.raceStartTime = performance.now();
        this.punchFov(6);
        window.soundFX.startEngineSound(this.player.veh.isFlyingTesla);
      } else {
        clearInterval(this.countdownInterval);
      }
    }, 900);
  }

  setupMinimapMarkers() {
    const trackLine = document.getElementById('hud-minimap-line');
    if (!trackLine || !this.track) return;
    trackLine.querySelectorAll('.station-marker, .racer-dot.rival').forEach(el => el.remove());

    this.track.stations.forEach(st => {
      const m = document.createElement('div');
      m.className = `station-marker ${st.type}`;
      m.style.left = `${(st.z / this.track.length) * 100}%`;
      m.title = st.name;
      trackLine.appendChild(m);
    });

    this.rivals.forEach(r => {
      const dot = document.createElement('div');
      dot.className = 'racer-dot rival';
      dot.id = `minimap_dot_${r.id}`;
      dot.style.background = r.color;
      dot.style.left = '1%';
      trackLine.appendChild(dot);
    });
  }

  updateTeslaButtonVisibility() {
    const btn = document.getElementById('tesla-launch-hud-btn');
    if (!btn || !this.player) return;
    if (this.player.canUseTeslaSky && this.player.teslaCharges > 0 && !this.player.inSkyMode) {
      btn.classList.add('available');
    } else {
      btn.classList.remove('available');
    }
  }

  // ==========================================================================
  // Flying Tesla 30-Second 3D Sky-Track Bonus Mode
  // ==========================================================================
  tryActivateTeslaSkyMode() {
    if (!this.player || this.state !== 'racing') return;
    if (!this.player.canUseTeslaSky || this.player.teslaCharges <= 0 || this.player.inSkyMode) return;

    this.player.teslaCharges--;
    this.player.inSkyMode = true;
    this.player.skyTimerSec = 30.0;
    this.player.y = 92;
    this.player.vy = 0;
    this.player.pitch = 0;

    if (this.player.meshObj.wingsGroup) {
      this.player.meshObj.wingsGroup.scale.set(1, 1, 1);
    }

    this.punchFov(10);
    this.shakeRig.addTrauma(0.45);
    this.squashVehicle(this.player.meshObj.bodyGroup, 1.22, 0.28);
    window.soundFX.playTeslaLaunch();
    this.addFloatingText('🚀 המראת טסלה 3D! 30 שניות במסלול הרקיע בעננים!');

    const banner = document.getElementById('tesla-hud-banner');
    if (banner) banner.classList.add('active');
    this.updateTeslaButtonVisibility();
  }

  endTeslaSkyMode() {
    if (!this.player) return;
    this.player.inSkyMode = false;
    this.player.skyTimerSec = 0;
    this.player.y = this.track.getHeightAt(this.player.z) + 12;
    this.player.vy = 0;
    this.player.pitch = 0;
    this.player.onGround = false;
    this.player.invulnerableTimer = 3.0;

    if (this.player.meshObj.wingsGroup) {
      this.player.meshObj.wingsGroup.scale.set(0.01, 1, 1);
    }

    const banner = document.getElementById('tesla-hud-banner');
    if (banner) banner.classList.remove('active');
    this.addFloatingText('⚡ נחיתה ממסלול הרקיע אל האוטוסטרדה!');
  }

  tryJump() {
    if (!this.player || this.state !== 'racing' || this.player.inSkyMode) return;
    if (this.player.onGround) {
      this.player.vy = 25;
      this.player.onGround = false;
      this.squashVehicle(this.player.meshObj.bodyGroup, 1.18, 0.22); // Jump stretch!
      window.soundFX.playTone(300, 0.14, 'sine', 0.09, 520);
    }
  }

  tryManualPitStop() {
    if (!this.player || this.state !== 'racing' || this.player.inSkyMode) return;
    for (const st of this.track.stations) {
      if (Math.abs(this.player.z - st.z) < 42) {
        st.visited = true;
        this.openMathModal(st.type, st);
        return;
      }
    }
  }

  // ==========================================================================
  // Master 60FPS 3D Update & Render Loop (with Hitstop & Real-Delta Feel)
  // ==========================================================================
  masterLoop(timestamp) {
    const rawDt = Math.min(0.05, (timestamp - this.lastFrameTime) / 1000);
    this.lastFrameTime = timestamp;

    const simDt = this.pausedForScreenshot ? 0 : rawDt;

    // Decay hitstop in real time while scaling gameplay dt (per game-feel.md)
    if (this.hitstopRemaining > 0 && !this.pausedForScreenshot) {
      this.hitstopRemaining -= rawDt;
      if (this.hitstopRemaining <= 0) this.timeScale = 1.0;
    }
    const gameDt = simDt * this.timeScale;

    if (!this.pausedForScreenshot) {
      this.tweens.update(rawDt);
    }

    if (this.state === 'menu') {
      this.updateAndRenderMenu3D(timestamp, simDt);
    } else if (
      this.state === 'countdown' ||
      this.state === 'racing' ||
      this.state === 'pit_approach' ||
      this.state === 'pit_service' ||
      this.state === 'paused_modal'
    ) {
      if ((this.state === 'racing' || this.state === 'pit_approach') && !this.pausedForScreenshot) {
        this.updateRacePhysics3D(gameDt);
      }
      if (!this.pausedForScreenshot) {
        this.update3DParticles(rawDt);
        this.updateStations(rawDt);
      }
      this.renderRaceWorld3D(timestamp, simDt);
      this.updateHUD();
    }

    requestAnimationFrame(ts => this.masterLoop(ts));
  }

  updateAndRenderMenu3D(ts, dt) {
    this.sampleMenuPerformance(dt);
    if (this.demoCar && this.track) {
      this.demoZ = (this.demoZ + 92 * dt) % (this.track.length - 600);
      const cx = this.track.getCurveXAt(this.demoZ);
      const cy = this.track.getHeightAt(this.demoZ);
      const heading = this.track.getHeadingAt(this.demoZ);
      const slope = this.track.getSlopeAt(this.demoZ);

      this.demoCar.root.position.set(cx, cy, this.demoZ);
      this.demoCar.root.rotation.set(-slope, heading, 0);
      this.demoCar.wheels.forEach(w => {
        w.rotation.x += 16 * dt;
      });
      this.updateStations(dt, cx, cy, this.demoZ);

      const camOffsetX = Math.sin(ts * 0.0005) * 6.5;
      this.camera.position.set(cx + camOffsetX, cy + 4.4, this.demoZ - 11.5);
      this.camera.lookAt(cx, cy + 1.6, this.demoZ + 28);
      this.renderMainScene();
    }

    if (this.showroomRenderer && this.showroomVehObj) {
      this.showroomVehObj.root.rotation.y = ts * 0.00085;
      this.showroomVehObj.wheels.forEach(w => {
        w.rotation.x += 2.8 * dt;
      });
      this.showroomRenderer.render(this.showroomScene, this.showroomCamera);
    }
  }

  updateRacePhysics3D(dt) {
    const p = this.player;
    if (!p) return;

    this.raceElapsedMs += dt * 1000;
    if (p.invulnerableTimer > 0) p.invulnerableTimer = Math.max(0, p.invulnerableTimer - dt);

    let accelPressed = this.keys['ArrowUp'] || this.keys['KeyW'] || this.keys['TouchGas'];
    let brakePressed = this.keys['ArrowDown'] || this.keys['KeyS'] || this.keys['TouchBrake'];
    let steerLeft = this.keys['ArrowLeft'] || this.keys['KeyA'] || this.keys['TouchLeft'];
    let steerRight = this.keys['ArrowRight'] || this.keys['KeyD'];
    let flipButton = this.keys['KeyQ'] || this.keys['TouchFlip'];
    let nitroPressed = this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.keys['TouchNitro'];

    // While the car rolls into a station it drives itself (lane + braking are automatic).
    const autoPit = this.state === 'pit_approach' && this.pitTarget && !p.inSkyMode;
    if (autoPit) {
      accelPressed = brakePressed = steerLeft = steerRight = flipButton = nitroPressed = false;
    }

    let steerDir = 0;
    if (steerLeft) steerDir = 1;
    if (steerRight) steerDir = -1;
    if (autoPit) {
      const dx = this.pitTarget.laneX - p.laneX;
      steerDir = dx > 0.45 ? 1 : dx < -0.45 ? -1 : 0;
    }

    // ========================================================================
    // BRANCH A: 30-SECOND FLYING TESLA 3D STRATOSPHERE SKY-TRACK
    // ========================================================================
    if (p.inSkyMode) {
      p.skyTimerSec -= dt;
      const timerEl = document.getElementById('tesla-sky-timer');
      if (timerEl) timerEl.textContent = Math.max(0, p.skyTimerSec).toFixed(1);

      const targetVz = p.maxSpeed * 1.48;
      p.vz += (targetVz - p.vz) * 4.5 * dt;
      p.z += p.vz * dt;

      p.laneX = Math.max(-12, Math.min(12, p.laneX + steerDir * 25 * dt));
      if (accelPressed) p.y = Math.min(104, p.y + 18 * dt);
      if (brakePressed) p.y = Math.max(80, p.y - 18 * dt);

      p.roll = -steerDir * 0.44;
      p.pitch = accelPressed ? -0.15 : brakePressed ? 0.15 : 0;

      // Solar Rings collection
      this.sceneRefs.skyRingMeshes.forEach(({ data: ring, mesh }) => {
        if (!ring.collected && Math.abs(p.z - ring.z) < 7.5) {
          const dist = Math.hypot(p.laneX - ring.laneX, p.y - ring.y);
          if (dist < ring.radius + 3.2) {
            ring.collected = true;
            mesh.visible = false;
            this.punchFov(5);
            this.shakeRig.addTrauma(0.18);
            this.spawn3DBurst(this.track.getCurveXAt(ring.z) + ring.laneX, ring.y, ring.z, 0xffd700, 18);
            window.soundFX.playFireRing();
            window.playerStore.addPoints(15);
            this.addFloatingText('✨ +15 נק׳ טבעת סולארית 3D!');
          }
        }
      });

      // Aerial Drone Obstacles
      this.sceneRefs.skyObsMeshes.forEach(({ data: obs, mesh }) => {
        if (!obs.hit && Math.abs(p.z - obs.z) < 5.5) {
          const dist = Math.hypot(p.laneX - obs.laneX, p.y - obs.y);
          if (dist < obs.radius + 2.5) {
            obs.hit = true;
            mesh.visible = false;
            p.vz *= 0.62;
            this.shakeRig.addTrauma(0.55);
            this.triggerHitstop(55, 0.08);
            this.spawn3DBurst(this.track.getCurveXAt(obs.z) + obs.laneX, obs.y, obs.z, 0xff0055, 22);
            window.soundFX.playCrash();
            this.addFloatingText('💥 פגיעה ברחפן חלל! האטה קלה!');
          }
        }
      });

      window.soundFX.updateEngineRPM(p.vz / p.maxSpeed, true, true);

      if (p.skyTimerSec <= 0 || p.z >= this.track.length - 250) {
        this.endTeslaSkyMode();
      }

      this.syncVehicle3DTransform(p, dt, true);
      this.updateRivals3D(dt);
      this.checkRaceFinish();
      return;
    }

    // ========================================================================
    // BRANCH B: REALISTIC 3D HIGHWAY DRIVING & STUNT PHYSICS
    // ========================================================================
    const isBoosting = nitroPressed && p.nitro > 2 && p.fuel > 0;

    const speedCap = p.flatTires ? p.maxSpeed * 0.68 : p.maxSpeed;
    if (p.flatTires && p.vz > speedCap * 1.05) p.vz = Math.max(speedCap * 1.05, p.vz - 40 * dt);

    if (p.fuel > 0) {
      if (accelPressed) {
        const boostMult = isBoosting ? 1.38 : 1.0;
        p.vz = Math.min(speedCap * boostMult, p.vz + p.accelRate * boostMult * dt);
        p.fuel = Math.max(0, p.fuel - (isBoosting ? 4.4 : 2.5) * dt);
      } else if (brakePressed) {
        p.vz = Math.max(0, p.vz - p.accelRate * 1.6 * dt);
      } else {
        p.vz = Math.max(0, p.vz - 18 * dt);
      }

      if (isBoosting) {
        p.nitro = Math.max(0, p.nitro - 22 * dt);
        if (Math.random() < 0.35) this.punchFov(0.8);
      } else {
        p.nitro = Math.min(100, p.nitro + 3.5 * dt);
      }
    } else {
      p.vz = Math.max(0, p.vz - 38 * dt);
      if (p.vz < 5 && !autoPit) {
        this.openMathModal('fuel', { name: 'תדלוק חירום: נגמר הדלק!' });
        return;
      }
    }

    // Station approach: brake along a smooth curve so the car stops exactly in the bay.
    if (autoPit) {
      const T = this.pitTarget;
      const dist = T.z - p.z;
      const allowed = dist > 0 ? Math.sqrt(2 * 40 * Math.max(0, dist - 0.4)) + 3 : 0;
      const cruise = Math.min(allowed, 46);
      if (p.vz > allowed) p.vz = Math.max(allowed, p.vz - 150 * dt);
      else if (p.vz < cruise) p.vz = Math.min(cruise, p.vz + 55 * dt);
      p.nitro = Math.min(100, p.nitro + 6 * dt);
    }

    // Lateral steering across the 3-lane highway
    const steerSpeed = 19.5 * (0.35 + 0.65 * (p.vz / p.maxSpeed));
    p.laneX = Math.max(-9.2, Math.min(9.2, p.laneX + steerDir * (autoPit ? Math.max(steerSpeed, 11) : steerSpeed) * dt));
    if (autoPit && Math.abs(this.pitTarget.laneX - p.laneX) < 0.5) p.laneX = this.pitTarget.laneX;

    const targetRoll = p.veh.kind === 'bike' ? -steerDir * 0.52 : steerDir * 0.09;
    p.roll += (targetRoll - p.roll) * 11 * dt;

    // 360-degree Vertical Stunt Loop check
    for (const lp of this.track.loops) {
      if (!lp.passed && Math.abs(p.z - lp.z) < 8 && p.vz > 65 && !p.inLoop) {
        p.inLoop = true;
        p.activeLoop = lp;
        p.loopAngle = 0;
        this.punchFov(6);
        window.soundFX.playFireRing();
        this.addFloatingText('🌀 כניסה ללופ 360° בתלת-ממד!');
      }
    }

    if (p.inLoop && p.activeLoop) {
      p.loopAngle += 4.3 * dt;
      const L = p.activeLoop;
      const baseGroundY = this.track.getHeightAt(L.z);
      p.z = L.z + Math.sin(p.loopAngle) * L.radius;
      p.y = baseGroundY + L.radius - Math.cos(p.loopAngle) * L.radius;
      p.pitch = -p.loopAngle;

      if (p.loopAngle >= Math.PI * 2) {
        p.inLoop = false;
        L.passed = true;
        p.z = L.z + 12;
        p.y = baseGroundY;
        p.pitch = 0;
        p.vz = Math.max(p.vz, p.maxSpeed * 1.28);
        p.nitro = Math.min(100, p.nitro + 35);
        this.punchFov(7);
      }
    } else {
      p.z += p.vz * dt;
      const groundY = this.track.getHeightAt(p.z);
      const roadSlope = this.track.getSlopeAt(p.z);

      let onRamp = false;
      for (const r of this.track.ramps) {
        const dz = p.z - (r.z - r.length / 2);
        if (dz >= 0 && dz <= r.length && Math.abs(p.laneX - r.laneX) < r.width * 0.55) {
          const rampRatio = dz / r.length;
          const rampTopY = groundY + rampRatio * r.height;
          if (p.y <= rampTopY + 1.2) {
            p.y = rampTopY;
            p.pitch = -Math.atan2(r.height, r.length);
            onRamp = true;
            if (rampRatio > 0.86 && p.vz > 45) {
              p.onGround = false;
              p.vy = 26 + (p.vz / p.maxSpeed) * 10;
              this.squashVehicle(p.meshObj.bodyGroup, 1.18, 0.22);
              this.punchFov(5);
              window.soundFX.playTone(360, 0.18, 'sine', 0.1, 680);
            }
          }
        }
      }

      if (!p.onGround && !onRamp) {
        p.vy -= 52 * dt;
        p.y += p.vy * dt;

        if (flipButton || this.keys['Space'] || brakePressed) {
          const flipStep = p.airTurnRate * dt * 2.15;
          p.pitch -= flipStep;
          p.airCumulativePitch += flipStep;

          if (p.airCumulativePitch >= Math.PI * 1.85) {
            p.flipsCount++;
            p.airCumulativePitch = 0;
            p.nitro = Math.min(100, p.nitro + 35);
            this.bonusTimeSavedSec += 1.5;
            this.punchFov(6);
            this.shakeRig.addTrauma(0.25);
            window.soundFX.playStuntFlip();
            this.addFloatingText('🔥 סלטת 360° בתלת-ממד! +35% ניטרו (-1.5 שנ׳)');
          }
        } else {
          p.pitch *= 0.96;
        }

        if (p.y <= groundY) {
          p.y = groundY;
          p.vy = 0;
          p.onGround = true;

          // Impact landing squash + camera shake + asphalt sparks!
          this.squashVehicle(p.meshObj.bodyGroup, 0.84, 0.22);
          this.shakeRig.addTrauma(0.26);
          const wx = this.track.getCurveXAt(p.z) + p.laneX;
          this.spawn3DBurst(wx, groundY + 0.3, p.z, 0x38bdf8, 10);

          const normPitch = Math.atan2(Math.sin(p.pitch), Math.cos(p.pitch));
          if (Math.abs(normPitch) > 1.75 && p.invulnerableTimer <= 0) {
            if (p.shieldActive) {
              p.shieldActive = false;
              p.pitch = -roadSlope;
              this.addFloatingText('🛡️ מגן הטיטניום הציל אותך מהתהפכות!');
            } else {
              this.triggerCrashRevive('נחיתה הפוכה מסלטה באוויר!');
              return;
            }
          } else {
            p.pitch = -roadSlope;
          }
          p.airCumulativePitch = 0;
        }
      } else if (!onRamp) {
        p.y = groundY;
        p.vy = 0;
        p.pitch += (-roadSlope - p.pitch) * 10 * dt;
      }
    }

    // Check 3D Nitro Boost Pads
    for (const pad of this.track.boostPads) {
      if (Math.abs(p.z - pad.z) < pad.length * 0.5 && Math.abs(p.laneX - pad.laneX) < pad.width * 0.6 && p.onGround) {
        if (p.vz < p.maxSpeed * 1.25) {
          this.punchFov(6);
          this.shakeRig.addTrauma(0.2);
        }
        p.vz = Math.max(p.vz, p.maxSpeed * 1.34);
        p.nitro = Math.min(100, p.nitro + 15);
      }
    }

    // Check 3D Blazing Rings of Fire
    this.sceneRefs.fireRingMeshes.forEach(({ data: ring }) => {
      if (!ring.passed && Math.abs(p.z - ring.z) < 6.5) {
        const dist = Math.hypot(p.laneX - ring.laneX, (p.y + 1.2) - ring.y);
        if (dist < ring.radius - 0.8) {
          ring.passed = true;
          p.vz = Math.max(p.vz, p.maxSpeed * 1.38);
          p.nitro = Math.min(100, p.nitro + 35);
          this.punchFov(8);
          this.shakeRig.addTrauma(0.35);
          this.triggerHitstop(55, 0.08);
          this.spawn3DBurst(this.track.getCurveXAt(ring.z) + ring.laneX, ring.y, ring.z, 0xff6600, 26);
          window.soundFX.playFireRing();
          this.addFloatingText('🔥 קפיצה אדירה דרך חישוק האש! +בוסט טורבו!');
        } else if (dist >= ring.radius - 0.8 && dist <= ring.radius + 2.0 && !ring.hitRim && p.invulnerableTimer <= 0) {
          ring.hitRim = true;
          p.health = Math.max(0, p.health - 38);
          this.shakeRig.addTrauma(0.65);
          this.triggerHitstop(75, 0.05);
          this.spawn3DBurst(this.track.getCurveXAt(ring.z) + ring.laneX, ring.y, ring.z, 0xff0044, 24);
          window.soundFX.playCrash();
          this.addFloatingText('💥 פגיעה במסגרת חישוק האש! (-38% שלדה)');
          if (p.health <= 0) {
            this.triggerCrashRevive('השלדה ניזוקה בחישוק האש!');
            return;
          }
        }
      }
    });

    // Check 3D Highway Obstacles
    if (p.invulnerableTimer <= 0) {
      for (const { data: haz, mesh } of this.sceneRefs.hazardMeshes) {
        if (!haz.active) continue;
        if (Math.abs(p.z - haz.z) < 3.8 && Math.abs(p.laneX - haz.laneX) < haz.width * 0.55) {
          const groundY = this.track.getHeightAt(haz.z);
          if (p.y - groundY < haz.height) {
            haz.active = false;
            mesh.visible = false;
            const wx = this.track.getCurveXAt(haz.z) + haz.laneX;

            if (p.shieldActive) {
              p.shieldActive = false;
              this.punchFov(6);
              this.shakeRig.addTrauma(0.35);
              this.triggerHitstop(60, 0.08);
              this.spawn3DBurst(wx, groundY + 1.2, haz.z, 0x00f0ff, 24);
              window.soundFX.playFireRing();
              this.addFloatingText('🛡️ מגן הפגוש ריסק את המכשול!');
            } else if (haz.kind === 'lava') {
              this.shakeRig.addTrauma(0.85);
              this.spawn3DBurst(wx, groundY + 1.0, haz.z, 0xff3b00, 32);
              this.triggerCrashRevive('נפילה לתעלת הלבה הרותחת!');
              return;
            } else {
              p.health = Math.max(0, p.health - 45);
              p.vz *= 0.45;
              this.shakeRig.addTrauma(0.75);
              this.triggerHitstop(80, 0.05);
              this.squashVehicle(p.meshObj.bodyGroup, 0.78, 0.25);
              this.spawn3DBurst(wx, groundY + 1.2, haz.z, 0xff0055, 28);
              window.soundFX.playCrash();
              this.addFloatingText('💥 התנגשות במכשול! עצור במוסך לתיקון והחלפת חלקים!');
              if (p.health <= 0) {
                this.triggerCrashRevive('הרכב הושבת מפגיעה במכשולים!');
                return;
              }
            }
          }
        }
      }
    }

    // Spike strips: change lane or jump over them. A hit punctures the tyres (slower until the garage swaps wheels).
    if (this.sceneRefs.spikeMeshes && !autoPit && p.invulnerableTimer <= 0) {
      for (const { data: s } of this.sceneRefs.spikeMeshes) {
        if (!s.active) continue;
        if (Math.abs(p.z - s.z) < s.length / 2 + 1.2 && Math.abs(p.laneX - s.laneX) < s.width / 2 + 0.9) {
          const gy = this.track.getHeightAt(s.z);
          if (p.y - gy < s.height - 0.1) {
            s.active = false;
            if (this.hitSpikes(s)) return;
          }
        }
      }
    }

    // Gas stations & garages: the car rolls into the station by itself, then the crew works while you answer.
    if (!autoPit && p.onGround && !p.inLoop) {
      for (const st of this.track.stations) {
        if (st.visited || st.skipped) continue;
        const d = st.z - p.z;
        if (d > 0 && d < 190) {
          if (st.type === 'fuel' && p.fuel > p.maxFuel * 0.75) {
            st.skipped = true;
            this.addFloatingText('⛽ הדלק עוד מלא, ממשיכים הלאה!');
            continue;
          }
          this.engagePit(st);
          break;
        }
      }
    }

    // Arrived in the bay?
    if (autoPit) {
      const T = this.pitTarget;
      if (T.z - p.z < 0.5 || (p.vz < 1.5 && T.z - p.z < 4)) {
        p.z = T.z;
        p.laneX = T.laneX;
        p.vz = 0;
        this.syncVehicle3DTransform(p, dt, false);
        this.beginPitService();
        return;
      }
    }

    window.soundFX.updateEngineRPM(p.vz / p.maxSpeed, isBoosting, p.veh.isFlyingTesla);

    if (this.netChannel && Math.random() < 0.25) {
      this.netChannel.postMessage({
        type: 'pos',
        peerId: this.peerId,
        name: window.playerStore.state.playerName,
        vehId: p.veh.id,
        z: p.z,
        laneX: p.laneX,
        vz: p.vz
      });
    }

    this.syncVehicle3DTransform(p, dt, isBoosting);
    this.updateRivals3D(dt);
    this.checkRaceFinish();
  }

  syncVehicle3DTransform(entity, dt, isBoosting = false) {
    const worldX = this.track.getCurveXAt(entity.z) + entity.laneX;
    const heading = this.track.getHeadingAt(entity.z);

    entity.meshObj.root.position.set(worldX, entity.y, entity.z);
    entity.meshObj.root.rotation.set(entity.pitch || 0, heading, entity.roll || 0);

    const wheelSpeed = (entity.vz || 0) * 0.35 * dt;
    entity.meshObj.wheels.forEach(w => {
      w.rotation.x += wheelSpeed;
    });

    entity.meshObj.flameMeshes.forEach(fl => {
      const scaleZ = isBoosting ? 2.1 + Math.random() * 0.8 : 0.65 + Math.random() * 0.3;
      fl.scale.set(1, scaleZ, 1);
      fl.visible = (entity.vz || 0) > 5;
    });

    if (entity.id === 'player' && (entity.vz || 0) > 15 && dt > 0 && Math.random() < 0.78) {
      this.spawnExhaustTrailShard(worldX, entity.y, entity.z, isBoosting);
    }

    if (entity.meshObj.shieldMesh) {
      entity.meshObj.shieldMesh.visible = Boolean(entity.shieldActive);
      entity.meshObj.shieldMesh.rotation.y += 2.2 * dt;
    }
  }

  updateRivals3D(dt) {
    this.rivals.forEach((r, idx) => {
      if (r.finished) return;
      if (r.isOnlinePeer) {
        const peerData = this.onlinePeers.get(r.id);
        if (peerData) {
          r.z += (peerData.z - r.z) * 0.25;
          r.laneX += ((peerData.laneX || 0) - r.laneX) * 0.2;
          r.vz = peerData.vz || 85;
        } else {
          r.z += r.baseSpeed * dt;
        }
      } else {
        const distDiff = this.player.z - r.z;
        let rubberBand = 1.0;
        if (distDiff > 160) rubberBand = 1.15;
        else if (distDiff < -140) rubberBand = 0.85;

        const targetSpeed = r.baseSpeed * rubberBand;
        r.vz += (targetSpeed - r.vz) * 2.5 * dt;
        r.z += r.vz * dt;
        r.laneX += (Math.sin(r.z * 0.008 + idx * 2) * 5.5 - r.laneX) * 2 * dt;
      }

      r.y = this.track.getHeightAt(r.z);
      r.pitch = -this.track.getSlopeAt(r.z);
      r.roll = 0;

      this.syncVehicle3DTransform(r, dt, false);

      if (r.z >= this.track.length) {
        r.finished = true;
        r.finishTimeMs = this.raceElapsedMs;
      }
    });
  }

  renderRaceWorld3D(ts, dt) {
    const p = this.player;
    if (!p || !this.track) return;

    if (this.sceneRefs) {
      this.sceneRefs.fireRingMeshes.forEach(({ outerFlame }) => {
        outerFlame.rotation.z += 3.8 * dt;
      });
      this.sceneRefs.skyObsMeshes.forEach(({ mesh }) => {
        mesh.rotation.y += 2.6 * dt;
        mesh.rotation.x += 1.6 * dt;
      });
    }

    // Decay FOV punch exponentially (per game-feel.md)
    if (this.fovPunch > 0.01) {
      this.fovPunch *= Math.exp(-dt / 0.22);
      if (this.fovPunch < 0.01) this.fovPunch = 0;
    }

    const playerWorldX = this.track.getCurveXAt(p.z) + p.laneX;
    const roadHeading = this.track.getHeadingAt(p.z);

    const svcCtrl = this.pitTarget && this.pitTarget.ctrl;
    if (
      this.state === 'pit_service' &&
      svcCtrl &&
      svcCtrl.serviceCamera &&
      this.panel &&
      this.panel.step === 'service'
    ) {
      // The pit module knows where the action is: cinematic camera for the running service.
      svcCtrl.serviceCamera(this.panel.serviceKind, this.panel.serviceU || 0, this.camera);
      this.camera.fov += (48 - this.camera.fov) * Math.min(1, 6 * dt);
    } else if (this.state === 'pit_service' && this.pitTarget) {
      // Pit camera: front quarter view from the inner side, slowly swaying, looking at the car and its crew.
      this.pitCamTime += dt;
      const inner = this.pitTarget.laneX < 0 ? 1 : -1;
      const sway = Math.sin(this.pitCamTime * 0.45) * 0.55;
      const lx = inner * (6.6 + sway);
      const lz = 7.4 + Math.cos(this.pitCamTime * 0.37) * 0.8;
      const c = Math.cos(roadHeading);
      const sn = Math.sin(roadHeading);
      this.camera.position.set(playerWorldX + lx * c + lz * sn, p.y + 3.2, p.z - lx * sn + lz * c);
      const tx = -inner * 1.7;
      this.camera.lookAt(playerWorldX + tx * c, p.y + 1.15, p.z - tx * sn);
      this.camera.fov += (50 - this.camera.fov) * Math.min(1, 6 * dt);
    } else if (this.state === 'paused_modal') {
      const orbitAngle = ts * 0.00075;
      const camX = playerWorldX + Math.sin(orbitAngle) * 7.4;
      const camZ = p.z + Math.cos(orbitAngle) * 7.4;
      this.camera.position.set(camX, p.y + 3.0, camZ);
      this.camera.lookAt(playerWorldX, p.y + 1.0, p.z);
      this.camera.fov += (55 - this.camera.fov) * Math.min(1, 6 * dt);
    } else if (this.cameraMode === 3 && !p.inSkyMode) {
      // Driver cam: the camera rides in front of the car and looks back at the driver (shows the player's photo).
      const c = Math.cos(roadHeading);
      const sn = Math.sin(roadHeading);
      const dm = p.meshObj.dims || { length: 5, height: 1.6 };
      const lx = 0.45;
      const lz = dm.length * 0.5 + 1.8;
      const camGoalX = playerWorldX + lx * c + lz * sn;
      const camGoalZ = p.z - lx * sn + lz * c;
      this.camera.position.set(camGoalX, p.y + dm.height + 0.95, camGoalZ);
      const head = p.meshObj.driver && p.meshObj.driver.head;
      if (head) {
        head.getWorldPosition(this._tmpV);
        this.camera.lookAt(this._tmpV.x, this._tmpV.y + 0.05, this._tmpV.z);
      } else {
        this.camera.lookAt(playerWorldX, p.y + 1.4, p.z);
      }
      this.camera.fov += (40 + (p.vz / p.maxSpeed) * 5 + this.fovPunch - this.camera.fov) * Math.min(1, 8 * dt);
    } else if (this.cameraMode === 2) {
      // First-Person Cockpit / Hood Camera
      this.camera.fov = 72 + this.fovPunch;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(
        playerWorldX + Math.sin(roadHeading) * 1.25,
        p.y + 1.75,
        p.z + Math.cos(roadHeading) * 1.25
      );
      const lookZ = p.z + 45;
      const lookX = this.track.getCurveXAt(lookZ) + p.laneX;
      const lookY = p.inSkyMode ? p.y : this.track.getHeightAt(lookZ) + 1.4;
      this.camera.lookAt(lookX, lookY, lookZ);
    } else {
      const isClose = this.cameraMode === 1;
      const distBack = isClose ? 6.8 : 9.8;
      const heightUp = isClose ? 2.8 : 4.1;

      const speedFov = this.baseFov + (p.vz / p.maxSpeed) * 14 + this.fovPunch;
      this.camera.fov += (speedFov - this.camera.fov) * 10 * dt;
      this.camera.updateProjectionMatrix();

      const targetCamX = playerWorldX - Math.sin(roadHeading) * distBack;
      const targetCamY = p.y + heightUp;
      const targetCamZ = p.z - distBack;

      const camDelta = Math.hypot(targetCamX - this.camera.position.x, targetCamY - this.camera.position.y);
      if (camDelta > 12 || dt === 0) {
        this.camera.position.set(targetCamX, targetCamY, targetCamZ);
      } else {
        this.camera.position.x += (targetCamX - this.camera.position.x) * 14 * dt;
        this.camera.position.y += (targetCamY - this.camera.position.y) * 14 * dt;
        this.camera.position.z = targetCamZ;
      }

      const lookAheadZ = p.z + 24;
      const lookAheadX = this.track.getCurveXAt(lookAheadZ) + p.laneX * 0.65;
      const lookAheadY = p.y + 1.45;
      this.camera.lookAt(lookAheadX, lookAheadY, lookAheadZ);
    }

    // When the question panel is open, slide the 3D picture away from it so the crew stays in view.
    const panelOn = (this.state === 'pit_service' || this.state === 'paused_modal') && this.panel;
    const narrow = window.innerWidth <= 900;
    const wantShift = panelOn ? (narrow ? 0.2 : 0.17) : 0;
    this.camShift += (wantShift - this.camShift) * Math.min(1, 7 * Math.max(dt, 0.016));
    if (this.camShift > 0.002) {
      const fw = window.innerWidth;
      const fh = window.innerHeight;
      this.camera.setViewOffset(fw, fh, narrow ? 0 : fw * this.camShift, narrow ? fh * this.camShift : 0, fw, fh);
      this.camShiftActive = true;
    } else if (this.camShiftActive) {
      this.camera.clearViewOffset();
      this.camShiftActive = false;
    }
    this.camera.updateProjectionMatrix();

    // Apply Trauma-Based Camera Shake AFTER base camera transform!
    this.shakeRig.update(dt, this.camera);

    // Render 3D Scene with UnrealBloomPass Post-Processing!
    this.renderMainScene();

    // 2D Overlay Canvas for Speed Streaks, Countdown & Floating Announcements
    const ctx = this.fxctx;
    const w = this.gameCanvas.width;
    const h = this.gameCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // High-speed radial wind streaks around screen edges when boosting/fast
    if (this.state === 'racing' && p.vz > p.maxSpeed * 0.92) {
      const intensity = Math.min(1, (p.vz - p.maxSpeed * 0.9) / (p.maxSpeed * 0.5));
      ctx.save();
      ctx.strokeStyle = p.inSkyMode ? 'rgba(255, 215, 0, 0.35)' : 'rgba(0, 240, 255, 0.28)';
      ctx.lineWidth = 2;
      ctx.globalAlpha = intensity;
      for (let i = 0; i < 14; i++) {
        const ang = ((i / 14) * Math.PI * 2) + (ts * 0.003);
        const rInner = Math.min(w, h) * 0.36;
        const rOuter = Math.max(w, h) * 0.65;
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(ang) * rInner, h / 2 + Math.sin(ang) * rInner);
        ctx.lineTo(w / 2 + Math.cos(ang) * rOuter, h / 2 + Math.sin(ang) * rOuter);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 42 * dt;
      ft.life -= 0.55 * dt;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = ft.life;
      ctx.fillStyle = '#ffd700';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4;
      ctx.font = '900 24px Rubik, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText(ft.text, w / 2, ft.y);
      ctx.fillText(ft.text, w / 2, ft.y);
      ctx.restore();
    }

    if (this.state === 'countdown') {
      ctx.save();
      ctx.fillStyle = 'rgba(4, 7, 18, 0.45)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 28;
      ctx.font = '900 110px Orbitron, Rubik';
      ctx.textAlign = 'center';
      ctx.fillText(this.countdownVal > 0 ? this.countdownVal : 'GO!', w / 2, h / 2);
      ctx.restore();
    }
  }

  addFloatingText(text) {
    this.floatingTexts.push({
      text,
      y: window.innerHeight * 0.34,
      life: 1.0
    });
  }

  checkRaceFinish() {
    if (this.player.z >= this.track.length && !this.player.finished) {
      this.player.finished = true;
      this.player.finishTimeMs = Math.max(1000, this.raceElapsedMs - this.bonusTimeSavedSec * 1000);
      this.completeRace();
    }
  }

  // ==========================================================================
  // Math Modals: Gas Station, Parts Pit-Stop, Crash Revive & AI Video Tutor
  // ==========================================================================
  triggerCrashRevive(reasonText) {
    window.soundFX.playCrash();
    this.openMathModal('revive', { name: reasonText });
  }

  openMathModal(type, stationObj) {
    this.state = 'paused_modal';
    this.modalContext = type;
    window.soundFX.stopEngineSound();
    window.mathEngine.stopVideoTutorial();

    const grade = window.playerStore.state.mathGrade || 'mid';
    this.currentQuestion = window.mathEngine.generateQuestion(grade);

    const backdrop = document.getElementById('math-modal-backdrop');
    const modalBox = document.getElementById('math-modal-box');
    const tagEl = document.getElementById('math-modal-tag');
    const titleEl = document.getElementById('math-modal-title');
    const subEl = document.getElementById('math-modal-sub');
    const partsWrap = document.getElementById('pit-parts-selector-wrap');
    const tutorDrawer = document.getElementById('ai-tutor-drawer');

    if (tutorDrawer) tutorDrawer.classList.remove('open');
    modalBox.className = 'cyber-modal';

    if (type === 'fuel') {
      modalBox.classList.add('fuel-theme');
      tagEl.textContent = '⛽ SHELL OCTANE 3D STATION • תחנת תדלוק';
      titleEl.textContent = stationObj?.name || 'תחנת דלק אוקטן גבוה';
      subEl.textContent = 'פתור את תרגיל החשבון כדי למלא 100% מיכל דלק ולצאת עם בוסט טורבו!';
      partsWrap.style.display = 'none';
    } else if (type === 'parts') {
      modalBox.classList.add('parts-theme');
      tagEl.textContent = '🔧 APEX 3D PIT CREW • מוסך החלפת חלקים';
      titleEl.textContent = stationObj?.name || 'מוסך החלפת חלקים ושדרוג הרכב';
      subEl.textContent = 'בחר איזה חלק להחליף ברכב וענה על השאלה בחשבון כדי שהצוות יתקין אותו מיידית:';
      partsWrap.style.display = 'block';
      this.renderPitPartsSelector();
    } else if (type === 'revive') {
      modalBox.classList.add('revive-theme');
      tagEl.textContent = '⚡ SYSTEM REBOOT • חזרה לחיים לאחר פסילה';
      titleEl.textContent = `נפסלת! (${stationObj?.name || 'התרסקות במסלול'})`;
      subEl.textContent = 'פתור את התרגיל בחשבון כדי לתקן את הרכב ולחזור למרוץ מיידית!';
      partsWrap.style.display = 'none';
    }

    document.getElementById('math-q-topic').textContent = `נושא: ${this.currentQuestion.topic}`;
    document.getElementById('math-q-prompt').textContent = this.currentQuestion.prompt;
    document.getElementById('math-q-expr').textContent = this.currentQuestion.expression;
    document.getElementById('math-feedback-msg').textContent = '';

    const ansGrid = document.getElementById('math-answers-grid');
    ansGrid.innerHTML = this.currentQuestion.options.map(opt => `
      <button class="ans-btn" onclick="window.game.submitMathAnswer(${opt}, this)">${opt}</button>
    `).join('');

    backdrop.classList.add('active');
  }

  renderPitPartsSelector() {
    const grid = document.getElementById('pit-parts-grid');
    if (!grid) return;
    grid.innerHTML = window.PIT_STOP_PARTS.map(part => `
      <div class="part-option ${this.selectedPitPart === part.id ? 'selected' : ''}"
           onclick="window.game.selectPitPart('${part.id}')">
        <div style="font-size:1.6rem;">${part.icon}</div>
        <div style="font-weight:800;font-size:0.86rem;margin-top:4px;">${part.name}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${part.desc}</div>
      </div>
    `).join('');
  }

  selectPitPart(partId) {
    this.selectedPitPart = partId;
    window.soundFX.playTone(580, 0.08, 'triangle', 0.1);
    this.renderPitPartsSelector();
  }

  submitMathAnswer(chosenVal, btnEl) {
    if (!this.currentQuestion) return;
    const isCorrect = Number(chosenVal) === Number(this.currentQuestion.answer);
    const feedbackEl = document.getElementById('math-feedback-msg');

    if (isCorrect) {
      btnEl.classList.add('correct');
      window.soundFX.playCorrectAnswer();
      window.playerStore.state.correctMathCount++;
      window.playerStore.save();

      feedbackEl.style.color = 'var(--neon-lime)';
      feedbackEl.textContent = '✓ תשובה מדויקת! המערכות טעונות — יוצאים לדרך!';

      setTimeout(() => {
        this.applyModalRewardAndResume();
      }, 650);
    } else {
      btnEl.classList.add('wrong');
      window.soundFX.playWrongAnswer();
      feedbackEl.style.color = 'var(--neon-amber)';
      feedbackEl.textContent = '❌ לא מדויק! פתחתי עבורך את הסבר ה-AI וסרטון ההדגמה לתרגיל דומה כדי לעזור לך לפתור:';
      this.openAITutorVideo();
    }
  }

  openAITutorVideo() {
    if (!this.currentQuestion || !this.currentQuestion.similar) return;
    const drawer = document.getElementById('ai-tutor-drawer');
    if (!drawer) return;
    drawer.classList.add('open');

    const sim = this.currentQuestion.similar;
    document.getElementById('ai-tutor-title').textContent = `🤖 ${sim.title} (דוגמה: ${sim.exampleExpr})`;
    document.getElementById('ai-tutor-tip').textContent = `💡 טיפ ה-AI: ${sim.aiTip}`;

    const dotsWrap = document.getElementById('tutor-step-dots');
    const updateDots = activeIdx => {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = sim.steps.map((s, idx) => `
        <span class="step-dot ${idx === activeIdx ? 'active' : ''}"
              onclick="window.mathEngine.setVideoStep(${idx})">שלב ${idx + 1}</span>
      `).join('');
    };
    updateDots(0);

    const canvasEl = document.getElementById('tutor-video-canvas');
    window.mathEngine.startVideoTutorial(sim, canvasEl, stepIdx => updateDots(stepIdx));
  }

  applyModalRewardAndResume() {
    window.mathEngine.stopVideoTutorial();
    document.getElementById('math-modal-backdrop').classList.remove('active');

    const p = this.player;
    this.punchFov(8);
    this.shakeRig.addTrauma(0.3);

    if (this.modalContext === 'fuel') {
      p.fuel = p.maxFuel;
      p.nitro = Math.min(100, p.nitro + 50);
      p.vz = p.maxSpeed * 1.24;
      this.addFloatingText('⛽ מיכל דלק מלא 100% + בוסט יציאה!');
    } else if (this.modalContext === 'parts') {
      const part = window.PIT_STOP_PARTS.find(x => x.id === this.selectedPitPart) || window.PIT_STOP_PARTS[0];
      p.health = 100;
      p.fuel = Math.min(p.maxFuel, p.fuel + 35);
      if (part.bonusType === 'speed') {
        p.maxSpeed += 12;
      } else if (part.bonusType === 'nitro') {
        p.nitro = 100;
        p.vz = p.maxSpeed * 1.36;
      } else if (part.bonusType === 'shield') {
        p.shieldActive = true;
      }
      p.vz = Math.max(p.vz, p.maxSpeed * 1.2);
      this.addFloatingText(`🔧 הותקן במוסך: ${part.name}!`);
    } else if (this.modalContext === 'revive') {
      p.health = 100;
      p.fuel = Math.max(p.fuel, p.maxFuel * 0.65);
      p.y = this.track.getHeightAt(p.z);
      p.vy = 0;
      p.pitch = 0;
      p.roll = 0;
      p.onGround = true;
      p.invulnerableTimer = 3.0;
      p.vz = p.maxSpeed * 0.92;
      this.addFloatingText('⚡ חזרת לחיים! מערכות משוחזרות 100%!');
    }

    this.state = 'racing';
    window.soundFX.startEngineSound(p.veh.isFlyingTesla);
  }

  // ==========================================================================
  // Race Completion & Exact Placement Rewards (200 / 150 / 100 / 50)
  // ==========================================================================
  completeRace() {
    this.state = 'finished';
    window.soundFX.stopEngineSound();
    window.soundFX.playVictory();

    const st = window.playerStore.state;
    const allStandings = [];

    if (st.selectedMode === 'time_trial') {
      const targetSec = this.track.config.targetTimeSec || 72;
      const mySec = this.player.finishTimeMs / 1000;
      let rank = 1;
      if (mySec > targetSec + 12) rank = 4;
      else if (mySec > targetSec + 5) rank = 3;
      else if (mySec > targetSec) rank = 2;

      allStandings.push({
        name: `${this.player.name} (זמן נטו: ${mySec.toFixed(1)} שנ׳)`,
        isMe: true,
        rank
      });
    } else {
      const racers = [
        { name: this.player.name, isMe: true, scoreZ: this.player.z, finishTimeMs: this.player.finishTimeMs },
        ...this.rivals.map(r => ({
          name: r.name,
          isMe: false,
          scoreZ: r.z,
          finishTimeMs: r.finished ? r.finishTimeMs : this.raceElapsedMs + (this.track.length - r.z) * 12
        }))
      ];
      racers.sort((a, b) => a.finishTimeMs - b.finishTimeMs);
      racers.forEach((r, idx) => {
        r.rank = idx + 1;
        allStandings.push(r);
      });
    }

    const myEntry = allStandings.find(x => x.isMe) || { rank: 1 };
    const place = myEntry.rank;

    const earnedPoints = window.PLACEMENT_REWARDS[place] || window.PLACEMENT_REWARDS.default;

    st.racesPlayed++;
    if (place === 1) st.wins++;
    window.playerStore.addPoints(earnedPoints);

    const rankLabels = {
      1: '🥇 מקום ראשון! ניצחון אדיר!',
      2: '🥈 מקום שני! מרוץ מעולה!',
      3: '🥉 מקום שלישי! על הפודיום!',
      4: '🏁 סיימת את המרוץ!'
    };
    document.getElementById('podium-headline').textContent = rankLabels[place] || rankLabels[4];
    document.getElementById('podium-points-earned').textContent = `+${earnedPoints} נקודות`;
    document.getElementById('podium-flips-stat').textContent = `${this.player.flipsCount} סלטות (-${this.bonusTimeSavedSec.toFixed(1)} שנ׳)`;

    const listEl = document.getElementById('podium-standings-list');
    if (listEl) {
      listEl.innerHTML = allStandings.map(r => {
        const pts = window.PLACEMENT_REWARDS[r.rank] || window.PLACEMENT_REWARDS.default;
        return `
          <div class="podium-row ${r.isMe ? 'me' : ''}">
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="font-family:var(--font-display);font-weight:900;font-size:1.2rem;color:var(--neon-cyan)">#${r.rank}</span>
              <span style="font-weight:800;">${r.name}</span>
            </div>
            <div style="font-family:var(--font-display);color:#ffd700;font-weight:800;">+${pts} PTS</div>
          </div>
        `;
      }).join('');
    }

    document.getElementById('podium-modal-backdrop').classList.add('active');
    this.refreshAllUI();
  }

  closePodiumAndGo(targetScreen) {
    document.getElementById('podium-modal-backdrop').classList.remove('active');
    if (targetScreen === 'replay') {
      this.startRace();
    } else {
      this.showScreen(targetScreen);
    }
  }

  updateHUD() {
    const p = this.player;
    if (!p) return;

    const fuelFill = document.getElementById('hud-fuel-fill');
    const fuelBar = document.getElementById('hud-fuel-bar');
    const nitroFill = document.getElementById('hud-nitro-fill');
    const healthFill = document.getElementById('hud-health-fill');

    const fuelPct = Math.round((p.fuel / p.maxFuel) * 100);
    if (fuelFill) fuelFill.style.width = `${Math.max(0, Math.min(100, fuelPct))}%`;
    if (fuelBar) fuelBar.classList.toggle('low-warning', fuelPct <= 25);
    if (nitroFill) nitroFill.style.width = `${Math.round(p.nitro)}%`;
    if (healthFill) healthFill.style.width = `${Math.round(p.health)}%`;

    const speedKmh = Math.round(Math.abs(p.vz) * 2.1);
    const speedEl = document.getElementById('hud-speed-val');
    if (speedEl) speedEl.textContent = speedKmh;

    // Update Radial SVG Tachometer Arc & Gear Indicator (per threejs-game-ui-designer)
    const tachArc = document.getElementById('hud-tach-arc');
    if (tachArc) {
      const ratio = Math.min(1, Math.abs(p.vz) / (p.maxSpeed * 1.35));
      const maxDash = 180;
      tachArc.style.strokeDashoffset = `${maxDash - ratio * maxDash}`;
      tachArc.setAttribute('stroke', ratio > 0.85 ? '#ff0055' : ratio > 0.6 ? '#ffaa00' : '#00f0ff');
    }
    const gearEl = document.getElementById('hud-gear-val');
    if (gearEl) {
      if (p.inSkyMode) gearEl.textContent = 'S';
      else if (speedKmh < 5) gearEl.textContent = 'N';
      else gearEl.textContent = Math.min(6, Math.max(1, Math.ceil(speedKmh / 52)));
    }

    let rank = 1;
    this.rivals.forEach(r => {
      if (r.z > p.z) rank++;
    });
    const placeEl = document.getElementById('hud-place-val');
    if (placeEl) placeEl.textContent = `${rank}/${this.rivals.length + 1}`;

    const playerDot = document.getElementById('hud-player-dot');
    if (playerDot && this.track) {
      playerDot.style.left = `${Math.min(99, Math.max(1, (p.z / this.track.length) * 100))}%`;
    }
    this.rivals.forEach(r => {
      const dot = document.getElementById(`minimap_dot_${r.id}`);
      if (dot && this.track) {
        dot.style.left = `${Math.min(99, Math.max(1, (r.z / this.track.length) * 100))}%`;
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new ApexOverdrive3DGame();

  // Official QA Release & Game Director Test Hooks (per evidence-manifest.md)
  window.__THREE_GAME_TEST_HOOKS__ = {
    seed: s => {
      window.__GAME_SEED__ = s;
    },
    setPausedForScreenshot: paused => {
      if (window.game) window.game.pausedForScreenshot = Boolean(paused);
    },
    setState: async stateName => {
      const g = window.game;
      if (!g) throw new Error('Game not initialized');
      if (stateName === 'active-play') {
        g.startRace(false);
        clearInterval(g.countdownInterval);
        g.state = 'racing';
        g.player.z = 335;
        g.player.y = g.track.getHeightAt(335);
        g.player.vz = 132;
        g.rivals.forEach((r, idx) => {
          r.z = 352 + idx * 14;
          r.y = g.track.getHeightAt(r.z);
          g.syncVehicle3DTransform(r, 0.016, false);
        });
        for (let i = 0; i < 12; i++) {
          g.spawnExhaustTrailShard(g.track.getCurveXAt(335 - i * 0.6), g.player.y, 335 - i * 0.6, true);
        }
        g.syncVehicle3DTransform(g.player, 0.016, true);
        g.renderRaceWorld3D(performance.now(), 0.016);
        g.updateHUD();
        return { state: 'active-play' };
      }
      if (stateName === 'tesla-sky') {
        g.startRace(true);
        clearInterval(g.countdownInterval);
        g.state = 'racing';
        g.tryActivateTeslaSkyMode();
        g.player.z = 410;
        g.player.vz = 165;
        g.syncVehicle3DTransform(g.player, 0.016, true);
        g.renderRaceWorld3D(performance.now(), 0.016);
        g.updateHUD();
        return { state: 'tesla-sky' };
      }
      if (stateName === 'math-pitstop') {
        g.startRace(false);
        clearInterval(g.countdownInterval);
        g.state = 'racing';
        g.player.z = 700;
        g.openMathModal('parts', g.track.stations[0]);
        g.openAITutorVideo();
        g.renderRaceWorld3D(performance.now(), 0.016);
        return { state: 'math-pitstop' };
      }
      if (stateName === 'title-showroom') {
        g.showScreen('title-screen');
        g.updateAndRenderMenu3D(performance.now(), 0.016);
        return { state: 'title-showroom' };
      }
      throw new Error(`Unknown state: ${stateName}`);
    }
  };
});
