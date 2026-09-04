import type { ExtensionMessage, PolicyContext } from "../shared/media-types";
import {
  isSiteMode,
  isCanonicalSubredditName,
  isSubredditDisplayNameForCanonical,
  normalizeOrigin,
  parseRedditCommunity,
  prepareSocialPolicies,
  SitePolicyStore,
  socialPlatforms,
  socialPolicyKey,
  subredditDisplayKey,
  subredditPolicyKey,
  type SocialPlatformId,
} from "../shared/site-policy";
import { BlockedSubjectsStore } from "../shared/blocked-subjects";

type StorageArea = {
  get(key: null | string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(key: string | string[]): Promise<void>;
};

type Tab = { id?: number | undefined; url?: string | undefined };

type MessageSender = { tab?: Tab; id?: string; url?: string };

type WorkerDependencies = {
  storage: StorageArea;
  tabs: { get(tabId: number): Promise<Tab> };
  openOptionsPage?: () => Promise<void>;
  policyReady?: Promise<void>;
  extensionId?: string;
};

interface FirstRunRuntime {
  onInstalled: {
    addListener(listener: (details: { reason: string }) => void): void;
  };
  openOptionsPage(): Promise<void>;
}

type WorkerResponse = PolicyContext | { opened: true } | {
  error: "unsupported-page" | "invalid-message" | "origin-changed" | "subreddit-changed";
} | { socialPolicies: Record<SocialPlatformId, "protected" | "trusted"> }
  | { platform: SocialPlatformId; mode: "protected" | "trusted" }
  | {
    subredditPolicies: Array<{
      canonicalName: string;
      displayName: string;
      mode: "protected" | "trusted";
    }>;
  }
  | { canonicalName: string; removed: true };

function isSocialPlatformId(value: unknown): value is SocialPlatformId {
  return typeof value === "string" && socialPlatforms.some(({ id }) => id === value);
}

function isTabId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOptionsSender(sender: MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === "chrome-extension:" &&
      url.hostname === extensionId &&
      (url.pathname === "/options/options.html" ||
        url.pathname === "/dist/options/options.html");
  } catch {
    return false;
  }
}

function isExtensionMessage(message: unknown): message is ExtensionMessage {
  if (!message || typeof message !== "object" || !("type" in message)) return false;

  switch (message.type) {
    case "policy:get-current":
    case "policy:get-social":
    case "policy:list-subreddits":
      return true;
    case "options:open":
      return true;
    case "policy:get-tab":
      return "tabId" in message && isTabId(message.tabId);
    case "policy:set-tab":
      return (
        "tabId" in message &&
        isTabId(message.tabId) &&
        "mode" in message &&
        isSiteMode(message.mode) &&
        "expectedOrigin" in message &&
        typeof message.expectedOrigin === "string"
      );
    case "policy:set-social":
      return (
        "platform" in message &&
        isSocialPlatformId(message.platform) &&
        "mode" in message &&
        (message.mode === "protected" || message.mode === "trusted")
      );
    case "policy:set-subreddit":
      return (
        "tabId" in message &&
        isTabId(message.tabId) &&
        "expectedSubreddit" in message &&
        isCanonicalSubredditName(message.expectedSubreddit) &&
        "mode" in message &&
        (message.mode === "protected" || message.mode === "trusted")
      );
    case "policy:reset-subreddit":
      return (
        "tabId" in message &&
        isTabId(message.tabId) &&
        "expectedSubreddit" in message &&
        isCanonicalSubredditName(message.expectedSubreddit)
      );
    case "policy:reset-subreddit-setting":
      return "canonicalName" in message && isCanonicalSubredditName(message.canonicalName);
    default:
      return false;
  }
}

function originFor(tab?: Tab): string | undefined {
  return tab?.url ? normalizeOrigin(tab.url) ?? undefined : undefined;
}

async function contextFor(
  tab: Tab | undefined,
  store: SitePolicyStore,
  blockedSubjectsStore: BlockedSubjectsStore,
): Promise<WorkerResponse> {
  const origin = originFor(tab);
  if (!origin) return { error: "unsupported-page" };

  const policy = await store.resolve(tab?.url ?? origin);

  return {
    origin,
    ...policy,
    blockedSubjects: await blockedSubjectsStore.get(),
  };
}

