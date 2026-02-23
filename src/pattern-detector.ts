/**
 * Workflow Scout — Pattern Detector
 *
 * Finds repeated subsequences of browser events that indicate
 * automatable workflows. Uses a sliding-window approach to
 * identify event sequences that recur at least twice.
 */

import { BrowserEvent } from "./db";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DetectedPattern {
  id: string;
  /** The canonical sequence of steps in this pattern */
  steps: PatternStep[];
  /** How many times this exact sequence was observed */
  frequency: number;
  /** Confidence score 0-1 based on frequency and consistency */
  confidence: number;
  /** Indexes of occurrences in the original event stream */
  occurrences: number[][];
  /** Human-readable label */
  label: string;
}

export interface PatternStep {
  type: string;
  urlPattern: string;
  selector?: string;
  description: string;
  /** Captured form field names/example values (from first occurrence) */
  formFields?: Record<string, string>;
  /** HTTP method used (POST, GET, etc.) */
  httpMethod?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Normalise a URL into a pattern by stripping query params, hashes,
 * and replacing numeric path segments with placeholders.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Replace numeric-only path segments with :id
    const pathNorm = parsed.pathname
      .split("/")
      .map((seg) => (/^\d+$/.test(seg) ? ":id" : seg))
      .join("/");
    return `${parsed.origin}${pathNorm}`;
  } catch {
    return url;
  }
}

/**
 * Create a fingerprint for an event that abstracts away specific values
 * but preserves the structural action.
 */
function fingerprint(event: BrowserEvent): string {
  const urlNorm = normalizeUrl(event.url);
  const parts = [event.type, urlNorm];

  if (event.selector) {
    // Keep just the tag/class portion, strip nth-child specifics
    const selectorNorm = event.selector.replace(/:nth-child\(\d+\)/g, "");
    parts.push(selectorNorm);
  }

  return parts.join("|");
}

/**
 * Turn a fingerprint back into a PatternStep for presentation.
 * If an original event is supplied, metadata (form fields, method) is extracted.
 */
function fingerprintToStep(fp: string, event?: BrowserEvent): PatternStep {
  const [type, urlPattern, selector] = fp.split("|");
  const descriptions: Record<string, string> = {
    navigation: `Navigate to ${urlPattern}`,
    click: `Click ${selector || "element"} on ${urlPattern}`,
    form_submit: `Submit form on ${urlPattern}`,
    input_change: `Fill input ${selector || ""} on ${urlPattern}`,
  };

  const step: PatternStep = {
    type,
    urlPattern,
    selector: selector || undefined,
    description: descriptions[type] || `${type} on ${urlPattern}`,
  };

  // Extract form field metadata from the original event
  if (event?.meta) {
    try {
      const meta = JSON.parse(event.meta);
      if (meta.fields && typeof meta.fields === "object") {
        step.formFields = meta.fields as Record<string, string>;
      }
      if (meta.method) {
        step.httpMethod = meta.method as string;
      }
    } catch {
      // Malformed meta — ignore
    }
  }

  return step;
}

// ── Detector ───────────────────────────────────────────────────────────────────

export interface DetectorOptions {
  /** Minimum sequence length to consider */
  minLength?: number;
  /** Maximum sequence length to consider */
  maxLength?: number;
  /** Minimum number of repetitions to qualify as a pattern */
  minFrequency?: number;
}

const DEFAULTS: Required<DetectorOptions> = {
  minLength: 2,
  maxLength: 15,
  minFrequency: 2,
};

/**
 * Detect repeated patterns in a stream of browser events.
 *
 * Algorithm:
 * 1. Fingerprint every event.
 * 2. For each window size (minLength..maxLength), slide across the
 *    fingerprint array and collect subsequences.
 * 3. Count occurrences of each unique subsequence.
 * 4. Return subsequences that appear >= minFrequency times,
 *    ranked by a composite score of (frequency * length).
 */
