(() => {
  "use strict";

  const status = document.getElementById("status");
  const togglePicker = document.getElementById("togglePicker");
  const undoLast = document.getElementById("undoLast");
  const clearSite = document.getElementById("clearSite");
  const openOptions = document.getElementById("openOptions");
  const toggleAds = document.getElementById("toggleAds");
  const youtubePreview = document.getElementById("youtubePreview");
  const youtubeAdFilters = document.getElementById("youtubeAdFilters");
  const YOUTUBE_PREVIEW_KEY = "simpl_youtube_preview_player_enabled";
  const YOUTUBE_AD_FILTERS_KEY = "simpl_youtube_ad_filters_enabled";

  let strictAdsEnabled = true;

  const getActiveTab = async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  };

  const sendToActiveTab = async (type) => {
    const tab = await getActiveTab();
    if (!tab?.id || !/^https?:/.test(tab.url || "")) {
      throw new Error("Open a normal website tab first.");
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, { type });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          window.dispatchEvent(new CustomEvent("simpl-extension-reinject"));
        }
      });

      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"]
      });

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["cosmetic.js", "content.js", "youtube-preview.js"]
      });

      return chrome.tabs.sendMessage(tab.id, { type });
    }
  };

  const renderStatus = (hideData) => {
    const host = hideData?.host || "this site";
    const hiddenCount = Number(hideData?.rulesCount || 0);
    status.textContent = `${hiddenCount} hidden on ${host}.`;
    togglePicker.textContent = hideData?.active ? "Done Hiding" : "Pick Element";
    undoLast.disabled = Number(hideData?.undoCount || 0) === 0;
    clearSite.disabled = hiddenCount === 0;
  };

  const sendRuntimeMessage = (type, payload = {}) =>
    chrome.runtime.sendMessage({ type, ...payload });

  const renderAdBlockStatus = (data) => {
    strictAdsEnabled = data?.enabled !== false;
    toggleAds.textContent = strictAdsEnabled ? "Ad Filters On" : "Ad Filters Off";
    toggleAds.classList.toggle("off", !strictAdsEnabled);
    toggleAds.title = strictAdsEnabled
      ? "Bundled network and page filters are active."
      : "Bundled ad filters are paused.";
  };

  const refreshAdBlockStatus = async () => {
    try {
      renderAdBlockStatus(await sendRuntimeMessage("SIMPL_GET_ADBLOCK_STATUS"));
    } catch {
      renderAdBlockStatus({ enabled: true });
    }
  };

  const refresh = async () => {
    try {
      const hideData = await sendToActiveTab("DH_GET_STATUS");
      renderStatus(hideData);
    } catch (error) {
      status.textContent = error.message || "This page cannot be edited.";
      togglePicker.disabled = true;
      undoLast.disabled = true;
      clearSite.disabled = true;
    }
  };

  togglePicker.addEventListener("click", async () => {
    try {
      await sendToActiveTab("DH_TOGGLE_PICKER");
      window.close();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  undoLast.addEventListener("click", async () => {
    try {
      await sendToActiveTab("DH_UNDO_LAST");
      await refresh();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  clearSite.addEventListener("click", async () => {
    try {
      await sendToActiveTab("DH_CLEAR_SITE_RULES");
      await refresh();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  openOptions.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  toggleAds.addEventListener("click", async () => {
    try {
      toggleAds.disabled = true;
      const result = await sendRuntimeMessage("SIMPL_SET_ADBLOCK_ENABLED", {
        enabled: !strictAdsEnabled
      });
      if (!result?.ok) {
        throw new Error(result?.error || "Ad filters could not be changed.");
      }
      renderAdBlockStatus(result);
    } catch (error) {
      status.textContent = error.message || "Ad filters could not be changed.";
    } finally {
      toggleAds.disabled = false;
    }
  });

  const refreshYoutubeSettings = async () => {
    const data = await chrome.storage.local.get([YOUTUBE_PREVIEW_KEY, YOUTUBE_AD_FILTERS_KEY]);
    youtubePreview.checked = data[YOUTUBE_PREVIEW_KEY] === true;
    youtubeAdFilters.checked = data[YOUTUBE_AD_FILTERS_KEY] === true;
  };

  youtubePreview.addEventListener("change", () => {
    chrome.storage.local.set({ [YOUTUBE_PREVIEW_KEY]: youtubePreview.checked });
  });

  youtubeAdFilters.addEventListener("change", () => {
    chrome.storage.local.set({ [YOUTUBE_AD_FILTERS_KEY]: youtubeAdFilters.checked });
  });

  refreshAdBlockStatus();
  refreshYoutubeSettings().catch(() => {});

  // Expanded on YouTube; a collapsed dropdown everywhere else.
  getActiveTab().then((tab) => {
    try {
      const host = new URL(tab?.url || "").hostname;
      document.getElementById("youtubeSection").open = /(^|\.)youtube\.com$/i.test(host);
    } catch {
      // Leave it collapsed when the tab URL is unavailable.
    }
  }).catch(() => {});
  refresh();
})();
