const CONTEXT_MENU_PREFIX = "auto-refresh-";
const MAX_INTERVAL_SECS = 3600;
const WATCHDOG_ALARM = "autoRefresh-watchdog";
const WATCHDOG_INTERVAL_MIN = 1;

/** Strip the fragment (#…) from a URL so anchor-only changes are ignored. */
function stripHash(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

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
      urlMap[stripHash(tabUrl)] = seconds;
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
          delete urlMap[stripHash(tabUrl)];
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

browser.runtime.onInstalled.addListener(async () => {
  buildContextMenu();
  updateIcon();
  // Start watchdog alarm
  await browser.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_INTERVAL_MIN });
});

// Reconcile urlRefreshMap against open tabs — re-establish refresh for any
// tabs whose tab-level state (refreshMap + alarm) was lost.
async function reconcileUrlMap() {
  const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
  const state = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  const activeTabIds = new Set(Object.keys(state).map(Number));

  for (const [url, seconds] of Object.entries(urlMap)) {
    if (!seconds || seconds <= 0) continue;
    let tabs;
    try {
      tabs = await browser.tabs.query({ url });
    } catch (e) { continue; } // URL pattern not queryable
    for (const tab of tabs) {
      if (!activeTabIds.has(tab.id)) {
        await setTabAutoRefresh(tab.id, seconds, { skipReload: true });
        activeTabIds.add(tab.id);
      }
    }
  }
}

// Re-initialize in-memory state when background script starts (handles event page restarts)
(async function restoreState() {
  const state = (await browser.storage.local.get("refreshMap")).refreshMap || {};
  for (const tabId of Object.keys(state)) {
    const id = Number(tabId);
    const seconds = state[tabId];
    if (seconds > 0) {
      nextRefreshTimes[id] = Date.now() + seconds * 1000;
      // Ensure the alarm still exists (may have been lost)
      const existing = await browser.alarms.get(getAlarmName(id));
      if (!existing) {
        await browser.alarms.create(getAlarmName(id), { periodInMinutes: seconds / 60 });
      }
    }
  }

  // Recover any tabs whose refreshMap entry was lost but URL is still tracked
  await reconcileUrlMap();

  // Ensure watchdog alarm is running
  const wd = await browser.alarms.get(WATCHDOG_ALARM);
  if (!wd) {
    await browser.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_INTERVAL_MIN });
  }

  buildContextMenu();
  updateIcon();
})();

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
  // Watchdog: periodically reconcile urlRefreshMap against open tabs
  if (alarm.name === WATCHDOG_ALARM) {
    await reconcileUrlMap();
    return;
  }

  if (!alarm.name.startsWith("autoRefresh-")) return;

  const tabId = Number(alarm.name.replace("autoRefresh-", ""));
  if (!Number.isFinite(tabId)) return;

  // Verify the tab is still supposed to be refreshing; recover from urlRefreshMap if needed
  let interval = await getTabAutoRefreshInterval(tabId);
  if (interval <= 0) {
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab.url) {
        const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
        const savedInterval = urlMap[stripHash(tab.url)];
        if (savedInterval && savedInterval > 0) {
          await setTabAutoRefresh(tabId, savedInterval, { skipReload: false });
          return;
        }
      }
    } catch (e) { /* tab gone */ }
    await browser.alarms.clear(alarm.name);
    return;
  }

  try {
    await browser.tabs.reload(tabId, { bypassCache: false });
    // Reset next refresh time
    nextRefreshTimes[tabId] = Date.now() + interval * 1000;
    updateIcon();
  } catch (error) {
    // Reload failed — only clear if the tab truly no longer exists
    try {
      await browser.tabs.get(tabId);
      // Tab still exists (e.g. window minimized/suspended), keep refreshing
      if (interval > 0) {
        nextRefreshTimes[tabId] = Date.now() + interval * 1000;
      }
    } catch (e) {
      // Tab genuinely gone, safe to clear
      await clearTabAutoRefresh(tabId);
    }
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  await clearTabAutoRefresh(tabId, { clearUrl: false });
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // When URL changes on a tab that is actively refreshing, stop it
  // unless the new URL is also in the urlRefreshMap
  if (changeInfo.url) {
    const interval = await getTabAutoRefreshInterval(tabId);
    if (interval > 0) {
      // Ignore fragment-only changes (anchor clicks)
      const oldUrl = tab.url ? stripHash(tab.url) : null;
      const newUrl = stripHash(changeInfo.url);
      if (oldUrl && oldUrl === newUrl) {
        // Same page, different anchor — keep refreshing
      } else {
        const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
        const savedInterval = urlMap[newUrl];
        if (savedInterval && savedInterval > 0) {
          // New URL was also being refreshed, update interval if different
          if (savedInterval !== interval) {
            await setTabAutoRefresh(tabId, savedInterval, { skipReload: true });
          }
        } else {
          // New URL is not being refreshed, stop refreshing this tab
          await clearTabAutoRefresh(tabId, { clearUrl: false });
        }
      }
    }
  }

  if (changeInfo.status !== "complete") return;

  // Skip if this tab is already being auto-refreshed
  const interval = await getTabAutoRefreshInterval(tabId);
  if (interval > 0) return;

  // Get the tab URL - tab object may not always have it populated
  const url = tab.url || (await browser.tabs.get(tabId).catch(() => null))?.url;
  if (!url) return;

  // Check if this URL has a saved refresh interval
  const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
  const savedInterval = urlMap[stripHash(url)];
  if (savedInterval && savedInterval > 0) {
    await setTabAutoRefresh(tabId, savedInterval, { skipReload: true });
  }
});

