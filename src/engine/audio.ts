import { MobType, SoundMaterial } from '../types/game';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this.noiseBuffer && this.ctx) {
      const len = this.ctx.sampleRate * 1.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buf;
    }
    return this.ctx;
  }

  unlock() {
    this.ensureContext();
  }

  private playNoiseBurst(freq: number, q: number, duration: number, gainPeak: number, filterType: BiquadFilterType = 'bandpass') {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer) return;

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, now);
    filter.Q.setValueAtTime(q, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    src.start(now, Math.random() * 0.5, duration);
  }

  private playTone(
    startFreq: number,
    endFreq: number,
    duration: number,
    gainPeak: number,
    type: OscillatorType = 'triangle',
  ) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playFootstep(mat: SoundMaterial) {
    switch (mat) {
      case 'stone':
        this.playNoiseBurst(950 + Math.random() * 250, 2.2, 0.07, 0.08);
        this.playTone(130, 80, 0.05, 0.05, 'sine');
        break;
      case 'wood':
        this.playTone(220 + Math.random() * 40, 120, 0.06, 0.07, 'triangle');
        this.playNoiseBurst(500, 1.5, 0.05, 0.04);
        break;
      case 'sand':
        this.playNoiseBurst(2100 + Math.random() * 400, 0.8, 0.09, 0.07, 'highpass');
        break;
      case 'snow':
        this.playNoiseBurst(1600 + Math.random() * 300, 1.0, 0.08, 0.06);
        break;
      case 'water':
        this.playNoiseBurst(800 + Math.random() * 300, 1.2, 0.14, 0.09);
        break;
      case 'glass':
        this.playTone(1600, 1100, 0.06, 0.05, 'sine');
        break;
      default: // grass
        this.playNoiseBurst(1200 + Math.random() * 300, 1.1, 0.07, 0.06);
        break;
    }
  }

  playBlockBreak(mat: SoundMaterial) {
    switch (mat) {
      case 'stone':
        this.playTone(150, 65, 0.12, 0.14, 'square');
        this.playNoiseBurst(750, 1.4, 0.14, 0.16);
        break;
      case 'wood':
        this.playTone(210, 95, 0.11, 0.14, 'triangle');
        this.playNoiseBurst(460, 1.8, 0.12, 0.12);
        break;
      case 'glass':
        this.playTone(2200, 900, 0.14, 0.14, 'sine');
        this.playTone(3100, 1400, 0.12, 0.1, 'triangle');
        this.playNoiseBurst(3200, 1.0, 0.15, 0.12, 'highpass');
        break;
      case 'sand':
        this.playNoiseBurst(1900, 0.9, 0.16, 0.14, 'highpass');
        break;
      default:
        this.playNoiseBurst(900, 1.0, 0.14, 0.14);
        this.playTone(120, 60, 0.09, 0.09, 'sine');
        break;
    }
  }

  playBlockPlace(mat: SoundMaterial) {
    switch (mat) {
      case 'stone':
        this.playTone(180, 105, 0.08, 0.12, 'triangle');
        this.playNoiseBurst(1050, 2.0, 0.06, 0.09);
        break;
      case 'wood':
        this.playTone(260, 150, 0.08, 0.12, 'triangle');
        break;
      case 'glass':
        this.playTone(1400, 1050, 0.08, 0.09, 'sine');
        break;
      default:
        this.playNoiseBurst(780, 1.2, 0.08, 0.1);
        this.playTone(140, 90, 0.07, 0.08, 'sine');
        break;
    }
  }

  playMineTick(mat: SoundMaterial) {
    if (mat === 'stone') this.playNoiseBurst(1100, 3.0, 0.04, 0.05);
    else if (mat === 'wood') this.playTone(240, 170, 0.04, 0.05, 'triangle');
    else this.playNoiseBurst(950, 1.5, 0.04, 0.04);
  }

  playSwing() {
    this.playNoiseBurst(600, 0.9, 0.09, 0.06);
  }

  playHit(critical = false) {
    this.playTone(critical ? 240 : 160, 55, 0.12, critical ? 0.18 : 0.13, 'sawtooth');
    this.playNoiseBurst(600, 1.0, 0.09, 0.12);
    if (critical) {
      this.playTone(580, 920, 0.1, 0.08, 'sine');
    }
  }

  playPlayerHurt() {
    this.playTone(185, 75, 0.18, 0.18, 'sawtooth');
    this.playNoiseBurst(420, 1.2, 0.12, 0.12);
  }

  playBowShoot() {
    this.playTone(420, 140, 0.14, 0.12, 'triangle');
    this.playNoiseBurst(1500, 1.5, 0.08, 0.07);
  }

  playPickup() {
    this.playTone(580, 880, 0.07, 0.08, 'sine');
  }

  playEat() {
    this.playNoiseBurst(1400, 1.6, 0.08, 0.1);
    this.playTone(210, 140, 0.06, 0.06, 'triangle');
  }

  playCreeperHiss() {
    this.playNoiseBurst(3400, 0.7, 0.85, 0.16, 'highpass');
  }

  playExplosion() {
    this.playTone(95, 24, 0.55, 0.3, 'sawtooth');
    this.playNoiseBurst(260, 0.6, 0.65, 0.32, 'lowpass');
  }

  playMobCall(type: MobType) {
    switch (type) {
      case 'pig':
        this.playTone(230, 165, 0.14, 0.08, 'sawtooth');
        break;
      case 'cow':
        this.playTone(115, 85, 0.36, 0.09, 'sawtooth');
        break;
      case 'sheep':
        this.playTone(340, 290, 0.25, 0.07, 'triangle');
        break;
      case 'chicken':
        this.playTone(680, 520, 0.09, 0.07, 'square');
        break;
      case 'zombie':
        this.playTone(125, 72, 0.42, 0.1, 'sawtooth');
        break;
      case 'skeleton':
        this.playNoiseBurst(1800, 4.0, 0.07, 0.08);
        break;
      case 'spider':
        this.playNoiseBurst(2600, 3.5, 0.11, 0.08);
        break;
      default:
        break;
    }
  }

  playCaveAmbience() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.playTone(62, 48, 2.2, 0.06, 'sine');
    this.playTone(186, 174, 1.8, 0.03, 'triangle');
  }
}

export const soundEngine = new SoundEngine();
