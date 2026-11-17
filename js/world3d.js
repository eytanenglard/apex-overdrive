// ============================================================================
// APEX OVERDRIVE 3D - AAA Showcase Graphics Builder (Sculpted Extrude/Lathe
// Vehicles, Instanced Environment Kit, Double-Rail Glowing Highway, 3D Speed
// Streaks, PMREM Studio IBL, GLSL Sky Dome & Vertex-Displaced Valley Terrain)
// Built per threejs-aaa-graphics-builder, threejs-performance & shader-cookbook
// ============================================================================

class World3DFactory {
  constructor() {
    this.textures = {};
    this.envMap = null;
    this.quality = 'high';
    this.renderer = null;
  }

  initRendererAndIBL(renderer, scene) {
    this.renderer = renderer;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = this.quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Bake realistic studio + horizon IBL environment map via PMREMGenerator
    if (!this.envMap && THREE.PMREMGenerator) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();

      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x0c1428);

      // Overhead softbox studio strips (creates realistic automotive paint reflections)
      const stripGeo = new THREE.PlaneGeometry(44, 10);
      const stripMat1 = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      const strip1 = new THREE.Mesh(stripGeo, stripMat1);
      strip1.position.set(0, 22, 0);
      strip1.rotation.x = Math.PI / 2;
      envScene.add(strip1);

      const stripMat2 = new THREE.MeshBasicMaterial({ color: 0x00f0ff, side: THREE.DoubleSide });
      const strip2 = new THREE.Mesh(stripGeo, stripMat2);
      strip2.position.set(-24, 10, 10);
      strip2.rotation.y = Math.PI / 2;
      envScene.add(strip2);

      const stripMat3 = new THREE.MeshBasicMaterial({ color: 0xff6b00, side: THREE.DoubleSide });
      const strip3 = new THREE.Mesh(stripGeo, stripMat3);
      strip3.position.set(24, 10, -10);
      strip3.rotation.y = -Math.PI / 2;
      envScene.add(strip3);

