/**
 * Workflow Scout — Background Service Worker
 *
 * Captures webNavigation events and coordinates with content scripts.
 * All recorded events are persisted to chrome.storage.local.
 */

const STATE_KEY = "ws_state";
const EVENTS_KEY = "ws_events";

// ── helpers ────────────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString();
}

async function getState() {
  const result = await chrome.storage.local.get(STATE_KEY);
  return result[STATE_KEY] || { recording: false, sessionId: null, sessionName: "" };
}

async function setState(patch) {
  const current = await getState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  return next;
}

async function pushEvent(event) {
  const state = await getState();
  if (!state.recording) return;

  const enriched = {
    ...event,
    sessionId: state.sessionId,
    timestamp: event.timestamp || timestamp(),
  };

  const result = await chrome.storage.local.get(EVENTS_KEY);
  const events = result[EVENTS_KEY] || [];
  events.push(enriched);
  await chrome.storage.local.set({ [EVENTS_KEY]: events });
}

// ── webNavigation listeners ────────────────────────────────────────────────────

chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only capture main-frame navigations
  if (details.frameId !== 0) return;

  await pushEvent({
    type: "navigation",
    url: details.url,
    tabId: details.tabId,
  });
});

// ── message handling from content script / popup ───────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.action) {
      case "start": {
        const sessionId = `sess_${Date.now()}`;
        const state = await setState({
          recording: true,
          sessionId,
          sessionName: message.sessionName || sessionId,
        });
        sendResponse({ ok: true, state });
        break;
      }

      case "stop": {
        const state = await setState({ recording: false });
        sendResponse({ ok: true, state });
        break;
      }

      case "getState": {
        const state = await getState();
        const result = await chrome.storage.local.get(EVENTS_KEY);
        const events = result[EVENTS_KEY] || [];
        const sessionEvents = state.sessionId
          ? events.filter((e) => e.sessionId === state.sessionId)
          : [];
        sendResponse({ ok: true, state, eventCount: sessionEvents.length });
        break;
      }

      case "pushEvent": {
        await pushEvent(message.event);
        sendResponse({ ok: true });
        break;
      }

      case "export": {
        const result = await chrome.storage.local.get(EVENTS_KEY);
        const events = result[EVENTS_KEY] || [];
        const state = await getState();
        const sessionEvents = state.sessionId
          ? events.filter((e) => e.sessionId === state.sessionId)
          : events;
        sendResponse({ ok: true, events: sessionEvents });
        break;
      }

      case "exportAll": {
        const result = await chrome.storage.local.get(EVENTS_KEY);
        sendResponse({ ok: true, events: result[EVENTS_KEY] || [] });
        break;
      }

      case "clear": {
        await chrome.storage.local.set({ [EVENTS_KEY]: [] });
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: "Unknown action" });
    }
  })();

  // Return true to indicate we will call sendResponse asynchronously
  return true;
});
