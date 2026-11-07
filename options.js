(() => {
  "use strict";

  const STORE_KEY = "dh_sites";
  const LOG_KEY = "dh_activity";
  const YOUTUBE_HOST = "youtube.com";
  const YOUTUBE_PREVIEW_KEY = "simpl_youtube_preview_player_enabled";
  const YOUTUBE_AD_FILTERS_KEY = "simpl_youtube_ad_filters_enabled";

  const siteSearch = document.getElementById("siteSearch");
  const siteList = document.getElementById("siteList");
  const emptyState = document.getElementById("emptyState");
  const siteDetail = document.getElementById("siteDetail");
  const detailHost = document.getElementById("detailHost");
  const detailMeta = document.getElementById("detailMeta");
  const removeSite = document.getElementById("removeSite");
  const addRule = document.getElementById("addRule");
  const disableAll = document.getElementById("disableAll");
  const enableAll = document.getElementById("enableAll");
  const rulesList = document.getElementById("rulesList");
  const activityList = document.getElementById("activityList");
  const clearLog = document.getElementById("clearLog");
  const exportData = document.getElementById("exportData");
  const importData = document.getElementById("importData");
  const siteButtonTemplate = document.getElementById("siteButtonTemplate");
  const ruleTemplate = document.getElementById("ruleTemplate");
  const youtubeSettings = document.getElementById("youtubeSettings");
  const youtubePreviewEnabled = document.getElementById("youtubePreviewEnabled");
  const youtubeAdFiltersEnabled = document.getElementById("youtubeAdFiltersEnabled");

  const state = {
    sites: {},
    activity: [],
    selectedHost: "",
    youtubePreviewEnabled: false,
    youtubeAdFiltersEnabled: false
  };

  const storageGet = (keys) =>
    new Promise((resolve) => chrome.storage.local.get(keys, resolve));

  const storageSet = (value) =>
    new Promise((resolve) => chrome.storage.local.set(value, resolve));

  const nowIso = () => new Date().toISOString();
  const randomId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const load = async () => {
    const data = await storageGet([
      STORE_KEY,
      LOG_KEY,
      YOUTUBE_PREVIEW_KEY,
      YOUTUBE_AD_FILTERS_KEY
    ]);
    state.sites = data[STORE_KEY] || {};
    state.activity = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
    state.youtubePreviewEnabled = data[YOUTUBE_PREVIEW_KEY] === true;
    state.youtubeAdFiltersEnabled = data[YOUTUBE_AD_FILTERS_KEY] === true;

    if (
      state.selectedHost &&
      state.selectedHost !== YOUTUBE_HOST &&
      !state.sites[state.selectedHost]
    ) {
      state.selectedHost = "";
    }

    if (!state.selectedHost) {
      state.selectedHost = sortedSites()[0]?.host || "";
    }

    render();
  };

  const saveSites = async () => {
    await storageSet({ [STORE_KEY]: state.sites });
    render();
  };

  const saveWebsiteData = async () => {
    await storageSet({ [STORE_KEY]: state.sites });
    render();
  };

  const sortedSites = () =>
    [...new Set([YOUTUBE_HOST, ...Object.keys(state.sites)])]
      .map((host) => {
        const hidden = state.sites[host];
        const hiddenDate = Date.parse(hidden?.updatedAt || hidden?.createdAt || 0);
        const latestDate = Number.isFinite(hiddenDate) ? hiddenDate : 0;
        return {
          host,
          hidden,
          updatedAt: new Date(latestDate).toISOString()
        };
      })
      .sort((a, b) => {
      if (a.host === YOUTUBE_HOST || b.host === YOUTUBE_HOST) {
        return a.host === YOUTUBE_HOST ? -1 : 1;
      }
      const aDate = Date.parse(a.updatedAt || a.createdAt || 0);
      const bDate = Date.parse(b.updatedAt || b.createdAt || 0);
      return bDate - aDate;
      });

  const visibleSites = () => {
    const query = siteSearch.value.trim().toLowerCase();
    return sortedSites().filter((site) => !query || site.host.toLowerCase().includes(query));
  };

  const formatDate = (value) => {
    if (!value) {
      return "Never";
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  };

  const renderSites = () => {
    siteList.replaceChildren();

    for (const site of visibleSites()) {
      const fragment = siteButtonTemplate.content.cloneNode(true);
      const button = fragment.querySelector(".site-button");
      const enabledCount = (site.hidden?.rules || []).filter((rule) => rule.enabled !== false).length;
      button.classList.toggle("active", site.host === state.selectedHost);
      fragment.querySelector(".site-host").textContent = site.host;
      fragment.querySelector(".site-count").textContent = site.host === YOUTUBE_HOST
        ? `${state.youtubePreviewEnabled ? "Preview on" : "Preview off"} • ` +
          `${state.youtubeAdFiltersEnabled ? "filters on" : "filters off"}`
        : `${enabledCount} hidden`;
      button.addEventListener("click", () => {
        state.selectedHost = site.host;
        render();
      });
      siteList.appendChild(fragment);
    }

    if (!siteList.children.length) {
      const empty = document.createElement("p");
      empty.textContent = "No matching websites.";
      siteList.appendChild(empty);
    }
  };

  const renderDetail = () => {
    const site = state.sites[state.selectedHost];
    const isYoutube = state.selectedHost === YOUTUBE_HOST;
    const hasSite = Boolean(site || isYoutube);
    emptyState.hidden = hasSite;
    siteDetail.hidden = !hasSite;
    rulesList.replaceChildren();
    youtubeSettings.hidden = !isYoutube;

    if (!hasSite) {
      return;
    }

    const rules = Array.isArray(site?.rules) ? site.rules : [];
    const lastUpdated = site?.updatedAt;
    detailHost.textContent = state.selectedHost;
    youtubePreviewEnabled.checked = state.youtubePreviewEnabled;
    youtubeAdFiltersEnabled.checked = state.youtubeAdFiltersEnabled;
    detailMeta.textContent =
      `${rules.length} hidden selector${rules.length === 1 ? "" : "s"} • ` +
      `last updated ${formatDate(lastUpdated)}`;
    removeSite.disabled = !site;

    for (const rule of rules) {
      const fragment = ruleTemplate.content.cloneNode(true);
      const row = fragment.querySelector(".rule-row");
      const enabled = fragment.querySelector(".rule-enabled");
      const selector = fragment.querySelector(".rule-selector");
      const save = fragment.querySelector(".save-rule");
      const del = fragment.querySelector(".delete-rule");

      enabled.checked = rule.enabled !== false;
      selector.value = rule.selector || "";

      enabled.addEventListener("change", async () => {
        rule.enabled = enabled.checked;
        rule.updatedAt = nowIso();
        site.updatedAt = nowIso();
        await saveSites();
      });

      save.addEventListener("click", async () => {
        const value = selector.value.trim();
        if (!value) {
          selector.focus();
          return;
        }
        rule.selector = value;
        rule.enabled = enabled.checked;
        rule.updatedAt = nowIso();
        site.updatedAt = nowIso();
        await saveSites();
      });

      del.addEventListener("click", async () => {
        site.rules = rules.filter((item) => item.id !== rule.id);
        site.updatedAt = nowIso();
        await saveSites();
      });

      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.target === selector) {
          save.click();
        }
      });

      rulesList.appendChild(fragment);
    }

    if (!rules.length) {
      const empty = document.createElement("p");
      empty.textContent = "No hidden items saved for this website.";
      rulesList.appendChild(empty);
    }

  };

  const renderActivity = () => {
    activityList.replaceChildren();

    const selected = state.selectedHost;
    const entries = state.activity
      .filter((entry) => !selected || entry.host === selected)
      .slice(0, 100);

    for (const entry of entries) {
      const item = document.createElement("div");
      item.className = "activity-item";

      const time = document.createElement("span");
      time.textContent = formatDate(entry.timestamp);

      const type = document.createElement("strong");
      type.textContent = entry.type;

      const detail = document.createElement("code");
      detail.title = entry.selector || entry.url || "";
      detail.textContent = entry.selector || entry.url || entry.host || "";

      item.append(time, type, detail);
      activityList.appendChild(item);
    }

    if (!activityList.children.length) {
      const empty = document.createElement("p");
      empty.textContent = "No activity logged yet.";
      activityList.appendChild(empty);
    }
  };

  const render = () => {
    renderSites();
    renderDetail();
    renderActivity();
  };

  addRule.addEventListener("click", async () => {
    if (!state.selectedHost) {
      return;
    }
    const site = state.sites[state.selectedHost] || {
      host: state.selectedHost,
      origin: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      rules: []
    };
    state.sites[state.selectedHost] = site;

    site.rules = Array.isArray(site.rules) ? site.rules : [];
    site.rules.push({
      id: randomId(),
      selector: "",
      enabled: true,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    site.updatedAt = nowIso();
    await saveSites();
    const inputs = rulesList.querySelectorAll(".rule-selector");
    inputs[inputs.length - 1]?.focus();
  });

  disableAll.addEventListener("click", async () => {
    const site = state.sites[state.selectedHost];
    if (!site) {
      return;
    }

    for (const rule of site.rules || []) {
      rule.enabled = false;
      rule.updatedAt = nowIso();
    }
    site.updatedAt = nowIso();
    await saveSites();
  });

  enableAll.addEventListener("click", async () => {
    const site = state.sites[state.selectedHost];
    if (!site) {
      return;
    }

    for (const rule of site.rules || []) {
      rule.enabled = true;
      rule.updatedAt = nowIso();
    }
    site.updatedAt = nowIso();
    await saveSites();
  });

  removeSite.addEventListener("click", async () => {
    if (!state.selectedHost) {
      return;
    }

    delete state.sites[state.selectedHost];
    state.selectedHost = sortedSites()[0]?.host || "";
    await saveWebsiteData();
  });

  youtubePreviewEnabled.addEventListener("change", async () => {
    state.youtubePreviewEnabled = youtubePreviewEnabled.checked;
    await storageSet({ [YOUTUBE_PREVIEW_KEY]: state.youtubePreviewEnabled });
  });

  youtubeAdFiltersEnabled.addEventListener("change", async () => {
    state.youtubeAdFiltersEnabled = youtubeAdFiltersEnabled.checked;
    await storageSet({ [YOUTUBE_AD_FILTERS_KEY]: state.youtubeAdFiltersEnabled });
  });

  clearLog.addEventListener("click", async () => {
    state.activity = state.selectedHost
      ? state.activity.filter((entry) => entry.host !== state.selectedHost)
      : [];
    await storageSet({ [LOG_KEY]: state.activity });
    render();
  });

  exportData.addEventListener("click", () => {
    const blob = new Blob([
      JSON.stringify({
        [STORE_KEY]: state.sites,
        [LOG_KEY]: state.activity,
        [YOUTUBE_PREVIEW_KEY]: state.youtubePreviewEnabled,
        [YOUTUBE_AD_FILTERS_KEY]: state.youtubeAdFiltersEnabled
      }, null, 2)
    ], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `simpl-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  importData.addEventListener("change", async () => {
    const file = importData.files?.[0];
    if (!file) {
      return;
    }

    try {
      const data = JSON.parse(await file.text());
      if (data && typeof data === "object") {
        state.sites = data[STORE_KEY] && typeof data[STORE_KEY] === "object" ? data[STORE_KEY] : {};
        state.activity = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
        state.youtubePreviewEnabled = data[YOUTUBE_PREVIEW_KEY] === true;
        state.youtubeAdFiltersEnabled = data[YOUTUBE_AD_FILTERS_KEY] === true;
        state.selectedHost = sortedSites()[0]?.host || "";
        await storageSet({
          [STORE_KEY]: state.sites,
          [LOG_KEY]: state.activity,
          [YOUTUBE_PREVIEW_KEY]: state.youtubePreviewEnabled,
          [YOUTUBE_AD_FILTERS_KEY]: state.youtubeAdFiltersEnabled
        });
        render();
      }
    } finally {
      importData.value = "";
    }
  });

  siteSearch.addEventListener("input", renderSites);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }

    if (changes[STORE_KEY]) {
      state.sites = changes[STORE_KEY].newValue || {};
    }

    if (changes[LOG_KEY]) {
      state.activity = Array.isArray(changes[LOG_KEY].newValue) ? changes[LOG_KEY].newValue : [];
    }

    if (changes[YOUTUBE_PREVIEW_KEY]) {
      state.youtubePreviewEnabled = changes[YOUTUBE_PREVIEW_KEY].newValue === true;
    }

    if (changes[YOUTUBE_AD_FILTERS_KEY]) {
      state.youtubeAdFiltersEnabled = changes[YOUTUBE_AD_FILTERS_KEY].newValue === true;
    }

    render();
  });

  load();
})();
