(() => {
  "use strict";

  if (globalThis.__SIMPL_YOUTUBE_MAIN_LOADED__) {
    return;
  }
  globalThis.__SIMPL_YOUTUBE_MAIN_LOADED__ = true;

  const SKIP_EVENT = "simpl-youtube-skip-ad";
  const STRICT_ADS_EVENT = "simpl-youtube-strict-ads-state";
  const TOGGLE_CAPTIONS_EVENT = "simpl-youtube-toggle-captions";
  const CAPTIONS_STATE_EVENT = "simpl-youtube-captions-state";
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

  const reportCaptionState = () => {
    const button = getPreviewCaptionButton();
    document.dispatchEvent(new CustomEvent(CAPTIONS_STATE_EVENT, {
      detail: {
        available: Boolean(button),
        enabled: button?.getAttribute("aria-pressed") === "true"
      }
    }));
  };

  const togglePreviewCaptions = () => {
    const button = getPreviewCaptionButton();
    if (button) {
      try {
        nativeFocus.call(button, { preventScroll: true });
        nativeClick.call(button);
      } catch {
        // YouTube may replace the preview control while it is being activated.
      }
    }
    reportCaptionState();
    setTimeout(reportCaptionState, 80);
    setTimeout(reportCaptionState, 220);
  };

  document.addEventListener(SKIP_EVENT, skipCurrentAd, true);
  document.addEventListener(TOGGLE_CAPTIONS_EVENT, togglePreviewCaptions, true);
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
