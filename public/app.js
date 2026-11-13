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

  for (const input of document.querySelectorAll("input.secret-url-input")) {
    if (!(input instanceof HTMLInputElement)) continue;
    input.addEventListener("click", () => {
      input.select();
    });
  }

  for (const row of document.querySelectorAll(".gift-row.is-wrapped")) {
    const trigger = row.querySelector(".gift-inner");
    if (!(row instanceof HTMLElement) || !(trigger instanceof HTMLElement)) continue;
    row.dataset.peek = "";
    trigger.tabIndex = 0;
    trigger.setAttribute("role", "button");
    trigger.setAttribute("aria-pressed", "false");
    const toggle = () => {
      const on = row.classList.toggle("is-revealed");
      trigger.setAttribute("aria-pressed", String(on));
    };
    trigger.addEventListener("click", toggle);
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  }
})();
