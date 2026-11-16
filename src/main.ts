import './styles.css';
import { readConfig } from './app/config';
import { distanceMeters, type LatLng } from './core/geo';
import { KOREA_OVERVIEW } from './core/korea';
import { Hud } from './app/hud';
import { DetectorPanel } from './app/detectorUi';
import { ownedShardCount, renderDex, TOTAL_SHARDS } from './app/dex';
import { DigScreen, type DigOutcome } from './ar/DigScreen';
import { ownedParts } from './game/collection';
import { signalLevel } from './game/detector';
import { GameState, type DigResult } from './game/GameState';
import { PART_LABEL, PARTS, RARITY_LABEL, shardImage, vesselById, vesselImage, type Part } from './game/pottery';
import type { DigSite } from './game/sites';
import type { PlayerFix } from './game/rules';
import { LocalStorageStore } from './game/storage';
import type { LocationSource } from './gps/LocationSource';
import { createGps, getStartFix, isNativeApp } from './gps/platform';
import { PositionFilter } from './gps/PositionFilter';
import { Simulator } from './gps/Simulator';
import { createProvider } from './map/createProvider';

const PLAYER_ID = 'player';
const SITE_PREFIX = 'site:';

const SIGNAL_TEXT = [
  '신호 없음 · 노란 원 쪽으로 걸어가 보세요',
  '희미한 신호… 원 안을 돌아다녀 보세요',
  '신호가 잡혀요',
  '신호가 강해져요!',
  '아주 가까워요!!',
  '삐삐삐! 바로 여기예요',
];

/** 시뮬레이터에서 지도를 눌렀을 때 이보다 멀면 걸어가지 않고 순간이동한다(m). */
const TELEPORT_OVER_M = 300;

