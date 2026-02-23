#!/usr/bin/env node
/**
 * Workflow Scout — CLI Entry Point
 *
 * Commands:
 *   import <file>          Import events from a JSON file exported by the extension
 *   timeline               Show a formatted event timeline
 *   analyze                Detect repeated patterns in recorded events
 *   export <pattern-id>    Export a detected pattern as an n8n / playwright / zapier workflow
 *   sessions               List recorded sessions
 *   search <query>         Search events by URL, selector, or value
 *   tag <session-id> <tag> Tag a session for easier filtering
 *   untag <session-id> <tag> Remove a tag from a session
 */

import { Command } from "commander";
import fs from "fs";
import path from "path";
import { EventStore, BrowserEvent } from "./db";
import { detectPatterns, autoTuneAndDetect, DetectedPattern } from "./pattern-detector";
import { exportToN8nJson } from "./n8n-exporter";
import { exportToPlaywright, exportToPlaywrightTest } from "./playwright-exporter";
import { exportToZapierJson } from "./zapier-exporter";
import { printTimeline } from "./timeline";

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_EVENT_TYPES = new Set(["navigation", "click", "form_submit", "input_change"]);
const CACHE_DIR_NAME = ".workflow-scout";

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "/tmp";
}

function getCachePath(): string {
  return path.join(getHomeDir(), CACHE_DIR_NAME, "patterns-cache.json");
}

// ── Shared state ───────────────────────────────────────────────────────────────

function getStore(dbPath?: string): EventStore {
  return new EventStore(dbPath);
}

// ── Input validation ──────────────────────────────────────────────────────────

function validateEventItem(item: Record<string, unknown>, index: number): BrowserEvent | null {
  const type = item.type as string;
  if (type && !VALID_EVENT_TYPES.has(type)) {
    console.warn(
      `  Warning: Skipping event ${index + 1} with invalid type "${type}" (expected: ${[...VALID_EVENT_TYPES].join(", ")})`
    );
    return null;
  }

  const url = (item.url as string) || "";
  if (!url) {
    console.warn(`  Warning: Skipping event ${index + 1} with missing URL`);
    return null;
  }

  return {
    timestamp: (item.timestamp as string) || new Date().toISOString(),
    type: (type as BrowserEvent["type"]) || "navigation",
    url,
    selector: (item.selector as string) || undefined,
    value: (item.value as string) || (item.text as string) || undefined,
    sessionId: (item.sessionId as string) || "",
    meta: item.fields
      ? JSON.stringify({ fields: item.fields, method: item.method, action: item.action })
      : item.meta
        ? JSON.stringify(item.meta)
        : undefined,
  };
}

// ── Visual workflow preview ───────────────────────────────────────────────────

function printWorkflowPreview(pattern: DetectedPattern): void {
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const CYAN = "\x1b[36m";
  const YELLOW = "\x1b[33m";
  const GREEN = "\x1b[32m";
  const MAGENTA = "\x1b[35m";
  const RESET = "\x1b[0m";

  const typeColors: Record<string, string> = {
    navigation: CYAN,
    click: YELLOW,
    form_submit: MAGENTA,
    input_change: GREEN,
  };

  console.log(`\n${BOLD}  Workflow Preview: ${pattern.label}${RESET}`);
  console.log(`${DIM}  ${"─".repeat(60)}${RESET}`);
  console.log();

  // ASCII flow diagram
  console.log(`${DIM}  [Trigger]${RESET}`);
  console.log(`${DIM}      │${RESET}`);

  for (let i = 0; i < pattern.steps.length; i++) {
    const step = pattern.steps[i];
    const color = typeColors[step.type] || DIM;
    const isLast = i === pattern.steps.length - 1;
    const connector = isLast ? "└" : "├";
    const pipe = isLast ? " " : "│";

    console.log(`${DIM}      ${connector}──${RESET} ${color}${BOLD}${step.type}${RESET}`);
    console.log(`${DIM}      ${pipe}   ${RESET}${DIM}${step.description}${RESET}`);

    if (step.formFields && Object.keys(step.formFields).length > 0) {
      const fieldNames = Object.keys(step.formFields).join(", ");
      console.log(`${DIM}      ${pipe}   fields: ${fieldNames}${RESET}`);
    }

    if (!isLast) {
      console.log(`${DIM}      │${RESET}`);
    }
  }

  console.log(`\n${DIM}  ${"─".repeat(60)}${RESET}`);
  console.log(
    `${DIM}  Detected ${pattern.frequency}x | Confidence: ${Math.round(pattern.confidence * 100)}% | Steps: ${pattern.steps.length}${RESET}\n`
  );
}

