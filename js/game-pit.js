// ============================================================================
// APEX OVERDRIVE - Pass 4 game logic (mixed into ApexOverdrive3DGame.prototype)
//  - pit stop flow: the car rolls into the station, the crew works, the player answers
//  - question panel (right side, 3D crew stays visible), wrong answers cost points
//  - spike strips / flat tyres, vehicle purchase dialog, driver photo, intro guide
// Loaded after game.js, before DOMContentLoaded fires.
// ============================================================================
(function () {
  const G = ApexOverdrive3DGame.prototype;
  const $ = id => document.getElementById(id);

  const PART_CONTEXT = { tires: 'tires', turbo: 'turbo', suspension: 'suspension', shield: 'shield' };
  const SERVICE_TITLE = {
    fuel: 'ממלאים דלק…',
    tires: 'מחליפים את הגלגלים…',
    turbo: 'מתקינים טורבו…',
    suspension: 'מחליפים בולמי זעזועים…',
    shield: 'מתקינים מגן אנרגיה…'
  };

  Object.assign(G, {
    // ------------------------------------------------------------------ setup
    initPass4() {
      window.addEventListener('keydown', e => {
        if (e.target && e.target.tagName === 'INPUT') return;
        if (!this.panel) {
          if (e.code === 'Escape') this.closeBuyDialog();
          return;
        }
        const step = this.panel.step;
        if (step === 'question') {
          const n = Number((e.key || '').replace(/[^1-4]/g, ''));
          if (n >= 1 && n <= 4) {
            const btn = document.querySelectorAll('#qp-answers .qp-ans')[n - 1];
            if (btn && !btn.disabled) btn.click();
          }
        } else if (step === 'done' && (e.code === 'Enter' || e.code === 'Space')) {
          e.preventDefault();
          this.leavePit();
        } else if (step === 'choose' && (e.code === 'Enter' || e.code === 'Space')) {
          e.preventDefault();
          this.confirmPart();
        }
      });

      const nameInput = $('driver-name-input');
      if (nameInput) {
        nameInput.addEventListener('input', () => {
          const clean = nameInput.value.replace(/[<>]/g, '').slice(0, 16);
          window.playerStore.state.playerName = clean.trim() || 'נהג אפקס';
          window.playerStore.save();
          this.renderHudDriver();
        });
      }
      if (window.playerAvatar) {
        window.playerAvatar.onChange(() => this.refreshAllUI());
      }
      this.renderDriverCard();
      this.renderHudDriver();
      if (!window.playerStore.state.seenIntro) setTimeout(() => this.showIntro(), 700);
    },

    // Free the previous world (geometries/textures made by the env + pit modules) before building a new one.
    disposeCurrentWorld() {
      this.vfxParticles3D = [];
      try {
        const refs = this.sceneRefs;
        if (refs) {
          if (refs.env && refs.env.dispose) refs.env.dispose();
          (refs.stationVisuals || []).forEach(e => e.ctrl && e.ctrl.dispose && e.ctrl.dispose());
        }
      } catch (e) {
        console.warn('dispose failed', e);
      }
      this.scene.clear();
    },

    // Garage thumbnails: each car rendered once on the showroom turntable and cached as a picture.
    vehicleThumbHtml(v) {
      const garage = $('garage-screen');
      if (!garage || !garage.classList.contains('active')) return '<div class="veh-thumb-ph"></div>';
      const url = this.getVehicleThumb(v.id);
      return url ? `<img class="veh-thumb" alt="${v.name}" src="${url}">` : '<div class="veh-thumb-ph"></div>';
    },

    getVehicleThumb(vehId) {
      this.thumbCache = this.thumbCache || {};
      if (this.thumbCache[vehId]) return this.thumbCache[vehId];
      if (!this.showroomRenderer || !this.showroomScene) return '';
      try {
        const cfg = window.VEHICLES.find(x => x.id === vehId);
        const obj = window.world3DFactory.createVehicle3D(cfg, [], { isPlayer: false });
        if (obj.wingsGroup) obj.wingsGroup.scale.set(1, 1, 1);
        obj.root.rotation.y = 0.7;
        const prev = this.showroomVehObj;
        if (prev) prev.root.visible = false;
        this.showroomScene.add(obj.root);
        this.showroomRenderer.render(this.showroomScene, this.showroomCamera);
        const url = this.showroomRenderer.domElement.toDataURL('image/png');
        this.showroomScene.remove(obj.root);
        if (prev) prev.root.visible = true;
        this.thumbCache[vehId] = url;
        return url;
      } catch (e) {
        console.warn('thumb failed', e);
        return '';
      }
    },

    // --------------------------------------------------------------- vehicles
    makeVehicle(vehCfg, equipped, isPlayer) {
      const opts = {
        isPlayer: Boolean(isPlayer),
        driverTexture: isPlayer && window.playerAvatar ? window.playerAvatar.getTexture() : null,
        driverColor: vehCfg.color,
        nightLights: Boolean(this.track && this.track.config && this.track.config.envType === 'city' && this.state !== 'menu')
      };
      return window.world3DFactory.createVehicle3D(vehCfg, equipped || [], opts);
    },

    // ---------------------------------------------------------------- quality
    detectInitialQuality() {
      try {
        const q = new URLSearchParams(location.search).get('q');
        if (q === 'low' || q === 'high') return q;
        const saved = localStorage.getItem('apex_quality');
        if (saved === 'low' || saved === 'high') return saved;
      } catch (e) {}
      return 'high';
    },

    toggleQuality() {
      const next = this.quality === 'high' ? 'low' : 'high';
      try { localStorage.setItem('apex_quality', next); sessionStorage.setItem('apex_autoq_done', '1'); } catch (e) {}
      this.showToast(next === 'low' ? 'עוברים לגרפיקה קלה…' : 'עוברים לגרפיקה גבוהה…');
      setTimeout(() => location.reload(), 350);
    },

    // On slow computers, drop to light graphics once (after measuring the menu animation).
    sampleMenuPerformance(dt) {
      if (this.perfDone) return;
      if (this.perfSamples.length < 150) {
        if (dt > 0) this.perfSamples.push(dt);
        return;
      }
      this.perfDone = true;
      const sorted = this.perfSamples.slice(30).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] || 0.016;
      let already = false;
      try { already = sessionStorage.getItem('apex_autoq_done') === '1'; } catch (e) {}
      let userChose = false;
      try { userChose = Boolean(localStorage.getItem('apex_quality')); } catch (e) {}
      if (median > 0.03 && this.quality === 'high' && !already && !userChose) {
        try { localStorage.setItem('apex_quality', 'low'); sessionStorage.setItem('apex_autoq_done', '1'); } catch (e) {}
        this.showToast('מתאים את הגרפיקה למחשב שלכם…');
        setTimeout(() => location.reload(), 500);
      }
    },

    // ------------------------------------------------------------ station tick
    updateStations(dt, fx, fy, fz) {
      let x, y, z;
      const p = this.player;
      if (fx !== undefined) {
        x = fx; y = fy; z = fz;
      } else if (p && this.track) {
        x = this.track.getCurveXAt(p.z) + p.laneX; y = p.y; z = p.z;
      } else {
        return;
      }
      this._focus.set(x, y, z);
      for (const e of this.stationCtrls || []) {
        if (e.ctrl && e.ctrl.update) e.ctrl.update(dt, this._focus);
      }
      if (this.sceneRefs && this.sceneRefs.env && this.sceneRefs.env.update) {
        this.sceneRefs.env.update(dt, this._focus);
      }
      // Fallback service (no 3D crew module): a simple timed progress
      const fb = this.panel && this.panel.fallback;
      if (fb) {
        fb.t += dt;
        const f = Math.min(1, fb.t / fb.dur);
        fb.onProgress(f);
        if (f >= 1) {
          this.panel.fallback = null;
          fb.onDone();
        }
      }
    },

    // ------------------------------------------------------------- pit flow
    findStationCtrl(st) {
      const e = (this.stationCtrls || []).find(s => s.data === st);
      return e ? e.ctrl : null;
    },

    engagePit(st) {
      const ctrl = this.findStationCtrl(st);
      st.visited = true;
      const laneX = ctrl && typeof ctrl.parkLaneX === 'number' ? ctrl.parkLaneX : st.type === 'fuel' ? -7 : 7;
      this.pitTarget = { st, ctrl, laneX, z: st.z + ((ctrl && ctrl.parkLocalZ) || 0) };
      this.state = 'pit_approach';
      window.soundFX.playTone(520, 0.1, 'triangle', 0.1, 760);
      this.addFloatingText(st.type === 'fuel' ? '⛽ נכנסים לתחנת הדלק…' : '🔧 נכנסים למוסך…');
    },

    tryManualPitStop() {
      const p = this.player;
      if (!p || this.state !== 'racing' || p.inSkyMode || !p.onGround) return;
      for (const st of this.track.stations) {
        const d = st.z - p.z;
        if (!st.visited && d > 70 && d < 520) {
          st.skipped = false;
          this.engagePit(st);
          return;
        }
      }
    },

    beginPitService() {
      const p = this.player;
      const T = this.pitTarget;
      if (!T) return;
      this.state = 'pit_service';
      this.pitCamTime = 0;
      this.floatingTexts = [];
      window.soundFX.stopEngineSound();
      if (T.ctrl && T.ctrl.prepare) T.ctrl.prepare(p.meshObj);
      this.openPitPanel(T.st.type === 'fuel' ? 'fuel' : 'parts', T.st);
    },

    // Old entry point used by the crash / out-of-fuel code: no crew, just the question.
    openMathModal(type, stationObj) {
      this.state = 'paused_modal';
      this.pitTarget = null;
      window.soundFX.stopEngineSound();
      this.openPitPanel(type, stationObj || {});
    },

    openPitPanel(kind, station) {
      const p = this.player;
      this.panel = {
        kind,
        station,
        step: 'choose',
        part: null,
        wrong: 0,
        locked: false,
        fallback: null,
        exitTimer: null,
        serviceKind: null,
        gains: []
      };
      const el = $('qpanel');
      el.className = `show ${kind}`;
      const meta = {
        fuel: { ico: '⛽', title: (station && station.name) || 'תחנת דלק', sub: 'פותרים שאלה והצוות ממלא לכם דלק' },
        parts: { ico: '🔧', title: (station && station.name) || 'מוסך מרוצים', sub: 'בוחרים מה להתקין, פותרים שאלה והצוות מתקין' },
        revive: { ico: '⚡', title: 'הרכב נעצר!', sub: (station && station.name) || 'פותרים שאלה כדי להתניע מחדש' }
      }[kind] || { ico: '❓', title: 'שאלה', sub: '' };
      $('qp-ico').textContent = meta.ico;
      $('qp-title').textContent = meta.title;
      $('qp-sub').textContent = meta.sub;
      this.renderStreakDots();

      window.mathEngine.stopVideoTutorial();
      const drawer = $('ai-tutor-drawer');
      if (drawer) drawer.classList.remove('open');

      if (kind === 'parts') {
        this.selectedPitPart = p.flatTires ? 'tires' : this.selectedPitPart || 'tires';
        this.renderPartTiles();
        this.showPanelStep('choose');
      } else {
        this.askQuestion(kind === 'fuel' ? 'fuel' : 'revive');
      }
    },

    hidePitPanel() {
      const el = $('qpanel');
      if (el) el.className = '';
      if (window.mathEngine) window.mathEngine.stopVideoTutorial();
      if (this.panel && this.panel.exitTimer) clearInterval(this.panel.exitTimer);
    },

    showPanelStep(step) {
      if (!this.panel) return;
      this.panel.step = step;
      ['choose', 'question', 'service', 'done'].forEach(s => {
        const e = $(`qp-step-${s}`);
        if (e) e.classList.toggle('on', s === step);
      });
    },

    renderStreakDots() {
      const p = this.player;
      const n = p ? (p.streak || 0) % window.ECONOMY.streakEvery : 0;
      document.querySelectorAll('#qp-streak i').forEach((d, i) => d.classList.toggle('on', i < n));
    },

    renderPartTiles() {
      const p = this.player;
      $('qp-parts').innerHTML = window.PIT_STOP_PARTS.map(part => `
        <button class="qp-part ${this.selectedPitPart === part.id ? 'selected' : ''}" onclick="window.game.selectPitPart('${part.id}')">
          ${part.id === 'tires' && p.flatTires ? '<span class="need">פנצ׳ר! דרוש</span>' : ''}
          <div class="ico">${part.icon}</div>
          <div class="nm">${part.name}</div>
          <div class="ds">${part.desc}</div>
        </button>`).join('');
      $('qp-choose-text').textContent = p.flatTires
        ? '🛞 יש לכם פנצ׳ר מהקוצים! כדאי להחליף גלגלים. מה הצוות יתקין?'
        : 'מה הצוות יתקין היום?';
    },

    selectPitPart(partId) {
      this.selectedPitPart = partId;
      window.soundFX.playTone(580, 0.08, 'triangle', 0.1);
      this.renderPartTiles();
    },

    confirmPart() {
      if (!this.panel || this.panel.step !== 'choose') return;
      this.panel.part = this.selectedPitPart || 'tires';
      this.askQuestion(PART_CONTEXT[this.panel.part] || 'general');
    },

    askQuestion(context) {
      const grade = window.playerStore.state.mathGrade || 'junior';
      this.currentQuestion = window.mathEngine.generateQuestion(grade, context);
      const q = this.currentQuestion;
      this.panel.wrong = 0;
      this.panel.locked = false;
      $('qp-prompt').textContent = q.prompt;
      $('qp-expr').textContent = q.expression;
      $('qp-topic').textContent = q.topic ? `נושא: ${q.topic}` : '';
      $('qp-feedback').textContent = '';
      $('qp-feedback').className = 'qp-feedback';
      $('qp-answers').innerHTML = q.options
        .map((opt, i) => `<button class="qp-ans" onclick="window.game.submitMathAnswer(${opt}, this)"><span class="key">${i + 1}</span>${opt}</button>`)
        .join('');
      const drawer = $('ai-tutor-drawer');
      if (drawer) drawer.classList.remove('open');
      window.mathEngine.stopVideoTutorial();
      this.showPanelStep('question');
    },

    submitMathAnswer(chosenVal, btnEl) {
      if (!this.currentQuestion || !this.panel || this.panel.locked || this.panel.step !== 'question') return;
      const p = this.player;
      const isCorrect = Number(chosenVal) === Number(this.currentQuestion.answer);
      const fb = $('qp-feedback');

      if (isCorrect) {
        this.panel.locked = true;
        btnEl.classList.add('correct');
        document.querySelectorAll('#qp-answers .qp-ans').forEach(b => (b.disabled = true));
        p.streak = (p.streak || 0) + 1;
        const gained = window.playerStore.rewardCorrectAnswer(p.streak);
        const bonus = p.streak % window.ECONOMY.streakEvery === 0;
        window.soundFX.playCorrectAnswer();
        this.floatDelta(`+${gained}`, true);
        this.pulseWallet('up');
        this.setFace('cheer');
        fb.className = 'qp-feedback ok';
        fb.textContent = bonus ? `✅ נכון! +${gained} נקודות, כולל בונוס של 3 ברצף 🔥` : `✅ נכון! +${gained} נקודות`;
        this.renderStreakDots();
        this.refreshWallet();
        setTimeout(() => this.onCorrectAnswer(), 800);
      } else {
        btnEl.classList.add('wrong');
        btnEl.disabled = true;
        this.panel.wrong++;
        p.streak = 0;
        const lost = window.playerStore.penalizeWrongAnswer();
        window.soundFX.playWrongAnswer();
        this.floatDelta(lost > 0 ? `-${lost}` : '0', false);
        this.pulseWallet('down');
        this.setFace('ouch');
        const tip = this.currentQuestion.similar && this.currentQuestion.similar.aiTip;
        fb.className = 'qp-feedback bad';
        fb.textContent =
          (lost > 0 ? `❌ לא מדויק, ירדו ${lost} נקודות. ` : '❌ לא מדויק. ') + 'אפשר לנסות שוב.' + (tip ? ` 💡 ${tip}` : '');
        this.renderStreakDots();
        this.refreshWallet();
        const t = this.findStationCtrl(this.pitTarget && this.pitTarget.st);
        if (t && t.oops) t.oops();
        if (this.panel.wrong >= 2) this.openAITutorVideo();
      }
    },

    onCorrectAnswer() {
      if (!this.panel) return;
      if (this.panel.kind === 'revive') {
        this.applyReviveReward();
        return;
      }
      this.startCrewService();
    },

    startCrewService() {
      const p = this.player;
      const panel = this.panel;
      const T = this.pitTarget;
      panel.serviceKind = panel.kind === 'fuel' ? 'fuel' : panel.part || 'tires';
      panel.startFuel = p.fuel;
      this.showPanelStep('service');
      $('qp-service-title').textContent = SERVICE_TITLE[panel.serviceKind] || 'הצוות עובד…';
      $('qp-service-live').textContent = '';
      this.setRing(0);

      const onProgress = f => this.onServiceProgress(f);
      const onDone = () => this.onServiceDone();
      if (T && T.ctrl && T.ctrl.startService) {
        T.ctrl.startService(p.meshObj, panel.serviceKind, onProgress, onDone);
      } else {
        panel.fallback = { t: 0, dur: 2.6, onProgress, onDone };
      }
    },

    setRing(f) {
      const circ = 264;
      const fg = $('qp-ring-fg');
      if (fg) fg.style.strokeDashoffset = String(circ * (1 - Math.max(0, Math.min(1, f))));
      const pct = $('qp-pct');
      if (pct) pct.textContent = `${Math.round(f * 100)}%`;
    },

    onServiceProgress(f) {
      if (!this.panel || this.panel.step !== 'service') return;
      const p = this.player;
      this.panel.serviceU = f;
      this.setRing(f);
      const live = $('qp-service-live');
      if (this.panel.serviceKind === 'fuel') {
        p.fuel = this.panel.startFuel + (p.maxFuel - this.panel.startFuel) * f;
        live.textContent = `⛽ ${Math.round((p.fuel / p.maxFuel) * 60)} ליטר במיכל`;
      } else if (this.panel.serviceKind === 'tires') {
        live.textContent = `🛞 גלגל ${Math.min(4, 1 + Math.floor(f * 4))} מתוך 4`;
      } else if (this.panel.serviceKind === 'turbo') {
        live.textContent = `🚀 טעינת טורבו ${Math.round(f * 100)}%`;
      } else if (this.panel.serviceKind === 'suspension') {
        live.textContent = '🔩 מהדקים את הבולמים…';
      } else {
        live.textContent = '🛡️ מטעינים את המגן…';
      }
    },

    onServiceDone() {
      if (!this.panel || this.panel.step === 'done') return;
      const p = this.player;
      const panel = this.panel;
      const gains = [];
      const kind = panel.serviceKind;

      if (kind === 'fuel') {
        p.fuel = p.maxFuel;
        p.nitro = Math.min(100, p.nitro + 40);
        gains.push('⛽ מיכל מלא', '🔥 +40% טורבו');
      } else {
        p.health = Math.min(100, p.health + 40);
        p.fuel = Math.min(p.maxFuel, p.fuel + 20);
        gains.push('🛡️ שלדה +40%', '⛽ +20% דלק');
        if (kind === 'tires') {
          p.maxSpeed += 10;
          if (p.flatTires) gains.push('🛞 הפנצ׳ר תוקן');
          p.flatTires = false;
          if (p.meshObj.setFlatTires) p.meshObj.setFlatTires(false);
          gains.push('⚡ מהירות מרבית +10');
        } else if (kind === 'turbo') {
          p.nitro = 100;
          gains.push('🚀 טורבו מלא');
        } else if (kind === 'suspension') {
          p.health = 100;
          gains.push('🔩 שלדה 100%');
        } else if (kind === 'shield') {
          p.shieldActive = true;
          gains.push('🛡️ מגן אנרגיה פעיל');
        }
      }
      panel.gains = gains;
      const T = this.pitTarget;
      if (T && T.ctrl && T.ctrl.cheer) T.ctrl.cheer();
      this.setFace('cheer');
      window.soundFX.playVictory && window.soundFX.playVictory();
      this.punchFov(4);

      $('qp-done-ico').textContent = kind === 'fuel' ? '⛽' : '🔧';
      $('qp-done-title').textContent = kind === 'fuel' ? 'המיכל מלא! הצוות סימן ירוק' : 'הרכב מוכן! הצוות סימן ירוק';
      $('qp-gain').innerHTML = gains.map(g => `<span>${g}</span>`).join('');
      this.showPanelStep('done');

      let left = 4;
      const btn = $('qp-go-btn');
      btn.textContent = `🏁 יוצאים! (${left})`;
      panel.exitTimer = setInterval(() => {
        left--;
        if (left <= 0) {
          clearInterval(panel.exitTimer);
          this.leavePit();
        } else {
          btn.textContent = `🏁 יוצאים! (${left})`;
        }
      }, 1000);
    },

    leavePit() {
      const panel = this.panel;
      if (!panel) return;
      if (panel.exitTimer) clearInterval(panel.exitTimer);
      const p = this.player;
      this.hidePitPanel();
      const wasPit = Boolean(this.pitTarget);
      this.panel = null;
      this.pitTarget = null;
      this.state = 'racing';
      this.setFace('neutral');
      p.invulnerableTimer = Math.max(p.invulnerableTimer, 1.5);
      p.vz = Math.max(p.vz, p.maxSpeed * (wasPit ? 0.8 : 0.9));
      if (!wasPit) p.y = this.track.getHeightAt(p.z);
      this.punchFov(8);
      this.shakeRig.addTrauma(0.2);
      this.addFloatingText('🏁 יוצאים לדרך!');
      window.soundFX.startEngineSound(p.veh.isFlyingTesla);
    },

    // The old "back to life" flow after a crash
    applyReviveReward() {
      const p = this.player;
      this.hidePitPanel();
      this.panel = null;
      p.health = 100;
      p.fuel = Math.max(p.fuel, p.maxFuel * 0.65);
      p.y = this.track.getHeightAt(p.z);
      p.vy = 0;
      p.pitch = 0;
      p.roll = 0;
      p.onGround = true;
      p.invulnerableTimer = 3.0;
      p.vz = p.maxSpeed * 0.92;
      this.state = 'racing';
      this.punchFov(8);
      this.shakeRig.addTrauma(0.3);
      this.addFloatingText('⚡ חזרתם לחיים! הרכב תוקן');
      window.soundFX.startEngineSound(p.veh.isFlyingTesla);
      this.setFace('neutral');
    },

    // Emergency "out of fuel" question (no crew): after answering, fill up by timer
    // (handled by startCrewService fallback because pitTarget is null)

    // ------------------------------------------------------------ spikes
    hitSpikes(strip) {
      const p = this.player;
      const wx = this.track.getCurveXAt(strip.z) + p.laneX;
      const gy = this.track.getHeightAt(strip.z);
      if (p.shieldActive) {
        p.shieldActive = false;
        this.punchFov(6);
        this.shakeRig.addTrauma(0.3);
        this.spawn3DBurst(wx, gy + 0.8, strip.z, 0x00f0ff, 22);
        window.soundFX.playFireRing();
        this.addFloatingText('🛡️ המגן הציל אתכם מהקוצים!');
        return false;
      }
      p.flatTires = true;
      p.health = Math.max(0, p.health - window.ECONOMY.spikeHealthLoss);
      p.vz *= 0.55;
      if (p.meshObj.setFlatTires) p.meshObj.setFlatTires(true);
      this.shakeRig.addTrauma(0.6);
      this.triggerHitstop(70, 0.06);
      this.spawn3DBurst(wx, gy + 0.5, strip.z, 0xffcc66, 26);
      window.soundFX.playCrash();
      this.addFloatingText('💥 קוצים! הגלגלים התפנצ׳רו. הרכב איטי עד המוסך');
      this.setFace('ouch');
      setTimeout(() => this.setFace('neutral'), 900);
      if (p.health <= 0) {
        this.triggerCrashRevive('הגלגלים התפוצצו מהקוצים!');
        return true;
      }
      return false;
    },

    // ------------------------------------------------------------ tutor video
    openAITutorVideo() {
      if (!this.currentQuestion || !this.currentQuestion.similar) return;
      const drawer = $('ai-tutor-drawer');
      if (!drawer) return;
      drawer.classList.add('open');
      const sim = this.currentQuestion.similar;
      $('ai-tutor-title').textContent = `🤖 ${sim.title} (דוגמה: ${sim.exampleExpr})`;
      $('ai-tutor-tip').textContent = `💡 ${sim.aiTip}`;
      const dotsWrap = $('tutor-step-dots');
      const updateDots = activeIdx => {
        if (!dotsWrap) return;
        dotsWrap.innerHTML = sim.steps
          .map((s, idx) => `<span class="step-dot ${idx === activeIdx ? 'active' : ''}" onclick="window.mathEngine.setVideoStep(${idx})">${idx + 1}</span>`)
          .join('');
      };
      updateDots(0);
      window.mathEngine.startVideoTutorial(sim, $('tutor-video-canvas'), idx => updateDots(idx));
    },

    // ------------------------------------------------------------ HUD helpers
    updateHudExtras() {
      const p = this.player;
      if (!p) return;
      const flat = $('hud-flat-badge');
      if (flat) flat.classList.toggle('show', Boolean(p.flatTires));
      if (p.flatTires && this.state === 'racing' && this.shakeRig.trauma < 0.1) this.shakeRig.addTrauma(0.02);

      // Distance banner for the next station
      const banner = $('pit-banner');
      if (!banner || !this.track) return;
      let near = null;
      if (this.state === 'racing' && !p.inSkyMode) {
        for (const st of this.track.stations) {
          const d = st.z - p.z;
          if (!st.visited && !st.skipped && d > 0 && d < 520) {
            if (st.type === 'fuel' && p.fuel > p.maxFuel * 0.8) continue;
            near = { st, d };
            break;
          }
        }
      }
      if (near) {
        banner.className = `show ${near.st.type}`;
        $('pb-ico').textContent = near.st.type === 'fuel' ? '⛽' : '🔧';
        $('pb-text').textContent = near.st.type === 'fuel' ? 'תחנת דלק בעוד' : 'מוסך בעוד';
        $('pb-dist').textContent = `${Math.max(10, Math.round(near.d / 10) * 10)} מ׳`;
      } else if (banner.className) {
        banner.className = '';
      }
    },

    refreshWallet() {
      const st = window.playerStore.state;
      document.querySelectorAll('.wallet-points-val').forEach(el => (el.textContent = st.points.toLocaleString()));
    },

    pulseWallet(dir) {
      const cls = dir === 'up' ? 'pulse-up' : 'pulse-down';
      document.querySelectorAll('.stat-pill.points').forEach(el => {
        el.classList.remove('pulse-up', 'pulse-down');
        void el.offsetWidth;
        el.classList.add(cls);
      });
    },

    floatDelta(text, up) {
      const anchor = document.querySelector('#qpanel.show .qp-head') || document.querySelector('.hud-coins');
      const r = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2, top: 120, width: 0 };
      const f = document.createElement('div');
      f.className = `qp-floater ${up ? 'up' : 'down'}`;
      f.textContent = `${text} 🪙`;
      f.style.left = `${r.left + r.width / 2 - 30}px`;
      f.style.top = `${r.top + 30}px`;
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 1200);
    },

    setFace(mood) {
      const face = $('hud-face');
      if (!face) return;
      face.classList.remove('cheer', 'ouch');
      if (mood === 'cheer' || mood === 'ouch') {
        void face.offsetWidth;
        face.classList.add(mood);
        setTimeout(() => face.classList.remove(mood), 1100);
      }
      const veh = this.player && this.player.meshObj;
      if (veh && veh.driver && veh.driver.setExpression) {
        veh.driver.setExpression(mood === 'cheer' ? 'happy' : mood === 'ouch' ? 'ouch' : 'neutral');
      }
    },

    renderHudDriver() {
      const st = window.playerStore.state;
      const nm = $('hud-name');
      if (nm) nm.textContent = st.playerName || 'נהג';
      const slot = $('hud-face-slot');
      if (slot) {
        slot.innerHTML = window.playerAvatar && window.playerAvatar.has()
          ? `<img id="hud-face" class="hud-face" alt="" src="${window.playerAvatar.dataUrl}">`
          : '<div id="hud-face" class="hud-face">🙂</div>';
      }
      const ps = $('podium-face-slot');
      if (ps) {
        ps.innerHTML = window.playerAvatar && window.playerAvatar.has()
          ? `<img class="driver-photo" alt="" src="${window.playerAvatar.dataUrl}">`
          : '';
      }
    },

    renderDriverCard() {
      const st = window.playerStore.state;
      const slot = $('driver-photo-slot');
      if (slot) {
        slot.innerHTML = window.playerAvatar && window.playerAvatar.has()
          ? `<img class="driver-photo" alt="התמונה שלכם" src="${window.playerAvatar.dataUrl}">`
          : '<div class="driver-photo empty">🙂</div>';
      }
      const input = $('driver-name-input');
      if (input && document.activeElement !== input) input.value = st.playerName || '';
      const clear = $('driver-clear-btn');
      if (clear) clear.style.display = window.playerAvatar && window.playerAvatar.has() ? '' : 'none';
      const q = $('quality-toggle-btn');
      if (q) q.textContent = `⚙️ גרפיקה: ${this.quality === 'high' ? 'גבוהה' : 'קלה'}`;
    },

    // ------------------------------------------------------------ driver photo
    async handleAvatarFile(input) {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const res = await window.playerAvatar.setFromFile(file);
      this.showToast(res.msg);
      if (res.ok) window.soundFX.playCorrectAnswer();
    },

    async openSelfieDialog() {
      $('selfie-dialog').classList.add('active');
      $('selfie-msg').textContent = 'מפעילים את המצלמה… אשרו את ההרשאה בדפדפן';
      const res = await window.playerAvatar.startCamera($('selfie-video'));
      $('selfie-msg').textContent = res.ok ? '' : res.msg;
    },

    snapSelfie() {
      const res = window.playerAvatar.snapshotFromVideo($('selfie-video'));
      this.showToast(res.msg);
      if (res.ok) {
        window.soundFX.playCorrectAnswer();
        this.closeSelfieDialog();
      }
    },

    closeSelfieDialog() {
      window.playerAvatar.stopCamera();
      $('selfie-dialog').classList.remove('active');
    },

    clearAvatar() {
      window.playerAvatar.clear();
      this.showToast('התמונה הוסרה');
    },

    // ------------------------------------------------------------ intro
    showIntro() {
      $('intro-dialog').classList.add('active');
    },
    closeIntro() {
      $('intro-dialog').classList.remove('active');
      window.playerStore.state.seenIntro = true;
      window.playerStore.save();
    },

    // ------------------------------------------------------------ buying
    handleVehicleAction(vehId) {
      this.requestBuyVehicle(vehId);
    },

    requestBuyVehicle(vehId) {
      const v = window.VEHICLES.find(x => x.id === vehId);
      if (!v) return;
      const st = window.playerStore.state;
      if (st.ownedVehicles.includes(vehId)) {
        const res = window.playerStore.buyVehicle(vehId); // selects it
        this.previewVehId = vehId;
        window.soundFX.playTone(620, 0.09, 'triangle', 0.1);
        this.showToast(res.msg);
        this.refreshAllUI();
        return;
      }
      this.previewVehId = vehId;
      const box = $('buy-dialog-box');
      box.classList.remove('success');
      const afford = window.playerStore.canAfford(v.price);
      $('buy-title').textContent = afford ? `לקנות את ${v.name}?` : 'עוד קצת נקודות…';
      if (afford) {
        $('buy-sub').textContent = v.kindLabel;
        $('buy-math').innerHTML = `<span>🪙 ${st.points}</span><span>−</span><b>${v.price}</b><span>=</span><span>🪙 ${st.points - v.price}</span>`;
        $('buy-actions').innerHTML = `
          <button class="btn btn-gold btn-lg" onclick="window.game.confirmBuyVehicle('${v.id}')">✅ כן, קונים!</button>
          <button class="btn btn-cyber" onclick="window.game.closeBuyDialog()">לא עכשיו</button>`;
      } else {
        const missing = v.price - st.points;
        $('buy-sub').textContent = `חסרות לכם ${missing} נקודות כדי לקנות את ${v.name}. תשובה נכונה בתחנה מביאה 10 נקודות, ומקום ראשון במרוץ מביא 200!`;
        $('buy-math').innerHTML = `<span>🪙 ${st.points}</span><span>/</span><b>🪙 ${v.price}</b>`;
        $('buy-actions').innerHTML = `
          <button class="btn btn-primary" onclick="window.game.closeBuyDialog(); window.game.showScreen('lobby-screen')">🏁 למרוץ, להרוויח נקודות</button>
          <button class="btn btn-cyber" onclick="window.game.closeBuyDialog()">הבנתי</button>`;
      }
      $('buy-dialog').classList.add('active');
      this.refreshAllUI();
    },

    confirmBuyVehicle(vehId) {
      const res = window.playerStore.buyVehicle(vehId);
      const v = window.VEHICLES.find(x => x.id === vehId);
      if (!res.ok) {
        window.soundFX.playWrongAnswer();
        this.showToast(res.msg);
        this.closeBuyDialog();
        return;
      }
      this.previewVehId = vehId;
      window.soundFX.playCorrectAnswer();
      $('buy-dialog-box').classList.add('success');
      $('buy-title').textContent = '🎉 הרכב שלכם!';
      $('buy-sub').textContent = `${v.name} חיכה לכם במוסך, והוא כבר הרכב הפעיל שלכם.`;
      $('buy-math').innerHTML = `<span>נשארו לכם 🪙 ${window.playerStore.state.points}</span>`;
      $('buy-actions').innerHTML = `
        <button class="btn btn-primary btn-lg" onclick="window.game.closeBuyDialog(); window.game.showScreen('lobby-screen')">🏁 יוצאים למרוץ!</button>
        <button class="btn btn-cyber" onclick="window.game.closeBuyDialog()">להמשיך להסתכל</button>`;
      this.confetti();
      this.refreshAllUI();
    },

    closeBuyDialog() {
      const d = $('buy-dialog');
      if (d) d.classList.remove('active');
    },

    confetti() {
      const colors = ['#ffd700', '#00f0ff', '#ff4d6d', '#22e57a', '#b537f2', '#ff9d5c'];
      for (let i = 0; i < 46; i++) {
        const c = document.createElement('i');
        c.className = 'confetti-bit';
        c.style.left = `${Math.random() * 100}vw`;
        c.style.background = colors[i % colors.length];
        c.style.animationDelay = `${Math.random() * 0.4}s`;
        c.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
        c.style.transform = `rotate(${Math.random() * 360}deg)`;
        document.body.appendChild(c);
        setTimeout(() => c.remove(), 3400);
      }
    },

    renderShowroomBuyBar(v) {
      const bar = $('showroom-buy');
      if (!bar) return;
      const owned = window.playerStore.state.ownedVehicles.includes(v.id);
      bar.classList.toggle('show', !owned);
      if (owned) return;
      const pts = window.playerStore.state.points;
      $('showroom-buy-price').textContent = `🪙 ${v.price}`;
      $('showroom-buy-need').textContent =
        pts >= v.price ? `יש לכם ${pts} נקודות: אפשר לקנות!` : `חסרות ${v.price - pts} נקודות`;
      const btn = $('showroom-buy-btn');
      btn.className = `btn ${pts >= v.price ? 'btn-gold' : 'btn-cyber'}`;
      btn.textContent = pts >= v.price ? '🛒 קנו את הרכב' : '🛒 מה חסר לי?';
    }
  });

  // Hook extra renders into the existing UI refresh without rewriting it.
  const origRefresh = G.refreshAllUI;
  G.refreshAllUI = function () {
    origRefresh.call(this);
    this.renderDriverCard();
    this.renderHudDriver();
  };
  const origStats = G.renderSelectedVehicleStats;
  G.renderSelectedVehicleStats = function () {
    origStats.call(this);
    const st = window.playerStore.state;
    const v = window.VEHICLES.find(x => x.id === (this.previewVehId || st.selectedVehicle)) || window.VEHICLES[0];
    this.renderShowroomBuyBar(v);
  };
  const origHud = G.updateHUD;
  G.updateHUD = function () {
    origHud.call(this);
    this.updateHudExtras();
  };

  // Constructor hook: run initPass4 right after the constructor body (DOM is ready by then).
  window.addEventListener('DOMContentLoaded', () => {
    if (window.game && window.game.initPass4) window.game.initPass4();
  });
})();
