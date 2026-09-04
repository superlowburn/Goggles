import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { mountOptions, type OptionsChromeApi } from "../../src/options/options";
import { handleExtensionMessage } from "../../src/background/service-worker";
import {
  policyKey,
  prepareSocialPolicies,
  socialPlatforms,
  socialPolicyKey,
  subredditDisplayKey,
  subredditPolicyKey,
} from "../../src/shared/site-policy";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function chromeApi(initial: Record<string, unknown>): OptionsChromeApi & {
  state: Record<string, unknown>;
} {
  const state = { ...initial };
  return {
    state,
    runtime: {
      sendMessage: vi.fn(async (message: {
        type: string;
        platform?: string;
        mode?: string;
        canonicalName?: string;
      }) => {
        if (message.type === "policy:get-social") {
          return {
            socialPolicies: Object.fromEntries(socialPlatforms.map(({ id }) => [
              id,
              state[socialPolicyKey(id)] === "trusted" ? "trusted" : "protected",
            ])),
          };
        }
        if (message.type === "policy:set-social" && message.platform && message.mode) {
          state[`social-policy:${message.platform}`] = message.mode;
          return { platform: message.platform, mode: message.mode };
        }
        if (message.type === "policy:list-subreddits") {
          return {
            subredditPolicies: Object.entries(state).flatMap(([key, mode]) => {
              const prefix = "reddit-subreddit-policy:";
              const canonicalName = key.slice(prefix.length);
              const displayName = state[subredditDisplayKey(canonicalName)];
              return key.startsWith(prefix) && (mode === "protected" || mode === "trusted")
                ? [{
                  canonicalName,
                  displayName: typeof displayName === "string" ? displayName : canonicalName,
                  mode,
                }]
                : [];
            }),
          };
        }
        if (message.type === "policy:reset-subreddit-setting" && message.canonicalName) {
          delete state[subredditPolicyKey(message.canonicalName)];
          delete state[subredditDisplayKey(message.canonicalName)];
          return { canonicalName: message.canonicalName, removed: true };
        }
        return { error: "invalid-message" };
      }),
    },
    storage: {
      local: {
        get: async () => ({ ...state }),
        set: async (items) => { Object.assign(state, items); },
        remove: async (key) => { delete state[key]; },
      },
    },
  };
}