async function main() {
  const cfg = readConfig(import.meta.env, new URL(location.href), isNativeApp);
  const hud = new Hud();
  const state = new GameState(new LocalStorageStore());

  // ── 시작 위치: ?at → 현재 위치(Geolocation) → 마지막 위치 → 사용자가 고름 ──
  // 지도는 마지막 위치(없으면 전국)로 먼저 띄우고, 현재 위치를 받는 대로 옮긴다.
  hud.setSource('📡 현재 위치 확인 중…');
  const firstView = cfg.start ?? state.lastKnown;
  const [here, { provider, fallbackReason }] = await Promise.all([
    cfg.start ? Promise.resolve(null) : getStartFix(),
    createProvider(
      cfg,
      document.getElementById('map')!,
      firstView ?? KOREA_OVERVIEW.center,
      firstView ? cfg.zoom : KOREA_OVERVIEW.zoom,
    ),
  ]);
  if (fallbackReason) hud.banner(fallbackReason, 'warn');
  document.body.dataset.map = provider.name;

  const startPos = cfg.start ?? here?.pos ?? state.lastKnown;
  if (startPos) {
    provider.setZoom(cfg.zoom);
    provider.setCenter(startPos);
  }

  // ── 카메라 따라가기 ─────────────────────────────
  let follow = true;
  const setFollow = (on: boolean) => {
    follow = on;
    hud.setFollow(on);
  };
  provider.onUserPan(() => setFollow(false));
  hud.onFollow(() => {
    setFollow(true);
    if (state.player) provider.setCenter(state.player.pos, true);
  });

  // ── 위치 소스 ──────────────────────────────────
  const switchMode = (sim: boolean) => {
    const u = new URL(location.href);
    u.searchParams.set('sim', sim ? '1' : '0');
    location.href = u.toString();
  };

  let source: LocationSource;
  let sim: Simulator | null = null;
  let askedToPick = false;

  if (cfg.useSimulator) {
    sim = new Simulator(startPos, { keyTarget: window });
    source = sim;
    hud.setHint(`WASD·방향키 걷기 · Shift 달리기 · 지도 클릭: 가까우면 걸어가고 ${TELEPORT_OVER_M}m 넘으면 순간이동`);
    hud.setMode('📡 실제 GPS', () => switchMode(false));
    if (!startPos) {
      askedToPick = true;
      hud.setSource('🕹️ 시작 위치 없음', 'warn');
      hud.banner('현재 위치를 받지 못했어요. 위 검색창에서 장소를 찾거나 지도를 눌러 시작 위치를 고르세요.', 'warn');
    } else if (!cfg.start && !here) {
      hud.toast('현재 위치를 받지 못해 마지막 위치에서 시작해요');
    }
  } else {
    source = createGps();
    hud.setMode('🕹️ 시뮬레이터', () => switchMode(true));
  }

  const teleportTo = (p: LatLng) => {
    if (!sim) return;
    setFollow(true);
    provider.setZoom(cfg.zoom);
    sim.teleport(p);
  };

  if (sim) {
    const s = sim;
    provider.onClick((p) => {
      const cur = s.position;
      if (!cur || distanceMeters(cur, p) > TELEPORT_OVER_M) teleportTo(p);
      else s.walkTo(p);
    });
  }

  if (provider.searchPlaces) {
    const search = provider.searchPlaces.bind(provider);
    hud.enableSearch(search, (r) => {
      if (sim) {
        teleportTo(r.pos);
        hud.toast(`${r.name}(으)로 순간이동`);
      } else {
        setFollow(false);
        provider.setZoom(cfg.zoom);
        provider.setCenter(r.pos, true);
        hud.toast('실제 GPS 모드에서는 지도만 옮겨요');
      }
    });
  }

  const filter = new PositionFilter();
  const onFix = (raw: PlayerFix) => {
    let fix = raw;
    if (source.kind === 'gps') {
      const r = filter.push(raw);
      if (!r.accepted) {
        hud.setSource(r.reason === 'inaccurate' ? `📡 신호 약함 ±${Math.round(raw.accuracy)}m` : '📡 위치 튐 무시', 'warn');
        return;
      }
      fix = r.fix;
    }
    if (askedToPick) {
      askedToPick = false;
      hud.hideBanner();
    }
    state.setPlayer(fix);
    if (follow) provider.setCenter(fix.pos);
  };

  source.start(onFix, (err) => {
    if (err.code === 'coarse-only') return hud.banner(err.message, 'warn');
    hud.setSource('📡 위치 없음', 'error');
    const where = state.lastKnown ? ' 지금은 마지막으로 알던 위치를 보여 주고 있어요.' : '';
    hud.banner(err.message + where, 'error', { label: '시뮬레이터로 하기', onClick: () => switchMode(true) });
  });
  // GPS 모드: 시작 때 받은 위치를 첫 측정으로 쓴다(watchPosition 첫 응답 전까지).
  if (source.kind === 'gps' && here) onFix(here);

  // ── 그리기 ────────────────────────────────────
  const detector = new DetectorPanel();
  detector.vibrate = source.kind === 'gps';
  const dig = new DigScreen(document.getElementById('dig')!);
  const shownSites = new Set<string>();
  let dexKey = '';

  const exchange = (vesselId: string, part: Part) => {
    const r = state.exchange(vesselId, part, Date.now());
    if (r.ok) hud.toast(r.restored ? `🎉 ${r.vessel.short} 복원 완료!` : `${r.vessel.short} ${PART_LABEL[part]} 조각을 얻었어요`);
    else if (r.reason === 'not-enough-dust') hud.toast(`고운 흙이 ${r.cost}만큼 필요해요`);
  };

  const describeDig = (r: DigResult): DigOutcome => {
    if (!r.ok) {
      const message =
        r.reason === 'too-far'
          ? `지점에서 너무 멀어졌어요 (${Math.ceil(r.remainingM)}m 더 가까이)`
          : r.reason === 'poor-accuracy'
            ? `GPS 신호가 약해서 기록하지 못했어요 (±${Math.round(r.accuracyM)}m)`
            : r.reason === 'expired'
              ? '날짜가 바뀌어 이 지점이 사라졌어요'
              : r.reason === 'already-caught'
                ? '이미 판 자리예요'
                : '내 위치를 몰라요';
      return { ok: false, message };
    }
    if (r.restored) {
      // 마지막 조각으로 도자기가 완성된 순간: 조각 대신 완성품을 크게 보여 준다.
      return {
        ok: true,
        restored: true,
        title: `${r.vessel.name} 복원 완료!`,
        image: vesselImage(r.vessel.id),
        badge: `${RARITY_LABEL[r.vessel.rarity]} · ${PARTS.length}조각 완성`,
        lines: [`마지막 조각: ${PART_LABEL[r.part]}`, `복원 보상 고운 흙 +${r.dust}`],
      };
    }
    const lines: string[] = [RARITY_LABEL[r.vessel.rarity]];
    if (!r.isNew) lines.push(`이미 가진 조각 → 고운 흙 +${r.dust}`);
    else lines.push(`${r.vessel.short} 조각 ${ownedParts(state.save, r.vessel.id).length}/${PARTS.length}`);
    return {
      ok: true,
      title: `${r.vessel.name} · ${PART_LABEL[r.part]}`,
      image: shardImage(r.vessel.id, r.part),
      badge: r.isNew ? '새 조각' : undefined,
      lines,
    };
  };

  const openDig = (site: DigSite) => {
    const vessel = vesselById(site.vesselId)!;
    detector.paused = true;
    dig.open({
      layers: site.layers,
      shardSrc: shardImage(site.vesselId, site.part),
      fallbackColor: vessel.color,
      seed: site.id,
      onComplete: () => describeDig(state.dig(site.id, Date.now())),
      onShowDex: () => hud.openDex(),
      onClose: () => {
        detector.paused = false;
        render();
      },
    });
  };

  const render = () => {
    const now = Date.now();
    const player = state.player;
    hud.setDexCount(ownedShardCount(state.save), TOTAL_SHARDS);
    // 걷는 동안 매번 다시 그리지 않게, 저장 내용이 바뀔 때만 도감을 그린다.
    const key = `${state.save.dust}|${JSON.stringify(state.save.shards)}|${Object.keys(state.save.restoredAt).length}`;
    if (key !== dexKey) {
      dexKey = key;
      renderDex(state.save, exchange);
    }
    if (!player) {
      detector.set(0, '내 위치를 기다리는 중…');
      return;
    }

    const weak = player.accuracy > state.detectorConfig.maxAccuracyM;
    hud.setSource(
      `${source.kind === 'sim' ? '🕹️ 시뮬레이터' : '📡 GPS'} ±${Math.round(player.accuracy)}m`,
      weak ? 'warn' : 'ok',
    );
    provider.setMarker({ id: PLAYER_ID, pos: player.pos, html: '<div class="player"></div>', zIndex: 100 });
    provider.setCircle({ id: PLAYER_ID, center: player.pos, radiusM: state.detectorConfig.digRadiusM, color: '#ffd166', fillOpacity: 0.12 });

    const next = new Set<string>();
    for (const s of state.visibleSites(now)) {
      const id = SITE_PREFIX + s.id;
      next.add(id);
      provider.setCircle({ id, center: s.hintCenter, radiusM: state.siteConfig.searchRadiusM, color: '#e9c46a', fillOpacity: 0.1 });
    }
    for (const id of shownSites) if (!next.has(id)) provider.removeCircle(id);
    shownSites.clear();
    for (const id of next) shownSites.add(id);

    if (!state.inPlayArea) {
      detector.set(0, '🇰🇷 국내에서만 발굴할 수 있어요');
      detector.setDig(null);
      return;
    }
    const near = state.nearestSite(now);
    const level = signalLevel(near?.distanceM ?? Infinity, state.detectorConfig);
    const check = near ? state.check(near.site, now) : null;
    if (check?.ok) {
      detector.set(level, '삐삐삐! 바로 여기예요');
      detector.setDig(() => openDig(near!.site));
    } else {
      detector.setDig(null);
      if (check && !check.ok && check.reason === 'poor-accuracy') detector.set(level, `GPS 신호가 약해요 (±${Math.round(check.accuracyM)}m)`);
      else detector.set(level, SIGNAL_TEXT[level]);
    }
  };

  state.subscribe(render);
  render();
  // 자정에 지점이 바뀌므로 가끔 다시 그린다.
  setInterval(() => state.tick(Date.now()), 30_000);

  hud.onReset(() => {
    if (confirm('모은 조각·고운 흙·도감을 모두 지울까요?')) state.reset();
  });

  if (provider.showStreetView) {
    const show = provider.showStreetView.bind(provider);
    hud.enableRoadview((el) => show(state.player?.pos ?? provider.getCenter(), el));
  }

  // 개발 중 콘솔에서 확인할 수 있게
  Object.assign(window, { __game: { state, provider, source, cfg } });
}

main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">${String(e?.message ?? e)}</pre>`);
});