// ── Program ────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("workflow-scout")
  .description(
    "Record browser activity, detect repeated patterns, and export automation workflows (n8n, Playwright, Zapier)"
  )
  .version("2.0.0")
  .option("--db <path>", "Path to SQLite database file");

// ── import ─────────────────────────────────────────────────────────────────────

program
  .command("import <file>")
  .description("Import events from a JSON file exported by the Chrome extension")
  .option("-s, --session <id>", "Override session ID for imported events")
  .action((file: string, opts: { session?: string }) => {
    const absPath = path.resolve(file);
    if (!fs.existsSync(absPath)) {
      console.error(`File not found: ${absPath}`);
      process.exit(1);
    }

    let raw: Record<string, unknown>[];
    try {
      const content = fs.readFileSync(absPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed)) throw new Error("Expected an array of events");
      raw = parsed as Record<string, unknown>[];
    } catch (err) {
      console.error(`Failed to parse JSON: ${(err as Error).message}`);
      process.exit(1);
    }

    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);
    const sessionId = opts.session || `import_${Date.now()}`;

    const events: BrowserEvent[] = [];
    let skipped = 0;

    for (let i = 0; i < raw.length; i++) {
      const validated = validateEventItem(raw[i], i);
      if (validated) {
        validated.sessionId = opts.session || validated.sessionId || sessionId;
        events.push(validated);
      } else {
        skipped++;
      }
    }

    const count = store.insertMany(events);
    store.close();

    console.log(`Imported ${count} events from ${path.basename(absPath)}`);
    if (skipped > 0) {
      console.log(`  (${skipped} invalid events skipped)`);
    }
  });

// ── timeline ───────────────────────────────────────────────────────────────────

program
  .command("timeline")
  .description("Show a formatted event timeline")
  .option("-s, --session <id>", "Filter by session ID")
  .option("-t, --tag <tag>", "Filter by session tag")
  .option("-n, --limit <count>", "Limit number of events shown", "100")
  .action((opts: { session?: string; tag?: string; limit: string }) => {
    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);

    let events: BrowserEvent[];
    if (opts.tag) {
      const taggedSessions = store.getSessionsByTag(opts.tag);
      if (taggedSessions.length === 0) {
        console.log(`No sessions found with tag "${opts.tag}".`);
        store.close();
        return;
      }
      events = [];
      for (const sess of taggedSessions) {
        events.push(...store.getAllEvents(sess.id));
      }
    } else {
      events = store.getAllEvents(opts.session);
    }

    const limit = parseInt(opts.limit, 10);
    if (events.length > limit) {
      console.log(`Showing first ${limit} of ${events.length} events (use --limit to change)\n`);
      events = events.slice(0, limit);
    }

    printTimeline(events);
    store.close();
  });

// ── analyze ────────────────────────────────────────────────────────────────────

