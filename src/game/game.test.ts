import { describe, expect, it } from 'vitest';
import { distanceMeters, offsetMeters } from '../core/geo';
import { CREATURES, pickCreature } from './creatures';
import { GameState } from './GameState';
import { checkRange, DEFAULT_CAPTURE_CONFIG } from './rules';
import { cellOf, DEFAULT_SPAWN_CONFIG, spawnsInCell, spawnsNear, windowIndex } from './spawner';
import { LocalStorageStore, MemoryStore } from './storage';

const HERE = { lat: 37.5663, lng: 126.9779 }; // 서울시청
const T0 = Date.UTC(2026, 9, 18, 3, 0, 0);
const cfg = DEFAULT_SPAWN_CONFIG;

function fixAt(pos = HERE, accuracy = 5) {
  return { pos, accuracy, timestamp: T0 };
}

describe('pickCreature', () => {
  it('경계값에서 첫/마지막 항목', () => {
    expect(pickCreature(0).id).toBe(CREATURES[0].id);
    expect(pickCreature(0.999999).id).toBe(CREATURES[CREATURES.length - 1].id);
  });
});

describe('spawner', () => {
  it('같은 셀·시간창이면 항상 같은 스폰 (결정적)', () => {
    const cell = cellOf(HERE, cfg);
    const w = windowIndex(T0, cfg);
    expect(spawnsInCell(cell, w, cfg)).toEqual(spawnsInCell(cell, w, cfg));
  });

  it('시간창이 바뀌면 배치가 바뀐다', () => {
    const a = spawnsNear(HERE, T0, cfg).map((s) => s.id + s.kindId);
    const b = spawnsNear(HERE, T0 + cfg.windowMs, cfg).map((s) => s.id + s.kindId);
    expect(a).not.toEqual(b);
  });

  it('스폰은 자기 셀 안에 있다', () => {
    for (const s of spawnsNear(HERE, T0, cfg, 3)) {
      const [row, col] = s.id.split(':').map(Number);
      expect(cellOf(s.pos, cfg)).toEqual({ row, col });
    }
  });

  it('셀 크기는 대략 cellSizeM', () => {
    const cell = cellOf(HERE, cfg);
    const a = spawnsInCell(cell, 0, { ...cfg, maxPerCell: 0 });
    expect(a).toEqual([]);
    // 셀 안 두 꼭짓점 사이 거리는 대각선(≈ 113m)을 넘지 않는다
    const ss = spawnsNear(HERE, T0, { ...cfg, maxPerCell: 20 }, 0);
    for (const s of ss) for (const t of ss) {
      expect(distanceMeters(s.pos, t.pos)).toBeLessThanOrEqual(cfg.cellSizeM * Math.SQRT2 + 0.5);
    }
  });

  it('주변 3x3 셀에 평균 maxPerCell/2 마리 정도', () => {
    let total = 0;
    for (let i = 0; i < 50; i++) total += spawnsNear(HERE, T0 + i * cfg.windowMs, cfg).length;
    const avg = total / 50;
    expect(avg).toBeGreaterThan(9);
    expect(avg).toBeLessThan(18);
  });
});

describe('checkRange', () => {
  it('반경 안이면 ok', () => {
    expect(checkRange(fixAt(), offsetMeters(HERE, 30, 0), DEFAULT_CAPTURE_CONFIG).ok).toBe(true);
  });

  it('반경 밖이면 남은 거리를 알려 준다', () => {
    const r = checkRange(fixAt(), offsetMeters(HERE, 100, 0), DEFAULT_CAPTURE_CONFIG);
    expect(r).toMatchObject({ ok: false, reason: 'too-far' });
    if (r.ok === false && r.reason === 'too-far') expect(r.remainingM).toBeCloseTo(60, 0);
  });

  it('정확도가 나쁘면 막는다', () => {
    const r = checkRange(fixAt(HERE, 250), HERE, DEFAULT_CAPTURE_CONFIG);
    expect(r).toMatchObject({ ok: false, reason: 'poor-accuracy' });
  });

  it('위치가 없으면 막는다', () => {
    expect(checkRange(null, HERE, DEFAULT_CAPTURE_CONFIG)).toMatchObject({ reason: 'no-position' });
  });
});

