/**
 * Workflow Scout — Zapier-compatible Exporter
 *
 * Converts a DetectedPattern into a Zapier-style webhook + action
 * configuration that can be used with Zapier's Webhooks by Zapier
 * or as a reference for manual Zap creation.
 */

import { DetectedPattern, PatternStep } from "./pattern-detector";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ZapierAction {
  step: number;
  app: string;
  action: string;
  description: string;
  params: Record<string, unknown>;
}

interface ZapierWorkflow {
  name: string;
  description: string;
  trigger: {
    app: string;
    event: string;
    params: Record<string, unknown>;
  };
  actions: ZapierAction[];
  metadata: {
    patternId: string;
    frequency: number;
    confidence: number;
    generatedBy: string;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildAction(step: PatternStep, index: number): ZapierAction {
  switch (step.type) {
    case "navigation":
      return {
        step: index + 1,
        app: "Webhooks by Zapier",
        action: "GET",
        description: step.description,
        params: {
          url: step.urlPattern,
          method: "GET",
          headers: { "User-Agent": "Workflow-Scout-Zapier/1.0" },
        },
      };

    case "form_submit": {
      const body: Record<string, string> = {};
      if (step.formFields) {
        for (const [name, value] of Object.entries(step.formFields)) {
          body[name] = value === "[REDACTED]" ? `{{${name}}}` : value;
        }
      }
      return {
        step: index + 1,
        app: "Webhooks by Zapier",
        action: "POST",
        description: step.description,
        params: {
          url: step.urlPattern,
          method: step.httpMethod || "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      };
    }

    case "click":
      return {
        step: index + 1,
        app: "Formatter by Zapier",
        action: "Text",
        description: step.description,
        params: {
          operation: "log",
          message: `Click action: ${step.selector || "element"} on ${step.urlPattern}`,
          note: "This click action requires browser automation. Consider using a Code by Zapier step with Puppeteer or a dedicated browser automation service.",
        },
      };

    case "input_change":
      return {
        step: index + 1,
        app: "Formatter by Zapier",
        action: "Text",
        description: step.description,
        params: {
          operation: "log",
          message: `Input change: ${step.selector || "field"} on ${step.urlPattern}`,
          note: "This input change requires browser automation. Consider pairing with a Code by Zapier step.",
        },
      };

    case "api_call": {
      const apiMethod = step.httpMethod || "GET";
      const apiHeaders: Record<string, string> = {};
      if (step.requestHeaders) {
        for (const [k, v] of Object.entries(step.requestHeaders)) {
          apiHeaders[k] = v === "[REDACTED]" ? `{{${k}}}` : v;
        }
      }
      const apiBody: Record<string, unknown> = {};
      if (step.requestBody) {
        try {
          const parsed = JSON.parse(step.requestBody);
          if (typeof parsed === "object" && parsed !== null) {
            for (const [k, v] of Object.entries(parsed)) {
              apiBody[k] = v === "[REDACTED]" ? `{{${k}}}` : v;
            }
          }
        } catch {
          apiBody["_raw"] = step.requestBody;
        }
      }
      return {
        step: index + 1,
        app: "Webhooks by Zapier",
        action: apiMethod,
        description: step.description,
        params: {
          url: step.urlPattern,
          method: apiMethod,
          headers: Object.keys(apiHeaders).length > 0 ? apiHeaders : { "Content-Type": "application/json" },
          body: Object.keys(apiBody).length > 0 ? apiBody : undefined,
        },
      };
    }

    default:
      return {
        step: index + 1,
        app: "Formatter by Zapier",
        action: "Text",
        description: step.description,
        params: {
          operation: "log",
          message: `${step.type} on ${step.urlPattern}`,
        },
      };
  }
}

// ── Main Export Function ───────────────────────────────────────────────────────

export interface ZapierExportOptions {
  /** Use schedule trigger instead of webhook. Default: false */
  scheduleTrigger?: boolean;
}

/**
 * Convert a DetectedPattern into a Zapier-compatible workflow config.
 */
export function exportToZapier(
  pattern: DetectedPattern,
  options: ZapierExportOptions = {}
): ZapierWorkflow {
  const { scheduleTrigger = false } = options;

  const trigger = scheduleTrigger
    ? {
        app: "Schedule by Zapier",
        event: "Every Hour",
        params: { interval: "hour", value: 1 },
      }
    : {
        app: "Webhooks by Zapier",
        event: "Catch Hook",
        params: { path: "workflow-scout-trigger" },
      };

  const actions: ZapierAction[] = pattern.steps.map((step, i) =>
    buildAction(step, i)
  );

  return {
    name: `Workflow Scout: ${pattern.label}`,
    description: `Auto-generated Zapier workflow from pattern ${pattern.id} (detected ${pattern.frequency} times with ${Math.round(pattern.confidence * 100)}% confidence)`,
    trigger,
    actions,
    metadata: {
      patternId: pattern.id,
      frequency: pattern.frequency,
      confidence: pattern.confidence,
      generatedBy: "workflow-scout",
    },
  };
}

/**
 * Serialize the workflow to a JSON string for file export.
 */
export function exportToZapierJson(
  pattern: DetectedPattern,
  options: ZapierExportOptions = {}
): string {
  const workflow = exportToZapier(pattern, options);
  return JSON.stringify(workflow, null, 2);
}
