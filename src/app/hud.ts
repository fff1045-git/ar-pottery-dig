import type { PlaceResult } from '../map/MapProvider';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface BannerAction {
  label: string;
  onClick: () => void;
}

/** 지도 위 DOM UI. 게임 상태를 직접 읽지 않고, main이 넘겨주는 값만 그린다. */
export class Hud {
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    $('#banner-close').addEventListener('click', () => ($('#banner').hidden = true));
    $('#dex-btn').addEventListener('click', () => this.openDex());
    $('#dex-close').addEventListener('click', () => this.toggleSheet('#dex', false));
    $('#roadview-close').addEventListener('click', () => this.toggleSheet('#roadview', false));
  }

  setSource(text: string, tone: 'ok' | 'warn' | 'error' = 'ok') {
    const el = $('#src-chip');
    el.textContent = text;
    el.dataset.tone = tone;
  }

  setHint(text: string | null) {
    $('#hint').hidden = !text;
    $('#hint').textContent = text ?? '';
  }

  setFollow(on: boolean) {
    $('#follow-btn').classList.toggle('active', on);
  }

  banner(text: string, tone: 'warn' | 'error', action?: BannerAction) {
    const el = $('#banner');
    el.dataset.tone = tone;
    $('#banner-text').textContent = text;
    const btn = $<HTMLButtonElement>('#banner-action');
    btn.hidden = !action;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = action.onClick;
    }
    el.hidden = false;
  }

  toast(text: string, ms = 2200) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (el.hidden = true), ms);
  }

  /** 상단 도감 버튼에 보유 조각 수. */
  setDexCount(owned: number, total: number) {
    $('#dex-count').textContent = `${owned}/${total}`;
  }

  openDex() {
    this.toggleSheet('#dex', true);
  }

  onReset(fn: () => void) {
    $('#reset-btn').addEventListener('click', fn);
  }

  onFollow(fn: () => void) {
    $('#follow-btn').addEventListener('click', fn);
  }

  setMode(label: string, fn: () => void) {
    const btn = $('#mode-btn');
    btn.textContent = label;
    btn.onclick = fn;
  }

  enableRoadview(fn: (el: HTMLElement) => Promise<boolean>) {
    const btn = $<HTMLButtonElement>('#roadview-btn');
    btn.hidden = false;
    btn.onclick = async () => {
      const view = $('#roadview-view');
      view.replaceChildren();
      this.toggleSheet('#roadview', true);
      if (!(await fn(view))) {
        this.toggleSheet('#roadview', false);
        this.toast('이 근처(50m)에는 로드뷰 사진이 없어요');
      }
    };
  }

  /** 장소 검색창. 결과를 고르면 onPick. */
  enableSearch(search: (q: string) => Promise<PlaceResult[]>, onPick: (r: PlaceResult) => void) {
    const form = $<HTMLFormElement>('#search');
    const input = $<HTMLInputElement>('#search-input');
    const list = $('#search-results');
    form.hidden = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      const rows = await search(q).catch(() => []);
      list.hidden = false;
      if (!rows.length) {
        list.innerHTML = '<li class="empty">검색 결과가 없어요</li>';
        return;
      }
      list.replaceChildren(
        ...rows.slice(0, 8).map((r) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = r.name;
          const small = document.createElement('small');
          small.textContent = r.address;
          btn.appendChild(small);
          btn.addEventListener('click', () => {
            list.hidden = true;
            input.blur();
            onPick(r);
          });
          li.appendChild(btn);
          return li;
        }),
      );
    });
    input.addEventListener('input', () => {
      if (!input.value) list.hidden = true;
    });
  }

  hideBanner() {
    $('#banner').hidden = true;
  }

  private toggleSheet(sel: string, open: boolean) {
    $(sel).hidden = !open;
  }
}
