/**
 * Workflow Scout — Content Script
 *
 * Captures DOM-level interactions: clicks (with CSS selectors),
 * form submissions (with field names/values), input changes,
 * and outgoing API calls (fetch + XMLHttpRequest).
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
 * Patterns that indicate sensitive data in field names.
 * These fields will have their values redacted.
 */
const SENSITIVE_FIELD_PATTERNS = [
  "password", "passwd", "pwd",
  "secret", "token", "api_key", "apikey", "api-key",
  "credit", "card", "ccnum", "cvv", "cvc", "ccv",
  "ssn", "social_security", "social-security",
  "routing", "account_number", "account-number",
  "pin",
];

/**
 * Patterns that indicate sensitive data in field values.
 */
const SENSITIVE_VALUE_PATTERNS = [
  /^\d{13,19}$/,              // credit card numbers (13-19 digits)
  /^\d{3}-\d{2}-\d{4}$/,     // SSN format (XXX-XX-XXXX)
  /^\d{9}$/,                  // SSN without dashes
  /^sk[-_].{20,}$/i,          // Stripe-style secret keys
  /^(ghp|gho|ghu|ghs|ghr)_/, // GitHub tokens
  /^eyJ[A-Za-z0-9-_]+\./,    // JWT tokens
];

function isSensitiveFieldName(name) {
  const lower = name.toLowerCase();
  return SENSITIVE_FIELD_PATTERNS.some((pat) => lower.includes(pat));
}

function isSensitiveValue(value) {
  if (typeof value !== "string") return false;
  return SENSITIVE_VALUE_PATTERNS.some((re) => re.test(value.trim()));
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
      if (isSensitiveFieldName(key)) {
        fields[key] = "[REDACTED]";
      } else if (typeof value === "string") {
        fields[key] = isSensitiveValue(value)
          ? "[REDACTED]"
          : value.slice(0, 500);
      } else {
        fields[key] = "[file]";
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
      const fieldName = target.name || "";
      const isSensitive =
        inputType === "password" ||
        isSensitiveFieldName(fieldName) ||
        isSensitiveValue(target.value || "");

      send({
        type: "input_change",
        url: location.href,
        selector: getSelector(target),
        tagName: tag,
        inputType,
        name: fieldName,
        value: isSensitive ? "[REDACTED]" : (target.value || "").slice(0, 500),
        timestamp: new Date().toISOString(),
      });
    }, 300);
  },
  true
);

// ── API call interception (fetch + XHR) ───────────────────────────────────────

/**
 * Headers that are always redacted (contain auth/session data).
 */
const SENSITIVE_HEADERS = [
  "authorization", "cookie", "set-cookie",
  "x-api-key", "x-auth-token", "x-csrf-token",
  "proxy-authorization",
];

/**
 * Content types that indicate an API call worth capturing.
 */
const API_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain", // some APIs use this
];

/**
 * URL patterns to skip (static assets, analytics, extensions).
 */
function shouldSkipUrl(url) {
  if (!url || typeof url !== "string") return true;
  // Skip data URIs, blobs, chrome extensions
  if (/^(data:|blob:|chrome-extension:|moz-extension:)/.test(url)) return true;
  // Skip common static asset extensions
  if (/\.(css|js|woff2?|ttf|eot|svg|png|jpe?g|gif|ico|webp|mp[34]|wav|ogg)(\?|$)/i.test(url)) return true;
  // Skip common analytics/tracking endpoints
  if (/google-analytics\.com|googletagmanager\.com|facebook\.com\/tr|analytics\./i.test(url)) return true;
  return false;
}

/**
 * Redact sensitive headers, keep the rest for workflow reproduction.
 */
function sanitizeHeaders(headers) {
  var result = {};
  if (!headers) return result;

  // Handle Headers object, plain object, or array of [key, value]
  var entries = [];
  if (typeof headers.entries === "function") {
    for (var pair of headers.entries()) {
      entries.push([pair[0], pair[1]]);
    }
  } else if (Array.isArray(headers)) {
    entries = headers;
  } else if (typeof headers === "object") {
    entries = Object.entries(headers);
  }

  for (var i = 0; i < entries.length; i++) {
    var key = (entries[i][0] || "").toLowerCase();
    var value = entries[i][1] || "";
    if (SENSITIVE_HEADERS.includes(key)) {
      result[key] = "[REDACTED]";
    } else if (isSensitiveValue(String(value))) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = String(value).slice(0, 500);
    }
  }
  return result;
}

/**
 * Safely extract and truncate a request body.
 */
