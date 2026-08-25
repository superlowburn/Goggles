import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { mountOptions, type OptionsChromeApi } from "../../src/options/options";
import { handleExtensionMessage } from "../../src/background/service-worker";
import {
  policyKey,
  prepareSocialPolicies,
  socialPlatforms,
  socialPolicyKey,
} from "../../src/shared/site-policy";

function chromeApi(initial: Record<string, unknown>): OptionsChromeApi & {
  state: Record<string, unknown>;
} {
  const state = { ...initial };
  return {
    state,
    runtime: {
      sendMessage: vi.fn(async (message: { type: string; platform?: string; mode?: string }) => {
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
        { id: "extension-id" },
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
      enabled: true,
      keywords: ["Trump", "President Trump"],
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
});
