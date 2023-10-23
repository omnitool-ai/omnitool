/**
 * Copyright (c) 2023 MERCENARIES.AI PTE. LTD.
 * All rights reserved.
 */

import { MemoryStore } from '@fastify/session';
import { type Session } from 'fastify';

class CustomMemoryStore extends MemoryStore {
  private readonly sessions: Map<string, Session>;
  private readonly expirationCallbacks: Map<string, NodeJS.Timeout>;
  private readonly onExpiration?: (sid: string, userId: string) => void;
  private readonly onDestroy?: (sid: string, userId: string) => void;

  constructor(onExpiration?: (sid: string, userId: string) => void, onDestroy?: (sid: string, userId: string) => void) {
    super();
    this.expirationCallbacks = new Map();
    this.onExpiration = onExpiration;
    this.onDestroy = onDestroy;
    if (onDestroy == null) this.onDestroy = onExpiration;
    this.sessions = new Map();
  }

  async get(sid: string, callback: (err?: Error, session?: Session) => void): Promise<void> {
    const session = this.sessions.get(sid);
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

    // Call the original set method
    // super.set(sid, session, callback);
    this.sessions.set(sid, session);
    callback();
  }

  // Override the destroy method to clear the expiration callback
  destroy(sid: string, callback: (err?: Error) => void): void {
    const timer = this.expirationCallbacks.get(sid);
    if (timer != null) {
      clearTimeout(timer);
      this.expirationCallbacks.delete(sid);
    }

    const session = this.sessions.get(sid);
    // @ts-ignore
    const userId = session?.userId;

    if (this.onDestroy != null) this.onDestroy(sid, userId);

    // Call the original destroy method
    // super.destroy(sid, callback);
    this.sessions.delete(sid);
    callback();
  }

  // Method to calculate the TTL based on session.maxAge or default maxAge
  getTTL(session: Session): number {
    if (session && session.cookie && session.cookie.maxAge) {
      return session.cookie.maxAge;
    }
    return 30 * 24 * 60 * 60 * 1000; // 30 days (default value)
  }

  // Invalidate all sessions
  invalidateAll(callback: (err?: Error) => void): void {
    // Clear all expiration callbacks
    for (const timer of this.expirationCallbacks.values()) {
      clearTimeout(timer);
    }
    this.expirationCallbacks.clear();

    // Iterate over the sessions and destroy each one
    for (const sid of this.sessions.keys()) {
      const session = this.sessions.get(sid);
      // @ts-ignore
      session.destroy();
    }

    // Execute the provided callback
    callback();
  }
}

export { CustomMemoryStore };
