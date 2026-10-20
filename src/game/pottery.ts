export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export const RARITY_LABEL: Record<Rarity, string> = {
  common: '흔함',
  uncommon: '조금 드묾',
  rare: '희귀',
  legendary: '전설',
};

/** 도자기 한 점을 이루는 조각. 위에서 아래 순서. */
export const PARTS = ['rim', 'shoulder', 'body', 'base'] as const;
export type Part = (typeof PARTS)[number];

export const PART_LABEL: Record<Part, string> = {
  rim: '입전',
  shoulder: '어깨',
  body: '몸통',
  base: '굽',
};

export interface Vessel {
  id: string;
  name: string;
  /** 짧은 이름(알림용). */
  short: string;
  rarity: Rarity;
  /** 발굴 지점 추첨 가중치. 클수록 자주 나온다. */
  weight: number;
  /** 그림이 없을 때 대신 칠하는 색. */
  color: string;
}

/** 한국 전통 도자기 양식의 오리지널 도자기들. 실존 소장품의 이름·도안을 쓰지 않는다. */
export const VESSELS: readonly Vessel[] = [
  { id: 'onggi', name: '옹기 항아리', short: '옹기', rarity: 'common', weight: 34, color: '#5b3a24' },
  { id: 'buncheong', name: '분청사기 인화문 대접', short: '분청 대접', rarity: 'common', weight: 28, color: '#8c958c' },
  { id: 'moonjar', name: '백자 둥근 항아리', short: '백자 항아리', rarity: 'uncommon', weight: 18, color: '#ece6d6' },
  { id: 'bluewhite', name: '청화백자 풀꽃무늬 병', short: '청화백자 병', rarity: 'uncommon', weight: 12, color: '#dfe6ee' },
  { id: 'celadon', name: '청자 상감 구름학무늬 매병', short: '청자 매병', rarity: 'rare', weight: 6, color: '#7fae9c' },
  { id: 'lotus', name: '청자 연꽃 향로', short: '청자 향로', rarity: 'legendary', weight: 2, color: '#6fa892' },
];

/** 흙 겹 수. 귀할수록 깊이 묻혀 있다. */
export const LAYERS_BY_RARITY: Record<Rarity, number> = { common: 2, uncommon: 3, rare: 3, legendary: 4 };
/** 중복 조각을 고운 흙으로 바꿀 때 받는 양. */
export const DUST_FOR_DUPLICATE: Record<Rarity, number> = { common: 1, uncommon: 2, rare: 4, legendary: 10 };
/** 모자란 조각 하나를 고운 흙으로 교환하는 값. */
export const EXCHANGE_COST: Record<Rarity, number> = { common: 5, uncommon: 10, rare: 20, legendary: 50 };
/** 처음 복원했을 때 받는 고운 흙. */
export const RESTORE_BONUS: Record<Rarity, number> = { common: 3, uncommon: 6, rare: 12, legendary: 30 };

const BY_ID = new Map(VESSELS.map((v) => [v.id, v]));

export function vesselById(id: string): Vessel | undefined {
  return BY_ID.get(id);
}

/** 조각 ID: "celadon:shoulder" */
export function shardId(vesselId: string, part: Part): string {
  return `${vesselId}:${part}`;
}

export function parseShardId(id: string): { vessel: Vessel; part: Part } | undefined {
  const [v, p] = id.split(':');
  const vessel = vesselById(v);
  if (!vessel || !(PARTS as readonly string[]).includes(p)) return undefined;
  return { vessel, part: p as Part };
}

/** r ∈ [0,1)로 가중치 추첨. */
export function pickVessel(r: number, table: readonly Vessel[] = VESSELS): Vessel {
  const total = table.reduce((s, v) => s + v.weight, 0);
  let x = r * total;
  for (const v of table) {
    x -= v.weight;
    if (x < 0) return v;
  }
  return table[table.length - 1];
}

export function pickPart(r: number): Part {
  return PARTS[Math.min(PARTS.length - 1, Math.floor(r * PARTS.length))];
}

/** 도자기 완성 그림. 조각 그림은 public/pottery/<id>-<part>.png */
export function vesselImage(id: string): string {
  return `${import.meta.env.BASE_URL}pottery/${id}.png`;
}

export function shardImage(vesselId: string, part: Part): string {
  return `${import.meta.env.BASE_URL}pottery/${vesselId}-${part}.png`;
}
