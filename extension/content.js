/**
 * Workflow Scout — Content Script
 *
 * Captures DOM-level interactions: clicks (with CSS selectors),
 * form submissions (with field names/values), and input changes.
 */

// ── utilities ──────────────────────────────────────────────────────────────────

/**
 * Build a reasonably unique CSS selector for an element.
 */
function getSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const parts = [];
  let current = el;

  while (current && current !== document.body && parts.length < 5) {
    let segment = current.tagName.toLowerCase();

    if (current.id) {
      segment = `#${CSS.escape(current.id)}`;
      parts.unshift(segment);
      break;
    }

    if (current.className && typeof current.className === "string") {
      const classes = current.className
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join("");
      if (classes) segment += classes;
    }

    // nth-child for disambiguation
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        segment += `:nth-child(${index})`;
      }
    }

    parts.unshift(segment);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

/**
 * Send an event to the background service worker.
 */
function send(event) {
  try {
    chrome.runtime.sendMessage({ action: "pushEvent", event });
  } catch {
    // Extension context may be invalidated; silently ignore.
  }
}

// ── click listener ─────────────────────────────────────────────────────────────

document.addEventListener(
  "click",
  (e) => {
    const target = e.target;
    if (!target || !target.tagName) return;

    send({
      type: "click",
      url: location.href,
      selector: getSelector(target),
      tagName: target.tagName.toLowerCase(),
      text: (target.textContent || "").trim().slice(0, 120),
      timestamp: new Date().toISOString(),
    });
  },
  true // capture phase so we don't miss stopped-propagation clicks
);

// ── form submit listener ───────────────────────────────────────────────────────

document.addEventListener(
  "submit",
  (e) => {
    const form = e.target;
    if (!form || form.tagName !== "FORM") return;

    const fields = {};
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
      // Omit password values for safety
      if (key.toLowerCase().includes("password") || key.toLowerCase().includes("passwd")) {
        fields[key] = "[REDACTED]";
      } else {
        fields[key] = typeof value === "string" ? value.slice(0, 500) : "[file]";
      }
    }

    send({
      type: "form_submit",
      url: location.href,
      selector: getSelector(form),
      action: form.action || location.href,
      method: (form.method || "GET").toUpperCase(),
      fields,
      timestamp: new Date().toISOString(),
    });
  },
  true
);

// ── input change listener (throttled) ──────────────────────────────────────────

let inputTimeout = null;

document.addEventListener(
  "change",
  (e) => {
    const target = e.target;
    if (!target) return;
    const tag = target.tagName.toLowerCase();
    if (tag !== "input" && tag !== "select" && tag !== "textarea") return;

    // Debounce to avoid flooding on rapid changes
    clearTimeout(inputTimeout);
    inputTimeout = setTimeout(() => {
      const inputType = target.type || "text";
      const isPassword =
        inputType === "password" ||
        (target.name || "").toLowerCase().includes("password");

      send({
        type: "input_change",
        url: location.href,
        selector: getSelector(target),
        tagName: tag,
        inputType,
        name: target.name || "",
        value: isPassword ? "[REDACTED]" : (target.value || "").slice(0, 500),
        timestamp: new Date().toISOString(),
      });
    }, 300);
  },
  true
);
