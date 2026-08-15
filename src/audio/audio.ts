/**
 * Ambient audio, synthesised in the browser — no sound files.
 *
 * The aim is something you can leave running: a wind bed that breathes, birds
 * during the day, crickets at night, water if you are near it, and short
 * one-shots for work and construction. Nothing loops obviously, nothing
 * demands attention.
 */

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private started = false;

  private windGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private nightGain: GainNode | null = null;
  private nightOsc: OscillatorNode | null = null;

  private birdTimer = 0;
  private cricketTimer = 0;
  private volume = 0.6;
  muted = false;

  /** Browsers require a gesture before audio can start. */
  ensure(): void {
    if (this.started) {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
    } catch {
      return;
    }
    this.started = true;

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 1;
    this.ambientGain.connect(this.master);

    // Wind: filtered noise with a slowly wandering cutoff.
    const noise = this.noiseSource();
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    noise.connect(windFilter).connect(this.windGain).connect(this.ambientGain);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(windFilter.frequency);
    lfo.start();

    // Water: a quieter, brighter noise bed, faded in when near the pond.
    const water = this.noiseSource();
    const waterFilter = ctx.createBiquadFilter();
    waterFilter.type = 'bandpass';
    waterFilter.frequency.value = 2400;
    waterFilter.Q.value = 0.9;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    water.connect(waterFilter).connect(this.waterGain).connect(this.ambientGain);

    // Crickets: a soft pulsing tone that only shows up after dark.
    this.nightGain = ctx.createGain();
    this.nightGain.gain.value = 0;
    this.nightGain.connect(this.ambientGain);
    const cricket = ctx.createOscillator();
    cricket.type = 'triangle';
    cricket.frequency.value = 4200;
    const cricketAmp = ctx.createGain();
    cricketAmp.gain.value = 0.006;
    const trill = ctx.createOscillator();
    trill.type = 'square';
    trill.frequency.value = 11;
    const trillGain = ctx.createGain();
    trillGain.gain.value = 0.006;
    trill.connect(trillGain).connect(cricketAmp.gain);
    cricket.connect(cricketAmp).connect(this.nightGain);
    cricket.start();
    trill.start();
    this.nightOsc = cricket;
  }

  private noiseSource(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Brown-ish noise: smoother and less hissy than white.
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /**
   * Called each frame with the world's mood.
   * `water` is 0..1 for how much open water is on screen.
   */
  update(dt: number, opts: { night: number; water: number; wind: number; rain: number; population: number }): void {
    if (!this.ctx || !this.started || this.muted) return;
    const now = this.ctx.currentTime;

    if (this.windGain) {
      const target = 0.03 + opts.wind * 0.05 + opts.rain * 0.09;
      this.windGain.gain.setTargetAtTime(target, now, 1.5);
    }
    if (this.waterGain) {
      this.waterGain.gain.setTargetAtTime(opts.water * 0.022, now, 1.2);
    }
    if (this.nightGain) {
      this.nightGain.gain.setTargetAtTime(opts.night * 0.5, now, 2.5);
    }
    if (this.nightOsc) {
      this.nightOsc.frequency.setTargetAtTime(3800 + opts.night * 700, now, 3);
    }

    // Daytime birdsong, sparse and randomised.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 3 + Math.random() * 9 + opts.night * 20;
      if (opts.night < 0.4 && opts.rain < 0.6) this.chirp();
    }

    // A single distant cricket chirp at night to break up the bed.
    this.cricketTimer -= dt;
    if (this.cricketTimer <= 0) {
      this.cricketTimer = 6 + Math.random() * 14;
      if (opts.night > 0.6 && Math.random() < 0.4) this.hoot();
    }
  }

  /** A short two- or three-note bird call. */
  private chirp(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ambientGain) return;
    const notes = 2 + Math.floor(Math.random() * 2);
    const base = 1800 + Math.random() * 1400;
    for (let i = 0; i < notes; i++) {
      const t = ctx.currentTime + i * (0.07 + Math.random() * 0.06);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = ctx.createGain();
      const f = base * (1 + (Math.random() - 0.4) * 0.35);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * (1.1 + Math.random() * 0.4), t + 0.06);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(g).connect(this.ambientGain);
      osc.start(t);
      osc.stop(t + 0.14);
    }
  }

  private hoot(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ambientGain) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.linearRampToValueAtTime(360, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.02, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(g).connect(this.ambientGain);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  // -------------------------------------------------------------------------
  // One-shots
  // -------------------------------------------------------------------------

  private lastOneShot = 0;

  /** Rate-limited so a busy kingdom doesn't turn into a rattle. */
  private canPlay(minGap = 0.06): boolean {
    if (!this.ctx || this.muted) return false;
    const t = this.ctx.currentTime;
    if (t - this.lastOneShot < minGap) return false;
    this.lastOneShot = t;
    return true;
  }

  thud(pitch = 1, gain = 0.05): void {
    if (!this.canPlay()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  chime(semitone = 0, gain = 0.05): void {
    if (!this.canPlay(0.02)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = 523.25 * Math.pow(2, semitone / 12);
    for (const [mul, amp] of [
      [1, 1],
      [2.01, 0.4],
      [3.02, 0.16],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 1.2);
    }
  }

  /** Soft click for UI interactions. */
  tick(): void {
    if (!this.canPlay(0.01)) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.012, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}

export const audio = new Audio();
