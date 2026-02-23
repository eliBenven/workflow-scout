/**
 * Workflow Scout — Timeline Viewer
 *
 * Pretty-prints an event timeline to the console with colour
 * coding, timestamps, and action descriptions.
 */

import { BrowserEvent } from "./db";

// ── ANSI colours ───────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const COLORS: Record<string, string> = {
  navigation: "\x1b[36m",   // cyan
  click: "\x1b[33m",        // yellow
  form_submit: "\x1b[35m",  // magenta
  input_change: "\x1b[32m", // green
};

const ICONS: Record<string, string> = {
  navigation: "->",
  click: "**",
  form_submit: ">>",
  input_change: "..",
};

// ── Formatting helpers ─────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function shortenUrl(url: string, maxLen: number = 60): string {
  if (url.length <= maxLen) return url;
  try {
    const parsed = new URL(url);
    const shortened = `${parsed.origin}${parsed.pathname}`;
    if (shortened.length <= maxLen) return shortened;
    return shortened.slice(0, maxLen - 3) + "...";
  } catch {
    return url.slice(0, maxLen - 3) + "...";
  }
}

function describeEvent(event: BrowserEvent): string {
  switch (event.type) {
    case "navigation":
      return `Navigate to ${shortenUrl(event.url)}`;
    case "click":
      return `Click ${event.selector || "element"} on ${shortenUrl(event.url, 40)}`;
    case "form_submit": {
      let desc = `Submit form on ${shortenUrl(event.url, 40)}`;
      if (event.meta) {
        try {
          const meta = JSON.parse(event.meta);
          if (meta.method) desc += ` [${meta.method}]`;
        } catch {
          // ignore
        }
      }
      return desc;
    }
    case "input_change":
      return `Change input ${event.selector || ""} on ${shortenUrl(event.url, 40)}`;
    default:
      return `${event.type} on ${shortenUrl(event.url)}`;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Print a formatted timeline to stdout.
 */
export function printTimeline(events: BrowserEvent[]): void {
  if (events.length === 0) {
    console.log(`${DIM}No events to display.${RESET}`);
    return;
  }

  const sessionIds = [...new Set(events.map((e) => e.sessionId))];
  const multiSession = sessionIds.length > 1;

  console.log();
  console.log(`${BOLD}  Event Timeline (${events.length} events)${RESET}`);
  console.log(`${DIM}  ${"=".repeat(60)}${RESET}`);

  let currentSession = "";

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const color = COLORS[event.type] || DIM;
    const icon = ICONS[event.type] || "  ";
    const time = formatTime(event.timestamp);
    const desc = describeEvent(event);

    // Session header
    if (multiSession && event.sessionId !== currentSession) {
      currentSession = event.sessionId;
      console.log();
      console.log(`${BOLD}  --- Session: ${currentSession} ---${RESET}`);
    }

    // Event line
    const lineNum = String(i + 1).padStart(4, " ");
    console.log(
      `${DIM}${lineNum}${RESET}  ${DIM}${time}${RESET}  ${color}${icon} ${event.type.padEnd(13)}${RESET} ${desc}`
    );

    // Show selector or value details if present (indented)
    if (event.selector) {
      console.log(`${DIM}        selector: ${event.selector}${RESET}`);
    }
    if (event.value) {
      const displayVal = event.value.length > 80 ? event.value.slice(0, 77) + "..." : event.value;
      console.log(`${DIM}        value: ${displayVal}${RESET}`);
    }
  }

  console.log(`${DIM}  ${"=".repeat(60)}${RESET}`);
  console.log();
}

/**
 * Return a plain-text timeline (no ANSI codes) for file export.
 */
export function timelineToText(events: BrowserEvent[]): string {
  const lines: string[] = [];
  lines.push(`Event Timeline (${events.length} events)`);
  lines.push("=".repeat(60));

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const time = formatTime(event.timestamp);
    const icon = ICONS[event.type] || "  ";
    const desc = describeEvent(event);
    lines.push(`${String(i + 1).padStart(4)} ${time} ${icon} ${event.type.padEnd(13)} ${desc}`);
  }

  lines.push("=".repeat(60));
  return lines.join("\n");
}
