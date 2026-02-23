/**
 * Workflow Scout — Popup UI Controller
 */

const $ = (sel) => document.querySelector(sel);

const elSessionName = $("#session-name");
const elStatus = $("#status-text");
const elDot = $("#dot");
const elEventCount = $("#event-count");
const btnStart = $("#btn-start");
const btnStop = $("#btn-stop");
const btnExport = $("#btn-export");
const btnClear = $("#btn-clear");

// ── state sync ─────────────────────────────────────────────────────────────────

function refreshUI() {
  chrome.runtime.sendMessage({ action: "getState" }, (res) => {
    if (!res || !res.ok) return;

    const { state, eventCount } = res;

    if (state.recording) {
      elStatus.textContent = "Recording";
      elDot.classList.add("active");
      btnStart.disabled = true;
      btnStop.disabled = false;
      elSessionName.value = state.sessionName || "";
      elSessionName.disabled = true;
    } else {
      elStatus.textContent = "Idle";
      elDot.classList.remove("active");
      btnStart.disabled = false;
      btnStop.disabled = true;
      elSessionName.disabled = false;
    }

    elEventCount.textContent = String(eventCount || 0);
  });
}

// ── actions ────────────────────────────────────────────────────────────────────

btnStart.addEventListener("click", () => {
  const sessionName = elSessionName.value.trim() || undefined;
  chrome.runtime.sendMessage({ action: "start", sessionName }, () => {
    refreshUI();
  });
});

btnStop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop" }, () => {
    refreshUI();
  });
});

btnExport.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "exportAll" }, (res) => {
    if (!res || !res.ok) return;

    const blob = new Blob([JSON.stringify(res.events, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-scout-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

btnClear.addEventListener("click", () => {
  if (!confirm("Delete all recorded events?")) return;
  chrome.runtime.sendMessage({ action: "clear" }, () => {
    refreshUI();
  });
});

// ── init ───────────────────────────────────────────────────────────────────────

refreshUI();

// Refresh every 2 seconds while popup is open
setInterval(refreshUI, 2000);
