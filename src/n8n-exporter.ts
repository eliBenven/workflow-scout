/**
 * Workflow Scout — n8n Workflow Exporter
 *
 * Converts a DetectedPattern into a valid n8n workflow JSON
 * that can be imported directly into n8n.
 */

import { DetectedPattern, PatternStep } from "./pattern-detector";

// ── n8n Workflow Types (subset) ────────────────────────────────────────────────

interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

interface N8nConnection {
  node: string;
  type: string;
  index: number;
}

interface N8nWorkflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: N8nConnection[][] }>;
  active: boolean;
  settings: {
    executionOrder: string;
  };
  tags: string[];
  meta: {
    instanceId: string;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

let nodeIdCounter = 0;

function nextNodeId(): string {
  nodeIdCounter++;
  return `node_${nodeIdCounter}`;
}

function resetIds(): void {
  nodeIdCounter = 0;
}

// ── Node Builders ──────────────────────────────────────────────────────────────

function buildTriggerNode(position: [number, number]): N8nNode {
  return {
    id: nextNodeId(),
    name: "Schedule Trigger",
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position,
    parameters: {
      rule: {
        interval: [
          {
            field: "hours",
            hoursInterval: 1,
          },
        ],
      },
    },
  };
}

function buildWebhookTriggerNode(position: [number, number]): N8nNode {
  return {
    id: nextNodeId(),
    name: "Webhook Trigger",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position,
    parameters: {
      path: "workflow-scout-trigger",
      httpMethod: "POST",
      responseMode: "onReceived",
    },
  };
}

function buildHttpRequestNode(
  step: PatternStep,
  index: number,
  position: [number, number]
): N8nNode {
  const name = `Step ${index + 1}: ${step.description.slice(0, 50)}`;

  const params: Record<string, unknown> = {
    url: step.urlPattern,
    method: "GET",
    options: {},
  };

  if (step.type === "form_submit") {
    params.method = "POST";
    params.sendBody = true;
    params.bodyParameters = {
      parameters: [
        {
          name: "field1",
          value: "={{ $json.field1 }}",
        },
      ],
    };
  }

  return {
    id: nextNodeId(),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position,
    parameters: params,
  };
}

function buildSetNode(
  description: string,
  position: [number, number]
): N8nNode {
  return {
    id: nextNodeId(),
    name: description.slice(0, 50),
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    position,
    parameters: {
      mode: "manual",
      duplicateItem: false,
      assignments: {
        assignments: [
          {
            id: "field1",
            name: "action",
            value: description,
            type: "string",
          },
        ],
      },
      options: {},
    },
  };
}

function buildSuccessCheckNode(position: [number, number]): N8nNode {
  return {
    id: nextNodeId(),
    name: "Success Check",
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "" },
        conditions: [
          {
            id: "check_status",
            leftValue: "={{ $json.statusCode || 200 }}",
            rightValue: 200,
            operator: {
              type: "number",
              operation: "equals",
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
  };
}

// ── Main Export Function ───────────────────────────────────────────────────────

export interface ExportOptions {
  /** Use webhook trigger instead of schedule. Default: false */
  webhookTrigger?: boolean;
  /** Include a trailing success-check If node. Default: true */
  successCheck?: boolean;
}

/**
 * Convert a DetectedPattern into a complete n8n workflow JSON object.
 */
export function exportToN8n(
  pattern: DetectedPattern,
  options: ExportOptions = {}
): N8nWorkflow {
  const { webhookTrigger = false, successCheck = true } = options;
  resetIds();

  const nodes: N8nNode[] = [];
  const xStart = 200;
  const yBase = 300;
  const xGap = 280;
  let x = xStart;

  // 1. Trigger node
  const trigger = webhookTrigger
    ? buildWebhookTriggerNode([x, yBase])
    : buildTriggerNode([x, yBase]);
  nodes.push(trigger);
  x += xGap;

  // 2. One node per pattern step
  for (let i = 0; i < pattern.steps.length; i++) {
    const step = pattern.steps[i];

    let node: N8nNode;
    if (step.type === "navigation" || step.type === "form_submit") {
      node = buildHttpRequestNode(step, i, [x, yBase]);
    } else {
      // click / input_change -> Set node that records the action
      node = buildSetNode(step.description, [x, yBase]);
    }

    nodes.push(node);
    x += xGap;
  }

  // 3. Success check at the end
  if (successCheck) {
    const check = buildSuccessCheckNode([x, yBase]);
    nodes.push(check);
  }

  // 4. Build connections (linear chain)
  const connections: Record<string, { main: N8nConnection[][] }> = {};
  for (let i = 0; i < nodes.length - 1; i++) {
    connections[nodes[i].name] = {
      main: [
        [
          {
            node: nodes[i + 1].name,
            type: "main",
            index: 0,
          },
        ],
      ],
    };
  }

  return {
    name: `Workflow Scout: ${pattern.label}`,
    nodes,
    connections,
    active: false,
    settings: {
      executionOrder: "v1",
    },
    tags: ["workflow-scout", "auto-generated"],
    meta: {
      instanceId: "workflow-scout-export",
    },
  };
}

/**
 * Serialize the workflow to a JSON string ready for file export.
 */
export function exportToN8nJson(
  pattern: DetectedPattern,
  options: ExportOptions = {}
): string {
  const workflow = exportToN8n(pattern, options);
  return JSON.stringify(workflow, null, 2);
}
