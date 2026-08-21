const PRESETS = [1, 5, 10, 15, 30, 60, 120, 300];

function formatPeriod(seconds) {
  if (seconds >= 60) {
    const mins = seconds / 60;
    return `${mins}m`;
  }
  return `${seconds}s`;
}

const $presetButtons = document.getElementById("presetButtons");
const $stop = document.getElementById("stop");
const $status = document.getElementById("status");

function renderOptions() {
  PRESETS.forEach((sec) => {
    const btn = document.createElement("button");
    btn.textContent = formatPeriod(sec);
    btn.addEventListener("click", () => setRefresh(sec));
    $presetButtons.appendChild(btn);
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
    const label = interval >= 60 ? `${interval / 60} minute${interval / 60 === 1 ? '' : 's'}` : `${interval} second${interval === 1 ? '' : 's'}`;
    setCurrentStatus(`Active: every ${label}`);
  } else {
    setCurrentStatus("Stopped");
  }
}

async function setRefresh(seconds) {
  const tabId = await getActiveTabId();
  if (!tabId) return;

  const validated = Math.max(1, Math.min(3600, Number(seconds) || 0));
  if (validated < 1) {
    setCurrentStatus("Interval must be at least 1 second");
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

$stop.addEventListener("click", stopRefresh);

document.getElementById("manage").addEventListener("click", () => {
  browser.tabs.create({ url: browser.runtime.getURL("manage.html") });
});

browser.runtime.onMessage.addListener((message) => {
  if (message === "update") {
    refreshUI();
  }
});

renderOptions();
refreshUI();

// Function to update and display the extension version
async function updateVersionDisplay() {
  try {
    const manifest = await browser.runtime.getManifest();
    const versionText = `Version: ${manifest.version}`;
    const versionElement = document.getElementById("version");
    if (versionElement) {
      versionElement.textContent = versionText;
    } else {
      console.error("Could not find the version display element in popup.html");
    }
  } catch (e) {
    console.error("Error fetching or displaying extension version:", e);
  }
}
// Call the version update function at startup
updateVersionDisplay();
