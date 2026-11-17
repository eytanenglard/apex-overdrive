// ============================================================================
// APEX OVERDRIVE 3D - 3D Highway Spline, Curves, Ramps, Fire Rings & Pit Bays
// ============================================================================

class TrackBuilder {
  constructor(trackConfig) {
    this.config = trackConfig || window.TRACKS[0];
    this.length = this.config.length || 11500;
    this.roadWidth = 22; // 3 wide racing lanes (-7, 0, +7)

    this.ramps = [];
    this.fireRings = [];
    this.hazards = [];
    this.boostPads = [];
    this.loops = [];
    this.stations = [];
    this.skyObstacles = [];
    this.skyRings = [];
    this.spikeStrips = [];

    this.buildTrackFeatures();
  }

  smoothStep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // Smooth C1 lateral 3D highway curve (X offset as function of forward distance Z)
  getCurveXAt(z) {
    const startEnv = this.smoothStep(120, 480, z);
    const endEnv = this.smoothStep(this.length - 120, this.length - 520, z);
    const env = startEnv * endEnv;
    const dz = Math.max(0, z - 120);
    return env * (Math.sin(dz * 0.0016) * 32 + Math.sin(dz * 0.0007) * 20);
  }

  // Smooth C1 3D elevation (Y height as function of forward distance Z)
  getHeightAt(z) {
    const startEnv = this.smoothStep(180, 520, z);
    const endEnv = this.smoothStep(this.length - 180, this.length - 560, z);
    let env = startEnv * endEnv;

    // Flatten smoothly near Gas & Pit-Stop stations without any sharp step
    for (const st of this.stations) {
      const dist = Math.abs(z - st.z);
      if (dist < 260) {
        env *= this.smoothStep(90, 260, dist);
      }
    }

    const dz = Math.max(0, z - 180);
    const hillA = Math.sin(dz * 0.0021) * 8.5;
    const hillB = Math.sin(dz * 0.0048) * 4.0;
    return env * (hillA + hillB);
  }

  getSlopeAt(z) {
    const dz = 4;
    const y1 = this.getHeightAt(z - dz);
    const y2 = this.getHeightAt(z + dz);
    return Math.atan2(y2 - y1, dz * 2);
  }

  getHeadingAt(z) {
    const dz = 4;
    const x1 = this.getCurveXAt(z - dz);
    const x2 = this.getCurveXAt(z + dz);
    return Math.atan2(x2 - x1, dz * 2);
  }