function sanitizeBody(body) {
  if (!body) return null;

  var text = "";
  if (typeof body === "string") {
    text = body;
  } else if (body instanceof URLSearchParams) {
    text = body.toString();
  } else if (typeof FormData !== "undefined" && body instanceof FormData) {
    var parts = [];
    for (var pair of body.entries()) {
      var key = pair[0];
      var val = pair[1];
      if (isSensitiveFieldName(key)) {
        parts.push(key + "=[REDACTED]");
      } else if (typeof val === "string") {
        parts.push(key + "=" + (isSensitiveValue(val) ? "[REDACTED]" : val.slice(0, 200)));
      } else {
        parts.push(key + "=[file]");
      }
    }
    return parts.join("&");
  } else {
    try {
      text = JSON.stringify(body);
    } catch {
      return "[unserializable]";
    }
  }

  // Redact sensitive values in JSON body
  if (text.length > 2000) text = text.slice(0, 2000) + "...[truncated]";

  try {
    var parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null) {
      for (var k in parsed) {
        if (isSensitiveFieldName(k)) {
          parsed[k] = "[REDACTED]";
        } else if (typeof parsed[k] === "string" && isSensitiveValue(parsed[k])) {
          parsed[k] = "[REDACTED]";
        }
      }
      return JSON.stringify(parsed);
    }
  } catch {
    // Not JSON, return as-is
  }

  return text;
}

// ── fetch() interception ──────────────────────────────────────────────────────

var _originalFetch = window.fetch;

window.fetch = function (input, init) {
  var url = typeof input === "string" ? input : (input && input.url ? input.url : "");
  var method = (init && init.method) || (input && input.method) || "GET";
  method = method.toUpperCase();

  // Resolve relative URLs
  try {
    url = new URL(url, location.href).href;
  } catch {}

  if (shouldSkipUrl(url)) {
    return _originalFetch.apply(this, arguments);
  }

  var requestHeaders = sanitizeHeaders(
    (init && init.headers) || (input && input.headers) || {}
  );
  var requestBody = sanitizeBody((init && init.body) || null);

  var startTime = Date.now();

  return _originalFetch.apply(this, arguments).then(function (response) {
    var contentType = response.headers.get("content-type") || "";
    var isApiResponse = API_CONTENT_TYPES.some(function (ct) {
      return contentType.toLowerCase().includes(ct);
    });

    // Only capture if it looks like an API call (not HTML pages)
    if (isApiResponse || method !== "GET") {
      send({
        type: "api_call",
        url: url,
        method: method,
        statusCode: response.status,
        requestHeaders: requestHeaders,
        requestBody: requestBody,
        responseContentType: contentType.split(";")[0].trim(),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }

    return response;
  }).catch(function (err) {
    // Still record failed requests
    send({
      type: "api_call",
      url: url,
      method: method,
      statusCode: 0,
      requestHeaders: requestHeaders,
      requestBody: requestBody,
      responseContentType: null,
      durationMs: Date.now() - startTime,
      error: err.message || "Network error",
      timestamp: new Date().toISOString(),
    });
    throw err;
  });
};

// ── XMLHttpRequest interception ───────────────────────────────────────────────

var _originalXhrOpen = XMLHttpRequest.prototype.open;
var _originalXhrSend = XMLHttpRequest.prototype.send;
var _originalXhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;

XMLHttpRequest.prototype.open = function (method, url) {
  this._wsMethod = (method || "GET").toUpperCase();
  // Resolve relative URLs
  try {
    this._wsUrl = new URL(url, location.href).href;
  } catch {
    this._wsUrl = url;
  }
  this._wsHeaders = {};
  return _originalXhrOpen.apply(this, arguments);
};

XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
  if (this._wsHeaders) {
    this._wsHeaders[name] = value;
  }
  return _originalXhrSetHeader.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function (body) {
  var xhr = this;
  var url = xhr._wsUrl || "";
  var method = xhr._wsMethod || "GET";

  if (!shouldSkipUrl(url)) {
    var requestHeaders = sanitizeHeaders(xhr._wsHeaders || {});
    var requestBody = sanitizeBody(body);
    var startTime = Date.now();

    xhr.addEventListener("loadend", function () {
      var contentType = "";
      try {
        contentType = xhr.getResponseHeader("content-type") || "";
      } catch {}

      var isApiResponse = API_CONTENT_TYPES.some(function (ct) {
        return contentType.toLowerCase().includes(ct);
      });

      if (isApiResponse || method !== "GET") {
        send({
          type: "api_call",
          url: url,
          method: method,
          statusCode: xhr.status,
          requestHeaders: requestHeaders,
          requestBody: requestBody,
          responseContentType: contentType.split(";")[0].trim(),
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  return _originalXhrSend.apply(this, arguments);
};
