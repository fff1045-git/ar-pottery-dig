import { seededRandom } from '../core/random';
import { Excavation, excavationConfig, type ClearedCell } from '../game/excavation';
import { CAMERA_FAILURE_TEXT, openBackCamera, stopStream } from './camera';
import { DigSound } from './digSound';
import { groundVisibility, requestTiltPermission, watchTilt } from './tilt';

/** 발굴을 마쳤을 때 main이 돌려주는 결과(GameState.dig 결과를 글로 바꾼 것). */
export type DigOutcome =
  | { ok: true; title: string; lines: string[]; image: string; badge?: string; restored?: boolean }
  | { ok: false; message: string };

export interface DigOptions {
  /** 흙 겹 수. */
  layers: number;
  /** 묻힌 파편 그림. */
  shardSrc: string;
  /** 그림을 못 불러오면 칠할 색. */
  fallbackColor: string;
  /** 같은 지점이면 같은 흙 무늬·파편 각도. */
  seed: string;
  /** 다 팠을 때. 여기서 GameState.dig를 부른다. */
  onComplete: () => DigOutcome;
  onShowDex: () => void;
  onClose: () => void;
}

/** 겹별 흙 색: 마른 흙 → 진흙 → 자갈 → 붉은 점토. */
const LAYER_STYLE = [
  { base: '#a07a52', speck: ['#b98f63', '#8a6642', '#c9a378'], pebbles: 0 },
  { base: '#6e4c31', speck: ['#5a3d27', '#7f5a3b', '#4a3120'], pebbles: 0 },
  { base: '#7b7268', speck: ['#958b80', '#5f574f', '#a39a8e'], pebbles: 40 },
  { base: '#8f4f33', speck: ['#a35e3e', '#743f29', '#b8714d'], pebbles: 0 },
];

const MAX_DPR = 2;
/** 흙더미 판의 최대 표시 폭(CSS px). styles.css의 .dig-patch width와 맞출 것. */
const PATCH_MAX_CSS_W = 520;

/**
 * AR 발굴 화면. 후면 카메라 영상(없으면 흙바닥 그림) 위에 흙더미 판을 띄우고,
 * 손가락으로 문지르면 겹마다 흙이 지워져 파편이 드러난다.
 */
export class DigScreen {
  private cleanup: (() => void)[] = [];
  private sound: DigSound | null = null;

  constructor(private readonly root: HTMLElement) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(opts: DigOptions): void {
    this.close();
    // iOS 기울기 권한은 탭 처리 중에 바로 물어야 한다(await 전에).
    const tiltPermission = requestTiltPermission();
    // 오디오도 탭 처리 중에 켜야 브라우저가 막지 않는다.
    const sound = new DigSound();
    this.sound = sound;
    this.cleanup.push(() => {
      sound.close();
      if (this.sound === sound) this.sound = null;
    });

    const root = this.root;
    root.innerHTML = `
      <video class="dig-cam" playsinline muted autoplay hidden></video>
      <div class="dig-ground"></div>
      <header class="dig-top">
        <button class="dig-exit" type="button">✕ 나가기</button>
        <span class="dig-title">흙 ${opts.layers}겹</span>
      </header>
      <p class="dig-notice" role="status" hidden></p>
      <p class="dig-tilt" hidden>📱 휴대폰을 아래로 기울여 땅을 비추세요</p>
      <div class="dig-stage">
        <div class="dig-patch"></div>
        <div class="dig-meter" aria-hidden="true"><i></i></div>
        <p class="dig-help">손가락으로 문질러 흙을 걷어내세요</p>
      </div>
      <div class="dig-result" hidden></div>`;
    root.hidden = false;
    document.body.classList.add('digging');

    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    q('.dig-exit').addEventListener('click', () => {
      this.close();
      opts.onClose();
    });

    this.startCamera(q<HTMLVideoElement>('.dig-cam'), q('.dig-ground'), q('.dig-notice'));
    this.startTilt(tiltPermission, q('.dig-stage'), q('.dig-tilt'));
    this.buildPatch(q('.dig-patch'), q('.dig-meter'), opts, (outcome) => this.showResult(q('.dig-result'), outcome, opts));
  }

  close(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    this.root.hidden = true;
    this.root.replaceChildren();
    document.body.classList.remove('digging');
  }

