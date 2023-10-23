/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type KVStorage } from './KVStorage.js';
import { type IStorageAdapter } from 'omni-shared';

class StorageAdapter<T> implements IStorageAdapter<T> {
  private backingStorage: Map<string, T> | KVStorage;
  private readonly keyPrefix: string;
  private readonly expiry: number | undefined;

  constructor(keyPrefix?: string, backingStorage?: Map<string, any> | KVStorage, expiry?: number) {
    this.backingStorage = backingStorage ?? new Map<string, T>();
    this.expiry = expiry;
    this.keyPrefix = keyPrefix ?? '';
  }

  bindStorage(backingStorage: Map<string, T> | KVStorage) {
    this.backingStorage = backingStorage;
  }

  delete(key: string): void {
    if (this.has(key)) {
      if (this.backingStorage instanceof Map) {
        this.backingStorage.delete(this.keyPrefix + key);
      } else {
        this.backingStorage.del(this.keyPrefix + key);
      }
    }
  }

  get(key: string): T {
    return this.backingStorage.get(this.keyPrefix + key);
  }

  set(key: string, value: T, expiry?: number): void {
    if (this.backingStorage instanceof Map) {
      this.backingStorage.set(
        this.keyPrefix + key,
        value
      ); /*Expiry not implemented but shouldn't matter as we can just manually flush the cache*/
    } else {
      this.backingStorage.set(this.keyPrefix + key, value, expiry || this.expiry);
    }
  }

  // Wipe the storage
  clear(
    doubleConfirm: 'Yes I want to wipe the storage even though I have not set a key prefix and it will wipe any other storage on the same KVStorage'
  ) {
    if (this.backingStorage instanceof Map) {
      this.backingStorage.clear();
    } else {
      if (this.keyPrefix.length > 0) {
        this.backingStorage.delAny(this.keyPrefix);
      } else if (
        doubleConfirm ===
        'Yes I want to wipe the storage even though I have not set a key prefix and it will wipe any other storage on the same KVStorage'
      ) {
        this.backingStorage.clear();
      }
    }
  }

  clearWithPrefix() {
    if (!this.keyPrefix) {
      throw new Error('No key prefix set. Use clear() method if you intend to wipe the entire storage.');
    }

    if (this.backingStorage instanceof Map) {
      // Delete only keys with the specified prefix from the Map
      for (const key of this.backingStorage.keys()) {
        if (key.startsWith(this.keyPrefix)) {
          this.backingStorage.delete(key);
        }
      }
    } else {
      // Delete only keys with the specified prefix from the KVStorage
      this.backingStorage.delAny(this.keyPrefix);
    }
  }

  values(): IterableIterator<T> {
    // TODO: Can we call this.entries() instead?
    if (this.backingStorage instanceof Map) {
      // TODO: BUG, need to filter keys by `this.keyPrefix`
      return this.backingStorage.values();
    }
    if (this.keyPrefix) {
      return this.backingStorage
        .getAny(this.keyPrefix)
        .map((r) => r?.value)
        [Symbol.iterator]();
    }
    return this.backingStorage
      .getAll()
      .map((r) => r?.value)
      [Symbol.iterator]();
  }

  keys(): IterableIterator<string> {
    // TODO: Can we call this.entries() instead?
    if (this.backingStorage instanceof Map) {
      // TODO: BUG, need to filter by `this.keyPrefix`
      return this.backingStorage.keys();
    }
    if (this.keyPrefix) {
      return this.backingStorage
        .getAny(this.keyPrefix)
        .map((r) => r?.key.substring(0, this.keyPrefix.length))
        [Symbol.iterator]();
    }
    return this.backingStorage
      .getAll()
      .map((r) => r?.key)
      [Symbol.iterator]();
  }

  entries(): IterableIterator<[string, T]> {
    if (this.backingStorage instanceof Map) {
      // TODO: BUG, need to filter keys by `this.keyPrefix`
      return this.backingStorage.entries();
    }
    if (this.keyPrefix) {
      return (
        this.backingStorage
          .getAny(this.keyPrefix)
          .map((r) => [r?.key.substring(0, this.keyPrefix.length), r?.value]) as [string, T][]
      )[Symbol.iterator]();
    }
    return (this.backingStorage.getAll().map((r) => [r?.key, r?.value]) as [string, T][])[Symbol.iterator]();
  }

  has(key: string): boolean {
    if (this.backingStorage instanceof Map) {
      return this.backingStorage.has(this.keyPrefix + key);
    }
    // TODO: BUG: What if the value associated with `key` is actually null?
    return this.get(key) != null;
  }

  search(
    limit: number,
    cursor: number,
    keySearch?: string,
    contentSearch?: string,
    tags?: string,
    view?: string
  ): IterableIterator<[string, T, number]> | undefined {
    if (this.backingStorage instanceof Map) {
      function* convertToIterator(map: Map<string, T>): IterableIterator<[string, T, number]> {
        for (const [key, value] of map.entries()) {
          yield [key, value, -1];
        }
      }
      return convertToIterator(this.backingStorage);
    }
    if (this.keyPrefix || view) {
      function* convertToIterator<T>(
        data: Array<{ key: string; value: T; seq: number }>
      ): IterableIterator<[string, T, number]> {
        for (const item of data) {
          yield [item.key, item.value, item.seq];
        }
      }
      const result = this.backingStorage.getAny(this.keyPrefix, undefined, {
        contentMatch: contentSearch,
        sort: 'seq',
        tags,
        limit,
        cursor,
        view
      });
      return convertToIterator(result);
    }
  }
}

export { StorageAdapter };
