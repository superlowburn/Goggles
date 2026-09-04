import {
  defaultPolicyForOrigin,
  isSiteMode,
  parseRedditCommunity,
  SitePolicyStore,
  socialPlatformForOrigin,
} from "../shared/site-policy";
import type { ExtensionMessage, PolicyContext, SiteMode } from "../shared/media-types";
import { supportedProviderUrl } from "../media/provider-frames";
import { ContentController } from "./content-controller";
import {
  BlockedSubjectsStore,
  type BlockedSubjectsConfig,
  hasEnabledBlockedSubjects,
} from "../shared/blocked-subjects";

interface ContentControllerPort {
  start(context: PolicyContext): void;
  applyMode(mode: SiteMode): void;
  applyBlockedSubjects(config: BlockedSubjectsConfig): void;
  stop(): void;
}

interface ParentLocation {
  protocol: string;
  origin: string;
}

export interface ContentBootstrapDependencies {
  href: string;
  isChildFrame: boolean;
  parentLocation: () => ParentLocation | null;
  createController: () => ContentControllerPort;
  sendMessage: (message: ExtensionMessage) => Promise<unknown>;
  getDescriptionsVisible: (origin: string) => Promise<boolean>;
  getBlockedSubjects: () => Promise<BlockedSubjectsConfig>;
  watchPolicy: (origin: string, listener: (mode: SiteMode) => void) => () => void;
  watchBlockedSubjects: (listener: (config: BlockedSubjectsConfig) => void) => () => void;
  addPageHideListener: (listener: () => void) => void;
  addNavigationListener: (listener: (href: string) => void) => () => void;
}

