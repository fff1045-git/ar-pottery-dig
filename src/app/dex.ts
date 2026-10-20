import { hasShard, isRestored, ownedParts } from '../game/collection';
import { EXCHANGE_COST, PART_LABEL, PARTS, RARITY_LABEL, shardId, shardImage, vesselImage, VESSELS, type Part } from '../game/pottery';
import type { SaveData } from '../game/storage';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export const TOTAL_SHARDS = VESSELS.length * PARTS.length;

export function ownedShardCount(save: Readonly<SaveData>): number {
  return VESSELS.reduce((n, v) => n + ownedParts(save, v.id).length, 0);
}

/**
 * 도감 시트. 도자기마다 카드 하나: 완성 그림(복원 전엔 흐린 실루엣), 조각 4칸, 모자란 조각 교환 버튼.
 * 그리기만 하고, 교환은 onExchange로 main에 넘긴다.
 */
export function renderDex(save: Readonly<SaveData>, onExchange: (vesselId: string, part: Part) => void) {
  const restored = VESSELS.filter((v) => isRestored(save, v.id)).length;
  $('#dex-progress').textContent = `복원 ${restored}/${VESSELS.length} · 조각 ${ownedShardCount(save)}/${TOTAL_SHARDS}`;
  $('#dex-dust').textContent = String(save.dust);

  $('#dex-list').replaceChildren(
    ...VESSELS.map((v) => {
      const done = isRestored(save, v.id);
      const seen = ownedParts(save, v.id).length > 0;
      const li = document.createElement('li');
      li.className = `vessel ${v.rarity}${done ? ' restored' : ''}${seen ? '' : ' unseen'}`;

      const head = document.createElement('div');
      head.className = 'vessel-head';
      const img = document.createElement('img');
      img.className = 'vessel-img';
      img.src = vesselImage(v.id);
      img.alt = done ? v.name : '';
      img.onerror = () => img.replaceWith(fallbackSwatch(v.color));
      const title = document.createElement('div');
      title.innerHTML = `<b class="vessel-name"></b><small class="vessel-meta"></small>`;
      title.querySelector('b')!.textContent = seen ? v.name : '???';
      title.querySelector('small')!.textContent = `${RARITY_LABEL[v.rarity]}${done ? ' · 복원 완료 ✨' : ''}`;
      head.append(img, title);

      const parts = document.createElement('ol');
      parts.className = 'parts';
      for (const p of PARTS) {
        const slot = document.createElement('li');
        const owned = hasShard(save, v.id, p);
        slot.className = `part${owned ? ' owned' : ''}`;
        if (owned) {
          const s = document.createElement('img');
          s.src = shardImage(v.id, p);
          s.alt = `${v.short} ${PART_LABEL[p]}`;
          s.onerror = () => s.replaceWith(fallbackSwatch(v.color));
          const n = save.shards[shardId(v.id, p)];
          const cap = document.createElement('span');
          cap.textContent = `${PART_LABEL[p]}${n > 1 ? ` ×${n}` : ''}`;
          slot.append(s, cap);
        } else {
          const cost = EXCHANGE_COST[v.rarity];
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.disabled = save.dust < cost;
          btn.innerHTML = `<span class="q">?</span><span></span>`;
          btn.lastElementChild!.textContent = `${PART_LABEL[p]} · 흙 ${cost}`;
          btn.setAttribute('aria-label', `${PART_LABEL[p]} 조각을 고운 흙 ${cost}로 교환`);
          btn.addEventListener('click', () => onExchange(v.id, p));
          slot.append(btn);
        }
        parts.append(slot);
      }
      li.append(head, parts);
      return li;
    }),
  );
}

function fallbackSwatch(color: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'swatch';
  d.style.background = color;
  return d;
}
