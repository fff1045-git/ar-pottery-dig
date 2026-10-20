import { distanceMeters, type LatLng } from '../core/geo';

/** 게임이 받는 플레이어 위치. GPS든 시뮬레이터든 같은 모양. */
export interface PlayerFix {
  pos: LatLng;
  /** 위치 오차 반경(m, 68%). */
  accuracy: number;
  timestamp: number;
}

export interface CaptureConfig {
  /** 이 거리 안이면 획득 가능(m). */
  radiusM: number;
  /** 정확도가 이보다 나쁘면 획득을 막는다(m). */
  maxAccuracyM: number;
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  radiusM: 40,
  maxAccuracyM: 100,
};

export type CaptureCheck =
  | { ok: true; distanceM: number }
  | { ok: false; reason: 'no-position' }
  | { ok: false; reason: 'poor-accuracy'; accuracyM: number }
  | { ok: false; reason: 'too-far'; distanceM: number; remainingM: number }
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'already-caught' };

export function checkRange(
  player: PlayerFix | null,
  target: LatLng,
  cfg: CaptureConfig,
): CaptureCheck {
  if (!player) return { ok: false, reason: 'no-position' };
  if (player.accuracy > cfg.maxAccuracyM) {
    return { ok: false, reason: 'poor-accuracy', accuracyM: player.accuracy };
  }
  const d = distanceMeters(player.pos, target);
  if (d > cfg.radiusM) {
    return { ok: false, reason: 'too-far', distanceM: d, remainingM: d - cfg.radiusM };
  }
  return { ok: true, distanceM: d };
}