export async function bootstrapContentScript(
  dependencies: ContentBootstrapDependencies = productionDependencies(),
): Promise<void> {
  const page = parseUrl(dependencies.href);
  if (!page || !isEligibleDocument(page, dependencies)) return;
  if (dependencies.isChildFrame && isSupportedProviderDocument(page)) return;

  const controller = dependencies.createController();
  let stopWatching: (() => void) | null = null;
  let stopWatchingBlockedSubjects: (() => void) | null = null;
  let stopWatchingNavigation: (() => void) | null = null;
  let activePolicyScope: string | null = null;
  let latestHref = dependencies.href;
  let policyGeneration = 0;
  let navigationGeneration = 0;
  let started = false;
  let disposed = false;
  let pendingPolicyScope: string | null = null;

  dependencies.addPageHideListener(() => {
    disposed = true;
    policyGeneration += 1;
    navigationGeneration += 1;
    stopWatching?.();
    stopWatchingBlockedSubjects?.();
    stopWatchingNavigation?.();
    controller.stop();
  });

  const startDestinationPolicy = (
    policyScope: string,
    requestGeneration: number,
  ): void => {
    if (
      disposed ||
      requestGeneration !== navigationGeneration ||
      latestHref !== policyScope
    ) return;

    let currentMode = defaultPolicyForOrigin(policyScope);
    let policyUpdates = 0;
    controller.applyMode(currentMode);
    stopWatching?.();
    activePolicyScope = policyScope;
    const watcherGeneration = ++policyGeneration;
    stopWatching = dependencies.watchPolicy(policyScope, (nextMode) => {
      if (
        disposed ||
        watcherGeneration !== policyGeneration ||
        activePolicyScope !== policyScope ||
        latestHref !== policyScope
      ) return;
      policyUpdates += 1;
      if (nextMode === currentMode) return;
      currentMode = nextMode;
      controller.applyMode(nextMode);
    });

    void dependencies.sendMessage({ type: "policy:get-current" })
      .then((response) => {
        const currentPage = parseUrl(policyScope);
        if (
          disposed ||
          requestGeneration !== navigationGeneration ||
          watcherGeneration !== policyGeneration ||
          latestHref !== policyScope ||
          policyUpdates > 0 ||
          !currentPage ||
          !isPolicyContext(response) ||
          response.origin !== currentPage.origin ||
          !policyMatchesRedditScope(response, policyScope) ||
          response.mode === currentMode
        ) return;
        currentMode = response.mode;
        controller.applyMode(response.mode);
      })
      .catch(() => undefined);
  };

  if (!dependencies.isChildFrame && socialPlatformForOrigin(page.origin)?.id === "reddit") {
    stopWatchingNavigation = dependencies.addNavigationListener((policyScope) => {
      latestHref = policyScope;
      if (started && policyScope === activePolicyScope) return;
      const requestGeneration = ++navigationGeneration;
      if (!started) {
        pendingPolicyScope = policyScope;
        return;
      }
      startDestinationPolicy(policyScope, requestGeneration);
    });
  }

  try {
    const response = await dependencies.sendMessage({ type: "policy:get-current" });
    if (!isPolicyContext(response)) throw new TypeError("Invalid policy response");
    if (disposed) return;

    let currentMode = response.mode;
    let policyUpdates = 0;
    const policyScope = !dependencies.isChildFrame &&
        socialPlatformForOrigin(response.origin)?.id === "reddit"
      ? dependencies.href
      : response.origin;
    const watcherGeneration = ++policyGeneration;
    activePolicyScope = policyScope;
    stopWatching = dependencies.watchPolicy(policyScope, (mode) => {
      if (
        disposed ||
        watcherGeneration !== policyGeneration ||
        (policyScope !== response.origin && latestHref !== policyScope)
      ) return;
      policyUpdates += 1;
      currentMode = mode;
      if (started) controller.applyMode(mode);
    });
    let currentBlockedSubjects: BlockedSubjectsConfig | null = null;
    stopWatchingBlockedSubjects = dependencies.watchBlockedSubjects((config) => {
      currentBlockedSubjects = config;
      if (started) controller.applyBlockedSubjects(config);
    });

    const updatesBeforeConfirmation = policyUpdates;
    const confirmedPolicy = await dependencies.sendMessage({ type: "policy:get-current" })
      .catch(() => null);
    if (
      policyUpdates === updatesBeforeConfirmation &&
      isPolicyContext(confirmedPolicy) &&
      confirmedPolicy.origin === response.origin
    ) {
      currentMode = confirmedPolicy.mode;
    }

    const descriptionsVisible = await dependencies.getDescriptionsVisible(response.origin)
      .catch(() => false);
    const blockedSubjects = await dependencies.getBlockedSubjects()
      .catch(() => ({ enabled: false, keywords: [] }));
    currentBlockedSubjects ??= blockedSubjects;
    if (disposed) return;
    controller.start({
      ...response,
      mode: pendingPolicyScope ? defaultPolicyForOrigin(pendingPolicyScope) : currentMode,
      descriptionsVisible,
      ...(currentBlockedSubjects && hasEnabledBlockedSubjects(currentBlockedSubjects)
        ? { blockedSubjects: currentBlockedSubjects }
        : {}),
    });
    started = true;
  } catch {
    if (disposed) return;
    const origin = fallbackOrigin(page, dependencies);
    let mode = defaultPolicyForOrigin(origin);
    const policyScope = !dependencies.isChildFrame &&
        socialPlatformForOrigin(origin)?.id === "reddit"
      ? dependencies.href
      : origin;
    const watcherGeneration = ++policyGeneration;
    activePolicyScope = policyScope;
    stopWatching = dependencies.watchPolicy(policyScope, (nextMode) => {
      if (
        disposed ||
        watcherGeneration !== policyGeneration ||
        (policyScope !== origin && latestHref !== policyScope)
      ) return;
      mode = nextMode;
      if (started) controller.applyMode(nextMode);
    });
    let currentBlockedSubjects: BlockedSubjectsConfig | null = null;
    stopWatchingBlockedSubjects = dependencies.watchBlockedSubjects((config) => {
      currentBlockedSubjects = config;
      if (started) controller.applyBlockedSubjects(config);
    });
    const blockedSubjects = await dependencies.getBlockedSubjects()
      .catch(() => ({ enabled: false, keywords: [] }));
    currentBlockedSubjects ??= blockedSubjects;
    if (disposed) return;
    controller.start({
      origin,
      mode,
      ...(currentBlockedSubjects.enabled ? { blockedSubjects: currentBlockedSubjects } : {}),
    });
    started = true;
  }

  if (pendingPolicyScope) {
    startDestinationPolicy(pendingPolicyScope, navigationGeneration);
    pendingPolicyScope = null;
  }
}

