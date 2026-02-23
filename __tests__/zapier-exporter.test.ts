import { describe, it, expect } from "vitest";
import { exportToZapier, exportToZapierJson } from "../src/zapier-exporter";
import { DetectedPattern, PatternStep } from "../src/pattern-detector";

function makePattern(stepOverrides?: Partial<PatternStep>[]): DetectedPattern {
  const defaultSteps: PatternStep[] = [
    {
      type: "navigation",
      urlPattern: "https://app.com/dashboard",
      description: "Navigate to https://app.com/dashboard",
    },
    {
      type: "form_submit",
      urlPattern: "https://app.com/submit",
      description: "Submit form on https://app.com/submit",
      formFields: { name: "John", email: "john@test.com" },
      httpMethod: "POST",
    },
    {
      type: "click",
      urlPattern: "https://app.com/confirm",
      selector: "#confirm-btn",
      description: "Click #confirm-btn on https://app.com/confirm",
    },
  ];

  const steps = stepOverrides
    ? stepOverrides.map((o, i) => ({ ...defaultSteps[i % defaultSteps.length], ...o }))
    : defaultSteps;

  return {
    id: "pat_1",
    steps,
    frequency: 4,
    confidence: 0.9,
    occurrences: [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]],
    label: "3-step multi-step workflow on app.com",
  };
}

describe("exportToZapier", () => {
  it("should produce a valid Zapier workflow structure", () => {
    const pattern = makePattern();
    const workflow = exportToZapier(pattern);

    expect(workflow.name).toBeTruthy();
    expect(workflow.trigger).toBeDefined();
    expect(workflow.actions).toBeInstanceOf(Array);
    expect(workflow.actions).toHaveLength(3);
    expect(workflow.metadata.patternId).toBe("pat_1");
    expect(workflow.metadata.generatedBy).toBe("workflow-scout");
  });

  it("should use webhook trigger by default", () => {
    const pattern = makePattern();
    const workflow = exportToZapier(pattern);

    expect(workflow.trigger.app).toBe("Webhooks by Zapier");
    expect(workflow.trigger.event).toBe("Catch Hook");
  });

  it("should use schedule trigger when option is set", () => {
    const pattern = makePattern();
    const workflow = exportToZapier(pattern, { scheduleTrigger: true });

    expect(workflow.trigger.app).toBe("Schedule by Zapier");
    expect(workflow.trigger.event).toBe("Every Hour");
  });

  it("should create GET actions for navigation events", () => {
    const pattern = makePattern();
    const workflow = exportToZapier(pattern);

    const navAction = workflow.actions[0];
    expect(navAction.app).toBe("Webhooks by Zapier");
    expect(navAction.action).toBe("GET");
    expect(navAction.params.url).toBe("https://app.com/dashboard");
  });

  it("should create POST actions with form fields for form_submit events", () => {
    const pattern = makePattern();
    const workflow = exportToZapier(pattern);

    const formAction = workflow.actions[1];
    expect(formAction.app).toBe("Webhooks by Zapier");
    expect(formAction.action).toBe("POST");
    expect(formAction.params.method).toBe("POST");
    expect((formAction.params.body as Record<string, string>).name).toBe("John");
    expect((formAction.params.body as Record<string, string>).email).toBe("john@test.com");
  });

  it("should create Formatter actions for click events", () => {
    const pattern = makePattern();
    const workflow = exportToZapier(pattern);

    const clickAction = workflow.actions[2];
    expect(clickAction.app).toBe("Formatter by Zapier");
    expect(clickAction.params.note).toBeTruthy();
  });

  it("should include metadata with confidence and frequency", () => {
    const pattern = makePattern();
    const workflow = exportToZapier(pattern);

    expect(workflow.metadata.frequency).toBe(4);
    expect(workflow.metadata.confidence).toBe(0.9);
  });
});

describe("exportToZapierJson", () => {
  it("should produce valid JSON", () => {
    const pattern = makePattern();
    const json = exportToZapierJson(pattern);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBeTruthy();
    expect(parsed.actions).toBeInstanceOf(Array);
  });
});
