const PRESETS = [1, 5, 10, 15, 30, 60, 120, 300];

const $interval = document.getElementById("interval");
const $customSeconds = document.getElementById("customSeconds");
const $setCustom = document.getElementById("setCustom");
const $start = document.getElementById("start");
const $stop = document.getElementById("stop");
const $status = document.getElementById("status");

function renderOptions() {
  PRESETS.forEach((sec) => {
    const opt = document.createElement("option");
    opt.value = sec;
    opt.textContent = `${sec} sec`;
    $interval.appendChild(opt);
  });
}

async function getActiveTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id || 0;
}

async function getCurrentInterval(tabId) {
  const state = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  return state[tabId] || 0;
}

async function setCurrentStatus(text) {
  $status.textContent = text;
}

async function refreshUI() {
  const tabId = await getActiveTabId();
  if (!tabId) {
    setCurrentStatus("No active tab");
    return;
  }

  const interval = await getCurrentInterval(tabId);
  if (interval > 0) {
    setCurrentStatus(`Active: every ${interval} seconds`);
  } else {
    setCurrentStatus("Stopped");
  }
}

async function setRefresh(seconds) {
  const tabId = await getActiveTabId();
  if (!tabId) return;

  const validated = Math.max(5, Math.min(3600, Number(seconds) || 0));
  if (validated < 5) {
    setCurrentStatus("Interval must be at least 5 seconds");
    return;
  }

  await browser.runtime.sendMessage({ method: "set", tabId, seconds: validated });
  await refreshUI();
}

async function stopRefresh() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  await browser.runtime.sendMessage({ method: "stop", tabId });
  await refreshUI();
}

$interval.addEventListener("change", () => setRefresh($interval.value));
$setCustom.addEventListener("click", () => setRefresh($customSeconds.value));
$start.addEventListener("click", () => setRefresh($interval.value));
$stop.addEventListener("click", stopRefresh);

browser.runtime.onMessage.addListener((message) => {
  if (message === "update") {
    refreshUI();
  }
});

renderOptions();
refreshUI();