function policyMatchesRedditScope(response: PolicyContext, href: string): boolean {
  const community = parseRedditCommunity(href);
  return community
    ? response.reddit?.canonicalName === community.canonicalName
    : response.reddit === undefined;
}

function productionDependencies(): ContentBootstrapDependencies {
  const store = new SitePolicyStore(chrome.storage.local, chrome.storage.onChanged);
  const blockedSubjects = new BlockedSubjectsStore(chrome.storage.local, chrome.storage.onChanged);
  return {
    href: window.location.href,
    isChildFrame: window !== window.top,
    parentLocation: () => {
      try {
        return {
          protocol: window.parent.location.protocol,
          origin: window.parent.location.origin,
        };
      } catch {
        return null;
      }
    },
    createController: () => new ContentController({
      enableSiteControl: window === window.top,
      setSiteMode: (origin, mode) => store.set(origin, mode),
      setDescriptionsVisible: (origin, visible) => store.setDescriptionsVisible(origin, visible),
      openSettings: () => chrome.runtime.sendMessage({ type: "options:open" }),
    }),
    sendMessage: (message) => chrome.runtime.sendMessage(message),
    getDescriptionsVisible: (origin) => store.getDescriptionsVisible(origin),
    getBlockedSubjects: () => blockedSubjects.get(),
    watchPolicy: (origin, listener) => store.watch(origin, listener),
    watchBlockedSubjects: (listener) => blockedSubjects.watch(listener),
    addPageHideListener: (listener) => {
      window.addEventListener("pagehide", listener, { once: true });
    },
    addNavigationListener: (listener) => addSameDocumentNavigationListener(listener),
  };
}

export function addSameDocumentNavigationListener(listener: (href: string) => void): () => void {
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  const target: EventTarget = navigation ?? window;
  const eventName = navigation ? "currententrychange" : "popstate";
  const onNavigation = () => listener(window.location.href);
  target.addEventListener(eventName, onNavigation);
  return () => target.removeEventListener(eventName, onNavigation);
}

function parseUrl(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

function isEligibleDocument(
  page: URL,
  dependencies: Pick<
    ContentBootstrapDependencies,
    "isChildFrame" | "parentLocation"
  >,
): boolean {
  if (page.protocol === "http:" || page.protocol === "https:") return true;
  if (page.href !== "about:blank" || !dependencies.isChildFrame) return false;

  const parent = dependencies.parentLocation();
  return parent?.protocol === "http:" || parent?.protocol === "https:";
}

function isSupportedProviderDocument(page: URL): boolean {
  return supportedProviderUrl(page.href) !== null;
}

function isPolicyContext(value: unknown): value is PolicyContext {
  if (!value || typeof value !== "object") return false;
  if (!("origin" in value) || !("mode" in value)) return false;
  if (typeof value.origin !== "string" || !isSiteMode(value.mode)) return false;

  const origin = parseUrl(value.origin);
  return (
    origin !== null &&
    (origin.protocol === "http:" || origin.protocol === "https:") &&
    origin.origin === value.origin
  );
}

function fallbackOrigin(
  page: URL,
  dependencies: Pick<ContentBootstrapDependencies, "parentLocation">,
): string {
  if (page.protocol === "http:" || page.protocol === "https:") return page.origin;
  return dependencies.parentLocation()?.origin ?? "null";
}

if (
  typeof chrome !== "undefined" &&
  typeof chrome.runtime?.sendMessage === "function"
) {
  void bootstrapContentScript();
}
