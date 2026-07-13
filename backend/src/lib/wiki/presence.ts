/**
 * Wiki page presence & edit locking (in-memory).
 *
 * A single lightweight registry that tracks, per page, which connected clients
 * are currently viewing it and which one (if any) holds the *edit lock*. Only
 * the lock holder may edit a page; everyone else sees it read-only. This is the
 * server side of the "two people must not edit the same document at once"
 * guarantee — it prevents concurrent editors from overwriting each other on
 * save.
 *
 * The model is deliberately simple:
 *   - State lives in process memory (the app runs as a single Bun process).
 *   - The first client to `acquire` a free page becomes the holder.
 *   - When the holder disconnects (tab close, navigation, idle timeout) or
 *     explicitly `release`s, the lock frees up and the page becomes editable
 *     for the next client that asks.
 *
 * Every state change is broadcast to all clients subscribed to that page, so
 * viewers immediately learn when a page becomes locked or free again.
 *
 * The realtime transport is a WebSocket (see the `/wiki/:pageId/presence`
 * route); this module is transport-agnostic and only needs a `send`-capable
 * socket handle.
 */

/** Minimal structural type for a WebSocket we can send text to / close. */
export interface PresenceSocket {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface PresenceConnection {
  ws: PresenceSocket;
  userId: string;
  /** display name shown to other users (e.g. the user's email) */
  userName: string;
}

interface PagePresence {
  /** the connection currently holding the edit lock, if any */
  holder: PresenceConnection | null;
  /** all connections currently subscribed to this page */
  connections: Set<PresenceConnection>;
}

/** Message pushed to a client describing the current lock state of its page. */
interface StateMessage {
  type: "state";
  /** whether some client currently holds the edit lock */
  locked: boolean;
  /** who holds the lock (null when free) */
  lockedBy: { userId: string; name: string } | null;
  /** whether *this* client is the lock holder */
  youHoldLock: boolean;
}

class WikiPresenceRegistry {
  /** keyed by `${tenantId}:${pageId}` */
  private readonly pages = new Map<string, PagePresence>();

  private key(tenantId: string, pageId: string): string {
    return `${tenantId}:${pageId}`;
  }

  private stateFor(
    page: PagePresence,
    conn: PresenceConnection,
  ): StateMessage {
    const holder = page.holder;
    return {
      type: "state",
      locked: holder !== null,
      lockedBy: holder ? { userId: holder.userId, name: holder.userName } : null,
      youHoldLock: holder === conn,
    };
  }

  /** Push the current state to every connection subscribed to the page. */
  private broadcast(page: PagePresence): void {
    for (const conn of page.connections) {
      try {
        conn.ws.send(JSON.stringify(this.stateFor(page, conn)));
      } catch {
        // socket already gone — it will be cleaned up on its close event
      }
    }
  }

  /** Register a new client for a page and send it the current state. */
  join(
    tenantId: string,
    pageId: string,
    conn: PresenceConnection,
  ): void {
    const key = this.key(tenantId, pageId);
    let page = this.pages.get(key);
    if (!page) {
      page = { holder: null, connections: new Set() };
      this.pages.set(key, page);
    }
    page.connections.add(conn);
    // only the joiner needs the current state; nothing changed for others
    try {
      conn.ws.send(JSON.stringify(this.stateFor(page, conn)));
    } catch {
      /* noop */
    }
  }

  /**
   * Try to take the edit lock for a page. Returns true if this connection now
   * holds it (either it just took a free lock or it already held it).
   */
  acquire(
    tenantId: string,
    pageId: string,
    conn: PresenceConnection,
  ): boolean {
    const page = this.pages.get(this.key(tenantId, pageId));
    if (!page) return false;
    if (page.holder && page.holder !== conn) {
      // already locked by someone else — re-send the state so the client's
      // view stays correct, then refuse.
      try {
        conn.ws.send(JSON.stringify(this.stateFor(page, conn)));
      } catch {
        /* noop */
      }
      return false;
    }
    page.holder = conn;
    this.broadcast(page);
    return true;
  }

  /** Release the lock if this connection holds it. */
  release(
    tenantId: string,
    pageId: string,
    conn: PresenceConnection,
  ): void {
    const page = this.pages.get(this.key(tenantId, pageId));
    if (!page) return;
    if (page.holder === conn) {
      page.holder = null;
      this.broadcast(page);
    }
  }

  /** Remove a disconnected client; frees the lock if it was the holder. */
  leave(
    tenantId: string,
    pageId: string,
    conn: PresenceConnection,
  ): void {
    const key = this.key(tenantId, pageId);
    const page = this.pages.get(key);
    if (!page) return;
    page.connections.delete(conn);
    const wasHolder = page.holder === conn;
    if (wasHolder) page.holder = null;
    if (page.connections.size === 0) {
      // nobody left — drop the page entry entirely
      this.pages.delete(key);
      return;
    }
    if (wasHolder) this.broadcast(page);
  }
}

/** App-wide singleton presence registry. */
export const wikiPresence = new WikiPresenceRegistry();
