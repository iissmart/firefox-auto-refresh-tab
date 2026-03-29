const CONTEXT_MENU_PREFIX = "auto-refresh-";
const MAX_INTERVAL_SECS = 3600;

const STATIC_PERIODS = [1, 5, 10, 15, 30, 60, 120, 300];

let currentCountdown = 0;
let countdownInterval = null;

function getAlarmName(tabId) {
  return `autoRefresh-${tabId}`;
}

function createIconSVG(size, color, text = '') {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 4}" fill="${color}" stroke="#000" stroke-width="2"/>
    ${text ? `<text x="${size - 8}" y="${size - 4}" font-size="${size/5}" fill="white" text-anchor="end">${text}</text>` : ''}
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

async function updateIcon() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  const anyHas = await anyTabHasRefresh();
  if (anyHas) {
    const interval = activeTab ? await getTabAutoRefreshInterval(activeTab.id) : 0;
    const text = interval > 0 ? currentCountdown.toString() : '';
    browser.browserAction.setIcon({ path: createIconSVG(48, '#aa0000', text) });
  } else {
    browser.browserAction.setIcon({ path: 'icon48.svg' });
  }
}

function startCountdown(interval) {
  currentCountdown = interval;
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    if (currentCountdown > 0) {
      currentCountdown--;
      updateIcon();
    }
  }, 1000);
}

function stopCountdown() {
  currentCountdown = 0;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
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

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].id === tabId) {
    startCountdown(seconds);
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

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].id === tabId) {
    stopCountdown();
  }

  updateIcon();

  return data;
}

async function getTabAutoRefreshInterval(tabId) {
  const state = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  return state[tabId] || 0;
}

async function anyTabHasRefresh() {
  const state = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  return Object.keys(state).length > 0;
}

function buildContextMenu() {
  browser.contextMenus.removeAll().then(() => {
    browser.contextMenus.create({
      id: `${CONTEXT_MENU_PREFIX}header`,
      title: "Auto refresh this tab",
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

    browser.contextMenus.create({
      id: `${CONTEXT_MENU_PREFIX}stop`,
      title: "Stop refreshing",
      parentId: `${CONTEXT_MENU_PREFIX}header`,
      contexts: ["page", "tab"]
    });
  });
}

browser.runtime.onInstalled.addListener(() => {
  buildContextMenu();
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
    // Reset countdown for active tab
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0] && tabs[0].id === tabId) {
      const interval = await getTabAutoRefreshInterval(tabId);
      startCountdown(interval);
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
    startCountdown(interval);
  } else {
    stopCountdown();
  }
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
