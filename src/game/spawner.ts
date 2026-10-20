import { METERS_PER_DEG_LAT, type LatLng } from '../core/geo';
import { seededRandom } from '../core/random';
import { pickCreature } from './creatures';

export interface SpawnConfig {
  /** 격자 한 칸의 한 변(m). */
  cellSizeM: number;
  /** 스폰이 바뀌는 주기(ms). 같은 창 안에서는 같은 자리에 같은 생물. */
  windowMs: number;
  /** 한 칸에 최대 몇 마리. 0..max 중 균등. */
  maxPerCell: number;
  /** 월드 시드. 바꾸면 전체 배치가 바뀐다. */
  seed: string;
}

export const DEFAULT_SPAWN_CONFIG: SpawnConfig = {
  cellSizeM: 80,
  windowMs: 15 * 60 * 1000,
  maxPerCell: 3,
  seed: 'oakvalley-v1',
};

export interface Spawn {
  /** 셀·시간창·순번으로 만든 고유 ID. 저장 시 "이미 잡음" 표시에 쓴다. */
  id: string;
  kindId: string;
  pos: LatLng;
  /** 이 스폰이 사라지는 시각(ms epoch). */
  expiresAt: number;
}

export interface Cell {
  row: number;
  col: number;
}

function cellDegLat(cfg: SpawnConfig): number {
  return cfg.cellSizeM / METERS_PER_DEG_LAT;
}

/** 행(위도 띠)마다 경도 폭을 그 띠 중앙 위도로 정한다 → 셀이 대략 정사각형이고, 결정적. */
function cellDegLng(row: number, cfg: SpawnConfig): number {
  const midLat = (row + 0.5) * cellDegLat(cfg);
  return cellDegLat(cfg) / Math.cos((midLat * Math.PI) / 180);
}

export function cellOf(p: LatLng, cfg: SpawnConfig): Cell {
  const row = Math.floor(p.lat / cellDegLat(cfg));
  const col = Math.floor(p.lng / cellDegLng(row, cfg));
  return { row, col };
}

export function windowIndex(now: number, cfg: SpawnConfig): number {
  return Math.floor(now / cfg.windowMs);
}

export function spawnsInCell(cell: Cell, window: number, cfg: SpawnConfig): Spawn[] {
  const rand = seededRandom(`${cfg.seed}:${cell.row}:${cell.col}:${window}`);
  const count = Math.floor(rand() * (cfg.maxPerCell + 1));
  const dLat = cellDegLat(cfg);
  const dLng = cellDegLng(cell.row, cfg);
  const expiresAt = (window + 1) * cfg.windowMs;
  const out: Spawn[] = [];
  for (let i = 0; i < count; i++) {
    const pos = {
      lat: (cell.row + rand()) * dLat,
      lng: (cell.col + rand()) * dLng,
    };
    const kind = pickCreature(rand());
    out.push({ id: `${cell.row}:${cell.col}:${window}:${i}`, kindId: kind.id, pos, expiresAt });
  }
  return out;
}

/** 플레이어가 있는 셀과 그 주변 (2r+1)² 셀의 스폰. */
export function spawnsNear(p: LatLng, now: number, cfg: SpawnConfig, ringCells = 1): Spawn[] {
  const center = cellOf(p, cfg);
  const w = windowIndex(now, cfg);
  const out: Spawn[] = [];
  for (let dr = -ringCells; dr <= ringCells; dr++) {
    const row = center.row + dr;
    // 행마다 경도 폭이 다르므로, 이 행에서 플레이어 경도에 해당하는 열을 다시 구한다.
    const colCenter = Math.floor(p.lng / cellDegLng(row, cfg));
    for (let dc = -ringCells; dc <= ringCells; dc++) {
      out.push(...spawnsInCell({ row, col: colCenter + dc }, w, cfg));
    }
  }
  return out;
}
