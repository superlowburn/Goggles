import type { ExtensionMessage, PolicyContext, SiteMode } from "../shared/media-types";
import { isCanonicalSubredditName, isSiteMode } from "../shared/site-policy";
import {
  hasEnabledBlockedSubjects,
  type BlockedSubjectsConfig,
} from "../shared/blocked-subjects";

type PopupTab = { id?: number | undefined; url?: string | undefined };

export interface PopupChromeApi {
  tabs: {
    query(queryInfo: { active: true; currentWindow: true }): Promise<PopupTab[]>;
  };
  runtime: {
    sendMessage(message: ExtensionMessage): Promise<unknown>;
    openOptionsPage(): Promise<void>;
  };
}

const TITLE = "Goggles";
const SAVE_ERROR = "Could not update protection. Try again.";
const ROUTE_ERROR = "Reddit changed communities. Reopen Goggles and try again.";
const START_ERROR = "Protection settings are unavailable on this page.";

function hasValidRedditContext(value: PolicyContext): boolean {
  if (value.reddit === undefined) return true;
  return (
    typeof value.reddit === "object" &&
    value.reddit !== null &&
    typeof value.reddit.displayName === "string" &&
    isCanonicalSubredditName(value.reddit.canonicalName) &&
    (value.reddit.inheritedMode === "protected" || value.reddit.inheritedMode === "trusted") &&
    typeof value.reddit.hasOverride === "boolean" &&
    (value.mode === "protected" || value.mode === "trusted")
  );
}

function isPolicyContext(value: unknown): value is PolicyContext {
  const context = value as PolicyContext;
  return (
    typeof value === "object" &&
    value !== null &&
    "origin" in value &&
    typeof value.origin === "string" &&
    "mode" in value &&
    isSiteMode(value.mode) &&
    hasValidRedditContext(context)
  );
}

function isBlockedSubjectsConfig(value: unknown): value is BlockedSubjectsConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    (("subjects" in value && Array.isArray(value.subjects)) ||
      ("enabled" in value && typeof value.enabled === "boolean" &&
        "keywords" in value && Array.isArray(value.keywords)))
  );
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

