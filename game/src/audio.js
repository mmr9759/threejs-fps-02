// audio.js — every sound is synthesized with WebAudio: no audio files, no
// network, nothing to load. One shared AudioContext, created on the first
// user gesture (the DEPLOY click), so browsers never block it.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // 1 s of white noise, reused by every percussive sound.
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  // Short filtered noise burst: the body of a gunshot.
  _burst(dur, freq, gain, type = 'lowpass', q = 0.8) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
    src.stop(t + dur + 0.1);
  }

  // Short tone blip with a pitch slide.
  _tone(f0, f1, dur, gain, type = 'square') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  shot(weaponId, distant = false) {
    if (!this.ctx) return;
    const g = distant ? 0.10 : 0.5;
    switch (weaponId) {
      case 'vk47': this._burst(0.14, 900, g); this._tone(160, 55, 0.10, g * 0.7, 'sawtooth'); break;
      case 'hornet': this._burst(0.09, 1400, g * 0.8); this._tone(220, 90, 0.06, g * 0.5, 'sawtooth'); break;
      case 'longbow': this._burst(0.22, 600, g * 1.1); this._tone(110, 40, 0.18, g * 0.8, 'sawtooth'); break;
      case 'm590': this._burst(0.2, 500, g * 1.1); this._tone(90, 35, 0.16, g * 0.9, 'sawtooth'); break;
      default: this._burst(0.11, 1100, g * 0.85); this._tone(190, 70, 0.08, g * 0.5, 'sawtooth');
    }
  }

  dry() { this._tone(1400, 900, 0.05, 0.18, 'square'); }
  reload() { this._tone(500, 300, 0.06, 0.2, 'square'); setTimeout(() => this._tone(700, 500, 0.06, 0.2, 'square'), 320); }
  hit() { this._tone(1900, 1500, 0.05, 0.22, 'sine'); }
  headshot() { this._tone(2400, 1800, 0.07, 0.26, 'sine'); }
  hurt() { this._tone(120, 60, 0.18, 0.35, 'sawtooth'); this._burst(0.12, 400, 0.2); }
  step(run) { this._burst(0.05, run ? 500 : 320, run ? 0.10 : 0.06); }
  plantBeep() { this._tone(880, 880, 0.09, 0.25, 'sine'); }
  defuseBeep() { this._tone(660, 660, 0.09, 0.22, 'sine'); }
  plantDone() { this._tone(440, 880, 0.35, 0.3, 'sine'); }
  explosion() {
    this._burst(1.1, 180, 1.0); this._tone(70, 28, 1.0, 0.7, 'sine');
    setTimeout(() => this._burst(0.5, 300, 0.4), 120);
  }
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, f, 0.22, 0.25, 'triangle'), i * 130)); }
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, f, 0.24, 0.22, 'triangle'), i * 140)); }
  buy() { this._tone(980, 1240, 0.07, 0.22, 'sine'); }
  denied() { this._tone(220, 160, 0.12, 0.25, 'square'); }
  click() { this._tone(800, 800, 0.04, 0.15, 'sine'); }
  flashRing() { this._tone(3200, 2400, 0.5, 0.12, 'sine'); }
  bounce() { this._tone(300, 180, 0.08, 0.18, 'triangle'); }
}