  // ── 배경: 카메라 또는 흙바닥 그림 ─────────────────────────
  private startCamera(video: HTMLVideoElement, ground: HTMLElement, notice: HTMLElement) {
    ground.style.backgroundImage = `url(${groundTexture()})`;
    let stream: MediaStream | null = null;
    let closed = false;
    this.cleanup.push(() => {
      closed = true;
      stopStream(stream);
    });
    void openBackCamera().then((r) => {
      if (closed) return stopStream(r.stream);
      if (!r.stream) {
        notice.textContent = CAMERA_FAILURE_TEXT[r.reason];
        notice.hidden = false;
        setTimeout(() => (notice.hidden = true), 4000);
        return;
      }
      stream = r.stream;
      video.srcObject = stream;
      video.hidden = false;
      ground.hidden = true;
      void video.play().catch(() => {});
    });
  }

  // ── 기울기: 아래를 볼수록 판이 올라온다 ────────────────────
  private startTilt(permission: Promise<boolean>, stage: HTMLElement, hint: HTMLElement) {
    let stop = () => {};
    let closed = false;
    this.cleanup.push(() => {
      closed = true;
      stop();
    });
    void permission.then((ok) => {
      if (closed || !ok) return; // 권한 없음·센서 없음 → 판을 처음부터 다 보여 준다
      stop = watchTilt((beta) => {
        const f = groundVisibility(beta);
        stage.style.setProperty('--rise', String(f));
        hint.hidden = f > 0.85;
      });
    });
  }

  // ── 흙더미 판 ───────────────────────────────────────────
  private buildPatch(
    patch: HTMLElement,
    meter: HTMLElement,
    opts: DigOptions,
    onDone: (o: DigOutcome) => void,
  ) {
    const cfg = excavationConfig(opts.layers);
    const { cols, rows } = cfg;
    // 파편 그림을 불러온 뒤 그 모양으로 파편 자리를 정한다. 그 전까지는 문질러도 반응하지 않는다.
    let ex: Excavation | null = null;
    // 화면 크기는 CSS가 정한다(.dig-patch). 여는 순간 창 너비가 0이면(백그라운드에서 열림 등)
    // 판이 0×0이 되던 문제가 있어서, 캔버스 해상도는 최대 표시 폭 기준으로 고정한다.
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const W = Math.round(PATCH_MAX_CSS_W * dpr);
    const H = Math.round((W * rows) / cols);
    patch.style.aspectRatio = `${cols} / ${rows}`;
    const cw = W / cols;
    const ch = H / rows;
    const rand = seededRandom(opts.seed);

    const mk = (cls: string) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      c.className = cls;
      patch.appendChild(c);
      return c.getContext('2d')!;
    };

    // 맨 아래: 구덩이 바닥 + 파편
    const base = mk('dig-base');
    drawPit(base, W, H);
    const angle = (rand() - 0.5) * 0.6;
    const shardCanvas = base.canvas;
    const img = new Image();
    img.onload = () => {
      drawShard(base, img, W, H, angle);
      ex = new Excavation(cfg, shardTarget(img, W, H, angle, cols, rows));
    };
    img.onerror = () => {
      drawShardFallback(base, opts.fallbackColor, W, H, angle, rand);
      ex = new Excavation(cfg);
    };
    img.src = opts.shardSrc;

    // 흙 겹: 깊은 겹부터 깔아서 0번(맨 위)이 가장 위에 오게
    const layers: CanvasRenderingContext2D[] = [];
    for (let k = opts.layers - 1; k >= 0; k--) {
      const ctx = mk(`dig-layer`);
      drawSoil(ctx, W, H, LAYER_STYLE[k % LAYER_STYLE.length], k, seededRandom(`${opts.seed}:${k}`));
      layers[k] = ctx;
    }

    /**
     * 다 깎인 칸 자리의 흙을 지운다. 칸마다 같은 원을 찍으면 격자 모양이 드러나서,
     * 칸별로 정해진(시드) 크기·위치·찌그러짐이 다른 흙덩이 두 개를 지워 가장자리를 울퉁불퉁하게 만든다.
     */
    const eraseCell = (c: ClearedCell) => {
      const ctx = layers[c.layer];
      const jitter = seededRandom(`${opts.seed}:${c.layer}:${c.col}:${c.row}`);
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 2; i++) {
        const x = (c.col + 0.5 + (jitter() - 0.5) * 0.9) * cw;
        const y = (c.row + 0.5 + (jitter() - 0.5) * 0.9) * ch;
        const r = cw * (0.9 + jitter() * 0.8);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(jitter() * Math.PI);
        ctx.scale(1, 0.6 + jitter() * 0.4);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.55, 'rgba(0,0,0,0.9)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    /** 아직 다 안 깎인 칸도 문지른 자국이 조금씩 옅어지게: 손맛용. */
    const scuff = (ex: Excavation, x0: number, y0: number, x1: number, y1: number) => {
      const layer = ex.topLayerAt(Math.floor(x1), Math.floor(y1));
      if (layer < 0 || layer >= opts.layers) return;
      const ctx = layers[layer];
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,0.07)';
      ctx.lineCap = 'round';
      ctx.lineWidth = ex.cfg.brushRadius * cw * 1.1;
      ctx.beginPath();
      ctx.moveTo(x0 * cw, y0 * ch);
      ctx.lineTo(x1 * cw, y1 * ch);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    };

