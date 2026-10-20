import {
  DUST_FOR_DUPLICATE,
  EXCHANGE_COST,
  PARTS,
  RESTORE_BONUS,
  shardId,
  vesselById,
  type Part,
  type Vessel,
} from './pottery';
import type { SaveData } from './storage';

/** 조각을 얻은 결과. */
export interface ShardGain {
  vessel: Vessel;
  part: Part;
  /** 처음 얻은 조각인지. */
  isNew: boolean;
  /** 이번에 받은 고운 흙(중복 + 복원 보너스). */
  dust: number;
  /** 이 조각으로 도자기가 처음 완성됐으면 true. */
  restored: boolean;
}

export type ExchangeResult =
  | ({ ok: true } & ShardGain)
  | { ok: false; reason: 'unknown' | 'owned' | 'not-enough-dust'; cost?: number };

export function hasShard(data: SaveData, vesselId: string, part: Part): boolean {
  return (data.shards[shardId(vesselId, part)] ?? 0) > 0;
}

export function ownedParts(data: SaveData, vesselId: string): Part[] {
  return PARTS.filter((p) => hasShard(data, vesselId, p));
}

export function isRestored(data: SaveData, vesselId: string): boolean {
  return vesselId in data.restoredAt;
}

/** 4조각이 다 모였는데 아직 복원 기록이 없으면 복원하고 보너스를 준다. 준 흙을 돌려준다. */
function restoreIfComplete(data: SaveData, vessel: Vessel, now: number): number {
  if (isRestored(data, vessel.id) || ownedParts(data, vessel.id).length < PARTS.length) return 0;
  data.restoredAt[vessel.id] = now;
  data.dust += RESTORE_BONUS[vessel.rarity];
  return RESTORE_BONUS[vessel.rarity];
}

/** 발굴한 조각을 넣는다. data를 직접 바꾼다. */
export function addShard(data: SaveData, vesselId: string, part: Part, now: number): ShardGain {
  const vessel = vesselById(vesselId);
  if (!vessel) throw new Error(`모르는 도자기: ${vesselId}`);
  const id = shardId(vesselId, part);
  const isNew = !hasShard(data, vesselId, part);
  data.shards[id] = (data.shards[id] ?? 0) + 1;
  let dust = 0;
  if (!isNew) {
    dust += DUST_FOR_DUPLICATE[vessel.rarity];
    data.dust += DUST_FOR_DUPLICATE[vessel.rarity];
  }
  const bonus = isNew ? restoreIfComplete(data, vessel, now) : 0;
  return { vessel, part, isNew, dust: dust + bonus, restored: bonus > 0 };
}

/** 모자란 조각을 고운 흙으로 교환한다. data를 직접 바꾼다. */
export function exchangeShard(data: SaveData, vesselId: string, part: Part, now: number): ExchangeResult {
  const vessel = vesselById(vesselId);
  if (!vessel) return { ok: false, reason: 'unknown' };
  if (hasShard(data, vesselId, part)) return { ok: false, reason: 'owned' };
  const cost = EXCHANGE_COST[vessel.rarity];
  if (data.dust < cost) return { ok: false, reason: 'not-enough-dust', cost };
  data.dust -= cost;
  data.shards[shardId(vesselId, part)] = 1;
  const bonus = restoreIfComplete(data, vessel, now);
  return { ok: true, vessel, part, isNew: true, dust: bonus, restored: bonus > 0 };
}