program
  .command("analyze")
  .description("Detect repeated patterns in recorded events")
  .option("-s, --session <id>", "Analyze only events from a specific session")
  .option("-t, --tag <tag>", "Analyze only events from sessions with this tag")
  .option("--min-length <n>", "Minimum pattern length", "2")
  .option("--max-length <n>", "Maximum pattern length", "15")
  .option("--min-freq <n>", "Minimum repetitions to qualify", "2")
  .option("--auto-tune", "Automatically find best detection parameters")
  .action(
    (opts: {
      session?: string;
      tag?: string;
      minLength: string;
      maxLength: string;
      minFreq: string;
      autoTune?: boolean;
    }) => {
      const dbPath = program.opts().db as string | undefined;
      const store = getStore(dbPath);

      let events: BrowserEvent[];
      if (opts.tag) {
        const taggedSessions = store.getSessionsByTag(opts.tag);
        events = [];
        for (const sess of taggedSessions) {
          events.push(...store.getAllEvents(sess.id));
        }
      } else {
        events = store.getAllEvents(opts.session);
      }
      store.close();

      if (events.length === 0) {
        console.log("No events found. Import some events first with: workflow-scout import <file>");
        return;
      }

      console.log(`\nAnalyzing ${events.length} events...\n`);

      let patterns: DetectedPattern[];

      if (opts.autoTune) {
        console.log("Auto-tuning detection parameters...\n");
        patterns = autoTuneAndDetect(events);
      } else {
        patterns = detectPatterns(events, {
          minLength: parseInt(opts.minLength, 10),
          maxLength: parseInt(opts.maxLength, 10),
          minFrequency: parseInt(opts.minFreq, 10),
        });
      }

      if (patterns.length === 0) {
        console.log("No repeated patterns found.");
        console.log("Try recording more browser activity, lowering --min-freq, or using --auto-tune.\n");
        return;
      }

      console.log(`Found ${patterns.length} pattern(s):\n`);

      for (const pat of patterns) {
        printPattern(pat);
      }

      console.log(
        `\nTo export a pattern, run:\n  workflow-scout export <pattern-id> [--format n8n|playwright|zapier]\n`
      );

      // Store patterns in cache (overwrite previous)
      const patternsCache = getCachePath();
      const dir = path.dirname(patternsCache);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(patternsCache, JSON.stringify(patterns, null, 2));
    }
  );

// ── export ─────────────────────────────────────────────────────────────────────

program
  .command("export <pattern-id>")
  .description("Export a detected pattern as an automation workflow")
  .option("-o, --output <file>", "Output file path")
  .option("-f, --format <format>", "Export format: n8n, playwright, playwright-test, zapier", "n8n")
  .option("--webhook", "Use webhook trigger instead of schedule trigger")
  .option("--dry-run", "Preview the workflow without writing a file")
  .action(
    (
      patternId: string,
      opts: { output?: string; format: string; webhook?: boolean; dryRun?: boolean }
    ) => {
      const patternsCache = getCachePath();

      if (!fs.existsSync(patternsCache)) {
        console.error("No pattern analysis found. Run `workflow-scout analyze` first.");
        process.exit(1);
      }

      let patterns: DetectedPattern[];
      try {
        patterns = JSON.parse(fs.readFileSync(patternsCache, "utf-8")) as DetectedPattern[];
      } catch {
        console.error("Failed to read pattern cache. Run `workflow-scout analyze` again.");
        process.exit(1);
      }

      const pattern = patterns.find((p) => p.id === patternId);
      if (!pattern) {
        console.error(`Pattern "${patternId}" not found. Available patterns:`);
        for (const p of patterns) {
          console.error(`  ${p.id}: ${p.label}`);
        }
        process.exit(1);
      }

      // Always show visual preview first
      printWorkflowPreview(pattern);

      if (opts.dryRun) {
        console.log("  (dry-run mode — no file written)\n");
        return;
      }

      let output: string;
      let defaultExt: string;
      let postMessage: string;

      switch (opts.format) {
        case "playwright":
          output = exportToPlaywright(pattern);
          defaultExt = ".ts";
          postMessage = "Run with: npx tsx <file>";
          break;

        case "playwright-test":
          output = exportToPlaywrightTest(pattern);
          defaultExt = ".spec.ts";
          postMessage = "Run with: npx playwright test <file>";
          break;

        case "zapier":
          output = exportToZapierJson(pattern);
          defaultExt = ".zapier.json";
          postMessage = "Use this config as a reference when creating your Zap in Zapier.";
          break;

        case "n8n":
        default:
          output = exportToN8nJson(pattern, {
            webhookTrigger: opts.webhook || false,
            successCheck: true,
          });
          defaultExt = ".json";
          postMessage = [
            "To import into n8n:",
            "  1. Open n8n in your browser",
            "  2. Go to Workflows -> Import from File",
          ].join("\n");
          break;
      }

      const outFile = opts.output || `workflow-${patternId}${defaultExt}`;
      const absOut = path.resolve(outFile);
      fs.writeFileSync(absOut, output, "utf-8");

      console.log(`  Exported (${opts.format}) to: ${absOut}`);
      console.log(`  ${postMessage}\n`);
    }
  );

