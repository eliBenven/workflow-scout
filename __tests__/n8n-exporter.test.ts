import { describe, it, expect } from "vitest";
import { exportToN8n, exportToN8nJson, ExportOptions } from "../src/n8n-exporter";
import { DetectedPattern, PatternStep } from "../src/pattern-detector";

function makePattern(stepOverrides?: Partial<PatternStep>[]): DetectedPattern {
  const defaultSteps: PatternStep[] = [
    {
      type: "navigation",
      urlPattern: "https://app.com/login",
      description: "Navigate to https://app.com/login",
    },
    {
      type: "click",
      urlPattern: "https://app.com/login",
      selector: "#username",
      description: "Click #username on https://app.com/login",
    },
    {
      type: "form_submit",
      urlPattern: "https://app.com/login",
      description: "Submit form on https://app.com/login",
    },
  ];

  const steps = stepOverrides
    ? stepOverrides.map((o, i) => ({ ...defaultSteps[i % defaultSteps.length], ...o }))
    : defaultSteps;

  return {
    id: "pat_1",
    steps,
    frequency: 3,
    confidence: 0.8,
    occurrences: [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
    ],
    label: "3-step multi-step workflow on app.com",
  };
}

describe("exportToN8n", () => {
  // ── Valid n8n JSON structure ────────────────────────────────────────────────

  it("should produce a valid n8n workflow structure", () => {
    const pattern = makePattern();
    const workflow = exportToN8n(pattern);

    expect(workflow.name).toBeTruthy();
    expect(workflow.nodes).toBeInstanceOf(Array);
    expect(workflow.nodes.length).toBeGreaterThan(0);
    expect(workflow.connections).toBeDefined();
    expect(workflow.active).toBe(false);
    expect(workflow.settings).toBeDefined();
    expect(workflow.settings.executionOrder).toBe("v1");
    expect(workflow.tags).toContain("workflow-scout");
    expect(workflow.meta).toBeDefined();
    expect(workflow.meta.instanceId).toBeTruthy();
  });

  it("should produce valid JSON from exportToN8nJson", () => {
    const pattern = makePattern();
    const json = exportToN8nJson(pattern);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBeTruthy();
    expect(parsed.nodes).toBeInstanceOf(Array);
  });

  // ── Navigation events become HTTP Request nodes ────────────────────────────

  it("should create HTTP Request GET nodes for navigation events", () => {
    const pattern = makePattern([
      { type: "navigation", urlPattern: "https://app.com/page", description: "Navigate to https://app.com/page" },
    ]);
    const workflow = exportToN8n(pattern);

    // Find the HTTP request node (not the trigger, not the success check)
    const httpNodes = workflow.nodes.filter(
      (n) => n.type === "n8n-nodes-base.httpRequest"
    );
    expect(httpNodes.length).toBeGreaterThanOrEqual(1);
    expect(httpNodes[0].parameters.method).toBe("GET");
    expect(httpNodes[0].parameters.url).toBe("https://app.com/page");
  });

  // ── Form submit events become HTTP Request POST nodes ──────────────────────

  it("should create HTTP Request POST nodes for form_submit events", () => {
    const pattern = makePattern([
      { type: "form_submit", urlPattern: "https://app.com/login", description: "Submit form on https://app.com/login" },
    ]);
    const workflow = exportToN8n(pattern);

    const httpNodes = workflow.nodes.filter(
      (n) => n.type === "n8n-nodes-base.httpRequest"
    );
    expect(httpNodes.length).toBeGreaterThanOrEqual(1);
    const postNode = httpNodes.find((n) => n.parameters.method === "POST");
    expect(postNode).toBeDefined();
    expect(postNode!.parameters.sendBody).toBe(true);
  });

  // ── Nodes are correctly wired ──────────────────────────────────────────────

  it("should wire nodes in a linear chain via connections", () => {
    const pattern = makePattern();
    const workflow = exportToN8n(pattern);
    const nodeNames = workflow.nodes.map((n) => n.name);

    // Every node except the last should appear as a key in connections
    for (let i = 0; i < nodeNames.length - 1; i++) {
      const fromName = nodeNames[i];
      expect(workflow.connections[fromName]).toBeDefined();
      const targets = workflow.connections[fromName].main[0];
      expect(targets).toHaveLength(1);
      expect(targets[0].node).toBe(nodeNames[i + 1]);
      expect(targets[0].type).toBe("main");
      expect(targets[0].index).toBe(0);
    }

    // The last node should NOT be in connections (nothing follows it)
    const lastName = nodeNames[nodeNames.length - 1];
    expect(workflow.connections[lastName]).toBeUndefined();
  });

  // ── Webhook trigger mode ──────────────────────────────────────────────────

  it("should use schedule trigger by default", () => {
    const pattern = makePattern();
    const workflow = exportToN8n(pattern);

    const trigger = workflow.nodes[0];
    expect(trigger.type).toBe("n8n-nodes-base.scheduleTrigger");
    expect(trigger.name).toBe("Schedule Trigger");
  });

  it("should use webhook trigger when webhookTrigger option is set", () => {
    const pattern = makePattern();
    const workflow = exportToN8n(pattern, { webhookTrigger: true });

    const trigger = workflow.nodes[0];
    expect(trigger.type).toBe("n8n-nodes-base.webhook");
    expect(trigger.name).toBe("Webhook Trigger");
  });

  // ── Success check ─────────────────────────────────────────────────────────

  it("should include a success check node by default", () => {
    const pattern = makePattern();
    const workflow = exportToN8n(pattern);

    const lastNode = workflow.nodes[workflow.nodes.length - 1];
    expect(lastNode.name).toBe("Success Check");
    expect(lastNode.type).toBe("n8n-nodes-base.if");
  });

  it("should exclude success check when successCheck is false", () => {
    const pattern = makePattern();
    const workflow = exportToN8n(pattern, { successCheck: false });

    const lastNode = workflow.nodes[workflow.nodes.length - 1];
    expect(lastNode.name).not.toBe("Success Check");
  });

  // ── Node count ────────────────────────────────────────────────────────────

  it("should have trigger + step nodes + success check", () => {
    const pattern = makePattern(); // 3 steps
    const workflow = exportToN8n(pattern);

    // 1 trigger + 3 step nodes + 1 success check = 5
    expect(workflow.nodes).toHaveLength(5);
  });

  // ── Click / input_change become Set nodes ─────────────────────────────────

  it("should create Set nodes for click events", () => {
    const pattern = makePattern([
      { type: "click", urlPattern: "https://app.com/page", selector: "#btn", description: "Click #btn on https://app.com/page" },
    ]);
    const workflow = exportToN8n(pattern);

    const setNodes = workflow.nodes.filter(
      (n) => n.type === "n8n-nodes-base.set"
    );
    expect(setNodes.length).toBeGreaterThanOrEqual(1);
  });

  // ── api_call events become HTTP Request nodes with full context ────────

  it("should create HTTP Request nodes for api_call steps with captured method/headers/body", () => {
    const pattern = makePattern([
      {
        type: "api_call",
        urlPattern: "https://api.app.com/v1/reports",
        description: "POST https://api.app.com/v1/reports",
        httpMethod: "POST",
        requestHeaders: { "content-type": "application/json", "x-custom": "value" },
        requestBody: '{"name":"Weekly","type":"summary"}',
        statusCode: 201,
      },
    ]);
    const workflow = exportToN8n(pattern);

    const httpNodes = workflow.nodes.filter(
      (n) => n.type === "n8n-nodes-base.httpRequest"
    );
    expect(httpNodes.length).toBeGreaterThanOrEqual(1);

    const apiNode = httpNodes[0];
    expect(apiNode.parameters.method).toBe("POST");
    expect(apiNode.parameters.url).toBe("https://api.app.com/v1/reports");
    expect(apiNode.parameters.sendBody).toBe(true);
    expect(apiNode.parameters.sendHeaders).toBe(true);

    // Headers should be passed through
    const headerParams = apiNode.parameters.headerParameters as {
      parameters: { name: string; value: string }[];
    };
    expect(headerParams.parameters.some((h) => h.name === "x-custom")).toBe(true);

    // Body should be parsed as JSON parameters
    const bodyParams = apiNode.parameters.bodyParameters as {
      parameters: { name: string; value: string }[];
    };
    expect(bodyParams.parameters.some((p) => p.name === "name" && p.value === "Weekly")).toBe(true);
  });

  it("should use template syntax for redacted fields in api_call body", () => {
    const pattern = makePattern([
      {
        type: "api_call",
        urlPattern: "https://api.app.com/auth",
        description: "POST https://api.app.com/auth",
        httpMethod: "POST",
        requestBody: '{"username":"admin","password":"[REDACTED]"}',
      },
    ]);
    const workflow = exportToN8n(pattern);

    const httpNodes = workflow.nodes.filter(
      (n) => n.type === "n8n-nodes-base.httpRequest"
    );
    const apiNode = httpNodes[0];
    const bodyParams = apiNode.parameters.bodyParameters as {
      parameters: { name: string; value: string }[];
    };
    const pwField = bodyParams.parameters.find((p) => p.name === "password");
    expect(pwField).toBeDefined();
    expect(pwField!.value).toContain("$json");
  });

  it("should set auth flag when api_call has redacted authorization header", () => {
    const pattern = makePattern([
      {
        type: "api_call",
        urlPattern: "https://api.app.com/data",
        description: "GET https://api.app.com/data",
        httpMethod: "GET",
        requestHeaders: { "authorization": "[REDACTED]", "accept": "application/json" },
      },
    ]);
    const workflow = exportToN8n(pattern);

    const httpNodes = workflow.nodes.filter(
      (n) => n.type === "n8n-nodes-base.httpRequest"
    );
    expect(httpNodes[0].parameters.authentication).toBe("genericCredentialType");
  });
});
