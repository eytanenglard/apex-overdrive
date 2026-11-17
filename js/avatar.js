// ============================================================================
// APEX OVERDRIVE - "My driver": the player's own photo (stays on this computer only).
// The photo is cropped to a square, shrunk to 256px and stored in localStorage.
// It is shown in the HUD, on the podium, and wrapped onto the driver's helmet in 3D
// (the vehicle builder receives window.playerAvatar.getTexture()).
// ============================================================================
(function () {
  const KEY = 'apex_avatar_v1';
  const SIZE = 256;

  class PlayerAvatar {
    constructor() {
      this.dataUrl = null;
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = SIZE;
      this.texture = null;
      this.listeners = [];
      this.stream = null;
      try {
        this.dataUrl = localStorage.getItem(KEY) || null;
      } catch (e) {}
      if (this.dataUrl) this.paintFromUrl(this.dataUrl);
    }

    has() {
      return Boolean(this.dataUrl);
    }

    onChange(cb) {
      this.listeners.push(cb);
    }

    emit() {
      this.listeners.forEach(cb => {
        try { cb(this); } catch (e) {}
      });
    }

    getTexture() {
      if (!this.has() || !window.THREE) return null;
      if (!this.texture) {
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.encoding = THREE.sRGBEncoding;
      }
      return this.texture;
    }

    paintFromUrl(url) {
      const img = new Image();
      img.onload = () => {
        this.drawSquare(img, img.naturalWidth, img.naturalHeight);
        if (this.texture) this.texture.needsUpdate = true;
        this.emit();
      };
      img.src = url;
    }

    // Centre-crop (slightly upwards, where faces usually are) into the 256px square.
    drawSquare(source, w, h) {
      const ctx = this.canvas.getContext('2d');
      const side = Math.min(w, h);
      const sx = (w - side) / 2;
      const sy = Math.max(0, (h - side) * 0.32);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(source, sx, sy, side, side, 0, 0, SIZE, SIZE);
    }

    commit() {
      try {
        this.dataUrl = this.canvas.toDataURL('image/jpeg', 0.84);
        localStorage.setItem(KEY, this.dataUrl);
      } catch (e) {}
      if (this.texture) this.texture.needsUpdate = true;
      this.emit();
    }

    // Returns a Promise<{ok, msg}>
    setFromFile(file) {
      return new Promise(resolve => {
        if (!file || !/^image\//.test(file.type)) {
          resolve({ ok: false, msg: 'צריך לבחור קובץ תמונה (JPG או PNG)' });
          return;
        }
        if (file.size > 15 * 1024 * 1024) {
          resolve({ ok: false, msg: 'התמונה גדולה מדי, נסו תמונה קטנה יותר' });
          return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          this.drawSquare(img, img.naturalWidth, img.naturalHeight);
          URL.revokeObjectURL(url);
          this.commit();
          resolve({ ok: true, msg: 'התמונה שלכם מוכנה! עכשיו תראו את עצמכם נוהגים' });
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({ ok: false, msg: 'לא הצלחתי לפתוח את התמונה, נסו קובץ אחר' });
        };
        img.src = url;
      });
    }

    clear() {
      this.dataUrl = null;
      try { localStorage.removeItem(KEY); } catch (e) {}
      const ctx = this.canvas.getContext('2d');
      ctx.clearRect(0, 0, SIZE, SIZE);
      this.emit();
    }

    // ---- Selfie camera (works on school laptops; the video never leaves the browser) ----
    async startCamera(videoEl) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return { ok: false, msg: 'המצלמה לא זמינה בדפדפן הזה. אפשר להעלות תמונה מהמחשב' };
      }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 640 }, audio: false });
        videoEl.srcObject = this.stream;
        await videoEl.play();
        return { ok: true };
      } catch (e) {
        return { ok: false, msg: 'לא קיבלנו הרשאה למצלמה. אפשר להעלות תמונה מהמחשב' };
      }
    }

    snapshotFromVideo(videoEl) {
      if (!videoEl.videoWidth) return { ok: false, msg: 'המצלמה עוד לא מוכנה' };
      // mirror like a real selfie
      const ctx = this.canvas.getContext('2d');
      const w = videoEl.videoWidth;
      const h = videoEl.videoHeight;
      const side = Math.min(w, h);
      ctx.save();
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.translate(SIZE, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoEl, (w - side) / 2, (h - side) / 2, side, side, 0, 0, SIZE, SIZE);
      ctx.restore();
      this.commit();
      return { ok: true, msg: 'צולם! נראה מעולה' };
    }

    stopCamera() {
      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
      }
    }
  }

  window.playerAvatar = new PlayerAvatar();
})();