// ── sessions ───────────────────────────────────────────────────────────────────

program
  .command("sessions")
  .description("List recorded sessions")
  .option("-t, --tag <tag>", "Filter sessions by tag")
  .action((opts: { tag?: string }) => {
    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);

    const sessions = opts.tag
      ? store.getSessionsByTag(opts.tag)
      : store.getSessions();

    if (sessions.length === 0) {
      console.log(opts.tag ? `No sessions found with tag "${opts.tag}".` : "No sessions found.");
      store.close();
      return;
    }

    console.log(`\n  Sessions (${sessions.length}):\n`);
    for (const s of sessions) {
      const tags = store.getSessionTags(s.id);
      const tagStr = tags.length > 0 ? `  [${tags.join(", ")}]` : "";
      console.log(`  ${s.id}  ${s.startedAt}  (${s.eventCount} events)${tagStr}`);
    }
    console.log();
    store.close();
  });

// ── tag ───────────────────────────────────────────────────────────────────────

program
  .command("tag <session-id> <tag>")
  .description("Add a tag to a session (e.g. 'login-flow', 'checkout', 'data-entry')")
  .action((sessionId: string, tag: string) => {
    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);

    // Verify session exists
    const sessions = store.getSessions();
    if (!sessions.find((s) => s.id === sessionId)) {
      console.error(`Session "${sessionId}" not found.`);
      store.close();
      process.exit(1);
    }

    store.addSessionTag(sessionId, tag);
    console.log(`Tagged session "${sessionId}" with "${tag}".`);
    store.close();
  });

// ── untag ─────────────────────────────────────────────────────────────────────

program
  .command("untag <session-id> <tag>")
  .description("Remove a tag from a session")
  .action((sessionId: string, tag: string) => {
    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);
    store.removeSessionTag(sessionId, tag);
    console.log(`Removed tag "${tag}" from session "${sessionId}".`);
    store.close();
  });

// ── search ─────────────────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Search events by URL, selector, or value")
  .option("-n, --limit <count>", "Maximum number of results", "200")
  .action((query: string, opts: { limit: string }) => {
    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);
    const limit = parseInt(opts.limit, 10);
    const events = store.searchEvents(query, limit);
    store.close();

    if (events.length === 0) {
      console.log(`No events matching "${query}".`);
      return;
    }

    const suffix = events.length >= limit ? ` (limited to ${limit}, use --limit to change)` : "";
    console.log(`\nFound ${events.length} matching events${suffix}:\n`);
    printTimeline(events);
  });

// ── clean-cache ──────────────────────────────────────────────────────────────

program
  .command("clean-cache")
  .description("Remove the patterns cache file")
  .action(() => {
    const patternsCache = getCachePath();
    if (fs.existsSync(patternsCache)) {
      fs.unlinkSync(patternsCache);
      console.log("Patterns cache cleared.");
    } else {
      console.log("No cache file found.");
    }
  });

// ── helpers ────────────────────────────────────────────────────────────────────

function printPattern(pat: DetectedPattern): void {
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const CYAN = "\x1b[36m";
  const RESET = "\x1b[0m";

  console.log(
    `${BOLD}${CYAN}  ${pat.id}${RESET}  ${pat.label}  (${pat.frequency}x, confidence: ${Math.round(pat.confidence * 100)}%)`
  );
  for (let i = 0; i < pat.steps.length; i++) {
    const step = pat.steps[i];
    const prefix = i === pat.steps.length - 1 ? "  └─" : "  ├─";
    console.log(`${DIM}${prefix} ${step.description}${RESET}`);
    if (step.formFields && Object.keys(step.formFields).length > 0) {
      const fieldList = Object.keys(step.formFields).join(", ");
      const innerPrefix = i === pat.steps.length - 1 ? "     " : "  │  ";
      console.log(`${DIM}${innerPrefix}fields: ${fieldList}${RESET}`);
    }
  }
  console.log();
}

// ── parse ──────────────────────────────────────────────────────────────────────

program.parse();
