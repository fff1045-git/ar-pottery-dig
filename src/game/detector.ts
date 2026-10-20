export interface DetectorConfig {
  /** 이 거리 밖이면 신호 없음(m). 탐색 원 반경 + 최대 오프셋보다 커야 원 가장자리에서도 잡힌다. */
  rangeM: number;
  /** 이 거리 안이면 발굴할 수 있다(m). */
  digRadiusM: number;
  /** GPS 정확도가 이보다 나쁘면 발굴을 막는다(m). */
  maxAccuracyM: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  rangeM: 100,
  digRadiusM: 20,
  maxAccuracyM: 50,
};

export const MAX_SIGNAL = 5;

/**
 * 거리 → 신호 단계 0..5.
 * 0: 범위 밖, 5: 발굴 가능 거리 안. 그 사이는 거리를 4등분해 가까울수록 크다.
 */
export function signalLevel(distanceM: number, cfg: DetectorConfig = DEFAULT_DETECTOR_CONFIG): number {
  if (!Number.isFinite(distanceM) || distanceM > cfg.rangeM) return 0;
  if (distanceM <= cfg.digRadiusM) return MAX_SIGNAL;
  const t = (distanceM - cfg.digRadiusM) / (cfg.rangeM - cfg.digRadiusM); // 0..1
  return Math.max(1, Math.min(MAX_SIGNAL - 1, MAX_SIGNAL - 1 - Math.floor(t * (MAX_SIGNAL - 1))));
}

/** 삐 소리 간격(ms). 신호가 강할수록 빠르다. 0이면 소리 없음. */
export function beepIntervalMs(level: number): number {
  return level <= 0 ? 0 : [0, 1600, 1100, 700, 420, 220][Math.min(level, MAX_SIGNAL)];
}
