import type { LatLng } from '../core/geo';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface MarkerSpec {
  id: string;
  pos: LatLng;
  /** 마커 모양. 같은 html이면 다시 그리지 않는다. */
  html: string;
  zIndex?: number;
  onClick?: () => void;
}

export interface PlaceResult {
  name: string;
  address: string;
  pos: LatLng;
}

export interface CircleSpec {
  id: string;
  center: LatLng;
  radiusM: number;
  color: string;
  fillOpacity?: number;
}

/**
 * 지도 제공사 어댑터. 게임·앱 코드는 이 인터페이스만 쓴다.
 * zoom은 웹 메르카토르 줌 레벨(0~20, 클수록 확대)로 통일하고, 각 어댑터가 자기 단위로 바꾼다.
 */
export interface MapProvider {
  readonly name: string;
  /** 지도를 그린다. SDK 로드 실패·키 오류면 reject. */
  mount(el: HTMLElement, center: LatLng, zoom: number): Promise<void>;
  setCenter(pos: LatLng, animate?: boolean): void;
  getCenter(): LatLng;
  setZoom(zoom: number): void;
  /** 있으면 갱신, 없으면 추가. */
  setMarker(spec: MarkerSpec): void;
  removeMarker(id: string): void;
  setCircle(spec: CircleSpec): void;
  removeCircle(id: string): void;
  onClick(cb: (pos: LatLng) => void): void;
  /** 사용자가 지도를 직접 끌기 시작할 때. 따라가기 모드 해제용. */
  onUserPan(cb: () => void): void;
  latLngToScreen(pos: LatLng): ScreenPoint;
  screenToLatLng(p: ScreenPoint): LatLng;
  /** 거리 사진(로드뷰 등)을 지원하면 구현. 근처에 사진이 없으면 false. */
  showStreetView?(pos: LatLng, el: HTMLElement): Promise<boolean>;
  /** 장소·주소 검색을 지원하면 구현. 결과가 없으면 빈 배열. */
  searchPlaces?(query: string): Promise<PlaceResult[]>;
  destroy(): void;
}

/** 마커 DOM: 0×0 기준점 + 가운데 정렬된 내용. 두 어댑터가 같이 쓴다. */
export function createMarkerElement(spec: MarkerSpec): HTMLElement {
  const anchor = document.createElement('div');
  anchor.className = 'mk-anchor';
  const body = document.createElement('div');
  body.className = 'mk-body';
  body.innerHTML = spec.html;
  anchor.appendChild(body);
  return anchor;
}

export function updateMarkerElement(el: HTMLElement, spec: MarkerSpec, prevHtml: string): void {
  if (spec.html !== prevHtml) (el.firstElementChild as HTMLElement).innerHTML = spec.html;
}
