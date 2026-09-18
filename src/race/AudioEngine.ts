export class AudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isInitialized: boolean = false;

  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private skidGain: GainNode | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private nitroGain: GainNode | null = null;

  private lastCollisionAt: number = 0;

  // When true, loop gains stay silent (menus); one-shots still play.
  private suspended: boolean = false;

  constructor() {
  }

  public init() {
    if (this.isInitialized) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();

      const compressor = this.ctx.createDynamicsCompressor();
      compressor.connect(this.ctx.destination);

      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(65, this.ctx.currentTime);

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'square';
      this.engineOsc2.frequency.setValueAtTime(32, this.ctx.currentTime);
      const subGain = this.ctx.createGain();
      subGain.gain.setValueAtTime(0.35, this.ctx.currentTime);

      const engineFilter = this.ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.setValueAtTime(450, this.ctx.currentTime);
      this.engineFilter = engineFilter;

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

      this.engineOsc.connect(engineFilter);
      this.engineOsc2.connect(subGain);
      subGain.connect(engineFilter);
      engineFilter.connect(this.engineGain);
      this.engineGain.connect(compressor);
      this.engineOsc.start();
      this.engineOsc2.start();

      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const skidFilter = this.ctx.createBiquadFilter();
      skidFilter.type = 'bandpass';
      skidFilter.frequency.setValueAtTime(1100, this.ctx.currentTime);
      skidFilter.Q.setValueAtTime(3.0, this.ctx.currentTime);

      this.skidGain = this.ctx.createGain();
      this.skidGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

      whiteNoise.connect(skidFilter);
      skidFilter.connect(this.skidGain);
      this.skidGain.connect(compressor);
      whiteNoise.start();

      const windSource = this.ctx.createBufferSource();
      windSource.buffer = noiseBuffer;
      windSource.loop = true;
      windSource.playbackRate.setValueAtTime(0.7, this.ctx.currentTime);
      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.setValueAtTime(500, this.ctx.currentTime);
      this.windFilter.Q.setValueAtTime(0.6, this.ctx.currentTime);
      this.windGain = this.ctx.createGain();
      this.windGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      windSource.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(compressor);
      windSource.start();

      const nitroSource = this.ctx.createBufferSource();
      nitroSource.buffer = noiseBuffer;
      nitroSource.loop = true;
      nitroSource.playbackRate.setValueAtTime(1.4, this.ctx.currentTime);
      const nitroFilter = this.ctx.createBiquadFilter();
      nitroFilter.type = 'highpass';
      nitroFilter.frequency.setValueAtTime(2500, this.ctx.currentTime);
      this.nitroGain = this.ctx.createGain();
      this.nitroGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      nitroSource.connect(nitroFilter);
      nitroFilter.connect(this.nitroGain);
      this.nitroGain.connect(compressor);
      nitroSource.start();

      this.isInitialized = true;
    } catch (e) {
      console.warn('AudioEngine initialization skipped:', e);
    }
  }

  public updateEngine(speedRatio: number, isAccelerating: boolean, isDrifting: boolean) {
    if (!this.ctx || !this.isInitialized || this.isMuted || this.suspended) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const time = this.ctx.currentTime;

    const baseFreq = 70;
    const maxFreq = 340;
    const accelBoost = isAccelerating ? 25 : 0;
    const targetFreq = baseFreq + (maxFreq - baseFreq) * speedRatio + accelBoost;

    if (this.engineOsc) {
      this.engineOsc.frequency.setTargetAtTime(targetFreq, time, 0.08);
    }
    if (this.engineOsc2) {
      this.engineOsc2.frequency.setTargetAtTime(targetFreq * 0.5, time, 0.08);
    }
    if (this.engineFilter) {
      this.engineFilter.frequency.setTargetAtTime(400 + speedRatio * 1400, time, 0.1);
    }

    if (this.engineGain) {
      const volume = 0.08 + speedRatio * 0.10;
      this.engineGain.gain.setTargetAtTime(volume, time, 0.05);
    }

    if (this.skidGain) {
      const skidVol = isDrifting ? 0.15 : 0.0;
      this.skidGain.gain.setTargetAtTime(skidVol, time, 0.04);
    }

    if (this.windGain) {
      const windVol = Math.max(0, speedRatio - 0.35) * 0.15;
      this.windGain.gain.setTargetAtTime(windVol, time, 0.15);
    }
    if (this.windFilter) {
      this.windFilter.frequency.setTargetAtTime(400 + speedRatio * 900, time, 0.2);
    }
  }

  public updateNitro(active: boolean) {
    if (!this.ctx || !this.isInitialized || this.isMuted || this.suspended || !this.nitroGain) return;
    this.nitroGain.gain.setTargetAtTime(active ? 0.07 : 0.0, this.ctx.currentTime, 0.06);
  }

  // Mute the loop gains (menus); one-shot SFX are unaffected.
  public setSuspended(s: boolean) {
    this.suspended = s;
    if (!this.ctx || !this.isInitialized) return;
    if (s) {
      const t = this.ctx.currentTime;
      this.engineGain?.gain.setTargetAtTime(0, t, 0.05);
      this.skidGain?.gain.setTargetAtTime(0, t, 0.05);
      this.windGain?.gain.setTargetAtTime(0, t, 0.05);
      this.nitroGain?.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  public playCountdownBeep(isGo: boolean = false) {
    if (!this.ctx || !this.isInitialized || this.isMuted) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const freq = isGo ? 880 : 440;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    const now = this.ctx.currentTime;
    const duration = isGo ? 0.6 : 0.25;

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + duration);
  }

  public playLapChime() {
    if (!this.ctx || !this.isInitialized || this.isMuted) return;

    const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5
    freqs.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const startTime = this.ctx.currentTime + idx * 0.08;
      osc.frequency.setValueAtTime(f, startTime);

      gain.gain.setValueAtTime(0.18, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.35);
    });
  }

  public playCollision(intensity: number = 0.6) {
    if (!this.ctx || !this.isInitialized || this.isMuted) return;
    const now = performance.now();
    if (now - this.lastCollisionAt < 120) return;
    this.lastCollisionAt = now;

    const ctx = this.ctx;
    const dur = 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + dur);
    const vol = 0.15 + Math.min(0.5, intensity * 0.45);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  public playClick() {
    if (!this.ctx || !this.isInitialized || this.isMuted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.09);
  }

  public playFinishFanfare() {
    if (!this.ctx || !this.isInitialized || this.isMuted) return;

    const melody = [523.25, 659.25, 783.99, 1046.5]; // C, E, G, High C
    melody.forEach((f, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      const startTime = this.ctx.currentTime + idx * 0.12;
      const duration = idx === 3 ? 1.0 : 0.25;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, startTime);

      gain.gain.setValueAtTime(0.28, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.engineGain) {
      this.engineGain.gain.setValueAtTime(this.isMuted ? 0 : 0.10, this.ctx ? this.ctx.currentTime : 0);
    }
    if (this.skidGain) {
      this.skidGain.gain.setValueAtTime(0, this.ctx ? this.ctx.currentTime : 0);
    }
    if (this.windGain) {
      this.windGain.gain.setValueAtTime(0, this.ctx ? this.ctx.currentTime : 0);
    }
    if (this.nitroGain) {
      this.nitroGain.gain.setValueAtTime(0, this.ctx ? this.ctx.currentTime : 0);
    }
    return this.isMuted;
  }
}
