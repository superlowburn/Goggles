import {
  BlockedSubjectsStore,
  parseBlockedSubjects,
  suggestSubjectKeywords,
  uniqueKeywords,
} from "../shared/blocked-subjects";
import {
  isCanonicalSubredditName,
  isSubredditDisplayNameForCanonical,
  normalizeOrigin,
  socialPlatformForOrigin,
  socialPlatforms,
  type SocialPlatformId,
} from "../shared/site-policy";

const SAVE_ERROR = "Couldn't save. Try again.";

function announceStatus(
  element: HTMLElement | null,
  message: string,
  urgent = false,
): void {
  if (!element) return;
  element.textContent = message;
  element.setAttribute("aria-live", urgent ? "assertive" : "polite");
  if (urgent) element.setAttribute("role", "alert");
  else element.removeAttribute("role");
}
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
  const subredditResponse = await chromeApi.runtime.sendMessage({
    type: "policy:list-subreddits",
  });
  if (!isSubredditPoliciesResponse(subredditResponse)) {
    throw new TypeError("Invalid subreddit policy response");
  }
  const values = await chromeApi.storage.local.get(null);
  const blockedStore = new BlockedSubjectsStore(chromeApi.storage.local);

  let blocked = parseBlockedSubjects(values["blocked-subjects"]);
  const blockedStatus = root.querySelector<HTMLElement>("#blocked-subjects-status");
  const subjectList = root.querySelector<HTMLElement>("#subject-list");
  const saveBlockedSubjects = (): void => {
    void blockedStore.set(blocked).then(() => {
      values["blocked-subjects"] = blocked;
      announceStatus(blockedStatus, "Saved locally");
    });
  };
  const renderSubjects = (): void => {
    if (!subjectList) return;
    subjectList.replaceChildren(...(blocked.subjects ?? []).map((subject, index) => {
      const card = document.createElement("div");
      card.className = "subject-card";

      const toggle = document.createElement("label");
      toggle.className = "subject-toggle";
      const toggleId = index === 0 ? "blocked-subjects-enabled" : `blocked-subject-${index}-enabled`;
      toggle.htmlFor = toggleId;
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = subject.name;
      const hint = document.createElement("small");
      hint.textContent = "Frost likely matches";
      copy.append(title, hint);
      const enabled = document.createElement("input");
      enabled.id = toggleId;
      enabled.type = "checkbox";
      enabled.checked = subject.enabled;
      enabled.addEventListener("change", () => {
        subject.enabled = enabled.checked;
        saveBlockedSubjects();
      });
      toggle.append(copy, enabled);

      const details = document.createElement("details");
      details.className = "keyword-editor";
      const summary = document.createElement("summary");
      summary.textContent = "Matching words";
      const keywordLabel = document.createElement("label");
      const keywordId = index === 0 ? "blocked-subject-keywords" : `blocked-subject-${index}-keywords`;
      keywordLabel.htmlFor = keywordId;
      const keywordHint = document.createElement("span");
      keywordHint.textContent = "One phrase per line.";
      const keywords = document.createElement("textarea");
      keywords.id = keywordId;
      keywords.rows = 7;
      keywords.spellcheck = false;
      keywords.value = subject.keywords.join("\n");
      keywords.addEventListener("change", () => {
        subject.keywords = uniqueKeywords(keywords.value.split("\n"));
        keywords.value = subject.keywords.join("\n");
        saveBlockedSubjects();
      });
      keywordLabel.append(keywordHint, keywords);
      details.append(summary, keywordLabel);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove-subject";
      remove.textContent = "Remove subject";
      remove.addEventListener("click", () => {
        blocked.subjects?.splice(index, 1);
        blocked = parseBlockedSubjects(blocked);
        renderSubjects();
        saveBlockedSubjects();
      });
      card.append(toggle, details, remove);
      return card;
    }));
  };
  renderSubjects();

  const newSubjectName = root.querySelector<HTMLInputElement>("#new-subject-name");
  const suggestions = root.querySelector<HTMLElement>("#subject-suggestions");
  root.querySelector<HTMLButtonElement>("#suggest-subject")?.addEventListener("click", () => {
    const keywords = suggestSubjectKeywords(newSubjectName?.value ?? "");
    if (!suggestions || keywords.length === 0) return;
    const heading = document.createElement("strong");
    heading.textContent = "Suggested matching words";
    const choices = keywords.map((keyword, index) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = index === 0;
      input.value = keyword;
      label.append(input, document.createTextNode(keyword));
      return label;
    });
    const add = document.createElement("button");
    add.id = "add-subject";
    add.type = "button";
    add.textContent = "Add subject";
    add.addEventListener("click", () => {
      const selected = Array.from(suggestions.querySelectorAll<HTMLInputElement>("input:checked"))
        .map((input) => input.value);
      if (selected.length === 0) return;
      blocked.subjects?.push({ name: keywords[0]!, enabled: true, keywords: selected });
      renderSubjects();
      saveBlockedSubjects();
      suggestions.hidden = true;
      suggestions.replaceChildren();
      if (newSubjectName) newSubjectName.value = "";
    });
    suggestions.replaceChildren(heading, ...choices, add);
    suggestions.hidden = false;
  });

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
      announceStatus(platformStatus, "");
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
        announceStatus(platformStatus, SAVE_ERROR, true);
      });
    });
    return label;
  }));

  let subredditPolicies = [...subredditResponse.subredditPolicies]
    .sort((first, second) => first.canonicalName.localeCompare(second.canonicalName));
  const subredditExceptions = root.querySelector<HTMLElement>("#subreddit-exceptions");
  const subredditList = root.querySelector<HTMLElement>("#subreddit-exceptions-list");
  const subredditStatus = root.querySelector<HTMLElement>("#subreddit-exceptions-status");
  let pendingSubredditReset: string | null = null;
  const updateSubredditBusyState = (): void => {
    subredditList?.querySelectorAll<HTMLButtonElement>("[data-reset-subreddit]")
      .forEach((button) => {
        button.disabled = pendingSubredditReset !== null;
        if (button.dataset.resetSubreddit === pendingSubredditReset) {
          button.setAttribute("aria-busy", "true");
        } else {
          button.removeAttribute("aria-busy");
        }
      });
  };
  const renderSubredditPolicies = (): void => {
    if (!subredditExceptions || !subredditList) return;
    subredditExceptions.hidden = subredditPolicies.length === 0;
    subredditList.replaceChildren(...subredditPolicies.map(({
      canonicalName,
      displayName,
      mode,
    }) => {
      const row = document.createElement("div");
      row.className = "subreddit-rule";
      row.dataset.subredditPolicy = canonicalName;
      const name = document.createElement("strong");
      name.textContent = `r/${displayName}`;
      const state = document.createElement("span");
      state.className = "subreddit-state";
      state.textContent = mode === "protected" ? "On" : "Off";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.dataset.resetSubreddit = canonicalName;
      reset.textContent = "Use Reddit setting";
      reset.setAttribute("aria-label", `Use Reddit setting for r/${displayName}`);
      reset.addEventListener("click", () => {
        if (pendingSubredditReset !== null) return;
        pendingSubredditReset = canonicalName;
        updateSubredditBusyState();
        announceStatus(subredditStatus, "");
        void chromeApi.runtime.sendMessage({
          type: "policy:reset-subreddit-setting",
          canonicalName,
        }).then((response) => {
          if (!isSubredditResetResponse(response, canonicalName)) {
            throw new TypeError("Invalid subreddit reset response");
          }
          subredditPolicies = subredditPolicies.filter((policy) => (
            policy.canonicalName !== canonicalName
          ));
          pendingSubredditReset = null;
          renderSubredditPolicies();
          announceStatus(subredditStatus, `Using Reddit setting for r/${displayName}.`);
          root.querySelector<HTMLInputElement>('[data-social-platform="reddit"]')?.focus();
        }).catch(() => {
          pendingSubredditReset = null;
          renderSubredditPolicies();
          announceStatus(subredditStatus, SAVE_ERROR, true);
          subredditList.querySelector<HTMLButtonElement>(
            `[data-reset-subreddit="${canonicalName}"]`,
          )?.focus();
        });
      });
      row.append(name, state, reset);
      return row;
    }));
    updateSubredditBusyState();
  };
  renderSubredditPolicies();

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
        announceStatus(rulesStatus, "");
        void chromeApi.storage.local.remove(key).catch(() => {
          values[key] = prior;
          renderRules();
          announceStatus(rulesStatus, SAVE_ERROR, true);
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

function isSubredditPoliciesResponse(value: unknown): value is {
  subredditPolicies: Array<{
    canonicalName: string;
    displayName: string;
    mode: "protected" | "trusted";
  }>;
} {
  if (!value || typeof value !== "object" || !("subredditPolicies" in value)) return false;
  return Array.isArray(value.subredditPolicies) && value.subredditPolicies.every((policy) => (
    policy !== null &&
    typeof policy === "object" &&
    "canonicalName" in policy &&
    isCanonicalSubredditName(policy.canonicalName) &&
    "displayName" in policy &&
    isSubredditDisplayNameForCanonical(policy.displayName, policy.canonicalName) &&
    "mode" in policy &&
    (policy.mode === "protected" || policy.mode === "trusted")
  ));
}

function isSubredditResetResponse(
  value: unknown,
  canonicalName: string,
): value is { canonicalName: string; removed: true } {
  return value !== null && typeof value === "object" &&
    "canonicalName" in value && value.canonicalName === canonicalName &&
    "removed" in value && value.removed === true;
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) void mountOptions(root, {
    runtime: { sendMessage: (message) => chrome.runtime.sendMessage(message) },
    storage: chrome.storage,
  });
}
