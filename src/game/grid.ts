import { METERS_PER_DEG_LAT, type LatLng } from '../core/geo';

/** 지도를 대략 정사각형 셀로 나눈 격자의 한 칸. */
export interface Cell {
  row: number;
  col: number;
}

export function cellDegLat(cellSizeM: number): number {
  return cellSizeM / METERS_PER_DEG_LAT;
}

/** 행(위도 띠)마다 경도 폭을 그 띠 중앙 위도로 정한다 → 셀이 대략 정사각형이고, 결정적. */
export function cellDegLng(row: number, cellSizeM: number): number {
  const midLat = (row + 0.5) * cellDegLat(cellSizeM);
  return cellDegLat(cellSizeM) / Math.cos((midLat * Math.PI) / 180);
}

export function cellOf(p: LatLng, cellSizeM: number): Cell {
  const row = Math.floor(p.lat / cellDegLat(cellSizeM));
  const col = Math.floor(p.lng / cellDegLng(row, cellSizeM));
  return { row, col };
}

/** 셀 안의 상대 위치(u, v ∈ [0,1))를 좌표로. */
export function pointInCell(cell: Cell, u: number, v: number, cellSizeM: number): LatLng {
  return {
    lat: (cell.row + u) * cellDegLat(cellSizeM),
    lng: (cell.col + v) * cellDegLng(cell.row, cellSizeM),
  };
}

/** p가 있는 셀과 그 주변 (2r+1)² 셀. */
export function cellsAround(p: LatLng, cellSizeM: number, ring = 1): Cell[] {
  const center = cellOf(p, cellSizeM);
  const out: Cell[] = [];
  for (let dr = -ring; dr <= ring; dr++) {
    const row = center.row + dr;
    // 행마다 경도 폭이 다르므로, 이 행에서 p의 경도에 해당하는 열을 다시 구한다.
    const colCenter = Math.floor(p.lng / cellDegLng(row, cellSizeM));
    for (let dc = -ring; dc <= ring; dc++) out.push({ row, col: colCenter + dc });
  }
  return out;
}