browser.tabs.onActivated.addListener(async (activeInfo) => {
  let interval = await getTabAutoRefreshInterval(activeInfo.tabId);

  // If auto-refresh was lost (e.g. tab was backgrounded/discarded), recover from URL map
  if (interval <= 0) {
    try {
      const tab = await browser.tabs.get(activeInfo.tabId);
      if (tab.url) {
        const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
        const savedInterval = urlMap[stripHash(tab.url)];
        if (savedInterval && savedInterval > 0) {
          await setTabAutoRefresh(activeInfo.tabId, savedInterval, { skipReload: false });
          interval = savedInterval;
        }
      }
    } catch (e) { /* tab may not exist */ }
  }

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

  if (message.method === "removeUrl" && message.url) {
    const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
    delete urlMap[stripHash(message.url)];
    await browser.storage.local.set({ urlRefreshMap: urlMap });

    // Stop any tabs currently refreshing this URL
    try {
      const tabs = await browser.tabs.query({ url: message.url });
      for (const tab of tabs) {
        const interval = await getTabAutoRefreshInterval(tab.id);
        if (interval > 0) {
          await clearTabAutoRefresh(tab.id, { clearUrl: false });
        }
      }
    } catch (e) { /* URL pattern may not be queryable */ }

    return { status: "ok" };
  }

  if (message.method === "clearAllUrls") {
    const urlMap = (await browser.storage.local.get("urlRefreshMap")).urlRefreshMap || {};
    const urls = Object.keys(urlMap);
    await browser.storage.local.set({ urlRefreshMap: {} });

    // Stop all tabs that were refreshing any of these URLs
    for (const url of urls) {
      try {
        const tabs = await browser.tabs.query({ url });
        for (const tab of tabs) {
          const interval = await getTabAutoRefreshInterval(tab.id);
          if (interval > 0) {
            await clearTabAutoRefresh(tab.id, { clearUrl: false });
          }
        }
      } catch (e) { /* skip unqueryable URLs */ }
    }

    return { status: "ok" };
  }
});

// Initialize icon and context menu on service worker start
(async () => {
  buildContextMenu();
  await updateIcon();
})();
