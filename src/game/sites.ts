import { offsetMeters, type LatLng } from '../core/geo';
import { seededRandom } from '../core/random';
import { cellsAround, pointInCell, type Cell } from './grid';
import { LAYERS_BY_RARITY, pickPart, pickVessel, type Part } from './pottery';

export interface SiteConfig {
  /** 격자 한 칸의 한 변(m). */
  cellSizeM: number;
  /** 한 칸에 최대 몇 곳. 0..max 중 균등. */
  maxPerCell: number;
  /** 지도에 보이는 탐색 원의 반경(m). */
  searchRadiusM: number;
  /** 탐색 원 중심이 실제 지점에서 떨어질 수 있는 최대 거리(m). searchRadiusM보다 작아야 지점이 원 안에 든다. */
  maxHintOffsetM: number;
  /** 월드 시드. 바꾸면 전체 배치가 바뀐다. */
  seed: string;
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  cellSizeM: 150,
  maxPerCell: 2,
  searchRadiusM: 60,
  maxHintOffsetM: 35,
  seed: 'pottery-dig-v1',
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** 한국 표준시(UTC+9). 자정에 배치가 바뀐다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface DigSite {
  /** 셀·날짜·순번으로 만든 고유 ID. "오늘 판 지점" 기록에 쓴다. */
  id: string;
  /** 실제 파편이 묻힌 곳. 화면에 그대로 보여 주지 않는다. */
  pos: LatLng;
  /** 지도에 그리는 탐색 원의 중심. */
  hintCenter: LatLng;
  vesselId: string;
  part: Part;
  /** 흙 겹 수. */
  layers: number;
  /** 이 지점이 사라지는 시각(ms epoch) = 다음 한국 자정. */
  expiresAt: number;
}

/** 한국 날짜 기준 일련번호. */
export function dayIndex(now: number): number {
  return Math.floor((now + KST_OFFSET_MS) / DAY_MS);
}

export function dayEndsAt(day: number): number {
  return (day + 1) * DAY_MS - KST_OFFSET_MS;
}

export function sitesInCell(cell: Cell, day: number, cfg: SiteConfig = DEFAULT_SITE_CONFIG): DigSite[] {
  const rand = seededRandom(`${cfg.seed}:${cell.row}:${cell.col}:${day}`);
  const count = Math.floor(rand() * (cfg.maxPerCell + 1));
  const expiresAt = dayEndsAt(day);
  const out: DigSite[] = [];
  for (let i = 0; i < count; i++) {
    const pos = pointInCell(cell, rand(), rand(), cfg.cellSizeM);
    const vessel = pickVessel(rand());
    const part = pickPart(rand());
    const angle = rand() * 2 * Math.PI;
    const off = rand() * cfg.maxHintOffsetM;
    out.push({
      id: `${cell.row}:${cell.col}:${day}:${i}`,
      pos,
      hintCenter: offsetMeters(pos, off * Math.cos(angle), off * Math.sin(angle)),
      vesselId: vessel.id,
      part,
      layers: LAYERS_BY_RARITY[vessel.rarity],
      expiresAt,
    });
  }
  return out;
}

/** p 주변 (2r+1)² 셀의 오늘 지점. */
export function sitesNear(p: LatLng, now: number, cfg: SiteConfig = DEFAULT_SITE_CONFIG, ring = 1): DigSite[] {
  const day = dayIndex(now);
  return cellsAround(p, cfg.cellSizeM, ring).flatMap((c) => sitesInCell(c, day, cfg));
}
