/**
 * 발굴 판의 흙. 화면을 모르는 순수 로직이다.
 * 판은 cols×rows 칸이고, 칸마다 흙이 layers겹 쌓여 있다(0이 맨 위).
 * 문지르면 각 칸에서 맨 위에 남은 겹의 단단함이 깎이고, 0이 되면 그 아래 겹이 드러난다.
 * 파편 자리 칸이 revealAt 비율 이상 바닥까지 드러나면 발굴 완료.
 * 파편 자리는 기본으로 판 가운데 타원이고, 파편 그림 모양을 알면 그것으로 준다.
 */
export interface ExcavationConfig {
  cols: number;
  rows: number;
  layers: number;
  /** 겹별 단단함. 길이는 layers 이상. 깊을수록 크다. */
  hardness: readonly number[];
  /** 붓 반경(칸). 중심에서 멀수록 덜 깎인다. */
  brushRadius: number;
  /** 문지른 거리 1칸당 붓 중심에서 깎는 양. */
  strength: number;
  /** 파편 자리 타원의 반지름(판 크기 대비 비율). */
  targetRx: number;
  targetRy: number;
  /** 파편 자리가 이 비율 이상 드러나면 완료. */
  revealAt: number;
}

export const DEFAULT_HARDNESS = [1, 1.7, 2.5, 3.4] as const;

export function excavationConfig(layers: number): ExcavationConfig {
  return {
    cols: 48,
    rows: 32,
    layers,
    hardness: DEFAULT_HARDNESS,
    brushRadius: 2.6,
    strength: 0.7,
    targetRx: 0.24,
    targetRy: 0.36,
    revealAt: 0.7,
  };
}

/** 칸 하나의 한 겹이 다 깎여 아래가 드러났다. */
export interface ClearedCell {
  col: number;
  row: number;
  /** 깎여 없어진 겹. */
  layer: number;
}

export interface RubResult {
  cleared: ClearedCell[];
  /** 이번 문지르기로 처음 뚫린 겹들(어느 칸에서든 처음). 진동 연출용. */
  brokeThrough: number[];
  /** 이번 문지르기로 완료 조건을 처음 넘었으면 true. */
  completed: boolean;
}

export class Excavation {
  /** 칸별 맨 위에 남은 겹 번호. layers면 바닥까지 드러남. */
  private readonly top: Uint8Array;
  /** 칸별 맨 위 겹의 남은 단단함. */
  private readonly hp: Float32Array;
  private readonly isTarget: Uint8Array;
  private readonly targetCount: number;
  private targetCleared = 0;
  private readonly broken = new Set<number>();
  private done = false;

  /**
   * @param target 칸이 파편 자리인지. 없으면 가운데 타원(targetRx·targetRy).
   */
  constructor(
    readonly cfg: ExcavationConfig,
    target?: (col: number, row: number) => boolean,
  ) {
    const n = cfg.cols * cfg.rows;
    this.top = new Uint8Array(n);
    this.hp = new Float32Array(n).fill(cfg.hardness[0]);
    this.isTarget = new Uint8Array(n);
    const inEllipse = (c: number, r: number) => {
      const dx = (c + 0.5) / cfg.cols - 0.5;
      const dy = (r + 0.5) / cfg.rows - 0.5;
      return (dx / cfg.targetRx) ** 2 + (dy / cfg.targetRy) ** 2 <= 1;
    };
    const isTarget = target ?? inEllipse;
    let count = 0;
    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < cfg.cols; c++) {
        if (isTarget(c, r)) {
          this.isTarget[r * cfg.cols + c] = 1;
          count++;
        }
      }
    }
    this.targetCount = count;
  }

  /** 파편 자리 중 바닥까지 드러난 비율 0..1. */
  get progress(): number {
    return this.targetCount ? this.targetCleared / this.targetCount : 1;
  }

  get completed(): boolean {
    return this.done;
  }

  /** 칸의 맨 위 남은 겹. 판 밖이면 -1. */
  topLayerAt(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.cfg.cols || row >= this.cfg.rows) return -1;
    return this.top[row * this.cfg.cols + col];
  }

  isTargetCell(col: number, row: number): boolean {
    return this.isTarget[row * this.cfg.cols + col] === 1;
  }

  /** (x0,y0)→(x1,y1) 선을 따라 문지른다. 좌표 단위는 칸. 제자리 탭도 조금 깎는다. */
  rub(x0: number, y0: number, x1: number, y1: number): RubResult {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(len / 0.5));
    const perStep = (Math.max(len, 0.5) / steps) * this.cfg.strength;
    const cleared: ClearedCell[] = [];
    const brokeThrough: number[] = [];
    const wasDone = this.done;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.dab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, perStep, cleared, brokeThrough);
    }
    if (!this.done && this.progress >= this.cfg.revealAt) this.done = true;
    return { cleared, brokeThrough, completed: this.done && !wasDone };
  }

  private dab(x: number, y: number, amount: number, cleared: ClearedCell[], broke: number[]) {
    const { cols, rows, layers, hardness, brushRadius: R } = this.cfg;
    const c0 = Math.max(0, Math.floor(x - R));
    const c1 = Math.min(cols - 1, Math.ceil(x + R));
    const r0 = Math.max(0, Math.floor(y - R));
    const r1 = Math.min(rows - 1, Math.ceil(y + R));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot(c + 0.5 - x, r + 0.5 - y);
        if (d > R) continue;
        const i = r * cols + c;
        const layer = this.top[i];
        if (layer >= layers) continue;
        this.hp[i] -= amount * (1 - d / R);
        if (this.hp[i] > 0) continue;
        cleared.push({ col: c, row: r, layer });
        if (!this.broken.has(layer)) {
          this.broken.add(layer);
          broke.push(layer);
        }
        const next = layer + 1;
        this.top[i] = next;
        // 남은 힘은 아래 겹으로 넘기지 않는다: 겹마다 한 번씩 더 문질러야 하는 손맛.
        this.hp[i] = next < layers ? hardness[next] : 0;
        if (next >= layers && this.isTarget[i]) this.targetCleared++;
      }
    }
  }
}
