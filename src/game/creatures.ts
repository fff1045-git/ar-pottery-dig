export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export interface CreatureKind {
  id: string;
  name: string;
  emoji: string;
  rarity: Rarity;
  /** 스폰 가중치. 클수록 자주 나온다. */
  weight: number;
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: '흔함',
  uncommon: '조금 드묾',
  rare: '희귀',
  legendary: '전설',
};

/** 한국 산·들 테마 생물 도감. */
export const CREATURES: readonly CreatureKind[] = [
  { id: 'sparrow', name: '참새', emoji: '🐦', rarity: 'common', weight: 30 },
  { id: 'squirrel', name: '다람쥐', emoji: '🐿️', rarity: 'common', weight: 28 },
  { id: 'butterfly', name: '나비', emoji: '🦋', rarity: 'common', weight: 24 },
  { id: 'ladybug', name: '무당벌레', emoji: '🐞', rarity: 'common', weight: 20 },
  { id: 'rabbit', name: '산토끼', emoji: '🐇', rarity: 'uncommon', weight: 12 },
  { id: 'hedgehog', name: '고슴도치', emoji: '🦔', rarity: 'uncommon', weight: 10 },
  { id: 'deer', name: '고라니', emoji: '🦌', rarity: 'rare', weight: 5 },
  { id: 'owl', name: '수리부엉이', emoji: '🦉', rarity: 'rare', weight: 4 },
  { id: 'fox', name: '여우', emoji: '🦊', rarity: 'rare', weight: 3 },
  { id: 'golden-acorn', name: '황금 도토리', emoji: '🌰', rarity: 'legendary', weight: 1 },
];

const BY_ID = new Map(CREATURES.map((c) => [c.id, c]));

export function creatureById(id: string): CreatureKind | undefined {
  return BY_ID.get(id);
}

/** r ∈ [0,1)로 가중치 추첨. */
export function pickCreature(r: number, table: readonly CreatureKind[] = CREATURES): CreatureKind {
  const total = table.reduce((s, c) => s + c.weight, 0);
  let x = r * total;
  for (const c of table) {
    x -= c.weight;
    if (x < 0) return c;
  }
  return table[table.length - 1];
}
