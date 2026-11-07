(() => {
  "use strict";

  const FILTERS_ENABLED_KEY = "simpl_strict_ads_enabled";
  const YOUTUBE_FILTERS_ENABLED_KEY = "simpl_youtube_ad_filters_enabled";
  const FILTER_BUNDLE_VERSION_KEY = "simpl_filter_bundle_version";
  const PRIMARY_RULESET_ID = "simpl_filters_primary";
  const SECONDARY_RULES_PATH = "rules/network-secondary.json";
  const COSMETIC_SHARD_COUNT = 32;

  const storageGet = (keys) => chrome.storage.local.get(keys);
  const storageSet = (value) => chrome.storage.local.set(value);
  const editableUrl = (url = "") => /^https?:/.test(url);

  let genericCosmeticPromise = null;
  const cosmeticShardPromises = new Map();

  const loadJson = async (path) => {
    const response = await fetch(chrome.runtime.getURL(path));
    if (!response.ok) {
      throw new Error(`Could not load ${path}.`);
    }
    return response.json();
  };

  const getFilterBundleVersion = async () => {
    const metadata = await loadJson("rules/filter-metadata.json");
    return metadata.generatedAt || chrome.runtime.getManifest().version;
  };

  const getFiltersEnabled = async () => {
    const data = await storageGet([FILTERS_ENABLED_KEY]);
    return data[FILTERS_ENABLED_KEY] !== false;
  };

  const getYoutubeFiltersEnabled = async () => {
    const data = await storageGet([YOUTUBE_FILTERS_ENABLED_KEY]);
    return data[YOUTUBE_FILTERS_ENABLED_KEY] === true;
  };

  const replaceDynamicRules = async (rules = []) => {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRules.map((rule) => rule.id),
      addRules: rules
    });
  };

  const syncSecondaryRules = async (enabled, force = false) => {
    if (!enabled) {
      await replaceDynamicRules();
      await chrome.storage.local.remove(FILTER_BUNDLE_VERSION_KEY);
      return;
    }

    const bundleVersion = await getFilterBundleVersion();
    const data = await storageGet([FILTER_BUNDLE_VERSION_KEY]);
    if (!force && data[FILTER_BUNDLE_VERSION_KEY] === bundleVersion) {
      return;
    }

    const rules = await loadJson(SECONDARY_RULES_PATH);
    await replaceDynamicRules(rules);
    await storageSet({ [FILTER_BUNDLE_VERSION_KEY]: bundleVersion });
  };

  const applyFilterSetting = async (enabled, forceDynamicRefresh = false) => {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? [PRIMARY_RULESET_ID] : [],
      disableRulesetIds: enabled ? [] : [PRIMARY_RULESET_ID]
    });
    await syncSecondaryRules(enabled, forceDynamicRefresh);
  };

  const setFiltersEnabled = async (enabled) => {
    const nextEnabled = Boolean(enabled);
    await storageSet({ [FILTERS_ENABLED_KEY]: nextEnabled });
    await applyFilterSetting(nextEnabled);
    return {
      ok: true,
      enabled: nextEnabled
    };
  };

  const getAdBlockStatus = async () => ({
    ok: true,
    enabled: await getFiltersEnabled()
  });

  const cosmeticShardForDomain = (domain) => {
    let hash = 2166136261;
    for (let index = 0; index < domain.length; index += 1) {
      hash ^= domain.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % COSMETIC_SHARD_COUNT;
  };

  const getHostnameCandidates = (hostname) => {
    const labels = String(hostname || "")
      .toLowerCase()
      .replace(/^\.+|\.+$/g, "")
      .split(".")
      .filter(Boolean);
    const candidates = [];
    for (let index = 0; index < labels.length; index += 1) {
      candidates.push(labels.slice(index).join("."));
    }
    return candidates;
  };

  const isYoutubeHostname = (hostname) => {
    const domain = String(hostname || "").toLowerCase();
    return domain === "youtube.com" || domain.endsWith(".youtube.com");
  };

  const loadGenericCosmetic = () => {
    if (!genericCosmeticPromise) {
      genericCosmeticPromise = loadJson("rules/cosmetic/generic.json")
        .catch((error) => {
          genericCosmeticPromise = null;
          throw error;
        });
    }
    return genericCosmeticPromise;
  };

  const loadCosmeticShard = (index) => {
    if (!cosmeticShardPromises.has(index)) {
      const path = `rules/cosmetic/domains-${String(index).padStart(2, "0")}.json`;
      cosmeticShardPromises.set(
        index,
        loadJson(path).catch((error) => {
          cosmeticShardPromises.delete(index);
          throw error;
        })
      );
    }
    return cosmeticShardPromises.get(index);
  };

  const getCosmeticFilters = async (hostname) => {
    if (!await getFiltersEnabled()) {
      return { ok: true, enabled: false, selectors: [] };
    }

    if (isYoutubeHostname(hostname) && !await getYoutubeFiltersEnabled()) {
      return { ok: true, enabled: false, selectors: [] };
    }

    const candidates = getHostnameCandidates(hostname);
    const selectors = new Set();
    if (!isYoutubeHostname(hostname)) {
      const generic = await loadGenericCosmetic();
      for (const selector of generic.selectors || []) {
        selectors.add(selector);
      }
    }
    const exceptions = new Set();
    const shardIndexes = [...new Set(candidates.map(cosmeticShardForDomain))];
    const shards = new Map(
      await Promise.all(shardIndexes.map(async (index) => [index, await loadCosmeticShard(index)]))
    );

    for (const domain of candidates) {
      const shard = shards.get(cosmeticShardForDomain(domain));
      for (const selector of shard?.rules?.[domain] || []) {
        selectors.add(selector);
      }
      for (const selector of shard?.exceptions?.[domain] || []) {
        exceptions.add(selector);
      }
    }

    for (const selector of exceptions) {
      selectors.delete(selector);
    }

    return {
      ok: true,
      enabled: true,
      selectors: [...selectors]
    };
  };

  const getActiveTab = async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  };

  const injectContent = async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.dispatchEvent(new CustomEvent("simpl-extension-reinject"));
      }
    });

    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["cosmetic.js", "content.js", "youtube-preview.js"]
    });
  };

  const sendMessage = async (tab, type) => {
    if (!tab?.id || !editableUrl(tab.url)) {
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { type });
    } catch {
      await injectContent(tab.id);
      await chrome.tabs.sendMessage(tab.id, { type });
    }
  };

  const setHistoryGuard = async (tabId, enabled) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [Boolean(enabled), Date.now() + 30 * 60 * 1000],
      func: (nextEnabled, expiresAt) => {
        const key = "__DH_HISTORY_GUARD__";

        if (!window[key]) {
          const nativePushState = window.history.pushState;
          Object.defineProperty(window, key, {
            configurable: false,
            enumerable: false,
            value: {
              enabled: false,
              expiresAt: 0,
              nativePushState
            }
          });

          window.history.pushState = function (...args) {
            const guard = window[key];
            if (guard?.enabled && Date.now() < guard.expiresAt) {
              return undefined;
            }

            return guard.nativePushState.apply(this, args);
          };
        }

        window[key].enabled = nextEnabled;
        window[key].expiresAt = nextEnabled ? expiresAt : 0;
      }
    });
  };

  const senderHostname = (sender) => {
    try {
      return new URL(sender.url || sender.tab?.url || "").hostname;
    } catch {
      return "";
    }
  };

  const handleRuntimeMessage = async (message, sender) => {
    if (message?.type === "DH_SET_HISTORY_GUARD") {
      const tabId = sender.tab?.id;
      if (!tabId) {
        return { ok: false };
      }
      await setHistoryGuard(tabId, message.enabled);
      return { ok: true };
    }

    if (message?.type === "SIMPL_GET_ADBLOCK_STATUS") {
      return getAdBlockStatus();
    }

    if (message?.type === "SIMPL_SET_ADBLOCK_ENABLED") {
      return setFiltersEnabled(message.enabled);
    }

    if (message?.type === "SIMPL_GET_COSMETIC_FILTERS") {
      return getCosmeticFilters(senderHostname(sender));
    }

    return null;
  };

  const syncFilterSetting = async (forceDynamicRefresh = false) => {
    await applyFilterSetting(await getFiltersEnabled(), forceDynamicRefresh);
  };

  chrome.runtime.onInstalled.addListener(() => {
    syncFilterSetting(true).catch(() => {});
  });

  chrome.runtime.onStartup.addListener(() => {
    syncFilterSetting().catch(() => {});
  });

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-picker") {
      return;
    }

    const tab = await getActiveTab();
    await sendMessage(tab, "DH_TOGGLE_PICKER");
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleRuntimeMessage(message, sender)
      .then((response) => {
        sendResponse(response || { ok: false });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    return true;
  });

  syncFilterSetting().catch(() => {});
})();
