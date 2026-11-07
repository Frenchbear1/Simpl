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
    root.dataset.controls = "visible";
    root.innerHTML = `
      <div class="simpl-youtube-preview-backdrop"></div>
      <section class="simpl-youtube-preview-dialog" role="dialog" aria-modal="true" aria-label="YouTube preview player">
        <div class="simpl-youtube-preview-media">
          <img class="simpl-youtube-preview-poster" alt="">
          <div class="simpl-youtube-preview-status" role="status">
            <span class="simpl-youtube-preview-spinner" aria-hidden="true"></span>
            <span class="simpl-youtube-preview-status-text">Loading preview…</span>
            <button class="simpl-youtube-preview-fallback-open" type="button" hidden>Open on YouTube</button>
          </div>
          <div class="simpl-youtube-preview-topbar">
            <div class="simpl-youtube-preview-heading">
              <span class="simpl-youtube-preview-title"></span>
              <span class="simpl-youtube-preview-channel"></span>
            </div>
            <button class="simpl-youtube-preview-open simpl-youtube-preview-icon-button" type="button" aria-label="Continue on YouTube" title="Continue on YouTube at this time (w)">${icon("external")}</button>
            <button class="simpl-youtube-preview-close simpl-youtube-preview-icon-button" type="button" aria-label="Close preview" title="Close (Esc)">${icon("close")}</button>
          </div>
          <div class="simpl-youtube-preview-caps" data-pos="bottom-center"></div>
          <div class="simpl-youtube-preview-toast" aria-live="polite"></div>
          <div class="simpl-youtube-preview-controls">
            <div class="simpl-youtube-preview-recs" aria-hidden="true">
              <div class="simpl-youtube-preview-recs-track" tabindex="-1"></div>
            </div>
            <div class="simpl-youtube-preview-timeline-wrap">
              <div class="simpl-youtube-preview-buffered"></div>
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
              </div>
              <button class="simpl-youtube-preview-recs-toggle" type="button" aria-expanded="false" title="Recommended videos (r)">
                <span>Recommended</span>${icon("chevron")}
              </button>
              <div class="simpl-youtube-preview-control-group simpl-youtube-preview-right-controls">
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
    !session.ui.settingsMenu.hidden || !session.ui.qualityMenu.hidden
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

  const renderResolution = (session) => {
    const height = session.video?.videoHeight || 0;
    session.ui.resolution.textContent = height ? `Playing at ${height}p` : "";
    // Badge: the resolution actually playing (the choice can lag a moment).
    session.ui.qualityBadge.textContent = !height ? "" : height >= 2160 ? "4K" : String(height);
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
    // Default to 1080p (or the best level below it) until the user chooses.
    const wanted = prefs.quality || DEFAULT_QUALITY;
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
    return lines.filter(Boolean).join("\n");
  };

  const animateBubble = (bubble, keyframes, options) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return { finished: Promise.resolve() };
    }
    return bubble.animate(keyframes, { fill: "both", ...options });
  };

  // One inline span so the rounded background hugs every wrapped row.
  const setBubbleText = (bubble, text) => {
    let hug = bubble.firstElementChild;
    if (!hug) {
      hug = document.createElement("span");
      hug.className = "simpl-youtube-preview-cap-text";
      bubble.replaceChildren(hug);
    }
    hug.textContent = text;
  };

  const renderCaptionText = (session, text) => {
    if (session.closing || text === session.capText) {
      return;
    }
    const previous = session.capText;
    session.capText = text;
    const { caps } = session.ui;
    const old = session.capBubble;

    const dismiss = (bubble) => {
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
      return;
    }
    const bubble = document.createElement("div");
    bubble.className = "simpl-youtube-preview-cap";
    setBubbleText(bubble, text);
    caps.append(bubble);
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
    if (SPEEDS.includes(video.playbackRate)) {
      ui.speed.value = String(video.playbackRate);
    }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      session.root.dataset.state = "ready";
      ui.status.textContent = "";
    }
    if (video.paused || video.ended) {
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
    if (Number.isFinite(prefs.speed) && SPEEDS.includes(prefs.speed)) {
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

    video.addEventListener("volumechange", () => {
      if (
        !session.userSetMute &&
        video.muted &&
        activeSession === session &&
        !session.closing &&
        session.unmuteAttempts < 3
      ) {
        session.unmuteAttempts += 1;
        setTimeout(() => {
          if (!session.userSetMute && activeSession === session && !session.closing) {
            video.muted = false;
          }
        }, 0);
      }
    }, { signal: session.controller.signal });

    populateSpeed(session);
    watchCaptions(session);
    // Fetch recommendations (and their thumbnails) in the background so the
    // row is ready the moment it is opened.
    setTimeout(() => {
      if (activeSession === session && !session.closing) {
        loadRecommended(session);
      }
    }, 700);
    video.play().then(() => {
      if (!session.userSetMute) {
        video.muted = false;
      }
    }).catch(() => {});
    updateControls(session);
    setControlsVisible(session, true);
    session.ui.close.focus({ preventScroll: true });

    // The player sizes its rendition to its element: let it notice the larger
    // viewer so "Auto" quality can step up.
    window.dispatchEvent(new Event("resize"));

    const status = refreshPlayerStatus(session);
    applyCaptionsDefault(session, status);
    applySavedQuality(session, status);
    // Captions/quality data often arrives a moment after playback starts.
    session.statusTimer = setInterval(() => {
      if (activeSession !== session || session.closing) {
        return;
      }
      const latest = refreshPlayerStatus(session);
      applyCaptionsDefault(session, latest);
      applySavedQuality(session, latest);
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

  const closePreview = async (session = activeSession, navigateTo = "") => {
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
    session.capObserver?.disconnect();
    cancelAnimationFrame(session.capFrame);
    if (document.pictureInPictureElement === session.video) {
      document.exitPictureInPicture?.().catch(() => {});
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }

    let destinationRect = session.originRect;
    if (session.originElement?.isConnected) {
      const current = session.originElement.getBoundingClientRect();
      if (current.width && current.height) {
        destinationRect = current;
      }
    }
    await animateDialogOut(session.ui.dialog, destinationRect);
    restorePlayer(session);
    session.root.remove();
    document.documentElement.classList.remove("simpl-youtube-preview-open");
    if (activeSession === session) {
      activeSession = null;
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
    setControlsVisible(session, true);
  };

  // ---- Recommended videos ------------------------------------------------
  // YouTube only renders the "up next" column on a real watch page, so the
  // viewer fetches that page (same origin, with the user's own cookies) and
  // reads the related videos out of its embedded ytInitialData.

  const extractJsonVariable = (html, name) => {
    const match = new RegExp(`${name}["']?\\]?\\s*=\\s*\\{`).exec(html);
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
          player: extractJsonVariable(html, "ytInitialPlayerResponse")
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
      }
    } catch {
      if (!session.closing) {
        showRecommendedMessage(session, "Couldn't load recommendations.", true);
      }
    } finally {
      session.recsLoading = false;
    }
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
    scrubTime.textContent = formatTime(seconds);
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
      loadRecommended(session);
    }
    setControlsVisible(session, true);
  };

  const openPreview = ({ anchor, card }) => {
    const originElement = getOriginElement(card, anchor);
    const originRect = originElement.getBoundingClientRect();
    const root = createPlayer({
      url: anchor.href,
      poster: getPosterUrl(card),
      info: getVideoInfo(card, anchor)
    });
    const $ = (name) => root.querySelector(`.simpl-youtube-preview-${name}`);
    const ui = {
      dialog: $("dialog"),
      media: $("media"),
      topbar: $("topbar"),
      status: $("status-text"),
      fallbackOpen: $("fallback-open"),
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
      returnFocus: document.activeElement,
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
      qualityChoice: prefs.quality === "auto" ? "" : prefs.quality || DEFAULT_QUALITY,
      qualityLevels: [],
      recsOpen: false,
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
      userPaused: false,
      userSetMute: false,
      unmuteAttempts: 0,
      resumeAttempts: 0,
      closing: false
    };
    activeSession = session;
    document.documentElement.classList.add("simpl-youtube-preview-open");
    document.documentElement.append(root);
    animateDialogIn(ui.dialog, originRect);

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
    });

    on(ui.mute, "click", () => {
      if (session.video) {
        session.userSetMute = true;
        if (session.video.muted && session.video.volume === 0) {
          session.video.volume = Number.isFinite(prefs.volume) && prefs.volume > 0 ? prefs.volume : 1;
        }
        session.video.muted = !session.video.muted;
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
    on(ui.recsToggle, "click", () => toggleRecommended(session));
    on(ui.recsTrack, "wheel", (event) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        event.preventDefault();
        ui.recsTrack.scrollLeft += event.deltaY;
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
      closePreview(session, link.href);
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
      session.overControls = Boolean(
        event.target.closest?.(".simpl-youtube-preview-controls, .simpl-youtube-preview-topbar")
      );
      setControlsVisible(session, true);
    });
    on(ui.media, "mouseleave", () => {
      session.overControls = false;
      if (session.video && !session.video.paused && !menusOpen(session) && !session.recsOpen) {
        setControlsVisible(session, false);
      }
    });
    on(ui.media, "click", (event) => {
      if (
        menusOpen(session) &&
        !event.target.closest(".simpl-youtube-preview-settings-wrap, .simpl-youtube-preview-quality-wrap")
      ) {
        event.preventDefault();
        event.stopPropagation();
        closeMenus(session);
        return;
      }
      if (
        session.recsOpen &&
        !event.target.closest(".simpl-youtube-preview-controls, .simpl-youtube-preview-topbar")
      ) {
        event.preventDefault();
        event.stopPropagation();
        toggleRecommended(session, false);
        return;
      }
      if (
        !session.video ||
        event.target.closest("button, input, select, label, a, .simpl-youtube-preview-caps, .simpl-youtube-preview-settings-menu, .simpl-youtube-preview-quality-menu, .simpl-youtube-preview-topbar")
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
    } else if (key === "c") {
      toggleCaptions(session);
    } else if (key === "q") {
      session.ui.qualityButton.click();
    } else if (key === "r") {
      toggleRecommended(session);
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
