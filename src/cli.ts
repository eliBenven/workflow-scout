#!/usr/bin/env node
/**
 * Workflow Scout — CLI Entry Point
 *
 * Commands:
 *   import <file>          Import events from a JSON file exported by the extension
 *   timeline               Show a formatted event timeline
 *   analyze                Detect repeated patterns in recorded events
 *   export <pattern-id>    Export a detected pattern as an n8n workflow JSON
 *   sessions               List recorded sessions
 *   search <query>         Search events by URL, selector, or value
 */

import { Command } from "commander";
import fs from "fs";
import path from "path";
import { EventStore, BrowserEvent } from "./db";
import { detectPatterns, DetectedPattern } from "./pattern-detector";
import { exportToN8nJson } from "./n8n-exporter";
import { printTimeline } from "./timeline";

// ── Shared state ───────────────────────────────────────────────────────────────

function getStore(dbPath?: string): EventStore {
  return new EventStore(dbPath);
}

// ── Program ────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("workflow-scout")
  .description(
    "Record browser activity, detect repeated patterns, and export n8n-compatible automation workflows"
  )
  .version("1.0.0")
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
      if (!Array.isArray(parsed)) throw new Error("Expected an array");
      raw = parsed as Record<string, unknown>[];
    } catch (err) {
      console.error(`Failed to parse JSON: ${(err as Error).message}`);
      process.exit(1);
    }

    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);

    const events: BrowserEvent[] = raw.map((item) => ({
      timestamp: (item.timestamp as string) || new Date().toISOString(),
      type: (item.type as BrowserEvent["type"]) || "navigation",
      url: (item.url as string) || "",
      selector: (item.selector as string) || undefined,
      value: (item.value as string) || (item.text as string) || undefined,
      sessionId: opts.session || (item.sessionId as string) || `import_${Date.now()}`,
      meta: item.fields
        ? JSON.stringify({ fields: item.fields, method: item.method, action: item.action })
        : item.meta
          ? JSON.stringify(item.meta)
          : undefined,
    }));

    const count = store.insertMany(events);
    store.close();

    console.log(`Imported ${count} events from ${path.basename(absPath)}`);
  });

// ── timeline ───────────────────────────────────────────────────────────────────

program
  .command("timeline")
  .description("Show a formatted event timeline")
  .option("-s, --session <id>", "Filter by session ID")
  .option("-n, --limit <count>", "Limit number of events shown", "100")
  .action((opts: { session?: string; limit: string }) => {
    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);
    let events = store.getAllEvents(opts.session);

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
  .option("--min-length <n>", "Minimum pattern length", "2")
  .option("--max-length <n>", "Maximum pattern length", "15")
  .option("--min-freq <n>", "Minimum repetitions to qualify", "2")
  .action(
    (opts: {
      session?: string;
      minLength: string;
      maxLength: string;
      minFreq: string;
    }) => {
      const dbPath = program.opts().db as string | undefined;
      const store = getStore(dbPath);
      const events = store.getAllEvents(opts.session);
      store.close();

      if (events.length === 0) {
        console.log("No events found. Import some events first with: workflow-scout import <file>");
        return;
      }

      console.log(`\nAnalyzing ${events.length} events...\n`);

      const patterns = detectPatterns(events, {
        minLength: parseInt(opts.minLength, 10),
        maxLength: parseInt(opts.maxLength, 10),
        minFrequency: parseInt(opts.minFreq, 10),
      });

      if (patterns.length === 0) {
        console.log("No repeated patterns found.");
        console.log("Try recording more browser activity or lowering --min-freq.\n");
        return;
      }

      console.log(`Found ${patterns.length} pattern(s):\n`);

      for (const pat of patterns) {
        printPattern(pat);
      }

      console.log(
        `\nTo export a pattern as an n8n workflow, run:\n  workflow-scout export <pattern-id>\n`
      );

      // Store patterns in a temp file so export can read them without re-analyzing
      const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
      const patternsCache = path.join(homeDir, ".workflow-scout", "patterns-cache.json");
      const dir = path.dirname(patternsCache);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(patternsCache, JSON.stringify(patterns, null, 2));
    }
  );

// ── export ─────────────────────────────────────────────────────────────────────

program
  .command("export <pattern-id>")
  .description("Export a detected pattern as an n8n workflow JSON file")
  .option("-o, --output <file>", "Output file path (default: workflow-<id>.json)")
  .option("--webhook", "Use webhook trigger instead of schedule trigger")
  .action((patternId: string, opts: { output?: string; webhook?: boolean }) => {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
    const patternsCache = path.join(homeDir, ".workflow-scout", "patterns-cache.json");

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

    const json = exportToN8nJson(pattern, {
      webhookTrigger: opts.webhook || false,
      successCheck: true,
    });

    const outFile = opts.output || `workflow-${patternId}.json`;
    const absOut = path.resolve(outFile);
    fs.writeFileSync(absOut, json, "utf-8");

    console.log(`\nn8n workflow exported to: ${absOut}`);
    console.log(`\nTo import into n8n:`);
    console.log(`  1. Open n8n in your browser`);
    console.log(`  2. Go to Workflows -> Import from File`);
    console.log(`  3. Select ${path.basename(absOut)}\n`);
  });

// ── sessions ───────────────────────────────────────────────────────────────────

program
  .command("sessions")
  .description("List recorded sessions")
  .action(() => {
    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);
    const sessions = store.getSessions();
    store.close();

    if (sessions.length === 0) {
      console.log("No sessions found.");
      return;
    }

    console.log(`\n  Sessions (${sessions.length}):\n`);
    for (const s of sessions) {
      console.log(`  ${s.id}  ${s.startedAt}  (${s.eventCount} events)`);
    }
    console.log();
  });

// ── search ─────────────────────────────────────────────────────────────────────

program
  .command("search <query>")
  .description("Search events by URL, selector, or value")
  .action((query: string) => {
    const dbPath = program.opts().db as string | undefined;
    const store = getStore(dbPath);
    const events = store.searchEvents(query);
    store.close();

    if (events.length === 0) {
      console.log(`No events matching "${query}".`);
      return;
    }

    console.log(`\nFound ${events.length} matching events:\n`);
    printTimeline(events);
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
  }
  console.log();
}

// ── parse ──────────────────────────────────────────────────────────────────────

program.parse();
