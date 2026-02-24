import { describe, it, expect } from "vitest";
import { detectPatterns, DetectedPattern } from "../src/pattern-detector";
import { BrowserEvent } from "../src/db";

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

/**
 * Build a repeated sequence: navigate -> click -> form_submit
 * repeated `times` times on the same set of URLs.
 */
function buildRepeatedSequence(times: number): BrowserEvent[] {
  const events: BrowserEvent[] = [];
  for (let i = 0; i < times; i++) {
    events.push(
      makeEvent({
        type: "navigation",
        url: "https://app.com/page",
        timestamp: `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
      }),
      makeEvent({
        type: "click",
        url: "https://app.com/page",
        selector: "#btn",
        timestamp: `2024-01-01T${String(i).padStart(2, "0")}:01:00Z`,
      }),
      makeEvent({
        type: "form_submit",
        url: "https://app.com/page",
        timestamp: `2024-01-01T${String(i).padStart(2, "0")}:02:00Z`,
      })
    );
  }
  return events;
}

describe("detectPatterns", () => {
  // ── Clear repeated sequences ──────────────────────────────────────────────

  it("should find a pattern when a sequence is repeated 3 times", () => {
    const events = buildRepeatedSequence(3);
    const patterns = detectPatterns(events, { minFrequency: 2, minLength: 2 });

    expect(patterns.length).toBeGreaterThanOrEqual(1);

    // The best pattern should include the navigate->click->submit sequence
    const best = patterns[0];
    expect(best.frequency).toBeGreaterThanOrEqual(2);
    expect(best.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("should report correct frequency for repeated patterns", () => {
    const events = buildRepeatedSequence(4);
    const patterns = detectPatterns(events, { minFrequency: 2, minLength: 3 });

    // There should be a 3-step pattern with frequency >= 3 (non-overlapping)
    const threeStepPatterns = patterns.filter((p) => p.steps.length === 3);
    expect(threeStepPatterns.length).toBeGreaterThanOrEqual(1);
    expect(threeStepPatterns[0].frequency).toBeGreaterThanOrEqual(3);
  });

  // ── Minimum length filtering ──────────────────────────────────────────────

  it("should respect minLength filtering", () => {
    const events = buildRepeatedSequence(3);

    // With minLength=4, the 3-step pattern should NOT appear
    const patterns = detectPatterns(events, { minLength: 4, minFrequency: 2 });
    const threeStepPatterns = patterns.filter((p) => p.steps.length === 3);
    expect(threeStepPatterns).toHaveLength(0);
  });

  // ── No patterns ───────────────────────────────────────────────────────────

  it("should return empty array when all events are unique", () => {
    const events: BrowserEvent[] = [
      makeEvent({ type: "navigation", url: "https://a.com", timestamp: "2024-01-01T01:00:00Z" }),
      makeEvent({ type: "click", url: "https://b.com", timestamp: "2024-01-01T02:00:00Z" }),
      makeEvent({ type: "form_submit", url: "https://c.com", timestamp: "2024-01-01T03:00:00Z" }),
      makeEvent({ type: "input_change", url: "https://d.com", timestamp: "2024-01-01T04:00:00Z" }),
    ];

    const patterns = detectPatterns(events, { minFrequency: 2 });
    expect(patterns).toHaveLength(0);
  });

  // ── URL normalization ─────────────────────────────────────────────────────

  it("should normalize numeric URL segments to :id", () => {
    // Two sequences visiting /users/123/profile and /users/456/profile
    // should be treated as the same pattern because 123 and 456 are :id
    const events: BrowserEvent[] = [
      makeEvent({ type: "navigation", url: "https://app.com/users/123/profile", timestamp: "2024-01-01T01:00:00Z" }),
      makeEvent({ type: "click", url: "https://app.com/users/123/profile", selector: "#edit", timestamp: "2024-01-01T01:01:00Z" }),
      makeEvent({ type: "navigation", url: "https://app.com/users/456/profile", timestamp: "2024-01-01T02:00:00Z" }),
      makeEvent({ type: "click", url: "https://app.com/users/456/profile", selector: "#edit", timestamp: "2024-01-01T02:01:00Z" }),
    ];

    const patterns = detectPatterns(events, { minFrequency: 2, minLength: 2 });
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    // The pattern steps should use :id, not specific numbers
    const nav = patterns[0].steps.find((s) => s.type === "navigation");
    expect(nav).toBeDefined();
    expect(nav!.urlPattern).toContain(":id");
  });

  // ── Pattern structure ─────────────────────────────────────────────────────

  it("should include label, id, confidence, and occurrences", () => {
    const events = buildRepeatedSequence(3);
    const patterns = detectPatterns(events, { minFrequency: 2, minLength: 2 });

    const pat = patterns[0];
    expect(pat.id).toMatch(/^pat_\d+$/);
    expect(pat.label).toBeTruthy();
    expect(pat.confidence).toBeGreaterThan(0);
    expect(pat.confidence).toBeLessThanOrEqual(1);
    expect(pat.occurrences.length).toBe(pat.frequency);
    // Each occurrence should be an array of indexes
    for (const occ of pat.occurrences) {
      expect(Array.isArray(occ)).toBe(true);
      expect(occ.length).toBe(pat.steps.length);
    }
  });

  // ── Empty input ───────────────────────────────────────────────────────────

  it("should return empty array for empty input", () => {
    const patterns = detectPatterns([]);
    expect(patterns).toHaveLength(0);
  });

  // ── api_call events ─────────────────────────────────────────────────────

  it("should detect repeated api_call patterns", () => {
    const events: BrowserEvent[] = [];
    for (let i = 0; i < 3; i++) {
      events.push(
        makeEvent({
          type: "navigation",
          url: "https://app.com/dashboard",
          timestamp: `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
        }),
        makeEvent({
          type: "api_call",
          url: "https://api.app.com/v1/users",
          timestamp: `2024-01-01T${String(i).padStart(2, "0")}:00:01Z`,
          meta: JSON.stringify({
            method: "GET",
            statusCode: 200,
            requestHeaders: { "content-type": "application/json" },
            responseContentType: "application/json",
          }),
        }),
        makeEvent({
          type: "api_call",
          url: "https://api.app.com/v1/reports",
          timestamp: `2024-01-01T${String(i).padStart(2, "0")}:00:02Z`,
          meta: JSON.stringify({
            method: "POST",
            statusCode: 201,
            requestHeaders: { "content-type": "application/json", "authorization": "[REDACTED]" },
            requestBody: '{"name":"Weekly Report","type":"summary"}',
            responseContentType: "application/json",
          }),
        })
      );
    }

    const patterns = detectPatterns(events, { minFrequency: 2, minLength: 2 });
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    // Should find the api_call steps
    const best = patterns[0];
    const apiSteps = best.steps.filter((s) => s.type === "api_call");
    expect(apiSteps.length).toBeGreaterThanOrEqual(1);
  });

  it("should distinguish GET and POST api_calls to the same URL", () => {
    const events: BrowserEvent[] = [];
    for (let i = 0; i < 3; i++) {
      events.push(
        makeEvent({
          type: "api_call",
          url: "https://api.app.com/v1/data",
          timestamp: `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
          meta: JSON.stringify({ method: "GET" }),
        }),
        makeEvent({
          type: "api_call",
          url: "https://api.app.com/v1/data",
          timestamp: `2024-01-01T${String(i).padStart(2, "0")}:00:01Z`,
          meta: JSON.stringify({ method: "POST", requestBody: '{"key":"value"}' }),
        })
      );
    }

    const patterns = detectPatterns(events, { minFrequency: 2, minLength: 2 });
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    // The pattern should preserve the method distinction
    const best = patterns[0];
    expect(best.steps.length).toBe(2);
    expect(best.steps[0].description).toContain("GET");
    expect(best.steps[1].description).toContain("POST");
  });

  it("should propagate api_call metadata (headers, body, status) to PatternStep", () => {
    const events: BrowserEvent[] = [];
    for (let i = 0; i < 2; i++) {
      events.push(
        makeEvent({
          type: "api_call",
          url: "https://api.example.com/submit",
          timestamp: `2024-01-01T${String(i).padStart(2, "0")}:00:00Z`,
          meta: JSON.stringify({
            method: "POST",
            statusCode: 201,
            requestHeaders: { "content-type": "application/json", "authorization": "[REDACTED]" },
            requestBody: '{"name":"test","token":"[REDACTED]"}',
            responseContentType: "application/json",
          }),
        })
      );
    }

    const patterns = detectPatterns(events, { minFrequency: 2, minLength: 1 });
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    const step = patterns[0].steps[0];
    expect(step.type).toBe("api_call");
    expect(step.httpMethod).toBe("POST");
    expect(step.statusCode).toBe(201);
    expect(step.requestHeaders).toBeDefined();
    expect(step.requestHeaders!["authorization"]).toBe("[REDACTED]");
    expect(step.requestBody).toBe('{"name":"test","token":"[REDACTED]"}');
    expect(step.responseContentType).toBe("application/json");
  });
});
