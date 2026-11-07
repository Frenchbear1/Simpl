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
  const CONTROLS_HIDE_MS = 2400;
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const TOGGLE_CAPTIONS_EVENT = "simpl-youtube-toggle-captions";
  const CAPTIONS_STATE_EVENT = "simpl-youtube-captions-state";
  const clock = new Intl.NumberFormat(undefined, { minimumIntegerDigits: 1 });

  let enabled = false;
  let activeSession = null;
  let destroyed = false;

  const icon = (name) => {
    const icons = {
      play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
      pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
      volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2-3.16v6.32A3.5 3.5 0 0 0 15.5 12zm-2-7.5v2.06a6 6 0 0 1 0 10.88v2.06a8 8 0 0 0 0-14z"/></svg>',
      muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3zm12.7.3-1.4 1.4 1.3 1.3-1.3 1.3 1.4 1.4 1.3-1.3 1.3 1.3 1.4-1.4-1.3-1.3 1.3-1.3-1.4-1.4-1.3 1.3z"/></svg>',
      speed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 0 0-8 8c0 2.18.87 4.16 2.29 5.61l1.42-1.42A5.96 5.96 0 0 1 6 12a6 6 0 1 1 10.29 4.19l1.42 1.42A8 8 0 0 0 12 4zm4.95 4.46-6.36 4.95A2 2 0 1 0 13.42 16l4.95-6.36-1.42-1.18z"/></svg>',
      pip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 7H5v10h5v2H3V5h18v7h-2V7zm-7 5h9v7h-9v-7zm2 2v3h5v-3h-5z"/></svg>',
      fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zm-3-12v2h3v3h2V5h-5z"/></svg>',
      close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>'
    };
    return icons[name] || "";
  };

  const getSetting = () => new Promise((resolve) => {
    try {
      chrome.storage.local.get([SETTING_KEY], (data) => {
        resolve(data?.[SETTING_KEY] === true);
      });
    } catch {
      resolve(false);
    }
  });

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

  const createPlayer = ({ url, poster }) => {
    const root = document.createElement(ROOT_TAG);
    root.dataset.state = "loading";
    root.dataset.controls = "visible";
    root.innerHTML = `
      <div class="simpl-youtube-preview-backdrop"></div>
      <section class="simpl-youtube-preview-dialog" role="dialog" aria-modal="true" aria-label="YouTube preview player">
        <div class="simpl-youtube-preview-media">
          <img class="simpl-youtube-preview-poster" alt="">
          <div class="simpl-youtube-preview-status" role="status">
            <span class="simpl-youtube-preview-status-text">Loading preview…</span>
            <button class="simpl-youtube-preview-fallback-open" type="button" hidden>Open YouTube</button>
          </div>
          <button class="simpl-youtube-preview-close simpl-youtube-preview-icon-button" type="button" aria-label="Close preview" title="Close">${icon("close")}</button>
          <div class="simpl-youtube-preview-controls">
            <input class="simpl-youtube-preview-timeline" type="range" min="0" max="1000" value="0" aria-label="Video position" disabled>
            <div class="simpl-youtube-preview-control-row">
              <div class="simpl-youtube-preview-control-group">
                <button class="simpl-youtube-preview-play simpl-youtube-preview-icon-button" type="button" aria-label="Play" title="Play (k)" disabled>
                  <span class="simpl-youtube-preview-play-icon">${icon("play")}</span>
                  <span class="simpl-youtube-preview-pause-icon">${icon("pause")}</span>
                </button>
                <div class="simpl-youtube-preview-volume-group">
                  <button class="simpl-youtube-preview-mute simpl-youtube-preview-icon-button" type="button" aria-label="Unmute" title="Mute (m)" disabled>
                    <span class="simpl-youtube-preview-volume-icon">${icon("volume")}</span>
                    <span class="simpl-youtube-preview-muted-icon">${icon("muted")}</span>
                  </button>
                  <input class="simpl-youtube-preview-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" disabled>
                </div>
                <span class="simpl-youtube-preview-time">0:00 / 0:00</span>
              </div>
              <div class="simpl-youtube-preview-control-group simpl-youtube-preview-right-controls">
                <button class="simpl-youtube-preview-cc simpl-youtube-preview-text-button" type="button" aria-label="Subtitles/closed captions" title="Subtitles/closed captions (c)" disabled>CC</button>
                <div class="simpl-youtube-preview-speed-wrap">
                  <button class="simpl-youtube-preview-speed-button simpl-youtube-preview-icon-button" type="button" aria-label="Playback speed" title="Playback speed" aria-expanded="false" disabled>${icon("speed")}</button>
                  <div class="simpl-youtube-preview-speed-menu" role="dialog" aria-label="Playback speed" hidden>
                    <label>
                      <span>Playback speed</span>
                      <select class="simpl-youtube-preview-speed" aria-label="Playback speed"></select>
                    </label>
                  </div>
                </div>
                <button class="simpl-youtube-preview-pip simpl-youtube-preview-icon-button" type="button" aria-label="Picture in picture" title="Picture in picture" disabled>${icon("pip")}</button>
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

  const setControlsVisible = (session, visible) => {
    if (!session || session.closing) {
      return;
    }
    session.root.dataset.controls = visible ? "visible" : "hidden";
    clearTimeout(session.controlsTimer);
    if (visible && session.video && !session.video.paused && session.ui.speedMenu.hidden) {
      session.controlsTimer = setTimeout(() => {
        session.root.dataset.controls = "hidden";
      }, CONTROLS_HIDE_MS);
    }
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

  const setFullscreen = (session) => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      session.ui.dialog.requestFullscreen?.().catch(() => {});
    }
  };

  const nativeCaptionButtonFor = (video, captionHost = null) => {
    const portal = captionHost || video?.closest("ytd-video-preview") || getPreviewPortal();
    return portal?.querySelector(
      ".ytmClosedCaptioningButtonButton, .ytp-subtitles-button"
    ) || null;
  };

  const captionsAreEnabled = (session) => {
    if (session.nativeCaptionButton) {
      return session.nativeCaptionButton.getAttribute("aria-pressed") === "true";
    }
    return Array.from(session.video?.textTracks || []).some((track) => track.mode === "showing");
  };

  const updateCaptionControl = (session) => {
    const pressed = captionsAreEnabled(session);
    session.ui.cc.dataset.active = String(pressed);
    session.ui.cc.setAttribute("aria-pressed", String(pressed));
  };

  const toggleCaptions = (session) => {
    if (session.nativeCaptionButton?.isConnected) {
      document.dispatchEvent(new CustomEvent(TOGGLE_CAPTIONS_EVENT));
      return;
    }
    const tracks = Array.from(session.video?.textTracks || []);
    if (!tracks.length) {
      return;
    }
    const enable = !tracks.some((track) => track.mode === "showing");
    tracks.forEach((track, index) => {
      track.mode = enable && index === 0 ? "showing" : "disabled";
    });
    updateCaptionControl(session);
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

  const updateControls = (session) => {
    const { video, ui } = session;
    if (!video) {
      return;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const progress = duration > 0 ? (video.currentTime / duration) * 100 : 0;
    const volume = video.muted ? 0 : video.volume;
    ui.play.dataset.playing = String(!video.paused && !video.ended);
    ui.play.setAttribute("aria-label", video.paused || video.ended ? "Play" : "Pause");
    ui.mute.dataset.muted = String(video.muted || video.volume === 0);
    ui.mute.setAttribute("aria-label", video.muted || video.volume === 0 ? "Unmute" : "Mute");
    ui.volume.value = String(volume);
    ui.volume.style.setProperty("--simpl-volume", `${volume * 100}%`);
    ui.timeline.value = duration > 0
      ? String(Math.round((video.currentTime / duration) * 1000))
      : "0";
    ui.timeline.style.setProperty("--simpl-progress", `${progress}%`);
    ui.time.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
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
    session.nativeCaptionButton = nativeCaptionButtonFor(video, session.captionHost);
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
    session.ui.media.insertBefore(session.playerNode, session.ui.controls);
    if (video.volume === 0) {
      video.volume = 1;
    }
    video.muted = false;
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
      session.ui.timeline,
      session.ui.mute,
      session.ui.volume,
      session.ui.speedButton,
      session.ui.fullscreen
    ]) {
      control.disabled = false;
    }
    session.ui.cc.disabled = !session.nativeCaptionButton && video.textTracks.length === 0;
    session.ui.pip.disabled = !document.pictureInPictureEnabled ||
      typeof video.requestPictureInPicture !== "function";

    for (const type of [
      "loadedmetadata",
      "durationchange",
      "timeupdate",
      "play",
      "pause",
      "volumechange",
      "ended",
      "ratechange",
      "resize"
    ]) {
      video.addEventListener(type, () => updateControls(session), {
        signal: session.controller.signal
      });
    }
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
    updateCaptionControl(session);
    video.play().then(() => {
      if (!session.userSetMute) {
        video.muted = false;
      }
    }).catch(() => {});
    updateControls(session);
    setControlsVisible(session, true);
    session.ui.close.focus({ preventScroll: true });
  };

  const restorePlayer = (session) => {
    session.captionHost?.removeAttribute("data-simpl-preview-session");
    const video = session.video;
    const playerNode = session.playerNode;
    const savedVideo = session.originalVideo;
    const savedPlayer = session.originalPlayer;
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
    clearTimeout(session.waitTimer);
    clearTimeout(session.controlsTimer);

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

  const openPreview = ({ anchor, card }) => {
    const originElement = getOriginElement(card, anchor);
    const originRect = originElement.getBoundingClientRect();
    const root = createPlayer({
      url: anchor.href,
      poster: getPosterUrl(card)
    });
    const ui = {
      dialog: root.querySelector(".simpl-youtube-preview-dialog"),
      media: root.querySelector(".simpl-youtube-preview-media"),
      status: root.querySelector(".simpl-youtube-preview-status-text"),
      fallbackOpen: root.querySelector(".simpl-youtube-preview-fallback-open"),
      close: root.querySelector(".simpl-youtube-preview-close"),
      controls: root.querySelector(".simpl-youtube-preview-controls"),
      play: root.querySelector(".simpl-youtube-preview-play"),
      time: root.querySelector(".simpl-youtube-preview-time"),
      timeline: root.querySelector(".simpl-youtube-preview-timeline"),
      mute: root.querySelector(".simpl-youtube-preview-mute"),
      volume: root.querySelector(".simpl-youtube-preview-volume"),
      cc: root.querySelector(".simpl-youtube-preview-cc"),
      speedButton: root.querySelector(".simpl-youtube-preview-speed-button"),
      speedMenu: root.querySelector(".simpl-youtube-preview-speed-menu"),
      speed: root.querySelector(".simpl-youtube-preview-speed"),
      pip: root.querySelector(".simpl-youtube-preview-pip"),
      fullscreen: root.querySelector(".simpl-youtube-preview-fullscreen")
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
      waitTimer: null,
      controlsTimer: null,
      video: null,
      playerNode: null,
      captionHost: null,
      nativeCaptionButton: null,
      originalVideo: null,
      originalPlayer: null,
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
    document.addEventListener(CAPTIONS_STATE_EVENT, (event) => {
      if (activeSession !== session || session.closing) {
        return;
      }
      const available = event.detail?.available === true;
      const pressed = event.detail?.enabled === true;
      session.nativeCaptionButton = nativeCaptionButtonFor(session.video, session.captionHost);
      ui.cc.disabled = !available && !(session.video?.textTracks?.length > 0);
      ui.cc.dataset.active = String(pressed);
      ui.cc.setAttribute("aria-pressed", String(pressed));
    }, { signal });
    ui.close.addEventListener("click", () => closePreview(session), { signal });
    ui.fallbackOpen.addEventListener("click", () => closePreview(session, session.url), { signal });
    root.querySelector(".simpl-youtube-preview-backdrop").addEventListener(
      "click",
      () => closePreview(session),
      { signal }
    );
    ui.play.addEventListener("click", () => togglePlayback(session), { signal });
    ui.timeline.addEventListener("input", () => {
      const duration = session.video?.duration;
      if (Number.isFinite(duration) && duration > 0) {
        session.video.currentTime = duration * (Number(ui.timeline.value) / 1000);
      }
    }, { signal });
    ui.mute.addEventListener("click", () => {
      if (session.video) {
        session.userSetMute = true;
        session.video.muted = !session.video.muted;
      }
    }, { signal });
    ui.volume.addEventListener("input", () => {
      if (session.video) {
        session.userSetMute = true;
        session.video.volume = Number(ui.volume.value);
        session.video.muted = session.video.volume === 0;
      }
    }, { signal });
    ui.cc.addEventListener("click", () => toggleCaptions(session), { signal });
    ui.speedButton.addEventListener("click", () => {
      ui.speedMenu.hidden = !ui.speedMenu.hidden;
      ui.speedButton.setAttribute("aria-expanded", String(!ui.speedMenu.hidden));
      setControlsVisible(session, true);
    }, { signal });
    ui.speed.addEventListener("change", () => {
      if (!session.video) {
        return;
      }
      const value = Number(ui.speed.value);
      session.video.playbackRate = value;
    }, { signal });
    ui.pip.addEventListener("click", () => {
      if (!session.video) {
        return;
      }
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture?.().catch(() => {});
      } else {
        session.video.requestPictureInPicture?.().catch(() => {});
      }
    }, { signal });
    ui.fullscreen.addEventListener("click", () => setFullscreen(session), { signal });
    ui.media.addEventListener("mousemove", () => setControlsVisible(session, true), { signal });
    ui.media.addEventListener("mouseleave", () => setControlsVisible(session, false), { signal });
    ui.media.addEventListener("click", (event) => {
      if (
        !session.video ||
        event.target.closest("button, input, select, .simpl-youtube-preview-speed-menu")
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      togglePlayback(session);
    }, { capture: true, signal });
    ui.media.addEventListener("dblclick", (event) => {
      if (!event.target.closest(".simpl-youtube-preview-controls")) {
        event.preventDefault();
        setFullscreen(session);
      }
    }, { capture: true, signal });
    document.addEventListener("fullscreenchange", () => setControlsVisible(session, true), { signal });

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
    const editing = event.target.matches?.("input, select, textarea");
    if (event.key === "Escape") {
      event.preventDefault();
      if (!session.ui.speedMenu.hidden) {
        session.ui.speedMenu.hidden = true;
        session.ui.speedButton.setAttribute("aria-expanded", "false");
      } else if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        closePreview(session);
      }
      return;
    }
    if (editing || !session.video) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === " " || key === "k") {
      event.preventDefault();
      togglePlayback(session);
    } else if (key === "j" || event.key === "ArrowLeft") {
      event.preventDefault();
      session.video.currentTime = Math.max(0, session.video.currentTime - (key === "j" ? 10 : 5));
    } else if (key === "l" || event.key === "ArrowRight") {
      event.preventDefault();
      session.video.currentTime = Math.min(session.video.duration || Infinity, session.video.currentTime + (key === "l" ? 10 : 5));
    } else if (key === "m") {
      event.preventDefault();
      session.userSetMute = true;
      session.video.muted = !session.video.muted;
    } else if (key === "c" && !session.ui.cc.disabled) {
      event.preventDefault();
      toggleCaptions(session);
    } else if (key === "f") {
      event.preventDefault();
      setFullscreen(session);
    }
  };

  const onStorageChanged = (changes, area) => {
    if (area !== "local" || !changes[SETTING_KEY]) {
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
  getSetting().then((value) => {
    enabled = value;
  });
})();
