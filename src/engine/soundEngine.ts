const SOUND_STORAGE_KEY = 'lucky_jet_sound_enabled';
const MASTER_GAIN_LEVEL = 0.3; // Soft ceiling within 0.25 - 0.35

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean;

  private flightOsc: OscillatorNode | null = null;
  private flightHarmonicOsc: OscillatorNode | null = null;
  private flightAirNode: AudioBufferSourceNode | null = null;
  private flightAirFilter: BiquadFilterNode | null = null;
  private flightGain: GainNode | null = null;

  constructor() {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(SOUND_STORAGE_KEY) : null;
    this.enabled = saved === null ? true : saved === 'true';
  }

  private ensureContext(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(MASTER_GAIN_LEVEL, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(MASTER_GAIN_LEVEL, this.ctx.currentTime, 0.02);
    }
    return this.masterGain ? { ctx: this.ctx, out: this.masterGain } : null;
  }

  public unlock(): void {
    this.ensureContext();
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(value: boolean): void {
    this.enabled = value;
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, String(value));
    } catch {
      // ignore storage errors
    }
    if (!value) {
      this.stopFlightHum();
      if (this.masterGain && this.ctx) {
        try {
          const now = this.ctx.currentTime;
          this.masterGain.gain.cancelScheduledValues(now);
          this.masterGain.gain.setTargetAtTime(0.0001, now, 0.01);
        } catch {
          // ignore
        }
      }
    } else if (this.masterGain && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(MASTER_GAIN_LEVEL, now, 0.02);
      } catch {
        // ignore
      }
    }
  }

  public toggle(): boolean {
    this.setEnabled(!this.enabled);
    if (this.enabled) {
      this.playClick();
    }
    return this.enabled;
  }

  public playClick(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.055);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.085);
  }

  public playCountdownTick(finalTick = false): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(finalTick ? 520 : 360, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(finalTick ? 0.14 : 0.08, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  public playTakeoff(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    // Soft warm sine swell (120Hz -> 185Hz) through lowpass filter
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(185, now + 0.34);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(340, now);
    filter.frequency.exponentialRampToValueAtTime(560, now + 0.34);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.45);

    this.startFlightHum();
  }

  private startFlightHum(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, out } = audio;
    this.stopFlightHum();

    const now = ctx.currentTime;
    const flightGain = ctx.createGain();
    flightGain.gain.setValueAtTime(0.0001, now);
    flightGain.gain.linearRampToValueAtTime(0.16, now + 0.35);
    flightGain.connect(out);

    // Primary warm sine (120Hz -> 240Hz during flight)
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);

    // Subtle soft triangle sub-layer
    const harmonic = ctx.createOscillator();
    const harmonicGain = ctx.createGain();
    harmonic.type = 'triangle';
    harmonic.frequency.setValueAtTime(120, now);
    harmonicGain.gain.setValueAtTime(0.28, now);

    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'lowpass';
    toneFilter.frequency.setValueAtTime(360, now);

    osc.connect(toneFilter);
    harmonic.connect(harmonicGain);
    harmonicGain.connect(toneFilter);
    toneFilter.connect(flightGain);

    // Very soft lowpass-filtered air flow (looping brown-ish noise buffer)
    const airLen = Math.floor(ctx.sampleRate * 1.5);
    const airBuffer = ctx.createBuffer(1, airLen, ctx.sampleRate);
    const airData = airBuffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < airLen; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.03 * white) / 1.03;
      airData[i] = lastOut * 2.2;
    }

    const airSource = ctx.createBufferSource();
    airSource.buffer = airBuffer;
    airSource.loop = true;

    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.frequency.setValueAtTime(280, now);

    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.22, now);

    airSource.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(flightGain);

    osc.start(now);
    harmonic.start(now);
    airSource.start(now);

    this.flightOsc = osc;
    this.flightHarmonicOsc = harmonic;
    this.flightAirNode = airSource;
    this.flightAirFilter = airFilter;
    this.flightGain = flightGain;
  }

  public updateFlightPitch(multiplier: number): void {
    if (!this.flightOsc || !this.ctx || !this.enabled) return;
    const clamped = Math.max(1, Math.min(multiplier, 30));
    // Smooth low-frequency range: 120Hz -> 240Hz
    const progress = Math.min(1, Math.log(clamped) / Math.log(30));
    const freq = 120 + progress * 120;
    const now = this.ctx.currentTime;

    this.flightOsc.frequency.setTargetAtTime(freq, now, 0.12);
    if (this.flightHarmonicOsc) {
      this.flightHarmonicOsc.frequency.setTargetAtTime(freq * 0.5, now, 0.12);
    }
    if (this.flightAirFilter) {
      this.flightAirFilter.frequency.setTargetAtTime(280 + progress * 220, now, 0.12);
    }
  }

  public stopFlightHum(): void {
    const osc = this.flightOsc;
    const harm = this.flightHarmonicOsc;
    const air = this.flightAirNode;
    const gain = this.flightGain;

    this.flightOsc = null;
    this.flightHarmonicOsc = null;
    this.flightAirNode = null;
    this.flightAirFilter = null;
    this.flightGain = null;

    if (gain && this.ctx) {
      try {
        const now = this.ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0.0001, now, 0.025);
      } catch {
        // ignore
      }
    }

    setTimeout(() => {
      for (const node of [osc, harm, air]) {
        if (!node) continue;
        try {
          node.stop();
          node.disconnect();
        } catch {
          // ignore
        }
      }
      if (gain) {
        try {
          gain.disconnect();
        } catch {
          // ignore
        }
      }
    }, 80);
  }

  public playCashout(): void {
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    // Gentle warm ascending chord (C5, E5, G5)
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const start = now + i * 0.06;
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  public playCrash(): void {
    this.stopFlightHum();
    const audio = this.ensureContext();
    if (!audio) return;
    const { ctx, out } = audio;
    const now = ctx.currentTime;

    // Soft, rounded low-frequency fade-down (140Hz -> 45Hz), zero harsh buzz or crackle
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.36);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(240, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + 0.36);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.28, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.45);
  }
}

export const soundEngine = new SoundEngine();
