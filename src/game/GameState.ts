import { distanceMeters, type LatLng } from '../core/geo';
import { isInKorea } from '../core/korea';
import { addShard, exchangeShard, type ExchangeResult, type ShardGain } from './collection';
import { DEFAULT_DETECTOR_CONFIG, type DetectorConfig } from './detector';
import type { Part } from './pottery';
import { checkRange, type CaptureCheck, type PlayerFix } from './rules';
import { DEFAULT_SITE_CONFIG, sitesNear, type DigSite, type SiteConfig } from './sites';
import { emptySave, type SaveData, type SaveStore } from './storage';

export type DigCheck = CaptureCheck;
export type DigResult = ({ ok: true; distanceM: number } & ShardGain) | Exclude<CaptureCheck, { ok: true }>;

/** 마지막 위치를 다시 저장하기 전에 이만큼은 움직여야 한다(m). 매 측정마다 쓰지 않기 위해. */
const LAST_KNOWN_MIN_MOVE_M = 25;

/**
 * 게임 상태. 지도·GPS·DOM을 모른다.
 * 위치는 setPlayer로 받고, 화면은 subscribe로 변화를 받아 다시 그린다.
 */
export class GameState {
  private data: SaveData;
  private _player: PlayerFix | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly store: SaveStore,
    readonly siteConfig: SiteConfig = DEFAULT_SITE_CONFIG,
    readonly detectorConfig: DetectorConfig = DEFAULT_DETECTOR_CONFIG,
    now = Date.now(),
  ) {
    this.data = store.load() ?? emptySave();
    if (this.pruneDug(now)) store.save(this.data);
  }

  get player(): PlayerFix | null {
    return this._player;
  }

  /** 저장 데이터(읽기 전용으로 쓸 것). 도감 화면이 그린다. */
  get save(): Readonly<SaveData> {
    return this.data;
  }

  /** 마지막으로 알던 위치(저장됨). 없으면 null. */
  get lastKnown(): LatLng | null {
    const p = this.data.lastKnown;
    return p ? { lat: p.lat, lng: p.lng } : null;
  }

  /** 플레이어가 플레이 영역(대한민국) 안에 있는지. 위치를 모르면 false. */
  get inPlayArea(): boolean {
    return !!this._player && isInKorea(this._player.pos);
  }

  setPlayer(fix: PlayerFix): void {
    this._player = fix;
    const last = this.data.lastKnown;
    if (!last || distanceMeters(last, fix.pos) >= LAST_KNOWN_MIN_MOVE_M) {
      this.data.lastKnown = { lat: fix.pos.lat, lng: fix.pos.lng, at: fix.timestamp };
      this.store.save(this.data);
    }
    this.emit();
  }

  /** 플레이어 주변에서 오늘 아직 안 판 지점. 대한민국 밖에는 없다. */
  visibleSites(now: number): DigSite[] {
    if (!this._player || !isInKorea(this._player.pos)) return [];
    return sitesNear(this._player.pos, now, this.siteConfig).filter(
      (s) => s.expiresAt > now && !(s.id in this.data.dug) && isInKorea(s.pos),
    );
  }

  /** 탐지기가 가리키는 가장 가까운 안 판 지점. */
  nearestSite(now: number): { site: DigSite; distanceM: number } | null {
    if (!this._player) return null;
    let best: { site: DigSite; distanceM: number } | null = null;
    for (const site of this.visibleSites(now)) {
      const d = distanceMeters(this._player.pos, site.pos);
      if (!best || d < best.distanceM) best = { site, distanceM: d };
    }
    return best;
  }

  check(site: DigSite, now: number): DigCheck {
    if (site.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (site.id in this.data.dug) return { ok: false, reason: 'already-caught' };
    return checkRange(this._player, site.pos, {
      radiusM: this.detectorConfig.digRadiusM,
      maxAccuracyM: this.detectorConfig.maxAccuracyM,
    });
  }

  /**
   * 발굴 확정. 오늘 지점을 다시 계산해 확인하므로 위조되거나 날짜가 바뀐 지점은 받지 않는다.
   * 성공하면 그 지점을 판 것으로 기록하고 조각을 넣는다.
   */
  dig(siteId: string, now: number): DigResult {
    if (!this._player) return { ok: false, reason: 'no-position' };
    const site = sitesNear(this._player.pos, now, this.siteConfig).find((s) => s.id === siteId);
    if (!site) return { ok: false, reason: 'expired' };
    const result = this.check(site, now);
    if (!result.ok) return result;

    this.data.dug[site.id] = site.expiresAt;
    this.data.totalDug += 1;
    const gain = addShard(this.data, site.vesselId, site.part, now);
    this.store.save(this.data);
    this.emit();
    return { ...result, ...gain };
  }

  exchange(vesselId: string, part: Part, now: number): ExchangeResult {
    const r = exchangeShard(this.data, vesselId, part, now);
    if (r.ok) {
      this.store.save(this.data);
      this.emit();
    }
    return r;
  }

  /** 날짜가 바뀌었을 수 있으니 화면을 다시 그리게 한다. */
  tick(now: number): void {
    if (this.pruneDug(now)) this.store.save(this.data);
    this.emit();
  }

  /** 도감·조각·흙을 지운다. 마지막 위치는 남긴다. */
  reset(): void {
    this.data = { ...emptySave(), lastKnown: this.data.lastKnown };
    this.store.save(this.data);
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private pruneDug(now: number): boolean {
    let changed = false;
    for (const [id, expiresAt] of Object.entries(this.data.dug)) {
      if (expiresAt <= now) {
        delete this.data.dug[id];
        changed = true;
      }
    }
    return changed;
  }
}