export function detectPatterns(
  events: BrowserEvent[],
  options: DetectorOptions = {}
): DetectedPattern[] {
  const opts = { ...DEFAULTS, ...options };
  const fingerprints = events.map(fingerprint);
  const n = fingerprints.length;

  // Map: serialized subsequence -> list of start indexes
  const seqMap = new Map<string, number[]>();

  for (let winLen = opts.minLength; winLen <= Math.min(opts.maxLength, n); winLen++) {
    for (let i = 0; i <= n - winLen; i++) {
      const subseq = fingerprints.slice(i, i + winLen);
      const key = subseq.join(">>>"); // delimited join

      if (!seqMap.has(key)) {
        seqMap.set(key, []);
      }
      seqMap.get(key)!.push(i);
    }
  }

  // Filter to patterns that meet the minimum frequency and whose
  // occurrences do not overlap (DP-based maximum non-overlapping selection).
  const raw: DetectedPattern[] = [];
  let idCounter = 0;

  for (const [key, starts] of seqMap) {
    if (starts.length < opts.minFrequency) continue;

    const fps = key.split(">>>");
    const seqLen = fps.length;

    // DP: find the maximum set of non-overlapping intervals.
    // Each interval is [start, start + seqLen).
    // Sort by end position, then use weighted interval scheduling DP.
    const sorted = [...starts].sort((a, b) => a - b);
    const dpCount = new Array<number>(sorted.length).fill(0);
    const dpPick = new Array<boolean>(sorted.length).fill(false);

    for (let i = 0; i < sorted.length; i++) {
      // Option 1: skip this occurrence
      const skip = i > 0 ? dpCount[i - 1] : 0;

      // Option 2: take this occurrence
      // Find the latest occurrence that ends before this one starts
      let take = 1;
      const myStart = sorted[i];
      // Binary search for the rightmost j where sorted[j] + seqLen <= myStart
      let lo = 0, hi = i - 1, best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] + seqLen <= myStart) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best >= 0) take += dpCount[best];

      if (take > skip) {
        dpCount[i] = take;
        dpPick[i] = true;
      } else {
        dpCount[i] = skip;
        dpPick[i] = false;
      }
    }

    // Backtrack to find selected occurrences
    const selected: number[] = [];
    let i = sorted.length - 1;
    while (i >= 0) {
      if (dpPick[i]) {
        selected.push(sorted[i]);
        // Jump to the latest compatible predecessor
        const myStart = sorted[i];
        while (i >= 0 && sorted[i] + seqLen > myStart) i--;
      } else {
        i--;
      }
    }
    selected.reverse();

    if (selected.length < opts.minFrequency) continue;

    const nonOverlapping = selected.map((start) =>
      Array.from({ length: seqLen }, (_, k) => start + k)
    );

    // Build steps using the first occurrence's original events for metadata
    const firstOccStart = selected[0];
    const steps = fps.map((fp, idx) =>
      fingerprintToStep(fp, events[firstOccStart + idx])
    );

    const frequency = nonOverlapping.length;
    const confidence = Math.min(1, (frequency * seqLen) / (n * 0.5));

    idCounter++;
    raw.push({
      id: `pat_${idCounter}`,
      steps,
      frequency,
      confidence: Math.round(confidence * 100) / 100,
      occurrences: nonOverlapping,
      label: buildLabel(steps),
    });
  }

  // Sort by composite score (frequency * step count) descending
  raw.sort((a, b) => {
    const scoreA = a.frequency * a.steps.length * a.confidence;
    const scoreB = b.frequency * b.steps.length * b.confidence;
    return scoreB - scoreA;
  });

  // De-duplicate: remove patterns that are strict sub-sequences of
  // a higher-ranked pattern.
  const result: DetectedPattern[] = [];
  const usedKeys = new Set<string>();

  for (const pat of raw) {
    const patKey = pat.steps.map((s) => `${s.type}|${s.urlPattern}`).join(">");
    let isSubset = false;
    for (const used of usedKeys) {
      if (used.includes(patKey)) {
        isSubset = true;
        break;
      }
    }
    if (!isSubset) {
      // Re-assign a clean sequential ID
      pat.id = `pat_${result.length + 1}`;
      result.push(pat);
      usedKeys.add(patKey);
    }
  }

  return result;
}

/**
 * Auto-tune detection parameters by running multiple passes and selecting
 * the configuration that yields the highest composite score.
 */
export function autoTuneAndDetect(
  events: BrowserEvent[]
): DetectedPattern[] {
  const candidates: { patterns: DetectedPattern[]; score: number }[] = [];

  const minLengths = [2, 3];
  const maxLengths = [8, 12, 15];
  const minFreqs = [2, 3];

  for (const minLength of minLengths) {
    for (const maxLength of maxLengths) {
      for (const minFrequency of minFreqs) {
        if (minLength > maxLength) continue;
        const patterns = detectPatterns(events, { minLength, maxLength, minFrequency });
        // Composite score: sum of (frequency * step_count * confidence) across all patterns
        const score = patterns.reduce(
          (sum, p) => sum + p.frequency * p.steps.length * p.confidence,
          0
        );
        candidates.push({ patterns, score });
      }
    }
  }

  // Pick the configuration with the highest score
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0].patterns : [];
}

/**
 * Build a short human-readable label for a pattern.
 */
function buildLabel(steps: PatternStep[]): string {
  const types = [...new Set(steps.map((s) => s.type))];
  const hosts = [
    ...new Set(
      steps.map((s) => {
        try {
          return new URL(s.urlPattern).hostname;
        } catch {
          return "unknown";
        }
      })
    ),
  ];

  const typeLabel = types.length === 1 ? types[0] : "multi-step";
  const hostLabel = hosts.length === 1 ? hosts[0] : `${hosts.length} sites`;

  return `${steps.length}-step ${typeLabel} workflow on ${hostLabel}`;
}
