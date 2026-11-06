// HeroUI picks its theme from a class and data-theme on <html> rather than from
// the system setting, so this sets both from prefers-color-scheme and keeps them
// in sync. It runs before the page paints, so there's no flash of the wrong theme.
export const THEME_SCRIPT = `(() => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const theme = media.matches ? "dark" : "light";
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  };
  apply();
  media.addEventListener("change", apply);
})();`
