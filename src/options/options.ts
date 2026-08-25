import {
  BlockedSubjectsStore,
  parseBlockedSubjects,
  uniqueKeywords,
} from "../shared/blocked-subjects";
import {
  normalizeOrigin,
  socialPlatformForOrigin,
  socialPlatforms,
  type SocialPlatformId,
} from "../shared/site-policy";

const SAVE_ERROR = "Couldn't save. Try again.";
const socialLabels: Record<SocialPlatformId, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  reddit: "Reddit",
  x: "X/Twitter",
  tiktok: "TikTok",
  threads: "Threads",
  bluesky: "Bluesky",
  youtube: "YouTube",
};

export interface OptionsChromeApi {
  runtime: {
    sendMessage(message: import("../shared/media-types").ExtensionMessage): Promise<unknown>;
  };
  storage: {
    local: {
      get(keys: null | string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
}

export async function mountOptions(
  root: HTMLElement,
  chromeApi: OptionsChromeApi,
): Promise<void> {
  const socialResponse = await chromeApi.runtime.sendMessage({ type: "policy:get-social" });
  if (!isSocialPoliciesResponse(socialResponse)) {
    throw new TypeError("Invalid social policy response");
  }
  const values = await chromeApi.storage.local.get(null);
  const blockedStore = new BlockedSubjectsStore(chromeApi.storage.local);

  const blocked = parseBlockedSubjects(values["blocked-subjects"]);
  const blockedEnabled = root.querySelector<HTMLInputElement>("#blocked-subjects-enabled");
  const blockedKeywords = root.querySelector<HTMLTextAreaElement>("#blocked-subject-keywords");
  const blockedStatus = root.querySelector<HTMLElement>("#blocked-subjects-status");
  if (blockedEnabled) blockedEnabled.checked = blocked.enabled;
  if (blockedKeywords) blockedKeywords.value = blocked.keywords.join("\n");
  const saveBlockedSubjects = (): void => {
    const config = parseBlockedSubjects({
      enabled: blockedEnabled?.checked ?? false,
      keywords: uniqueKeywords(blockedKeywords?.value.split("\n") ?? []),
    });
    if (blockedKeywords) blockedKeywords.value = config.keywords.join("\n");
    void blockedStore.set(config).then(() => {
      values["blocked-subjects"] = config;
      if (blockedStatus) blockedStatus.textContent = "Saved locally";
    });
  };
  blockedEnabled?.addEventListener("change", saveBlockedSubjects);
  blockedKeywords?.addEventListener("change", saveBlockedSubjects);

  const platforms = root.querySelector<HTMLElement>("#social-platforms");
  const platformStatus = root.querySelector<HTMLElement>("#social-platforms-status");
  platforms?.replaceChildren(...socialPlatforms.map(({ id }) => {
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.setAttribute("role", "switch");
    toggle.dataset.socialPlatform = id;
    toggle.checked = socialResponse.socialPolicies[id] !== "trusted";
    const state = document.createElement("span");
    state.className = "platform-state";
    const updateState = (): void => { state.textContent = toggle.checked ? "On" : "Off"; };
    updateState();
    const label = document.createElement("label");
    label.className = "platform-rule";
    const name = document.createElement("strong");
    name.textContent = socialLabels[id];
    label.append(name, state, toggle);
    toggle.addEventListener("change", () => {
      const prior = !toggle.checked;
      const mode = toggle.checked ? "protected" : "trusted";
      updateState();
      if (platformStatus) platformStatus.textContent = "";
      void chromeApi.runtime.sendMessage({
        type: "policy:set-social",
        platform: id,
        mode,
      }).then((response) => {
        if (!isSocialWriteResponse(response, id, mode)) {
          throw new TypeError("Invalid social policy response");
        }
      }).catch(() => {
        toggle.checked = prior;
        updateState();
        if (platformStatus) platformStatus.textContent = SAVE_ERROR;
      });
    });
    return label;
  }));

  const rules = root.querySelector<HTMLElement>("#site-rules");
  const rulesStatus = root.querySelector<HTMLElement>("#site-rules-status");
  const renderRules = (): void => {
    if (!rules) return;
    const entries = Object.entries(values).filter(([key, value]) => {
      if (!key.startsWith("site-policy:") || (value !== "protected" && value !== "strict")) {
        return false;
      }
      const origin = key.slice("site-policy:".length);
      return normalizeOrigin(origin) === origin && !socialPlatformForOrigin(origin);
    }).sort(([first], [second]) => first.localeCompare(second));
    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-rules";
      empty.textContent = "No sites are always frosted.";
      rules.replaceChildren(empty);
      return;
    }

    rules.replaceChildren(...entries.map(([key]) => {
      const origin = key.slice("site-policy:".length);
      const row = document.createElement("div");
      row.className = "site-rule";
      row.dataset.siteOrigin = origin;
      const copy = document.createElement("span");
      const host = document.createElement("strong");
      host.textContent = origin;
      const label = document.createElement("span");
      label.textContent = "Always frost images and videos";
      copy.append(host, label);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.removePolicy = key;
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        const prior = values[key];
        delete values[key];
        renderRules();
        if (rulesStatus) rulesStatus.textContent = "";
        void chromeApi.storage.local.remove(key).catch(() => {
          values[key] = prior;
          renderRules();
          if (rulesStatus) rulesStatus.textContent = SAVE_ERROR;
        });
      });
      row.append(copy, remove);
      return row;
    }));
  };
  renderRules();

  const demo = root.querySelector<HTMLElement>("#demo-media");
  const demoReveal = root.querySelector<HTMLButtonElement>("#demo-reveal");
  demoReveal?.addEventListener("click", () => {
    const revealed = demo?.classList.toggle("is-revealed") ?? false;
    demoReveal.textContent = revealed ? "Frost again" : "Click to reveal";
  });
}

function isSocialPoliciesResponse(value: unknown): value is {
  socialPolicies: Record<SocialPlatformId, "protected" | "trusted">;
} {
  if (!value || typeof value !== "object" || !("socialPolicies" in value)) return false;
  const policies = value.socialPolicies;
  return Boolean(policies) && typeof policies === "object" && socialPlatforms.every(({ id }) => {
    const mode = (policies as Record<string, unknown>)[id];
    return mode === "protected" || mode === "trusted";
  });
}

function isSocialWriteResponse(
  value: unknown,
  platform: SocialPlatformId,
  mode: "protected" | "trusted",
): value is { platform: SocialPlatformId; mode: "protected" | "trusted" } {
  return value !== null && typeof value === "object" &&
    "platform" in value && value.platform === platform &&
    "mode" in value && value.mode === mode;
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) void mountOptions(root, {
    runtime: { sendMessage: (message) => chrome.runtime.sendMessage(message) },
    storage: chrome.storage,
  });
}
