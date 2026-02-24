/**
 * Workflow Scout — End-to-end Integration Test
 *
 * Tests the full pipeline: import events -> analyze patterns -> export workflow.
 * This ensures all modules work together correctly.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { EventStore, BrowserEvent } from "../src/db";
import { detectPatterns, autoTuneAndDetect } from "../src/pattern-detector";
import { exportToN8n, exportToN8nJson } from "../src/n8n-exporter";
import { exportToPlaywright } from "../src/playwright-exporter";
import { exportToZapierJson } from "../src/zapier-exporter";
import { timelineToText } from "../src/timeline";

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ws-e2e-"));
  return path.join(dir, "test.db");
}

/**
 * Simulate a realistic browsing session with repeated workflow:
 *   1. Navigate to login page
 *   2. Fill in username
 *   3. Submit login form
 *   4. Navigate to dashboard
 *
 * Repeat this 3 times to create a detectable pattern.
 */
function buildRealisticSession(): BrowserEvent[] {
  const events: BrowserEvent[] = [];
  const baseTime = new Date("2024-06-15T09:00:00Z");

  for (let rep = 0; rep < 3; rep++) {
    const offset = rep * 4;

    events.push({
      timestamp: new Date(baseTime.getTime() + (offset + 0) * 60_000).toISOString(),
      type: "navigation",
      url: "https://app.example.com/login",
      sessionId: "e2e_session",
    });

    events.push({
      timestamp: new Date(baseTime.getTime() + (offset + 1) * 60_000).toISOString(),
      type: "input_change",
      url: "https://app.example.com/login",
      selector: "input#username",
      value: "testuser",
      sessionId: "e2e_session",
    });

    events.push({
      timestamp: new Date(baseTime.getTime() + (offset + 2) * 60_000).toISOString(),
      type: "form_submit",
      url: "https://app.example.com/login",
      selector: "form#login-form",
      sessionId: "e2e_session",
      meta: JSON.stringify({
        fields: { username: "testuser", password: "[REDACTED]" },
        method: "POST",
        action: "https://app.example.com/login",
      }),
    });

    events.push({
      timestamp: new Date(baseTime.getTime() + (offset + 3) * 60_000).toISOString(),
      type: "navigation",
      url: "https://app.example.com/dashboard",
      sessionId: "e2e_session",
    });
  }

  return events;
}