describe("mountOptions", () => {
  beforeEach(async () => {
    const source = await readFile("src/options/options.html", "utf8");
    document.body.innerHTML = new DOMParser().parseFromString(source, "text/html").body.innerHTML;
  });

  it("keeps Blocked Subjects first and adds the two policy sections", async () => {
    const api = chromeApi({
      [policyKey("https://example.com")]: "trusted",
      [policyKey("https://frosted.example")]: "protected",
      [policyKey("https://legacy.example")]: "strict",
    });

    const root = document.querySelector<HTMLElement>("#app")!;
    await mountOptions(root, api);

    expect(root.querySelector('[data-default-mode]')).toBeNull();
    expect(root.querySelector("section h2")?.textContent).toBe("Blocked subjects");
    expect([...root.querySelectorAll("section h2")].map(({ textContent }) => textContent)).toEqual([
      "Blocked subjects",
      "Social platforms",
      "Sites always frosted",
    ]);
    expect(root.textContent).toContain("Blocked Subjects remain frosted");
    expect(root.textContent).toContain("Best effort: Goggles may miss or misidentify images.");
    expect(document.querySelector("#site-rules")?.textContent).not.toContain("example.com");
    expect(document.querySelector("#site-rules")?.textContent).toContain("frosted.example");
    expect(document.querySelector("#site-rules")?.textContent).toContain("legacy.example");
    expect(document.querySelector("[data-remove-policy]")?.textContent).toBe("Remove");
  });

  it("renders all eight social switches in catalog order and defaults them On", async () => {
    const api = chromeApi({ [socialPolicyKey("reddit")]: "trusted" });
    await mountOptions(document.querySelector("#app")!, api);

    const switches = [...document.querySelectorAll<HTMLInputElement>("[data-social-platform]")];
    expect(switches.map(({ dataset }) => dataset.socialPlatform)).toEqual([
      "facebook", "instagram", "reddit", "x", "tiktok", "threads", "bluesky", "youtube",
    ]);
    expect(switches.map(({ labels }) => labels?.[0]?.textContent?.trim())).toEqual([
      "FacebookOn", "InstagramOn", "RedditOff", "X/TwitterOn",
      "TikTokOn", "ThreadsOn", "BlueskyOn", "YouTubeOn",
    ]);
    expect(switches.map(({ checked }) => checked)).toEqual([
      true, true, false, true, true, true, true, true,
    ]);
    expect(switches.every((toggle) => toggle.type === "checkbox" && toggle.getAttribute("role") === "switch"))
      .toBe(true);
  });

  it("hides subreddit exceptions when no override exists", async () => {
    await mountOptions(document.querySelector("#app")!, chromeApi({}));

    expect(document.querySelector<HTMLElement>("#subreddit-exceptions")?.hidden).toBe(true);
    expect(document.querySelectorAll("[data-subreddit-policy]")).toHaveLength(0);
  });

  it("lists subreddit exceptions below Social platforms with explicit On and Off states", async () => {
    const api = chromeApi({
      [subredditPolicyKey("typescript")]: "trusted",
      [subredditDisplayKey("typescript")]: "TypeScript",
      [subredditPolicyKey("openai")]: "protected",
      [subredditDisplayKey("openai")]: "OpenAI",
    });

    await mountOptions(document.querySelector("#app")!, api);

    const socialSection = document.querySelector("#social-platforms")?.closest("section");
    const exceptions = document.querySelector<HTMLElement>("#subreddit-exceptions")!;
    expect(exceptions.hidden).toBe(false);
    expect(socialSection?.contains(exceptions)).toBe(true);
    expect(exceptions.querySelector("h3")?.textContent).toBe("Subreddit exceptions");
    expect([...exceptions.querySelectorAll<HTMLElement>("[data-subreddit-policy]")].map((row) => [
      row.dataset.subredditPolicy,
      row.querySelector("strong")?.textContent,
      row.querySelector(".subreddit-state")?.textContent,
      row.querySelector("button")?.textContent,
      row.querySelector("button")?.getAttribute("aria-label"),
    ])).toEqual([
      ["openai", "r/OpenAI", "On", "Use Reddit setting", "Use Reddit setting for r/OpenAI"],
      [
        "typescript",
        "r/TypeScript",
        "Off",
        "Use Reddit setting",
        "Use Reddit setting for r/TypeScript",
      ],
    ]);
  });

  it("removes a subreddit exception through the Settings worker contract", async () => {
    const api = chromeApi({
      [subredditPolicyKey("openai")]: "trusted",
      [subredditDisplayKey("openai")]: "OpenAI",
    });
    await mountOptions(document.querySelector("#app")!, api);
    const sendMessage = vi.spyOn(api.runtime, "sendMessage");

    document.querySelector<HTMLButtonElement>("[data-reset-subreddit]")!.click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("#subreddit-exceptions")?.hidden).toBe(true);
    });
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "policy:reset-subreddit-setting",
      canonicalName: "openai",
    });
    expect(api.state[subredditPolicyKey("openai")]).toBeUndefined();
    expect(api.state[subredditDisplayKey("openai")]).toBeUndefined();
    expect(document.querySelector("#subreddit-exceptions-status")?.textContent).toBe(
      "Using Reddit setting for r/OpenAI.",
    );
    expect(document.querySelector("#subreddit-exceptions-status")?.getAttribute("role")).toBeNull();
    expect(document.querySelector("#subreddit-exceptions-status")?.getAttribute("aria-live"))
      .toBe("polite");
  });

  it("keeps a subreddit exception and restores its reset button when removal fails", async () => {
    const api = chromeApi({ [subredditPolicyKey("openai")]: "protected" });
    const sendMessage = vi.spyOn(api.runtime, "sendMessage");
    await mountOptions(document.querySelector("#app")!, api);
    sendMessage.mockRejectedValueOnce(new Error("worker unavailable"));
    const reset = document.querySelector<HTMLButtonElement>("[data-reset-subreddit]")!;

    reset.click();
    expect(reset.disabled).toBe(true);
    expect(reset.getAttribute("aria-busy")).toBe("true");

    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>(
      '[data-reset-subreddit="openai"]',
    )?.disabled).toBe(false));
    expect(document.querySelector("[data-subreddit-policy=\"openai\"]")).not.toBeNull();
    expect(document.querySelector("#subreddit-exceptions-status")?.textContent).toBe(
      "Couldn't save. Try again.",
    );
    expect(document.querySelector("#subreddit-exceptions-status")?.getAttribute("role"))
      .toBe("alert");
    expect(document.activeElement).toBe(document.querySelector(
      '[data-reset-subreddit="openai"]',
    ));
  });

  it("allows only one subreddit reset at a time and restores matching focus on failure", async () => {
    const api = chromeApi({
      [subredditPolicyKey("openai")]: "protected",
      [subredditDisplayKey("openai")]: "OpenAI",
      [subredditPolicyKey("typescript")]: "trusted",
      [subredditDisplayKey("typescript")]: "TypeScript",
    });
    const pending = deferred<unknown>();
    const sendMessage = vi.spyOn(api.runtime, "sendMessage");
    await mountOptions(document.querySelector("#app")!, api);
    sendMessage.mockImplementationOnce(() => pending.promise);
    const openAi = document.querySelector<HTMLButtonElement>(
      '[data-reset-subreddit="openai"]',
    )!;
    const typescript = document.querySelector<HTMLButtonElement>(
      '[data-reset-subreddit="typescript"]',
    )!;

    openAi.click();
    expect(openAi.disabled).toBe(true);
    expect(typescript.disabled).toBe(true);
    typescript.click();
    expect(sendMessage).toHaveBeenCalledTimes(3);

    pending.reject(new Error("worker unavailable"));
    await vi.waitFor(() => {
      expect(document.querySelectorAll<HTMLButtonElement>("[data-reset-subreddit]:disabled"))
        .toHaveLength(0);
    });
    expect(document.activeElement).toBe(document.querySelector(
      '[data-reset-subreddit="openai"]',
    ));
  });

  it("stacks each exception reset below its name at narrow Settings widths", async () => {
    const css = await readFile("src/options/options.css", "utf8");

    expect(css).toMatch(/\.subreddit-rule\s*\{[^}]*grid-template-columns:\s*1fr\s+auto\s+auto/s);
    expect(css).toMatch(/\.subreddit-rule strong\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.subreddit-rule button\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*\.subreddit-rule\s*\{[^}]*grid-template-columns:\s*1fr\s+auto/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*\.subreddit-rule button\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  });

  it("persists each social switch independently and rolls back failed writes inline", async () => {
    const api = chromeApi({ [socialPolicyKey("reddit")]: "trusted" });
    const sendMessage = vi.spyOn(api.runtime, "sendMessage");
    await mountOptions(document.querySelector("#app")!, api);
    const facebook = document.querySelector<HTMLInputElement>('[data-social-platform="facebook"]')!;
    const reddit = document.querySelector<HTMLInputElement>('[data-social-platform="reddit"]')!;

    facebook.checked = false;
    facebook.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(api.state[socialPolicyKey("facebook")]).toBe("trusted"));
    expect(api.state[socialPolicyKey("reddit")]).toBe("trusted");

    sendMessage.mockRejectedValueOnce(new Error("worker unavailable"));
    reddit.checked = true;
    reddit.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(reddit.checked).toBe(false));
    expect(document.querySelector("#social-platforms-status")?.textContent)
      .toBe("Couldn't save. Try again.");
    expect(document.querySelector("#social-platforms-status")?.getAttribute("role")).toBe("alert");
    expect(api.state[socialPolicyKey("reddit")]).toBe("trusted");
  });

  it("waits for the worker migration before rendering and lets the later Settings write win", async () => {
    const legacyKey = policyKey("https://old.reddit.com");
    const platformKey = socialPolicyKey("reddit");
    const state: Record<string, unknown> = { [legacyKey]: "trusted" };
    let resolveMigration!: (values: Record<string, unknown>) => void;
    let nullReads = 0;
    const storage = {
      get: vi.fn((keys: null | string | string[]) => {
        if (keys === null && nullReads++ === 0) {
          return new Promise<Record<string, unknown>>((resolve) => { resolveMigration = resolve; });
        }
        if (keys === null) return Promise.resolve({ ...state });
        const requested = Array.isArray(keys) ? keys : [keys];
        return Promise.resolve(Object.fromEntries(requested.map((key) => [key, state[key]])));
      }),
      set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(state, items); }),
      remove: vi.fn(async (key: string) => { delete state[key]; }),
    };
    const policyReady = prepareSocialPolicies(storage);
    const runtime = {
      sendMessage: vi.fn((message: unknown) => handleExtensionMessage(
        message,
        {
          id: "extension-id",
          url: "chrome-extension://extension-id/dist/options/options.html",
          tab: { id: 7, url: "chrome-extension://extension-id/dist/options/options.html" },
        },
        {
          storage,
          tabs: { get: vi.fn() },
          extensionId: "extension-id",
          policyReady,
        },
      )),
    };
    const mounting = mountOptions(document.querySelector("#app")!, {
      storage: { local: storage },
      runtime,
    });
    expect(document.querySelectorAll("[data-social-platform]")).toHaveLength(0);

    resolveMigration({ ...state });
    await mounting;
    const reddit = document.querySelector<HTMLInputElement>('[data-social-platform="reddit"]')!;
    expect(reddit.checked).toBe(false);
    expect(storage.set).toHaveBeenNthCalledWith(1, { [platformKey]: "trusted" });

    reddit.checked = true;
    reddit.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(state[platformKey]).toBe("protected"));
    expect(runtime.sendMessage).toHaveBeenLastCalledWith({
      type: "policy:set-social",
      platform: "reddit",
      mode: "protected",
    });
    expect(storage.set).toHaveBeenNthCalledWith(2, { [platformKey]: "protected" });
  });

  it("lists protected non-social exact origins in deterministic alphabetical order", async () => {
    const api = chromeApi({
      [policyKey("https://zeta.example:8443")]: "protected",
      [policyKey("http://alpha.example")]: "strict",
      [policyKey("https://middle.example")]: "trusted",
      [policyKey("https://old.reddit.com")]: "protected",
    });
    await mountOptions(document.querySelector("#app")!, api);

    expect([...document.querySelectorAll<HTMLElement>("[data-site-origin]")]
      .map(({ dataset }) => dataset.siteOrigin)).toEqual([
      "http://alpha.example",
      "https://zeta.example:8443",
    ]);
    expect(document.querySelector("#site-rules")?.textContent).not.toContain("middle.example");
    expect(document.querySelector("#site-rules")?.textContent).not.toContain("reddit.com");
  });

  it("removes a protected-site rule and restores the empty state", async () => {
    const key = policyKey("https://example.com");
    const api = chromeApi({ [key]: "protected" });
    await mountOptions(document.querySelector("#app")!, api);

    (document.querySelector("[data-remove-policy]") as HTMLButtonElement).click();
    await Promise.resolve();

    expect(key in api.state).toBe(false);
    expect(document.querySelector("#site-rules .empty-rules")).not.toBeNull();
    expect(document.querySelector("#site-rules")?.textContent).toContain("No sites are always frosted.");
  });

  it("rolls a failed protected-site removal back and announces the error inline", async () => {
    const key = policyKey("https://example.com");
    const api = chromeApi({ [key]: "protected" });
    vi.spyOn(api.storage.local, "remove").mockRejectedValueOnce(new Error("storage unavailable"));
    await mountOptions(document.querySelector("#app")!, api);

    (document.querySelector("[data-remove-policy]") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLElement>("[data-site-origin]")?.dataset.siteOrigin)
        .toBe("https://example.com");
      expect(document.querySelector("#site-rules-status")?.textContent)
        .toBe("Couldn't save. Try again.");
      expect(document.querySelector("#site-rules-status")?.getAttribute("role")).toBe("alert");
    });
    expect(api.state[key]).toBe("protected");
  });

  it("turns the onboarding demo into the revealed state", async () => {
    const api = chromeApi({});
    await mountOptions(document.querySelector("#app")!, api);

    (document.querySelector("#demo-reveal") as HTMLButtonElement).click();

    expect(document.querySelector("#demo-media")?.classList).toContain("is-revealed");
    expect(document.querySelector("#demo-reveal")?.textContent).toBe("Frost again");
  });

  it("loads and saves the editable blocked-subject preset", async () => {
    const api = chromeApi({
      "blocked-subjects": { enabled: true, keywords: ["Trump", "Donald Trump"] },
    });
    await mountOptions(document.querySelector("#app")!, api);

    const enabled = document.querySelector<HTMLInputElement>("#blocked-subjects-enabled")!;
    const keywords = document.querySelector<HTMLTextAreaElement>("#blocked-subject-keywords")!;
    expect(enabled.checked).toBe(true);
    expect(keywords.value).toBe("Trump\nDonald Trump");

    keywords.value = "Trump\nPresident Trump\nTrump";
    keywords.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();

    expect(api.state["blocked-subjects"]).toEqual({
      subjects: [{
        name: "Donald Trump",
        enabled: true,
        keywords: ["Trump", "President Trump"],
      }],
    });
    await vi.waitFor(() => {
      expect(document.querySelector("#blocked-subjects-status")?.textContent).toBe("Saved locally");
    });
  });

  it("keeps matching words in a native expandable editor", async () => {
    await mountOptions(document.querySelector("#app")!, chromeApi({}));

    const disclosure = document.querySelector<HTMLDetailsElement>(".keyword-editor");
    const summary = disclosure?.querySelector("summary");
    const keywords = disclosure?.querySelector<HTMLTextAreaElement>("#blocked-subject-keywords");

    expect(disclosure?.open).toBe(false);
    expect(summary?.textContent).toContain("Matching words");
    expect(keywords?.labels?.[0]?.textContent).toContain("One phrase per line");

    summary?.click();
    expect(disclosure?.open).toBe(true);
  });

  it("previews local name suggestions before adding another subject", async () => {
    const api = chromeApi({});
    await mountOptions(document.querySelector("#app")!, api);

    const name = document.querySelector<HTMLInputElement>("#new-subject-name")!;
    expect(name.placeholder).toBe("FirstName LastName works best");
    name.value = "Elon Musk";
    document.querySelector<HTMLButtonElement>("#suggest-subject")!.click();

    expect(document.querySelector("#subject-suggestions")?.textContent).toContain("Elon Musk");
    expect(document.querySelector("#subject-suggestions")?.textContent).toContain("Musk");
    expect(api.state["blocked-subjects"]).toBeUndefined();

    const choices = document.querySelectorAll<HTMLInputElement>("#subject-suggestions input");
    expect(Array.from(choices, (choice) => choice.checked)).toEqual([true, false]);
    choices[1]!.checked = true;

    document.querySelector<HTMLButtonElement>("#add-subject")!.click();
    await vi.waitFor(() => {
      expect(api.state["blocked-subjects"]).toEqual({
        subjects: [
          { name: "Donald Trump", enabled: false, keywords: expect.any(Array) },
          { name: "Elon Musk", enabled: true, keywords: ["Elon Musk", "Musk"] },
        ],
      });
    });
    expect(document.querySelector("#subject-list")?.textContent).toContain("Elon Musk");
  });
});
