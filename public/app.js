(() => {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const canCopy =
    typeof navigator !== "undefined" &&
    Boolean(navigator.clipboard && typeof navigator.clipboard.writeText === "function");

  if (canShare) {
    for (const btn of document.querySelectorAll("[data-share-native]")) {
      if (!(btn instanceof HTMLElement)) continue;
      btn.hidden = false;
      btn.addEventListener("click", () => {
        const host = btn.closest("[data-share-text]");
        const text = btn.dataset.shareText ?? host?.getAttribute("data-share-text") ?? "";
        const url = btn.dataset.shareUrl ?? host?.getAttribute("data-share-url") ?? undefined;
        navigator.share({ text, url }).catch(() => {});
      });
    }
  }

  if (canCopy) {
    for (const btn of document.querySelectorAll("[data-share-copy]")) {
      if (!(btn instanceof HTMLElement)) continue;
      btn.hidden = false;
      btn.addEventListener("click", () => {
        const host = btn.closest("[data-share-text]");
        const text = btn.dataset.shareText ?? host?.getAttribute("data-share-text") ?? "";
        if (!text) return;
        navigator.clipboard
          .writeText(text)
          .then(() => {
            const copied = btn.dataset.copiedLabel;
            if (!copied) return;
            const initial = btn.dataset.initialLabel ?? btn.textContent ?? "";
            btn.dataset.initialLabel = initial;
            btn.textContent = copied;
            window.setTimeout(() => {
              btn.textContent = initial;
            }, 1600);
          })
          .catch(() => {});
      });
    }
  }
})();
