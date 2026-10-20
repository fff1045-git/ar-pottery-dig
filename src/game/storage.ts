export const SAVE_VERSION = 1;

export interface SaveData {
  version: typeof SAVE_VERSION;
  /** 생물 종류별 보유 수. */
  inventory: Record<string, number>;
  /** 잡은 스폰 ID → 만료 시각. 만료된 항목은 불러올 때 정리한다. */
  caught: Record<string, number>;
  /** 종류별 처음 잡은 시각 (도감). */
  firstCaughtAt: Record<string, number>;
  totalCaught: number;
  /** 마지막으로 알던 위치. GPS를 못 받을 때 지도 시작점으로 쓴다. */
  lastKnown?: { lat: number; lng: number; at: number };
}

export function emptySave(): SaveData {
  return { version: SAVE_VERSION, inventory: {}, caught: {}, firstCaughtAt: {}, totalCaught: 0 };
}

/** 저장소 추상화. 지금은 localStorage, 나중에 서버로 바꿀 수 있다. */
export interface SaveStore {
  load(): SaveData | null;
  save(data: SaveData): void;
  clear(): void;
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class LocalStorageStore implements SaveStore {
  constructor(
    private readonly key = 'ar-pottery-dig/save',
    private readonly storage: KeyValueStorage | undefined = globalThis.localStorage,
  ) {}

  load(): SaveData | null {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return null;
      const data = JSON.parse(raw) as Partial<SaveData>;
      if (data.version !== SAVE_VERSION) return null;
      return { ...emptySave(), ...data } as SaveData;
    } catch {
      // 사생활 보호 모드, 손상된 JSON 등 → 새 게임으로 시작
      return null;
    }
  }

  save(data: SaveData): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(data));
    } catch {
      // 용량 초과·차단 시 저장만 건너뛴다. 게임은 계속.
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* 무시 */
    }
  }
}

export class MemoryStore implements SaveStore {
  private data: SaveData | null = null;
  load() {
    return this.data ? structuredClone(this.data) : null;
  }
  save(data: SaveData) {
    this.data = structuredClone(data);
  }
  clear() {
    this.data = null;
  }
}
