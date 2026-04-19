import type { StorageAdapter as CoreStorageAdapter } from "@mdreview/core";

/**
 * Minimal surface matching the subset of `localStorage` used by
 * {@link T3StorageAdapter}. Tests inject an in-memory implementation so we
 * don't need jsdom.
 */
export interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface T3StorageAdapterOptions {
  readonly backing: LocalStorageLike;
  /**
   * Prefix applied to all keys. Defaults to `"t3code:mdreview:"`; the local
   * store adds an extra `local:` segment to isolate it from sync keys.
   */
  readonly namespace?: string;
}

const DEFAULT_NAMESPACE = "t3code:mdreview:";
const LOCAL_SEGMENT = "local:";

const toKeyList = (keys: string | string[]): string[] =>
  Array.isArray(keys) ? keys : [keys];

const decode = (raw: string | null): unknown => {
  if (raw === null) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * t3code-native implementation of `@mdreview/core`'s
 * {@link CoreStorageAdapter}. Values are JSON-encoded and keys are namespaced
 * under `t3code:mdreview:` so they never collide with other localStorage
 * consumers in the web app.
 */
export class T3StorageAdapter implements CoreStorageAdapter {
  private readonly backing: LocalStorageLike;
  private readonly syncPrefix: string;
  private readonly localPrefix: string;

  constructor(options: T3StorageAdapterOptions) {
    this.backing = options.backing;
    const ns = options.namespace ?? DEFAULT_NAMESPACE;
    this.syncPrefix = ns;
    this.localPrefix = `${ns}${LOCAL_SEGMENT}`;
  }

  async getSync(keys: string | string[]): Promise<Record<string, unknown>> {
    return this.readMany(this.syncPrefix, toKeyList(keys));
  }

  async setSync(data: Record<string, unknown>): Promise<void> {
    this.writeMany(this.syncPrefix, data);
  }

  async getLocal(keys: string | string[]): Promise<Record<string, unknown>> {
    return this.readMany(this.localPrefix, toKeyList(keys));
  }

  async setLocal(data: Record<string, unknown>): Promise<void> {
    this.writeMany(this.localPrefix, data);
  }

  private readMany(
    prefix: string,
    keys: string[],
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const raw = this.backing.getItem(`${prefix}${key}`);
      const value = decode(raw);
      if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }

  private writeMany(prefix: string, data: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) {
        this.backing.removeItem(`${prefix}${key}`);
      } else {
        this.backing.setItem(`${prefix}${key}`, JSON.stringify(value));
      }
    }
  }
}
