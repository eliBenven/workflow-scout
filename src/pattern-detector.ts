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
 */
function fingerprintToStep(fp: string): PatternStep {
  const [type, urlPattern, selector] = fp.split("|");
  const descriptions: Record<string, string> = {
    navigation: `Navigate to ${urlPattern}`,
    click: `Click ${selector || "element"} on ${urlPattern}`,
    form_submit: `Submit form on ${urlPattern}`,
    input_change: `Fill input ${selector || ""} on ${urlPattern}`,
  };
  return {
    type,
    urlPattern,
    selector: selector || undefined,
    description: descriptions[type] || `${type} on ${urlPattern}`,
  };
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
  // occurrences do not overlap (greedy non-overlapping selection).
  const raw: DetectedPattern[] = [];
  let idCounter = 0;

  for (const [key, starts] of seqMap) {
    if (starts.length < opts.minFrequency) continue;

    const fps = key.split(">>>");
    const seqLen = fps.length;

    // Greedy non-overlapping selection
    const nonOverlapping: number[][] = [];
    let lastEnd = -1;
    for (const start of starts) {
      if (start >= lastEnd) {
        nonOverlapping.push(
          Array.from({ length: seqLen }, (_, k) => start + k)
        );
        lastEnd = start + seqLen;
      }
    }

    if (nonOverlapping.length < opts.minFrequency) continue;

    const steps = fps.map(fingerprintToStep);
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
