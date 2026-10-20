import './styles.css';
import { readConfig } from './app/config';
import { distanceMeters, type LatLng } from './core/geo';
import { KOREA_OVERVIEW } from './core/korea';
import { Hud } from './app/hud';
import { creatureById } from './game/creatures';
import { GameState } from './game/GameState';
import type { PlayerFix } from './game/rules';
import { LocalStorageStore } from './game/storage';
import type { LocationSource } from './gps/LocationSource';
import { createGps, getStartFix, isNativeApp } from './gps/platform';
import { PositionFilter } from './gps/PositionFilter';
import { Simulator } from './gps/Simulator';
import { createProvider } from './map/createProvider';

const PLAYER_ID = 'player';
const SPAWN_PREFIX = 'spawn:';

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
  const shown = new Set<string>();

  const capture = (spawnId: string, at: LatLng) => {
    const r = state.tryCapture(spawnId, Date.now());
    if (r.ok) {
      if (r.kind) {
        hud.toast(`${r.kind.emoji} ${r.kind.name} 획득!`);
        hud.pop(r.kind.emoji, provider.latLngToScreen(at));
      }
      return;
    }
    switch (r.reason) {
      case 'too-far':
        hud.toast(`${Math.ceil(r.remainingM)}m 더 가까이 가야 해요`);
        break;
      case 'poor-accuracy':
        hud.toast(`GPS 신호가 약해서 잡을 수 없어요 (±${Math.round(r.accuracyM)}m)`);
        break;
      case 'no-position':
        hud.toast('아직 내 위치를 몰라요');
        break;
      default:
        hud.toast('이미 사라졌어요');
    }
  };

  const render = () => {
    const now = Date.now();
    const player = state.player;
    hud.setInventory(state.inventory, state.totalCaught);
    if (!player) return;

    const weak = player.accuracy > state.captureConfig.maxAccuracyM;
    hud.setSource(
      `${source.kind === 'sim' ? '🕹️ 시뮬레이터' : '📡 GPS'} ±${Math.round(player.accuracy)}m`,
      weak ? 'warn' : 'ok',
    );
    provider.setMarker({ id: PLAYER_ID, pos: player.pos, html: '<div class="player"></div>', zIndex: 100 });
    provider.setCircle({ id: PLAYER_ID, center: player.pos, radiusM: state.captureConfig.radiusM, color: '#4cc9f0' });

    const spawns = state.visibleSpawns(now);
    const next = new Set<string>();
    let inRange = 0;
    let nearest = Infinity;
    for (const s of spawns) {
      const kind = creatureById(s.kindId);
      if (!kind) continue;
      const check = state.check(s, now);
      const hot = check.ok;
      if (hot) inRange++;
      if (check.ok) nearest = Math.min(nearest, check.distanceM);
      else if (check.reason === 'too-far') nearest = Math.min(nearest, check.distanceM);

      const id = SPAWN_PREFIX + s.id;
      next.add(id);
      provider.setMarker({
        id,
        pos: s.pos,
        html: `<button class="spawn ${kind.rarity}${hot ? ' hot' : ''}" type="button" aria-label="${kind.name}">${kind.emoji}</button>`,
        zIndex: hot ? 50 : 10,
        onClick: () => capture(s.id, s.pos),
      });
    }
    for (const id of shown) if (!next.has(id)) provider.removeMarker(id);
    shown.clear();
    for (const id of next) shown.add(id);

    if (!state.inPlayArea) hud.setNear('🇰🇷 국내에서만 생물이 나와요', 'warn');
    else if (inRange) hud.setNear(`✨ 잡을 수 있음 ${inRange}`, 'hot');
    else if (Number.isFinite(nearest)) hud.setNear(`가장 가까운 생물 ${Math.round(nearest)}m`);
    else hud.setNear('주변에 생물이 없어요');
  };

  state.subscribe(render);
  render();
  // 15분마다 스폰이 바뀌므로 가끔 다시 그린다.
  setInterval(() => state.tick(Date.now()), 5_000);

  hud.onReset(() => {
    if (confirm('잡은 생물과 도감을 모두 지울까요?')) state.reset();
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