export async function mountPopup(root: HTMLElement, chromeApi: PopupChromeApi): Promise<void> {
  root.replaceChildren();
  document.title = TITLE;

  const heading = createTextElement("h1", "popup-title", TITLE);
  const site = createTextElement("p", "popup-site", "");
  const community = createTextElement("p", "popup-community", "");
  community.hidden = true;
  const protectionSwitch = createTextElement("button", "popup-switch", "");
  protectionSwitch.type = "button";
  protectionSwitch.setAttribute("role", "switch");
  const switchCopy = createTextElement("span", "popup-switch-copy", "");
  const switchTitle = createTextElement("span", "popup-switch-title", "Frost images and videos");
  const switchDescription = createTextElement(
    "span",
    "popup-switch-description",
    "",
  );
  const switchControl = createTextElement("span", "popup-switch-control", "");
  switchControl.setAttribute("aria-hidden", "true");
  switchCopy.append(switchTitle, switchDescription);
  protectionSwitch.append(switchCopy, switchControl);
  const redditContext = createTextElement("div", "popup-reddit-context", "");
  redditContext.hidden = true;
  const redditState = createTextElement("span", "popup-reddit-state", "");
  const resetSubreddit = createTextElement(
    "button",
    "popup-reset-subreddit",
    "Use Reddit setting",
  );
  resetSubreddit.type = "button";
  redditContext.append(redditState, resetSubreddit);
  const blockedSubjects = createTextElement("div", "popup-subjects", "");
  const subjectsTitle = createTextElement("span", "popup-subjects-title", "Blocked subjects");
  const subjectsState = createTextElement("span", "popup-subjects-state", "");
  const subjectsDescription = createTextElement("span", "popup-subjects-description", "");
  blockedSubjects.append(subjectsTitle, subjectsState, subjectsDescription);
  const error = createTextElement("p", "popup-error", "");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const status = createTextElement("p", "popup-status", "");
  status.setAttribute("aria-live", "polite");
  const settings = createTextElement("button", "popup-settings", "Open settings");
  settings.type = "button";
  settings.addEventListener("click", () => void chromeApi.runtime.openOptionsPage());
  root.append(
    heading,
    site,
    community,
    protectionSwitch,
    redditContext,
    error,
    status,
    blockedSubjects,
    settings,
  );

  const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  if (typeof activeTab?.id !== "number") {
    error.textContent = START_ERROR;
    error.hidden = false;
    return;
  }

  const tabId = activeTab.id;
  const initialResponse = await chromeApi.runtime.sendMessage({
    type: "policy:get-tab",
    tabId,
  });
  if (!isPolicyContext(initialResponse)) {
    error.textContent = START_ERROR;
    error.hidden = false;
    return;
  }
  if (!isBlockedSubjectsConfig(initialResponse.blockedSubjects)) {
    error.textContent = START_ERROR;
    error.hidden = false;
    return;
  }
  const subjectsEnabled = hasEnabledBlockedSubjects(initialResponse.blockedSubjects);
  subjectsState.textContent = subjectsEnabled ? "On" : "Off";
  subjectsDescription.textContent = subjectsEnabled
    ? "Stay frosted on every site."
    : "Turn on matching in Settings.";

  let hostname: string;
  try {
    hostname = new URL(initialResponse.origin).hostname;
  } catch {
    error.textContent = START_ERROR;
    error.hidden = false;
    return;
  }
  let confirmedMode: Exclude<SiteMode, "strict"> =
    initialResponse.mode === "trusted" ? "trusted" : "protected";
  let reddit = initialResponse.reddit ? { ...initialResponse.reddit } : undefined;

  const render = (): void => {
    const selectedMode = confirmedMode;
    const protectedMode = selectedMode === "protected";
    protectionSwitch.setAttribute("aria-checked", String(protectedMode));
    if (!reddit) {
      site.textContent = hostname;
      community.hidden = true;
      switchTitle.textContent = "Frost images and videos";
      protectionSwitch.removeAttribute("aria-label");
      switchDescription.textContent = protectedMode
        ? "On — click an item to reveal it."
        : "Off — ordinary media shows normally.";
      redditContext.hidden = true;
      return;
    }

    const subreddit = `r/${reddit.displayName}`;
    site.textContent = "Reddit";
    community.textContent = subreddit;
    community.hidden = false;
    switchTitle.textContent = `Frost media in ${subreddit}`;
    protectionSwitch.setAttribute("aria-label", `Frost media in ${subreddit}`);
    switchDescription.textContent = reddit.hasOverride
      ? protectedMode
        ? `On - frosted in ${subreddit}.`
        : `Off - media shows normally in ${subreddit}.`
      : `${protectedMode ? "On" : "Off"} - using your Reddit setting.`;
    redditState.textContent = `All Reddit: ${reddit.inheritedMode === "protected" ? "On" : "Off"}`;
    if (reddit.hasOverride) {
      redditContext.append(resetSubreddit);
    } else {
      resetSubreddit.remove();
    }
    redditContext.hidden = false;
  };

  const setBusy = (busy: boolean): void => {
    protectionSwitch.disabled = busy;
    protectionSwitch.setAttribute("aria-busy", String(busy));
    resetSubreddit.disabled = busy;
    resetSubreddit.setAttribute("aria-busy", String(busy));
  };

  if (reddit) {
    subjectsDescription.textContent = "Blocked subjects stay frosted here.";
  }
  render();
  protectionSwitch.addEventListener("click", async () => {
    if (protectionSwitch.disabled) return;

    const priorMode = confirmedMode;
    const priorReddit = reddit ? { ...reddit } : undefined;
    const nextMode = confirmedMode === "protected" ? "trusted" : "protected";
    let routeChanged = false;
    error.hidden = true;
    error.textContent = "";
    status.textContent = "";
    confirmedMode = nextMode;
    if (reddit) reddit.hasOverride = true;
    render();
    setBusy(true);

    try {
      const response = await chromeApi.runtime.sendMessage(reddit
        ? {
          type: "policy:set-subreddit",
          tabId,
          expectedSubreddit: reddit.canonicalName,
          mode: nextMode,
        }
        : {
          type: "policy:set-tab",
          tabId,
          mode: nextMode,
          expectedOrigin: initialResponse.origin,
        });
      routeChanged = Boolean(
        response && typeof response === "object" &&
        "error" in response && response.error === "subreddit-changed",
      );
      if (
        !isPolicyContext(response) ||
        response.mode !== nextMode ||
        response.origin !== initialResponse.origin ||
        (reddit && (
          response.reddit?.canonicalName !== reddit.canonicalName ||
          response.reddit.hasOverride !== true
        ))
      ) {
        throw new TypeError("Invalid policy response");
      }
      confirmedMode = nextMode;
      if (response.reddit) reddit = { ...response.reddit };
      render();
      if (reddit) status.textContent = `Saved for r/${reddit.displayName}.`;
    } catch {
      confirmedMode = priorMode;
      reddit = priorReddit;
      render();
      error.textContent = routeChanged ? ROUTE_ERROR : SAVE_ERROR;
      error.hidden = false;
    } finally {
      setBusy(false);
      protectionSwitch.focus();
    }
  });

  resetSubreddit.addEventListener("click", async () => {
    if (resetSubreddit.disabled || !reddit?.hasOverride) return;

    const priorMode = confirmedMode;
    const priorReddit = { ...reddit };
    let routeChanged = false;
    let resetSucceeded = false;
    error.hidden = true;
    error.textContent = "";
    status.textContent = "";
    setBusy(true);

    try {
      const response = await chromeApi.runtime.sendMessage({
        type: "policy:reset-subreddit",
        tabId,
        expectedSubreddit: reddit.canonicalName,
      });
      routeChanged = Boolean(
        response && typeof response === "object" &&
        "error" in response && response.error === "subreddit-changed",
      );
      if (
        !isPolicyContext(response) ||
        response.origin !== initialResponse.origin ||
        response.reddit?.canonicalName !== reddit.canonicalName ||
        response.reddit.hasOverride
      ) {
        throw new TypeError("Invalid policy response");
      }
      confirmedMode = response.mode === "trusted" ? "trusted" : "protected";
      reddit = { ...response.reddit };
      render();
      status.textContent = "Using your Reddit setting.";
      resetSucceeded = true;
    } catch {
      confirmedMode = priorMode;
      reddit = priorReddit;
      render();
      error.textContent = routeChanged ? ROUTE_ERROR : SAVE_ERROR;
      error.hidden = false;
    } finally {
      setBusy(false);
      (resetSucceeded ? protectionSwitch : resetSubreddit).focus();
    }
  });
}

const popupRoot = document.querySelector<HTMLElement>("#app");
if (popupRoot && typeof chrome !== "undefined") {
  void mountPopup(popupRoot, {
    tabs: { query: (queryInfo) => chrome.tabs.query(queryInfo) },
    runtime: {
      sendMessage: (message) => chrome.runtime.sendMessage(message),
      openOptionsPage: () => chrome.runtime.openOptionsPage(),
    },
  }).catch(() => {
    popupRoot.replaceChildren(createTextElement("p", "popup-error", START_ERROR));
  });
}
