(() => {
  "use strict";

  if (
    globalThis.__SIMPL_YOUTUBE_PREVIEW_LOADED__ ||
    !/(^|\.)youtube\.com$/i.test(location.hostname)
  ) {
    return;
  }
  globalThis.__SIMPL_YOUTUBE_PREVIEW_LOADED__ = true;

  const SETTING_KEY = "simpl_youtube_preview_player_enabled";
  const ROOT_TAG = "simpl-youtube-preview";
  const CARD_SELECTOR = [
    "ytd-rich-grid-media",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-playlist-video-renderer",
    "yt-lockup-view-model",
    "ytd-rich-item-renderer",
    "ytd-video-preview"
  ].join(",");
  const PREVIEW_WAIT_MS = 5000;
  const ANIMATION_MS = 380;
  const CONTROLS_HIDE_MS = 1100;
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const DEFAULT_QUALITY = "hd1080";
  const PREFS_KEY = "simpl_youtube_viewer_prefs";
  const PLAYER_COMMAND_EVENT = "simpl-youtube-player-command";
  const PLAYER_RESULT_EVENT = "simpl-youtube-player-result";
  const QUALITY_HEIGHTS = {
    highres: 4320,
    hd2880: 2880,
    hd2160: 2160,
    hd1440: 1440,
    hd1080: 1080,
    hd720: 720,
    large: 480,
    medium: 360,
    small: 240,
    tiny: 144
  };
  const clock = new Intl.NumberFormat(undefined, { minimumIntegerDigits: 1 });

  let enabled = false;
  let prefs = {};
  let activeSession = null;
  let destroyed = false;

  const icon = (name) => {
    const icons = {
      play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
      pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
      volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2-3.16v6.32A3.5 3.5 0 0 0 15.5 12zm-2-7.5v2.06a6 6 0 0 1 0 10.88v2.06a8 8 0 0 0 0-14z"/></svg>',
      muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3zm12.7.3-1.4 1.4 1.3 1.3-1.3 1.3 1.4 1.4 1.3-1.3 1.3 1.3 1.4-1.4-1.3-1.3 1.3-1.3-1.4-1.4-1.3 1.3z"/></svg>',
      settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>',
      replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/><text x="12" y="15.2" text-anchor="middle" font-size="6.5" font-weight="700" font-family="Arial, sans-serif">10</text></svg>',
      forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2l5 4-5 4V7a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7z"/><text x="12" y="15.2" text-anchor="middle" font-size="6.5" font-weight="700" font-family="Arial, sans-serif">10</text></svg>',
      quality: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="12" y="14.9" text-anchor="middle" font-size="7.5" font-weight="800" font-family="Arial, sans-serif" fill="currentColor" stroke="none">HD</text></svg>',
      chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.4 15.4 4.6-4.6 4.6 4.6L18 14l-6-6-6 6z"/></svg>',
      glass: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2.4"/></svg>',
      solid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/></svg>',
      comments: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-4.6 4.2A.6.6 0 0 1 2.4 21.8V5A2 2 0 0 1 4 3zm3 5v2h10V8H7zm0 4v2h7v-2H7z"/></svg>',
      share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5.63 20.66 12 15 18.37V14h-1c-3.96 0-7.14 1-9.75 3.09 1.84-4.07 5.11-6.4 9.89-7.1l.86-.13V5.63M14 3v6C6.22 10.13 3.11 15.33 2 21c2.78-3.97 6.44-6 12-6v6l8-9-8-9z"/></svg>',
      save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h12v2H3V5zm0 4h12v2H3V9zm0 4h8v2H3v-2zm14-4h2v4h4v2h-4v4h-2v-4h-4v-2h4V9z"/></svg>',
      description: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1 4v2h12V7H6zm0 4v2h12v-2H6zm0 4v2h8v-2H6z"/></svg>',
      back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
      external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
      pip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7H5v10h5v2H3V5h18v7h-2V7zm-7 5h9v7h-9v-7zm2 2v3h5v-3h-5z"/></svg>',
      fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zm-3-12v2h3v3h2V5h-5z"/></svg>',
      close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>'
    };
    return icons[name] || "";
  };

  const getSettings = () => new Promise((resolve) => {
    try {
      chrome.storage.local.get([SETTING_KEY, PREFS_KEY], (data) => {
        resolve({
          enabled: data?.[SETTING_KEY] === true,
          prefs: data?.[PREFS_KEY] && typeof data[PREFS_KEY] === "object"
            ? data[PREFS_KEY]
            : {}
        });
      });
    } catch {
      resolve({ enabled: false, prefs: {} });
    }
  });

  const savePrefs = (patch) => {
    prefs = { ...prefs, ...patch };
    try {
      chrome.storage.local.set({ [PREFS_KEY]: prefs });
    } catch {
      // The extension context may have been invalidated by an update.
    }
  };

  // Synchronous bridge into youtube-main.js (page world), which can call
  // YouTube's player API. Returns null when the bridge is unavailable.
  const playerCommand = (action, args = {}) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    let result = null;
    const listener = (event) => {
      try {
        const detail = JSON.parse(event.detail || "{}");
        if (detail.id === id) {
          result = detail;
        }
      } catch {
        // Ignore unrelated or malformed results.
      }
    };
    document.addEventListener(PLAYER_RESULT_EVENT, listener, true);
    try {
      document.dispatchEvent(new CustomEvent(PLAYER_COMMAND_EVENT, {
        detail: JSON.stringify({ id, action, ...args })
      }));
    } finally {
      document.removeEventListener(PLAYER_RESULT_EVENT, listener, true);
    }
    return result;
  };

  const isWatchUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      return (
        /(^|\.)youtube\.com$/i.test(url.hostname) &&
        url.pathname === "/watch" &&
        Boolean(url.searchParams.get("v"))
      );
    } catch {
      return false;
    }
  };

  const eventAnchor = (event) => {
    for (const item of event.composedPath()) {
      if (item instanceof HTMLAnchorElement && isWatchUrl(item.href)) {
        return item;
      }
    }
    return null;
  };

  const getCard = (anchor) => anchor.closest(CARD_SELECTOR);

  const videoIdFromUrl = (value) => {
    try {
      return new URL(value, location.href).searchParams.get("v") || "";
    } catch {
      return "";
    }
  };

  const getPreviewPortal = () => (
    document.querySelector("ytd-video-preview-loader ytd-video-preview[active]")
  );

  const getPreviewVideo = (card, expectedUrl) => {
    for (const video of card?.querySelectorAll("video") || []) {
      if (!video.closest("#movie_player, #shorts-player")) {
        return video;
      }
    }

    const portal = getPreviewPortal();
    const portalUrl = (
      portal?.querySelector("#media-container-link")?.href ||
      portal?.querySelector(".ytp-title-link")?.href ||
      ""
    );
    if (portal && videoIdFromUrl(portalUrl) === videoIdFromUrl(expectedUrl)) {
      return portal.querySelector("#inline-player video, #inline-preview-player video, video");
    }
    return null;
  };

  const getOriginElement = (card, anchor) => (
    card?.querySelector(
      "a#thumbnail, ytd-thumbnail, a.ytLockupViewModelContentImage, yt-thumbnail-view-model, #media-container-link"
    ) || anchor || card
  );

  const getPosterUrl = (card) => {
    const image = card?.querySelector(
      "ytd-thumbnail img, img.yt-core-image, yt-thumbnail-view-model img, a.ytLockupViewModelContentImage img"
    );
    return image?.currentSrc || image?.src || "";
  };

  const formatTime = (value) => {
    if (!Number.isFinite(value) || value < 0) {
      return "0:00";
    }
    const seconds = Math.floor(value % 60);
    const minutes = Math.floor(value / 60) % 60;
    const hours = Math.floor(value / 3600);
    if (hours > 0) {
      return `${clock.format(hours)}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${clock.format(minutes)}:${String(seconds).padStart(2, "0")}`;
  };

  const animateDialogIn = (dialog, originRect) => {
    requestAnimationFrame(() => {
      const target = dialog.getBoundingClientRect();
      if (!target.width || !target.height || !originRect?.width || !originRect?.height) {
        return;
      }
      const fromX = originRect.left + originRect.width / 2 - (target.left + target.width / 2);
      const fromY = originRect.top + originRect.height / 2 - (target.top + target.height / 2);
      const scaleX = Math.max(0.08, Math.min(1, originRect.width / target.width));
      const scaleY = Math.max(0.08, Math.min(1, originRect.height / target.height));
      dialog.animate([
        {
          opacity: 0.35,
          transform: `translate(${fromX}px, ${fromY}px) scale(${scaleX}, ${scaleY})`,
          borderRadius: "18px"
        },
        { opacity: 1, transform: "translate(0, 0) scale(1)", borderRadius: "12px" }
      ], {
        duration: ANIMATION_MS,
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "both"
      });
    });
  };

  const animateDialogOut = (dialog, originRect) => {
    const target = dialog.getBoundingClientRect();
    if (!target.width || !target.height || !originRect?.width || !originRect?.height) {
      return dialog.animate([
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(.94)" }
      ], {
        duration: 220,
        easing: "ease-in",
        fill: "both"
      }).finished.catch(() => {});
    }
    const toX = originRect.left + originRect.width / 2 - (target.left + target.width / 2);
    const toY = originRect.top + originRect.height / 2 - (target.top + target.height / 2);
    const scaleX = Math.max(0.08, Math.min(1, originRect.width / target.width));
    const scaleY = Math.max(0.08, Math.min(1, originRect.height / target.height));
    return dialog.animate([
      { opacity: 1, transform: "translate(0, 0) scale(1)" },
      {
        opacity: 0,
        transform: `translate(${toX}px, ${toY}px) scale(${scaleX}, ${scaleY})`
      }
    ], {
      duration: 300,
      easing: "cubic-bezier(.4,0,1,1)",
      fill: "both"
    }).finished.catch(() => {});
  };

  const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

  const getVideoInfo = (card, anchor) => {
    const titleElement = card?.querySelector(
      "#video-title, a#video-title-link, .yt-lockup-metadata-view-model__title, " +
      ".yt-lockup-metadata-view-model-wiki__title, h3 a, h3"
    );
    const title = cleanText(
      titleElement?.getAttribute?.("title") ||
      titleElement?.textContent ||
      anchor?.getAttribute("title") ||
      anchor?.getAttribute("aria-label")
    );
    const channelElement = card?.querySelector(
      "ytd-channel-name #text, ytd-channel-name a, #channel-name a, " +
      ".yt-content-metadata-view-model__metadata-text, " +
      ".yt-content-metadata-view-model-wiki__metadata-text"
    );
    return { title, channel: cleanText(channelElement?.textContent) };
  };

  const createPlayer = ({ url, poster, info }) => {
    const root = document.createElement(ROOT_TAG);
    root.dataset.state = "loading";
    root.dataset.controls = "hidden";
    root.innerHTML = `
      <div class="simpl-youtube-preview-backdrop"></div>
      <section class="simpl-youtube-preview-dialog" role="dialog" aria-modal="true" aria-label="YouTube preview player">
        <div class="simpl-youtube-preview-media">
          <img class="simpl-youtube-preview-poster" alt="">
          <div class="simpl-youtube-preview-status" role="status">
            <span class="simpl-youtube-preview-spinner" aria-hidden="true"></span>
            <span class="simpl-youtube-preview-status-text">Loading preview…</span>
            <button class="simpl-youtube-preview-fallback-open" type="button" hidden>Open on YouTube</button>
            <button class="simpl-youtube-preview-fallback-open simpl-youtube-preview-play-other" type="button" hidden>Play another way</button>
          </div>
          <div class="simpl-youtube-preview-topbar">
            <button class="simpl-youtube-preview-back-video simpl-youtube-preview-icon-button" type="button" aria-label="Previous video" title="Back to previous video (b)" hidden>${icon("back")}</button>
            <a class="simpl-youtube-preview-channel-avatar" href="#" aria-label="Open channel" title="Open channel" hidden><img alt="" draggable="false"></a>
            <div class="simpl-youtube-preview-heading">
              <span class="simpl-youtube-preview-title"></span>
              <span class="simpl-youtube-preview-channel"></span>
            </div>
            <button class="simpl-youtube-preview-open simpl-youtube-preview-icon-button" type="button" aria-label="Continue on YouTube" title="Continue on YouTube at this time (w)">${icon("external")}</button>
            <button class="simpl-youtube-preview-close simpl-youtube-preview-icon-button" type="button" aria-label="Close preview" title="Close (Esc)">${icon("close")}</button>
          </div>
          <div class="simpl-youtube-preview-caps" data-pos="bottom-center"></div>
          <div class="simpl-youtube-preview-desc" data-solid="false" aria-hidden="true">
            <div class="simpl-youtube-preview-desc-head">
              <div class="simpl-youtube-preview-desc-heading">
                <span class="simpl-youtube-preview-desc-title"></span>
                <span class="simpl-youtube-preview-desc-meta"></span>
              </div>
              <div class="simpl-youtube-preview-desc-modes" role="group" aria-label="Panel background">
                <button class="simpl-youtube-preview-desc-glass" type="button" aria-pressed="true" aria-label="Transparent background" title="Transparent">${icon("glass")}</button>
                <button class="simpl-youtube-preview-desc-solid" type="button" aria-pressed="false" aria-label="Solid background" title="Solid">${icon("solid")}</button>
              </div>
            </div>
            <div class="simpl-youtube-preview-desc-body" tabindex="0"></div>
            <div class="simpl-youtube-preview-desc-body simpl-youtube-preview-comments-body" tabindex="0" hidden></div>
          </div>
          <div class="simpl-youtube-preview-toast" aria-live="polite"></div>
          <div class="simpl-youtube-preview-controls">
            <div class="simpl-youtube-preview-recs" aria-hidden="true">
              <div class="simpl-youtube-preview-recs-track" tabindex="-1"></div>
            </div>
            <div class="simpl-youtube-preview-timeline-wrap">
              <div class="simpl-youtube-preview-buffered"></div>
              <div class="simpl-youtube-preview-chapter-marks" aria-hidden="true"></div>
              <input class="simpl-youtube-preview-timeline" type="range" min="0" max="1000" value="0" aria-label="Video position" disabled>
              <div class="simpl-youtube-preview-scrub" hidden>
                <div class="simpl-youtube-preview-scrub-thumb" hidden></div>
                <span class="simpl-youtube-preview-scrub-time">0:00</span>
              </div>
            </div>
            <div class="simpl-youtube-preview-control-row">
              <div class="simpl-youtube-preview-control-group">
                <button class="simpl-youtube-preview-play simpl-youtube-preview-icon-button" type="button" aria-label="Play" title="Play (k)" disabled>
                  <span class="simpl-youtube-preview-play-icon">${icon("play")}</span>
                  <span class="simpl-youtube-preview-pause-icon">${icon("pause")}</span>
                </button>
                <button class="simpl-youtube-preview-back simpl-youtube-preview-icon-button" type="button" aria-label="Back 10 seconds" title="Back 10 seconds (j)" disabled>${icon("replay")}</button>
                <button class="simpl-youtube-preview-ahead simpl-youtube-preview-icon-button" type="button" aria-label="Forward 10 seconds" title="Forward 10 seconds (l)" disabled>${icon("forward")}</button>
                <div class="simpl-youtube-preview-volume-group">
                  <button class="simpl-youtube-preview-mute simpl-youtube-preview-icon-button" type="button" aria-label="Mute" title="Mute (m)" disabled>
                    <span class="simpl-youtube-preview-volume-icon">${icon("volume")}</span>
                    <span class="simpl-youtube-preview-muted-icon">${icon("muted")}</span>
                  </button>
                  <input class="simpl-youtube-preview-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" disabled>
                </div>
                <span class="simpl-youtube-preview-time">0:00 / 0:00</span>
                <button class="simpl-youtube-preview-desc-toggle simpl-youtube-preview-icon-button" type="button" aria-expanded="false" aria-label="Description" title="Description (d)">${icon("description")}</button>
                <button class="simpl-youtube-preview-comments-toggle simpl-youtube-preview-icon-button" type="button" aria-expanded="false" aria-label="Comments" title="Comments (n)">${icon("comments")}</button>
                <span class="simpl-youtube-preview-chapter-name"></span>
              </div>
              <div class="simpl-youtube-preview-center">
                <button class="simpl-youtube-preview-recs-toggle" type="button" aria-expanded="false" title="Recommended videos (r)">
                  <span>Recommended</span>${icon("chevron")}
                </button>
              </div>
              <div class="simpl-youtube-preview-control-group simpl-youtube-preview-right-controls">
                <div class="simpl-youtube-preview-share-wrap">
                  <button class="simpl-youtube-preview-share simpl-youtube-preview-icon-button" type="button" aria-label="Share" title="Share" aria-expanded="false">${icon("share")}</button>
                  <div class="simpl-youtube-preview-share-menu simpl-youtube-preview-pop" role="menu" aria-label="Share" hidden></div>
                </div>
                <div class="simpl-youtube-preview-save-wrap">
                  <button class="simpl-youtube-preview-save simpl-youtube-preview-icon-button" type="button" aria-label="Save to playlist" title="Save to playlist" aria-expanded="false">${icon("save")}</button>
                  <div class="simpl-youtube-preview-save-menu simpl-youtube-preview-pop" role="dialog" aria-label="Save to playlist" hidden></div>
                </div>
                <button class="simpl-youtube-preview-cc simpl-youtube-preview-text-button" type="button" aria-label="Subtitles/closed captions" aria-pressed="false" title="Subtitles/closed captions (c)" disabled>CC</button>
                <div class="simpl-youtube-preview-quality-wrap">
                  <span class="simpl-youtube-preview-quality-badge" aria-hidden="true"></span>
                  <button class="simpl-youtube-preview-quality-button simpl-youtube-preview-icon-button" type="button" aria-label="Video quality" title="Video quality (q)" aria-expanded="false" disabled>${icon("quality")}</button>
                  <div class="simpl-youtube-preview-quality-menu" role="menu" aria-label="Video quality" hidden></div>
                </div>
                <div class="simpl-youtube-preview-settings-wrap">
                  <button class="simpl-youtube-preview-settings-button simpl-youtube-preview-icon-button" type="button" aria-label="Settings" title="Settings" aria-expanded="false" disabled>${icon("settings")}</button>
                  <div class="simpl-youtube-preview-settings-menu" role="dialog" aria-label="Player settings" hidden>
                    <label class="simpl-youtube-preview-setting">
                      <span>Speed</span>
                      <select class="simpl-youtube-preview-speed" aria-label="Playback speed"></select>
                    </label>
                    <label class="simpl-youtube-preview-setting">
                      <span>Caption position</span>
                      <select class="simpl-youtube-preview-cap-pos" aria-label="Caption position">
                        <option value="bottom-left">Bottom left</option>
                        <option value="bottom-center">Bottom center</option>
                        <option value="bottom-right">Bottom right</option>
                        <option value="top-left">Top left</option>
                        <option value="top-right">Top right</option>
                        <option value="custom" hidden>Custom (dragged)</option>
                      </select>
                    </label>
                    <label class="simpl-youtube-preview-setting">
                      <span>Caption size</span>
                      <select class="simpl-youtube-preview-cap-size" aria-label="Caption size">
                        <option value="s">Small</option>
                        <option value="m">Medium</option>
                        <option value="l">Large</option>
                      </select>
                    </label>
                    <label class="simpl-youtube-preview-setting simpl-youtube-preview-caption-row" hidden>
                      <span>Subtitles</span>
                      <select class="simpl-youtube-preview-caption-track" aria-label="Subtitle language"></select>
                    </label>
                    <p class="simpl-youtube-preview-resolution"></p>
                  </div>
                </div>
                <button class="simpl-youtube-preview-pip simpl-youtube-preview-icon-button" type="button" aria-label="Picture in picture" title="Picture in picture (i)" disabled>${icon("pip")}</button>
                <button class="simpl-youtube-preview-fullscreen simpl-youtube-preview-icon-button" type="button" aria-label="Full screen" title="Full screen (f)" disabled>${icon("fullscreen")}</button>
              </div>
            </div>
          </div>
        </div>
      </section>
    `;
    const posterElement = root.querySelector(".simpl-youtube-preview-poster");
    if (poster) {
      posterElement.src = poster;
    } else {
      posterElement.hidden = true;
    }
    root.querySelector(".simpl-youtube-preview-title").textContent = info?.title || "";
    root.querySelector(".simpl-youtube-preview-channel").textContent = info?.channel || "";
    root.dataset.url = url;
    return root;
  };

  const dispatchPreviewHover = (card) => {
    const target = card.querySelector(
      "a#thumbnail, ytd-thumbnail, a.ytLockupViewModelContentImage, yt-thumbnail-view-model, #media-container-link"
    ) || card;
    const rect = target.getBoundingClientRect();
    const common = {
      bubbles: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    try {
      target.dispatchEvent(new PointerEvent("pointerover", { ...common, pointerType: "mouse" }));
      target.dispatchEvent(new PointerEvent("pointerenter", { ...common, pointerType: "mouse" }));
    } catch {
      // PointerEvent is unavailable in a small number of Chromium test contexts.
    }
    target.dispatchEvent(new MouseEvent("mouseover", common));
    target.dispatchEvent(new MouseEvent("mouseenter", common));
  };

  const menusOpen = (session) => (
    !session.ui.settingsMenu.hidden || !session.ui.qualityMenu.hidden ||
    !session.ui.shareMenu.hidden || !session.ui.saveMenu.hidden
  );

  const setControlsVisible = (session, visible) => {
    if (!session || session.closing) {
      return;
    }
    session.root.dataset.controls = visible ? "visible" : "hidden";
    clearTimeout(session.controlsTimer);
    if (
      visible &&
      session.video &&
      !session.video.paused &&
      !menusOpen(session) &&
      !session.recsOpen &&
      !session.descOpen &&
      !session.scrubbing &&
      !session.overControls
    ) {
      session.controlsTimer = setTimeout(() => {
        session.root.dataset.controls = "hidden";
      }, CONTROLS_HIDE_MS);
    }
  };

  const showToast = (session, text) => {
    const { toast } = session.ui;
    toast.textContent = text;
    toast.dataset.visible = "true";
    clearTimeout(session.toastTimer);
    session.toastTimer = setTimeout(() => {
      toast.dataset.visible = "false";
    }, 900);
  };

  const togglePlayback = (session) => {
    if (!session.video) {
      return;
    }
    if (session.video.paused || session.video.ended) {
      session.userPaused = false;
      session.resumeAttempts = 0;
      session.video.play().catch(() => {});
    } else {
      session.userPaused = true;
      session.video.pause();
    }
  };

  const seekTo = (session, seconds) => {
    const { video } = session;
    if (!video) {
      return;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
    const target = Math.max(0, Math.min(duration, seconds));
    const result = session.apiReady ? playerCommand("seek", { seconds: target }) : null;
    if (!result?.ok) {
      video.currentTime = target;
    }
    updateControls(session);
  };

  const seekBy = (session, delta) => {
    if (!session.video) {
      return;
    }
    seekTo(session, session.video.currentTime + delta);
    showToast(session, `${delta > 0 ? "+" : "−"}${Math.abs(delta)}s`);
  };

  const setVolume = (session, value) => {
    const { video } = session;
    if (!video) {
      return;
    }
    session.userSetMute = true;
    video.volume = Math.max(0, Math.min(1, value));
    video.muted = video.volume === 0;
    session.userMuteIntent = video.muted;
    savePrefs({ volume: video.volume });
  };

  const setSpeed = (session, value) => {
    if (!session.video || !Number.isFinite(value)) {
      return;
    }
    session.video.playbackRate = value;
    savePrefs({ speed: value });
  };

  const stepSpeed = (session, direction) => {
    if (!session.video) {
      return;
    }
    const current = session.video.playbackRate;
    const index = SPEEDS.findIndex((value) => value >= current - 0.001);
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (index < 0 ? 3 : index) + direction))];
    setSpeed(session, next);
    showToast(session, next === 1 ? "Normal speed" : `${next}×`);
  };

  const togglePictureInPicture = (session) => {
    if (!session.video || session.ui.pip.disabled) {
      return;
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture?.().catch(() => {});
    } else {
      session.video.requestPictureInPicture?.().catch(() => {});
    }
  };

  const setFullscreen = (session) => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      session.ui.dialog.requestFullscreen?.().catch(() => {});
    }
  };

  const watchUrlAt = (session) => {
    try {
      const url = new URL(session.url, location.href);
      const seconds = Math.floor(session.video?.currentTime || 0);
      if (seconds > 1) {
        url.searchParams.set("t", `${seconds}s`);
      }
      return url.href;
    } catch {
      return session.url;
    }
  };

  // ---- Captions & quality (driven through YouTube's player API) --------

  const textTrackCaptionsEnabled = (session) => (
    Array.from(session.video?.textTracks || []).some((track) => (
      track.mode === "showing" || track.mode === "hidden"
    ))
  );

  const setCaptionButton = (session, pressed) => {
    if (!pressed && session.capText) {
      renderCaptionText(session, "");
    }
    session.ui.cc.dataset.active = String(pressed);
    session.ui.cc.setAttribute("aria-pressed", String(pressed));
  };

  const renderCaptionTracks = (session, captions) => {
    const { captionRow, captionTrack } = session.ui;
    const tracks = captions?.tracks || [];
    captionRow.hidden = tracks.length === 0;
    const signature = `${tracks.map((track) => track.key).join(",")}|${captions?.current || ""}`;
    if (captionTrack.dataset.signature !== signature) {
      captionTrack.dataset.signature = signature;
      captionTrack.replaceChildren();
      const off = document.createElement("option");
      off.value = "";
      off.textContent = "Off";
      captionTrack.append(off);
      for (const track of tracks) {
        const option = document.createElement("option");
        option.value = track.key;
        option.textContent = track.auto && !/auto/i.test(track.label)
          ? `${track.label} (auto)`
          : track.label;
        captionTrack.append(option);
      }
    }
    captionTrack.value = captions?.enabled ? captions.current || "" : "";
  };

  const renderQuality = (session, quality) => {
    const { qualityMenu, qualityButton } = session.ui;
    const levels = quality?.levels || [];
    session.qualityLevels = levels;
    session.qualityCurrent = quality?.current || "";
    qualityButton.disabled = false;
    const active = session.qualityChoice || "auto";
    const signature = `${levels.map((item) => item.level).join(",")}|${active}`;
    if (qualityMenu.dataset.signature === signature) {
      return;
    }
    qualityMenu.dataset.signature = signature;
    qualityMenu.replaceChildren();
    const entries = [{ level: "auto", label: "Auto" }, ...levels];
    for (const item of entries) {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", String(item.level === active));
      option.dataset.level = item.level;
      option.textContent = item.label;
      qualityMenu.append(option);
    }
    if (levels.length < 2) {
      const note = document.createElement("p");
      note.textContent = "YouTube only offers one quality for this preview.";
      qualityMenu.append(note);
    }
  };

  const QUALITY_TIERS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];

  // Snap an odd frame size (e.g. 1920x818 letterboxed video) to the nearest
  // standard tier, using the 16:9-equivalent height.
  const tierFromVideo = (video) => {
    const height = Math.max(video?.videoHeight || 0, Math.round((video?.videoWidth || 0) * 9 / 16));
    if (!height) {
      return 0;
    }
    return QUALITY_TIERS.reduce((best, tier) => (
      Math.abs(tier - height) < Math.abs(best - height) ? tier : best
    ), QUALITY_TIERS[0]);
  };

  const renderResolution = (session) => {
    // Prefer the level the player reports; otherwise snap the frame size.
    const tier = QUALITY_HEIGHTS[session.qualityCurrent] || tierFromVideo(session.video);
    session.ui.resolution.textContent = tier ? `Playing at ${tier}p` : "";
    session.ui.qualityBadge.textContent = !tier ? "" : tier >= 2160 ? "4K" : String(tier);
  };

  const applyStatus = (session, status) => {
    if (!status || session.closing) {
      return;
    }
    const captions = status.captions || {};
    if (session.captionsPending === null) {
      setCaptionButton(session, captions.enabled === true || textTrackCaptionsEnabled(session));
    }
    renderCaptionTracks(session, captions);
    renderQuality(session, status.quality);
    renderResolution(session);
  };

  const refreshPlayerStatus = (session) => {
    if (!session.video || session.closing) {
      return null;
    }
    const result = playerCommand("status");
    session.apiReady = result?.ok === true;
    const status = result?.status || null;

    // Keep retrying a requested caption change while the captions module loads.
    if (status && session.captionsPending !== null) {
      const wanted = session.captionsPending;
      if (Boolean(status.captions?.enabled) === wanted) {
        session.captionsPending = null;
      } else if (session.captionAttempts < 6) {
        session.captionAttempts += 1;
        playerCommand("captions", {
          enabled: wanted,
          key: prefs.captionKey || "",
          languageCode: prefs.captionLanguage || ""
        });
      } else {
        session.captionsPending = null;
      }
    }
    applyStatus(session, status);
    return status;
  };

  const scheduleStatusRefresh = (session, delays = [120, 400, 900, 1800, 3200]) => {
    for (const delay of delays) {
      setTimeout(() => {
        if (activeSession === session && !session.closing) {
          refreshPlayerStatus(session);
        }
      }, delay);
    }
  };

  const setCaptions = (session, wanted, track = null, auto = false) => {
    if (!auto) {
      session.captionsTouched = true;
    }
    // The viewer only draws captions after they were asked for, so YouTube's
    // own default-on captions can never flash up while the video opens.
    session.captionsOn = Boolean(wanted);
    if (!wanted) {
      renderCaptionText(session, "");
    }
    // Only the language is remembered; captions always start off.
    if (track) {
      savePrefs({ captionKey: track.key, captionLanguage: track.languageCode });
    }

    const result = playerCommand("captions", {
      enabled: wanted,
      key: track?.key || prefs.captionKey || "",
      languageCode: track?.languageCode || prefs.captionLanguage || ""
    });

    const tracks = Array.from(session.video?.textTracks || []);
    if ((!result || !result.status?.api) && tracks.length > 0) {
      // No player API to drive: fall back to the media element's text tracks.
      tracks.forEach((item, index) => {
        item.mode = wanted && index === 0 ? "hidden" : "disabled";
      });
      scheduleCaptionRead(session);
      setCaptionButton(session, textTrackCaptionsEnabled(session));
      return;
    }
    if (!result) {
      return;
    }

    session.captionsPending = wanted;
    session.captionAttempts = 0;
    setCaptionButton(session, wanted);
    applyStatus(session, result.status);
    scheduleStatusRefresh(session);
  };

  const toggleCaptions = (session) => {
    const wanted = session.ui.cc.getAttribute("aria-pressed") !== "true";
    setCaptions(session, wanted);
    showToast(session, wanted ? "Subtitles on" : "Subtitles off");
  };

  const setQuality = (session, level, { save = true } = {}) => {
    session.qualityChoice = level === "auto" ? "" : level;
    if (save) {
      savePrefs({ quality: level });
    }
    const result = playerCommand("quality", { level });
    applyStatus(session, result?.status);
    scheduleStatusRefresh(session, [600, 1500, 3000]);
  };

  // Apply the viewer's remembered quality: highest available level at or
  // below the saved one.
  const applySavedQuality = (session, status) => {
    if (session.qualityApplied || !status?.quality?.levels?.length) {
      return;
    }
    session.qualityApplied = true;
    // 1080p (or the best level below it) until the user chooses; applied once.
    const wanted = session.qualityChoice || "auto";
    if (wanted === "auto") {
      return;
    }
    const ceiling = QUALITY_HEIGHTS[wanted] || QUALITY_HEIGHTS[DEFAULT_QUALITY];
    const levels = status.quality.levels;
    const level = levels.find((item) => item.height <= ceiling) ||
      levels[levels.length - 1];
    if (level) {
      setQuality(session, level.level, { save: false });
    }
  };

  // The preview player can start muted. Unmute through the media element
  // only; this never seeks or reloads, and runs a few times at most.
  const applyAudio = (session) => {
    const { video } = session;
    if (!video || session.userMuteIntent || !video.muted) {
      return;
    }
    video.muted = false;
  };

  // ---- Custom caption renderer ----------------------------------------
  // YouTube keeps parsing and timing the captions; the viewer hides YouTube's
  // own caption layer, reads its text, and draws it as a rounded, movable
  // bubble that fades between lines.

  const cueText = (cue) => String(cue?.text || "").replace(/<[^>]+>/g, "");

  const readCaptionText = (session) => {
    const lines = [];
    const root = session.playerNode;
    const container = root?.querySelector?.(".ytp-caption-window-container");
    if (container) {
      const visual = container.querySelectorAll(".caption-visual-line");
      if (visual.length) {
        visual.forEach((line) => lines.push(line.textContent.replace(/\s+/g, " ").trim()));
      } else {
        const groups = new Map();
        container.querySelectorAll(".ytp-caption-segment").forEach((segment) => {
          const key = segment.parentElement;
          groups.set(key, `${groups.get(key) || ""} ${segment.textContent}`);
        });
        groups.forEach((text) => lines.push(text.replace(/\s+/g, " ").trim()));
      }
    }
    if (lines.length === 0) {
      for (const track of session.video?.textTracks || []) {
        if (track.mode === "hidden" || track.mode === "showing") {
          for (const cue of track.activeCues || []) {
            lines.push(cueText(cue).trim());
          }
        }
      }
    }
    // YouTube shows at most two lines at a time, but its DOM can still hold
    // older roll-up lines. Only the newest two are drawn so text never stacks.
    const current = lines.filter(Boolean).filter((line, index, all) => line !== all[index - 1]);
    return current.slice(-2).join("\n");
  };

  const animateBubble = (bubble, keyframes, options) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return { finished: Promise.resolve() };
    }
    return bubble.animate(keyframes, { fill: "both", ...options });
  };

  // The text sits in one inline span; the background is a single SVG shape
  // traced around the measured rows, so rows join with smooth concave curves
  // and every row's edge hugs its own text.
  const SVG_NS = "http://www.w3.org/2000/svg";

  const setBubbleText = (bubble, text) => {
    let hug = bubble.querySelector(".simpl-youtube-preview-cap-text");
    if (!hug) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "simpl-youtube-preview-cap-bg");
      svg.setAttribute("aria-hidden", "true");
      svg.append(document.createElementNS(SVG_NS, "path"));
      hug = document.createElement("span");
      hug.className = "simpl-youtube-preview-cap-text";
      bubble.replaceChildren(svg, hug);
    }
    hug.textContent = text;
  };

  // Closed polygon (clockwise, y down) -> path with rounded corners. Convex
  // corners curve outward, concave ones curve inward.
  const roundedPath = (input, radius) => {
    const points = input.filter((point, index) => {
      const prev = input[(index + input.length - 1) % input.length];
      return point[0] !== prev[0] || point[1] !== prev[1];
    });
    const corners = points.filter((point, index) => {
      const prev = points[(index + points.length - 1) % points.length];
      const next = points[(index + 1) % points.length];
      return (point[0] - prev[0]) * (next[1] - point[1]) -
        (point[1] - prev[1]) * (next[0] - point[0]) !== 0;
    });
    const count = corners.length;
    const length = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    const toward = (from, to, distance) => {
      const total = length(from, to) || 1;
      return [
        from[0] + ((to[0] - from[0]) / total) * distance,
        from[1] + ((to[1] - from[1]) / total) * distance
      ];
    };
    let path = "";
    corners.forEach((point, index) => {
      const prev = corners[(index + count - 1) % count];
      const next = corners[(index + 1) % count];
      const rad = Math.min(radius, length(prev, point) / 2, length(point, next) / 2);
      const start = toward(point, prev, rad);
      const end = toward(point, next, rad);
      const cross = (point[0] - prev[0]) * (next[1] - point[1]) -
        (point[1] - prev[1]) * (next[0] - point[0]);
      path += `${index === 0 ? "M" : "L"}${start[0].toFixed(2)} ${start[1].toFixed(2)}`;
      path += `A${rad.toFixed(2)} ${rad.toFixed(2)} 0 0 ${cross > 0 ? 1 : 0} ${end[0].toFixed(2)} ${end[1].toFixed(2)}`;
    });
    return `${path}Z`;
  };

  const drawBubble = (bubble) => {
    const hug = bubble.querySelector(".simpl-youtube-preview-cap-text");
    const svg = bubble.querySelector(".simpl-youtube-preview-cap-bg");
    if (!hug?.firstChild || !svg || !bubble.offsetWidth) {
      return;
    }
    const box = bubble.getBoundingClientRect();
    // Undo the entrance animation's scale so measurements stay in CSS px.
    const sx = box.width / bubble.offsetWidth || 1;
    const sy = box.height / bubble.offsetHeight || 1;
    const style = getComputedStyle(hug);
    const fontSize = parseFloat(style.fontSize) || 16;
    const pitch = parseFloat(style.lineHeight) || fontSize * 1.75;
    const padX = fontSize * 0.7;
    const range = document.createRange();
    range.selectNodeContents(hug);
    const fragments = [...range.getClientRects()]
      .filter((rect) => rect.width > 0)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    const rows = [];
    for (const rect of fragments) {
      const row = rows[rows.length - 1];
      if (row && rect.top - row.top < pitch / 2) {
        row.left = Math.min(row.left, rect.left);
        row.right = Math.max(row.right, rect.right);
      } else {
        rows.push({ top: rect.top, height: rect.height, left: rect.left, right: rect.right });
      }
    }
    if (rows.length === 0) {
      return;
    }
    const top0 = (rows[0].top - box.top) / sy - (pitch - rows[0].height / sy) / 2;
    const lefts = rows.map((row) => (row.left - box.left) / sx - padX);
    const rights = rows.map((row) => (row.right - box.left) / sx + padX);
    // Near-equal neighbours share one edge so the outline doesn't wobble.
    const snap = fontSize * 0.45;
    for (let i = 1; i < rows.length; i += 1) {
      if (Math.abs(rights[i] - rights[i - 1]) < snap) {
        rights[i] = rights[i - 1] = Math.max(rights[i], rights[i - 1]);
      }
      if (Math.abs(lefts[i] - lefts[i - 1]) < snap) {
        lefts[i] = lefts[i - 1] = Math.min(lefts[i], lefts[i - 1]);
      }
    }
    const n = rows.length;
    const topOf = (i) => top0 + i * pitch;
    const points = [[lefts[0], topOf(0)], [rights[0], topOf(0)]];
    for (let i = 0; i < n - 1; i += 1) {
      points.push([rights[i], topOf(i + 1)], [rights[i + 1], topOf(i + 1)]);
    }
    points.push([rights[n - 1], topOf(n)], [lefts[n - 1], topOf(n)]);
    for (let i = n - 1; i > 0; i -= 1) {
      points.push([lefts[i], topOf(i)], [lefts[i - 1], topOf(i)]);
    }
    svg.setAttribute("width", String(bubble.offsetWidth));
    svg.setAttribute("height", String(bubble.offsetHeight));
    svg.firstElementChild.setAttribute("d", roundedPath(points, fontSize * 0.62));
  };

  const watchBubble = (bubble) => {
    drawBubble(bubble);
    if (typeof ResizeObserver === "function") {
      bubble.resizeObserver = new ResizeObserver(() => drawBubble(bubble));
      bubble.resizeObserver.observe(bubble);
    }
  };

  const renderCaptionText = (session, requested) => {
    const text = session.captionsOn ? requested : "";
    if (session.closing || text === session.capText) {
      return;
    }
    const previous = session.capText;
    session.capText = text;
    const { caps } = session.ui;
    const old = session.capBubble;

    const dismiss = (bubble) => {
      bubble.resizeObserver?.disconnect();
      animateBubble(bubble, [
        { opacity: 1, transform: "translateY(0) scale(1)" },
        { opacity: 0, transform: "translateY(-6px) scale(0.98)" }
      ], { duration: 160, easing: "ease-in" }).finished.then(() => bubble.remove(), () => bubble.remove());
    };

    if (!text) {
      if (old) {
        session.capBubble = null;
        dismiss(old);
      }
      return;
    }
    // Rolling / growing captions update in place so they don't flicker.
    if (old && previous && (text.includes(previous) || previous.includes(text))) {
      setBubbleText(old, text);
      drawBubble(old);
      return;
    }
    const bubble = document.createElement("div");
    bubble.className = "simpl-youtube-preview-cap";
    setBubbleText(bubble, text);
    caps.append(bubble);
    watchBubble(bubble);
    session.capBubble = bubble;
    animateBubble(bubble, [
      { opacity: 0, transform: "translateY(10px) scale(0.96)" },
      { opacity: 1, transform: "translateY(0) scale(1)" }
    ], { duration: 240, easing: "cubic-bezier(.2,.9,.25,1)" });
    if (old) {
      dismiss(old);
    }
  };

  const scheduleCaptionRead = (session) => {
    if (session.capFrame || session.closing) {
      return;
    }
    session.capFrame = requestAnimationFrame(() => {
      session.capFrame = 0;
      renderCaptionText(session, readCaptionText(session));
    });
  };

  const watchCaptions = (session) => {
    const signal = session.controller.signal;
    session.capObserver = new MutationObserver(() => scheduleCaptionRead(session));
    session.capObserver.observe(session.playerNode, {
      childList: true,
      subtree: true,
      characterData: true
    });
    for (const track of session.video.textTracks) {
      track.addEventListener("cuechange", () => scheduleCaptionRead(session), { signal });
    }
    session.video.textTracks.addEventListener?.("addtrack", (event) => {
      event.track.addEventListener("cuechange", () => scheduleCaptionRead(session), { signal });
    }, { signal });
  };

  const applyCaptionLook = (session) => {
    const { caps, capPos, capSize } = session.ui;
    const point = prefs.captionPoint;
    let pos = prefs.captionPos || "bottom-center";
    if (pos === "custom" && !(point && Number.isFinite(point.x) && Number.isFinite(point.y))) {
      pos = "bottom-center";
    }
    caps.dataset.pos = pos;
    if (pos === "custom") {
      caps.style.left = `${point.x * 100}%`;
      caps.style.top = `${point.y * 100}%`;
    } else {
      caps.style.removeProperty("left");
      caps.style.removeProperty("top");
    }
    session.root.dataset.capSize = prefs.captionSize || "m";
    capPos.querySelector("option[value='custom']").hidden = pos !== "custom";
    capPos.value = pos;
    capSize.value = prefs.captionSize || "m";
  };

  const enableCaptionDrag = (session) => {
    const { caps, media } = session.ui;
    caps.addEventListener("pointerdown", (event) => {
      const bubble = event.target.closest(".simpl-youtube-preview-cap");
      if (!bubble || event.button > 0) {
        return;
      }
      event.preventDefault();
      caps.setPointerCapture(event.pointerId);
      const rect = media.getBoundingClientRect();
      const move = (moveEvent) => {
        const x = Math.max(0.12, Math.min(0.88, (moveEvent.clientX - rect.left) / rect.width));
        const y = Math.max(0.1, Math.min(0.9, (moveEvent.clientY - rect.top) / rect.height));
        savePrefs({ captionPos: "custom", captionPoint: { x, y } });
        applyCaptionLook(session);
      };
      const up = () => {
        caps.removeEventListener("pointermove", move);
        caps.removeEventListener("pointerup", up);
        caps.removeEventListener("pointercancel", up);
        delete caps.dataset.dragging;
      };
      caps.dataset.dragging = "true";
      caps.addEventListener("pointermove", move);
      caps.addEventListener("pointerup", up);
      caps.addEventListener("pointercancel", up);
    }, { signal: session.controller.signal });
  };

  // Captions start off: YouTube's hover preview may switch them on by itself,
  // so turn them off until the user asks for them in this viewer.
  const applyCaptionsDefault = (session, status) => {
    if (session.carryCaptions && !session.captionsTouched) {
      // The previous video had subtitles on; turn them on here once a track exists.
      if (status?.captions?.available && status.captions.tracks?.length) {
        session.carryCaptions = false;
        setCaptions(session, true, null, true);
      }
      return;
    }
    if (session.captionsTouched || status?.captions?.enabled !== true) {
      return;
    }
    setCaptions(session, false, null, true);
  };

  const populateSpeed = (session) => {
    const { speed } = session.ui;
    speed.replaceChildren();
    for (const value of SPEEDS) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = value === 1 ? "Normal" : `${value}×`;
      speed.append(option);
    }
    speed.value = String(session.video.playbackRate);
  };

  const updateBuffered = (session) => {
    const { video, ui } = session;
    const duration = Number.isFinite(video?.duration) ? video.duration : 0;
    let end = 0;
    try {
      for (let index = 0; index < video.buffered.length; index += 1) {
        if (video.buffered.start(index) <= video.currentTime + 0.5) {
          end = Math.max(end, video.buffered.end(index));
        }
      }
    } catch {
      end = 0;
    }
    ui.buffered.style.width = duration > 0 ? `${Math.min(100, (end / duration) * 100)}%` : "0%";
    session.bufferedEnd = end;
  };

  const updateControls = (session) => {
    const { video, ui } = session;
    if (!video) {
      return;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const volume = video.muted ? 0 : video.volume;
    ui.play.dataset.playing = String(!video.paused && !video.ended);
    ui.play.setAttribute("aria-label", video.paused || video.ended ? "Play" : "Pause");
    ui.mute.dataset.muted = String(video.muted || video.volume === 0);
    ui.mute.setAttribute("aria-label", video.muted || video.volume === 0 ? "Unmute" : "Mute");
    ui.volume.value = String(volume);
    ui.volume.style.setProperty("--simpl-volume", `${volume * 100}%`);
    if (!session.scrubbing) {
      const progress = duration > 0 ? (video.currentTime / duration) * 100 : 0;
      ui.timeline.value = duration > 0
        ? String(Math.round((video.currentTime / duration) * 1000))
        : "0";
      ui.timeline.style.setProperty("--simpl-progress", `${progress}%`);
      ui.time.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
    }
    updateBuffered(session);
    updateChapterLabel(session);
    paintSegments(
      session,
      session.scrubbing && duration > 0 ? duration * (Number(ui.timeline.value) / 1000) : video.currentTime
    );
    if (SPEEDS.includes(video.playbackRate)) {
      ui.speed.value = String(video.playbackRate);
    }
    if (!session.switching && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      session.root.dataset.state = "ready";
      ui.status.textContent = "";
    }
    if ((video.paused || video.ended) && session.pointerSeen) {
      setControlsVisible(session, true);
    }
  };

  const getMovablePlayer = (video) => (
    video.closest(".html5-video-player") ||
    video.closest("ytd-player#inline-player") ||
    video
  );

  const bindVideo = (session, video) => {
    if (session.video || session.closing || !video?.isConnected) {
      return;
    }
    session.video = video;
    session.userPaused = false;
    session.observer.disconnect();
    clearInterval(session.pollTimer);
    clearTimeout(session.waitTimer);
    session.captionHost = video.closest("ytd-video-preview") || getPreviewPortal();
    session.captionHost?.setAttribute("data-simpl-preview-session", "true");
    session.playerNode = getMovablePlayer(video);

    session.originalPlayer = {
      parent: session.playerNode.parentNode,
      nextSibling: session.playerNode.nextSibling,
      style: session.playerNode.getAttribute("style")
    };
    session.originalVideo = {
      controls: video.controls,
      muted: video.muted,
      volume: video.volume,
      playbackRate: video.playbackRate,
      style: video.getAttribute("style")
    };
    const resumeTime = video.currentTime;
    video.controls = false;
    session.playerNode.setAttribute("data-simpl-preview-player", "true");
    session.ui.media.insertBefore(session.playerNode, session.ui.topbar);
    if (Number.isFinite(prefs.volume) && prefs.volume > 0) {
      video.volume = Math.min(1, prefs.volume);
    } else if (video.volume === 0) {
      video.volume = 1;
    }
    video.muted = false;
    if (session.carry) {
      const carry = session.carry;
      if (Number.isFinite(carry.volume) && carry.volume > 0) {
        video.volume = Math.min(1, carry.volume);
      }
      video.muted = Boolean(carry.userMuteIntent);
    }
    if (session.carry && SPEEDS.includes(session.carry.speed)) {
      video.playbackRate = session.carry.speed;
    } else if (Number.isFinite(prefs.speed) && SPEEDS.includes(prefs.speed)) {
      video.playbackRate = prefs.speed;
    }
    if (
      Number.isFinite(resumeTime) &&
      Math.abs(video.currentTime - resumeTime) > 0.5
    ) {
      video.currentTime = resumeTime;
    }
    session.root.dataset.state = "ready";
    session.root.dataset.interactive = "true";
    session.ui.status.textContent = "";

    for (const control of [
      session.ui.play,
      session.ui.back,
      session.ui.ahead,
      session.ui.timeline,
      session.ui.mute,
      session.ui.volume,
      session.ui.settingsButton,
      session.ui.cc,
      session.ui.fullscreen
    ]) {
      control.disabled = false;
    }
    session.ui.pip.disabled = !document.pictureInPictureEnabled ||
      typeof video.requestPictureInPicture !== "function";

    for (const type of [
      "loadedmetadata",
      "durationchange",
      "timeupdate",
      "progress",
      "play",
      "pause",
      "volumechange",
      "ended",
      "ratechange"
    ]) {
      video.addEventListener(type, () => updateControls(session), {
        signal: session.controller.signal
      });
    }
    // Playback starting (a click or key press while the pointer stays still)
    // restarts the idle timer, so the controls fade without any mouse move.
    for (const type of ["play", "playing"]) {
      video.addEventListener(type, () => {
        if (session.root.dataset.controls === "visible") {
          setControlsVisible(session, true);
        }
      }, { signal: session.controller.signal });
    }
    video.addEventListener("resize", () => {
      updateControls(session);
      renderResolution(session);
    }, { signal: session.controller.signal });
    video.addEventListener("pause", () => {
      if (
        !session.userPaused &&
        !video.ended &&
        activeSession === session &&
        !session.closing &&
        session.resumeAttempts < 4
      ) {
        session.resumeAttempts += 1;
        setTimeout(() => {
          if (!session.userPaused && activeSession === session && !session.closing) {
            video.play().catch(() => {});
          }
        }, 0);
      }
    }, { signal: session.controller.signal });

    // YouTube's preview player likes to start (and re-mute itself) muted while
    // the video loads. For the first seconds, undo that unless the user asked
    // for silence; element-level only, so playback is never restarted.
    session.unmuteUntil = Date.now() + 8000;
    video.addEventListener("volumechange", () => {
      if (
        video.muted &&
        !session.userMuteIntent &&
        Date.now() < session.unmuteUntil &&
        session.unmuteAttempts < 40 &&
        activeSession === session &&
        !session.closing
      ) {
        session.unmuteAttempts += 1;
        setTimeout(() => {
          if (!session.userMuteIntent && activeSession === session && !session.closing) {
            video.muted = false;
          }
        }, 0);
      }
    }, { signal: session.controller.signal });
    video.addEventListener("playing", () => {
      if (video.muted && !session.userMuteIntent && Date.now() < session.unmuteUntil) {
        video.muted = false;
      }
    }, { signal: session.controller.signal });

    populateSpeed(session);
    watchCaptions(session);
    // Fetch recommendations (and their thumbnails) in the background so the
    // row is ready the moment it is opened.
    setTimeout(() => {
      if (activeSession === session && !session.closing) {
        loadRecommended(session);
        loadDescription(session);
      }
    }, 700);
    video.play().then(() => {
      if (!session.userMuteIntent) {
        video.muted = false;
      }
    }).catch(() => {});
    updateControls(session);
    session.ui.close.focus({ preventScroll: true });

    // The player sizes its rendition to its element: let it notice the larger
    // viewer so "Auto" quality can step up.
    window.dispatchEvent(new Event("resize"));

    const status = refreshPlayerStatus(session);
    applyCaptionsDefault(session, status);
    applySavedQuality(session, status);
    applyAudio(session);
    // Captions/quality data often arrives a moment after playback starts.
    let ticks = 0;
    session.statusTimer = setInterval(() => {
      if (activeSession !== session || session.closing) {
        return;
      }
      ticks += 1;
      const latest = refreshPlayerStatus(session);
      applyCaptionsDefault(session, latest);
      applySavedQuality(session, latest);
      if (ticks <= 3) {
        applyAudio(session);
      }
    }, 2000);
    scheduleStatusRefresh(session, [300, 900]);
  };

  const restorePlayer = (session) => {
    session.captionHost?.removeAttribute("data-simpl-preview-session");
    const video = session.video;
    const playerNode = session.playerNode;
    const savedVideo = session.originalVideo;
    const savedPlayer = session.originalPlayer;
    playerNode?.removeAttribute("data-simpl-preview-player");
    if (!video || !playerNode || !savedVideo || !savedPlayer) {
      return;
    }
    try {
      video.pause();
      video.controls = savedVideo.controls;
      video.muted = savedVideo.muted;
      video.volume = savedVideo.volume;
      video.playbackRate = savedVideo.playbackRate;
      if (savedVideo.style === null) {
        video.removeAttribute("style");
      } else {
        video.setAttribute("style", savedVideo.style);
      }
      if (savedPlayer.style === null) {
        playerNode.removeAttribute("style");
      } else {
        playerNode.setAttribute("style", savedPlayer.style);
      }

      const replacementSelector = playerNode.id
        ? `:scope > #${CSS.escape(playerNode.id)}`
        : `:scope > ${playerNode.localName}`;
      const sameTypeReplacement = Boolean(
        savedPlayer.parent?.querySelector?.(replacementSelector)
      );
      if (savedPlayer.parent?.isConnected && !sameTypeReplacement) {
        const reference = savedPlayer.nextSibling?.parentNode === savedPlayer.parent
          ? savedPlayer.nextSibling
          : null;
        savedPlayer.parent.insertBefore(playerNode, reference);
      } else {
        playerNode.remove();
      }
    } catch {
      playerNode.remove();
    }
  };

  const closePreview = async (session = activeSession, navigateTo = "", { instant = false } = {}) => {
    if (!session || session.closing) {
      if (navigateTo) {
        location.assign(navigateTo);
      }
      return;
    }
    session.closing = true;
    session.root.dataset.state = "closing";
    session.controller.abort();
    session.observer.disconnect();
    clearInterval(session.pollTimer);
    clearInterval(session.statusTimer);
    clearTimeout(session.waitTimer);
    clearTimeout(session.controlsTimer);
    clearTimeout(session.toastTimer);
    clearInterval(session.switchTimer);
    session.capObserver?.disconnect();
    cancelAnimationFrame(session.capFrame);
    if (document.pictureInPictureElement === session.video) {
      document.exitPictureInPicture?.().catch(() => {});
    }
    if (document.fullscreenElement && !instant) {
      await document.exitFullscreen().catch(() => {});
    }

    let destinationRect = session.originRect;
    if (session.originElement?.isConnected) {
      const current = session.originElement.getBoundingClientRect();
      if (current.width && current.height) {
        destinationRect = current;
      }
    }
    if (!instant) {
      await animateDialogOut(session.ui.dialog, destinationRect);
    }
    restorePlayer(session);
    session.root.remove();
    document.documentElement.classList.remove("simpl-youtube-preview-open");
    if (activeSession === session) {
      activeSession = null;
    }
    if (instant) {
      return;
    }
    if (session.ghost) {
      playerCommand("ghostClear");
    }
    if (!navigateTo) {
      session.returnFocus?.focus?.({ preventScroll: true });
    } else {
      location.assign(navigateTo);
    }
  };

  const showUnavailable = (session) => {
    if (session.video || session.closing) {
      return;
    }
    session.observer.disconnect();
    clearInterval(session.pollTimer);
    session.root.dataset.state = "unavailable";
    session.root.dataset.interactive = "true";
    session.ui.status.textContent = "YouTube did not provide an inline preview for this video.";
    session.ui.fallbackOpen.hidden = false;
    session.ui.close.focus({ preventScroll: true });
  };

  const closeMenus = (session) => {
    session.ui.settingsMenu.hidden = true;
    session.ui.settingsButton.setAttribute("aria-expanded", "false");
    session.ui.qualityMenu.hidden = true;
    session.ui.qualityButton.setAttribute("aria-expanded", "false");
    session.ui.shareMenu.hidden = true;
    session.ui.shareButton.setAttribute("aria-expanded", "false");
    session.ui.saveMenu.hidden = true;
    session.ui.saveButton.setAttribute("aria-expanded", "false");
    setControlsVisible(session, true);
  };

  // ---- Recommended videos ------------------------------------------------
  // YouTube only renders the "up next" column on a real watch page, so the
  // viewer fetches that page (same origin, with the user's own cookies) and
  // reads the related videos out of its embedded ytInitialData.

  const extractJsonVariable = (html, name, pattern = null) => {
    const match = (pattern || new RegExp(`${name}["']?\\]?\\s*=\\s*\\{`)).exec(html);
    const start = match ? match.index + match[0].length - 1 : -1;
    if (start < 0) {
      return null;
    }
    let depth = 0;
    let inString = false;
    for (let index = start; index < html.length; index += 1) {
      const char = html[index];
      if (inString) {
        if (char === "\\") {
          index += 1;
        } else if (char === '"') {
          inString = false;
        }
      } else if (char === '"') {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, index + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  };

  // One fetch of the real watch page serves both the recommendations and the
  // seek-bar storyboards. Same origin, so it uses the user's own cookies.
  const getWatchPage = (session) => {
    if (!session.watchPage) {
      const id = videoIdFromUrl(session.url);
      session.watchPage = fetch(`/watch?v=${encodeURIComponent(id)}`, {
        credentials: "same-origin",
        signal: session.controller.signal
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("bad response");
        }
        const html = await response.text();
        return {
          data: extractJsonVariable(html, "ytInitialData"),
          player: extractJsonVariable(html, "ytInitialPlayerResponse"),
          apiKey: /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/.exec(html)?.[1] || "",
          context: extractJsonVariable(html, "", /"INNERTUBE_CONTEXT"\s*:\s*\{/)
        };
      });
      session.watchPage.catch(() => {
        session.watchPage = null;
      });
    }
    return session.watchPage;
  };

  const textOf = (value) => (
    value?.simpleText ||
    value?.content ||
    (Array.isArray(value?.runs) ? value.runs.map((run) => run.text || "").join("") : "") ||
    ""
  );

  const bestThumb = (sources) => {
    const list = Array.isArray(sources) ? sources : [];
    const sorted = [...list].sort((a, b) => (a.width || 0) - (b.width || 0));
    return (sorted.find((item) => (item.width || 0) >= 300) || sorted[sorted.length - 1])?.url || "";
  };

  const videoFromRenderer = (node) => {
    const renderer = node.compactVideoRenderer;
    if (renderer?.videoId) {
      return {
        renderer,
        id: renderer.videoId,
        title: textOf(renderer.title),
        channel: textOf(renderer.longBylineText || renderer.shortBylineText),
        duration: textOf(renderer.lengthText),
        thumb: bestThumb(renderer.thumbnail?.thumbnails)
      };
    }
    const lockup = node.lockupViewModel;
    const type = String(lockup?.contentType || "");
    if (lockup?.contentId && /VIDEO/.test(type) && !/PLAYLIST|MIX/.test(type)) {
      const image = lockup.contentImage?.thumbnailViewModel;
      let duration = "";
      for (const overlay of image?.overlays || []) {
        const badges = overlay.thumbnailBottomOverlayViewModel?.badges || [];
        for (const badge of badges) {
          duration = duration || badge.thumbnailBadgeViewModel?.text || "";
        }
      }
      const rows = lockup.metadata?.lockupMetadataViewModel?.metadata
        ?.contentMetadataViewModel?.metadataRows || [];
      return {
        id: lockup.contentId,
        title: textOf(lockup.metadata?.lockupMetadataViewModel?.title),
        channel: textOf(rows[0]?.metadataParts?.[0]?.text),
        duration,
        thumb: bestThumb(image?.image?.sources)
      };
    }
    return null;
  };

  const collectRecommended = (root, currentId) => {
    const found = [];
    const seen = new Set([currentId]);
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 14 || found.length >= 30) {
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      const video = videoFromRenderer(node);
      if (video && video.title && !seen.has(video.id)) {
        seen.add(video.id);
        found.push(video);
        return;
      }
      Object.values(node).forEach((item) => walk(item, depth + 1));
    };
    const secondary = root?.contents?.twoColumnWatchNextResults?.secondaryResults ||
      root?.contents?.twoColumnWatchNextResults;
    walk(secondary, 0);
    return found;
  };

  const renderRecommended = (session, videos) => {
    const { recsTrack } = session.ui;
    recsTrack.replaceChildren();
    for (const video of videos) {
      const card = document.createElement("a");
      card.className = "simpl-youtube-preview-rec";
      card.href = `/watch?v=${encodeURIComponent(video.id)}`;
      card.dataset.videoId = video.id;
      card.dataset.title = video.title;
      card.dataset.channel = video.channel || "";
      card.dataset.thumb = video.thumb || "";
      card.title = video.title;
      const thumb = document.createElement("span");
      thumb.className = "simpl-youtube-preview-rec-thumb";
      if (video.thumb) {
        const image = document.createElement("img");
        image.src = video.thumb;
        image.alt = "";
        image.loading = "eager";
        image.draggable = false;
        thumb.append(image);
      }
      if (video.duration) {
        const time = document.createElement("span");
        time.className = "simpl-youtube-preview-rec-time";
        time.textContent = video.duration;
        thumb.append(time);
      }
      const title = document.createElement("span");
      title.className = "simpl-youtube-preview-rec-title";
      title.textContent = video.title;
      const channel = document.createElement("span");
      channel.className = "simpl-youtube-preview-rec-channel";
      channel.textContent = video.channel;
      card.append(thumb, title, channel);
      recsTrack.append(card);
    }
  };

  const showRecommendedMessage = (session, text, retry = false) => {
    const { recsTrack } = session.ui;
    recsTrack.replaceChildren();
    const message = document.createElement("div");
    message.className = "simpl-youtube-preview-recs-message";
    message.textContent = text;
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.retry = "true";
      button.textContent = "Try again";
      message.append(button);
    }
    recsTrack.append(message);
  };

  // Hidden stand-ins for the first few recommendations. A real thumbnail
  // element lets YouTube start its own hover preview (which never has ads);
  // building them right after the list is parsed keeps a click quick.
  const GHOST_LIMIT = 8;

  const ghostCardFor = (id) => (
    document.querySelector(`[data-simpl-ghost="${CSS.escape(id)}"]`)
  );

  const prepareGhosts = (videos) => {
    let count = 0;
    for (const video of videos) {
      if (count >= GHOST_LIMIT) {
        break;
      }
      if (!video.renderer || ghostCardFor(video.id)) {
        continue;
      }
      count += 1;
      try {
        playerCommand("ghost", { videoId: video.id, renderer: video.renderer });
      } catch {
        // A renderer that cannot be sent just means no hidden preview.
      }
    }
  };

  const loadRecommended = async (session) => {
    if (session.recsLoaded || session.recsLoading) {
      return;
    }
    session.recsLoading = true;
    showRecommendedMessage(session, "Loading recommendations…");
    try {
      const id = videoIdFromUrl(session.url);
      const { data } = await getWatchPage(session);
      const videos = collectRecommended(data, id);
      if (session.closing) {
        return;
      }
      if (videos.length === 0) {
        showRecommendedMessage(session, "No recommendations were found for this video.", true);
      } else {
        renderRecommended(session, videos);
        session.recsLoaded = true;
        prepareGhosts(videos);
      }
    } catch {
      if (!session.closing) {
        showRecommendedMessage(session, "Couldn't load recommendations.", true);
      }
    } finally {
      session.recsLoading = false;
    }
  };

  // ---- Description panel -------------------------------------------------

  const TOKEN = /(https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?])|((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)(?![\d:])/g;

  const parseTimestamp = (text) => (
    text.split(":").reduce((total, part) => total * 60 + Number(part), 0)
  );

  // Plain text in, DOM nodes out: URLs become links, timestamps seek the video.
  const linkifyInto = (container, text) => {
    let last = 0;
    for (const match of text.matchAll(TOKEN)) {
      if (match.index > last) {
        container.append(text.slice(last, match.index));
      }
      if (match[1]) {
        let url = null;
        try {
          url = new URL(match[1]);
        } catch {
          url = null;
        }
        if (url && /^https?:$/.test(url.protocol)) {
          const link = document.createElement("a");
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = match[1];
          container.append(link);
        } else {
          container.append(match[1]);
        }
      } else {
        const stamp = document.createElement("button");
        stamp.type = "button";
        stamp.className = "simpl-youtube-preview-stamp";
        stamp.dataset.seconds = String(parseTimestamp(match[2]));
        stamp.textContent = match[2];
        container.append(stamp);
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) {
      container.append(text.slice(last));
    }
  };

  const findKey = (node, key, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 12) {
      return null;
    }
    if (node[key]) {
      return node[key];
    }
    for (const value of Object.values(node)) {
      const found = findKey(value, key, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  };

  const buildDescriptionInfo = ({ data, player }, session) => {
    const details = player?.videoDetails || {};
    const primary = findKey(data?.contents?.twoColumnWatchNextResults?.results, "videoPrimaryInfoRenderer");
    const secondary = findKey(data?.contents?.twoColumnWatchNextResults?.results, "videoSecondaryInfoRenderer");
    const views = textOf(primary?.viewCount?.videoViewCountRenderer?.viewCount) ||
      (details.viewCount
        ? `${new Intl.NumberFormat().format(Number(details.viewCount))} views`
        : "");
    const date = textOf(primary?.dateText) ||
      player?.microformat?.playerMicroformatRenderer?.publishDate || "";
    const description = details.shortDescription ||
      secondary?.attributedDescription?.content ||
      textOf(secondary?.description) || "";
    return {
      title: details.title || session.ui.descTitle.textContent,
      channel: details.author || "",
      meta: [details.author, views, date].filter(Boolean).join(" · "),
      description: String(description).replace(/\r\n?/g, "\n").trim()
    };
  };

  const renderDescription = (session, info) => {
    const { descTitle, descMeta, descBody } = session.ui;
    session.descHeading = { title: info.title || "", meta: info.meta || "" };
    if (session.panelMode !== "comments") {
      descTitle.textContent = session.descHeading.title;
      descMeta.textContent = session.descHeading.meta;
    }
    descBody.replaceChildren();
    if (session.chapters?.length) {
      const list = document.createElement("div");
      list.className = "simpl-youtube-preview-chapter-list";
      session.chapters.forEach((chapter, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "simpl-youtube-preview-stamp simpl-youtube-preview-chapter-row";
        row.dataset.seconds = String(chapter.start);
        row.dataset.index = String(index);
        const time = document.createElement("span");
        time.textContent = formatTime(chapter.start);
        const title = document.createElement("span");
        title.textContent = chapter.title;
        row.append(time, title);
        list.append(row);
      });
      descBody.append(list);
    }
    if (!info.description) {
      descBody.append("This video has no description.");
      return;
    }
    const text = document.createElement("div");
    linkifyInto(text, info.description);
    descBody.append(text);
  };

  // ---- Chapters ----------------------------------------------------------
  // YouTube's own chapter list when the page has one, otherwise timestamps in
  // the description (first at 0:00, at least three, ascending).

  const STAMP = "(?:\\d{1,2}:)?[0-5]?\\d:[0-5]\\d";
  const CHAPTER_START = new RegExp(`^[\\s\\-–—•·*▪►▶>]*[\\[(]?(${STAMP})[\\])]?\\s*[-–—:|.)]*\\s*(\\S.*)$`);
  const CHAPTER_END = new RegExp(`^(\\S.*?)\\s*[-–—:|]?\\s*[\\[(]?(${STAMP})[\\])]?$`);

  const parseChapters = (text) => {
    const found = [];
    for (const raw of String(text || "").split("\n")) {
      const line = raw.trim();
      let start = -1;
      let title = "";
      const lead = CHAPTER_START.exec(line);
      if (lead) {
        start = parseTimestamp(lead[1]);
        title = lead[2];
      } else {
        const tail = CHAPTER_END.exec(line);
        if (tail) {
          start = parseTimestamp(tail[2]);
          title = tail[1];
        }
      }
      title = title.replace(/^[-–—:|.)\s]+|\s+$/g, "");
      if (start >= 0 && title) {
        found.push({ start, title: title.slice(0, 120) });
      }
    }
    if (found.length < 3 || found[0].start !== 0) {
      return [];
    }
    for (let i = 1; i < found.length; i += 1) {
      if (found[i].start <= found[i - 1].start) {
        return [];
      }
    }
    return found.slice(0, 100);
  };

  const chaptersFromData = (data) => {
    let list = null;
    const walk = (node, depth) => {
      if (list || !node || typeof node !== "object" || depth > 16) {
        return;
      }
      if (Array.isArray(node.chapters) && node.chapters[0]?.chapterRenderer) {
        list = node.chapters;
        return;
      }
      for (const value of Object.values(node)) {
        walk(value, depth + 1);
      }
    };
    walk(data, 0);
    return (list || [])
      .map((item) => item.chapterRenderer)
      .filter(Boolean)
      .map((item) => ({
        start: Math.round((item.timeRangeStartMillis || 0) / 1000),
        title: textOf(item.title)
      }))
      .filter((item) => item.title);
  };

  const buildChapters = (page, description) => {
    const own = chaptersFromData(page?.data);
    return own.length >= 2 ? own : parseChapters(description);
  };

  const chapterAt = (session, seconds) => {
    let current = -1;
    (session.chapters || []).forEach((chapter, index) => {
      if (chapter.start <= seconds + 0.25) {
        current = index;
      }
    });
    return current;
  };

  const renderChapters = (session) => {
    const { video, ui } = session;
    const chapters = session.chapters || [];
    const duration = video && Number.isFinite(video.duration) ? video.duration : 0;
    ui.chapterMarks.replaceChildren();
    session.segments = [];
    session.chapterIndex = -2;
    session.chaptersDrawn = duration;
    ui.timeline.parentElement.removeAttribute("data-segmented");
    if (!chapters.length || !duration) {
      ui.chapterName.textContent = "";
      return;
    }
    // The bar is split into one segment per chapter, with a small gap between.
    const starts = chapters.map((chapter) => chapter.start).filter((start) => start < duration);
    starts.forEach((start, index) => {
      const end = index + 1 < starts.length ? starts[index + 1] : duration;
      const segment = document.createElement("span");
      segment.className = "simpl-youtube-preview-seg";
      segment.style.left = `${(start / duration) * 100}%`;
      segment.style.width = `${((end - start) / duration) * 100}%`;
      const bar = document.createElement("span");
      bar.className = "simpl-youtube-preview-seg-bar";
      const buffered = document.createElement("i");
      const played = document.createElement("i");
      bar.append(buffered, played);
      segment.append(bar);
      ui.chapterMarks.append(segment);
      session.segments.push({ segment, buffered, played, start, end });
    });
    ui.timeline.parentElement.setAttribute("data-segmented", "true");
    paintSegments(session, video.currentTime);
  };

  const paintSegments = (session, seconds) => {
    const segments = session.segments;
    if (!segments?.length) {
      return;
    }
    const bufferedEnd = session.bufferedEnd || 0;
    for (const item of segments) {
      const span = item.end - item.start || 1;
      const fraction = (value) => Math.max(0, Math.min(1, (value - item.start) / span));
      item.played.style.width = `${fraction(seconds) * 100}%`;
      item.buffered.style.width = `${fraction(bufferedEnd) * 100}%`;
    }
  };

  const updateChapterLabel = (session) => {
    const { video, ui } = session;
    const chapters = session.chapters || [];
    if (!video || !chapters.length) {
      return;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration && session.chaptersDrawn !== duration) {
      renderChapters(session);
    }
    const index = chapterAt(session, video.currentTime);
    if (index === session.chapterIndex) {
      return;
    }
    session.chapterIndex = index;
    ui.chapterName.textContent = index >= 0 ? chapters[index].title : "";
    ui.descBody.querySelectorAll(".simpl-youtube-preview-chapter-row").forEach((row) => {
      row.toggleAttribute("data-current", Number(row.dataset.index) === index);
    });
  };

  // ---- Comments ----------------------------------------------------------

  const commentsContinuation = (data) => {
    const sections = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
    for (const section of sections) {
      const renderer = section.itemSectionRenderer;
      if (!renderer) {
        continue;
      }
      const item = (renderer.contents || []).find((entry) => entry.continuationItemRenderer);
      const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (token && (renderer.sectionIdentifier === "comment-item-section" || /comment/i.test(renderer.targetId || ""))) {
        return token;
      }
    }
    return "";
  };

  const parseComments = (json) => {
    const entities = new Map();
    for (const mutation of json?.frameworkUpdates?.entityBatchUpdate?.mutations || []) {
      const payload = mutation.payload?.commentEntityPayload;
      if (payload?.key) {
        entities.set(payload.key, payload);
      }
    }
    const comments = [];
    let next = "";
    let total = "";
    for (const command of json?.onResponseReceivedEndpoints || []) {
      const list = command.reloadContinuationItemsCommand?.continuationItems ||
        command.appendContinuationItemsAction?.continuationItems || [];
      for (const item of list) {
        const thread = item.commentThreadRenderer;
        if (thread) {
          const key = thread.commentViewModel?.commentViewModel?.commentKey;
          const entity = key ? entities.get(key) : null;
          const legacy = thread.comment?.commentRenderer;
          if (entity) {
            comments.push({
              author: entity.author?.displayName || "",
              text: entity.properties?.content?.content || "",
              time: entity.properties?.publishedTime || "",
              likes: entity.toolbar?.likeCountNotliked || entity.toolbar?.likeCountLiked || ""
            });
          } else if (legacy) {
            comments.push({
              author: textOf(legacy.authorText),
              text: textOf(legacy.contentText),
              time: textOf(legacy.publishedTimeText),
              likes: textOf(legacy.voteCount)
            });
          }
        } else if (item.continuationItemRenderer) {
          next = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token || next;
        } else if (item.commentsHeaderRenderer) {
          total = textOf(item.commentsHeaderRenderer.countText);
        }
      }
    }
    return { comments: comments.filter((item) => item.text), next, total };
  };

  const appendComments = (session, comments) => {
    const { commentsBody } = session.ui;
    for (const comment of comments) {
      const box = document.createElement("div");
      box.className = "simpl-youtube-preview-comment";
      const head = document.createElement("div");
      head.className = "simpl-youtube-preview-comment-head";
      const author = document.createElement("strong");
      author.textContent = comment.author;
      head.append(author);
      for (const extra of [comment.time, comment.likes ? `♥ ${comment.likes}` : ""]) {
        if (extra) {
          const span = document.createElement("span");
          span.textContent = extra;
          head.append(span);
        }
      }
      const body = document.createElement("div");
      body.className = "simpl-youtube-preview-comment-text";
      linkifyInto(body, comment.text.replace(/\r\n?/g, "\n"));
      box.append(head, body);
      commentsBody.append(box);
    }
  };

  const showCommentsMessage = (session, text, retry = false) => {
    const { commentsBody } = session.ui;
    commentsBody.querySelector(".simpl-youtube-preview-comments-note")?.remove();
    const note = document.createElement("div");
    note.className = "simpl-youtube-preview-comments-note";
    note.append(text);
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "simpl-youtube-preview-stamp";
      button.dataset.commentsRetry = "true";
      button.textContent = retry === "more" ? "Show more comments" : "Try again";
      note.append(" ", button);
    }
    commentsBody.append(note);
  };

  const loadComments = async (session, more = false) => {
    if (session.commentsLoading || (session.commentsLoaded && !more)) {
      return;
    }
    session.commentsLoading = true;
    const { commentsBody } = session.ui;
    if (!more) {
      commentsBody.replaceChildren();
    }
    showCommentsMessage(session, "Loading comments…");
    try {
      const page = await getWatchPage(session);
      const token = more ? session.commentsNext : commentsContinuation(page.data);
      if (!token) {
        throw new Error(page.data ? "off" : "nodata");
      }
      if (!page.apiKey || !page.context) {
        throw new Error("nocfg");
      }
      const response = await fetch(`/youtubei/v1/next?key=${encodeURIComponent(page.apiKey)}&prettyPrint=false`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: page.context, continuation: token }),
        signal: session.controller.signal
      });
      if (!response.ok) {
        throw new Error("bad response");
      }
      const result = parseComments(await response.json());
      if (session.closing) {
        return;
      }
      commentsBody.querySelector(".simpl-youtube-preview-comments-note")?.remove();
      if (!more && result.total) {
        session.commentsTotal = result.total;
        if (session.panelMode === "comments") {
          session.ui.descMeta.textContent = `${result.total} comments`;
        }
      }
      appendComments(session, result.comments);
      session.commentsLoaded = true;
      session.commentsNext = result.next;
      if (result.comments.length === 0 && !more) {
        showCommentsMessage(session, "No comments to show.");
      } else if (result.next) {
        showCommentsMessage(session, "", "more");
      }
    } catch (error) {
      if (!session.closing) {
        commentsBody.querySelector(".simpl-youtube-preview-comments-note")?.remove();
        showCommentsMessage(
          session,
          error?.message === "off" ? "Comments are turned off or unavailable for this video." : "Couldn't load comments.",
          error?.message === "off" ? false : true
        );
      }
    } finally {
      session.commentsLoading = false;
    }
  };

  const loadDescription = async (session) => {
    if (session.descLoaded || session.descLoading) {
      return;
    }
    session.descLoading = true;
    session.ui.descBody.textContent = "Loading description…";
    try {
      const page = await getWatchPage(session);
      if (session.closing) {
        return;
      }
      applyChannel(session, channelFromPage(page, session));
      const info = buildDescriptionInfo(page, session);
      session.chapters = buildChapters(page, info.description);
      renderDescription(session, info);
      renderChapters(session);
      session.descLoaded = true;
    } catch {
      if (!session.closing) {
        const { descBody } = session.ui;
        descBody.replaceChildren("Couldn't load the description. ");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "simpl-youtube-preview-stamp";
        retry.dataset.retry = "true";
        retry.textContent = "Try again";
        descBody.append(retry);
      }
    } finally {
      session.descLoading = false;
    }
  };

  const applyDescriptionMode = (session) => {
    const solid = prefs.descSolid === true;
    const { desc, descGlass, descSolid } = session.ui;
    desc.dataset.solid = String(solid);
    descGlass.setAttribute("aria-pressed", String(!solid));
    descSolid.setAttribute("aria-pressed", String(solid));
  };

  // One popup serves both the description and the comments; the two icons
  // choose which one it shows.
  const toggleDescription = (session, force, mode = "desc") => {
    const same = session.descOpen && session.panelMode === mode;
    const open = typeof force === "boolean" ? force : !same;
    if (!open) {
      if (!session.descOpen) {
        return;
      }
      session.descOpen = false;
    } else {
      session.descOpen = true;
      session.panelMode = mode;
    }
    const comments = session.panelMode === "comments";
    const { ui } = session;
    session.root.dataset.desc = session.descOpen ? "open" : "closed";
    ui.desc.setAttribute("aria-hidden", String(!session.descOpen));
    ui.descToggle.setAttribute("aria-expanded", String(session.descOpen && !comments));
    ui.commentsToggle.setAttribute("aria-expanded", String(session.descOpen && comments));
    if (open) {
      ui.descBody.hidden = comments;
      ui.commentsBody.hidden = !comments;
      if (comments) {
        ui.descTitle.textContent = "Comments";
        ui.descMeta.textContent = session.commentsTotal ? `${session.commentsTotal} comments` : "";
      } else {
        ui.descTitle.textContent = session.descHeading?.title || session.currentInfo?.title || "";
        ui.descMeta.textContent = session.descHeading?.meta || "";
      }
      closeMenus(session);
      toggleRecommended(session, false);
      if (comments) {
        loadComments(session);
      } else {
        loadDescription(session);
      }
    }
    setControlsVisible(session, true);
  };

  // ---- Channel link ------------------------------------------------------

  const channelFromPage = (page, session) => {
    const owner = findKey(page?.data?.contents?.twoColumnWatchNextResults?.results, "videoOwnerRenderer");
    const nav = owner?.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint ||
      owner?.navigationEndpoint?.browseEndpoint;
    let path = nav?.canonicalBaseUrl || (nav?.browseId ? `/channel/${nav.browseId}` : "");
    const channelId = page?.player?.videoDetails?.channelId;
    if (!path && channelId) {
      path = `/channel/${channelId}`;
    }
    const thumbs = owner?.thumbnail?.thumbnails || [];
    let url = "";
    try {
      url = path ? new URL(path, location.origin).href : "";
    } catch {
      url = "";
    }
    return {
      name: textOf(owner?.title) || page?.player?.videoDetails?.author || session.currentInfo?.channel || "",
      url,
      avatar: thumbs.length ? thumbs[thumbs.length - 1].url : ""
    };
  };

  const applyChannel = (session, channel) => {
    const { channelAvatar, channelLabel } = session.ui;
    session.channelUrl = channel?.url || "";
    if (channel?.name) {
      channelLabel.textContent = channel.name;
    }
    channelLabel.toggleAttribute("data-link", Boolean(session.channelUrl));
    const image = channelAvatar.querySelector("img");
    if (session.channelUrl && channel.avatar) {
      image.src = channel.avatar;
      channelAvatar.href = session.channelUrl;
      channelAvatar.hidden = false;
    } else {
      channelAvatar.hidden = true;
    }
  };

  // ---- Share and save ----------------------------------------------------

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const box = document.createElement("textarea");
      box.value = text;
      box.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.documentElement.append(box);
      box.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      box.remove();
      return ok;
    }
  };

  const shareLink = (session, timed) => {
    const id = videoIdFromUrl(session.url);
    const link = new URL("https://www.youtube.com/watch");
    link.searchParams.set("v", id);
    if (timed && session.video) {
      link.searchParams.set("t", `${Math.floor(session.video.currentTime)}s`);
    }
    return link.href;
  };

  const renderShareMenu = (session) => {
    const { shareMenu } = session.ui;
    shareMenu.replaceChildren();
    const entries = [
      ["copy", "Copy link"],
      ["copy-time", `Copy link at ${formatTime(session.video?.currentTime || 0)}`]
    ];
    if (typeof navigator.share === "function") {
      entries.push(["system", "Share…"]);
    }
    for (const [action, label] of entries) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.dataset.action = action;
      button.textContent = label;
      shareMenu.append(button);
    }
  };

  const toggleShareMenu = (session) => {
    const open = session.ui.shareMenu.hidden;
    closeMenus(session);
    if (open) {
      renderShareMenu(session);
    }
    session.ui.shareMenu.hidden = !open;
    session.ui.shareButton.setAttribute("aria-expanded", String(open));
    setControlsVisible(session, true);
  };

  const runShareAction = async (session, action) => {
    closeMenus(session);
    const url = shareLink(session, action === "copy-time");
    if (action === "system") {
      try {
        await navigator.share({ title: session.currentInfo?.title || "", url });
      } catch {
        // Cancelled by the user.
      }
      return;
    }
    showToast(session, (await copyText(url)) ? "Link copied" : "Couldn't copy the link");
  };

  // YouTube's own endpoints need the signed-in user's SAPISID hash.
  const cookieValue = (name) => {
    for (const part of document.cookie.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === name) {
        return rest.join("=");
      }
    }
    return "";
  };

  const sha1Hex = async (text) => {
    const bytes = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };

  const authHeader = async () => {
    const stamp = Math.floor(Date.now() / 1000);
    const parts = [];
    for (const [cookie, scheme] of [
      ["SAPISID", "SAPISIDHASH"],
      ["__Secure-1PAPISID", "SAPISID1PHASH"],
      ["__Secure-3PAPISID", "SAPISID3PHASH"]
    ]) {
      const value = cookieValue(cookie);
      if (value) {
        parts.push(`${scheme} ${stamp}_${await sha1Hex(`${stamp} ${value} ${location.origin}`)}`);
      }
    }
    return parts.join(" ");
  };

  const signedIn = () => Boolean(cookieValue("SAPISID") || cookieValue("__Secure-3PAPISID"));

  const innertube = async (session, path, body) => {
    const page = await getWatchPage(session);
    if (!page.apiKey || !page.context) {
      throw new Error("nocfg");
    }
    const headers = {
      "content-type": "application/json",
      "x-origin": location.origin,
      "x-goog-authuser": "0",
      "x-youtube-client-name": "1",
      "x-youtube-client-version": page.context.client?.clientVersion || ""
    };
    const auth = await authHeader();
    if (auth) {
      headers.authorization = auth;
    }
    const response = await fetch(`/youtubei/v1/${path}?key=${encodeURIComponent(page.apiKey)}&prettyPrint=false`, {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ context: page.context, ...body }),
      signal: session.controller.signal
    });
    if (!response.ok) {
      throw new Error("bad response");
    }
    return response.json();
  };

  const showSaveMessage = (session, text, retry = false) => {
    const { saveMenu } = session.ui;
    saveMenu.replaceChildren();
    const note = document.createElement("p");
    note.textContent = text;
    saveMenu.append(note);
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.saveRetry = "true";
      button.textContent = "Try again";
      saveMenu.append(button);
    }
  };

  const renderPlaylists = (session, playlists) => {
    const { saveMenu } = session.ui;
    saveMenu.replaceChildren();
    const head = document.createElement("div");
    head.className = "simpl-youtube-preview-pop-head";
    head.textContent = "Save to…";
    saveMenu.append(head);
    const list = document.createElement("div");
    list.className = "simpl-youtube-preview-save-list";
    for (const playlist of playlists) {
      const row = document.createElement("label");
      row.className = "simpl-youtube-preview-save-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = playlist.checked;
      box.dataset.playlistId = playlist.id;
      const title = document.createElement("span");
      title.textContent = playlist.title;
      row.append(box, title);
      if (playlist.privacy) {
        const privacy = document.createElement("em");
        privacy.textContent = playlist.privacy;
        row.append(privacy);
      }
      list.append(row);
    }
    saveMenu.append(list);
  };

  const parsePlaylists = (json) => {
    const found = [];
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 12) {
        return;
      }
      if (node.playlistAddToOptionRenderer) {
        const item = node.playlistAddToOptionRenderer;
        if (item.playlistId) {
          found.push({
            id: item.playlistId,
            title: textOf(item.title),
            checked: item.containsSelectedVideos === "ALL",
            privacy: String(item.privacy || "").replace(/^./, (c) => c) &&
              ({ PRIVATE: "Private", UNLISTED: "Unlisted" }[item.privacy] || "")
          });
        }
        return;
      }
      Object.values(node).forEach((value) => walk(value, depth + 1));
    };
    walk(json, 0);
    return found;
  };

  const loadPlaylists = async (session) => {
    if (!signedIn()) {
      showSaveMessage(session, "Sign in to YouTube to save videos to your playlists.");
      return;
    }
    session.saveLoading = true;
    showSaveMessage(session, "Loading your playlists…");
    try {
      const json = await innertube(session, "playlist/get_add_to_playlist", {
        videoIds: [videoIdFromUrl(session.url)],
        excludeWatchLater: false
      });
      if (session.closing) {
        return;
      }
      const playlists = parsePlaylists(json);
      if (!playlists.length) {
        showSaveMessage(session, "No playlists were returned. Sign in to YouTube, then try again.", true);
      } else {
        renderPlaylists(session, playlists);
        session.saveLoaded = true;
      }
    } catch {
      if (!session.closing) {
        showSaveMessage(session, "Couldn't load your playlists.", true);
      }
    } finally {
      session.saveLoading = false;
    }
  };

  const toggleSaveMenu = (session) => {
    const open = session.ui.saveMenu.hidden;
    closeMenus(session);
    session.ui.saveMenu.hidden = !open;
    session.ui.saveButton.setAttribute("aria-expanded", String(open));
    if (open && !session.saveLoaded && !session.saveLoading) {
      loadPlaylists(session);
    }
    setControlsVisible(session, true);
  };

  const savePlaylistChange = async (session, box) => {
    const id = videoIdFromUrl(session.url);
    const wanted = box.checked;
    box.disabled = true;
    try {
      const json = await innertube(session, "browse/edit_playlist", {
        playlistId: box.dataset.playlistId,
        actions: [wanted
          ? { addedVideoId: id, action: "ACTION_ADD_VIDEO" }
          : { removedVideoId: id, action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID" }]
      });
      if (json?.status && json.status !== "STATUS_SUCCEEDED") {
        throw new Error("rejected");
      }
      showToast(session, wanted ? "Saved" : "Removed");
    } catch {
      box.checked = !wanted;
      showToast(session, "Couldn't update that playlist");
    } finally {
      box.disabled = false;
    }
  };

  // ---- Switching videos without leaving the viewer ----------------------
  // The moved preview player is a real YouTube player, so it can be told to
  // load another video. If YouTube does not accept it in time, fall back to
  // opening the video on YouTube.

  const resetForNewVideo = (session, target) => {
    session.carryCaptions = session.ui.cc.getAttribute("aria-pressed") === "true";
    session.url = target.url;
    session.currentInfo = target;
    session.watchPage = null;
    session.recsLoaded = false;
    session.recsLoading = false;
    session.descLoaded = false;
    session.descLoading = false;
    // A freshly loaded video can come up muted; keep sound on (in both
    // directions of Back/Recommended) unless the user asked for silence.
    session.unmuteUntil = Date.now() + 8000;
    session.unmuteAttempts = 0;
    if (!session.userMuteIntent && session.video) {
      session.video.muted = false;
    }
    session.captionsOn = false;
    session.chapters = [];
    session.chapterIndex = -2;
    session.chaptersDrawn = 0;
    session.ui.chapterMarks.replaceChildren();
    session.ui.chapterName.textContent = "";
    session.commentsLoaded = false;
    session.commentsLoading = false;
    session.commentsNext = "";
    session.commentsTotal = "";
    session.descHeading = null;
    session.channelUrl = "";
    session.ui.channelAvatar.hidden = true;
    session.ui.channelLabel.removeAttribute("data-link");
    session.saveLoaded = false;
    session.ui.saveMenu.replaceChildren();
    session.panelMode = "desc";
    session.ui.commentsBody.replaceChildren();
    session.ui.descBody.hidden = false;
    session.ui.commentsBody.hidden = true;
    session.storyboard = null;
    session.storyboardPromise = null;
    session.sheets = new Map();
    session.qualityApplied = false;
    session.qualityCurrent = "";
    session.captionsTouched = false;
    session.captionsPending = null;
    session.userPaused = false;
    session.resumeAttempts = 0;
    renderCaptionText(session, "");
    setCaptionButton(session, false);
    session.ui.recsTrack.replaceChildren();
    session.ui.descBody.replaceChildren();
    session.ui.descTitle.textContent = target.title || "";
    session.ui.descMeta.textContent = target.channel || "";
    session.ui.heading.textContent = target.title || "";
    session.ui.channelLabel.textContent = target.channel || "";
    session.ui.timeline.value = "0";
    session.ui.timeline.style.setProperty("--simpl-progress", "0%");
    session.ui.scrub.hidden = true;
    session.ui.backVideo.hidden = session.history.length === 0;
    if (target.thumb) {
      session.ui.poster.src = target.thumb;
      session.ui.poster.hidden = false;
    }
  };

  // Try YouTube's own hover preview for the target (no ad). Resolves true
  // once a fresh viewer has taken over, false if it should fall back.
  const switchViaPreview = (session, target, back) => {
    const card = ghostCardFor(target.id);
    const anchor = card?.querySelector("a#thumbnail, a[href*='/watch']");
    if (!card || !anchor || !isWatchUrl(anchor.href)) {
      return Promise.resolve(false);
    }
    const previous = session.currentInfo;
    const previousUrl = session.url;
    session.switching = true;
    toggleRecommended(session, false);
    toggleDescription(session, false);
    session.ui.heading.textContent = target.title || "";
    session.ui.channelLabel.textContent = target.channel || "";
    if (target.thumb) {
      session.ui.poster.src = target.thumb;
      session.ui.poster.hidden = false;
    }
    session.video.pause();
    session.root.dataset.pending = "true";
    session.root.dataset.state = "loading";
    session.ui.status.textContent = "Loading…";
    const { playOther } = session.ui;
    const revert = () => {
      delete session.root.dataset.pending;
      session.switching = false;
      playOther.hidden = true;
      playOther.onclick = null;
    };
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let offered = false;
      const timer = setInterval(() => {
        if (session.closing) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        const video = getPreviewVideo(card, anchor.href);
        if (video && video !== session.video && video.isConnected) {
          clearInterval(timer);
          const history = back
            ? session.history
            : [...session.history, ...(previous ? [{ ...previous, url: previousUrl }] : [])];
          const returnFocus = session.returnFocus;
          const carry = {
            volume: session.video.volume,
            muted: session.video.muted,
            userSetMute: session.userSetMute,
            userMuteIntent: session.userMuteIntent,
            speed: session.video.playbackRate,
            qualityChoice: session.qualityChoice,
            captions: session.ui.cc.getAttribute("aria-pressed") === "true"
          };
          closePreview(session, "", { instant: true });
          openPreview({
            anchor,
            card,
            instant: true,
            history,
            returnFocus,
            carry,
            info: { ...target, url: anchor.href }
          });
          resolve(true);
        } else {
          if (!offered && Date.now() - startedAt > 3500) {
            // Never switch on its own; let the user choose the old method.
            offered = true;
            playOther.hidden = false;
            playOther.onclick = () => {
              clearInterval(timer);
              revert();
              resolve(false);
            };
          }
          dispatchPreviewHover(card);
        }
      }, 100);
      dispatchPreviewHover(card);
    });
  };

  const switchVideo = (session, target, { back = false, noPreview = false } = {}) => {
    if (!session.video || session.switching || session.closing) {
      closePreview(session, target.url);
      return;
    }
    if (!/^[\w-]{11}$/.test(target.id || "")) {
      closePreview(session, target.url);
      return;
    }
    if (!noPreview && ghostCardFor(target.id)) {
      switchViaPreview(session, target, back).then((handled) => {
        if (!handled && !session.closing) {
          switchVideo(session, target, { back, noPreview: true });
        }
      });
      return;
    }
    const previous = session.currentInfo;
    const previousUrl = session.url;
    const command = playerCommand("load", { videoId: target.id });
    if (!command?.ok) {
      closePreview(session, target.url);
      return;
    }
    if (!back && previous) {
      session.history.push({ ...previous, url: previousUrl });
    }
    session.switching = true;
    toggleRecommended(session, false);
    toggleDescription(session, false);
    resetForNewVideo(session, target);
    session.root.dataset.state = "loading";
    session.ui.status.textContent = "Loading…";
    showToast(session, target.title || "Loading…");

    const startedAt = Date.now();
    const finish = (ok) => {
      clearInterval(session.switchTimer);
      session.switching = false;
      if (session.closing) {
        return;
      }
      if (!ok) {
        closePreview(session, target.url);
        return;
      }
      session.root.dataset.state = "ready";
      session.ui.status.textContent = "";
      window.dispatchEvent(new Event("resize"));
      refreshPlayerStatus(session);
      scheduleStatusRefresh(session, [300, 900]);
      setTimeout(() => {
        if (activeSession === session && !session.closing && session.url === target.url) {
          loadRecommended(session);
          loadDescription(session);
        }
      }, 500);
    };
    clearInterval(session.switchTimer);
    session.switchTimer = setInterval(() => {
      const replaced = session.playerNode?.querySelector("video");
      if (replaced && replaced !== session.video) {
        // YouTube swapped the <video> element; the viewer's listeners are
        // bound to the old one, so continue on the full page instead.
        finish(false);
        return;
      }
      const status = playerCommand("status")?.status;
      if (status?.ad) {
        // YouTube queued an ad before the video; get past it and keep waiting.
        playerCommand("skipAd");
        session.ui.status.textContent = "Skipping ad…";
        if (Date.now() - startedAt > 20000) {
          finish(false);
        }
        return;
      }
      if (
        status?.videoId === target.id &&
        session.video.readyState >= 2 &&
        session.video.currentTime > 0.05
      ) {
        finish(true);
      } else if (Date.now() - startedAt > 7000) {
        finish(false);
      }
    }, 250);
  };

  const previousVideo = (session) => {
    const entry = session.history.pop();
    if (!entry) {
      return;
    }
    switchVideo(session, entry, { back: true });
  };

  // ---- Seek-bar preview (YouTube storyboard sprite sheets) --------------

  const parseStoryboard = (spec, duration) => {
    const parts = String(spec || "").split("|");
    const base = parts.shift();
    const levels = parts.map((part, index) => {
      const [w, h, count, cols, rows, interval, name, sigh] = part.split("#");
      const level = {
        index,
        width: Number(w),
        height: Number(h),
        count: Number(count),
        cols: Number(cols),
        rows: Number(rows),
        interval: Number(interval) / 1000,
        name,
        sigh
      };
      if (!(level.interval > 0) && level.count > 0 && duration > 0) {
        level.interval = duration / level.count;
      }
      return level;
    }).filter((level) => (
      level.width > 0 && level.height > 0 && level.count > 0 &&
      level.cols > 0 && level.rows > 0 && level.interval > 0
    ));
    if (!base || levels.length === 0) {
      return null;
    }
    // Prefer the smallest sheet that is still sharp at preview size.
    const level = levels.find((item) => item.width >= 160) || levels[levels.length - 1];
    return { base, level };
  };

  const storyboardSheetUrl = ({ base, level }, sheet) => {
    try {
      const url = new URL(
        base.replace("$L", level.index).replace("$N", level.name).replace("$M", sheet),
        location.href
      );
      if (level.sigh) {
        url.searchParams.set("sigh", level.sigh);
      }
      return url.href;
    } catch {
      return "";
    }
  };

  const loadStoryboard = (session) => {
    if (session.storyboardPromise) {
      return;
    }
    const duration = session.video?.duration || 0;
    session.storyboardPromise = (async () => {
      let spec = playerCommand("storyboard")?.spec || "";
      if (!spec) {
        const { player } = await getWatchPage(session);
        spec = player?.storyboards?.playerStoryboardSpecRenderer?.spec ||
          player?.storyboards?.playerLiveStoryboardSpecRenderer?.spec || "";
      }
      session.storyboard = parseStoryboard(spec, session.video?.duration || duration);
      session.sheets = new Map();
    })().catch(() => {
      session.storyboard = null;
    });
  };

  const sheetImage = (session, sheet) => {
    let image = session.sheets.get(sheet);
    if (!image) {
      image = new Image();
      image.src = storyboardSheetUrl(session.storyboard, sheet);
      session.sheets.set(sheet, image);
    }
    return image;
  };

  const showScrubPreview = (session, ratio, width) => {
    const { scrub, scrubThumb, scrubTime } = session.ui;
    const duration = session.video?.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const seconds = duration * ratio;
    const chapterIndex = chapterAt(session, seconds);
    session.segments?.forEach((item, index) => {
      item.segment.toggleAttribute("data-hover", index === chapterIndex);
    });
    scrubTime.textContent = chapterIndex >= 0
      ? `${session.chapters[chapterIndex].title} · ${formatTime(seconds)}`
      : formatTime(seconds);
    scrub.hidden = false;
    const board = session.storyboard;
    scrubThumb.hidden = !board;
    let boxWidth = scrub.offsetWidth || 60;
    if (board) {
      const { level } = board;
      const perSheet = level.cols * level.rows;
      const frame = Math.max(0, Math.min(level.count - 1, Math.floor(seconds / level.interval)));
      const sheet = Math.floor(frame / perSheet);
      const slot = frame % perSheet;
      const scale = 176 / level.width;
      const image = sheetImage(session, sheet);
      scrubThumb.style.width = `${level.width * scale}px`;
      scrubThumb.style.height = `${level.height * scale}px`;
      scrubThumb.style.backgroundImage = `url("${image.src}")`;
      scrubThumb.style.backgroundSize = `${level.cols * level.width * scale}px ${level.rows * level.height * scale}px`;
      scrubThumb.style.backgroundPosition =
        `${-(slot % level.cols) * level.width * scale}px ${-Math.floor(slot / level.cols) * level.height * scale}px`;
      // Warm the next sheet so scrubbing across a boundary doesn't flash.
      if (sheet + 1 < Math.ceil(level.count / perSheet)) {
        sheetImage(session, sheet + 1);
      }
      boxWidth = 176;
    }
    const half = boxWidth / 2;
    const x = Math.max(half, Math.min(width - half, ratio * width));
    scrub.style.left = `${x}px`;
  };

  const toggleRecommended = (session, force) => {
    const open = typeof force === "boolean" ? force : !session.recsOpen;
    session.recsOpen = open;
    session.root.dataset.recs = open ? "open" : "closed";
    session.ui.recs.setAttribute("aria-hidden", String(!open));
    session.ui.recsToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      closeMenus(session);
      toggleDescription(session, false);
      loadRecommended(session);
    }
    setControlsVisible(session, true);
  };

  const openPreview = ({ anchor, card, instant = false, history = [], returnFocus = null, info: given = null, carry = null }) => {
    const ghost = Boolean(card.closest?.("#simpl-youtube-ghosts"));
    const originElement = ghost ? null : getOriginElement(card, anchor);
    const originRect = originElement ? originElement.getBoundingClientRect() : null;
    const info = given || {
      ...getVideoInfo(card, anchor),
      id: videoIdFromUrl(anchor.href),
      url: anchor.href,
      thumb: getPosterUrl(card)
    };
    const root = createPlayer({
      url: anchor.href,
      poster: info.thumb,
      info
    });
    const $ = (name) => root.querySelector(`.simpl-youtube-preview-${name}`);
    const ui = {
      dialog: $("dialog"),
      media: $("media"),
      topbar: $("topbar"),
      status: $("status-text"),
      fallbackOpen: $("fallback-open"),
      playOther: $("play-other"),
      open: $("open"),
      close: $("close"),
      toast: $("toast"),
      controls: $("controls"),
      play: $("play"),
      back: $("back"),
      ahead: $("ahead"),
      time: $("time"),
      timeline: $("timeline"),
      buffered: $("buffered"),
      caps: $("caps"),
      capPos: $("cap-pos"),
      capSize: $("cap-size"),
      scrub: $("scrub"),
      scrubThumb: $("scrub-thumb"),
      scrubTime: $("scrub-time"),
      mute: $("mute"),
      volume: $("volume"),
      cc: $("cc"),
      settingsButton: $("settings-button"),
      settingsMenu: $("settings-menu"),
      speed: $("speed"),
      qualityButton: $("quality-button"),
      qualityMenu: $("quality-menu"),
      qualityBadge: $("quality-badge"),
      descToggle: $("desc-toggle"),
      channelAvatar: $("channel-avatar"),
      shareButton: $("share"),
      shareMenu: $("share-menu"),
      saveButton: $("save"),
      saveMenu: $("save-menu"),
      commentsToggle: $("comments-toggle"),
      commentsBody: $("comments-body"),
      chapterMarks: $("chapter-marks"),
      chapterName: $("chapter-name"),
      backVideo: $("back-video"),
      poster: $("poster"),
      heading: $("title"),
      channelLabel: $("channel"),
      desc: $("desc"),
      descTitle: $("desc-title"),
      descMeta: $("desc-meta"),
      descBody: $("desc-body"),
      descGlass: $("desc-glass"),
      descSolid: $("desc-solid"),
      recsToggle: $("recs-toggle"),
      recs: $("recs"),
      recsTrack: $("recs-track"),
      captionRow: $("caption-row"),
      captionTrack: $("caption-track"),
      resolution: $("resolution"),
      pip: $("pip"),
      fullscreen: $("fullscreen")
    };
    const session = {
      root,
      ui,
      card,
      url: anchor.href,
      originElement,
      originRect,
      ghost,
      returnFocus: returnFocus || document.activeElement,
      controller: new AbortController(),
      observer: null,
      pollTimer: null,
      statusTimer: null,
      waitTimer: null,
      controlsTimer: null,
      toastTimer: null,
      video: null,
      playerNode: null,
      captionHost: null,
      originalVideo: null,
      originalPlayer: null,
      apiReady: false,
      captionsPending: null,
      captionAttempts: 0,
      qualityChoice: carry
        ? carry.qualityChoice
        : prefs.quality === "auto" ? "" : prefs.quality || DEFAULT_QUALITY,
      carry,
      carryCaptions: Boolean(carry?.captions),
      captionsOn: false,
      userSetMute: Boolean(carry?.userSetMute),
      userMuteIntent: Boolean(carry?.userMuteIntent),
      unmuteUntil: 0,
      qualityLevels: [],
      qualityCurrent: "",
      recsOpen: false,
      descOpen: false,
      history: [...history],
      switching: false,
      currentInfo: info,
      descLoaded: false,
      panelMode: "desc",
      chapters: [],
      chapterIndex: -2,
      chaptersDrawn: 0,
      commentsLoaded: false,
      commentsLoading: false,
      commentsNext: "",
      commentsTotal: "",
      descHeading: null,
      channelUrl: "",
      saveLoaded: false,
      saveLoading: false,
      recsLoaded: false,
      qualityApplied: false,
      captionsTouched: false,
      capText: "",
      capBubble: null,
      capFrame: 0,
      capObserver: null,
      storyboard: null,
      storyboardPromise: null,
      sheets: new Map(),
      watchPage: null,
      scrubbing: false,
      overControls: false,
      pointerSeen: false,
      userPaused: false,
      unmuteAttempts: 0,
      resumeAttempts: 0,
      closing: false
    };
    activeSession = session;
    document.documentElement.classList.add("simpl-youtube-preview-open");
    document.documentElement.append(root);
    ui.backVideo.hidden = session.history.length === 0;
    if (!instant && originRect) {
      animateDialogIn(ui.dialog, originRect);
    }

    const signal = session.controller.signal;
    const on = (target, type, handler, options = {}) => (
      target.addEventListener(type, handler, { ...options, signal })
    );

    on(ui.close, "click", () => closePreview(session));
    on(ui.open, "click", () => closePreview(session, watchUrlAt(session)));
    on(ui.fallbackOpen, "click", () => closePreview(session, session.url));
    on(root.querySelector(".simpl-youtube-preview-backdrop"), "click", () => closePreview(session));
    on(ui.play, "click", () => togglePlayback(session));
    on(ui.back, "click", () => seekBy(session, -10));
    on(ui.ahead, "click", () => seekBy(session, 10));

    const timelineSeconds = () => {
      const duration = session.video?.duration;
      return Number.isFinite(duration) && duration > 0
        ? duration * (Number(ui.timeline.value) / 1000)
        : 0;
    };
    on(ui.timeline, "input", () => {
      session.scrubbing = true;
      const duration = session.video?.duration || 0;
      const seconds = timelineSeconds();
      ui.timeline.style.setProperty("--simpl-progress", `${Number(ui.timeline.value) / 10}%`);
      ui.time.textContent = `${formatTime(seconds)} / ${formatTime(duration)}`;
      paintSegments(session, seconds);
    });
    on(ui.timeline, "change", () => {
      session.scrubbing = false;
      seekTo(session, timelineSeconds());
      setControlsVisible(session, true);
    });
    on(ui.timeline, "pointerenter", () => loadStoryboard(session));
    on(ui.timeline, "pointermove", (event) => {
      const rect = ui.timeline.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      loadStoryboard(session);
      showScrubPreview(session, ratio, rect.width);
    });
    on(ui.timeline, "pointerleave", () => {
      ui.scrub.hidden = true;
      session.segments?.forEach((item) => item.segment.removeAttribute("data-hover"));
    });

    on(ui.mute, "click", () => {
      if (session.video) {
        session.userSetMute = true;
        if (session.video.muted && session.video.volume === 0) {
          session.video.volume = Number.isFinite(prefs.volume) && prefs.volume > 0 ? prefs.volume : 1;
        }
        session.video.muted = !session.video.muted;
        session.userMuteIntent = session.video.muted;
      }
    });
    on(ui.volume, "input", () => setVolume(session, Number(ui.volume.value)));
    on(ui.cc, "click", () => toggleCaptions(session));
    on(ui.settingsButton, "click", () => {
      const open = ui.settingsMenu.hidden;
      closeMenus(session);
      ui.settingsMenu.hidden = !open;
      ui.settingsButton.setAttribute("aria-expanded", String(open));
      if (open) {
        refreshPlayerStatus(session);
      }
      setControlsVisible(session, true);
    });
    applyCaptionLook(session);
    enableCaptionDrag(session);
    on(ui.capPos, "change", () => {
      savePrefs({ captionPos: ui.capPos.value });
      applyCaptionLook(session);
    });
    on(ui.capSize, "change", () => {
      savePrefs({ captionSize: ui.capSize.value });
      applyCaptionLook(session);
    });
    on(ui.speed, "change", () => setSpeed(session, Number(ui.speed.value)));
    on(ui.qualityButton, "click", () => {
      const open = ui.qualityMenu.hidden;
      closeMenus(session);
      ui.qualityMenu.hidden = !open;
      ui.qualityButton.setAttribute("aria-expanded", String(open));
      if (open) {
        refreshPlayerStatus(session);
      }
      setControlsVisible(session, true);
    });
    on(ui.qualityMenu, "click", (event) => {
      const option = event.target.closest("button[data-level]");
      if (!option) {
        return;
      }
      setQuality(session, option.dataset.level);
      closeMenus(session);
    });
    applyDescriptionMode(session);
    on(ui.descToggle, "click", () => toggleDescription(session));
    const openChannel = (event) => {
      event.preventDefault();
      if (session.channelUrl) {
        closePreview(session, session.channelUrl);
      }
    };
    on(ui.channelAvatar, "click", openChannel);
    on(ui.channelLabel, "click", openChannel);
    on(ui.shareButton, "click", () => toggleShareMenu(session));
    on(ui.shareMenu, "click", (event) => {
      const option = event.target.closest("button[data-action]");
      if (option) {
        runShareAction(session, option.dataset.action);
      }
    });
    on(ui.saveButton, "click", () => toggleSaveMenu(session));
    on(ui.saveMenu, "change", (event) => {
      if (event.target.matches?.("input[data-playlist-id]")) {
        savePlaylistChange(session, event.target);
      }
    });
    on(ui.saveMenu, "click", (event) => {
      if (event.target.closest("button[data-save-retry]")) {
        loadPlaylists(session);
      }
    });
    on(ui.commentsToggle, "click", () => toggleDescription(session, undefined, "comments"));
    on(ui.commentsBody, "click", (event) => {
      const stamp = event.target.closest("button.simpl-youtube-preview-stamp");
      if (!stamp) {
        return;
      }
      if (stamp.dataset.commentsRetry) {
        const more = Boolean(session.commentsLoaded);
        loadComments(session, more);
        return;
      }
      seekTo(session, Number(stamp.dataset.seconds));
      showToast(session, formatTime(Number(stamp.dataset.seconds)));
    });
    on(ui.backVideo, "click", () => previousVideo(session));
    on(ui.descGlass, "click", () => {
      savePrefs({ descSolid: false });
      applyDescriptionMode(session);
    });
    on(ui.descSolid, "click", () => {
      savePrefs({ descSolid: true });
      applyDescriptionMode(session);
    });
    on(ui.descBody, "click", (event) => {
      const stamp = event.target.closest("button.simpl-youtube-preview-stamp");
      if (!stamp) {
        return;
      }
      if (stamp.dataset.retry) {
        session.descLoaded = false;
        session.watchPage = null;
        loadDescription(session);
        return;
      }
      seekTo(session, Number(stamp.dataset.seconds));
      showToast(session, formatTime(Number(stamp.dataset.seconds)));
    });
    on(ui.recsToggle, "click", () => toggleRecommended(session));
    // Wheel down scrolls the row right, wheel up scrolls it left.
    on(ui.recs, "wheel", (event) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? ui.recsTrack.clientWidth : 1;
        ui.recsTrack.scrollLeft += event.deltaY * unit;
      }
    }, { passive: false });
    on(ui.recsTrack, "click", (event) => {
      const link = event.target.closest("a[data-video-id]");
      if (
        !link ||
        event.button > 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      switchVideo(session, {
        id: link.dataset.videoId,
        url: link.href,
        title: link.dataset.title,
        channel: link.dataset.channel,
        thumb: link.dataset.thumb
      });
    });
    on(ui.recsTrack.parentElement, "click", (event) => {
      if (event.target.closest("[data-retry]")) {
        session.recsLoaded = false;
        loadRecommended(session);
      }
    });
    on(ui.captionTrack, "change", () => {
      const key = ui.captionTrack.value;
      if (!key) {
        setCaptions(session, false);
        return;
      }
      const option = ui.captionTrack.selectedOptions[0];
      setCaptions(session, true, {
        key,
        languageCode: key.split("|")[0],
        label: option?.textContent || ""
      });
    });
    on(ui.pip, "click", () => togglePictureInPicture(session));
    on(ui.fullscreen, "click", () => setFullscreen(session));
    on(ui.media, "mousemove", (event) => {
      session.pointerSeen = true;
      session.overControls = Boolean(
        event.target.closest?.(".simpl-youtube-preview-controls, .simpl-youtube-preview-topbar")
      );
      setControlsVisible(session, true);
    });
    on(ui.media, "mouseleave", () => {
      session.overControls = false;
      if (session.video && !session.video.paused && !menusOpen(session) && !session.recsOpen && !session.descOpen) {
        setControlsVisible(session, false);
      }
    });
    on(ui.media, "click", (event) => {
      if (
        menusOpen(session) &&
        !event.target.closest(".simpl-youtube-preview-settings-wrap, .simpl-youtube-preview-quality-wrap, .simpl-youtube-preview-share-wrap, .simpl-youtube-preview-save-wrap")
      ) {
        event.preventDefault();
        event.stopPropagation();
        closeMenus(session);
        return;
      }
      if (
        (session.recsOpen || session.descOpen) &&
        !event.target.closest(".simpl-youtube-preview-controls, .simpl-youtube-preview-topbar, .simpl-youtube-preview-desc")
      ) {
        event.preventDefault();
        event.stopPropagation();
        toggleRecommended(session, false);
        toggleDescription(session, false);
        return;
      }
      if (
        !session.video ||
        event.target.closest("button, input, select, label, a, .simpl-youtube-preview-desc, .simpl-youtube-preview-caps, .simpl-youtube-preview-settings-menu, .simpl-youtube-preview-quality-menu, .simpl-youtube-preview-topbar")
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      togglePlayback(session);
    }, { capture: true });
    on(ui.media, "dblclick", (event) => {
      if (!event.target.closest(".simpl-youtube-preview-controls, .simpl-youtube-preview-topbar")) {
        event.preventDefault();
        setFullscreen(session);
      }
    }, { capture: true });
    on(document, "fullscreenchange", () => setControlsVisible(session, true));

    const initialVideo = getPreviewVideo(card, session.url);
    session.observer = new MutationObserver(() => {
      bindVideo(session, getPreviewVideo(card, session.url));
    });
    session.observer.observe(document.documentElement, { childList: true, subtree: true });
    session.pollTimer = setInterval(() => {
      bindVideo(session, getPreviewVideo(card, session.url));
      if (!session.video) {
        dispatchPreviewHover(card);
      }
    }, 120);
    session.waitTimer = setTimeout(() => showUnavailable(session), PREVIEW_WAIT_MS);
    dispatchPreviewHover(card);
    bindVideo(session, initialVideo || getPreviewVideo(card, session.url));
  };

  const onClick = (event) => {
    if (
      !enabled ||
      activeSession ||
      event.defaultPrevented ||
      event.button > 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor = eventAnchor(event);
    const card = anchor && getCard(anchor);
    if (!anchor || !card) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    openPreview({ anchor, card });
  };

  const onKeyDown = (event) => {
    const session = activeSession;
    if (!session) {
      return;
    }
    const editing = event.target.matches?.("input[type='text'], input[type='search'], select, textarea") ||
      event.target.isContentEditable;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (menusOpen(session)) {
        closeMenus(session);
      } else if (session.descOpen) {
        toggleDescription(session, false);
      } else if (session.recsOpen) {
        toggleRecommended(session, false);
      } else if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        closePreview(session);
      }
      return;
    }
    // Focused sliders keep their native arrow/Home/End behavior.
    const onRange = event.target.matches?.("input[type='range']") &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key);
    if (editing || onRange || !session.video || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();
    let handled = true;
    if (key === " " || key === "k") {
      togglePlayback(session);
    } else if (key === "j") {
      seekBy(session, -10);
    } else if (key === "l") {
      seekBy(session, 10);
    } else if (event.key === "ArrowLeft") {
      seekBy(session, -5);
    } else if (event.key === "ArrowRight") {
      seekBy(session, 5);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const base = session.video.muted ? 0 : session.video.volume;
      setVolume(session, base + (event.key === "ArrowUp" ? 0.05 : -0.05));
      showToast(session, `Volume ${Math.round(session.video.volume * 100)}%`);
    } else if (event.key === ">" || event.key === "<") {
      stepSpeed(session, event.key === ">" ? 1 : -1);
    } else if (/^[0-9]$/.test(event.key) && Number.isFinite(session.video.duration)) {
      seekTo(session, session.video.duration * (Number(event.key) / 10));
    } else if (key === "home") {
      seekTo(session, 0);
    } else if (key === "end" && Number.isFinite(session.video.duration)) {
      seekTo(session, session.video.duration - 1);
    } else if (key === "m") {
      session.userSetMute = true;
      session.video.muted = !session.video.muted;
      session.userMuteIntent = session.video.muted;
    } else if (key === "c") {
      toggleCaptions(session);
    } else if (key === "q") {
      session.ui.qualityButton.click();
    } else if (key === "r") {
      toggleRecommended(session);
    } else if (key === "d") {
      toggleDescription(session);
    } else if (key === "n") {
      toggleDescription(session, undefined, "comments");
    } else if (key === "b" && session.history.length) {
      previousVideo(session);
    } else if (key === "f") {
      setFullscreen(session);
    } else if (key === "i") {
      togglePictureInPicture(session);
    } else if (key === "w") {
      closePreview(session, watchUrlAt(session));
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      setControlsVisible(session, true);
    }
  };

  const onStorageChanged = (changes, area) => {
    if (area !== "local") {
      return;
    }
    if (changes[PREFS_KEY]) {
      const next = changes[PREFS_KEY].newValue;
      prefs = next && typeof next === "object" ? next : {};
    }
    if (!changes[SETTING_KEY]) {
      return;
    }
    enabled = changes[SETTING_KEY].newValue === true;
    if (!enabled && activeSession) {
      closePreview(activeSession);
    }
  };

  const onYoutubeNavigate = () => {
    closePreview(activeSession);
  };

  const destroy = () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    closePreview(activeSession);
    window.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("yt-navigate-start", onYoutubeNavigate);
    window.removeEventListener("simpl-extension-reinject", destroy);
    try {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    } catch {
      // The old extension context is already invalid.
    }
    globalThis.__SIMPL_YOUTUBE_PREVIEW_LOADED__ = false;
  };

  window.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("yt-navigate-start", onYoutubeNavigate);
  window.addEventListener("simpl-extension-reinject", destroy);
  chrome.storage.onChanged.addListener(onStorageChanged);
  getSettings().then((settings) => {
    enabled = settings.enabled;
    prefs = settings.prefs;
  });
})();
