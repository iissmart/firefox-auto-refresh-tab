const CONTEXT_MENU_PREFIX = "auto-refresh-";
const MAX_INTERVAL_SECS = 3600;

const STATIC_PERIODS = [5, 10, 15, 30, 60, 120, 300];

function getAlarmName(tabId) {
  return `autoRefresh-${tabId}`;
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
  } catch (error) {
    // Tab may have been closed. Clear state just in case.
    await clearTabAutoRefresh(tabId);
  }
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  await clearTabAutoRefresh(tabId);
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
