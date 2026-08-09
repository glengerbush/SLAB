(() => {
  const key = "blog-theme";
  const valid = new Set(["light", "dark", "system"]);
  let theme = "system";

  try {
    const stored = localStorage.getItem(key);
    if (stored && valid.has(stored)) theme = stored;
  } catch {
    // System theme remains the safe fallback when storage is unavailable.
  }

  const apply = (value) => {
    if (value === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  };

  apply(theme);
  document.documentElement.dataset.themeControls = "";

  const connect = () => {
    const choices = document.querySelectorAll('input[name="theme"]');
    for (const choice of choices) {
      choice.checked = choice.value === theme;
      choice.addEventListener("change", () => {
        if (!choice.checked || !valid.has(choice.value)) return;
        theme = choice.value;
        apply(theme);
        try {
          localStorage.setItem(key, theme);
        } catch {
          // The selected theme still applies for this page view.
        }
      });
    }
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", connect, { once: true });
  else connect();
})();
