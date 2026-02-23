import { describe, it, expect, vi } from "vitest";
import { timelineToText, printTimeline } from "../src/timeline";
import { BrowserEvent } from "../src/db";

function makeEvent(overrides: Partial<BrowserEvent> = {}): BrowserEvent {
  return {
    timestamp: overrides.timestamp ?? "2024-01-15T10:30:00Z",
    type: overrides.type ?? "navigation",
    url: overrides.url ?? "https://example.com",
    selector: overrides.selector,
    value: overrides.value,
    sessionId: overrides.sessionId ?? "sess_1",
    meta: overrides.meta,
  };
}

describe("timelineToText", () => {
  // ── Text output format ────────────────────────────────────────────────────

  it("should produce a text timeline with header and footer", () => {
    const events = [
      makeEvent({ type: "navigation", url: "https://example.com/page" }),
    ];

    const text = timelineToText(events);
    expect(text).toContain("Event Timeline (1 events)");
    expect(text).toContain("=".repeat(60));
    expect(text).toContain("navigation");
    expect(text).toContain("https://example.com/page");
  });

  it("should include event type icons in the output", () => {
    const events = [
      makeEvent({ type: "navigation" }),
      makeEvent({ type: "click", selector: "#btn" }),
      makeEvent({ type: "form_submit" }),
      makeEvent({ type: "input_change", selector: "#field" }),
    ];

    const text = timelineToText(events);
    // Icons from the source: -> ** >> ..
    expect(text).toContain("->");
    expect(text).toContain("**");
    expect(text).toContain(">>");
    expect(text).toContain("..");
  });

  it("should show correct event count in the header", () => {
    const events = [makeEvent(), makeEvent(), makeEvent()];
    const text = timelineToText(events);
    expect(text).toContain("Event Timeline (3 events)");
  });

  // ── Chronological ordering ────────────────────────────────────────────────

  it("should display events in the order they are provided", () => {
    const events = [
      makeEvent({ timestamp: "2024-01-01T08:00:00Z", url: "https://first.com" }),
      makeEvent({ timestamp: "2024-01-01T09:00:00Z", url: "https://second.com" }),
      makeEvent({ timestamp: "2024-01-01T10:00:00Z", url: "https://third.com" }),
    ];

    const text = timelineToText(events);
    const lines = text.split("\n");

    const firstIdx = lines.findIndex((l) => l.includes("first.com"));
    const secondIdx = lines.findIndex((l) => l.includes("second.com"));
    const thirdIdx = lines.findIndex((l) => l.includes("third.com"));

    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  // ── Empty event list handling ─────────────────────────────────────────────

  it("should handle empty event list with a zero count", () => {
    const text = timelineToText([]);
    expect(text).toContain("Event Timeline (0 events)");
  });

  // ── Line numbering ────────────────────────────────────────────────────────

  it("should include line numbers", () => {
    const events = [makeEvent(), makeEvent()];
    const text = timelineToText(events);
    // Lines should start with padded numbers like "   1" and "   2"
    expect(text).toContain("1");
    expect(text).toContain("2");
  });
});

describe("printTimeline", () => {
  it("should print 'No events to display.' for empty list", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printTimeline([]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No events to display.");
    spy.mockRestore();
  });

  it("should print event timeline for non-empty list", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    printTimeline([makeEvent()]);
    const output = spy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Event Timeline");
    spy.mockRestore();
  });
});