      this.envMap = pmrem.fromScene(envScene, 0.04).texture;
      pmrem.dispose();
    }

    if (scene && this.envMap) {
      scene.environment = this.envMap;
    }

    this.initTextures(renderer);
  }

  initTextures(renderer) {
    if (this.textures.asphalt) return;
    const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;

    // 1. High-Detail 1024x1024 Showcase Asphalt + Neon Bay Grids + Directional Chevrons
    const roadCanvas = document.createElement('canvas');
    roadCanvas.width = 1024;
    roadCanvas.height = 1024;
    const rctx = roadCanvas.getContext('2d');

    rctx.fillStyle = '#121722';
    rctx.fillRect(0, 0, 1024, 1024);

    // Fine tarmac micro-grain
    for (let i = 0; i < 20000; i++) {
      const gx = Math.random() * 1024;
      const gy = Math.random() * 1024;
      const v = 16 + Math.floor(Math.random() * 26);
      rctx.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
      rctx.fillRect(gx, gy, 2, 3);
    }

    // Polished tire racing groove + Neon Grid Bay Frames in each of the 3 lanes (matches scene-3 showcase!)
    const laneCenters = [216, 512, 808];
    laneCenters.forEach(lx => {
      const grad = rctx.createLinearGradient(lx - 110, 0, lx + 110, 0);
      grad.addColorStop(0, 'rgba(0, 240, 255, 0.08)');
      grad.addColorStop(0.15, 'rgba(8, 14, 26, 0.55)');
      grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.12)');
      grad.addColorStop(0.85, 'rgba(8, 14, 26, 0.55)');
      grad.addColorStop(1, 'rgba(0, 240, 255, 0.08)');
      rctx.fillStyle = grad;
      rctx.fillRect(lx - 110, 0, 220, 1024);

      // Glowing cyber-grid bay rectangles per lane
      rctx.strokeStyle = 'rgba(0, 240, 255, 0.42)';
      rctx.lineWidth = 3;
      for (let by = 24; by < 1024; by += 256) {
        rctx.strokeRect(lx - 102, by, 204, 212);

        // Directional chevron arrow inside each lane bay
        rctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        rctx.lineWidth = 4;
        rctx.beginPath();
        rctx.moveTo(lx - 32, by + 125);
        rctx.lineTo(lx, by + 95);
        rctx.lineTo(lx + 32, by + 125);
        rctx.stroke();
        rctx.strokeStyle = 'rgba(0, 240, 255, 0.42)';
        rctx.lineWidth = 3;
      }
    });

    // Serrated FIA Red & Cyan Racing Curbs on both edges
    const curbH = 64;
    for (let y = 0; y < 1024; y += curbH) {
      const isPrimary = (y / curbH) % 2 === 0;
      rctx.fillStyle = isPrimary ? '#00f0ff' : '#1e293b';
      rctx.fillRect(0, y, 38, curbH);
      rctx.fillRect(1024 - 38, y, 38, curbH);
    }

    // Twin Gold/Amber high-contrast lane separator rails
    rctx.fillStyle = '#fbbf24';
    rctx.fillRect(44, 0, 7, 1024);
    rctx.fillRect(1024 - 51, 0, 7, 1024);
    rctx.fillRect(356, 0, 5, 1024);
    rctx.fillRect(368, 0, 5, 1024);
    rctx.fillRect(651, 0, 5, 1024);
    rctx.fillRect(663, 0, 5, 1024);

    const asphaltTex = new THREE.CanvasTexture(roadCanvas);
    asphaltTex.wrapS = THREE.RepeatWrapping;
    asphaltTex.wrapT = THREE.RepeatWrapping;
    asphaltTex.anisotropy = maxAniso;
    this.textures.asphalt = asphaltTex;

    // 2. High-Rise Glass Curtain-Wall Building Texture with Neon Edge Trim
    const bldgCanvas = document.createElement('canvas');
    bldgCanvas.width = 256;
    bldgCanvas.height = 512;
    const bctx = bldgCanvas.getContext('2d');
    bctx.fillStyle = '#070b14';
    bctx.fillRect(0, 0, 256, 512);
    // Glowing architectural corner trim
    bctx.fillStyle = 'rgba(0, 240, 255, 0.45)';
    bctx.fillRect(0, 0, 4, 512);
    bctx.fillRect(252, 0, 4, 512);

    for (let r = 10; r < 500; r += 16) {
      for (let c = 10; c < 244; c += 20) {
        const rand = Math.random();
        if (rand > 0.52) {
          bctx.fillStyle = rand > 0.84 ? '#fde047' : rand > 0.66 ? '#00f0ff' : '#94a3b8';
          bctx.fillRect(c, r, 13, 9);
        } else {
          bctx.fillStyle = '#0f172a';
          bctx.fillRect(c, r, 13, 9);
        }
      }
    }
    const bldgTex = new THREE.CanvasTexture(bldgCanvas);
    bldgTex.wrapS = THREE.RepeatWrapping;
    bldgTex.wrapT = THREE.RepeatWrapping;
    this.textures.building = bldgTex;

    // 3. Checkered Flag Gantry Texture
    const chkCanvas = document.createElement('canvas');
    chkCanvas.width = 512;
    chkCanvas.height = 128;
    const cctx = chkCanvas.getContext('2d');
    for (let y = 0; y < 128; y += 32) {
      for (let x = 0; x < 512; x += 32) {
        cctx.fillStyle = ((x + y) / 32) % 2 === 0 ? '#ffffff' : '#090d16';
        cctx.fillRect(x, y, 32, 32);
      }
    }
    this.textures.checker = new THREE.CanvasTexture(chkCanvas);
  }

  createSignTexture(textMain, textSub, bgColor, borderColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 504, 120);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 34px Rubik, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(textMain, 256, 56);

    ctx.fillStyle = borderColor;
    ctx.font = '700 22px Rubik, sans-serif';
    ctx.fillText(textSub, 256, 98);

    return new THREE.CanvasTexture(canvas);
  }

  // ==========================================================================
  // Sculpted Automotive & Superbike Factory (ExtrudeGeometry + LatheGeometry)
  // ==========================================================================
  createVehicle3D(vehConfig, equippedAccessories = []) {
    const root = new THREE.Group();
    const bodyGroup = new THREE.Group();
    root.add(bodyGroup);

    const hasNeon = equippedAccessories.includes('neon_cyan_glow') || vehConfig.isFlyingTesla;
    const hasGoldRims = equippedAccessories.includes('gold_rims') || vehConfig.isFlyingTesla;
    const hasPlasmaFlame = equippedAccessories.includes('plasma_flame');

    // PBR Clearcoat Automotive Paint Material (per shader-cookbook.md)
    const carPaintMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(vehConfig.color),
      metalness: 0.38,
      roughness: 0.18,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMap: this.envMap,
      envMapIntensity: 1.5
    });

    const secondaryPaintMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(vehConfig.secondaryColor || '#1e293b'),
      metalness: 0.55,
      roughness: 0.24,
      clearcoat: 0.85,
      envMap: this.envMap
    });

    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x11151c,
      metalness: 0.5,
      roughness: 0.38,
      envMap: this.envMap
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x071120,
      metalness: 0.15,
      roughness: 0.05,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.88,
      envMap: this.envMap,
      envMapIntensity: 1.9
    });

    const rimMat = new THREE.MeshStandardMaterial({
      color: hasGoldRims ? 0xffd700 : 0xe2e8f0,
      metalness: 0.92,
      roughness: 0.15,
      envMap: this.envMap
    });

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x0d0f12,
      roughness: 0.88,
      metalness: 0.06
    });

    const brakeRotorMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.3,
      envMap: this.envMap
    });

    const caliperMat = new THREE.MeshStandardMaterial({
      color: 0xff0055,
      emissive: 0xff0055,
      emissiveIntensity: 0.65,
      roughness: 0.25
    });

    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x93c5fd,
      emissiveIntensity: 3.2
    });

    const taillightMat = new THREE.MeshStandardMaterial({
      color: 0xff1144,
      emissive: 0xff0044,
      emissiveIntensity: 3.4
    });

    const telemetryBeaconMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: vehConfig.isFlyingTesla ? 0xffd700 : 0x00f0ff,
      emissiveIntensity: 3.2
    });

    const wheels = [];
    const flameMeshes = [];
    let wingsGroup = null;

    if (!this.vGeos) {
      const shadowDiscGeo = new THREE.PlaneGeometry(3.2, 5.4);
      shadowDiscGeo.rotateX(-Math.PI / 2);
      const holoRingGeo = new THREE.TorusGeometry(1.85, 0.045, 8, 40);
      holoRingGeo.rotateX(Math.PI / 2);
      this.vGeos = {
        wheels: {},
        roofBeacon: new THREE.BoxGeometry(1.42, 0.12, 0.24),
        splitter: new THREE.BoxGeometry(2.64, 0.09, 0.75),
        diffuser: new THREE.BoxGeometry(2.48, 0.28, 0.55),
        intake: new THREE.BoxGeometry(0.12, 0.42, 0.85),
        wingBlade: new THREE.BoxGeometry(2.68, 0.08, 0.52),
        endPlate: new THREE.BoxGeometry(0.06, 0.34, 0.62),
        pylon: new THREE.BoxGeometry(0.08, 0.48, 0.32),
        hl: new THREE.BoxGeometry(0.56, 0.12, 0.18),
        tailStrip: new THREE.BoxGeometry(2.38, 0.14, 0.12),
        nozzle: new THREE.CylinderGeometry(0.15, 0.15, 0.38, 16),
        thrRing: new THREE.TorusGeometry(0.2, 0.045, 10, 24),
        flame: new THREE.ConeGeometry(0.24, 1.55, 14),
        shadowDisc: shadowDiscGeo,
        holoRing: holoRingGeo,
        shield: new THREE.SphereGeometry(3.15, 24, 20)
      };
    }

    // Helper: Build Sculpted Multi-Spoke Racing Wheel with Shared Cached Geometries
    const buildWheelAssembly = (radius, width, isFront) => {
      const key = `${radius}_${width}`;
      if (!this.vGeos.wheels[key]) {
        const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 24);
        tireGeo.rotateZ(Math.PI / 2);
        const dishGeo = new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, width + 0.02, 20);
        dishGeo.rotateZ(Math.PI / 2);
        const spokeGeo = new THREE.BoxGeometry(width + 0.04, radius * 1.32, 0.065);
        const rotorGeo = new THREE.CylinderGeometry(radius * 0.52, radius * 0.52, width * 0.4, 16);
        rotorGeo.rotateZ(Math.PI / 2);
        const caliperGeo = new THREE.BoxGeometry(width * 0.65, radius * 0.34, radius * 0.26);
        this.vGeos.wheels[key] = { tireGeo, dishGeo, spokeGeo, rotorGeo, caliperGeo };
      }
      const wg = this.vGeos.wheels[key];
      const wGroup = new THREE.Group();

      const tire = new THREE.Mesh(wg.tireGeo, tireMat);
      tire.castShadow = true;
      wGroup.add(tire);
      wGroup.add(new THREE.Mesh(wg.dishGeo, rimMat));

      for (let s = 0; s < 5; s++) {
        const spoke = new THREE.Mesh(wg.spokeGeo, rimMat);
        spoke.rotation.x = (s * Math.PI) / 5;
        wGroup.add(spoke);
      }

      wGroup.add(new THREE.Mesh(wg.rotorGeo, brakeRotorMat));

      const caliper = new THREE.Mesh(wg.caliperGeo, caliperMat);
      caliper.position.set(0, radius * 0.25, isFront ? -radius * 0.28 : radius * 0.28);
      wGroup.add(caliper);

      return wGroup;
    };

    if (vehConfig.kind === 'bike') {
      // ======================================================================
      // SCULPTED 3D SUPERBIKE (DUCATI PANIGALE / KAWASAKI NINJA H2R SILHOUETTE)
      // ======================================================================
      const wRadius = 0.64;
      const frontW = buildWheelAssembly(wRadius, 0.3, true);
      frontW.position.set(0, wRadius, 1.58);
      const rearW = buildWheelAssembly(wRadius, 0.42, false);
      rearW.position.set(0, wRadius, -1.42);
      bodyGroup.add(frontW, rearW);
      wheels.push(frontW, rearW);

      if (!this.vGeos.bikeFairing) {
        const fairingShape = new THREE.Shape();
        fairingShape.moveTo(-1.55, 1.05);
        fairingShape.quadraticCurveTo(-0.7, 1.15, -0.15, 0.92);
        fairingShape.quadraticCurveTo(0.45, 1.48, 1.15, 1.38);
        fairingShape.lineTo(1.75, 1.02);
        fairingShape.quadraticCurveTo(1.35, 0.65, 0.75, 0.48);
        fairingShape.lineTo(-0.55, 0.45);
        fairingShape.quadraticCurveTo(-1.1, 0.78, -1.55, 1.05);

        const fg = new THREE.ExtrudeGeometry(fairingShape, {
          depth: 0.58,
          bevelEnabled: true,
          bevelSegments: 4,
          steps: 1,
          bevelSize: 0.09,
          bevelThickness: 0.09
        });
        fg.center();
        fg.rotateY(-Math.PI / 2);
        this.vGeos.bikeFairing = fg;
        this.vGeos.bikeTube = new THREE.CylinderGeometry(0.055, 0.055, 1.45, 8);
        this.vGeos.bikeFork = new THREE.CylinderGeometry(0.05, 0.04, 1.35, 10);
        const bg = new THREE.SphereGeometry(0.36, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
        bg.scale(0.85, 0.75, 1.65);
        this.vGeos.bikeBubble = bg;
        this.vGeos.bikeHalo = new THREE.BoxGeometry(0.68, 0.12, 0.16);
        this.vGeos.bikeEye = new THREE.BoxGeometry(0.16, 0.09, 0.18);
        this.vGeos.pelvis = new THREE.SphereGeometry(0.26, 12, 10);
        this.vGeos.torso = new THREE.CylinderGeometry(0.25, 0.22, 0.78, 12);
        this.vGeos.hump = new THREE.BoxGeometry(0.32, 0.22, 0.45);
        this.vGeos.helmet = new THREE.SphereGeometry(0.27, 16, 16);
        this.vGeos.visor = new THREE.SphereGeometry(0.275, 14, 12, 0, Math.PI, 0.3, 1.1);
        this.vGeos.arm = new THREE.CylinderGeometry(0.075, 0.065, 0.68, 8);
        this.vGeos.leg = new THREE.CylinderGeometry(0.095, 0.075, 0.65, 8);
        this.vGeos.bikePipe = new THREE.CylinderGeometry(0.08, 0.09, 0.55, 12);
        this.vGeos.bikeFlame = new THREE.ConeGeometry(0.18, 1.35, 12);
      }

      const fairingMesh = new THREE.Mesh(this.vGeos.bikeFairing, carPaintMat);
      fairingMesh.position.set(0, 1.04, 0.12);
      fairingMesh.castShadow = true;
      bodyGroup.add(fairingMesh);

      [-0.32, 0.32].forEach(sideX => {
        const tube = new THREE.Mesh(this.vGeos.bikeTube, secondaryPaintMat);
        tube.position.set(sideX, 0.98, 0.2);
        tube.rotation.x = 1.15;
        bodyGroup.add(tube);

        const fork = new THREE.Mesh(this.vGeos.bikeFork, rimMat);
        fork.position.set(sideX * 0.65, 1.02, 1.25);
        fork.rotation.x = 0.42;
        bodyGroup.add(fork);
      });

      const bubble = new THREE.Mesh(this.vGeos.bikeBubble, glassMat);
      bubble.position.set(0, 1.38, 0.95);
      bubble.rotation.x = -0.35;
      bodyGroup.add(bubble);

      const haloBar = new THREE.Mesh(this.vGeos.bikeHalo, telemetryBeaconMat);
      haloBar.position.set(0, 1.32, -1.25);
      bodyGroup.add(haloBar);

      [-0.18, 0.18].forEach(lx => {
        const eye = new THREE.Mesh(this.vGeos.bikeEye, headlightMat);
        eye.position.set(lx, 1.12, 1.68);
        eye.rotation.z = lx > 0 ? -0.25 : 0.25;
        bodyGroup.add(eye);
      });

      const riderGroup = new THREE.Group();
      const suitMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.2 });

      const pelvis = new THREE.Mesh(this.vGeos.pelvis, suitMat);
      pelvis.position.set(0, 1.24, -0.35);
      riderGroup.add(pelvis);

      const torso = new THREE.Mesh(this.vGeos.torso, carPaintMat);
      torso.position.set(0, 1.56, 0.02);
      torso.rotation.x = Math.PI * 0.34;
      riderGroup.add(torso);

      const hump = new THREE.Mesh(this.vGeos.hump, secondaryPaintMat);
      hump.position.set(0, 1.72, -0.08);
      hump.rotation.x = Math.PI * 0.34;
      riderGroup.add(hump);

      const helmet = new THREE.Mesh(this.vGeos.helmet, carPaintMat);
      helmet.scale.set(0.92, 1.0, 1.18);
      helmet.position.set(0, 1.82, 0.48);
      riderGroup.add(helmet);

      const visor = new THREE.Mesh(this.vGeos.visor, glassMat);
      visor.rotation.x = -0.3;
      visor.position.set(0, 1.83, 0.51);
      riderGroup.add(visor);

      [-0.26, 0.26].forEach(ax => {
        const arm = new THREE.Mesh(this.vGeos.arm, suitMat);
        arm.position.set(ax, 1.54, 0.56);
        arm.rotation.x = Math.PI * 0.38;
        arm.rotation.z = ax > 0 ? -0.18 : 0.18;
        riderGroup.add(arm);

        const leg = new THREE.Mesh(this.vGeos.leg, suitMat);
        leg.position.set(ax * 0.95, 0.96, -0.22);
        leg.rotation.x = -0.55;
        riderGroup.add(leg);
      });

      bodyGroup.add(riderGroup);

      [-0.18, 0.18].forEach(ex => {
        const pipe = new THREE.Mesh(this.vGeos.bikePipe, brakeRotorMat);
        pipe.rotation.x = Math.PI / 2 - 0.22;
        pipe.position.set(ex, 1.08, -1.25);
        bodyGroup.add(pipe);

        const flameMat = new THREE.MeshBasicMaterial({
          color: hasPlasmaFlame ? 0xd946ef : 0x00f0ff,
          transparent: true,
          opacity: 0.92
        });
        const flame = new THREE.Mesh(this.vGeos.bikeFlame, flameMat);
        flame.rotation.x = -Math.PI / 2;
        flame.position.set(ex, 1.12, -1.95);
        bodyGroup.add(flame);
        flameMeshes.push(flame);
      });
    } else {
      // ======================================================================
      // SCULPTED 3D HYPERCAR / GT3 / RAPTOR 4X4 / FLYING TESLA ROADSTER
      // ======================================================================
      const isTruck = vehConfig.id === 'titan_buggy';
      const wRadius = isTruck ? 0.78 : 0.58;
      const wWidth = isTruck ? 0.56 : 0.44;
      const trackHalfW = isTruck ? 1.48 : 1.34;

      const wheelCoords = [
        [-trackHalfW, wRadius, 1.62, true],
        [trackHalfW, wRadius, 1.62, true],
        [-trackHalfW, wRadius, -1.58, false],
        [trackHalfW, wRadius, -1.58, false]
      ];
      wheelCoords.forEach(([wx, wy, wz, isFront]) => {
        const w = buildWheelAssembly(wRadius, wWidth, isFront);
        w.position.set(wx, wy, wz);
        bodyGroup.add(w);
        wheels.push(w);
      });

      const bodyKey = isTruck ? 'truckBody' : 'carBody';
      if (!this.vGeos[bodyKey]) {
        const carShape = new THREE.Shape();
        if (isTruck) {
          carShape.moveTo(-2.35, 0.65);
          carShape.lineTo(-2.35, 1.55);
          carShape.lineTo(-1.1, 1.58);
          carShape.lineTo(-0.75, 2.25);
          carShape.lineTo(0.85, 2.25);
          carShape.lineTo(1.35, 1.55);
          carShape.lineTo(2.45, 1.38);
          carShape.lineTo(2.52, 0.65);
          carShape.closePath();
        } else {
          carShape.moveTo(-2.45, 0.42);
          carShape.lineTo(-2.52, 0.98);
          carShape.quadraticCurveTo(-1.75, 1.12, -1.15, 1.42);
          carShape.quadraticCurveTo(-0.25, 1.68, 0.55, 1.45);
          carShape.lineTo(1.38, 0.96);
          carShape.quadraticCurveTo(2.15, 0.86, 2.62, 0.52);
          carShape.lineTo(2.55, 0.32);
          carShape.closePath();
        }
        const bg = new THREE.ExtrudeGeometry(carShape, {
          depth: isTruck ? 2.35 : 2.22,
          bevelEnabled: true,
          bevelSegments: 5,
          steps: 2,
          bevelSize: 0.14,
          bevelThickness: 0.14
        });
        bg.translate(0, 0, -(isTruck ? 2.35 : 2.22) / 2);
        bg.rotateY(-Math.PI / 2);
        this.vGeos[bodyKey] = bg;

        const cg = new THREE.SphereGeometry(1.06, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52);
        cg.scale(0.92, isTruck ? 0.72 : 0.52, 1.68);
        this.vGeos[isTruck ? 'truckCanopy' : 'carCanopy'] = cg;

        const fg = new THREE.CylinderGeometry(wRadius + 0.14, wRadius + 0.14, 0.42, 20, 1, false, 0, Math.PI);
        fg.rotateZ(Math.PI / 2);
        this.vGeos[isTruck ? 'truckFender' : 'carFender'] = fg;
      }

      const mainBody = new THREE.Mesh(this.vGeos[bodyKey], carPaintMat);
      mainBody.castShadow = true;
      mainBody.receiveShadow = true;
      bodyGroup.add(mainBody);

      const canopy = new THREE.Mesh(this.vGeos[isTruck ? 'truckCanopy' : 'carCanopy'], glassMat);
      canopy.position.set(0, isTruck ? 1.68 : 1.16, -0.12);
      bodyGroup.add(canopy);

      const roofBeacon = new THREE.Mesh(this.vGeos.roofBeacon, telemetryBeaconMat);
      roofBeacon.position.set(0, isTruck ? 2.28 : 1.58, -0.45);
      bodyGroup.add(roofBeacon);

      const fenderGeo = this.vGeos[isTruck ? 'truckFender' : 'carFender'];
      wheelCoords.forEach(([wx, wy, wz]) => {
        const arch = new THREE.Mesh(fenderGeo, secondaryPaintMat);
        arch.position.set(wx > 0 ? wx - 0.12 : wx + 0.12, wy + 0.04, wz);
        bodyGroup.add(arch);
      });

      const splitter = new THREE.Mesh(this.vGeos.splitter, carbonMat);
      splitter.position.set(0, isTruck ? 0.55 : 0.28, 2.38);
      bodyGroup.add(splitter);

      const diffuser = new THREE.Mesh(this.vGeos.diffuser, carbonMat);
      diffuser.position.set(0, isTruck ? 0.62 : 0.36, -2.35);
      bodyGroup.add(diffuser);

      [-1.31, 1.31].forEach(sx => {
        const intake = new THREE.Mesh(this.vGeos.intake, carbonMat);
        intake.position.set(sx, isTruck ? 1.25 : 0.82, -0.55);
        bodyGroup.add(intake);
      });

      if (!isTruck) {
        const wingBlade = new THREE.Mesh(this.vGeos.wingBlade, carbonMat);
        wingBlade.position.set(0, 1.56, -2.28);
        wingBlade.rotation.x = -0.16;
        bodyGroup.add(wingBlade);

        [-1.34, 1.34].forEach(ex => {
          const endPlate = new THREE.Mesh(this.vGeos.endPlate, carPaintMat);
          endPlate.position.set(ex, 1.54, -2.28);
          bodyGroup.add(endPlate);
        });

        [-0.65, 0.65].forEach(sx => {
          const pylon = new THREE.Mesh(this.vGeos.pylon, carbonMat);
          pylon.position.set(sx, 1.32, -2.18);
          pylon.rotation.x = 0.22;
          bodyGroup.add(pylon);
        });
      }

      [-0.92, 0.92].forEach(hx => {
        const hl = new THREE.Mesh(this.vGeos.hl, headlightMat);
        hl.position.set(hx, isTruck ? 1.32 : 0.76, 2.58);
        hl.rotation.y = hx > 0 ? -0.18 : 0.18;
        bodyGroup.add(hl);
      });

      const tailStrip = new THREE.Mesh(this.vGeos.tailStrip, taillightMat);
      tailStrip.position.set(0, isTruck ? 1.36 : 0.96, -2.48);
      bodyGroup.add(tailStrip);

      [-0.58, 0.58].forEach(ex => {
        const nozzle = new THREE.Mesh(this.vGeos.nozzle, brakeRotorMat);
        nozzle.rotation.x = Math.PI / 2;
        nozzle.position.set(ex, isTruck ? 0.72 : 0.44, -2.52);
        bodyGroup.add(nozzle);

        const ringMat = new THREE.MeshBasicMaterial({
          color: vehConfig.isFlyingTesla ? 0xffd700 : 0x00f0ff
        });
        const thrRing = new THREE.Mesh(this.vGeos.thrRing, ringMat);
        thrRing.position.set(ex, isTruck ? 0.72 : 0.44, -2.72);
        bodyGroup.add(thrRing);

        const flameMat = new THREE.MeshBasicMaterial({
          color: vehConfig.isFlyingTesla ? 0xffd700 : hasPlasmaFlame ? 0xd946ef : 0x00f0ff,
          transparent: true,
          opacity: 0.92
        });
        const flame = new THREE.Mesh(this.vGeos.flame, flameMat);
        flame.rotation.x = -Math.PI / 2;
        flame.position.set(ex, isTruck ? 0.72 : 0.44, -3.35);
        bodyGroup.add(flame);
        flameMeshes.push(flame);
      });

      if (vehConfig.isFlyingTesla) {
        wingsGroup = new THREE.Group();
        if (!this.vGeos.aeroWing) {
          const wingShape = new THREE.Shape();
          wingShape.moveTo(0, 0);
          wingShape.lineTo(3.4, -0.8);
          wingShape.lineTo(3.2, -1.55);
          wingShape.lineTo(0, -1.1);
          wingShape.closePath();

          const wg = new THREE.ExtrudeGeometry(wingShape, {
            depth: 0.09,
            bevelEnabled: true,
            bevelThickness: 0.03,
            bevelSize: 0.03
          });
          wg.rotateX(Math.PI / 2);
          this.vGeos.aeroWing = wg;
        }

        const wingMat = new THREE.MeshPhysicalMaterial({
          color: 0xffd700,
          emissive: 0x0284c7,
          emissiveIntensity: 0.85,
          metalness: 0.9,
          roughness: 0.12,
          clearcoat: 1.0
        });

        const rightWing = new THREE.Mesh(this.vGeos.aeroWing, wingMat);
        rightWing.position.set(1.15, 0.92, 0.35);

        const leftWing = rightWing.clone();
        leftWing.scale.x = -1;
        leftWing.position.set(-1.15, 0.92, 0.35);

        wingsGroup.add(leftWing, rightWing);
        wingsGroup.scale.set(0.01, 1, 1);
        bodyGroup.add(wingsGroup);
      }
    }

    const shadowDiscMat = new THREE.MeshBasicMaterial({
      color: hasNeon ? (vehConfig.isFlyingTesla ? 0xffd700 : 0x00f0ff) : 0x000000,
      transparent: true,
      opacity: hasNeon ? 0.38 : 0.55,
      depthWrite: false
    });
    const shadowDisc = new THREE.Mesh(this.vGeos.shadowDisc, shadowDiscMat);
    shadowDisc.position.y = 0.05;
    root.add(shadowDisc);

    const holoRingMat = new THREE.MeshBasicMaterial({
      color: vehConfig.isFlyingTesla ? 0xffd700 : 0x00f0ff,
      transparent: true,
      opacity: 0.65
    });
    const holoRing = new THREE.Mesh(this.vGeos.holoRing, holoRingMat);
    holoRing.position.set(0, 0.07, -0.4);
    root.add(holoRing);

    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.8,
      wireframe: true,
      transparent: true,
      opacity: 0.42
    });
    const shieldMesh = new THREE.Mesh(this.vGeos.shield, shieldMat);
    shieldMesh.position.y = 1.15;
    shieldMesh.visible = false;
    root.add(shieldMesh);

    return {
      root,
      bodyGroup,
      wheels,
      flameMeshes,
      wingsGroup,
      shieldMesh,
      holoRing
    };
  }

  // ==========================================================================
  // GLSL Atmospheric Sky Dome Shader with Low Horizon Solar Orb (Matches scene-3!)
  // ==========================================================================
  createSkyDome(theme) {
    const skyUniforms = {
      uTop: { value: new THREE.Color(theme.skyTop) },
      uHorizon: { value: new THREE.Color(theme.skyBottom) },
      uSunColor: { value: new THREE.Color(theme.sunColor) },
      uSunDir: { value: new THREE.Vector3(0.0, 0.14, 0.99).normalize() }
    };

    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
          float sunDot = clamp(dot(dir, uSunDir), 0.0, 1.0);
          // Controlled horizon solar orb + warm atmospheric halo (doesn't blow out bloom!)
          float disc = smoothstep(0.9942, 0.9958, sunDot);
          col += uSunColor * (disc * 0.72 + pow(sunDot, 18.0) * 0.24);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1350, 32, 20), skyMat);
    skyDome.frustumCulled = false;
    return skyDome;
  }

  disposeScene(scene) {
    if (!scene) return;
    scene.clear();
  }

  // ==========================================================================
  // Complete 3D Highway World, Instanced Props, Double Guardrails & 3D Streaks
  // ==========================================================================
  buildTrackScene(scene, track, renderer) {
    this.disposeScene(scene);
    this.initRendererAndIBL(renderer, scene);
    const theme = track.config.theme;
    const roadWidth = track.roadWidth;
    const stepZ = 12;
    const numSteps = Math.ceil((track.length + 500) / stepZ);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.25 });

    // Pass 4: the realistic world (sky, light, terrain, road, rails, props, finish line) comes from
    // js/env3d.js. The old neon world below is only the fallback when that module is missing.
    const envCtl =
      window.env3DFactory && window.env3DFactory.build ? window.env3DFactory.build(scene, track, renderer) : null;

    if (!envCtl) {
    scene.background = new THREE.Color(theme.skyBottom);
    scene.fog = new THREE.FogExp2(theme.fogColor, 0.00105);

    // 1. Add GLSL Atmospheric Sky Dome
    const skyDome = this.createSkyDome(theme);
    scene.add(skyDome);

    // 2. Key / Fill / Rim Lighting Stack
    const hemiLight = new THREE.HemisphereLight(theme.sunColor, 0x0b1120, 0.72);
    hemiLight.position.set(0, 250, 0);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(theme.sunColor, 1.15);
    sunLight.position.set(120, 240, 260);
    sunLight.castShadow = true;
    scene.add(sunLight);

    // 3. Continuous Vertex-Displaced 3D Mountain Valley Terrain Mesh (Kept safely below elevated highway!)
    const valleyCols = 28;
    const valleyWidth = 520;
    const vPos = [];
    const vColors = [];
    const vIndices = [];

    const colLow = new THREE.Color(0x090f1d);
    const colMid = new THREE.Color(theme.mountainColor);
    const colHigh = new THREE.Color(track.config.envType === 'canyon' ? 0xd97706 : 0x38bdf8);

    for (let iz = 0; iz <= numSteps; iz += 2) {
      const z = iz * stepZ;
      const roadCenterX = track.getCurveXAt(z);
      const roadY = track.getHeightAt(z);

      for (let ix = 0; ix <= valleyCols; ix++) {
        const u = ix / valleyCols - 0.5;
        const worldX = roadCenterX + u * valleyWidth;
        const distFromRoad = Math.abs(u * valleyWidth);

        let y = roadY - 5.8;
        if (distFromRoad > roadWidth * 0.85) {
          const edgeFactor = Math.min(1, (distFromRoad - roadWidth * 0.85) / 85);
          const n1 = Math.sin(worldX * 0.022 + z * 0.008) * Math.cos(z * 0.011) * 44;
          const n2 = Math.sin(worldX * 0.055 - z * 0.019) * 18;
          const n3 = Math.abs(Math.cos(worldX * 0.014 + z * 0.004)) * 72;
          y = roadY - 5.8 + edgeFactor * edgeFactor * (Math.max(0, n1 + n2) + n3);
        }

        vPos.push(worldX, y, z);

        const hNorm = Math.max(0, Math.min(1, (y - (roadY - 5.8)) / 78));
        const c = colLow.clone();
        if (hNorm < 0.55) {
          c.lerp(colMid, hNorm / 0.55);
        } else {
          c.copy(colMid).lerp(colHigh, (hNorm - 0.55) / 0.45);
        }
        vColors.push(c.r, c.g, c.b);
      }
    }

    const numZRows = Math.floor(numSteps / 2) + 1;
    const rowStride = valleyCols + 1;
    for (let rz = 0; rz < numZRows - 1; rz++) {
      for (let rx = 0; rx < valleyCols; rx++) {
        const a = rz * rowStride + rx;
        const b = a + 1;
        const c = (rz + 1) * rowStride + rx;
        const d = c + 1;
        vIndices.push(a, b, c);
        vIndices.push(b, d, c);
      }
    }

    const valleyGeo = new THREE.BufferGeometry();
    valleyGeo.setAttribute('position', new THREE.Float32BufferAttribute(vPos, 3));
    valleyGeo.setAttribute('color', new THREE.Float32BufferAttribute(vColors, 3));
    valleyGeo.setIndex(vIndices);
    valleyGeo.computeVertexNormals();

    const valleyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.84,
      metalness: 0.12,
      flatShading: true
    });
    const valleyMesh = new THREE.Mesh(valleyGeo, valleyMat);
    valleyMesh.receiveShadow = true;
    scene.add(valleyMesh);

    // 4. Continuous Curved & Elevated 3D Asphalt Highway + Double-Beam Glowing Guardrails (Matches scene-3!)
    const roadPos = [];
    const roadUvs = [];
    const roadIndices = [];
    const railUpperLeft = [];
    const railUpperRight = [];
    const railLowerLeft = [];
    const railLowerRight = [];
    const railIndices = [];

    for (let i = 0; i <= numSteps; i++) {
      const z = i * stepZ;
      const cx = track.getCurveXAt(z);
      const cy = track.getHeightAt(z);

      roadPos.push(cx - roadWidth / 2, cy, z);
      roadPos.push(cx + roadWidth / 2, cy, z);

      const vCoord = z / 28;
      roadUvs.push(0, vCoord);
      roadUvs.push(1, vCoord);

      const rL = cx - roadWidth / 2 - 0.35;
      const rR = cx + roadWidth / 2 + 0.35;
      railUpperLeft.push(rL, cy + 0.95, z, rL, cy + 1.28, z);
      railUpperRight.push(rR, cy + 0.95, z, rR, cy + 1.28, z);
      railLowerLeft.push(rL, cy + 0.25, z, rL, cy + 0.62, z);
      railLowerRight.push(rR, cy + 0.25, z, rR, cy + 0.62, z);

      if (i < numSteps) {
        const base = i * 2;
        roadIndices.push(base, base + 1, base + 2);
        roadIndices.push(base + 1, base + 3, base + 2);

        railIndices.push(base, base + 1, base + 2);
        railIndices.push(base + 1, base + 3, base + 2);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();

    const roadMat = new THREE.MeshStandardMaterial({
      map: this.textures.asphalt,
      emissiveMap: this.textures.asphalt,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.42,
      roughness: 0.72,
      metalness: 0.14
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    const upperRailMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.35,
      metalness: 0.8,
      roughness: 0.2,
      side: THREE.DoubleSide
    });
    const lowerRailMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.75,
      roughness: 0.3,
      side: THREE.DoubleSide
    });

    [railUpperLeft, railUpperRight].forEach(arr => {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      rg.setIndex(railIndices);
      rg.computeVertexNormals();
      scene.add(new THREE.Mesh(rg, upperRailMat));
    });
    [railLowerLeft, railLowerRight].forEach(arr => {
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      rg.setIndex(railIndices);
      rg.computeVertexNormals();
      scene.add(new THREE.Mesh(rg, lowerRailMat));
    });

    // 5. GPU-Instanced Environment Architecture (Skyscrapers, Guardrail Posts & Holo Diamonds)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.25 });
    const lampGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: theme.sunColor,
      emissiveIntensity: 2.8
    });
    const bldgMat = new THREE.MeshStandardMaterial({
      map: this.textures.building,
      roughness: 0.22,
      metalness: 0.7,
      envMap: this.envMap
    });
    const holoDiamondMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 2.4,
      roughness: 0.1
    });

    const stepPropZ = 65;
    const propCount = Math.floor((track.length + 200) / stepPropZ);

    const postInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 1.45, 0.28), poleMat, propCount * 4);
    const towerInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bldgMat, propCount * 2);
    const diamondInst = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.95, 0), holoDiamondMat, propCount * 2);

    const gantryColGeo = new THREE.BoxGeometry(0.7, 10.5, 0.7);
    const gantryCrossGeo = new THREE.BoxGeometry(roadWidth + 4, 1.1, 0.8);
    const gantryLedGeo = new THREE.BoxGeometry(roadWidth, 0.24, 0.95);

    const dummy = new THREE.Object3D();
    let postIdx = 0;
    let towerIdx = 0;
    let diamondIdx = 0;

    for (let z = 60; z < track.length + 180; z += stepPropZ) {
      const cx = track.getCurveXAt(z);
      const cy = track.getHeightAt(z);

      [-1, 1].forEach(side => {
        const px = cx + side * (roadWidth / 2 + 0.45);
        dummy.position.set(px, cy + 0.7, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        if (postIdx < postInst.count) postInst.setMatrixAt(postIdx++, dummy.matrix);

        if (z % 130 === 60) {
          dummy.position.set(cx + side * (roadWidth / 2 + 4.8), cy + 3.2, z);
          dummy.rotation.set(0, z * 0.02, 0);
          dummy.scale.set(1, 1.25, 1);
          dummy.updateMatrix();
          if (diamondIdx < diamondInst.count) diamondInst.setMatrixAt(diamondIdx++, dummy.matrix);
        }

        // Tall Architectural Monoliths framing the highway (capped below Y=72 so Sky-Track at Y=92 soars above!)
        const bw = 22 + ((z * 7) % 14);
        const bh = 38 + ((z * 19) % 34);
        const bd = 22 + ((z * 11) % 14);
        const bx = cx + side * (roadWidth / 2 + 22 + ((z * 3) % 16));
        dummy.position.set(bx, cy + bh / 2 - 6, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(bw, bh, bd);
        dummy.updateMatrix();
        if (towerIdx < towerInst.count) towerInst.setMatrixAt(towerIdx++, dummy.matrix);
      });

      if (z % 390 === 60) {
        const gantryGroup = new THREE.Group();
        [-roadWidth / 2 - 1.6, roadWidth / 2 + 1.6].forEach(px => {
          const col = new THREE.Mesh(gantryColGeo, poleMat);
          col.position.set(px, 5.25, 0);
          gantryGroup.add(col);
        });
        const crossbar = new THREE.Mesh(gantryCrossGeo, poleMat);
        crossbar.position.set(0, 10.2, 0);
        gantryGroup.add(crossbar);

        const ledStrip = new THREE.Mesh(gantryLedGeo, lampGlowMat);
        ledStrip.position.set(0, 9.6, 0);
        gantryGroup.add(ledStrip);

        gantryGroup.position.set(cx, cy, z);
        scene.add(gantryGroup);
      }
    }

    postInst.instanceMatrix.needsUpdate = true;
    towerInst.instanceMatrix.needsUpdate = true;
    diamondInst.instanceMatrix.needsUpdate = true;
    scene.add(postInst, towerInst, diamondInst);

    // 6. 3D World Speed-Streak Lines along the Highway Corridor (Matches scene-3!)
    const streakPositions = [];
    for (let z = 40; z < track.length + 100; z += 18) {
      const cx = track.getCurveXAt(z);
      const cy = track.getHeightAt(z);
      const side = (z / 18) % 2 === 0 ? -1 : 1;
      const sx = cx + side * (roadWidth * 0.45 + ((z * 13) % 18));
      const sy = cy + 2.2 + ((z * 7) % 11);
      const len = 7 + (z % 8);
      streakPositions.push(sx, sy, z, sx, sy, z + len);
    }
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.Float32BufferAttribute(streakPositions, 3));
    const streakMat = new THREE.LineBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.65
    });
    const speedLines3D = new THREE.LineSegments(streakGeo, streakMat);
    scene.add(speedLines3D);

    } // end legacy environment (sections 1-6)

    // 7. Build 3D Mega-Ramps with Shared Geometries
    const rampMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      metalness: 0.5,
      roughness: 0.4
    });
    const rampStripMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 2.8
    });
    const rampDeckGeo = new THREE.BoxGeometry(8.5, 0.65, 28);
    const rampRailGeo = new THREE.BoxGeometry(0.28, 0.85, 28);

    track.ramps.forEach(r => {
      const cx = track.getCurveXAt(r.z) + r.laneX;
      const cy = track.getHeightAt(r.z);

      const rampGroup = new THREE.Group();
      const angle = -Math.atan2(r.height, r.length);
      const deck = new THREE.Mesh(rampDeckGeo, rampMat);
      deck.rotation.x = angle;
      deck.position.set(0, r.height * 0.46, 0);
      rampGroup.add(deck);

      [-r.width / 2 + 0.2, r.width / 2 - 0.2].forEach(rx => {
        const rail = new THREE.Mesh(rampRailGeo, rampStripMat);
        rail.rotation.x = angle;
        rail.position.set(rx, r.height * 0.46 + 0.2, 0);
        rampGroup.add(rail);
      });

      rampGroup.position.set(cx, cy, r.z);
      scene.add(rampGroup);
    });

    // 8. Build 3D Blazing Rings of Fire (Shared Geometries)
    const fireRingMeshes = [];
    const fireCoreMat = new THREE.MeshStandardMaterial({
      color: 0xff5500,
      emissive: 0xff4500,
      emissiveIntensity: 3.5
    });
    const fireHaloMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      emissive: 0xffaa00,
      emissiveIntensity: 2.8,
      wireframe: true,
      transparent: true,
      opacity: 0.85
    });
    const fireCoreGeo = new THREE.TorusGeometry(5.8, 0.52, 16, 40);
    const fireHaloGeo = new THREE.TorusGeometry(6.18, 0.88, 10, 28);

    track.fireRings.forEach(ring => {
      const cx = track.getCurveXAt(ring.z) + ring.laneX;
      const ringGroup = new THREE.Group();

      const torus = new THREE.Mesh(fireCoreGeo, fireCoreMat);
      const outerFlame = new THREE.Mesh(fireHaloGeo, fireHaloMat);
      ringGroup.add(torus, outerFlame);

      ringGroup.position.set(cx, ring.y, ring.z);
      scene.add(ringGroup);
      fireRingMeshes.push({ data: ring, mesh: ringGroup, outerFlame });
    });

    // 9. Build 3D 360-Degree Vertical Stunt Loops (Shared Geometry)
    const loopMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e293b,
      emissive: 0xe11d48,
      emissiveIntensity: 0.85,
      metalness: 0.8,
      roughness: 0.2
    });
    const loopTorusGeo = new THREE.TorusGeometry(18.5, 2.4, 18, 48);
    track.loops.forEach(lp => {
      const cx = track.getCurveXAt(lp.z);
      const cy = track.getHeightAt(lp.z);
      const loopMesh = new THREE.Mesh(loopTorusGeo, loopMat);
      loopMesh.rotation.y = Math.PI / 2;
      loopMesh.position.set(cx, cy + lp.radius - 1, lp.z);
      scene.add(loopMesh);
    });

    // 10. Gas stations & pit garages: crew, pumps, jacks come from js/pit3d.js (old boxes are the fallback)
    const stationVisuals = [];
    if (window.pit3DFactory && window.pit3DFactory.createStation) {
      track.stations.forEach(st => {
        const ctrl = window.pit3DFactory.createStation(st, track, scene);
        scene.add(ctrl.group);
        stationVisuals.push({ data: st, ctrl });
      });
    } else {
    // (legacy) gas stations & garages
    const stCanopyGeo = new THREE.BoxGeometry(roadWidth + 11, 1.4, 20);
    const stTrimGeo = new THREE.BoxGeometry(roadWidth + 11.4, 0.42, 20.4);
    const stPillarGeo = new THREE.BoxGeometry(1.5, 9.6, 2.0);
    const stPumpGeo = new THREE.BoxGeometry(1.1, 2.6, 1.4);
    const stSignGeo = new THREE.PlaneGeometry(16.5, 4.2);
    const stBayGeo = new THREE.PlaneGeometry(roadWidth - 2, 22);
    stBayGeo.rotateX(-Math.PI / 2);

    const canopyMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      metalness: 0.8,
      roughness: 0.2,
      clearcoat: 1.0
    });

    track.stations.forEach(st => {
      const cx = track.getCurveXAt(st.z);
      const cy = track.getHeightAt(st.z);
      const isFuel = st.type === 'fuel';
      const primaryColor = isFuel ? 0xf59e0b : 0x10b981;
      const hexStr = isFuel ? '#f59e0b' : '#10b981';

      const stGroup = new THREE.Group();

      const canopy = new THREE.Mesh(stCanopyGeo, canopyMat);
      canopy.position.set(0, 9.4, 0);
      stGroup.add(canopy);

      const trimMat = new THREE.MeshStandardMaterial({
        color: primaryColor,
        emissive: primaryColor,
        emissiveIntensity: 2.8
      });
      const trim = new THREE.Mesh(stTrimGeo, trimMat);
      trim.position.set(0, 10.1, 0);
      stGroup.add(trim);

      [-roadWidth / 2 - 3.6, roadWidth / 2 + 3.6].forEach(px => {
        const pillar = new THREE.Mesh(stPillarGeo, canopyMat);
        pillar.position.set(px, 4.8, 0);
        stGroup.add(pillar);

        const pump = new THREE.Mesh(stPumpGeo, trimMat);
        pump.position.set(px * 0.82, 1.3, 0);
        stGroup.add(pump);
      });

      const signTex = this.createSignTexture(
        isFuel ? '⛽ תחנת דלק OCTANE' : '🔧 מוסך החלפת חלפים',
        'פתור תרגיל חשבון לתדלוק ושדרוג! [E]',
        '#090f24',
        hexStr
      );
      const signMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide });
      const signBoard = new THREE.Mesh(stSignGeo, signMat);
      signBoard.position.set(0, 12.4, -10.2);
      signBoard.rotation.y = Math.PI;
      stGroup.add(signBoard);

      const bayMat = new THREE.MeshBasicMaterial({
        color: primaryColor,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
      });
      const bayPad = new THREE.Mesh(stBayGeo, bayMat);
      bayPad.position.set(0, 0.08, 0);
      stGroup.add(bayPad);

      stGroup.position.set(cx, cy, st.z);
      scene.add(stGroup);
    });

    }

    // 11. Build 3D Highway Obstacles (Shared Geometries)
    const hazardMeshes = [];
    const barrelMat = new THREE.MeshPhysicalMaterial({ color: 0xdc2626, metalness: 0.5, roughness: 0.3, clearcoat: 0.6 });
    const barrierMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.8,
      roughness: 0.4
    });
    const laserMat = new THREE.MeshStandardMaterial({
      color: 0xff0055,
      emissive: 0xff0055,
      emissiveIntensity: 3.4
    });
    const lavaMat = new THREE.MeshStandardMaterial({
      color: 0xff3b00,
      emissive: 0xff4500,
      emissiveIntensity: 2.8
    });

    const barrelGeo = new THREE.CylinderGeometry(0.68, 0.68, 1.85, 14);
    const barrierBlockGeo = new THREE.BoxGeometry(5.4, 1.95, 1.5);
    const beaconSphereGeo = new THREE.SphereGeometry(0.32, 10, 10);
    const laserPostGeo = new THREE.CylinderGeometry(0.24, 0.28, 4.2, 8);
    const laserBeamGeo = new THREE.CylinderGeometry(0.14, 0.14, 5.0, 8);
    laserBeamGeo.rotateZ(Math.PI / 2);
    const lavaPoolGeo = new THREE.BoxGeometry(roadWidth - 2, 0.38, 9.5);

    track.hazards.forEach(haz => {
      const cx = track.getCurveXAt(haz.z) + haz.laneX;
      const cy = track.getHeightAt(haz.z);
      const hGroup = new THREE.Group();

      if (haz.kind === 'barrels') {
        [-1.4, 0, 1.4].forEach(bx => {
          const barrel = new THREE.Mesh(barrelGeo, barrelMat);
          barrel.position.set(bx, 0.92, 0);
          hGroup.add(barrel);
        });
      } else if (haz.kind === 'barrier') {
        const block = new THREE.Mesh(barrierBlockGeo, barrierMat);
        block.position.set(0, 0.98, 0);
        hGroup.add(block);
        const beacon = new THREE.Mesh(beaconSphereGeo, laserMat);
        beacon.position.set(0, 2.15, 0);
        hGroup.add(beacon);
      } else if (haz.kind === 'laser') {
        [-2.5, 2.5].forEach(px => {
          const post = new THREE.Mesh(laserPostGeo, laserMat);
          post.position.set(px, 2.1, 0);
          hGroup.add(post);
        });
        [1.2, 2.5, 3.8].forEach(ly => {
          const beam = new THREE.Mesh(laserBeamGeo, laserMat);
          beam.position.set(0, ly, 0);
          hGroup.add(beam);
        });
      } else if (haz.kind === 'lava') {
        const lavaPool = new THREE.Mesh(lavaPoolGeo, lavaMat);
        lavaPool.position.set(0, 0.14, 0);
        hGroup.add(lavaPool);
      }

      hGroup.position.set(cx, cy, haz.z);
      scene.add(hGroup);
      hazardMeshes.push({ data: haz, mesh: hGroup });
    });

    // 11b. Spike strips (dodge them! one InstancedMesh for every spike) + warning signs
    const spikeMeshes = [];
    if (track.spikeStrips && track.spikeStrips.length) {
      const strips = track.spikeStrips;
      const spikeGeo = new THREE.ConeGeometry(0.25, 1.3, 8);
      spikeGeo.translate(0, 0.68, 0);
      const spikeMat = new THREE.MeshStandardMaterial({
        color: 0xe5e9ef,
        metalness: 0.95,
        roughness: 0.2,
        envMap: this.envMap,
        envMapIntensity: 1.3
      });
      const colSpacing = 0.64;
      const rowSpacing = 0.78;
      const rows = 4;
      let spikeTotal = 0;
      strips.forEach(s => {
        s.cols = Math.max(2, Math.round(s.width / colSpacing));
        spikeTotal += s.cols * rows;
      });
      const spikeInst = new THREE.InstancedMesh(spikeGeo, spikeMat, spikeTotal);

      // Hazard-striped base plate texture (red/white) so strips are visible from far away
      const sc = document.createElement('canvas');
      sc.width = 128;
      sc.height = 128;
      const sctx = sc.getContext('2d');
      sctx.fillStyle = '#2a2e35';
      sctx.fillRect(0, 0, 128, 128);
      for (let i = -128; i < 256; i += 32) {
        sctx.fillStyle = (i / 32) % 2 === 0 ? '#e11d2e' : '#f5f5f5';
        sctx.beginPath();
        sctx.moveTo(i, 128);
        sctx.lineTo(i + 16, 128);
        sctx.lineTo(i + 16 + 128, 0);
        sctx.lineTo(i + 128, 0);
        sctx.closePath();
        sctx.fill();
      }
      const stripeTex = new THREE.CanvasTexture(sc);
      stripeTex.encoding = THREE.sRGBEncoding;
      stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
      const baseMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.6, metalness: 0.2 });
      const zoneMat = new THREE.MeshBasicMaterial({
        map: stripeTex,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      });

      // Warning sign texture
      const wc = document.createElement('canvas');
      wc.width = 256;
      wc.height = 256;
      const wctx = wc.getContext('2d');
      wctx.fillStyle = '#facc15';
      wctx.beginPath();
      wctx.moveTo(128, 8);
      wctx.lineTo(248, 232);
      wctx.lineTo(8, 232);
      wctx.closePath();
      wctx.fill();
      wctx.lineWidth = 14;
      wctx.strokeStyle = '#111827';
      wctx.stroke();
      wctx.fillStyle = '#111827';
      for (let i = 0; i < 5; i++) {
        wctx.beginPath();
        wctx.moveTo(62 + i * 33, 214);
        wctx.lineTo(78 + i * 33, 150);
        wctx.lineTo(94 + i * 33, 214);
        wctx.closePath();
        wctx.fill();
      }
      wctx.font = '900 40px Rubik, Arial, sans-serif';
      wctx.textAlign = 'center';
      wctx.direction = 'rtl';
      wctx.fillText('קוצים!', 128, 120);
      const signTex = new THREE.CanvasTexture(wc);
      signTex.encoding = THREE.sRGBEncoding;
      const signMat = new THREE.MeshBasicMaterial({ map: signTex, transparent: true, side: THREE.DoubleSide });
      const signGeo = new THREE.PlaneGeometry(3.4, 3.4);
      const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.2, 8);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.7, roughness: 0.4 });

      const dummySpike = new THREE.Object3D();
      let si = 0;
      strips.forEach(s => {
        const cx = track.getCurveXAt(s.z) + s.laneX;
        const cy = track.getHeightAt(s.z);

        const baseGeo = new THREE.BoxGeometry(s.width, 0.1, s.length);
        const uv = baseGeo.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (s.width / 2.2), uv.getY(k) * 1.2);
        const plate = new THREE.Mesh(baseGeo, baseMat);
        plate.position.set(cx, cy + 0.13, s.z);
        scene.add(plate);

        // Painted red/white warning zone on the asphalt just before the strip (readable from far away)
        const zoneGeo = new THREE.PlaneGeometry(s.width + 1.0, 11);
        zoneGeo.rotateX(-Math.PI / 2);
        const zuv = zoneGeo.attributes.uv;
        for (let k = 0; k < zuv.count; k++) zuv.setXY(k, zuv.getX(k) * ((s.width + 1) / 2.2), zuv.getY(k) * 5);
        const zone = new THREE.Mesh(zoneGeo, zoneMat);
        zone.position.set(cx, cy + 0.11, s.z - s.length / 2 - 6.2);
        zone.renderOrder = 1;
        scene.add(zone);

        for (let c = 0; c < s.cols; c++) {
          for (let r = 0; r < rows; r++) {
            const lx = (c - (s.cols - 1) / 2) * (s.width / s.cols);
            const lz = (r - (rows - 1) / 2) * rowSpacing;
            dummySpike.position.set(cx + lx, cy + 0.16, s.z + lz);
            dummySpike.rotation.set(0, 0, 0);
            dummySpike.scale.set(1, 0.85 + ((c * 7 + r * 3) % 4) * 0.06, 1);
            dummySpike.updateMatrix();
            spikeInst.setMatrixAt(si++, dummySpike.matrix);
          }
        }

        // Warning signs on both road edges, ~85 units before the strip
        const signZ = s.z - 85;
        const sx = track.getCurveXAt(signZ);
        const sy = track.getHeightAt(signZ);
        [-1, 1].forEach(side => {
          const px = sx + side * (track.roadWidth / 2 + 2.0);
          const post = new THREE.Mesh(postGeo, postMat);
          post.position.set(px, sy + 1.6, signZ);
          scene.add(post);
          const board = new THREE.Mesh(signGeo, signMat);
          board.position.set(px, sy + 4.4, signZ - 0.12);
          board.rotation.y = Math.PI;
          scene.add(board);
        });

        spikeMeshes.push({ data: s, plate });
      });
      spikeInst.instanceMatrix.needsUpdate = true;
      scene.add(spikeInst);
    }

    // 12. Nitro boost pads: a flat blue pad with glowing chevrons that point down the road
    const bpc = document.createElement('canvas');
    bpc.width = 128;
    bpc.height = 256;
    const bpx = bpc.getContext('2d');
    const bpg = bpx.createLinearGradient(0, 0, 0, 256);
    bpg.addColorStop(0, 'rgba(10,40,110,0.0)');
    bpg.addColorStop(0.5, 'rgba(10,60,150,0.55)');
    bpg.addColorStop(1, 'rgba(10,40,110,0.0)');
    bpx.fillStyle = bpg;
    bpx.fillRect(0, 0, 128, 256);
    bpx.strokeStyle = 'rgba(90,200,255,0.95)';
    bpx.lineWidth = 11;
    bpx.lineCap = 'round';
    bpx.lineJoin = 'round';
    for (let k = 0; k < 4; k++) {
      const y = 36 + k * 52;
      bpx.beginPath();
      bpx.moveTo(24, y);
      bpx.lineTo(64, y + 30);
      bpx.lineTo(104, y);
      bpx.stroke();
    }
    bpx.strokeStyle = 'rgba(120,220,255,0.7)';
    bpx.lineWidth = 5;
    bpx.strokeRect(5, 5, 118, 246);
    const boostTex = new THREE.CanvasTexture(bpc);
    boostTex.anisotropy = 4;
    boostTex.encoding = THREE.sRGBEncoding;
    const boostMat = new THREE.MeshBasicMaterial({
      map: boostTex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    const boostPadGeo = new THREE.PlaneGeometry(5.5, 22);
    boostPadGeo.rotateX(-Math.PI / 2);

    track.boostPads.forEach(pad => {
      const cx = track.getCurveXAt(pad.z) + pad.laneX;
      const cy = track.getHeightAt(pad.z);
      const padMesh = new THREE.Mesh(boostPadGeo, boostMat);
      padMesh.position.set(cx, cy + 0.09, pad.z);
      scene.add(padMesh);
    });

    if (!envCtl) {
    // 13. Finish Line Checkered Arch Gantry
    const finZ = track.length;
    const finX = track.getCurveXAt(finZ);
    const finY = track.getHeightAt(finZ);
    const finGroup = new THREE.Group();
    const finTowerGeo = new THREE.BoxGeometry(1.6, 12.5, 1.6);

    [-roadWidth / 2 - 1.5, roadWidth / 2 + 1.5].forEach(px => {
      const tower = new THREE.Mesh(finTowerGeo, poleMat);
      tower.position.set(px, 6.25, 0);
      finGroup.add(tower);
    });
    const bannerMat = new THREE.MeshBasicMaterial({ map: this.textures.checker, side: THREE.DoubleSide });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(roadWidth + 4, 3.0, 1.2), bannerMat);
    banner.position.set(0, 11.4, 0);
    finGroup.add(banner);
    finGroup.position.set(finX, finY, finZ);
    scene.add(finGroup);

    }

    // 14. Build 30-Second Flying Tesla 3D Stratosphere Sky-Highway (Y = 88.5..92)
    // Includes a continuous Translucent Golden/Cyan Sky-Bridge Ribbon + Solar Rings + Clouds!
    const skyBridgePos = [];
    const skyBridgeIndices = [];
    for (let i = 0; i <= numSteps; i += 2) {
      const z = i * stepZ;
      const cx = track.getCurveXAt(z);
      skyBridgePos.push(cx - 14, 88.2, z);
      skyBridgePos.push(cx + 14, 88.2, z);
    }
    const skyRows = Math.floor(numSteps / 2);
    for (let i = 0; i < skyRows; i++) {
      const base = i * 2;
      skyBridgeIndices.push(base, base + 1, base + 2);
      skyBridgeIndices.push(base + 1, base + 3, base + 2);
    }
    const skyBridgeGeo = new THREE.BufferGeometry();
    skyBridgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(skyBridgePos, 3));
    skyBridgeGeo.setIndex(skyBridgeIndices);
    skyBridgeGeo.computeVertexNormals();
    const skyBridgeMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: 0x00f0ff,
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide
    });
    scene.add(new THREE.Mesh(skyBridgeGeo, skyBridgeMat));

    const skyRingMeshes = [];
    const skyObsMeshes = [];
    const solarRingMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xffb700,
      emissiveIntensity: 3.2
    });
    const droneMat = new THREE.MeshStandardMaterial({
      color: 0xff0055,
      emissive: 0xff0055,
      emissiveIntensity: 2.5,
      metalness: 0.8
    });
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      roughness: 0.95
    });

    const skyRingGeo = new THREE.TorusGeometry(6.2, 0.45, 14, 32);
    const cloudGeo = new THREE.SphereGeometry(14, 10, 10);
    const droneGeo = new THREE.OctahedronGeometry(3.4, 1);

    track.skyRings.forEach((sr, idx) => {
      const cx = track.getCurveXAt(sr.z) + sr.laneX;
      const sMesh = new THREE.Mesh(skyRingGeo, solarRingMat);
      sMesh.position.set(cx, sr.y, sr.z);
      scene.add(sMesh);
      skyRingMeshes.push({ data: sr, mesh: sMesh });

      if (idx % 2 === 0) {
        const cloud = new THREE.Mesh(cloudGeo, cloudMat);
        cloud.scale.set(1.9, 0.55, 1.5);
        cloud.position.set(cx + (idx % 4 === 0 ? -28 : 28), sr.y - 10, sr.z);
        scene.add(cloud);
      }
    });

    track.skyObstacles.forEach(obs => {
      const cx = track.getCurveXAt(obs.z) + obs.laneX;
      const dMesh = new THREE.Mesh(droneGeo, droneMat);
      dMesh.position.set(cx, obs.y, obs.z);
      scene.add(dMesh);
      skyObsMeshes.push({ data: obs, mesh: dMesh });
    });

    return {
      env: envCtl,
      stationVisuals,
      fireRingMeshes,
      hazardMeshes,
      spikeMeshes,
      skyRingMeshes,
      skyObsMeshes
    };
  }
}

window.world3DFactory = new World3DFactory();
