const $table = document.getElementById("urlTable");
const $body = document.getElementById("urlBody");
const $empty = document.getElementById("empty");
const $clearAll = document.getElementById("clearAll");

function formatInterval(seconds) {
  if (seconds >= 60) {
    const mins = seconds / 60;
    return `${mins} min`;
  }
  return `${seconds}s`;
}

async function loadUrls() {
  const { urlRefreshMap } = await browser.storage.local.get("urlRefreshMap");
  const map = urlRefreshMap || {};
  const entries = Object.entries(map);

  $body.innerHTML = "";

  if (entries.length === 0) {
    $table.hidden = true;
    $empty.hidden = false;
    return;
  }

  $table.hidden = false;
  $empty.hidden = true;

  for (const [url, seconds] of entries) {
    const tr = document.createElement("tr");

    const tdUrl = document.createElement("td");
    tdUrl.className = "url";
    tdUrl.textContent = url;
    tr.appendChild(tdUrl);

    const tdInterval = document.createElement("td");
    tdInterval.className = "interval";
    tdInterval.textContent = formatInterval(seconds);
    tr.appendChild(tdInterval);

    const tdAction = document.createElement("td");
    const btn = document.createElement("button");
    btn.className = "remove";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => removeUrl(url));
    tdAction.appendChild(btn);
    tr.appendChild(tdAction);

    $body.appendChild(tr);
  }
}

async function removeUrl(url) {
  await browser.runtime.sendMessage({ method: "removeUrl", url });
  await loadUrls();
}

async function clearAll() {
  await browser.runtime.sendMessage({ method: "clearAllUrls" });
  await loadUrls();
}

$clearAll.addEventListener("click", clearAll);

loadUrls();
