(() => {
  "use strict";

  if (globalThis.__SIMPL_YOUTUBE_MAIN_LOADED__) {
    return;
  }
  globalThis.__SIMPL_YOUTUBE_MAIN_LOADED__ = true;

  const SKIP_EVENT = "simpl-youtube-skip-ad";
  const STRICT_ADS_EVENT = "simpl-youtube-strict-ads-state";
  const SKIP_SELECTOR = [
    "button.ytp-skip-ad-button[id^='skip-button:']",
    "button.ytp-skip-ad-button",
    "button.ytp-ad-skip-button",
    "button.ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-container button",
    ".ytp-ad-skip-button-slot button"
  ].join(",");
  const nativeClick = HTMLElement.prototype.click;
  const nativeFocus = HTMLElement.prototype.focus;
  const nativeBlur = HTMLElement.prototype.blur;
  const NativeKeyboardEvent = KeyboardEvent;
  const NativeMouseEvent = MouseEvent;
  const NativePointerEvent = PointerEvent;
  const lastClickAt = new WeakMap();
  let strictAdsEnabled = false;

  const buttonIsActionable = (button) => {
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

  const activateButton = (button) => {
    if (!buttonIsActionable(button)) {
      return false;
    }

    const now = Date.now();
    if (now - (lastClickAt.get(button) || 0) < 80) {
      return false;
    }
    lastClickAt.set(button, now);

    const rect = button.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const hitTarget = document.elementFromPoint(clientX, clientY);
    const eventTarget = hitTarget && button.contains(hitTarget)
      ? hitTarget
      : button;

    const pointerBase = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX,
      clientY,
      screenX: window.screenX + clientX,
      screenY: window.screenY + clientY
    };
    const mouseBase = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX,
      clientY,
      screenX: window.screenX + clientX,
      screenY: window.screenY + clientY
    };

    try {
      eventTarget.dispatchEvent(new NativePointerEvent("pointerover", {
        ...pointerBase,
        buttons: 0
      }));
      eventTarget.dispatchEvent(new NativeMouseEvent("mouseover", {
        ...mouseBase,
        buttons: 0
      }));
      eventTarget.dispatchEvent(new NativePointerEvent("pointermove", {
        ...pointerBase,
        buttons: 0
      }));
      eventTarget.dispatchEvent(new NativeMouseEvent("mousemove", {
        ...mouseBase,
        buttons: 0
      }));
      eventTarget.dispatchEvent(new NativePointerEvent("pointerdown", {
        ...pointerBase,
        buttons: 1
      }));
      eventTarget.dispatchEvent(new NativeMouseEvent("mousedown", {
        ...mouseBase,
        buttons: 1,
        detail: 1
      }));

      nativeFocus.call(button, { preventScroll: true });

      eventTarget.dispatchEvent(new NativePointerEvent("pointerup", {
        ...pointerBase,
        buttons: 0
      }));
      eventTarget.dispatchEvent(new NativeMouseEvent("mouseup", {
        ...mouseBase,
        buttons: 0,
        detail: 1
      }));
      eventTarget.dispatchEvent(new NativeMouseEvent("click", {
        ...mouseBase,
        buttons: 0,
        detail: 1
      }));
      nativeClick.call(button);

      button.dispatchEvent(new NativeKeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Enter",
        composed: true,
        key: "Enter"
      }));
      button.dispatchEvent(new NativeKeyboardEvent("keypress", {
        bubbles: true,
        cancelable: true,
        code: "Enter",
        composed: true,
        key: "Enter"
      }));
      button.dispatchEvent(new NativeKeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        code: "Enter",
        composed: true,
        key: "Enter"
      }));
    } catch {
      // YouTube may replace the button during the activation sequence.
    } finally {
      try {
        nativeBlur.call(button);
      } catch {
        // The button may already be gone after a successful skip.
      }
    }
    return true;
  };

  const skipCurrentAd = () => {
    if (!strictAdsEnabled) {
      return;
    }

    for (const button of document.querySelectorAll(SKIP_SELECTOR)) {
      activateButton(button);
    }
  };

  const getPreviewCaptionButton = () => (
    document.querySelector(
      "ytd-video-preview[data-simpl-preview-session='true'] .ytmClosedCaptioningButtonButton, " +
      "ytd-video-preview[data-simpl-preview-session='true'] .ytp-subtitles-button, " +
      "ytd-video-preview[active] .ytmClosedCaptioningButtonButton, " +
      "ytd-video-preview[active] .ytp-subtitles-button, " +
      "ytd-video-preview-loader ytd-video-preview .ytmClosedCaptioningButtonButton, " +
      "ytd-video-preview-loader ytd-video-preview .ytp-subtitles-button"
    )
  );

  // ---- Preview player bridge -------------------------------------------
  // The isolated-world viewer marks the moved inline player with
  // data-simpl-preview-player. Only the page world can reach YouTube's player
  // API (captions module, quality ranges, seekTo), so commands are relayed
  // here as JSON strings and answered synchronously with a result event.
  const PLAYER_COMMAND_EVENT = "simpl-youtube-player-command";
  const PLAYER_RESULT_EVENT = "simpl-youtube-player-result";
  const PLAYER_MARK_SELECTOR = "[data-simpl-preview-player='true']";
  const QUALITY_ORDER = [
    "highres", "hd2880", "hd2160", "hd1440", "hd1080", "hd720",
    "large", "medium", "small", "tiny"
  ];
  const QUALITY_HEIGHT = {
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
  let cachedCaptionTracks = [];
  let cachedCaptionVideoId = "";

  const hasPlayerApi = (candidate) => (
    Boolean(candidate) &&
    typeof candidate.getPlayerState === "function" &&
    (typeof candidate.setOption === "function" ||
      typeof candidate.getAvailableQualityLevels === "function")
  );

  const findPreviewPlayerApi = () => {
    const marked = document.querySelector(PLAYER_MARK_SELECTOR);
    if (!marked) {
      return null;
    }
    const candidates = [
      marked,
      marked.closest?.(".html5-video-player"),
      marked.querySelector?.(".html5-video-player"),
      marked.closest?.("ytd-player"),
      marked.querySelector?.("ytd-player")
    ];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (hasPlayerApi(candidate)) {
        return candidate;
      }
      try {
        const api = candidate.getPlayer?.() || candidate.player_ || null;
        if (hasPlayerApi(api)) {
          return api;
        }
      } catch {
        // ytd-player may not have created its API yet.
      }
    }
    return null;
  };

  const safeCall = (fn, fallback) => {
    try {
      const value = fn();
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  };

  const trackLabel = (track) => {
    const name = track?.displayName || track?.name;
    if (typeof name === "string") {
      return name;
    }
    if (name?.simpleText) {
      return name.simpleText;
    }
    if (Array.isArray(name?.runs)) {
      return name.runs.map((run) => run.text || "").join("");
    }
    return track?.languageName || track?.languageCode || "Captions";
  };

  const trackKey = (track) => (
    `${track?.languageCode || ""}|${track?.kind || ""}|${track?.vss_id || track?.vssId || ""}`
  );

  const readCaptionTracks = (api) => {
    // The cache only bridges the moment the captions module is loading; never
    // let it leak from one video into the next.
    const videoId = safeCall(() => api.getVideoData().video_id, "") || "";
    if (videoId !== cachedCaptionVideoId) {
      cachedCaptionVideoId = videoId;
      cachedCaptionTracks = [];
    }
    let tracks = safeCall(() => api.getOption("captions", "tracklist"), []);
    if (!Array.isArray(tracks) || tracks.length === 0) {
      const response = safeCall(() => api.getPlayerResponse(), null);
      tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    }
    if (Array.isArray(tracks) && tracks.length > 0) {
      cachedCaptionTracks = tracks;
    }
    return cachedCaptionTracks;
  };

  const currentCaptionTrack = (api) => {
    const track = safeCall(() => api.getOption("captions", "track"), null);
    return track && track.languageCode ? track : null;
  };

  const nativeCaptionButton = () => {
    const marked = document.querySelector(PLAYER_MARK_SELECTOR);
    const host = marked?.closest?.("ytd-video-preview") ||
      document.querySelector("ytd-video-preview[data-simpl-preview-session='true']");
    return (
      host?.querySelector(".ytmClosedCaptioningButtonButton, .ytp-subtitles-button") ||
      marked?.querySelector?.(".ytp-subtitles-button") ||
      getPreviewCaptionButton()
    );
  };

  const qualityLevels = (api) => {
    const data = safeCall(() => api.getAvailableQualityData(), []);
    const levels = new Map();
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item?.quality && item.quality !== "auto" && item.isPlayable !== false) {
          levels.set(item.quality, item.qualityLabel || "");
        }
      }
    }
    for (const level of safeCall(() => api.getAvailableQualityLevels(), [])) {
      if (level && level !== "auto" && !levels.has(level)) {
        levels.set(level, "");
      }
    }
    return [...levels.entries()]
      .filter(([level]) => QUALITY_HEIGHT[level])
      .sort((a, b) => QUALITY_ORDER.indexOf(a[0]) - QUALITY_ORDER.indexOf(b[0]))
      .map(([level, label]) => ({
        level,
        label: label || `${QUALITY_HEIGHT[level]}p`,
        height: QUALITY_HEIGHT[level]
      }));
  };

  // True while the player is showing an ad instead of the requested video.
  const adShowing = (api) => (
    Boolean(api.classList?.contains("ad-showing") || api.classList?.contains("ad-interrupting")) ||
    safeCall(() => api.getAdState?.(), -1) === 1
  );

  // Gets past an ad inside the viewer: press the skip button if it is there,
  // otherwise jump the (muted) ad clip to its end.
  const skipPlayerAd = (api) => {
    for (const button of api.querySelectorAll(SKIP_SELECTOR)) {
      activateButton(button);
    }
    const video = api.querySelector("video");
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      video.muted = true;
      safeCall(() => {
        video.currentTime = video.duration;
      });
    }
  };

  const playerStatus = (api) => {
    const tracks = readCaptionTracks(api);
    const current = currentCaptionTrack(api);
    const button = nativeCaptionButton();
    return {
      api: true,
      videoId: safeCall(() => api.getVideoData().video_id, "") || "",
      ad: adShowing(api),
      captions: {
        available: tracks.length > 0 || Boolean(button),
        enabled: Boolean(current) ||
          (tracks.length === 0 && button?.getAttribute("aria-pressed") === "true"),
        current: current ? trackKey(current) : "",
        tracks: tracks.map((track) => ({
          key: trackKey(track),
          label: trackLabel(track),
          languageCode: track.languageCode || "",
          auto: track.kind === "asr"
        }))
      },
      quality: {
        levels: qualityLevels(api),
        current: safeCall(() => api.getPlaybackQuality(), "") || "",
        preferred: safeCall(() => api.getPreferredQuality?.(), "") || ""
      }
    };
  };

  const chooseTrack = (tracks, { key, languageCode }) => {
    if (key) {
      const exact = tracks.find((track) => trackKey(track) === key);
      if (exact) {
        return exact;
      }
    }
    const wanted = (languageCode || navigator.language || "en").toLowerCase();
    const base = wanted.split("-")[0];
    const score = (track) => {
      const code = String(track.languageCode || "").toLowerCase();
      let value = 0;
      if (code === wanted) {
        value += 4;
      } else if (code.split("-")[0] === base) {
        value += 3;
      }
      if (track.kind !== "asr") {
        value += 1;
      }
      return value;
    };
    return [...tracks].sort((a, b) => score(b) - score(a))[0] || null;
  };

  const setCaptions = (api, { enabled, key, languageCode }) => {
    if (!enabled) {
      safeCall(() => api.setOption("captions", "track", {}));
      safeCall(() => api.unloadModule("captions"));
      if (currentCaptionTrack(api)) {
        const button = nativeCaptionButton();
        if (button?.getAttribute("aria-pressed") === "true") {
          nativeClick.call(button);
        }
      }
      return;
    }

    safeCall(() => api.loadModule("captions"));
    const tracks = readCaptionTracks(api);
    const track = chooseTrack(tracks, { key, languageCode });
    if (track) {
      const option = { languageCode: track.languageCode };
      if (track.kind) {
        option.kind = track.kind;
      }
      // Prefer the player's own tracklist object when it has one.
      const native = safeCall(() => api.getOption("captions", "tracklist"), [])
        .find?.((item) => trackKey(item) === trackKey(track));
      safeCall(() => api.setOption("captions", "track", native || option));
    } else if (typeof api.toggleSubtitlesOn === "function") {
      safeCall(() => api.toggleSubtitlesOn());
    } else {
      const button = nativeCaptionButton();
      if (button && button.getAttribute("aria-pressed") !== "true") {
        nativeClick.call(button);
      }
    }
  };

  const setQuality = (api, level) => {
    if (!level || level === "auto") {
      safeCall(() => api.setPlaybackQualityRange("auto", "auto"));
      safeCall(() => api.setPlaybackQuality("auto"));
      return;
    }
    safeCall(() => api.setPlaybackQualityRange(level, level));
    safeCall(() => api.setPlaybackQuality(level));
  };

  // Hidden thumbnail stand-ins. Only the page world can hand YouTube's own
  // renderer element its data, so the real hover preview can start for a
  // video that is not on the current page.
  const GHOST_HOST_ID = "simpl-youtube-ghosts";

  const makeGhost = (videoId, renderer) => {
    if (!/^[\w-]{11}$/.test(videoId || "") || !renderer || typeof renderer !== "object") {
      return false;
    }
    let host = document.getElementById(GHOST_HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = GHOST_HOST_ID;
      host.style.cssText = "position:fixed;left:-10000px;top:0;width:420px;height:260px;" +
        "overflow:hidden;opacity:0;pointer-events:none;";
      host.setAttribute("aria-hidden", "true");
      document.documentElement.append(host);
    }
    if (host.querySelector(`[data-simpl-ghost="${videoId}"]`)) {
      return true;
    }
    try {
      const element = document.createElement("ytd-compact-video-renderer");
      element.setAttribute("data-simpl-ghost", videoId);
      element.data = renderer;
      host.append(element);
      return true;
    } catch {
      return false;
    }
  };

  const runPlayerCommand = (raw) => {
    let command = {};
    try {
      command = JSON.parse(raw || "{}");
    } catch {
      return { ok: false };
    }
    if (command.action === "ghost") {
      return { ok: makeGhost(command.videoId, command.renderer) };
    }
    if (command.action === "ghostClear") {
      document.getElementById(GHOST_HOST_ID)?.remove();
      return { ok: true };
    }
    const api = findPreviewPlayerApi();
    if (!api) {
      if (command.action === "captions") {
        const button = nativeCaptionButton();
        if (
          button &&
          (button.getAttribute("aria-pressed") === "true") !== Boolean(command.enabled)
        ) {
          nativeClick.call(button);
        }
      }
      const button = nativeCaptionButton();
      return {
        ok: false,
        status: {
          api: false,
          captions: {
            available: Boolean(button),
            enabled: button?.getAttribute("aria-pressed") === "true",
            current: "",
            tracks: []
          },
          quality: { levels: [], current: "", preferred: "" }
        }
      };
    }

    if (command.action === "captions") {
      setCaptions(api, command);
    } else if (command.action === "quality") {
      setQuality(api, command.level);
    } else if (command.action === "audio") {
      if (command.muted) {
        safeCall(() => api.mute?.());
      } else {
        safeCall(() => api.unMute?.());
        if (Number.isFinite(command.volume)) {
          safeCall(() => api.setVolume?.(Math.round(Math.max(0, Math.min(1, command.volume)) * 100)));
        }
      }
    } else if (command.action === "skipAd") {
      if (adShowing(api)) {
        skipPlayerAd(api);
      }
    } else if (command.action === "load") {
      // Swap the moved preview player to another video in place.
      if (!/^[\w-]{11}$/.test(command.videoId || "")) {
        return { ok: false };
      }
      safeCall(() => api.unloadModule("captions"));
      cachedCaptionTracks = [];
      cachedCaptionVideoId = "";
      let started = false;
      if (typeof api.loadVideoById === "function") {
        started = safeCall(() => {
          api.loadVideoById({ videoId: command.videoId });
          return true;
        }, false);
      }
      if (!started && typeof api.loadVideoByPlayerVars === "function") {
        started = safeCall(() => {
          api.loadVideoByPlayerVars({ video_id: command.videoId });
          return true;
        }, false);
      }
      return { ok: started, status: playerStatus(api) };
    } else if (command.action === "storyboard") {
      const response = safeCall(() => api.getPlayerResponse(), null);
      return {
        ok: true,
        spec: response?.storyboards?.playerStoryboardSpecRenderer?.spec || ""
      };
    } else if (command.action === "seek" && Number.isFinite(command.seconds)) {
      safeCall(() => api.seekTo(command.seconds, true));
    }
    return { ok: true, status: playerStatus(api) };
  };

  document.addEventListener(PLAYER_COMMAND_EVENT, (event) => {
    let id = "";
    try {
      id = JSON.parse(event.detail || "{}").id || "";
    } catch {
      // Ignore malformed requests.
    }
    let result;
    try {
      result = runPlayerCommand(event.detail);
    } catch {
      result = { ok: false };
    }
    document.dispatchEvent(new CustomEvent(PLAYER_RESULT_EVENT, {
      detail: JSON.stringify({ id, ...result })
    }));
  }, true);

  // ---- Signed-in YouTube requests (save to playlist) ----------------------
  // Made from the page's own context with its ytcfg key/context, the way
  // YouTube's own code does, so the signed-in session is accepted.
  const FETCH_EVENT = "simpl-youtube-fetch";
  const FETCH_RESULT_EVENT = "simpl-youtube-fetch-result";
  const FETCH_PATHS = /^(playlist\/get_add_to_playlist|browse\/edit_playlist)$/;

  const readCookie = (name) => {
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

  const authorizationHeader = async () => {
    const stamp = Math.floor(Date.now() / 1000);
    const parts = [];
    for (const [cookie, scheme] of [
      ["SAPISID", "SAPISIDHASH"],
      ["__Secure-1PAPISID", "SAPISID1PHASH"],
      ["__Secure-3PAPISID", "SAPISID3PHASH"]
    ]) {
      const value = readCookie(cookie);
      if (value) {
        parts.push(`${scheme} ${stamp}_${await sha1Hex(`${stamp} ${value} ${location.origin}`)}`);
      }
    }
    return parts.join(" ");
  };

  document.addEventListener(FETCH_EVENT, async (event) => {
    let request = null;
    try {
      request = JSON.parse(event.detail || "{}");
    } catch {
      return;
    }
    const reply = (payload) => document.dispatchEvent(new CustomEvent(FETCH_RESULT_EVENT, {
      detail: JSON.stringify({ id: request.id, ...payload })
    }));
    try {
      if (!FETCH_PATHS.test(request.path || "")) {
        reply({ error: "request not allowed" });
        return;
      }
      const config = window.ytcfg;
      const key = config?.get?.("INNERTUBE_API_KEY");
      const context = config?.get?.("INNERTUBE_CONTEXT");
      if (!key || !context) {
        reply({ error: "ytcfg is not available" });
        return;
      }
      const headers = {
        "content-type": "application/json",
        "x-origin": location.origin,
        "x-goog-authuser": String(config.get("SESSION_INDEX") ?? 0),
        "x-youtube-client-name": String(config.get("INNERTUBE_CONTEXT_CLIENT_NAME") ?? 1),
        "x-youtube-client-version": String(config.get("INNERTUBE_CONTEXT_CLIENT_VERSION") || context.client?.clientVersion || "")
      };
      const visitor = context.client?.visitorData || config.get("VISITOR_DATA");
      if (visitor) {
        headers["x-goog-visitor-id"] = visitor;
      }
      const auth = await authorizationHeader();
      if (auth) {
        headers.authorization = auth;
      }
      const response = await fetch(`/youtubei/v1/${request.path}?key=${encodeURIComponent(key)}&prettyPrint=false`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({ context, ...(request.body || {}) })
      });
      reply({ status: response.status, text: await response.text(), signedIn: Boolean(auth) });
    } catch (error) {
      reply({ error: String(error?.message || error) });
    }
  }, true);

  document.addEventListener(SKIP_EVENT, skipCurrentAd, true);
  document.addEventListener(STRICT_ADS_EVENT, (event) => {
    strictAdsEnabled = event.detail === true;
    skipCurrentAd();
  }, true);

  const observeSkipButtons = () => {
    if (!document.documentElement) {
      return;
    }

    const observer = new MutationObserver(skipCurrentAd);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  };

  if (document.documentElement) {
    observeSkipButtons();
  } else {
    document.addEventListener("DOMContentLoaded", observeSkipButtons, {
      once: true
    });
  }

  setInterval(skipCurrentAd, 80);
})();
