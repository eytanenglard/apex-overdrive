// ============================================================================
// APEX OVERDRIVE - Procedural Web Audio Synthesizer & Sound Engine
// ============================================================================

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.musicInterval = null;
    this.musicPlaying = false;
    this.beatStep = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopEngineSound();
      this.stopMusic();
    }
    return this.muted;
  }

  startEngineSound(isElectric = false) {
    if (this.muted) return;
    this.init();
    if (!this.ctx || this.engineOsc) return;

    this.engineOsc = this.ctx.createOscillator();
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineGain = this.ctx.createGain();

    this.engineOsc.type = isElectric ? 'sine' : 'sawtooth';
    this.engineOsc.frequency.value = isElectric ? 140 : 55;

    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = isElectric ? 900 : 280;

    this.engineGain.gain.value = 0.05;

    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start();
  }

  updateEngineRPM(speedRatio, isBoosting = false, isFlyingTesla = false) {
    if (!this.engineOsc || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const clamped = Math.max(0, Math.min(1.6, speedRatio));
    if (isFlyingTesla) {
      this.engineOsc.type = 'triangle';
      this.engineOsc.frequency.setTargetAtTime(220 + clamped * 380, now, 0.05);
      this.engineFilter.frequency.setTargetAtTime(1400, now, 0.05);
      this.engineGain.gain.setTargetAtTime(0.06, now, 0.05);
    } else {
      this.engineOsc.type = 'sawtooth';
      const baseFreq = 52 + clamped * 135 + (isBoosting ? 45 : 0);
      this.engineOsc.frequency.setTargetAtTime(baseFreq, now, 0.04);
      this.engineFilter.frequency.setTargetAtTime(240 + clamped * 600 + (isBoosting ? 500 : 0), now, 0.05);
      this.engineGain.gain.setTargetAtTime(isBoosting ? 0.085 : 0.055, now, 0.05);
    }
  }

  stopEngineSound() {
    if (this.engineOsc) {
      try { this.engineOsc.stop(); } catch (e) {}
      this.engineOsc.disconnect();
      this.engineOsc = null;
    }
  }

  playTone(freq, duration = 0.15, type = 'sine', vol = 0.12, slideTo = null) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    }
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playCountdown(finalGo = false) {
    if (finalGo) {
      this.playTone(880, 0.35, 'square', 0.14, 1320);
    } else {
      this.playTone(440, 0.18, 'square', 0.10);
    }
  }

  playFireRing() {
    // High-energy whoosh + chord
    this.playTone(320, 0.32, 'sawtooth', 0.12, 920);
    setTimeout(() => this.playTone(660, 0.25, 'triangle', 0.12, 1100), 60);
  }

  playStuntFlip() {
    this.playTone(523.25, 0.12, 'triangle', 0.12);
    setTimeout(() => this.playTone(659.25, 0.12, 'triangle', 0.12), 80);
    setTimeout(() => this.playTone(1046.5, 0.24, 'triangle', 0.14), 160);
  }

  playTeslaLaunch() {
    this.playTone(180, 0.65, 'sawtooth', 0.15, 1280);
    setTimeout(() => this.playTone(440, 0.55, 'sine', 0.15, 1760), 120);
  }

  playCrash() {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;
    // White noise burst + low boom
    const bufferSize = this.ctx.sampleRate * 0.45;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.15));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.25;

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start();
    this.playTone(110, 0.4, 'sawtooth', 0.18, 32);
  }

  playCorrectAnswer() {
    this.playTone(523.25, 0.12, 'sine', 0.14);
    setTimeout(() => this.playTone(659.25, 0.12, 'sine', 0.14), 90);
    setTimeout(() => this.playTone(783.99, 0.14, 'sine', 0.14), 180);
    setTimeout(() => this.playTone(1046.5, 0.28, 'triangle', 0.16), 270);
  }

  playWrongAnswer() {
    this.playTone(220, 0.22, 'sawtooth', 0.13, 150);
    setTimeout(() => this.playTone(165, 0.3, 'sawtooth', 0.13, 110), 160);
  }

  playVictory() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, idx === notes.length - 1 ? 0.45 : 0.15, 'triangle', 0.15), idx * 120);
    });
  }

  startMusic() {
    if (this.muted || this.musicPlaying) return;
    this.init();
    if (!this.ctx) return;
    this.musicPlaying = true;
    const bassLine = [110, 110, 130.81, 110, 146.83, 130.81, 98, 98];
    this.musicInterval = setInterval(() => {
      if (this.muted || !this.musicPlaying) return;
      const note = bassLine[this.beatStep % bassLine.length];
      this.playTone(note, 0.16, 'sawtooth', 0.032, note * 0.98);
      if (this.beatStep % 4 === 2) {
        this.playTone(note * 2, 0.09, 'triangle', 0.025);
      }
      this.beatStep++;
    }, 210);
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this.musicInterval) {
      clearInterval(this.musicInterval);
      this.musicInterval = null;
    }
  }
}

window.soundFX = new SoundEngine();
