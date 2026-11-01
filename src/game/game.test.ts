import { describe, expect, it } from 'vitest';
import { distanceMeters, offsetMeters } from '../core/geo';
import { addShard, exchangeShard, ownedParts } from './collection';
import { beepIntervalMs, DEFAULT_DETECTOR_CONFIG, MAX_SIGNAL, signalLevel } from './detector';
import { Excavation, excavationConfig } from './excavation';
import { GameState } from './GameState';
import { cellOf } from './grid';
import { DUST_FOR_DUPLICATE, EXCHANGE_COST, PARTS, pickPart, pickVessel, RESTORE_BONUS, VESSELS } from './pottery';
import { checkRange } from './rules';
import { dayEndsAt, dayIndex, DEFAULT_SITE_CONFIG, sitesInCell, sitesNear } from './sites';
import { emptySave, LocalStorageStore, MemoryStore } from './storage';

const HERE = { lat: 37.5663, lng: 126.9779 }; // 서울시청
// 2026-10-18 12:00 KST
const T0 = Date.UTC(2026, 9, 18, 3, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const cfg = DEFAULT_SITE_CONFIG;

function fixAt(pos = HERE, accuracy = 5) {
  return { pos, accuracy, timestamp: T0 };
}

describe('pottery', () => {
  it('가중치 추첨 경계값', () => {
    expect(pickVessel(0).id).toBe(VESSELS[0].id);
    expect(pickVessel(0.999999).id).toBe(VESSELS[VESSELS.length - 1].id);
    expect(pickPart(0)).toBe('rim');
    expect(pickPart(0.999999)).toBe('base');
  });
});

describe('sites', () => {
  it('하루 창은 한국 자정에 바뀐다', () => {
    const midnightKst = Date.UTC(2026, 9, 18, 15, 0, 0); // 10-19 00:00 KST
    expect(dayIndex(midnightKst - 1)).toBe(dayIndex(T0));
    expect(dayIndex(midnightKst)).toBe(dayIndex(T0) + 1);
    expect(dayEndsAt(dayIndex(T0))).toBe(midnightKst);
  });

  it('같은 셀·날짜면 항상 같은 지점 (결정적)', () => {
    const cell = cellOf(HERE, cfg.cellSizeM);
    expect(sitesInCell(cell, dayIndex(T0))).toEqual(sitesInCell(cell, dayIndex(T0)));
  });

  it('날짜가 바뀌면 배치가 바뀐다', () => {
    const a = sitesNear(HERE, T0).map((s) => s.id + s.vesselId);
    const b = sitesNear(HERE, T0 + DAY).map((s) => s.id + s.vesselId);
    expect(a).not.toEqual(b);
  });

  it('지점은 자기 셀 안에 있고, 탐색 원이 실제 지점을 포함한다', () => {
    for (let d = 0; d < 10; d++) {
      for (const s of sitesNear(HERE, T0 + d * DAY, cfg, 2)) {
        const [row, col] = s.id.split(':').map(Number);
        expect(cellOf(s.pos, cfg.cellSizeM)).toEqual({ row, col });
        expect(distanceMeters(s.pos, s.hintCenter)).toBeLessThanOrEqual(cfg.maxHintOffsetM + 0.01);
        expect(distanceMeters(s.pos, s.hintCenter)).toBeLessThan(cfg.searchRadiusM);
        expect(s.expiresAt).toBe(dayEndsAt(dayIndex(T0 + d * DAY)));
      }
    }
  });

  it('주변 3x3 셀에 평균 maxPerCell/2 × 9곳 정도', () => {
    let total = 0;
    for (let i = 0; i < 60; i++) total += sitesNear(HERE, T0 + i * DAY).length;
    const avg = total / 60;
    expect(avg).toBeGreaterThan(6);
    expect(avg).toBeLessThan(12);
  });
});

describe('detector', () => {
  it('범위 밖 0, 발굴 거리 안 최대', () => {
    expect(signalLevel(Infinity)).toBe(0);
    expect(signalLevel(DEFAULT_DETECTOR_CONFIG.rangeM + 1)).toBe(0);
    expect(signalLevel(DEFAULT_DETECTOR_CONFIG.rangeM)).toBe(1);
    expect(signalLevel(DEFAULT_DETECTOR_CONFIG.digRadiusM)).toBe(MAX_SIGNAL);
    expect(signalLevel(0)).toBe(MAX_SIGNAL);
    expect(signalLevel(DEFAULT_DETECTOR_CONFIG.digRadiusM + 0.1)).toBe(MAX_SIGNAL - 1);
  });

  it('가까울수록 신호가 세다 (단조)', () => {
    let prev = 0;
    for (let d = 120; d >= 0; d -= 1) {
      const l = signalLevel(d);
      expect(l).toBeGreaterThanOrEqual(prev);
      prev = l;
    }
  });

  it('삐 간격은 신호가 셀수록 짧다', () => {
    expect(beepIntervalMs(0)).toBe(0);
    for (let l = 1; l < MAX_SIGNAL; l++) expect(beepIntervalMs(l + 1)).toBeLessThan(beepIntervalMs(l));
  });
});

describe('excavation', () => {
  /** 판 전체를 3칸 간격 줄무늬로 문지른다. 완료까지 걸린 획 수(실패면 -1). */
  function sweep(ex: Excavation, passes: number) {
    let strokes = 0;
    for (let p = 0; p < passes; p++) {
      for (let y = 1; y < ex.cfg.rows; y += 3) {
        strokes++;
        if (ex.rub(0, y, ex.cfg.cols, y).completed) return strokes;
      }
    }
    return -1;
  }

  it('처음엔 아무것도 안 드러나 있다', () => {
    const ex = new Excavation(excavationConfig(2));
    expect(ex.progress).toBe(0);
    expect(ex.topLayerAt(10, 10)).toBe(0);
    expect(ex.topLayerAt(-1, 0)).toBe(-1);
  });

  it('맨 위 겹부터 순서대로 깎인다', () => {
    const ex = new Excavation(excavationConfig(3));
    const seen: number[] = [];
    for (let i = 0; i < 200 && ex.topLayerAt(24, 16) < 3; i++) {
      const r = ex.rub(23, 16.5, 26, 16.5);
      for (const c of r.cleared) if (c.col === 24 && c.row === 16) seen.push(c.layer);
    }
    expect(seen).toEqual([0, 1, 2]);
  });

  it('2겹: 맨 위 겹만 다 걷었을 때 막대는 절반 언저리', () => {
    const ex = new Excavation(excavationConfig(2));
    for (let i = 0; i < 400 && ex.topLayerAt(24, 16) < 1; i++) ex.rub(0, (i * 3) % 32 + 1, 48, (i * 3) % 32 + 1);
    expect(ex.completed).toBe(false);
    expect(ex.meter).toBeGreaterThan(0.3);
    expect(ex.meter).toBeLessThan(0.75);
  });

  it('처음 뚫린 겹을 한 번만 알린다', () => {
    const ex = new Excavation(excavationConfig(2));
    const all: number[] = [];
    for (let i = 0; i < 100; i++) all.push(...ex.rub(20, 16, 28, 16).brokeThrough);
    expect(all).toEqual([0, 1]);
  });

  it('충분히 문지르면 완료되고, 완료는 한 번만 알린다', () => {
    const ex = new Excavation(excavationConfig(2));
    expect(sweep(ex, 50)).toBeGreaterThan(0);
    expect(ex.completed).toBe(true);
    expect(ex.progress).toBeGreaterThanOrEqual(0.7);
    expect(ex.rub(0, 16, 48, 16).completed).toBe(false);
  });

  it('겹이 많을수록 더 오래 걸린다', () => {
    const passes = [2, 3, 4].map((n) => sweep(new Excavation(excavationConfig(n)), 100));
    expect(passes[0]).toBeGreaterThan(10);
    expect(passes[1]).toBeGreaterThan(passes[0]);
    expect(passes[2]).toBeGreaterThan(passes[1]);
    // 전설(4겹)도 판 전체를 열 번 남짓 훑으면 끝난다
    expect(passes[2]).toBeLessThan(11 * 10);
  });

  it('파편 모양을 주면 그 칸들만 진행률에 센다', () => {
    const ex = new Excavation(excavationConfig(2), (c, r) => r === 5 && c >= 10 && c < 20);
    for (let i = 0; i < 40 && !ex.completed; i++) ex.rub(8, 5.5, 22, 5.5);
    expect(ex.completed).toBe(true);
    expect(ex.topLayerAt(24, 16)).toBe(0); // 가운데는 건드리지 않았다
  });

  it('진행 막대는 첫 겹을 깎는 동안에도 차고, 완료 때 1', () => {
    const ex = new Excavation(excavationConfig(3));
    for (let y = 1; y < 32; y += 3) ex.rub(0, y, 48, y);
    expect(ex.progress).toBe(0); // 아직 바닥까지 드러난 칸은 없다
    expect(ex.meter).toBeGreaterThan(0.1);
    // 3겹 중 맨 위 한 겹 남짓 → 막대도 절반이 안 된다 (에뮬레이터에서 한 번에 95%까지 차던 문제)
    expect(ex.meter).toBeLessThan(0.5);
    let prev = ex.meter;
    for (let i = 0; i < 200 && !ex.completed; i++) {
      ex.rub(0, (i * 3) % 32, 48, (i * 3) % 32);
      expect(ex.meter).toBeGreaterThanOrEqual(prev);
      prev = ex.meter;
    }
    expect(ex.meter).toBe(1);
  });

  it('판 가장자리만 문지르면 완료되지 않는다', () => {
    const ex = new Excavation(excavationConfig(2));
    for (let i = 0; i < 100; i++) ex.rub(0, 1, 48, 1);
    expect(ex.progress).toBe(0);
  });
});

describe('collection', () => {
  const v = VESSELS[0]; // 흔함

  it('새 조각 → 중복은 고운 흙', () => {
    const d = emptySave();
    expect(addShard(d, v.id, 'rim', T0)).toMatchObject({ isNew: true, dust: 0, restored: false });
    expect(addShard(d, v.id, 'rim', T0)).toMatchObject({ isNew: false, dust: DUST_FOR_DUPLICATE[v.rarity] });
    expect(d.dust).toBe(DUST_FOR_DUPLICATE[v.rarity]);
    expect(d.shards[`${v.id}:rim`]).toBe(2);
  });

  it('4조각이 모이면 한 번만 복원 보너스', () => {
    const d = emptySave();
    const results = PARTS.map((p) => addShard(d, v.id, p, T0));
    expect(results.map((r) => r.restored)).toEqual([false, false, false, true]);
    expect(d.restoredAt[v.id]).toBe(T0);
    expect(d.dust).toBe(RESTORE_BONUS[v.rarity]);
    expect(addShard(d, v.id, 'rim', T0).restored).toBe(false);
  });

  it('고운 흙으로 모자란 조각 교환', () => {
    const d = emptySave();
    const cost = EXCHANGE_COST[v.rarity];
    expect(exchangeShard(d, v.id, 'base', T0)).toMatchObject({ ok: false, reason: 'not-enough-dust' });
    d.dust = cost;
    expect(exchangeShard(d, v.id, 'base', T0)).toMatchObject({ ok: true });
    expect(d.dust).toBe(0);
    expect(ownedParts(d, v.id)).toEqual(['base']);
    d.dust = 100;
    expect(exchangeShard(d, v.id, 'base', T0)).toMatchObject({ ok: false, reason: 'owned' });
    expect(exchangeShard(d, 'nope', 'base', T0)).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('교환으로 마지막 조각을 채우면 복원된다', () => {
    const d = emptySave();
    for (const p of PARTS.slice(0, 3)) addShard(d, v.id, p, T0);
    d.dust = EXCHANGE_COST[v.rarity];
    expect(exchangeShard(d, v.id, 'base', T0)).toMatchObject({ ok: true, restored: true });
    expect(d.dust).toBe(RESTORE_BONUS[v.rarity]);
  });
});

describe('checkRange', () => {
  const rc = { radiusM: 20, maxAccuracyM: 50 };
  it('반경 안이면 ok, 밖이면 남은 거리', () => {
    expect(checkRange(fixAt(), offsetMeters(HERE, 15, 0), rc).ok).toBe(true);
    const r = checkRange(fixAt(), offsetMeters(HERE, 50, 0), rc);
    expect(r).toMatchObject({ ok: false, reason: 'too-far' });
    if (r.ok === false && r.reason === 'too-far') expect(r.remainingM).toBeCloseTo(30, 0);
  });

  it('정확도가 나쁘거나 위치가 없으면 막는다', () => {
    expect(checkRange(fixAt(HERE, 80), HERE, rc)).toMatchObject({ reason: 'poor-accuracy' });
    expect(checkRange(null, HERE, rc)).toMatchObject({ reason: 'no-position' });
  });
});

describe('GameState', () => {
  function stateNextToSite() {
    const store = new MemoryStore();
    const g = new GameState(store, cfg, DEFAULT_DETECTOR_CONFIG, T0);
    g.setPlayer(fixAt());
    const target = g.visibleSites(T0)[0];
    expect(target).toBeDefined();
    g.setPlayer(fixAt(offsetMeters(target.pos, 10, 0)));
    return { g, store, target };
  }

  it('가까운 지점을 탐지기가 가리킨다', () => {
    const { g, target } = stateNextToSite();
    expect(g.nearestSite(T0)?.site.id).toBe(target.id);
    expect(g.nearestSite(T0)!.distanceM).toBeCloseTo(10, 0);
  });

  it('가까이서 파면 조각을 얻고 지점이 사라진다', () => {
    const { g, target } = stateNextToSite();
    const r = g.dig(target.id, T0);
    expect(r).toMatchObject({ ok: true, isNew: true, part: target.part });
    expect(g.save.shards[`${target.vesselId}:${target.part}`]).toBe(1);
    expect(g.save.totalDug).toBe(1);
    expect(g.visibleSites(T0).some((s) => s.id === target.id)).toBe(false);
    expect(g.dig(target.id, T0)).toMatchObject({ ok: false, reason: 'already-caught' });
  });

  it('멀거나 GPS가 나쁘면 못 판다', () => {
    const { g, target } = stateNextToSite();
    g.setPlayer(fixAt(offsetMeters(target.pos, 40, 0)));
    expect(g.dig(target.id, T0)).toMatchObject({ ok: false, reason: 'too-far' });
    g.setPlayer(fixAt(target.pos, 80));
    expect(g.dig(target.id, T0)).toMatchObject({ ok: false, reason: 'poor-accuracy' });
    expect(g.save.totalDug).toBe(0);
  });

  it('없는 지점·날짜가 바뀐 지점은 거부', () => {
    const { g, target } = stateNextToSite();
    expect(g.dig('1:2:3:4', T0).ok).toBe(false);
    expect(g.dig(target.id, T0 + DAY)).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('저장 후 다시 불러오면 유지되고, 지난 날짜의 판 기록은 정리된다', () => {
    const { g, store, target } = stateNextToSite();
    g.dig(target.id, T0);
    const g2 = new GameState(store, cfg, DEFAULT_DETECTOR_CONFIG, T0);
    expect(g2.save.totalDug).toBe(1);
    expect(target.id in g2.save.dug).toBe(true);
    new GameState(store, cfg, DEFAULT_DETECTOR_CONFIG, T0 + DAY);
    expect(store.load()!.dug).toEqual({});
    expect(store.load()!.totalDug).toBe(1);
  });

  it('교환은 저장된다', () => {
    const store = new MemoryStore();
    const d = emptySave();
    d.dust = 100;
    store.save(d);
    const g = new GameState(store, cfg, DEFAULT_DETECTOR_CONFIG, T0);
    expect(g.exchange('onggi', 'rim', T0).ok).toBe(true);
    expect(store.load()!.shards['onggi:rim']).toBe(1);
  });

  it('대한민국 밖이면 지점이 없다', () => {
    const g = new GameState(new MemoryStore(), cfg, DEFAULT_DETECTOR_CONFIG, T0);
    g.setPlayer(fixAt({ lat: 35.68, lng: 139.69 })); // 도쿄
    expect(g.inPlayArea).toBe(false);
    expect(g.visibleSites(T0)).toEqual([]);
    expect(g.nearestSite(T0)).toBeNull();
  });

  it('부산·제주·울릉 등 국내 어디서나 지점이 생긴다', () => {
    for (const pos of [{ lat: 35.1798, lng: 129.075 }, { lat: 33.4996, lng: 126.5312 }, { lat: 37.4844, lng: 130.9057 }]) {
      const g = new GameState(new MemoryStore(), cfg, DEFAULT_DETECTOR_CONFIG, T0);
      g.setPlayer(fixAt(pos));
      let total = 0;
      for (let i = 0; i < 5; i++) total += g.visibleSites(T0 + i * DAY).length;
      expect(total).toBeGreaterThan(0);
    }
  });

  it('마지막 위치: 저장·조금 움직이면 안 씀·초기화해도 남음', () => {
    const store = new MemoryStore();
    const g = new GameState(store, cfg, DEFAULT_DETECTOR_CONFIG, T0);
    expect(g.lastKnown).toBeNull();
    g.setPlayer(fixAt());
    g.setPlayer(fixAt(offsetMeters(HERE, 10, 0)));
    expect(store.load()!.lastKnown).toMatchObject(HERE);
    g.reset();
    expect(new GameState(store, cfg, DEFAULT_DETECTOR_CONFIG, T0).lastKnown).toEqual(HERE);
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
    s.save({ ...emptySave(), dust: 7, shards: { 'onggi:rim': 2 } });
    expect(s.load()).toMatchObject({ dust: 7, shards: { 'onggi:rim': 2 } });
  });

  it('손상되거나 버전이 다르면 null', () => {
    const st = fakeStorage();
    st.setItem('k', '{not json');
    expect(new LocalStorageStore('k', st).load()).toBeNull();
    st.setItem('k', JSON.stringify({ version: 99 }));
    expect(new LocalStorageStore('k', st).load()).toBeNull();
  });

  it('저장소가 없어도 죽지 않는다', () => {
    const s = new LocalStorageStore('k', undefined);
    s.save(emptySave());
    expect(s.load()).toBeNull();
  });
});
