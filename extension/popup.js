/**
 * Workflow Scout — Popup UI Controller
 */

const $ = (sel) => document.querySelector(sel);

const elSessionName = $("#session-name");
const elStatus = $("#status-text");
const elDot = $("#dot");
const elDuration = $("#duration");
const elEventCount = $("#event-count");
const elNavCount = $("#nav-count");
const elClickCount = $("#click-count");
const elFormCount = $("#form-count");
const elApiCount = $("#api-count");
const btnStart = $("#btn-start");
const btnStop = $("#btn-stop");
const btnExport = $("#btn-export");
const btnClear = $("#btn-clear");
const elSessionInfo = $("#session-info");
const elSessionIdDisplay = $("#session-id-display");

let recordingStartTime = null;
let durationInterval = null;

// ── duration formatting ─────────────────────────────────────────────────────

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;

  if (hours > 0) {
    return `${hours}h ${String(remainMins).padStart(2, "0")}m ${String(secs).padStart(2, "0")}s`;
  }
  return `${remainMins}m ${String(secs).padStart(2, "0")}s`;
}

function startDurationTimer() {
  stopDurationTimer();
  durationInterval = setInterval(() => {
    if (recordingStartTime) {
      elDuration.textContent = formatDuration(Date.now() - recordingStartTime);
    }
  }, 1000);
}

function stopDurationTimer() {
  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
  }
}

// ── state sync ──────────────────────────────────────────────────────────────

function refreshUI() {
  chrome.runtime.sendMessage({ action: "getState" }, (res) => {
    if (!res || !res.ok) return;

    const { state, eventCount, typeCounts } = res;

    if (state.recording) {
      elStatus.textContent = "Recording";
      elDot.classList.add("active");
      btnStart.disabled = true;
      btnStop.disabled = false;
      elSessionName.value = state.sessionName || "";
      elSessionName.disabled = true;

      // Show session info
      elSessionInfo.style.display = "block";
      elSessionIdDisplay.textContent = state.sessionId || "";

      // Start/continue duration timer
      if (state.startedAt && !recordingStartTime) {
        recordingStartTime = new Date(state.startedAt).getTime();
        startDurationTimer();
      }
    } else {
      elStatus.textContent = "Idle";
      elDot.classList.remove("active");
      btnStart.disabled = false;
      btnStop.disabled = true;
      elSessionName.disabled = false;
      elDuration.textContent = "";
      elSessionInfo.style.display = "none";
      recordingStartTime = null;
      stopDurationTimer();
    }

    elEventCount.textContent = String(eventCount || 0);

    // Update type breakdown
    if (typeCounts) {
      elNavCount.textContent = String(typeCounts.navigation || 0);
      elClickCount.textContent = String(typeCounts.click || 0);
      elFormCount.textContent = String(
        (typeCounts.form_submit || 0) + (typeCounts.input_change || 0)
      );
      elApiCount.textContent = String(typeCounts.api_call || 0);
    }
  });
}

// ── actions ─────────────────────────────────────────────────────────────────

btnStart.addEventListener("click", () => {
  const sessionName = elSessionName.value.trim() || undefined;
  chrome.runtime.sendMessage({ action: "start", sessionName }, () => {
    recordingStartTime = Date.now();
    startDurationTimer();
    refreshUI();
  });
});

btnStop.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "stop" }, () => {
    stopDurationTimer();
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

// ── init ────────────────────────────────────────────────────────────────────

refreshUI();

// Refresh every 2 seconds while popup is open
setInterval(refreshUI, 2000);