export async function handleExtensionMessage(
  message: unknown,
  sender: MessageSender,
  deps: WorkerDependencies,
): Promise<WorkerResponse> {
  if (!isExtensionMessage(message)) return { error: "invalid-message" };
  if (
    (
      message.type === "policy:get-social" ||
      message.type === "policy:set-social" ||
      message.type === "policy:list-subreddits" ||
      message.type === "policy:reset-subreddit-setting"
    ) &&
    !isOptionsSender(sender, deps.extensionId ?? chrome.runtime.id)
  ) {
    return { error: "invalid-message" };
  }

  await (deps.policyReady ?? prepareSocialPolicies(deps.storage));

  const store = new SitePolicyStore(deps.storage);
  const blockedSubjectsStore = new BlockedSubjectsStore(deps.storage);

  switch (message.type) {
    case "options:open":
      await (deps.openOptionsPage ?? (() => chrome.runtime.openOptionsPage()))();
      return { opened: true };
    case "policy:get-current":
      return contextFor(sender.tab, store, blockedSubjectsStore);
    case "policy:get-social": {
      const keys = socialPlatforms.map(({ id }) => socialPolicyKey(id));
      const values = await deps.storage.get(keys);
      return {
        socialPolicies: Object.fromEntries(socialPlatforms.map(({ id }) => [
          id,
          values[socialPolicyKey(id)] === "trusted" ? "trusted" : "protected",
        ])) as Record<SocialPlatformId, "protected" | "trusted">,
      };
    }
    case "policy:set-social":
      await deps.storage.set({ [socialPolicyKey(message.platform)]: message.mode });
      return { platform: message.platform, mode: message.mode };
    case "policy:list-subreddits": {
      const prefix = subredditPolicyKey("");
      const values = await deps.storage.get(null);
      const subredditPolicies = Object.entries(values).flatMap(([
        key,
        value,
      ]): Array<{
        canonicalName: string;
        displayName: string;
        mode: "protected" | "trusted";
      }> => {
        const canonicalName = key.startsWith(prefix) ? key.slice(prefix.length) : "";
        const displayName = values[subredditDisplayKey(canonicalName)];
        return isCanonicalSubredditName(canonicalName) &&
          (value === "protected" || value === "trusted")
          ? [{
            canonicalName,
            displayName: isSubredditDisplayNameForCanonical(displayName, canonicalName)
              ? displayName
              : canonicalName,
            mode: value,
          }]
          : [];
      }).sort((first, second) => first.canonicalName.localeCompare(second.canonicalName));
      return { subredditPolicies };
    }
    case "policy:reset-subreddit-setting":
      await deps.storage.remove?.([
        subredditPolicyKey(message.canonicalName),
        subredditDisplayKey(message.canonicalName),
      ]);
      return { canonicalName: message.canonicalName, removed: true };
    case "policy:get-tab":
      return contextFor(await deps.tabs.get(message.tabId), store, blockedSubjectsStore);
    case "policy:set-tab": {
      const origin = originFor(await deps.tabs.get(message.tabId));
      if (!origin) return { error: "unsupported-page" };
      if (origin !== message.expectedOrigin) return { error: "origin-changed" };

      await store.set(origin, message.mode);
      return { origin, mode: message.mode === "strict" ? "protected" : message.mode };
    }
    case "policy:set-subreddit":
    case "policy:reset-subreddit": {
      const tab = await deps.tabs.get(message.tabId);
      const community = tab.url ? parseRedditCommunity(tab.url) : null;
      if (community?.canonicalName !== message.expectedSubreddit) {
        return { error: "subreddit-changed" };
      }

      if (message.type === "policy:set-subreddit") {
        await store.setSubreddit(community.canonicalName, message.mode, community.displayName);
      } else {
        await store.resetSubreddit(community.canonicalName);
      }
      return contextFor(tab, store, blockedSubjectsStore);
    }
  }
}

export function installFirstRun(runtime: FirstRunRuntime, storage?: StorageArea): void {
  runtime.onInstalled.addListener(({ reason }) => {
    if (storage) void prepareSocialPolicies(storage);
    if (reason === "install") void runtime.openOptionsPage();
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleExtensionMessage(message, sender, {
    storage: chrome.storage.local,
    tabs: chrome.tabs,
    openOptionsPage: () => chrome.runtime.openOptionsPage(),
    policyReady: productionPolicyReady,
    extensionId: chrome.runtime.id,
  }).then(sendResponse);
  return true;
});

const productionPolicyReady = prepareSocialPolicies(chrome.storage.local);
if (chrome.runtime.onInstalled) installFirstRun(chrome.runtime, chrome.storage.local);