  buildTrackFeatures() {
    const L = this.length;

    // 1. 3D Gas Stations & Parts Pit-Stop Garages
    this.stations = [
      {
        id: 'fuel_1',
        type: 'fuel',
        z: Math.round(L * 0.24),
        name: 'תחנת דלק OCTANE 1',
        visited: false
      },
      {
        id: 'parts_1',
        type: 'parts',
        z: Math.round(L * 0.45),
        name: 'מוסך המרוצים של אפקס',
        visited: false
      },
      {
        id: 'fuel_2',
        type: 'fuel',
        z: Math.round(L * 0.65),
        name: 'תחנת דלק OCTANE 2',
        visited: false
      },
      {
        id: 'parts_2',
        type: 'parts',
        z: Math.round(L * 0.82),
        name: 'מוסך החלפים הגדול',
        visited: false
      }
    ];

    // 2. 3D Mega-Ramps + Blazing Rings of Fire suspended right above the jump!
    const rampRatios = [0.032, 0.10, 0.19, 0.32, 0.51, 0.60, 0.73, 0.88, 0.94];
    const laneChoices = [0, -4.5, 4.5, 0, -4, 4, 0, 4, 0];

    rampRatios.forEach((ratio, idx) => {
      const rz = Math.round(L * ratio);
      const nearStation = this.stations.some(s => Math.abs(s.z - rz) < 220);
      if (nearStation) return;

      const laneX = laneChoices[idx % laneChoices.length];
      this.ramps.push({
        id: `ramp_${idx}`,
        z: rz,
        laneX,
        width: 8.5,
        length: 28,
        height: 4.2
      });

      // Place a 3D Ring of Fire in mid-air just past the ramp launch!
      const ringZ = rz + 46;
      const baseGroundY = this.getHeightAt(ringZ);
      this.fireRings.push({
        id: `ring_${idx}`,
        z: ringZ,
        laneX,
        y: baseGroundY + 9.5,
        radius: 5.8,
        passed: false,
        hitRim: false
      });
    });

    // 3. 360-Degree Giant 3D Stunt Loops
    this.loops = [
      { id: 'loop_1', z: Math.round(L * 0.38), radius: 18, passed: false },
      { id: 'loop_2', z: Math.round(L * 0.77), radius: 19, passed: false }
    ];

    // 4. 3D Highway Obstacles (Barrels, Concrete Barriers, Lava Trenches, Laser Gates)
    const numHazards = 22;
    const kinds = ['barrels', 'barrier', 'laser', 'lava'];
    const lanes = [-6.2, 0, 6.2];

    for (let i = 1; i <= numHazards; i++) {
      const ratio = 0.06 + (i / (numHazards + 2)) * 0.88;
      const hz = Math.round(L * ratio);
      const nearOther =
        this.stations.some(s => Math.abs(s.z - hz) < 190) ||
        this.ramps.some(r => Math.abs(r.z - hz) < 85) ||
        this.loops.some(lp => Math.abs(lp.z - hz) < 110);

      if (!nearOther) {
        const kind = kinds[i % kinds.length];
        const laneX = kind === 'lava' ? 0 : lanes[i % lanes.length];
        this.hazards.push({
          id: `haz_${i}`,
          kind,
          z: hz,
          laneX,
          width: kind === 'lava' ? 18 : 5.4,
          height: kind === 'laser' ? 6.5 : 2.8,
          active: true
        });
      }
    }

    // 4b. Spike strips lying on the road: dodge them by changing lane (a wide strip leaves one
    // free lane) or jump over them. Hitting one punctures the tyres until the garage swaps wheels.
    const spikeRatios = [0.075, 0.125, 0.215, 0.295, 0.345, 0.415, 0.495, 0.535, 0.585, 0.625,
                         0.705, 0.745, 0.80, 0.865, 0.905];
    // pattern per strip: [center laneX, width] ; width 6 = one lane, ~13.6 = two lanes (free lane left)
    const spikePatterns = [
      [0, 6], [-7, 6], [3.5, 13.6], [7, 6], [-3.5, 13.6], [0, 6], [7, 6], [-7, 6], [3.5, 13.6], [0, 6],
      [-3.5, 13.6], [7, 6], [-7, 6], [3.5, 13.6], [0, 6]
    ];
    spikeRatios.forEach((ratio, idx) => {
      const sz = Math.round(L * ratio);
      const clash =
        this.stations.some(s => Math.abs(s.z - sz) < 210) ||
        this.ramps.some(r => Math.abs(r.z - sz) < 90 || Math.abs(r.z + 46 - sz) < 60) ||
        this.loops.some(lp => Math.abs(lp.z - sz) < 120) ||
        this.hazards.some(h => Math.abs(h.z - sz) < 55);
      if (clash) return;
      const pat = spikePatterns[idx % spikePatterns.length];
      this.spikeStrips.push({
        id: `spike_${idx}`,
        z: sz,
        laneX: pat[0],
        width: pat[1],
        length: 3.4,
        height: 1.15,
        active: true
      });
    });

    // 5. 3D Nitro Boost Pads on the Asphalt
    const boostRatios = [0.05, 0.14, 0.28, 0.41, 0.56, 0.69, 0.85, 0.92];
    boostRatios.forEach((ratio, idx) => {
      const bz = Math.round(L * ratio);
      this.boostPads.push({
        id: `boost_${idx}`,
        z: bz,
        laneX: idx % 2 === 0 ? 0 : (idx % 4 === 1 ? -5.5 : 5.5),
        width: 5.5,
        length: 22
      });
    });

    // 6. 30-Second Flying Tesla 3D Stratosphere Sky-Track (At altitude Y = 85..105)
    for (let sz = 250; sz < L * 1.3; sz += 140) {
      this.skyRings.push({
        z: sz,
        laneX: Math.sin(sz * 0.006) * 10,
        y: 92 + Math.cos(sz * 0.005) * 6,
        radius: 6.2,
        collected: false
      });

      if (sz % 280 === 0) {
        this.skyObstacles.push({
          z: sz + 70,
          laneX: Math.cos(sz * 0.008) * 9,
          y: 92 + Math.sin(sz * 0.007) * 5,
          radius: 3.4,
          hit: false
        });
      }
    }
  }
}

window.TrackBuilder = TrackBuilder;
