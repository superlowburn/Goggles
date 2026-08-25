import type { ExtensionMessage, PolicyContext } from "../shared/media-types";
import {
  isSiteMode,
  normalizeOrigin,
  prepareSocialPolicies,
  SitePolicyStore,
  socialPlatforms,
  socialPolicyKey,
  type SocialPlatformId,
} from "../shared/site-policy";
import { BlockedSubjectsStore } from "../shared/blocked-subjects";

type StorageArea = {
  get(key: null | string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
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
  error: "unsupported-page" | "invalid-message" | "origin-changed";
} | { socialPolicies: Record<SocialPlatformId, "protected" | "trusted"> }
  | { platform: SocialPlatformId; mode: "protected" | "trusted" };

function isSocialPlatformId(value: unknown): value is SocialPlatformId {
  return typeof value === "string" && socialPlatforms.some(({ id }) => id === value);
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
      return true;
    case "options:open":
      return true;
    case "policy:get-tab":
      return "tabId" in message && typeof message.tabId === "number";
    case "policy:set-tab":
      return (
        "tabId" in message &&
        typeof message.tabId === "number" &&
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

  return {
    origin,
    mode: await store.get(origin),
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
    (message.type === "policy:get-social" || message.type === "policy:set-social") &&
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
    case "policy:get-tab":
      return contextFor(await deps.tabs.get(message.tabId), store, blockedSubjectsStore);
    case "policy:set-tab": {
      const origin = originFor(await deps.tabs.get(message.tabId));
      if (!origin) return { error: "unsupported-page" };
      if (origin !== message.expectedOrigin) return { error: "origin-changed" };

      await store.set(origin, message.mode);
      return { origin, mode: message.mode === "strict" ? "protected" : message.mode };
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