    let finished = false;
    let last: { x: number; y: number } | null = null;
    const toGrid = (e: PointerEvent) => {
      const b = patch.getBoundingClientRect();
      return { x: ((e.clientX - b.left) / b.width) * cols, y: ((e.clientY - b.top) / b.height) * rows };
    };
    const rubTo = (p: { x: number; y: number }) => {
      if (!ex) return;
      const from = last ?? p;
      scuff(ex, from.x, from.y, p.x, p.y);
      const layerHere = ex.topLayerAt(Math.floor(p.x), Math.floor(p.y));
      const r = ex.rub(from.x, from.y, p.x, p.y);
      r.cleared.forEach(eraseCell);
      if (layerHere >= 0 && layerHere < opts.layers) this.sound?.scrape(layerHere, Math.hypot(p.x - from.x, p.y - from.y));
      if (r.brokeThrough.length) {
        navigator.vibrate?.(30);
        this.sound?.crack();
      }
      if (r.cleared.length) crumbs(patch, (p.x / cols) * 100, (p.y / rows) * 100, layerColor(r.cleared[0].layer));
      last = p;
      meter.style.setProperty('--p', String(ex.meter));
      if (r.completed) finish();
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      navigator.vibrate?.([60, 40, 120]);
      patch.classList.add('revealed');
      shardCanvas.classList.add('shine');
      setTimeout(() => onDone(opts.onComplete()), 900);
    };

    patch.addEventListener('pointerdown', (e) => {
      if (finished) return;
      patch.setPointerCapture(e.pointerId);
      last = null;
      rubTo(toGrid(e));
    });
    patch.addEventListener('pointermove', (e) => {
      if (finished || !patch.hasPointerCapture(e.pointerId)) return;
      for (const ev of e.getCoalescedEvents?.() ?? [e]) rubTo(toGrid(ev));
    });
    const end = () => (last = null);
    patch.addEventListener('pointerup', end);
    patch.addEventListener('pointercancel', end);
  }

  private showResult(el: HTMLElement, outcome: DigOutcome, opts: DigOptions) {
    el.hidden = false;
    el.replaceChildren();
    const card = document.createElement('div');
    card.className = `dig-card${outcome.ok ? (outcome.restored ? ' restored' : '') : ' fail'}`;
    if (outcome.ok && outcome.restored) navigator.vibrate?.([80, 60, 80, 60, 200]);
    if (outcome.ok) this.sound?.reveal(outcome.restored);
    if (outcome.ok) {
      const img = document.createElement('img');
      img.src = outcome.image;
      img.alt = '';
      const h = document.createElement('h3');
      h.textContent = outcome.title;
      card.append(img, h);
      if (outcome.badge) {
        const b = document.createElement('span');
        b.className = 'dig-badge';
        b.textContent = outcome.badge;
        card.append(b);
      }
      for (const line of outcome.lines) {
        const p = document.createElement('p');
        p.textContent = line;
        card.append(p);
      }
    } else {
      const p = document.createElement('p');
      p.textContent = outcome.message;
      card.append(p);
    }
    const row = document.createElement('div');
    row.className = 'dig-card-actions';
    const dex = document.createElement('button');
    dex.type = 'button';
    dex.textContent = '🏺 도감';
    dex.addEventListener('click', () => {
      this.close();
      opts.onClose();
      opts.onShowDex();
    });
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'primary';
    back.textContent = '🗺️ 지도로';
    back.addEventListener('click', () => {
      this.close();
      opts.onClose();
    });
    row.append(dex, back);
    card.append(row);
    el.append(card);
    back.focus();
  }
}

// ── 그리기 도우미 ─────────────────────────────────────────

function ellipsePath(ctx: CanvasRenderingContext2D, W: number, H: number, scale = 1) {
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2, (W / 2) * scale, (H / 2) * scale, 0, 0, Math.PI * 2);
}

