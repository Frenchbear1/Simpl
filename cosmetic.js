(() => {
  "use strict";

  if (globalThis.__SIMPL_COSMETIC_FILTERS_LOADED__) {
    return;
  }
  globalThis.__SIMPL_COSMETIC_FILTERS_LOADED__ = true;

  const FILTERS_ENABLED_KEY = "simpl_strict_ads_enabled";
  const YOUTUBE_FILTERS_ENABLED_KEY = "simpl_youtube_ad_filters_enabled";
  const STYLE_ID = "simpl-community-cosmetic-filters";
  let requestId = 0;

  const removeStyle = () => {
    document.getElementById(STYLE_ID)?.remove();
  };

  const ensureStyle = () => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.setAttribute("data-simpl-filter-lists", "true");
      (document.head || document.documentElement).append(style);
    }
    return style;
  };

  const selectorRules = (selectors) =>
    selectors.map((selector) => `${selector}{display:none!important;}`).join("\n");

  const applyFilters = async () => {
    const currentRequest = ++requestId;
    const response = await chrome.runtime.sendMessage({
      type: "SIMPL_GET_COSMETIC_FILTERS"
    });
    if (currentRequest !== requestId) {
      return;
    }

    if (!response?.ok || response.enabled === false) {
      removeStyle();
      return;
    }

    ensureStyle().textContent = selectorRules(response.selectors || []);
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area !== "local" ||
      (!changes[FILTERS_ENABLED_KEY] && !changes[YOUTUBE_FILTERS_ENABLED_KEY])
    ) {
      return;
    }

    if (changes[FILTERS_ENABLED_KEY]?.newValue === false) {
      requestId += 1;
      removeStyle();
      return;
    }

    applyFilters().catch(removeStyle);
  });

  const start = () => applyFilters().catch(removeStyle);
  if (document.documentElement) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  }
})();
