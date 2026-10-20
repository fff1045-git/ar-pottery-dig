import { distanceMeters, type LatLng } from '../core/geo';
import { isInKorea } from '../core/korea';
import { creatureById, type CreatureKind } from './creatures';
import { checkRange, DEFAULT_CAPTURE_CONFIG, type CaptureCheck, type CaptureConfig, type PlayerFix } from './rules';
import { DEFAULT_SPAWN_CONFIG, spawnsNear, type Spawn, type SpawnConfig } from './spawner';
import { emptySave, type SaveData, type SaveStore } from './storage';

export type CaptureResult = CaptureCheck & { kind?: CreatureKind };

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
    readonly spawnConfig: SpawnConfig = DEFAULT_SPAWN_CONFIG,
    readonly captureConfig: CaptureConfig = DEFAULT_CAPTURE_CONFIG,
    now = Date.now(),
  ) {
    this.data = store.load() ?? emptySave();
    if (this.pruneCaught(now)) store.save(this.data);
  }

  get player(): PlayerFix | null {
    return this._player;
  }

  get inventory(): Readonly<Record<string, number>> {
    return this.data.inventory;
  }

  get firstCaughtAt(): Readonly<Record<string, number>> {
    return this.data.firstCaughtAt;
  }

  get totalCaught(): number {
    return this.data.totalCaught;
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

  /** 플레이어 주변에서 아직 안 잡은, 만료 전 스폰. 대한민국 밖에는 스폰하지 않는다. */
  visibleSpawns(now: number): Spawn[] {
    if (!this._player || !isInKorea(this._player.pos)) return [];
    return spawnsNear(this._player.pos, now, this.spawnConfig).filter(
      (s) => s.expiresAt > now && !(s.id in this.data.caught) && isInKorea(s.pos),
    );
  }

  check(spawn: Spawn, now: number): CaptureCheck {
    if (spawn.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (spawn.id in this.data.caught) return { ok: false, reason: 'already-caught' };
    return checkRange(this._player, spawn.pos, this.captureConfig);
  }

  /** 스폰 ID로 획득 시도. 주변 스폰을 다시 계산해 확인하므로 위조된 스폰은 받지 않는다. */
  tryCapture(spawnId: string, now: number): CaptureResult {
    const spawn = this._player
      ? spawnsNear(this._player.pos, now, this.spawnConfig).find((s) => s.id === spawnId)
      : undefined;
    if (!spawn) return this._player ? { ok: false, reason: 'expired' } : { ok: false, reason: 'no-position' };

    const result = this.check(spawn, now);
    const kind = creatureById(spawn.kindId);
    if (!result.ok || !kind) return { ...result, kind };

    this.data.caught[spawn.id] = spawn.expiresAt;
    this.data.inventory[kind.id] = (this.data.inventory[kind.id] ?? 0) + 1;
    this.data.firstCaughtAt[kind.id] ??= now;
    this.data.totalCaught += 1;
    this.store.save(this.data);
    this.emit();
    return { ...result, kind };
  }

  /** 시간창이 바뀌었을 수 있으니 화면을 다시 그리게 한다. */
  tick(now: number): void {
    if (this.pruneCaught(now)) this.store.save(this.data);
    this.emit();
  }

  /** 도감·인벤토리를 지운다. 마지막 위치는 남긴다. */
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

  private pruneCaught(now: number): boolean {
    let changed = false;
    for (const [id, expiresAt] of Object.entries(this.data.caught)) {
      if (expiresAt <= now) {
        delete this.data.caught[id];
        changed = true;
      }
    }
    return changed;
  }
}
