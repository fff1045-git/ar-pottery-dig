export type CameraFailure = 'insecure' | 'unsupported' | 'denied' | 'no-camera' | 'error';
export type CameraResult = { stream: MediaStream } | { stream: null; reason: CameraFailure };

/** 후면 카메라를 연다. 실패해도 throw하지 않고 이유를 돌려준다(발굴은 대체 배경으로 계속). */
export async function openBackCamera(): Promise<CameraResult> {
  if (!window.isSecureContext) return { stream: null, reason: 'insecure' };
  if (!navigator.mediaDevices?.getUserMedia) return { stream: null, reason: 'unsupported' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    return { stream };
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return { stream: null, reason: 'denied' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return { stream: null, reason: 'no-camera' };
    return { stream: null, reason: 'error' };
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export const CAMERA_FAILURE_TEXT: Record<CameraFailure, string> = {
  insecure: '카메라는 https 주소에서만 켜져요. 흙바닥 그림으로 할게요.',
  unsupported: '이 브라우저는 카메라를 지원하지 않아요. 흙바닥 그림으로 할게요.',
  denied: '카메라 권한이 없어 흙바닥 그림으로 할게요.',
  'no-camera': '카메라를 찾지 못해 흙바닥 그림으로 할게요.',
  error: '카메라를 켜지 못해 흙바닥 그림으로 할게요.',
};
