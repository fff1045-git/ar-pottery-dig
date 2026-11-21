import { readSoundPref } from '../app/detectorUi';

/** 겹별 긁는 소리 밝기(Hz): 마른 흙 → 진흙(둔탁) → 자갈(밝음) → 점토. */
const SCRAPE_FREQ = [1400, 900, 2600, 1100];
/** 긁는 소리를 이보다 자주 내지 않는다(ms). 문지르는 동안 계속 겹치지 않게. */
const SCRAPE_EVERY_MS = 70;

/**
 * 발굴 화면 효과음. 소리 파일 없이 Web Audio로 만든다.
 * 발굴하기 버튼(사용자 탭)으로 열리므로 그때 오디오를 켤 수 있다. 🔇이면 아무것도 내지 않는다.
 */
export class DigSound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lastScrape = 0;
  private readonly on = readSoundPref();

  constructor() {
    if (!this.on) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      void this.ctx.resume().catch(() => {});
      // 0.3초짜리 흰 소음 하나를 만들어 두고 매번 잘라 쓴다.
      const len = Math.floor(this.ctx.sampleRate * 0.3);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  /** 문지르는 중. speed는 이번 움직임 길이(칸), layer는 지금 깎는 겹. */
  scrape(layer: number, speed: number) {
    const ctx = this.ready();
    if (!ctx || !this.noise || speed <= 0) return;
    const now = performance.now();
    if (now - this.lastScrape < SCRAPE_EVERY_MS) return;
    this.lastScrape = now;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = SCRAPE_FREQ[layer % SCRAPE_FREQ.length];
    filter.Q.value = 0.9;
    const gain = ctx.createGain();
    const vol = Math.min(0.22, 0.05 + speed * 0.04);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t, Math.random() * 0.15, 0.1);
  }

  /** 겹이 처음 뚫렸을 때: 낮은 '툭'. */
  crack() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  /** 파편이 드러났을 때: 도자기 부딪는 듯한 맑은 소리 세 번. 복원이면 한 음 더 높게 길게. */
  reveal(restored = false) {
    const ctx = this.ready();
    if (!ctx) return;
    const notes = restored ? [784, 988, 1175, 1568] : [880, 1109, 1319];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (restored && i === notes.length - 1 ? 1.2 : 0.5));
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1.3);
    });
  }

  close() {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private ready(): AudioContext | null {
    return this.ctx && this.ctx.state !== 'closed' ? this.ctx : null;
  }
}
