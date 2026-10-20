import type { LatLng } from '../core/geo';
import {
  createMarkerElement,
  updateMarkerElement,
  type CircleSpec,
  type MapProvider,
  type MarkerSpec,
  type PlaceResult,
  type ScreenPoint,
} from './MapProvider';

export type KakaoMapType = 'hybrid' | 'skyview';

const SDK_TIMEOUT_MS = 10_000;

let sdkPromise: Promise<void> | null = null;

/** SDK 스크립트를 한 번만 불러온다. 키·도메인이 틀리면 스크립트 오류나 시간 초과로 reject. */
function loadSdk(appKey: string): Promise<void> {
  if (window.kakao?.maps?.Map) return Promise.resolve();
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('카카오 SDK 응답 없음 (키 또는 등록 도메인을 확인하세요)')),
      SDK_TIMEOUT_MS,
    );
    const s = document.createElement('script');
    // services: 장소·주소 검색(Places, Geocoder)
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('카카오 SDK 스크립트를 불러오지 못했습니다 (키·등록 도메인·네트워크 확인)'));
    };
    s.onload = () => {
      if (!window.kakao?.maps) {
        clearTimeout(timer);
        reject(new Error('카카오 SDK가 초기화되지 않았습니다 (JavaScript 키와 등록 도메인 확인)'));
        return;
      }
      window.kakao.maps.load(() => {
        clearTimeout(timer);
        resolve();
      });
    };
    document.head.appendChild(s);
  }).catch((e) => {
    sdkPromise = null; // 다음 시도에서 다시 불러올 수 있게
    throw e;
  });
  return sdkPromise;
}

/** 웹 메르카토르 줌 → 카카오 레벨(1이 가장 확대). 대략 level = 20 - zoom. */
export function zoomToKakaoLevel(zoom: number): number {
  return Math.min(14, Math.max(1, Math.round(20 - zoom)));
}

interface MarkerEntry {
  overlay: kakao.maps.CustomOverlay;
  el: HTMLElement;
  spec: MarkerSpec;
}

export class KakaoProvider implements MapProvider {
  readonly name = 'kakao';
  private map!: kakao.maps.Map;
  private markers = new Map<string, MarkerEntry>();
  private circles = new Map<string, kakao.maps.Circle>();

  constructor(
    private readonly appKey: string,
    private readonly mapType: KakaoMapType = 'hybrid',
  ) {}

  async mount(el: HTMLElement, center: LatLng, zoom: number): Promise<void> {
    await loadSdk(this.appKey);
    const k = window.kakao!.maps;
    this.map = new k.Map(el, { center: this.ll(center), level: zoomToKakaoLevel(zoom) });
    this.map.setMapTypeId(this.mapType === 'skyview' ? k.MapTypeId.SKYVIEW : k.MapTypeId.HYBRID);
  }

  setCenter(pos: LatLng, animate = false): void {
    if (animate) this.map.panTo(this.ll(pos));
    else this.map.setCenter(this.ll(pos));
  }

  getCenter(): LatLng {
    const c = this.map.getCenter();
    return { lat: c.getLat(), lng: c.getLng() };
  }

  setZoom(zoom: number): void {
    this.map.setLevel(zoomToKakaoLevel(zoom));
  }

  setMarker(spec: MarkerSpec): void {
    const entry = this.markers.get(spec.id);
    if (entry) {
      updateMarkerElement(entry.el, spec, entry.spec.html);
      if (entry.spec.pos.lat !== spec.pos.lat || entry.spec.pos.lng !== spec.pos.lng) {
        entry.overlay.setPosition(this.ll(spec.pos));
      }
      if (spec.zIndex !== entry.spec.zIndex) entry.overlay.setZIndex(spec.zIndex ?? 0);
      entry.spec = spec;
      return;
    }
    const el = createMarkerElement(spec);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.markers.get(spec.id)?.spec.onClick?.();
    });
    const overlay = new window.kakao!.maps.CustomOverlay({
      position: this.ll(spec.pos),
      content: el,
      xAnchor: 0,
      yAnchor: 0,
      zIndex: spec.zIndex ?? 0,
      clickable: true,
      map: this.map,
    });
    this.markers.set(spec.id, { overlay, el, spec });
  }

  removeMarker(id: string): void {
    this.markers.get(id)?.overlay.setMap(null);
    this.markers.delete(id);
  }

  setCircle(spec: CircleSpec): void {
    const c = this.circles.get(spec.id);
    if (c) {
      c.setPosition(this.ll(spec.center));
      c.setRadius(spec.radiusM);
      return;
    }
    this.circles.set(
      spec.id,
      new window.kakao!.maps.Circle({
        center: this.ll(spec.center),
        radius: spec.radiusM,
        strokeWeight: 2,
        strokeColor: spec.color,
        strokeOpacity: 0.9,
        fillColor: spec.color,
        fillOpacity: spec.fillOpacity ?? 0.12,
        map: this.map,
      }),
    );
  }

  removeCircle(id: string): void {
    this.circles.get(id)?.setMap(null);
    this.circles.delete(id);
  }

  onClick(cb: (pos: LatLng) => void): void {
    window.kakao!.maps.event.addListener(this.map, 'click', (e) =>
      cb({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }),
    );
  }

  onUserPan(cb: () => void): void {
    window.kakao!.maps.event.addListener(this.map, 'dragstart', () => cb());
  }

  latLngToScreen(pos: LatLng): ScreenPoint {
    const p = this.map.getProjection().containerPointFromCoords(this.ll(pos));
    return { x: p.x, y: p.y };
  }

  screenToLatLng(p: ScreenPoint): LatLng {
    const c = this.map.getProjection().coordsFromContainerPoint(new window.kakao!.maps.Point(p.x, p.y));
    return { lat: c.getLat(), lng: c.getLng() };
  }

  /** 반경 50m 안에서 가장 가까운 로드뷰를 연다. */
  showStreetView(pos: LatLng, el: HTMLElement): Promise<boolean> {
    const k = window.kakao!.maps;
    return new Promise((resolve) => {
      new k.RoadviewClient().getNearestPanoId(this.ll(pos), 50, (panoId) => {
        if (panoId === null) return resolve(false);
        new k.Roadview(el).setPanoId(panoId, this.ll(pos));
        resolve(true);
      });
    });
  }

  /** 장소 이름으로 먼저 찾고, 없으면 주소로 찾는다. */
  async searchPlaces(query: string): Promise<PlaceResult[]> {
    const services = window.kakao!.maps.services;
    const ok = services.Status.OK;
    const places = await new Promise<PlaceResult[]>((resolve) =>
      new services.Places().keywordSearch(query, (rows, status) =>
        resolve(
          status === ok
            ? rows.map((r) => ({
                name: r.place_name,
                address: r.road_address_name || r.address_name,
                pos: { lat: Number(r.y), lng: Number(r.x) },
              }))
            : [],
        ),
      ),
    );
    if (places.length) return places;
    return new Promise((resolve) =>
      new services.Geocoder().addressSearch(query, (rows, status) =>
        resolve(
          status === ok
            ? rows.map((r) => ({ name: r.address_name, address: r.address_name, pos: { lat: Number(r.y), lng: Number(r.x) } }))
            : [],
        ),
      ),
    );
  }

  destroy(): void {
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
    for (const id of [...this.circles.keys()]) this.removeCircle(id);
  }

  private ll(p: LatLng) {
    return new window.kakao!.maps.LatLng(p.lat, p.lng);
  }
}
