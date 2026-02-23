import { describe, it, expect } from "vitest";
import { exportToPlaywright, exportToPlaywrightTest } from "../src/playwright-exporter";
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
      formFields: { username: "john", password: "[REDACTED]" },
      httpMethod: "POST",
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
    occurrences: [[0, 1, 2], [3, 4, 5], [6, 7, 8]],
    label: "3-step multi-step workflow on app.com",
  };
}

describe("exportToPlaywright", () => {
  it("should produce a valid Playwright script", () => {
    const pattern = makePattern();
    const script = exportToPlaywright(pattern);

    expect(script).toContain("import { chromium");
    expect(script).toContain("async function run()");
    expect(script).toContain("browser.close()");
  });

  it("should include page.goto for navigation steps", () => {
    const pattern = makePattern();
    const script = exportToPlaywright(pattern);

    expect(script).toContain("page.goto('https://app.com/login')");
    expect(script).toContain("waitForLoadState");
  });

  it("should include locator.click for click steps", () => {
    const pattern = makePattern();
    const script = exportToPlaywright(pattern);

    expect(script).toContain("page.locator('#username').click()");
  });

  it("should fill form fields for form_submit steps", () => {
    const pattern = makePattern();
    const script = exportToPlaywright(pattern);

    expect(script).toContain('[name="username"]');
    expect(script).toContain("fill('john')");
    // Redacted fields should use env vars
    expect(script).toContain("process.env.FORM_PASSWORD");
  });

  it("should include pattern metadata in comment header", () => {
    const pattern = makePattern();
    const script = exportToPlaywright(pattern);

    expect(script).toContain("pat_1");
    expect(script).toContain("Frequency: 3x");
    expect(script).toContain("Confidence: 80%");
  });

  it("should respect headed option", () => {
    const pattern = makePattern();
    const script = exportToPlaywright(pattern, { headed: true });

    expect(script).toContain("headless: false");
  });
});

describe("exportToPlaywrightTest", () => {
  it("should produce a Playwright Test format", () => {
    const pattern = makePattern();
    const script = exportToPlaywrightTest(pattern);

    expect(script).toContain("import { test, expect }");
    expect(script).toContain("test('");
    expect(script).toContain("async ({ page })");
  });

  it("should use the pattern label as test name", () => {
    const pattern = makePattern();
    const script = exportToPlaywrightTest(pattern);

    expect(script).toContain("3-step multi-step workflow on app.com");
  });
});
