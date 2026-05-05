export const SHELL_MOBILE_MAX_WIDTH = 1180;
export const HOME_TIMELINE_MOBILE_MAX_WIDTH = 900;

export const buildMaxWidthMediaQuery = (maxWidth: number) => `(max-width: ${maxWidth}px)`;

export const SHELL_MOBILE_MEDIA_QUERY = buildMaxWidthMediaQuery(SHELL_MOBILE_MAX_WIDTH);

const canUseMatchMedia = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

export const detectShellMobileLayout = () =>
  canUseMatchMedia() ? window.matchMedia(SHELL_MOBILE_MEDIA_QUERY).matches : false;

export const observeShellMobileLayout = (onChange: (matches: boolean) => void) => {
  if (!canUseMatchMedia()) {
    return () => {};
  }

  const mediaQueryList = window.matchMedia(SHELL_MOBILE_MEDIA_QUERY);
  const handleChange = (event: MediaQueryListEvent) => {
    onChange(event.matches);
  };

  onChange(mediaQueryList.matches);
  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }

  mediaQueryList.addListener(handleChange);
  return () => mediaQueryList.removeListener(handleChange);
};
