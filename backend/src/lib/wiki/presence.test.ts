import { describe, test, expect } from "bun:test";
import {
  wikiPresence,
  type PresenceConnection,
  type PresenceSocket,
} from "./presence";

/** A fake socket that records every message it receives. */
class FakeSocket implements PresenceSocket {
  messages: any[] = [];
  send(data: string) {
    this.messages.push(JSON.parse(data));
  }
  close() {}
  /** the most recent state message pushed to this socket */
  get last() {
    return this.messages[this.messages.length - 1];
  }
}

const conn = (userId: string, name = `${userId}@x`): PresenceConnection => ({
  ws: new FakeSocket(),
  userId,
  userName: name,
});

// unique tenant/page per test so the shared singleton doesn't leak state
let counter = 0;
const ids = () => {
  counter += 1;
  return { tenantId: `t${counter}`, pageId: `p${counter}` };
};

describe("wikiPresence", () => {
  test("a fresh page is unlocked and the joiner is told so", () => {
    const { tenantId, pageId } = ids();
    const a = conn("a");
    wikiPresence.join(tenantId, pageId, a);
    expect((a.ws as FakeSocket).last).toEqual({
      type: "state",
      locked: false,
      lockedBy: null,
      youHoldLock: false,
    });
  });

  test("first acquirer wins and everyone is notified", () => {
    const { tenantId, pageId } = ids();
    const a = conn("a");
    const b = conn("b");
    wikiPresence.join(tenantId, pageId, a);
    wikiPresence.join(tenantId, pageId, b);

    expect(wikiPresence.acquire(tenantId, pageId, a)).toBe(true);

    // holder sees youHoldLock, watcher sees locked-by-a
    expect((a.ws as FakeSocket).last.youHoldLock).toBe(true);
    expect((b.ws as FakeSocket).last).toEqual({
      type: "state",
      locked: true,
      lockedBy: { userId: "a", name: "a@x" },
      youHoldLock: false,
    });
  });

  test("a second client cannot acquire a held lock", () => {
    const { tenantId, pageId } = ids();
    const a = conn("a");
    const b = conn("b");
    wikiPresence.join(tenantId, pageId, a);
    wikiPresence.join(tenantId, pageId, b);
    wikiPresence.acquire(tenantId, pageId, a);

    expect(wikiPresence.acquire(tenantId, pageId, b)).toBe(false);
    expect((b.ws as FakeSocket).last.youHoldLock).toBe(false);
    expect((b.ws as FakeSocket).last.lockedBy).toEqual({
      userId: "a",
      name: "a@x",
    });
  });

  test("releasing frees the lock for the next client", () => {
    const { tenantId, pageId } = ids();
    const a = conn("a");
    const b = conn("b");
    wikiPresence.join(tenantId, pageId, a);
    wikiPresence.join(tenantId, pageId, b);
    wikiPresence.acquire(tenantId, pageId, a);

    wikiPresence.release(tenantId, pageId, a);
    expect((b.ws as FakeSocket).last.locked).toBe(false);

    expect(wikiPresence.acquire(tenantId, pageId, b)).toBe(true);
    expect((b.ws as FakeSocket).last.youHoldLock).toBe(true);
  });

  test("holder disconnecting frees the lock and notifies watchers", () => {
    const { tenantId, pageId } = ids();
    const a = conn("a");
    const b = conn("b");
    wikiPresence.join(tenantId, pageId, a);
    wikiPresence.join(tenantId, pageId, b);
    wikiPresence.acquire(tenantId, pageId, a);

    wikiPresence.leave(tenantId, pageId, a);
    expect((b.ws as FakeSocket).last.locked).toBe(false);
    expect(wikiPresence.acquire(tenantId, pageId, b)).toBe(true);
  });

  test("re-acquiring while already holding stays locked to the holder", () => {
    const { tenantId, pageId } = ids();
    const a = conn("a");
    wikiPresence.join(tenantId, pageId, a);
    expect(wikiPresence.acquire(tenantId, pageId, a)).toBe(true);
    expect(wikiPresence.acquire(tenantId, pageId, a)).toBe(true);
    expect((a.ws as FakeSocket).last.youHoldLock).toBe(true);
  });
});
