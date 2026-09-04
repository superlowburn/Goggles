const supportedProviders = [
  { host: "www.youtube.com", path: /^\/embed\/[^/]+$/ },
  { host: "www.youtube-nocookie.com", path: /^\/embed\/[^/]+$/ },
  { host: "player.vimeo.com", path: /^\/video\/[^/]+$/ },
] as const;

export function isSupportedVideoFrame(element: Element): element is HTMLIFrameElement {
  if (!(element instanceof HTMLIFrameElement)) return false;

  const source = element.getAttribute("src");
  if (!source) return false;

  try {
    return supportedProviderUrl(element.src, document.baseURI) !== null;
  } catch {
    return false;
  }
}

export function supportedProviderUrl(source: string, base = "https://invalid.local/"): URL | null {
  try {
    const url = new URL(source, base);
    return url.protocol === "https:" && supportedProviders.some(
      ({ host, path }) => url.hostname === host && path.test(url.pathname),
    ) ? url : null;
  } catch {
    return null;
  }
}