function drawPit(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H / 2, W / 2);
  g.addColorStop(0, '#3e2a1b');
  g.addColorStop(0.75, '#2c1d12');
  g.addColorStop(1, '#1a110a');
  ellipsePath(ctx, W, H, 0.98);
  ctx.fillStyle = g;
  ctx.fill();
}

/** 파편을 판 가운데에 그리는 변환. 그림과 파편 자리 계산이 같이 쓴다. */
function placeShard(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, angle: number) {
  const s = Math.min((W * 0.6) / img.width, (H * 0.8) / img.height);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(angle);
  return s;
}

/** 파편 그림을 판 가운데에 살짝 돌려 그린다. */
function drawShard(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, angle: number) {
  ctx.save();
  const s = placeShard(ctx, img, W, H, angle);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = W * 0.02;
  ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
  ctx.restore();
}

/** 파편 그림이 덮는 칸 = 파편 자리. 너무 작으면(그림 이상) 기본 타원을 쓰게 undefined. */
function shardTarget(img: HTMLImageElement, W: number, H: number, angle: number, cols: number, rows: number) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.save();
  const s = placeShard(ctx, img, W, H, angle);
  ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
  ctx.restore();
  const data = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(cols * rows);
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.floor(((col + 0.5) / cols) * W);
      const y = Math.floor(((r + 0.5) / rows) * H);
      if (data[(y * W + x) * 4 + 3] > 100) {
        mask[r * cols + col] = 1;
        count++;
      }
    }
  }
  if (count < 12) return undefined;
  return (col: number, r: number) => mask[r * cols + col] === 1;
}

function drawShardFallback(ctx: CanvasRenderingContext2D, color: string, W: number, H: number, angle: number, rand: () => number) {
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(angle);
  ctx.beginPath();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.75 + rand() * 0.25;
    ctx.lineTo(Math.cos(a) * W * 0.22 * r, Math.sin(a) * H * 0.33 * r);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawSoil(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  style: (typeof LAYER_STYLE)[number],
  depth: number,
  rand: () => number,
) {
  ellipsePath(ctx, W, H, 0.98 - depth * 0.015);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = style.base;
  ctx.fillRect(0, 0, W, H);
  // 흙 알갱이
  const n = Math.round((W * H) / 90);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = style.speck[Math.floor(rand() * style.speck.length)];
    ctx.globalAlpha = 0.35 + rand() * 0.5;
    const s = 1 + rand() * 2.5;
    ctx.fillRect(rand() * W, rand() * H, s, s);
  }
  // 자갈
  for (let i = 0; i < style.pebbles; i++) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = style.speck[Math.floor(rand() * style.speck.length)];
    ctx.beginPath();
    ctx.ellipse(rand() * W, rand() * H, 3 + rand() * 7, 2 + rand() * 5, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 맨 위 겹은 봉긋한 흙더미처럼 가운데를 밝게
  if (depth === 0) {
    const g = ctx.createRadialGradient(W * 0.45, H * 0.35, 0, W / 2, H / 2, W * 0.55);
    g.addColorStop(0, 'rgba(255,240,210,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

function layerColor(layer: number): string {
  return LAYER_STYLE[layer % LAYER_STYLE.length].speck[0];
}

/** 문지른 자리에서 흙 부스러기가 튄다. */
function crumbs(patch: HTMLElement, xPct: number, yPct: number, color: string) {
  for (let i = 0; i < 3; i++) {
    const d = document.createElement('i');
    d.className = 'crumb';
    d.style.left = `${xPct}%`;
    d.style.top = `${yPct}%`;
    d.style.background = color;
    d.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}px`);
    d.style.setProperty('--dy', `${-20 - Math.random() * 40}px`);
    patch.appendChild(d);
    d.addEventListener('animationend', () => d.remove());
  }
}

let groundUrl: string | null = null;

/** 카메라가 없을 때 쓰는 흙바닥 그림(한 번 만들어 재사용). */
function groundTexture(): string {
  if (groundUrl) return groundUrl;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#5d4630';
  ctx.fillRect(0, 0, 256, 256);
  const rand = seededRandom('ground');
  const colors = ['#6d5338', '#4d3a27', '#7a6146', '#3f6b35', '#557d3f'];
  for (let i = 0; i < 2600; i++) {
    const grass = i % 9 === 0;
    ctx.fillStyle = colors[grass ? 3 + (i % 2) : Math.floor(rand() * 3)];
    ctx.globalAlpha = 0.4 + rand() * 0.5;
    if (grass) ctx.fillRect(rand() * 256, rand() * 256, 1.5, 4 + rand() * 5);
    else ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 3, 1 + rand() * 3);
  }
  groundUrl = c.toDataURL();
  return groundUrl;
}
