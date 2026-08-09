(() => {
  const root = document.currentScript?.previousElementSibling;
  if (!(root instanceof HTMLElement) || !root.matches("[data-repo]")) return;
  const frame = root.querySelector(".comments-frame");
  const consent = root.querySelector(".comments-consent");
  const status = root.querySelector(".comments-status");
  const failure = root.querySelector(".comments-failure");
  const loadButton = root.querySelector("[data-load-comments]");
  const retryButton = root.querySelector("[data-retry-comments]");
  const always = root.querySelector("[data-always-load]");
  const storageKey = `slab:comments:${location.host}:always`;
  let loaded = false;
  let loadTimer;
  const themeCss = {
    light: `
      @import url("https://giscus.app/themes/light.css");
      html, body, main { background-color: #fffcf0 !important; }
      main { --color-canvas-default: #fffcf0; }
    `,
    dark: `
      @import url("https://giscus.app/themes/dark.css");
      html, body, main { background-color: #100f0f !important; }
      main { --color-canvas-default: #100f0f; }
    `,
  };

  const preferredThemeName = () => {
    const selected = document.documentElement.dataset.theme;
    if (selected === "light" || selected === "dark") return selected;
    return matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  };
  const preferredTheme = () =>
    `data:text/css;charset=utf-8,${encodeURIComponent(
      themeCss[preferredThemeName()],
    )}`;
  const updateTheme = () => {
    const iframe = frame?.querySelector("iframe.giscus-frame");
    iframe?.contentWindow?.postMessage(
      { giscus: { setConfig: { theme: preferredTheme() } } },
      "https://giscus.app",
    );
  };
  const observeFrame = () => {
    if (!(frame instanceof HTMLElement)) return;
    const observer = new MutationObserver(() => {
      const iframe = frame.querySelector("iframe.giscus-frame");
      if (!(iframe instanceof HTMLIFrameElement)) return;
      iframe.addEventListener(
        "load",
        () => {
          clearTimeout(loadTimer);
          if (status) status.textContent = "";
          updateTheme();
        },
        { once: true },
      );
      observer.disconnect();
    });
    observer.observe(frame, { childList: true, subtree: true });
  };
  const showFailure = () => {
    clearTimeout(loadTimer);
    if (status) status.textContent = "";
    if (failure instanceof HTMLElement) failure.hidden = false;
  };
  const load = () => {
    if (loaded || !(frame instanceof HTMLElement)) return;
    loaded = true;
    if (failure instanceof HTMLElement) failure.hidden = true;
    if (status) status.textContent = "Loading comments…";
    if (always instanceof HTMLInputElement && always.checked) {
      try {
        localStorage.setItem(storageKey, "true");
      } catch {}
    }
    const script = document.createElement("script");
    script.src = "https://giscus.app/client.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.repo = root.dataset.repo ?? "";
    script.dataset.repoId = root.dataset.repoId ?? "";
    script.dataset.category = root.dataset.category ?? "";
    script.dataset.categoryId = root.dataset.categoryId ?? "";
    script.dataset.mapping = "specific";
    script.dataset.term = root.dataset.term ?? "";
    script.dataset.strict = "1";
    script.dataset.reactionsEnabled = root.dataset.reactions ?? "1";
    script.dataset.emitMetadata = "0";
    script.dataset.inputPosition = root.dataset.inputPosition ?? "bottom";
    script.dataset.theme = preferredTheme();
    script.dataset.lang = root.dataset.lang ?? "en";
    script.dataset.loading = root.dataset.lazy ?? "lazy";
    script.onerror = showFailure;
    observeFrame();
    frame.append(script);
    loadTimer = setTimeout(showFailure, 15_000);
    consent?.remove();
  };

  loadButton?.addEventListener("click", load);
  retryButton?.addEventListener("click", () => {
    loaded = false;
    clearTimeout(loadTimer);
    frame?.replaceChildren();
    load();
  });
  addEventListener("message", (event) => {
    const iframe = frame?.querySelector("iframe.giscus-frame");
    if (
      event.origin !== "https://giscus.app" ||
      !(iframe instanceof HTMLIFrameElement) ||
      event.source !== iframe.contentWindow ||
      !event.data ||
      typeof event.data !== "object" ||
      !event.data.giscus ||
      typeof event.data.giscus !== "object"
    )
      return;
    if (
      typeof event.data.giscus.error === "string" &&
      !event.data.giscus.error.includes("Discussion not found")
    )
      showFailure();
    else if (status) status.textContent = "";
  });
  new MutationObserver(updateTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener(
    "change",
    updateTheme,
  );
  let remembered = false;
  try {
    remembered = localStorage.getItem(storageKey) === "true";
  } catch {}
  if (remembered || root.dataset.requireConsent === "false") load();
})();
