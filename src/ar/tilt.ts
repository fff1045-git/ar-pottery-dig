/**
 * 휴대폰 앞뒤 기울기(DeviceOrientationEvent.beta, 도).
 * 90이면 똑바로 세운 상태(앞을 봄), 0이면 바닥에 눕힌 상태(카메라가 땅을 봄).
 */
type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * iOS는 사용자 탭 안에서 권한을 물어야 한다. 그래서 이 함수는 await 없이 곧바로 불러야 한다.
 * 권한 요청이 없는 기기(안드로이드·PC)면 바로 true.
 */
export function requestTiltPermission(): Promise<boolean> {
  const Ctor = (globalThis as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
  if (!Ctor) return Promise.resolve(false);
  if (typeof Ctor.requestPermission !== 'function') return Promise.resolve(true);
  return Ctor.requestPermission().then((r) => r === 'granted', () => false);
}

/**
 * beta를 구독한다. 센서가 없거나(PC) 값이 null이면 cb(null)을 한 번 부른다.
 * 돌려주는 함수로 구독을 끊는다.
 */
export function watchTilt(cb: (beta: number | null) => void, timeoutMs = 1200): () => void {
  let got = false;
  const onEvent = (e: DeviceOrientationEvent) => {
    if (e.beta == null) return;
    got = true;
    cb(e.beta);
  };
  window.addEventListener('deviceorientation', onEvent);
  const timer = setTimeout(() => {
    if (!got) cb(null);
  }, timeoutMs);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('deviceorientation', onEvent);
  };
}

/** 기울기 → 발굴 판이 보이는 정도 0..1. 55° 이하로 숙이면 다 보이고, 85° 이상 세우면 안 보인다. */
export function groundVisibility(beta: number | null): number {
  if (beta == null) return 1;
  const full = 55;
  const none = 85;
  return Math.max(0, Math.min(1, (none - beta) / (none - full)));
}
