/**
 * Web Audio API Sound Effects Engine
 * Pure synthesized sound effects for soccer slingshot physics and events.
 * Zero external audio files required, zero latency, guaranteed playback.
 */

class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private lastStretchTime: number = 0;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Slingshot rubber band pull / tension stretch sound
   */
  public playStretch(tensionRatio: number = 0.5) {
    if (this.isMuted) return;
    const now = performance.now();
    if (now - this.lastStretchTime < 90) return; // Throttle continuous pull events
    this.lastStretchTime = now;

    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      const baseFreq = 120 + tensionRatio * 180;
      osc.frequency.setValueAtTime(baseFreq, t);
      osc.frequency.linearRampToValueAtTime(baseFreq + 40, t + 0.08);

      gain.gain.setValueAtTime(0.015 * Math.min(tensionRatio * 1.5, 1), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.08);
    } catch (e) {}
  }

  /**
   * Powerful soccer ball strike / slingshot launch whoosh & kick
   */
  public playKick(powerRatio: number = 1.0) {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;

      // 1. Low Thump / Sub Kick
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      const startFreq = 160 + powerRatio * 50;
      osc.frequency.setValueAtTime(startFreq, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.16);

      gain.gain.setValueAtTime(0.35 * Math.min(powerRatio, 1.2), t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);

      // 2. Air Whoosh / Snap
      const bufferSize = ctx.sampleRate * 0.1;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.03));
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(650, t);
      filter.frequency.linearRampToValueAtTime(220, t + 0.1);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.18 * powerRatio, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      whiteNoise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(ctx.destination);

      whiteNoise.start(t);
    } catch (e) {}
  }

  /**
   * Collision and Ricochet sound on defenders, goalkeeper, energy bumpers, or side walls
   */
  public playBounce(type: 'defender' | 'keeper' | 'bumper' | 'wall' = 'defender') {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;

      if (type === 'bumper') {
        // High-energy futuristic resonant boing
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, t);
        osc.frequency.exponentialRampToValueAtTime(780, t + 0.08);
        osc.frequency.exponentialRampToValueAtTime(440, t + 0.22);

        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.24);
      } else if (type === 'keeper') {
        // Padded glove slap + low thud
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);

        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.12);
      } else if (type === 'wall') {
        // Wall rebound ping
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(240, t);
        osc.frequency.exponentialRampToValueAtTime(90, t + 0.09);

        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.09);
      } else {
        // Defender body tackle / block
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.exponentialRampToValueAtTime(60, t + 0.14);

        gain.gain.setValueAtTime(0.32, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.14);
      }
    } catch (e) {}
  }

  /**
   * Glorious soccer GOAL celebration fanfare + referee whistle!
   */
  public playGoal(streak: number = 1) {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;

      // 1. Referee Goal Whistle (Double chirp: Trill at ~2800Hz)
      const whistleOsc1 = ctx.createOscillator();
      const whistleOsc2 = ctx.createOscillator();
      const whistleGain = ctx.createGain();

      whistleOsc1.type = 'triangle';
      whistleOsc2.type = 'sine';

      whistleOsc1.frequency.setValueAtTime(2800, t);
      whistleOsc2.frequency.setValueAtTime(2880, t); // Slight detune for authentic whistle beating

      // Rapid trill
      whistleGain.gain.setValueAtTime(0.0, t);
      whistleGain.gain.linearRampToValueAtTime(0.15, t + 0.02);
      whistleGain.gain.setValueAtTime(0.15, t + 0.12);
      whistleGain.gain.linearRampToValueAtTime(0.0, t + 0.14);
      whistleGain.gain.linearRampToValueAtTime(0.2, t + 0.16);
      whistleGain.gain.setValueAtTime(0.2, t + 0.35);
      whistleGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

      whistleOsc1.connect(whistleGain);
      whistleOsc2.connect(whistleGain);
      whistleGain.connect(ctx.destination);

      whistleOsc1.start(t);
      whistleOsc2.start(t);
      whistleOsc1.stop(t + 0.45);
      whistleOsc2.stop(t + 0.45);

      // 2. Triumphant Major Chime Arpeggio (C5 -> E5 -> G5 -> C6)
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, index) => {
        const noteTime = t + 0.1 + index * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = index === 3 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0, noteTime);
        gain.gain.linearRampToValueAtTime(0.22, noteTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + (index === 3 ? 0.7 : 0.4));

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(noteTime);
        osc.stop(noteTime + (index === 3 ? 0.75 : 0.45));
      });

      // 3. Crowd Cheer Wash (Filtered colored noise burst)
      const cheerDuration = 1.2;
      const bufferSize = Math.floor(ctx.sampleRate * cheerDuration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1);
      }

      const cheerSource = ctx.createBufferSource();
      cheerSource.buffer = buffer;

      const cheerFilter = ctx.createBiquadFilter();
      cheerFilter.type = 'bandpass';
      cheerFilter.frequency.setValueAtTime(900, t);
      cheerFilter.Q.setValueAtTime(1.2, t);

      const cheerGain = ctx.createGain();
      cheerGain.gain.setValueAtTime(0, t + 0.1);
      cheerGain.gain.linearRampToValueAtTime(0.12, t + 0.3);
      cheerGain.gain.exponentialRampToValueAtTime(0.001, t + cheerDuration);

      cheerSource.connect(cheerFilter);
      cheerFilter.connect(cheerGain);
      cheerGain.connect(ctx.destination);

      cheerSource.start(t + 0.1);
    } catch (e) {}
  }

  /**
   * UI Click / Technique Selection Tone
   */
  public playClick(pitch: number = 440) {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, t);
      osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, t + 0.04);

      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.05);
    } catch (e) {}
  }

  /**
   * Toggle Sound for Gemini Strategy / Audio
   */
  public playToggle(enabled: boolean) {
    if (this.isMuted && !enabled) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      if (enabled) {
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.08);
      } else {
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.exponentialRampToValueAtTime(330, t + 0.08);
      }

      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.09);
    } catch (e) {}
  }
}

export const soundFx = new SoundEngine();
