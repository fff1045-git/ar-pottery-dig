import { beepIntervalMs, MAX_SIGNAL } from '../game/detector';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const SOUND_KEY = 'ar-pottery-dig/sound';

/**
 * 지도 아래 금속탐지기 패널: 신호 막대 5칸, 상태 문구, 삐 소리·진동, 발굴 버튼.
 * 신호 단계는 main이 정해 준다.
 */
export class DetectorPanel {
  private level = 0;
  private audio: AudioContext | null = null;
  private soundOn = readSoundPref();
  private beepTimer: ReturnType<typeof setTimeout> | undefined;
  /** 진동은 휴대폰 실제 GPS 모드에서만(PC 시뮬레이터에서는 의미 없음). */
  vibrate = false;
  /** 발굴 화면이 열려 있는 동안은 소리를 멈춘다. */
  paused = false;

  constructor() {
    const btn = $('#sound-btn');
    this.renderSound();
    btn.addEventListener('click', () => {
      this.soundOn = !this.soundOn;
      writeSoundPref(this.soundOn);
      this.renderSound();
      this.unlockAudio();
    });
    // 브라우저는 사용자 입력 전에는 소리를 막는다. 첫 탭에서 오디오를 연다.
    const unlock = () => this.unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  /** 신호 단계와 문구. level이 바뀌면 삐 간격도 바뀐다. */
  set(level: number, text: string) {
    const bars = $('#detector-bars').children;
    for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i < level);
    $('#detector').dataset.level = String(level);
    $('#detector-text').textContent = text;
    if (level !== this.level) {
      this.level = level;
      this.schedule(true);
    }
  }

  /** 발굴 버튼. fn이 null이면 숨긴다. */
  setDig(fn: (() => void) | null) {
    const btn = $<HTMLButtonElement>('#dig-btn');
    btn.hidden = !fn;
    btn.onclick = fn;
  }

  private renderSound() {
    const btn = $('#sound-btn');
    btn.textContent = this.soundOn ? '🔊' : '🔇';
    btn.setAttribute('aria-pressed', String(this.soundOn));
  }

  private unlockAudio() {
    if (!this.audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.audio = new Ctor();
    }
    void this.audio.resume().catch(() => {});
  }

  private schedule(restart = false) {
    if (restart) clearTimeout(this.beepTimer);
    const ms = beepIntervalMs(this.level);
    if (!ms) return;
    this.beepTimer = setTimeout(() => {
      this.beep();
      this.schedule();
    }, restart ? 120 : ms);
  }

  private beep() {
    if (this.paused || document.hidden) return;
    if (this.vibrate && this.level >= 2) navigator.vibrate?.(this.level >= MAX_SIGNAL ? 60 : 25);
    if (!this.soundOn || !this.audio || this.audio.state !== 'running') return;
    const t = this.audio.currentTime;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 520 + this.level * 140;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(this.audio.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }
}

function readSoundPref(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeSoundPref(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    /* 무시 */
  }
}
