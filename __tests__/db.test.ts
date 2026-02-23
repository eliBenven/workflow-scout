import { describe, it, expect, afterEach } from "vitest";
import { EventStore, BrowserEvent } from "../src/db";
import path from "path";
import fs from "fs";
import os from "os";

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
  return path.join(dir, "test.db");
}

function makeEvent(overrides: Partial<BrowserEvent> = {}): BrowserEvent {
  return {
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    type: overrides.type ?? "navigation",
    url: overrides.url ?? "https://example.com",
    selector: overrides.selector,
    value: overrides.value,
    sessionId: overrides.sessionId ?? "sess_1",
    meta: overrides.meta,
  };
}

describe("EventStore", () => {
  const stores: EventStore[] = [];

  function createStore(dbPath?: string): EventStore {
    const store = new EventStore(dbPath ?? tmpDbPath());
    stores.push(store);
    return store;
  }

  afterEach(() => {
    for (const s of stores) {
      try {
        s.close();
      } catch {
        // already closed
      }
    }
    stores.length = 0;
  });

  // ── Creation ───────────────────────────────────────────────────────────────

  it("should create an EventStore with a temp file path", () => {
    const store = createStore();
    expect(store).toBeDefined();
    expect(store.getEventCount()).toBe(0);
  });

  // ── Bulk insert ────────────────────────────────────────────────────────────

  it("should bulk insert events", () => {
    const store = createStore();
    const events: BrowserEvent[] = [
      makeEvent({ url: "https://a.com" }),
      makeEvent({ url: "https://b.com" }),
      makeEvent({ url: "https://c.com" }),
    ];
    const count = store.insertMany(events);
    expect(count).toBe(3);
    expect(store.getEventCount()).toBe(3);
  });

  // ── Query by session ──────────────────────────────────────────────────────

  it("should query events by session ID", () => {
    const store = createStore();
    store.insertMany([
      makeEvent({ sessionId: "alpha", url: "https://a.com" }),
      makeEvent({ sessionId: "alpha", url: "https://b.com" }),
      makeEvent({ sessionId: "beta", url: "https://c.com" }),
    ]);

    const alphaEvents = store.getAllEvents("alpha");
    expect(alphaEvents).toHaveLength(2);
    expect(alphaEvents.every((e) => (e as any).session_id === "alpha")).toBe(true);

    const betaEvents = store.getAllEvents("beta");
    expect(betaEvents).toHaveLength(1);
  });

  // ── Query by type ─────────────────────────────────────────────────────────

  it("should store and retrieve events with different types", () => {
    const store = createStore();
    store.insertMany([
      makeEvent({ type: "navigation" }),
      makeEvent({ type: "click" }),
      makeEvent({ type: "form_submit" }),
      makeEvent({ type: "input_change" }),
    ]);

    const all = store.getAllEvents();
    expect(all).toHaveLength(4);
    const types = all.map((e) => e.type);
    expect(types).toContain("navigation");
    expect(types).toContain("click");
    expect(types).toContain("form_submit");
    expect(types).toContain("input_change");
  });

  // ── Search by URL pattern ─────────────────────────────────────────────────

  it("should search events by URL pattern", () => {
    const store = createStore();
    store.insertMany([
      makeEvent({ url: "https://example.com/login" }),
      makeEvent({ url: "https://example.com/dashboard" }),
      makeEvent({ url: "https://other.com/login" }),
    ]);

    const results = store.searchEvents("login");
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.url.includes("login"))).toBe(true);
  });

  it("should search events by selector", () => {
    const store = createStore();
    store.insertMany([
      makeEvent({ selector: "#submit-btn" }),
      makeEvent({ selector: ".nav-link" }),
    ]);

    const results = store.searchEvents("submit");
    expect(results).toHaveLength(1);
  });

  // ── Timeline ordering (chronological) ─────────────────────────────────────

  it("should return events in chronological order", () => {
    const store = createStore();
    // Insert out of order
    store.insertMany([
      makeEvent({ timestamp: "2024-01-01T03:00:00Z", url: "https://c.com" }),
      makeEvent({ timestamp: "2024-01-01T01:00:00Z", url: "https://a.com" }),
      makeEvent({ timestamp: "2024-01-01T02:00:00Z", url: "https://b.com" }),
    ]);

    const all = store.getAllEvents();
    expect(all).toHaveLength(3);
    expect(all[0].url).toBe("https://a.com");
    expect(all[1].url).toBe("https://b.com");
    expect(all[2].url).toBe("https://c.com");
  });

  // ── Sessions ──────────────────────────────────────────────────────────────

  it("should list sessions with event counts", () => {
    const store = createStore();
    store.insertMany([
      makeEvent({ sessionId: "s1", timestamp: "2024-01-01T00:00:00Z" }),
      makeEvent({ sessionId: "s1", timestamp: "2024-01-01T01:00:00Z" }),
      makeEvent({ sessionId: "s2", timestamp: "2024-01-02T00:00:00Z" }),
    ]);

    const sessions = store.getSessions();
    expect(sessions).toHaveLength(2);

    const s1 = sessions.find((s) => s.id === "s1");
    const s2 = sessions.find((s) => s.id === "s2");
    expect(s1).toBeDefined();
    expect(s1!.eventCount).toBe(2);
    expect(s2).toBeDefined();
    expect(s2!.eventCount).toBe(1);
  });

  // ── Clear ─────────────────────────────────────────────────────────────────

  it("should clear all events", () => {
    const store = createStore();
    store.insertMany([makeEvent(), makeEvent()]);
    expect(store.getEventCount()).toBe(2);
    store.clear();
    expect(store.getEventCount()).toBe(0);
  });
});
