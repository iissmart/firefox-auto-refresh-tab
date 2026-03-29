const CONTEXT_MENU_PREFIX = "auto-refresh-";
const MAX_INTERVAL_SECS = 3600;

const STATIC_PERIODS = [1, 5, 10, 15, 30, 60, 120, 300];

const nextRefreshTimes = {};
let updateInterval = null;

function getAlarmName(tabId) {
  return `autoRefresh-${tabId}`;
}

function createIconSVG(size, color, text = '') {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 4}" fill="${color}" stroke="#000" stroke-width="2"/>
    ${text ? `<text x="${size/2}" y="${size/2 + 10}" font-size="32" font-weight="bold" fill="white" text-anchor="middle">${text}</text>` : ''}
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

async function updateIcon() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab) return;

  const interval = await getTabAutoRefreshInterval(activeTab.id);
  if (interval > 0 && nextRefreshTimes[activeTab.id]) {
    const remaining = Math.max(0, Math.ceil((nextRefreshTimes[activeTab.id] - Date.now()) / 1000));
    browser.action.setIcon({ path: createIconSVG(48, '#aa0000', remaining.toString()) });
  } else {
    browser.action.setIcon({ path: 'icon48.svg' });
  }
}

function startIconUpdates() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(updateIcon, 1000);
}

function stopIconUpdates() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  updateIcon();
}

async function setTabAutoRefresh(tabId, seconds) {
  if (!tabId || seconds <= 0 || seconds > MAX_INTERVAL_SECS) {
    return clearTabAutoRefresh(tabId);
  }

  await browser.alarms.clear(getAlarmName(tabId));
  await browser.alarms.create(getAlarmName(tabId), { periodInMinutes: seconds / 60 });

  const state = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  state[tabId] = seconds;
  await browser.storage.local.set({ refreshMap: state });

  nextRefreshTimes[tabId] = Date.now() + seconds * 1000;

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].id === tabId) {
    startIconUpdates();
  }

  try {
    await browser.tabs.reload(tabId, { bypassCache: false });
  } catch (error) {
    // If tab is unavailable, clear the interval.
    await clearTabAutoRefresh(tabId);
  }

  updateIcon();

  return state;
}

async function clearTabAutoRefresh(tabId) {
  if (!tabId) return;

  await browser.alarms.clear(getAlarmName(tabId));

  const data = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  if (data.hasOwnProperty(tabId)) {
    delete data[tabId];
    await browser.storage.local.set({ refreshMap: data });
  }

  delete nextRefreshTimes[tabId];

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].id === tabId) {
    stopIconUpdates();
  }

  updateIcon();

  return data;
}

async function getTabAutoRefreshInterval(tabId) {
  const state = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  return state[tabId] || 0;
}

function buildContextMenu() {
  browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({
      id: `${CONTEXT_MENU_PREFIX}header`,
      title: "Auto refresh this tab",
      contexts: ["page", "tab"]
    });

    browser.contextMenus.create({
      id: `${CONTEXT_MENU_PREFIX}stop`,
      title: "Stop refreshing",
      parentId: `${CONTEXT_MENU_PREFIX}header`,
      contexts: ["page", "tab"]
    });

    STATIC_PERIODS.forEach((s) => {
      browser.contextMenus.create({
        id: `${CONTEXT_MENU_PREFIX}${s}`,
        title: `Every ${s} seconds`,
        parentId: `${CONTEXT_MENU_PREFIX}header`,
        contexts: ["page", "tab"]
      });
    });
  });
}

browser.runtime.onInstalled.addListener(() => {
  buildContextMenu();
  updateIcon();
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id || !info.menuItemId.startsWith(CONTEXT_MENU_PREFIX)) return;

  const key = info.menuItemId.slice(CONTEXT_MENU_PREFIX.length);
  if (key === "stop") {
    await clearTabAutoRefresh(tab.id);
    return;
  }

  const seconds = Number(key);
  if (Number.isNaN(seconds) || seconds <= 0) return;

  await setTabAutoRefresh(tab.id, seconds);
});

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("autoRefresh-")) return;

  const tabId = Number(alarm.name.replace("autoRefresh-", ""));
  if (!Number.isFinite(tabId)) return;

  try {
    await browser.tabs.reload(tabId, { bypassCache: false });
    // Reset next refresh time
    const interval = await getTabAutoRefreshInterval(tabId);
    if (interval > 0) {
      nextRefreshTimes[tabId] = Date.now() + interval * 1000;
    }
    updateIcon();
  } catch (error) {
    // Tab may have been closed. Clear state just in case.
    await clearTabAutoRefresh(tabId);
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  await clearTabAutoRefresh(tabId);
});

browser.tabs.onActivated.addListener(async (activeInfo) => {
  const interval = await getTabAutoRefreshInterval(activeInfo.tabId);
  if (interval > 0) {
    startIconUpdates();
  } else {
    stopIconUpdates();
  }
  await updateIcon();
});

browser.runtime.onMessage.addListener(async (message) => {
  if (!message || !message.method) return;

  if (message.method === "set" && message.tabId && message.seconds) {
    await setTabAutoRefresh(message.tabId, message.seconds);
    browser.runtime.sendMessage("update");
    return { status: "ok" };
  }

  if (message.method === "stop" && message.tabId) {
    await clearTabAutoRefresh(message.tabId);
    browser.runtime.sendMessage("update");
    return { status: "ok" };
  }
});

// Initialize icon on service worker start
(async () => {
  await updateIcon();
})();
