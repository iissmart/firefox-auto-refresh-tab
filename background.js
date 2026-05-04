const CONTEXT_MENU_PREFIX = "auto-refresh-";
const MAX_INTERVAL_SECS = 3600;

const STATIC_PERIODS = [1, 5, 10, 15, 30, 60, 120, 300];

const nextRefreshTimes = {};
let updateInterval = null;

function getAlarmName(tabId) {
  return `autoRefresh-${tabId}`;
}

function createIconSVG(size, color, text = '') {
  let textEl = '';
  if (text) {
    const fontSize = text.length <= 2 ? 38 : text.length === 3 ? 30 : 24;
    textEl = `<text x="${size/2}" y="${size/2}" font-size="${fontSize}" font-weight="bold" font-family="Arial,sans-serif" fill="white" stroke="#000" stroke-width="3" paint-order="stroke" text-anchor="middle" dominant-baseline="central">${text}</text>`;
  }
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${color}" stroke="#000" stroke-width="2"/>
    ${textEl}
  </svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}

async function updateIcon() {
  const activeTabs = await browser.tabs.query({ active: true });
  for (const tab of activeTabs) {
    const interval = await getTabAutoRefreshInterval(tab.id);
    if (interval > 0 && nextRefreshTimes[tab.id]) {
      const remaining = Math.max(0, Math.ceil((nextRefreshTimes[tab.id] - Date.now()) / 1000));
      browser.action.setIcon({ tabId: tab.id, path: createIconSVG(48, '#aa0000', remaining.toString()) });
    } else {
      browser.action.setIcon({ tabId: tab.id, path: 'icon48.svg' });
    }
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

async function setTabAutoRefresh(tabId, seconds, { skipReload = false, syncSiblings = false } = {}) {
  if (!tabId || seconds <= 0 || seconds > MAX_INTERVAL_SECS) {
    return clearTabAutoRefresh(tabId, { syncSiblings });
  }

  await browser.alarms.clear(getAlarmName(tabId));
  await browser.alarms.create(getAlarmName(tabId), { periodInMinutes: seconds / 60 });

  const state = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  state[tabId] = seconds;
  await browser.storage.local.set({ refreshMap: state });

  // Store URL-to-interval mapping so new tabs to the same URL auto-refresh
  let tabUrl = null;
  try {
    const tab = await browser.tabs.get(tabId);
    tabUrl = tab.url;
    if (tabUrl) {
      const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
      urlMap[tabUrl] = seconds;
      await browser.storage.local.set({ urlRefreshMap: urlMap });
    }
  } catch (e) { /* tab may not exist */ }

  nextRefreshTimes[tabId] = Date.now() + seconds * 1000;

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].id === tabId) {
    startIconUpdates();
  }

  if (!skipReload) {
    try {
      await browser.tabs.reload(tabId, { bypassCache: false });
    } catch (error) {
      // If tab is unavailable, clear the interval.
      await clearTabAutoRefresh(tabId);
    }
  }

  updateIcon();

  // Propagate to other tabs with the same URL
  if (syncSiblings && tabUrl) {
    const allTabs = await browser.tabs.query({ url: tabUrl });
    for (const sibling of allTabs) {
      if (sibling.id !== tabId) {
        await setTabAutoRefresh(sibling.id, seconds, { skipReload: false, syncSiblings: false });
      }
    }
  }

  return state;
}

async function clearTabAutoRefresh(tabId, { clearUrl = true, syncSiblings = false } = {}) {
  if (!tabId) return;

  await browser.alarms.clear(getAlarmName(tabId));

  let tabUrl = null;
  const data = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  if (data.hasOwnProperty(tabId)) {
    // Remove URL mapping only when user explicitly stops
    if (clearUrl) {
      try {
        const tab = await browser.tabs.get(tabId);
        tabUrl = tab.url;
        if (tabUrl) {
          const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
          delete urlMap[tabUrl];
          await browser.storage.local.set({ urlRefreshMap: urlMap });
        }
      } catch (e) { /* tab may already be gone */ }
    }
    delete data[tabId];
    await browser.storage.local.set({ refreshMap: data });
  }

  delete nextRefreshTimes[tabId];

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0] && tabs[0].id === tabId) {
    stopIconUpdates();
  }

  updateIcon();

  // Propagate stop to other tabs with the same URL
  if (syncSiblings && tabUrl) {
    const allTabs = await browser.tabs.query({ url: tabUrl });
    for (const sibling of allTabs) {
      if (sibling.id !== tabId) {
        await clearTabAutoRefresh(sibling.id, { clearUrl: false, syncSiblings: false });
      }
    }
  }

  return data;
}

async function getTabAutoRefreshInterval(tabId) {
  const state = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  return state[tabId] || 0;
}

function formatPeriod(seconds) {
  if (seconds >= 60) {
    const mins = seconds / 60;
    return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  }
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
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
        title: `Every ${formatPeriod(s)}`,
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
    await clearTabAutoRefresh(tab.id, { syncSiblings: true });
    return;
  }

  const seconds = Number(key);
  if (Number.isNaN(seconds) || seconds <= 0) return;

  await setTabAutoRefresh(tab.id, seconds, { syncSiblings: true });
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
  await clearTabAutoRefresh(tabId, { clearUrl: false });
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  // Skip if this tab is already being auto-refreshed
  const interval = await getTabAutoRefreshInterval(tabId);
  if (interval > 0) return;

  // Check if this URL has a saved refresh interval
  const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
  const savedInterval = urlMap[tab.url];
  if (savedInterval && savedInterval > 0) {
    await setTabAutoRefresh(tabId, savedInterval, { skipReload: true });
  }
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

browser.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) return;
  const tabs = await browser.tabs.query({ active: true, windowId });
  if (tabs.length === 0) return;
  const interval = await getTabAutoRefreshInterval(tabs[0].id);
  if (interval > 0) {
    startIconUpdates();
  }
  await updateIcon();
});

browser.runtime.onMessage.addListener(async (message) => {
  if (!message || !message.method) return;

  if (message.method === "set" && message.tabId && message.seconds) {
    await setTabAutoRefresh(message.tabId, message.seconds, { syncSiblings: true });
    browser.runtime.sendMessage("update");
    return { status: "ok" };
  }

  if (message.method === "stop" && message.tabId) {
    await clearTabAutoRefresh(message.tabId, { syncSiblings: true });
    browser.runtime.sendMessage("update");
    return { status: "ok" };
  }
});

// Initialize icon and context menu on service worker start
(async () => {
  buildContextMenu();
  await updateIcon();
})();
