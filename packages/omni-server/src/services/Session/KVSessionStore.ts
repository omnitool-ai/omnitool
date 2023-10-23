/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { type SessionStore } from '@fastify/session';
import { type KVStorage } from 'core/KVStorage';
import { type Session } from 'fastify';

class KVSessionStore implements SessionStore {
  private readonly _kvStorage: KVStorage;
  private readonly expirationCallbacks: Map<string, NodeJS.Timeout>;
  private readonly onExpiration?: (sid: string, userId: string) => void;
  private readonly onDestroy?: (sid: string, userId: string) => void;

  constructor(
    kvStorage: KVStorage,
    onExpiration?: (sid: string, userId: string) => void,
    onDestroy?: (sid: string, userId: string) => void
  ) {
    this.expirationCallbacks = new Map();
    this.onExpiration = onExpiration;
    this.onDestroy = onDestroy;
    if (onDestroy == null) this.onDestroy = onExpiration;
    this._kvStorage = kvStorage;
  }

  async get(sid: string, callback: (err?: Error, session?: Session) => void): Promise<void> {
    const session = this._kvStorage.get(sid) as Session;
    callback(undefined, session);
  }

  set(sid: string, session: Session, callback: (err?: Error) => void): void {
    const ttl = this.getTTL(session);
    const expiresAt = Date.now() + ttl;

    // Set up the expiration callback
    const timer = setTimeout(() => {
      // @ts-ignore
      if (this.onExpiration != null) this.onExpiration(sid, session.get('userId'));
      this.expirationCallbacks.delete(sid);
    }, ttl);

    // Store the timer ID in a map for later cleanup
    this.expirationCallbacks.set(sid, timer);

    this._kvStorage.set(sid, session);
    callback();
  }

  // Override the destroy method to clear the expiration callback
  destroy(sid: string, callback: (err?: Error) => void): void {
    const timer = this.expirationCallbacks.get(sid);
    if (timer != null) {
      clearTimeout(timer);
      this.expirationCallbacks.delete(sid);
    }

    const session = this._kvStorage.get(sid);
    // @ts-ignore
    const userId = session?.userId;

    if (this.onDestroy != null) this.onDestroy(sid, userId);

    this._kvStorage.del(sid);
    callback();
  }

  // Method to calculate the TTL based on session.maxAge or default maxAge
  getTTL(session: Session): number {
    if (session && session.cookie && session.cookie.maxAge) {
      return session.cookie.maxAge;
    }
    return 30 * 24 * 60 * 60 * 1000; // 30 days (default value)
  }
}

export { KVSessionStore };