describe("End-to-end pipeline", () => {
  const stores: EventStore[] = [];

  function createStore(): EventStore {
    const store = new EventStore(tmpDbPath());
    stores.push(store);
    return store;
  }

  afterEach(() => {
    for (const s of stores) {
      try { s.close(); } catch { /* already closed */ }
    }
    stores.length = 0;
  });

  it("should complete the full import -> analyze -> export pipeline", () => {
    const store = createStore();
    const events = buildRealisticSession();

    // 1. Import
    const count = store.insertMany(events);
    expect(count).toBe(12); // 4 events * 3 reps

    // 2. Retrieve and verify
    const stored = store.getAllEvents("e2e_session");
    expect(stored).toHaveLength(12);

    // 3. Verify sessions
    const sessions = store.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("e2e_session");
    expect(sessions[0].eventCount).toBe(12);

    // 4. Analyze patterns
    const patterns = detectPatterns(stored, { minLength: 2, minFrequency: 2 });
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    const best = patterns[0];
    expect(best.frequency).toBeGreaterThanOrEqual(2);
    expect(best.steps.length).toBeGreaterThanOrEqual(2);

    // 5. Export to n8n
    const n8nWorkflow = exportToN8n(best);
    expect(n8nWorkflow.name).toContain("Workflow Scout");
    expect(n8nWorkflow.nodes.length).toBeGreaterThan(1);

    // Verify n8n JSON is parseable
    const n8nJson = exportToN8nJson(best);
    expect(() => JSON.parse(n8nJson)).not.toThrow();

    // 6. Export to Playwright
    const playwrightScript = exportToPlaywright(best);
    expect(playwrightScript).toContain("import {");
    expect(playwrightScript).toContain("page.goto");

    // 7. Export to Zapier
    const zapierJson = exportToZapierJson(best);
    const zapier = JSON.parse(zapierJson);
    expect(zapier.actions.length).toBeGreaterThan(0);

    // 8. Timeline
    const timeline = timelineToText(stored);
    expect(timeline).toContain("Event Timeline (12 events)");
  });

  it("should propagate form field metadata through the pipeline", () => {
    const store = createStore();
    const events = buildRealisticSession();
    store.insertMany(events);

    const stored = store.getAllEvents("e2e_session");
    const patterns = detectPatterns(stored, { minLength: 3, minFrequency: 2 });

    // Find a pattern that includes the form_submit step
    const patWithForm = patterns.find((p) =>
      p.steps.some((s) => s.type === "form_submit")
    );

    if (patWithForm) {
      const formStep = patWithForm.steps.find((s) => s.type === "form_submit")!;
      // Form fields should be propagated from the event metadata
      expect(formStep.formFields).toBeDefined();
      expect(formStep.formFields!.username).toBe("testuser");
      expect(formStep.formFields!.password).toBe("[REDACTED]");
      expect(formStep.httpMethod).toBe("POST");

      // Export to n8n and verify form fields are used
      const workflow = exportToN8n(patWithForm);
      const httpNodes = workflow.nodes.filter(
        (n) => n.type === "n8n-nodes-base.httpRequest"
      );
      const postNode = httpNodes.find((n) => n.parameters.method === "POST");
      if (postNode) {
        expect(postNode.parameters.sendBody).toBe(true);
        const bodyParams = postNode.parameters.bodyParameters as {
          parameters: { name: string; value: string }[];
        };
        const usernameField = bodyParams.parameters.find((p) => p.name === "username");
        expect(usernameField).toBeDefined();
        expect(usernameField!.value).toBe("testuser");
      }
    }
  });

  it("should handle auto-tune detection", () => {
    const store = createStore();
    const events = buildRealisticSession();
    store.insertMany(events);

    const stored = store.getAllEvents("e2e_session");
    const patterns = autoTuneAndDetect(stored);

    // Auto-tune should find at least one pattern
    expect(patterns.length).toBeGreaterThanOrEqual(1);
  });

  it("should support session tagging", () => {
    const store = createStore();
    const events = buildRealisticSession();
    store.insertMany(events);

    // Tag the session
    store.addSessionTag("e2e_session", "login-flow");
    store.addSessionTag("e2e_session", "automated");

    // Retrieve tags
    const tags = store.getSessionTags("e2e_session");
    expect(tags).toContain("login-flow");
    expect(tags).toContain("automated");

    // Query by tag
    const tagged = store.getSessionsByTag("login-flow");
    expect(tagged).toHaveLength(1);
    expect(tagged[0].id).toBe("e2e_session");

    // Remove tag
    store.removeSessionTag("e2e_session", "automated");
    const updatedTags = store.getSessionTags("e2e_session");
    expect(updatedTags).not.toContain("automated");
    expect(updatedTags).toContain("login-flow");
  });

  it("should respect search limits", () => {
    const store = createStore();
    const events = buildRealisticSession();
    store.insertMany(events);

    // Search with limit
    const limited = store.searchEvents("app.example.com", 3);
    expect(limited).toHaveLength(3);

    // Search without meaningful limit
    const all = store.searchEvents("app.example.com", 1000);
    expect(all).toHaveLength(12);
  });

  it("should handle api_call events through the full pipeline", () => {
    const store = createStore();
    const events: BrowserEvent[] = [];
    const baseTime = new Date("2024-06-15T09:00:00Z");

    // Simulate: navigate to dashboard, fetch user data (API), create report (API)
    // Repeat 3 times
    for (let rep = 0; rep < 3; rep++) {
      const offset = rep * 3;

      events.push({
        timestamp: new Date(baseTime.getTime() + (offset + 0) * 60_000).toISOString(),
        type: "navigation",
        url: "https://app.example.com/dashboard",
        sessionId: "api_session",
      });

      events.push({
        timestamp: new Date(baseTime.getTime() + (offset + 1) * 60_000).toISOString(),
        type: "api_call",
        url: "https://api.example.com/v1/users/me",
        sessionId: "api_session",
        meta: JSON.stringify({
          method: "GET",
          statusCode: 200,
          requestHeaders: { "accept": "application/json", "authorization": "[REDACTED]" },
          responseContentType: "application/json",
        }),
      });

      events.push({
        timestamp: new Date(baseTime.getTime() + (offset + 2) * 60_000).toISOString(),
        type: "api_call",
        url: "https://api.example.com/v1/reports",
        sessionId: "api_session",
        meta: JSON.stringify({
          method: "POST",
          statusCode: 201,
          requestHeaders: { "content-type": "application/json", "authorization": "[REDACTED]" },
          requestBody: '{"name":"Weekly","format":"pdf"}',
          responseContentType: "application/json",
        }),
      });
    }

    // 1. Import
    const count = store.insertMany(events);
    expect(count).toBe(9); // 3 events * 3 reps

    // 2. Analyze
    const stored = store.getAllEvents("api_session");
    const patterns = detectPatterns(stored, { minLength: 2, minFrequency: 2 });
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    const best = patterns[0];
    const apiSteps = best.steps.filter((s) => s.type === "api_call");
    expect(apiSteps.length).toBeGreaterThanOrEqual(1);

    // 3. Export to n8n — api_call should generate HTTP Request with captured data
    const n8nWorkflow = exportToN8n(best);
    const httpNodes = n8nWorkflow.nodes.filter(
      (n) => n.type === "n8n-nodes-base.httpRequest"
    );
    expect(httpNodes.length).toBeGreaterThanOrEqual(1);

    // POST node should have body params from captured request
    const postNode = httpNodes.find((n) => n.parameters.method === "POST");
    if (postNode) {
      expect(postNode.parameters.sendBody).toBe(true);
      const bodyParams = postNode.parameters.bodyParameters as {
        parameters: { name: string; value: string }[];
      };
      expect(bodyParams.parameters.some((p) => p.name === "name")).toBe(true);
    }

    // 4. Export to Playwright — should include page.request calls
    const playwrightScript = exportToPlaywright(best);
    expect(playwrightScript).toContain("page.request");

    // 5. Export to Zapier — api_call should be a Webhooks by Zapier action
    const zapierJson = exportToZapierJson(best);
    const zapier = JSON.parse(zapierJson);
    const webhookActions = zapier.actions.filter(
      (a: { app: string }) => a.app === "Webhooks by Zapier"
    );
    expect(webhookActions.length).toBeGreaterThanOrEqual(1);

    // 6. Timeline should show api_call events with <> icon
    const timeline = timelineToText(stored);
    expect(timeline).toContain("<>");
    expect(timeline).toContain("api_call");
  });
});