describe('GameState', () => {
  function stateNextToSpawn() {
    const store = new MemoryStore();
    const g = new GameState(store, cfg, DEFAULT_CAPTURE_CONFIG, T0);
    g.setPlayer(fixAt());
    const target = g.visibleSpawns(T0)[0];
    expect(target).toBeDefined();
    g.setPlayer(fixAt(offsetMeters(target.pos, 10, 0)));
    return { g, store, target };
  }

  it('가까이 가면 획득되고 인벤토리에 들어간다', () => {
    const { g, target } = stateNextToSpawn();
    const r = g.tryCapture(target.id, T0);
    expect(r.ok).toBe(true);
    expect(g.inventory[target.kindId]).toBe(1);
    expect(g.totalCaught).toBe(1);
    expect(g.visibleSpawns(T0).some((s) => s.id === target.id)).toBe(false);
  });

  it('같은 스폰은 두 번 못 잡는다', () => {
    const { g, target } = stateNextToSpawn();
    g.tryCapture(target.id, T0);
    expect(g.tryCapture(target.id, T0)).toMatchObject({ ok: false, reason: 'already-caught' });
  });

  it('멀리서는 못 잡는다', () => {
    const { g, target } = stateNextToSpawn();
    g.setPlayer(fixAt(offsetMeters(target.pos, 70, 0)));
    expect(g.tryCapture(target.id, T0)).toMatchObject({ ok: false, reason: 'too-far' });
    expect(g.totalCaught).toBe(0);
  });

  it('없는 스폰 ID는 거부', () => {
    const { g } = stateNextToSpawn();
    expect(g.tryCapture('1:2:3:4', T0).ok).toBe(false);
  });

  it('저장 후 다시 불러오면 진행도가 유지된다', () => {
    const { g, store, target } = stateNextToSpawn();
    g.tryCapture(target.id, T0);
    const g2 = new GameState(store, cfg, DEFAULT_CAPTURE_CONFIG, T0);
    expect(g2.totalCaught).toBe(1);
    expect(g2.inventory[target.kindId]).toBe(1);
  });

  it('만료된 포획 기록은 불러올 때 정리된다', () => {
    const { g, store, target } = stateNextToSpawn();
    g.tryCapture(target.id, T0);
    new GameState(store, cfg, DEFAULT_CAPTURE_CONFIG, T0 + cfg.windowMs * 2);
    expect(Object.keys(store.load()!.caught)).toEqual([]);
    expect(store.load()!.totalCaught).toBe(1);
  });
});

describe('GameState 플레이 영역·마지막 위치', () => {
  it('대한민국 밖이면 스폰이 없다', () => {
    const g = new GameState(new MemoryStore(), cfg, DEFAULT_CAPTURE_CONFIG, T0);
    g.setPlayer(fixAt({ lat: 35.68, lng: 139.69 })); // 도쿄
    expect(g.inPlayArea).toBe(false);
    expect(g.visibleSpawns(T0)).toEqual([]);
  });

  it('부산·제주 등 국내 어디서나 스폰된다', () => {
    for (const pos of [{ lat: 35.1798, lng: 129.075 }, { lat: 33.4996, lng: 126.5312 }, { lat: 37.4844, lng: 130.9057 }]) {
      const g = new GameState(new MemoryStore(), cfg, DEFAULT_CAPTURE_CONFIG, T0);
      g.setPlayer(fixAt(pos));
      expect(g.inPlayArea).toBe(true);
      let total = 0;
      for (let i = 0; i < 5; i++) total += g.visibleSpawns(T0 + i * cfg.windowMs).length;
      expect(total).toBeGreaterThan(0);
    }
  });

  it('마지막 위치를 저장하고 다시 불러온다', () => {
    const store = new MemoryStore();
    const g = new GameState(store, cfg, DEFAULT_CAPTURE_CONFIG, T0);
    expect(g.lastKnown).toBeNull();
    g.setPlayer(fixAt());
    expect(new GameState(store, cfg, DEFAULT_CAPTURE_CONFIG, T0).lastKnown).toEqual(HERE);
  });

  it('조금 움직일 때는 마지막 위치를 다시 쓰지 않는다', () => {
    const store = new MemoryStore();
    const g = new GameState(store, cfg, DEFAULT_CAPTURE_CONFIG, T0);
    g.setPlayer(fixAt());
    g.setPlayer(fixAt(offsetMeters(HERE, 10, 0)));
    expect(store.load()!.lastKnown).toMatchObject(HERE);
    g.setPlayer(fixAt(offsetMeters(HERE, 30, 0)));
    expect(store.load()!.lastKnown!.lat).toBeGreaterThan(HERE.lat);
  });

  it('진행도 초기화해도 마지막 위치는 남는다', () => {
    const store = new MemoryStore();
    const g = new GameState(store, cfg, DEFAULT_CAPTURE_CONFIG, T0);
    g.setPlayer(fixAt());
    g.reset();
    expect(new GameState(store, cfg, DEFAULT_CAPTURE_CONFIG, T0).lastKnown).toEqual(HERE);
  });
});

describe('LocalStorageStore', () => {
  function fakeStorage() {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  }

  it('저장·불러오기', () => {
    const s = new LocalStorageStore('k', fakeStorage());
    s.save({ version: 1, inventory: { fox: 2 }, caught: {}, firstCaughtAt: {}, totalCaught: 2 });
    expect(s.load()?.inventory.fox).toBe(2);
  });

  it('손상된 데이터는 null', () => {
    const st = fakeStorage();
    st.setItem('k', '{not json');
    expect(new LocalStorageStore('k', st).load()).toBeNull();
  });

  it('저장소가 없어도 죽지 않는다', () => {
    const s = new LocalStorageStore('k', undefined);
    s.save({ version: 1, inventory: {}, caught: {}, firstCaughtAt: {}, totalCaught: 0 });
    expect(s.load()).toBeNull();
  });
});
