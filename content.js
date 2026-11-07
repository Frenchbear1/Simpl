(() => {
  "use strict";

  if (globalThis.__DH_CONTENT_SCRIPT_LOADED__) {
    return;
  }
  globalThis.__DH_CONTENT_SCRIPT_LOADED__ = true;

  const STORE_KEY = "dh_sites";
  const LOG_KEY = "dh_activity";
  const STRICT_ADS_KEY = "simpl_strict_ads_enabled";
  const YOUTUBE_ADS_KEY = "simpl_youtube_ad_filters_enabled";
  const STYLE_ID = "dh-persisted-hidden-style";
  const YOUTUBE_AD_STYLE_ID = "simpl-youtube-ad-style";
  const UI_TAG = "dh-distraction-hider-ui";
  const LOG_LIMIT = 1000;
  const VANISH_DURATION = 820;
  const YOUTUBE_AD_SPEED = 20;
  const YOUTUBE_NATIVE_AD_SPEED = 16;
  const YOUTUBE_AD_CHECK_MS = 100;
  const YOUTUBE_AD_SEEK_MS = 500;
  const YOUTUBE_SKIP_EVENT = "simpl-youtube-skip-ad";
  const YOUTUBE_STRICT_ADS_EVENT = "simpl-youtube-strict-ads-state";
  const BLOCKED_PICKER_EVENTS = [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
    "auxclick",
    "dblclick"
  ];
  const BLOCKED_UNDO_KEY_EVENTS = ["keypress", "keyup"];
  const WHEEL_LISTENER_OPTIONS = { capture: true, passive: false };

  const state = {
    pickerActive: false,
    hoverElement: null,
    hoverStack: [],
    hoverIndex: 0,
    defaultHoverIndex: 0,
    preferredDepth: null,
    pointerX: null,
    pointerY: null,
    toolbarDrag: null,
    uiHost: null,
    ui: null,
    youtubeCompactTimer: null,
    youtubeCompactorObserver: null,
    youtubeAdAcceleratorTimer: null,
    youtubeAdMediaState: null,
    youtubeContentMediaState: null,
    youtubeAdLastSeekAt: 0,
    youtubeShortsSkipAt: 0,
    vanishingElements: new WeakSet(),
    undoStack: [],
    rules: [],
    globalAdsEnabled: true,
    youtubeAdsEnabled: false,
    strictAdsEnabled: true,
    extensionContextInvalidated: false
  };

  let extensionListenersRegistered = false;
  let extensionReinjectListenerRegistered = false;

  const siteKey = location.hostname;
  const siteOrigin = location.origin;

  if (!siteKey || !/^https?:$/.test(location.protocol)) {
    return;
  }

  const nowIso = () => new Date().toISOString();
  const randomId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const isExtensionContextError = (error) =>
    /extension context invalidated/i.test(error?.message || String(error || ""));

  const markExtensionContextInvalidated = () => {
    if (state.extensionContextInvalidated) {
      return;
    }

    state.extensionContextInvalidated = true;
    state.pickerActive = false;
    state.hoverElement = null;
    state.hoverStack = [];
    state.hoverIndex = 0;
    state.defaultHoverIndex = 0;
    state.preferredDepth = null;
    state.pointerX = null;
    state.pointerY = null;
    cleanupToolbarDrag();
    stopYoutubeCompactor();
    stopYoutubeAdAccelerator();

    try {
      globalThis.__DH_CONTENT_SCRIPT_LOADED__ = false;
      document.documentElement.classList.remove("dh-picker-active");
      removePickerListeners();
      if (state.ui) {
        updateToolbar();
        updateHighlight();
      }
    } catch {
      // The stale content script is already losing access to its extension APIs.
    }

    try {
      if (extensionListenersRegistered) {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
        chrome.storage.onChanged.removeListener(onStorageChanged);
      }
    } catch {
      // The listener bridge may already be gone.
    } finally {
      extensionListenersRegistered = false;
    }

    if (extensionReinjectListenerRegistered) {
      window.removeEventListener("simpl-extension-reinject", markExtensionContextInvalidated);
      extensionReinjectListenerRegistered = false;
    }
  };

  const handleExtensionApiError = (error) => {
    if (isExtensionContextError(error)) {
      markExtensionContextInvalidated();
    }
  };

  const handleAsyncError = (error) => {
    handleExtensionApiError(error);
  };

  const extensionContextIsValid = () => {
    if (state.extensionContextInvalidated) {
      return false;
    }

    try {
      const isValid = (
        typeof chrome !== "undefined" &&
        Boolean(chrome.runtime?.id)
      );

      if (!isValid) {
        markExtensionContextInvalidated();
      }

      return isValid;
    } catch (error) {
      handleExtensionApiError(error);
      return false;
    }
  };

  const getRuntimeLastError = () => {
    try {
      const error = chrome.runtime?.lastError;
      if (error) {
        handleExtensionApiError(error);
      }
      return error;
    } catch (error) {
      handleExtensionApiError(error);
      return error;
    }
  };

  const resolveOnce = (resolve, fallback, onTimeout) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        onTimeout?.();
        resolve(fallback);
      }
    }, 5000);

    return (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
  };

  const safeSendResponse = (sendResponse, value) => {
    try {
      sendResponse(value);
    } catch (error) {
      handleExtensionApiError(error);
    }
  };

  const respondWithStatus = (promise, sendResponse) => {
    promise
      .then((response) => safeSendResponse(sendResponse, response || getStatus()))
      .catch((error) => {
        handleAsyncError(error);
        safeSendResponse(sendResponse, getStatus());
      });
  };

  const resetPickerState = () => {
    state.pickerActive = false;
    state.hoverElement = null;
    state.hoverStack = [];
    state.hoverIndex = 0;
    state.defaultHoverIndex = 0;
    state.preferredDepth = null;
    state.pointerX = null;
    state.pointerY = null;
    cleanupToolbarDrag();
    document.documentElement.classList.remove("dh-picker-active");
    removePickerListeners();
    if (state.ui) {
      resetToolbarPosition();
      updateToolbar();
      updateHighlight();
    }
  };

  const storageAreaIsAvailable = () => {
    if (!extensionContextIsValid()) {
      return false;
    }

    try {
      return Boolean(chrome.storage?.local);
    } catch {
      markExtensionContextInvalidated();
      return false;
    }
  };

  const storageGet = (keys) =>
    new Promise((resolve) => {
      const finish = resolveOnce(resolve, {}, markExtensionContextInvalidated);
      if (!storageAreaIsAvailable()) {
        finish({});
        return;
      }

      try {
        chrome.storage.local.get(keys, (data) => {
          if (getRuntimeLastError()) {
            finish({});
            return;
          }

          finish(data || {});
        });
      } catch (error) {
        handleExtensionApiError(error);
        finish({});
      }
    });

  const storageSet = (value) =>
    new Promise((resolve) => {
      const finish = resolveOnce(resolve, false, markExtensionContextInvalidated);
      if (!storageAreaIsAvailable()) {
        finish(false);
        return;
      }

      try {
        chrome.storage.local.set(value, () => {
          finish(!getRuntimeLastError());
        });
      } catch (error) {
        handleExtensionApiError(error);
        finish(false);
      }
    });

  const setHistoryGuard = async (enabled) => {
    if (!extensionContextIsValid()) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: "DH_SET_HISTORY_GUARD",
        enabled: Boolean(enabled)
      });
    } catch (error) {
      handleExtensionApiError(error);
      // Some restricted pages cannot run the main-world guard; event blocking still applies.
    }
  };

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }

    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };

  const selectorMatches = (selector) => {
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  const isUiElement = (element) =>
    Boolean(
      element &&
      (
        element === state.uiHost ||
        element.closest?.(UI_TAG) ||
        element.closest?.("[data-dh-vanish-clone='true']")
      )
    );

  const isSelectableElement = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || isUiElement(element)) {
      return false;
    }

    const tag = element.localName;
    if (!tag || ["html", "body", "head", "script", "style", "link", "meta", "title"].includes(tag)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  };

  const rectContainsPoint = (rect, x, y) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

  const addElementAndParents = (stack, seen, element) => {
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (isSelectableElement(current) && !seen.has(current)) {
        seen.add(current);
        stack.push(current);
      }

      if (current.localName === "body") {
        break;
      }

      current = current.parentElement;
    }
  };

  const collectDescendantsAtPoint = (root, x, y) => {
    const matches = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => {
        if (!isSelectableElement(node)) {
          return NodeFilter.FILTER_SKIP;
        }

        const rect = node.getBoundingClientRect();
        return rectContainsPoint(rect, x, y)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    });

    let node = walker.nextNode();
    while (node) {
      matches.push(node);
      if (matches.length >= 40) {
        break;
      }
      node = walker.nextNode();
    }

    return matches.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return (aRect.width * aRect.height) - (bRect.width * bRect.height);
    });
  };

  const collectVisualDescendants = (root) => {
    if (!root?.querySelectorAll) {
      return [];
    }

    const selector = [
      "img",
      "iframe",
      "video",
      "canvas",
      "svg",
      "object",
      "embed",
      "picture",
      "[role='img']",
      "[id*='promo' i]",
      "[id*='banner' i]",
      "[id*='advert' i]",
      "[id*='ad_' i]",
      "[id*='ad-' i]",
      "[class*='promo' i]",
      "[class*='banner' i]",
      "[class*='advert' i]",
      "[class*='ad_' i]",
      "[class*='ad-' i]"
    ].join(",");

    return Array.from(root.querySelectorAll(selector))
      .filter(isSelectableElement)
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (aRect.width * aRect.height) - (bRect.width * bRect.height);
      })
      .slice(0, 60);
  };

  const collectElementStack = (element, x = state.pointerX, y = state.pointerY) => {
    const stack = [];
    const seen = new Set();
    const pointIsKnown = Number.isFinite(x) && Number.isFinite(y);

    if (pointIsKnown) {
      const pointElements = document.elementsFromPoint(x, y);
      for (const pointElement of pointElements) {
        if (isUiElement(pointElement)) {
          continue;
        }
        addElementAndParents(stack, seen, pointElement);
      }

      for (const pointElement of pointElements.slice(0, 5)) {
        if (!pointElement || isUiElement(pointElement)) {
          continue;
        }

        for (const descendant of collectDescendantsAtPoint(pointElement, x, y)) {
          addElementAndParents(stack, seen, descendant);
        }

        for (const descendant of collectVisualDescendants(pointElement)) {
          addElementAndParents(stack, seen, descendant);
        }
      }
    }

    addElementAndParents(stack, seen, element);
    for (const descendant of collectVisualDescendants(element)) {
      addElementAndParents(stack, seen, descendant);
    }

    return stack.sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      const areaDelta = (aRect.width * aRect.height) - (bRect.width * bRect.height);
      if (areaDelta !== 0) {
        return areaDelta;
      }

      if (a.contains(b) && a !== b) {
        return 1;
      }

      if (b.contains(a) && a !== b) {
        return -1;
      }

      return 0;
    });
  };

  const resolveRemovalTarget = (element) => element;

  const selectedDepthLabel = () => {
    if (!state.hoverStack.length) {
      return "";
    }

    return `${state.hoverIndex + 1}/${state.hoverStack.length}`;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const alphaFromColor = (value) => {
    const match = String(value || "").match(/rgba?\(([^)]+)\)/i);
    if (!match) {
      return 1;
    }

    const parts = match[1].split(",").map((part) => part.trim());
    return parts.length >= 4 ? Number(parts[3]) : 1;
  };

  const isVisibleColor = (value) =>
    Boolean(value && value !== "transparent" && alphaFromColor(value) > 0.05);

  const cleanClassNames = (element, limit = 4) =>
    Array.from(element.classList || [])
      .filter((name) => name && name.length <= 48 && !/^dh-/.test(name))
      .filter((name) => !/^\d/.test(name))
      .slice(0, limit);

  const quoteAttr = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const isUniqueForElement = (selector, element) => {
    const matches = selectorMatches(selector);
    return matches.length === 1 && matches[0] === element;
  };

  const nthOfType = (element) => {
    let index = 1;
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.localName === element.localName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return `${element.localName}:nth-of-type(${index})`;
  };

  const selectorPart = (element, includeNth = false) => {
    const tag = element.localName;
    if (element.id) {
      return `${tag}#${cssEscape(element.id)}`;
    }

    const classes = cleanClassNames(element, 2);
    const classPart = classes.length ? `.${classes.map(cssEscape).join(".")}` : "";
    return `${tag}${classPart}${includeNth ? `:nth-of-type(${nthOfTypeIndex(element)})` : ""}`;
  };

  const nthOfTypeIndex = (element) => {
    let index = 1;
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.localName === element.localName) {
        index += 1;
      }
    }
    return index;
  };

  const buildSelector = (element) => {
    const tag = element.localName;

    if (element.id) {
      const byId = `#${cssEscape(element.id)}`;
      if (isUniqueForElement(byId, element)) {
        return byId;
      }
    }

    const usefulAttributes = [
      "data-testid",
      "data-test-id",
      "data-cy",
      "data-ad-slot",
      "data-ad-client",
      "aria-label",
      "role"
    ];

    for (const attr of usefulAttributes) {
      const value = element.getAttribute(attr);
      if (value && value.length <= 80) {
        const selector = `${tag}[${attr}="${quoteAttr(value)}"]`;
        const matches = selectorMatches(selector);
        if (matches.length > 0 && matches.length <= 8 && matches.includes(element)) {
          return selector;
        }
      }
    }

    const classes = cleanClassNames(element, 4);
    if (classes.length) {
      const byClass = `${tag}.${classes.map(cssEscape).join(".")}`;
      const matches = selectorMatches(byClass);
      if (matches.length > 0 && matches.length <= 8 && matches.includes(element)) {
        return byClass;
      }
    }

    const path = [];
    let current = element;
    let depth = 0;

    while (current && current.nodeType === Node.ELEMENT_NODE && current.localName !== "html" && depth < 7) {
      if (current.id) {
        path.unshift(`${current.localName}#${cssEscape(current.id)}`);
        break;
      }

      const classesForPath = cleanClassNames(current, 2);
      let part = current.localName;
      if (classesForPath.length) {
        part += `.${classesForPath.map(cssEscape).join(".")}`;
      }

      const parent = current.parentElement;
      if (parent) {
        const similar = Array.from(parent.children).filter((child) => child.localName === current.localName);
        if (similar.length > 1) {
          part += `:nth-of-type(${nthOfTypeIndex(current)})`;
        }
      }

      path.unshift(part);
      const selector = path.join(" > ");
      if (isUniqueForElement(selector, element)) {
        return selector;
      }

      current = current.parentElement;
      depth += 1;
    }

    return path.join(" > ") || nthOfType(element);
  };

  const ensurePersistedStyle = () => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.type = "text/css";
      document.documentElement.appendChild(style);
    }
    return style;
  };

  const applyRules = (rules = state.rules) => {
    state.rules = Array.isArray(rules) ? rules : [];
    const cssRules = state.rules
      .filter((rule) => rule.enabled !== false && rule.selector)
      .map((rule) => {
        const selector = sanitizeSelector(rule.selector);
        return selector ? `${selector} { display: none !important; }` : "";
      })
      .filter(Boolean);

    const style = ensurePersistedStyle();
    style.textContent = cssRules.join("\n");
    updateToolbar();
  };

  const sanitizeSelector = (selector) => {
    if (!selector || /[{}]/.test(selector)) {
      return "";
    }

    try {
      document.querySelector(selector);
      return selector;
    } catch {
      return "";
    }
  };

  const youtubeAdSelectors = [
    "ytd-ad-slot-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-player-legacy-desktop-watch-ads-renderer",
    "ytd-companion-slot-renderer",
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
    "ytd-rich-item-renderer:has(ytd-display-ad-renderer)",
    "ytd-rich-item-renderer:has(ytd-promoted-sparkles-web-renderer)",
    "ytd-rich-item-renderer:has(ytd-promoted-video-renderer)",
    "ytm-promoted-sparkles-web-renderer",
    "#masthead-ad",
    "#player-ads",
    ".ytp-ad-overlay-container",
    ".ytp-ad-overlay-slot",
    ".ytp-ad-text-overlay",
    "ytd-action-companion-ad-renderer",
    "[aria-label='advertisement' i]",
    "[aria-label='sponsored' i]"
  ];

  const isYouTubeSite = () => /(^|\.)youtube\.com$/i.test(siteKey);

  const isYouTubeHome = () => isYouTubeSite() && location.pathname === "/";

  const isYouTubeShorts = () =>
    isYouTubeSite() && location.pathname.startsWith("/shorts/");

  const getYoutubeRowContents = (row) =>
    Array.from(row.children || []).find((child) => child.id === "contents") || null;

  const directYoutubeRichItems = (row) => {
    const contents = getYoutubeRowContents(row);
    if (!contents) {
      return [];
    }

    return Array.from(contents.children || [])
      .filter((child) => child.localName === "ytd-rich-item-renderer");
  };

  const isYoutubeAdRichItem = (item) =>
    Boolean(item?.querySelector?.(
      [
        "ytd-ad-slot-renderer",
        "ytd-display-ad-renderer",
        "ytd-promoted-sparkles-web-renderer",
        "ytd-promoted-video-renderer"
      ].join(",")
    ));

  const isNormalYoutubeVideoItem = (item) =>
    Boolean(
      item?.localName === "ytd-rich-item-renderer" &&
      !isYoutubeAdRichItem(item) &&
      !item.matches("[hidden], [aria-hidden='true']") &&
      !item.querySelector("ytd-reel-item-renderer, ytd-rich-section-renderer") &&
      item.querySelector("ytd-rich-grid-media")
    );

  const visibleNormalYoutubeItems = (row) =>
    directYoutubeRichItems(row).filter((item) =>
      isNormalYoutubeVideoItem(item) && item.getClientRects().length > 0
    );

  const getYoutubeRowCapacity = (row) => {
    if (!row.dataset.simplSlots) {
      const directItems = directYoutubeRichItems(row);
      row.dataset.simplSlots = String(directItems.length || 0);
    }

    return Number(row.dataset.simplSlots || 0);
  };

  const findNextYoutubeVideoItem = (rows, rowIndex) => {
    for (let index = rowIndex + 1; index < rows.length; index += 1) {
      for (const item of directYoutubeRichItems(rows[index])) {
        if (isNormalYoutubeVideoItem(item)) {
          return item;
        }
      }
    }

    return null;
  };

  const compactYouTubeHomeRows = () => {
    state.youtubeCompactTimer = null;
    if (!state.strictAdsEnabled || !isYouTubeHome()) {
      return;
    }

    const rows = Array.from(document.querySelectorAll("ytd-rich-grid-row"))
      .filter((row) => directYoutubeRichItems(row).some((item) => isNormalYoutubeVideoItem(item) || isYoutubeAdRichItem(item)));

    rows.forEach(getYoutubeRowCapacity);

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const contents = getYoutubeRowContents(row);
      const capacity = getYoutubeRowCapacity(row);
      if (!contents || capacity <= 0) {
        continue;
      }

      let visibleItems = visibleNormalYoutubeItems(row);
      let safety = 0;
      while (visibleItems.length < capacity && safety < 6) {
        safety += 1;
        const nextItem = findNextYoutubeVideoItem(rows, rowIndex);
        if (!nextItem) {
          break;
        }

        contents.append(nextItem);
        visibleItems = visibleNormalYoutubeItems(row);
      }
    }
  };

  const scheduleYouTubeHomeCompaction = () => {
    if (state.youtubeCompactTimer || !state.strictAdsEnabled || !isYouTubeHome()) {
      return;
    }

    state.youtubeCompactTimer = setTimeout(compactYouTubeHomeRows, 250);
  };

  const stopYoutubeCompactor = () => {
    clearTimeout(state.youtubeCompactTimer);
    state.youtubeCompactTimer = null;

    if (state.youtubeCompactorObserver) {
      state.youtubeCompactorObserver.disconnect();
      state.youtubeCompactorObserver = null;
    }
  };

  const startYoutubeCompactor = () => {
    if (!state.strictAdsEnabled || !isYouTubeHome() || state.youtubeCompactorObserver) {
      scheduleYouTubeHomeCompaction();
      return;
    }

    state.youtubeCompactorObserver = new MutationObserver(scheduleYouTubeHomeCompaction);
    state.youtubeCompactorObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    scheduleYouTubeHomeCompaction();
  };

  const readYoutubeMediaState = (video) => ({
    playbackRate: video.playbackRate,
    defaultPlaybackRate: video.defaultPlaybackRate,
    muted: video.muted,
    volume: video.volume
  });

  const restoreYoutubeAdMedia = () => {
    const saved = state.youtubeAdMediaState;
    state.youtubeAdMediaState = null;
    state.youtubeAdLastSeekAt = 0;
    if (!saved?.video?.isConnected) {
      return;
    }

    try {
      saved.video.playbackRate = saved.playbackRate;
      saved.video.defaultPlaybackRate = saved.defaultPlaybackRate;
      saved.video.volume = saved.volume;
      saved.video.muted = saved.muted;
    } catch {
      // YouTube may replace the media element while transitioning out of an ad.
    }
  };

  const getVisibleYoutubeShortsRenderer = () => {
    let bestRenderer = null;
    let bestVisibleHeight = 0;

    for (const renderer of document.querySelectorAll("ytd-reel-video-renderer")) {
      const rect = renderer.getBoundingClientRect();
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
      );
      if (visibleHeight > bestVisibleHeight) {
        bestVisibleHeight = visibleHeight;
        bestRenderer = renderer;
      }
    }

    return bestRenderer;
  };

  const isYoutubeShortsAd = (renderer) => {
    if (!renderer) {
      return false;
    }

    if (renderer.matches("[is-ad], [data-is-ad='true'], [ad-client-params]")) {
      return true;
    }

    if (renderer.querySelector([
      "#shorts-player.ad-showing",
      ".html5-video-player.ad-showing",
      "ytd-ad-slot-renderer",
      "ytd-display-ad-renderer",
      "ytd-promoted-video-renderer",
      "ytd-promoted-sparkles-web-renderer",
      "[is-ad]",
      "[data-is-ad='true']",
      "[ad-client-params]",
      "[class*='ad-badge' i]",
      "[id*='ad-badge' i]",
      "a[href*='googleadservices.com']",
      "a[href*='doubleclick.net']"
    ].join(","))) {
      return true;
    }

    return Array.from(renderer.querySelectorAll(
      "[aria-label], span, yt-formatted-string"
    )).some((element) => {
      const label = (
        element.getAttribute("aria-label") ||
        (element.children.length === 0 ? element.textContent : "") ||
        ""
      ).trim().toLowerCase();
      return label === "sponsored" || label.startsWith("sponsored ");
    });
  };

  const skipYoutubeShortsAd = () => {
    if (!isYouTubeShorts()) {
      return;
    }

    const renderer = getVisibleYoutubeShortsRenderer();
    if (!isYoutubeShortsAd(renderer)) {
      return;
    }

    const now = Date.now();
    if (now - state.youtubeShortsSkipAt < 700) {
      return;
    }

    const buttons = document.querySelectorAll([
      "#navigation-button-down button",
      "ytd-shorts button[aria-label='Next video' i]"
    ].join(","));

    for (const button of buttons) {
      if (
        button.disabled ||
        button.getAttribute("aria-disabled") === "true" ||
        button.getClientRects().length === 0
      ) {
        continue;
      }

      state.youtubeShortsSkipAt = now;
      button.click();
      return;
    }
  };

  const youtubeSkipButtonIsActionable = (button) => {
    if (
      !button?.isConnected ||
      button.disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      button.getClientRects().length === 0
    ) {
      return false;
    }

    const style = getComputedStyle(button);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      style.opacity !== "0" &&
      style.pointerEvents !== "none"
    );
  };

  const clickYoutubeSkipButton = (player) => {
    const skipSelectors = [
      "button.ytp-skip-ad-button[id^='skip-button:']",
      ".ytp-ad-skip-button",
      ".ytp-ad-skip-button-container",
      ".ytp-ad-skip-button-text",
      ".ytp-skip-ad-button",
      ".ytp-ad-skip-button-modern",
      ".ytp-ad-skip-button-slot button",
      ".ytp-ad-skip-button-slot [role='button']",
      ".videoAdUiSkipButton",
      "[class*='skip-ad-button' i]",
      "[id*='skip-ad' i]"
    ].join(",");
    const accessibleSelectors = [
      "button[aria-label*='Skip' i]",
      "[role='button'][aria-label*='Skip' i]"
    ].join(",");
    const candidates = new Set([
      ...document.querySelectorAll(skipSelectors),
      ...player.querySelectorAll(accessibleSelectors)
    ]);
    const clickedButtons = new Set();
    let foundVisibleSkip = false;

    for (const candidate of candidates) {
      const button = candidate.matches("button, [role='button']")
        ? candidate
        : candidate.closest("button, [role='button']") ||
          candidate.querySelector("button, [role='button']") ||
          candidate;

      if (
        clickedButtons.has(button) ||
        !youtubeSkipButtonIsActionable(button)
      ) {
        continue;
      }

      clickedButtons.add(button);
      foundVisibleSkip = true;
    }

    if (foundVisibleSkip) {
      document.dispatchEvent(new CustomEvent(YOUTUBE_SKIP_EVENT));
    }
  };

  const syncYoutubeMainStrictAdsState = () => {
    if (!isYouTubeSite()) {
      return;
    }

    document.dispatchEvent(new CustomEvent(YOUTUBE_STRICT_ADS_EVENT, {
      detail: state.strictAdsEnabled
    }));
  };

  const applyYoutubeAdSpeed = (video) => {
    try {
      video.defaultPlaybackRate = YOUTUBE_NATIVE_AD_SPEED;
    } catch {
      // Keep going: defaultPlaybackRate support varies by media type.
    }

    try {
      video.playbackRate = YOUTUBE_NATIVE_AD_SPEED;
    } catch {
      // Skip clicking must still run even when a media rate is rejected.
    }

    try {
      video.muted = true;
    } catch {
      // Muting is helpful but not required for acceleration or skipping.
    }

    const now = performance.now();
    if (!state.youtubeAdLastSeekAt) {
      state.youtubeAdLastSeekAt = now;
      return;
    }

    const elapsedMs = Math.min(now - state.youtubeAdLastSeekAt, 1000);
    if (elapsedMs < YOUTUBE_AD_SEEK_MS || video.seeking) {
      return;
    }
    state.youtubeAdLastSeekAt = now;

    const extraSeconds = (elapsedMs / 1000) * (
      YOUTUBE_AD_SPEED - YOUTUBE_NATIVE_AD_SPEED
    );
    if (
      Number.isFinite(video.currentTime) &&
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.currentTime + extraSeconds < video.duration - 0.1
    ) {
      try {
        video.currentTime += extraSeconds;
      } catch {
        // Some stitched or live ads do not expose a seekable timeline.
      }
    }

  };

  const accelerateYoutubeAd = () => {
    if (!state.strictAdsEnabled || !isYouTubeSite()) {
      return;
    }

    skipYoutubeShortsAd();

    const player = document.querySelector(
      isYouTubeShorts() ? "#shorts-player" : "#movie_player"
    );
    const video = player?.querySelector("video.html5-main-video, video");
    if (!player || !video) {
      return;
    }

    const adShowing = player.classList.contains("ad-showing");
    clickYoutubeSkipButton(player);

    if (!adShowing) {
      restoreYoutubeAdMedia();
      state.youtubeContentMediaState = readYoutubeMediaState(video);
      return;
    }

    if (state.youtubeAdMediaState?.video !== video) {
      restoreYoutubeAdMedia();
      state.youtubeAdMediaState = {
        video,
        ...(state.youtubeContentMediaState || readYoutubeMediaState(video))
      };
      state.youtubeAdLastSeekAt = performance.now();
    }

    applyYoutubeAdSpeed(video);
  };

  const stopYoutubeAdAccelerator = () => {
    clearInterval(state.youtubeAdAcceleratorTimer);
    state.youtubeAdAcceleratorTimer = null;
    restoreYoutubeAdMedia();
    state.youtubeContentMediaState = null;
    state.youtubeAdLastSeekAt = 0;
    state.youtubeShortsSkipAt = 0;
  };

  const startYoutubeAdAccelerator = () => {
    if (!state.strictAdsEnabled || !isYouTubeSite()) {
      return;
    }

    if (!state.youtubeAdAcceleratorTimer) {
      state.youtubeAdAcceleratorTimer = setInterval(
        accelerateYoutubeAd,
        YOUTUBE_AD_CHECK_MS
      );
    }
    accelerateYoutubeAd();
  };

  const removeYoutubeAdStyle = () => {
    document.getElementById(YOUTUBE_AD_STYLE_ID)?.remove();
  };

  const applyYoutubeAdStyle = (enabled = state.strictAdsEnabled) => {
    state.strictAdsEnabled = enabled !== false;
    syncYoutubeMainStrictAdsState();
    if (!state.strictAdsEnabled || !isYouTubeSite()) {
      removeYoutubeAdStyle();
      stopYoutubeCompactor();
      stopYoutubeAdAccelerator();
      return;
    }

    let style = document.getElementById(YOUTUBE_AD_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = YOUTUBE_AD_STYLE_ID;
      style.setAttribute("data-simpl-youtube-ads", "true");
      (document.head || document.documentElement).append(style);
    }

    style.textContent = `
${youtubeAdSelectors.join(",\n")} {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;
    startYoutubeCompactor();
    startYoutubeAdAccelerator();
  };

  const loadCurrentSite = async () => {
    if (!extensionContextIsValid()) {
      return null;
    }

    const data = await storageGet([STORE_KEY, STRICT_ADS_KEY, YOUTUBE_ADS_KEY]);
    if (!extensionContextIsValid()) {
      return null;
    }

    state.globalAdsEnabled = data[STRICT_ADS_KEY] !== false;
    state.youtubeAdsEnabled = data[YOUTUBE_ADS_KEY] === true;
    applyYoutubeAdStyle(
      state.globalAdsEnabled && (!isYouTubeSite() || state.youtubeAdsEnabled)
    );
    const sites = data[STORE_KEY] || {};
    const site = sites[siteKey];
    const rules = site?.rules || [];
    applyRules(rules);
    return site;
  };

  const updateSite = async (mutator) => {
    if (!extensionContextIsValid()) {
      return null;
    }

    const data = await storageGet([STORE_KEY]);
    if (!extensionContextIsValid()) {
      return null;
    }

    const sites = data[STORE_KEY] || {};
    const existing = sites[siteKey] || {
      host: siteKey,
      origin: siteOrigin,
      createdAt: nowIso(),
      activations: 0,
      hides: 0,
      rules: []
    };

    const next = {
      ...existing,
      host: siteKey,
      origin: siteOrigin,
      lastUrl: location.href,
      title: document.title || location.href,
      updatedAt: nowIso(),
      rules: Array.isArray(existing.rules) ? [...existing.rules] : []
    };

    await mutator(next, sites);
    sites[siteKey] = next;
    if (!await storageSet({ [STORE_KEY]: sites })) {
      return null;
    }

    applyRules(next.rules);
    return next;
  };

  const recordActivity = async (type, details = {}) => {
    if (!extensionContextIsValid()) {
      return;
    }

    const data = await storageGet([LOG_KEY]);
    if (!extensionContextIsValid()) {
      return;
    }

    const log = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
    log.unshift({
      id: randomId(),
      type,
      host: siteKey,
      origin: siteOrigin,
      url: location.href,
      title: document.title || location.href,
      timestamp: nowIso(),
      ...details
    });

    await storageSet({ [LOG_KEY]: log.slice(0, LOG_LIMIT) });
  };

  const ensureUi = () => {
    if (state.uiHost && state.ui) {
      return state.ui;
    }

    const host = document.createElement(UI_TAG);
    host.setAttribute("data-dh-ui-root", "true");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          pointer-events: none;
          color-scheme: light;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .highlight {
          position: fixed;
          z-index: 1;
          border: 2px solid #0ea5e9;
          border-radius: 6px;
          background: rgba(14, 165, 233, 0.12);
          box-shadow: 0 0 0 99999px rgba(8, 13, 22, 0.18);
          display: none;
          pointer-events: none;
          box-sizing: border-box;
        }

        .label {
          position: absolute;
          left: -2px;
          top: -30px;
          max-width: 360px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #f8fafc;
          background: #0f172a;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 6px;
          padding: 4px 7px;
          font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          box-shadow: 0 10px 30px rgba(2, 6, 23, 0.3);
        }

        .toolbar {
          position: fixed;
          z-index: 3;
          top: 16px;
          left: 50%;
          transform: translateX(-50%);
          display: none;
          align-items: center;
          flex-wrap: nowrap;
          gap: 7px;
          max-width: calc(100vw - 16px);
          padding: 8px;
          color: #0f172a;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid rgba(15, 23, 42, 0.14);
          border-radius: 8px;
          box-shadow: 0 18px 50px rgba(15, 23, 42, 0.22);
          pointer-events: auto;
          box-sizing: border-box;
        }

        .toolbar.active {
          display: flex;
        }

        .status {
          min-width: 0;
          flex: 1 1 180px;
          color: #334155;
          font: 13px/1.35 Inter, ui-sans-serif, system-ui, sans-serif;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        button {
          appearance: none;
          border: 1px solid #cbd5e1;
          background: #fff;
          color: #0f172a;
          border-radius: 6px;
          min-height: 32px;
          padding: 0 11px;
          font: 600 13px/1 Inter, ui-sans-serif, system-ui, sans-serif;
          cursor: pointer;
        }

        button.primary {
          border-color: #0284c7;
          background: #0284c7;
          color: #fff;
        }

        button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .drag-handle {
          flex: 0 0 auto;
          display: grid;
          grid-template-columns: repeat(2, 3px);
          grid-template-rows: repeat(3, 3px);
          gap: 3px;
          align-content: center;
          justify-content: center;
          width: 24px;
          min-width: 24px;
          min-height: 32px;
          border: 0;
          padding: 0;
          background: transparent;
          cursor: grab;
          touch-action: none;
        }

        .drag-handle:active {
          cursor: grabbing;
        }

        .drag-handle span {
          width: 3px;
          height: 3px;
          border-radius: 999px;
          background: #64748b;
        }

        .shortcut-label {
          position: absolute;
          top: calc(100% + 3px);
          transform: translateX(-50%);
          margin: 0;
          padding: 1px 4px;
          color: #64748b;
          background: rgba(255, 255, 255, 0.92);
          border-radius: 4px;
          font: 11px/1.25 Inter, ui-sans-serif, system-ui, sans-serif;
          text-align: center;
          white-space: nowrap;
          pointer-events: none;
        }

        .event-shield {
          position: fixed;
          inset: 0;
          z-index: 0;
          display: block;
          background: transparent;
          pointer-events: auto;
          cursor: crosshair;
        }

        .event-shield[hidden] {
          display: none;
        }

        .vanish-layer {
          position: fixed;
          z-index: 2;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
        }

        .vanish-fragment {
          position: fixed;
          left: var(--x);
          top: var(--y);
          width: var(--size);
          height: var(--size);
          border-radius: 999px;
          background: var(--color);
          opacity: 0.76;
          filter: blur(0.15px);
          transform: translate3d(0, 0, 0) scale(1);
          animation: dh-fragment-drift var(--duration) cubic-bezier(.16,.84,.28,1) forwards;
          box-shadow: 0 0 10px color-mix(in srgb, var(--color), transparent 45%);
          pointer-events: none;
        }

        @keyframes dh-fragment-drift {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) scale(0.8) rotate(0deg);
          }

          12% {
            opacity: 0.82;
          }

          70% {
            opacity: 0.5;
          }

          100% {
            opacity: 0;
            filter: blur(3px);
            transform: translate3d(var(--dx), var(--dy), 0) scale(0.12) rotate(var(--rot));
          }
        }
      </style>
      <div class="highlight" part="highlight">
        <span class="label"></span>
      </div>
      <div class="event-shield" aria-hidden="true" hidden></div>
      <div class="vanish-layer" aria-hidden="true"></div>
      <div class="toolbar" role="toolbar" aria-label="Simpl picker">
        <button class="drag-handle" type="button" title="Drag toolbar" aria-label="Drag toolbar">
          <span></span><span></span><span></span><span></span><span></span><span></span>
        </button>
        <span class="status">Click an element to hide it.</span>
        <button class="smaller" type="button" title="Select a smaller nested element">Smaller</button>
        <button class="larger" type="button" title="Select a larger parent element">Larger</button>
        <button class="reset-depth" type="button" title="Reset to the default element selection">Reset</button>
        <button class="undo" type="button" title="Undo the last hidden element">Undo</button>
        <button class="done primary" type="button" title="Leave picker mode">Done</button>
        <span class="shortcut-label depth-shortcut">Shift+wheel</span>
        <span class="shortcut-label undo-shortcut">Ctrl+Z</span>
      </div>
    `;

    document.documentElement.appendChild(host);
    state.uiHost = host;
    state.ui = {
      shadow,
      highlight: shadow.querySelector(".highlight"),
      label: shadow.querySelector(".label"),
      shield: shadow.querySelector(".event-shield"),
      vanishLayer: shadow.querySelector(".vanish-layer"),
      toolbar: shadow.querySelector(".toolbar"),
      dragHandle: shadow.querySelector(".drag-handle"),
      status: shadow.querySelector(".status"),
      smallerButton: shadow.querySelector(".smaller"),
      largerButton: shadow.querySelector(".larger"),
      resetButton: shadow.querySelector(".reset-depth"),
      undoButton: shadow.querySelector(".undo"),
      doneButton: shadow.querySelector(".done"),
      depthShortcut: shadow.querySelector(".depth-shortcut"),
      undoShortcut: shadow.querySelector(".undo-shortcut")
    };

    state.ui.dragHandle.addEventListener("pointerdown", onToolbarDragStart);
    state.ui.smallerButton.addEventListener("click", () => changeSelectionDepth(-1));
    state.ui.largerButton.addEventListener("click", () => changeSelectionDepth(1));
    state.ui.resetButton.addEventListener("click", () => resetSelectionDepth());
    state.ui.undoButton.addEventListener("click", () => {
      undoLastHide().catch(handleAsyncError);
    });
    state.ui.doneButton.addEventListener("click", () => exitPicker());
    state.ui.shield.addEventListener("mousemove", onShieldPointerMove);
    state.ui.shield.addEventListener("mouseover", onShieldPointerMove);
    state.ui.shield.addEventListener("click", onShieldClick);
    state.ui.shield.addEventListener("wheel", onWheel, WHEEL_LISTENER_OPTIONS);
    return state.ui;
  };

  const clampNumber = (value, min, max) => Math.max(min, Math.min(max, value));

  const positionToolbar = (left, top) => {
    if (!state.ui) {
      return;
    }

    const toolbar = state.ui.toolbar;
    const rect = toolbar.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    toolbar.style.left = `${clampNumber(left, margin, maxLeft)}px`;
    toolbar.style.top = `${clampNumber(top, margin, maxTop)}px`;
    toolbar.style.transform = "none";
    positionShortcutLabels();
  };

  const resetToolbarPosition = () => {
    if (!state.ui) {
      return;
    }

    state.ui.toolbar.style.removeProperty("left");
    state.ui.toolbar.style.removeProperty("top");
    state.ui.toolbar.style.removeProperty("transform");
    positionShortcutLabels();
  };

  const cleanupToolbarDrag = () => {
    if (!state.toolbarDrag) {
      return;
    }

    window.removeEventListener("pointermove", onToolbarDragMove, true);
    window.removeEventListener("pointerup", onToolbarDragEnd, true);
    window.removeEventListener("pointercancel", onToolbarDragEnd, true);
    try {
      state.ui?.dragHandle.releasePointerCapture?.(state.toolbarDrag.pointerId);
    } catch {
      // Pointer capture may already be released.
    }
    state.toolbarDrag = null;
  };

  const onToolbarDragStart = (event) => {
    if (!state.pickerActive || event.button !== 0) {
      return;
    }

    claimPickerEvent(event);
    const rect = state.ui.toolbar.getBoundingClientRect();
    state.toolbarDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };

    try {
      state.ui.dragHandle.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is a nice-to-have for smoother dragging.
    }

    window.addEventListener("pointermove", onToolbarDragMove, true);
    window.addEventListener("pointerup", onToolbarDragEnd, true);
    window.addEventListener("pointercancel", onToolbarDragEnd, true);
  };

  const onToolbarDragMove = (event) => {
    if (!state.toolbarDrag || event.pointerId !== state.toolbarDrag.pointerId) {
      return;
    }

    claimPickerEvent(event);
    positionToolbar(
      event.clientX - state.toolbarDrag.offsetX,
      event.clientY - state.toolbarDrag.offsetY
    );
  };

  const onToolbarDragEnd = (event) => {
    if (!state.toolbarDrag || event.pointerId !== state.toolbarDrag.pointerId) {
      return;
    }

    claimPickerEvent(event);
    cleanupToolbarDrag();
  };

  const describeElement = (element) => {
    if (!element) {
      return "";
    }

    let description = element.localName;
    if (element.id) {
      description += `#${element.id}`;
    }

    const classes = cleanClassNames(element, 2);
    if (classes.length) {
      description += `.${classes.join(".")}`;
    }

    const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 60);
    return text ? `${description} - ${text}` : description;
  };

  const setHoverElement = (element, options = {}) => {
    const stack = collectElementStack(element);
    if (!stack.length) {
      state.hoverElement = null;
      state.hoverStack = [];
      state.hoverIndex = 0;
      state.defaultHoverIndex = 0;
      updateHighlight();
      updateToolbar();
      return;
    }

    state.hoverStack = stack;
    const baseIndex = state.hoverStack.indexOf(element);
    state.defaultHoverIndex = baseIndex >= 0 ? baseIndex : state.hoverStack.length - 1;
    if (!options.ignorePreferredDepth && Number.isInteger(state.preferredDepth)) {
      state.hoverIndex = Math.min(state.preferredDepth, state.hoverStack.length - 1);
    } else {
      const currentIndex = options.preserveCurrentSelection
        ? state.hoverStack.indexOf(state.hoverElement)
        : -1;
      state.hoverIndex = currentIndex >= 0 ? currentIndex : state.defaultHoverIndex;
    }
    state.hoverElement = state.hoverStack[state.hoverIndex];
    updateHighlight();
    updateToolbar();
  };

  const elementFromPointIgnoringPickerUi = (x, y) => {
    const shield = state.ui?.shield;
    const previousPointerEvents = shield?.style.pointerEvents;

    if (shield) {
      shield.style.pointerEvents = "none";
    }

    const element = document.elementFromPoint(x, y);

    if (shield) {
      shield.style.pointerEvents = previousPointerEvents || "";
    }

    return element;
  };

  const refreshHoverFromPoint = (options = {}) => {
    if (state.pointerX === null || state.pointerY === null) {
      return;
    }

    setHoverElement(elementFromPointIgnoringPickerUi(state.pointerX, state.pointerY), options);
  };

  const changeSelectionDepth = (delta) => {
    if (!state.hoverStack.length) {
      return;
    }

    const nextIndex = Math.max(0, Math.min(state.hoverStack.length - 1, state.hoverIndex + delta));
    if (nextIndex === state.hoverIndex) {
      return;
    }

    state.hoverIndex = nextIndex;
    state.preferredDepth = nextIndex;
    state.hoverElement = state.hoverStack[state.hoverIndex];
    updateHighlight();
    updateToolbar();
  };

  const resetSelectionDepth = () => {
    if (!state.hoverStack.length) {
      return;
    }

    state.preferredDepth = null;
    state.hoverIndex = Math.max(0, Math.min(state.hoverStack.length - 1, state.defaultHoverIndex));
    state.hoverElement = state.hoverStack[state.hoverIndex];
    updateHighlight();
    updateToolbar();
  };

  const updateHighlight = () => {
    const ui = ensureUi();
    const element = state.hoverElement;
    if (!state.pickerActive || !isSelectableElement(element)) {
      ui.highlight.style.display = "none";
      return;
    }

    const rect = element.getBoundingClientRect();
    ui.highlight.style.display = "block";
    ui.highlight.style.left = `${Math.max(0, rect.left)}px`;
    ui.highlight.style.top = `${Math.max(0, rect.top)}px`;
    ui.highlight.style.width = `${Math.max(0, rect.width)}px`;
    ui.highlight.style.height = `${Math.max(0, rect.height)}px`;
    const depth = selectedDepthLabel();
    ui.label.textContent = depth ? `${depth} ${describeElement(element)}` : describeElement(element);
  };

  const positionShortcutLabels = () => {
    if (!state.ui || !state.pickerActive) {
      return;
    }

    requestAnimationFrame(() => {
      if (!state.ui || !state.pickerActive) {
        return;
      }

      const toolbarRect = state.ui.toolbar.getBoundingClientRect();
      const smallerRect = state.ui.smallerButton.getBoundingClientRect();
      const largerRect = state.ui.largerButton.getBoundingClientRect();
      const undoRect = state.ui.undoButton.getBoundingClientRect();

      state.ui.depthShortcut.style.left = `${((smallerRect.left + largerRect.right) / 2) - toolbarRect.left}px`;
      state.ui.undoShortcut.style.left = `${(undoRect.left + (undoRect.width / 2)) - toolbarRect.left}px`;
    });
  };

  const updateToolbar = () => {
    if (!state.ui) {
      return;
    }

    state.ui.toolbar.classList.toggle("active", state.pickerActive);
    state.ui.shield.hidden = !state.pickerActive;
    state.ui.smallerButton.disabled = !state.hoverStack.length || state.hoverIndex <= 0;
    state.ui.largerButton.disabled = !state.hoverStack.length || state.hoverIndex >= state.hoverStack.length - 1;
    state.ui.resetButton.disabled = !state.hoverStack.length || state.hoverIndex === state.defaultHoverIndex;
    state.ui.undoButton.disabled = state.undoStack.length === 0;
    const enabledRules = state.rules.filter((rule) => rule.enabled !== false).length;
    const depth = selectedDepthLabel();
    state.ui.status.textContent = state.pickerActive
      ? `Selected ${depth || "-"} - ${enabledRules} saved on this site.`
      : "";
    positionShortcutLabels();
  };

  const createVanishFragments = (element, rect, duration) => {
    const ui = ensureUi();
    const computed = getComputedStyle(element);
    const colors = [
      computed.backgroundColor,
      computed.color,
      computed.borderTopColor,
      "#e0f2fe",
      "#94a3b8"
    ].filter(isVisibleColor);

    const palette = colors.length ? colors : ["#cbd5e1", "#f8fafc"];
    const area = rect.width * rect.height;
    const count = Math.min(72, Math.max(16, Math.round(area / 3600)));
    const fragmentSizeMax = Math.max(4, Math.min(9, Math.round(Math.min(rect.width, rect.height) / 10)));

    for (let index = 0; index < count; index += 1) {
      const fragment = document.createElement("span");
      const size = 2 + Math.random() * fragmentSizeMax;
      const originBias = Math.random() ** 0.55;
      const x = rect.left + rect.width * originBias;
      const y = rect.top + rect.height * Math.random();
      const dx = 34 + Math.random() * 92;
      const dy = -34 + Math.random() * 68;
      const delay = Math.random() * 120;

      fragment.className = "vanish-fragment";
      fragment.style.setProperty("--x", `${x}px`);
      fragment.style.setProperty("--y", `${y}px`);
      fragment.style.setProperty("--size", `${size}px`);
      fragment.style.setProperty("--dx", `${dx}px`);
      fragment.style.setProperty("--dy", `${dy}px`);
      fragment.style.setProperty("--rot", `${-60 + Math.random() * 160}deg`);
      fragment.style.setProperty("--duration", `${duration + delay}ms`);
      fragment.style.setProperty("--color", palette[index % palette.length]);
      fragment.style.animationDelay = `${delay}ms`;
      ui.vanishLayer.appendChild(fragment);
      setTimeout(() => fragment.remove(), duration + delay + 220);
    }
  };

  const startVanishAnimation = (element) => {
    if (!document.contains(element) || !isSelectableElement(element) || state.vanishingElements.has(element)) {
      return null;
    }

    state.vanishingElements.add(element);

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reducedMotion ? 180 : VANISH_DURATION;
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const clone = element.cloneNode(true);
    const appendTarget = document.body || document.documentElement;

    if (state.ui) {
      state.ui.highlight.style.display = "none";
    }

    clone.setAttribute("data-dh-vanish-clone", "true");
    clone.setAttribute("aria-hidden", "true");
    clone.style.setProperty("position", "fixed", "important");
    clone.style.setProperty("left", `${rect.left}px`, "important");
    clone.style.setProperty("top", `${rect.top}px`, "important");
    clone.style.setProperty("width", `${rect.width}px`, "important");
    clone.style.setProperty("height", `${rect.height}px`, "important");
    clone.style.setProperty("max-width", "none", "important");
    clone.style.setProperty("max-height", "none", "important");
    clone.style.setProperty("min-width", "0", "important");
    clone.style.setProperty("min-height", "0", "important");
    clone.style.setProperty("margin", "0", "important");
    clone.style.setProperty("inset", "auto", "important");
    clone.style.setProperty("z-index", "2147483646", "important");
    clone.style.setProperty("pointer-events", "none", "important");
    clone.style.setProperty("box-sizing", computed.boxSizing || "border-box", "important");
    clone.style.setProperty("display", computed.display === "none" ? "block" : computed.display, "important");
    clone.style.setProperty("overflow", computed.overflow === "visible" ? "hidden" : computed.overflow, "important");
    clone.style.setProperty("transform-origin", "center center", "important");
    clone.style.setProperty("will-change", "opacity, transform, filter, clip-path", "important");
    clone.style.setProperty("backface-visibility", "hidden", "important");
    appendTarget.appendChild(clone);

    if (!reducedMotion) {
      createVanishFragments(element, rect, duration);
    }

    const animation = clone.animate(
      reducedMotion
        ? [
            { opacity: 1 },
            { opacity: 0 }
          ]
        : [
            {
              opacity: 1,
              filter: "blur(0px) saturate(1)",
              transform: "translate3d(0, 0, 0) scale(1)",
              clipPath: "inset(0 0 0 0)"
            },
            {
              opacity: 0.78,
              filter: "blur(0.6px) saturate(0.9)",
              transform: "translate3d(4px, -1px, 0) scale(0.998)",
              clipPath: "inset(0 0 0 4%)",
              offset: 0.24
            },
            {
              opacity: 0.32,
              filter: "blur(3.5px) saturate(0.62)",
              transform: "translate3d(18px, -5px, 0) scale(0.99)",
              clipPath: "inset(0 0 0 20%)",
              offset: 0.68
            },
            {
              opacity: 0,
              filter: "blur(10px) saturate(0.28)",
              transform: "translate3d(40px, -11px, 0) scale(0.975)",
              clipPath: "inset(0 0 0 48%)"
            }
          ],
      {
        duration,
        easing: "cubic-bezier(.17,.84,.22,1)",
        fill: "forwards"
      }
    );

    const cleanup = () => {
      clone.remove();
      state.vanishingElements.delete(element);
    };

    const finished = animation.finished
      .catch(() => sleep(duration))
      .then(cleanup);

    return {
      finished,
      cancel: () => {
        animation.cancel();
        cleanup();
        state.vanishingElements.delete(element);
      }
    };
  };

  const eventIsFromUi = (event) => event.composedPath?.().includes(state.uiHost);

  const stopPageGesture = (event) => {
    if (eventIsFromUi(event)) {
      return;
    }

    if ("clientX" in event && "clientY" in event) {
      state.pointerX = event.clientX;
      state.pointerY = event.clientY;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const claimPickerEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const isUndoShortcut = (event) =>
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    String(event.key || "").toLowerCase() === "z";

  const onUndoShortcutCleanupEvent = (event) => {
    if (isUndoShortcut(event)) {
      claimPickerEvent(event);
    }
  };

  const onBeforeInput = (event) => {
    if (event.inputType === "historyUndo") {
      claimPickerEvent(event);
    }
  };

  const onMouseOver = (event) => {
    if (eventIsFromUi(event)) {
      return;
    }
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    setHoverElement(event.target);
  };

  const onMouseMove = (event) => {
    if (eventIsFromUi(event)) {
      return;
    }
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    setHoverElement(event.target);
  };

  const onShieldPointerMove = (event) => {
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    refreshHoverFromPoint();
  };

  const onClick = async (event) => {
    if (eventIsFromUi(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const element = state.hoverElement || event.target;
    if (isSelectableElement(element)) {
      try {
        await hideElement(element);
      } catch (error) {
        handleAsyncError(error);
      }
    }
  };

  const onShieldClick = async (event) => {
    claimPickerEvent(event);

    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    refreshHoverFromPoint();

    const element = state.hoverElement || elementFromPointIgnoringPickerUi(event.clientX, event.clientY);
    if (isSelectableElement(element)) {
      try {
        await hideElement(element);
      } catch (error) {
        handleAsyncError(error);
      }
    }
  };

  const onWheel = (event) => {
    const isShieldEvent = state.ui?.shield && event.composedPath?.().includes(state.ui.shield);
    if ((eventIsFromUi(event) && !isShieldEvent) || !event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    refreshHoverFromPoint({
      ignorePreferredDepth: true,
      preserveCurrentSelection: true
    });

    if (event.deltaY < 0 || event.deltaX < 0) {
      changeSelectionDepth(1);
    } else if (event.deltaY > 0 || event.deltaX > 0) {
      changeSelectionDepth(-1);
    }
  };

  const onKeyDown = (event) => {
    if (!state.pickerActive) {
      return;
    }

    if (event.key === "Escape") {
      claimPickerEvent(event);
      exitPicker();
      return;
    }

    if (isUndoShortcut(event)) {
      claimPickerEvent(event);
      undoLastHide().catch(handleAsyncError);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "[") {
      claimPickerEvent(event);
      changeSelectionDepth(-1);
      return;
    }

    if (event.key === "ArrowRight" || event.key === "]") {
      claimPickerEvent(event);
      changeSelectionDepth(1);
      return;
    }

    if (event.key === " ") {
      claimPickerEvent(event);
      const element = state.hoverElement;
      if (isSelectableElement(element)) {
        hideElement(element).catch(handleAsyncError);
      }
    }
  };

  const onViewportChange = () => {
    refreshHoverFromPoint();
    updateHighlight();
    positionShortcutLabels();
  };

  const onPickerVisibilityChange = () => {
    if (state.pickerActive && document.visibilityState === "hidden") {
      exitPicker();
    }
  };

  const onPickerPageHide = () => {
    if (state.pickerActive) {
      exitPicker();
    }
  };

  const addPickerListeners = () => {
    for (const eventName of BLOCKED_PICKER_EVENTS) {
      window.addEventListener(eventName, stopPageGesture, true);
      document.addEventListener(eventName, stopPageGesture, true);
    }
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKeyDown, true);
    for (const eventName of BLOCKED_UNDO_KEY_EVENTS) {
      window.addEventListener(eventName, onUndoShortcutCleanupEvent, true);
      document.addEventListener(eventName, onUndoShortcutCleanupEvent, true);
    }
    window.addEventListener("beforeinput", onBeforeInput, true);
    window.addEventListener("wheel", onWheel, WHEEL_LISTENER_OPTIONS);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("beforeinput", onBeforeInput, true);
    document.addEventListener("wheel", onWheel, WHEEL_LISTENER_OPTIONS);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange, true);
    document.addEventListener("visibilitychange", onPickerVisibilityChange, true);
    window.addEventListener("pagehide", onPickerPageHide, true);
  };

  const removePickerListeners = () => {
    for (const eventName of BLOCKED_PICKER_EVENTS) {
      window.removeEventListener(eventName, stopPageGesture, true);
      document.removeEventListener(eventName, stopPageGesture, true);
    }
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKeyDown, true);
    for (const eventName of BLOCKED_UNDO_KEY_EVENTS) {
      window.removeEventListener(eventName, onUndoShortcutCleanupEvent, true);
      document.removeEventListener(eventName, onUndoShortcutCleanupEvent, true);
    }
    window.removeEventListener("beforeinput", onBeforeInput, true);
    window.removeEventListener("wheel", onWheel, WHEEL_LISTENER_OPTIONS);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("beforeinput", onBeforeInput, true);
    document.removeEventListener("wheel", onWheel, WHEEL_LISTENER_OPTIONS);
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange, true);
    document.removeEventListener("visibilitychange", onPickerVisibilityChange, true);
    window.removeEventListener("pagehide", onPickerPageHide, true);
  };

  const enterPicker = async () => {
    if (state.pickerActive || !extensionContextIsValid()) {
      return;
    }

    window.dispatchEvent(new CustomEvent("simpl-hide-picker-start"));
    ensureUi();
    state.pickerActive = true;
    await setHistoryGuard(true);
    document.documentElement.classList.add("dh-picker-active");
    addPickerListeners();
    updateToolbar();
    updateHighlight();

    await updateSite(async (site) => {
      site.activations = Number(site.activations || 0) + 1;
    });
    await recordActivity("activated");
  };

  const exitPicker = () => {
    const wasActive = state.pickerActive;
    resetPickerState();
    if (wasActive) {
      setHistoryGuard(false);
    }
  };

  const togglePicker = async () => {
    if (state.pickerActive) {
      exitPicker();
    } else {
      await enterPicker();
    }
    return getStatus();
  };

  const hideElement = async (element) => {
    if (!extensionContextIsValid()) {
      return;
    }

    const target = resolveRemovalTarget(element);
    const selector = buildSelector(target);
    if (!sanitizeSelector(selector)) {
      return;
    }

    state.hoverElement = null;
    state.hoverStack = [];
    state.hoverIndex = 0;
    state.defaultHoverIndex = 0;
    updateHighlight();
    updateToolbar();
    const vanish = startVanishAnimation(target);

    let ruleForUndo = null;
    try {
      const updatedSite = await updateSite(async (site) => {
        const existing = site.rules.find((rule) => rule.selector === selector);
        if (existing) {
          existing.enabled = true;
          existing.updatedAt = nowIso();
          existing.lastUrl = location.href;
          ruleForUndo = existing;
        } else {
          ruleForUndo = {
            id: randomId(),
            selector,
            enabled: true,
            createdAt: nowIso(),
            updatedAt: nowIso(),
            lastUrl: location.href,
            label: describeElement(target)
          };
          site.rules.push(ruleForUndo);
        }
        site.hides = Number(site.hides || 0) + 1;
      });

      if (!updatedSite || !ruleForUndo) {
        vanish?.cancel();
        return;
      }
    } catch (error) {
      vanish?.cancel();
      handleAsyncError(error);
      return;
    }

    state.undoStack.push({
      ruleId: ruleForUndo.id,
      selector: ruleForUndo.selector,
      label: ruleForUndo.label || describeElement(target),
      timestamp: nowIso()
    });
    await recordActivity("hide", { selector: ruleForUndo.selector, ruleId: ruleForUndo.id });

    if (state.pickerActive) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      refreshHoverFromPoint();
    } else {
      state.hoverElement = null;
      state.hoverStack = [];
      state.hoverIndex = 0;
      state.defaultHoverIndex = 0;
      state.preferredDepth = null;
      updateHighlight();
      updateToolbar();
    }
  };

  const undoLastHide = async () => {
    const action = state.undoStack[state.undoStack.length - 1];
    return undoHideByRuleId(action?.ruleId);
  };

  const undoHideByRuleId = async (ruleId) => {
    if (!extensionContextIsValid()) {
      return getStatus();
    }

    const index = state.undoStack.map((action) => action.ruleId).lastIndexOf(ruleId);
    const action = index >= 0 ? state.undoStack[index] : null;
    if (!action) {
      updateToolbar();
      return getStatus();
    }

    state.undoStack = state.undoStack.filter((item) => item.ruleId !== ruleId);
    await updateSite(async (site) => {
      site.rules = site.rules.filter((rule) => rule.id !== action.ruleId);
    });
    await recordActivity("undo", { selector: action.selector, ruleId: action.ruleId });
    updateToolbar();
    if (state.pickerActive) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      refreshHoverFromPoint();
    }
    return getStatus();
  };

  const clearCurrentSite = async () => {
    if (!extensionContextIsValid()) {
      return getStatus();
    }

    await updateSite(async (site) => {
      site.rules = [];
    });
    state.undoStack = [];
    await recordActivity("clear-site");
    return getStatus();
  };

  const getStatus = () => ({
    active: state.pickerActive,
    host: siteKey,
    rulesCount: state.rules.filter((rule) => rule.enabled !== false).length,
    undoCount: state.undoStack.length
  });

  const onRuntimeMessage = (message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    if (message.type === "DH_GET_STATUS") {
      safeSendResponse(sendResponse, getStatus());
      return false;
    }

    if (message.type === "DH_TOGGLE_PICKER") {
      respondWithStatus(togglePicker(), sendResponse);
      return true;
    }

    if (message.type === "DH_UNDO_LAST") {
      respondWithStatus(undoLastHide(), sendResponse);
      return true;
    }

    if (message.type === "DH_CLEAR_SITE_RULES") {
      respondWithStatus(clearCurrentSite(), sendResponse);
      return true;
    }

    return false;
  };

  const onStorageChanged = (changes, area) => {
    if (area !== "local") {
      return;
    }

    if (changes[STRICT_ADS_KEY]) {
      state.globalAdsEnabled = changes[STRICT_ADS_KEY].newValue !== false;
      applyYoutubeAdStyle(
        state.globalAdsEnabled && (!isYouTubeSite() || state.youtubeAdsEnabled)
      );
    }

    if (changes[YOUTUBE_ADS_KEY]) {
      state.youtubeAdsEnabled = changes[YOUTUBE_ADS_KEY].newValue === true;
      applyYoutubeAdStyle(
        state.globalAdsEnabled && (!isYouTubeSite() || state.youtubeAdsEnabled)
      );
    }

    if (changes[STORE_KEY]) {
      const sites = changes[STORE_KEY].newValue || {};
      applyRules(sites[siteKey]?.rules || []);
    }
  };

  try {
    if (extensionContextIsValid()) {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
      chrome.storage.onChanged.addListener(onStorageChanged);
      extensionListenersRegistered = true;
      window.addEventListener("simpl-extension-reinject", markExtensionContextInvalidated);
      extensionReinjectListenerRegistered = true;
    }
  } catch (error) {
    handleExtensionApiError(error);
    // The extension was reloaded while this page still had the old content script.
  }

  loadCurrentSite().catch((error) => {
    handleAsyncError(error);
    // The extension was likely reloaded while this page still had an old content script.
  });
})();
