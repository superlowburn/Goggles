import { describe, expect, it, vi } from "vitest";
import {
  defaultPolicyKey,
  prepareSocialPolicies,
  SitePolicyStore,
  parseRedditCommunity,
  policyKey,
  subredditDisplayKey,
  subredditPolicyKey,
  socialPlatformForOrigin,
  socialPolicyKey,
  socialPlatforms,
} from "../../src/shared/site-policy";

describe("Reddit community policy", () => {
  it.each([
    ["https://www.reddit.com/r/OpenAI/", "OpenAI", "openai"],
    ["https://old.reddit.com/r/BuyCanadian/comments/abc123/story", "BuyCanadian", "buycanadian"],
    ["https://new.reddit.com/r/3D_printing/comments/abc123", "3D_printing", "3d_printing"],
  ])("parses a verified Reddit community from %s", (url, displayName, canonicalName) => {
    expect(parseRedditCommunity(url)).toEqual({ displayName, canonicalName });
  });

  it.each([
    "https://reddit.com.evil.example/r/OpenAI",
    "https://notreddit.com/r/OpenAI",
    "https://www.reddit.com/user/example/r/OpenAI",
    "https://www.reddit.com/search?q=r%2FOpenAI",
    "https://www.reddit.com/r/OpenAI%2Fcomments/abc123",
    "https://www.reddit.com/r/Open%5CAI",
    "https://www.reddit.com/r/no-hyphens",
    "https://www.reddit.com/r/ab",
    "https://www.reddit.com/r/this_name_is_over_21_chars",
  ])("rejects ambiguous or invalid community URL %s", (url) => {
    expect(parseRedditCommunity(url)).toBeNull();
  });

  it.each(["all", "popular", "mod", "friends", "ALL", "Popular", "MOD", "Friends"])(
    "rejects Reddit aggregate feed r/%s as a community",
    (name) => {
      expect(parseRedditCommunity(`https://www.reddit.com/r/${name}/`)).toBeNull();
    },
  );

  it("creates one canonical lowercase storage key", () => {
    expect(subredditPolicyKey("OpenAI")).toBe("reddit-subreddit-policy:openai");
  });
});

describe("SitePolicyStore", () => {
  it("defaults non-social origins to trusted", async () => {
    const area = { get: vi.fn().mockResolvedValue({}), set: vi.fn() };
    const store = new SitePolicyStore(area);

    await expect(store.get("https://example.com")).resolves.toBe("trusted");
  });

  it("converts the removed strict mode to protected", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const store = new SitePolicyStore(area);

    await store.set("https://example.com", "strict");

    expect(area.set).toHaveBeenCalledWith({
      [policyKey("https://example.com")]: "protected",
    });
  });

  it("ignores the legacy global default for an origin without its own rule", async () => {
    const area = {
      get: vi.fn().mockResolvedValue({ [defaultPolicyKey]: "strict" }),
      set: vi.fn(),
    };
    const store = new SitePolicyStore(area);

    await expect(store.get("https://example.com")).resolves.toBe("trusted");
  });

  it("keeps an origin rule ahead of the configured default", async () => {
    const area = {
      get: vi.fn().mockResolvedValue({
        [defaultPolicyKey]: "strict",
        [policyKey("https://example.com")]: "trusted",
      }),
      set: vi.fn(),
    };
    const store = new SitePolicyStore(area);

    await expect(store.get("https://example.com")).resolves.toBe("trusted");
  });

  it("stores strict defaults as protected", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const store = new SitePolicyStore(area);

    await store.setDefault("strict");

    expect(area.set).toHaveBeenCalledWith({ [defaultPolicyKey]: "protected" });
  });

  it("defaults site descriptions to hidden and restores a saved preference", async () => {
    const area = {
      get: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ "site-descriptions:https://example.com": true }),
      set: vi.fn(),
    };
    const store = new SitePolicyStore(area) as SitePolicyStore & {
      getDescriptionsVisible?: (origin: string) => Promise<boolean>;
    };

    expect(typeof store.getDescriptionsVisible).toBe("function");
    await expect(store.getDescriptionsVisible?.("https://example.com")).resolves.toBe(false);
    await expect(store.getDescriptionsVisible?.("https://example.com")).resolves.toBe(true);
  });

  it("stores the permanent description choice by origin", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const store = new SitePolicyStore(area) as SitePolicyStore & {
      setDescriptionsVisible?: (origin: string, visible: boolean) => Promise<void>;
    };

    expect(typeof store.setDescriptionsVisible).toBe("function");
    await store.setDescriptionsVisible?.("https://example.com", true);

    expect(area.set).toHaveBeenCalledWith({
      "site-descriptions:https://example.com": true,
    });
  });

  it.each([
    ["facebook", "facebook.com", "www.facebook.com"],
    ["instagram", "instagram.com", "help.instagram.com"],
    ["reddit", "reddit.com", "old.reddit.com"],
    ["x", "x.com", "mobile.x.com"],
    ["tiktok", "tiktok.com", "www.tiktok.com"],
    ["threads", "threads.com", "www.threads.net"],
    ["bluesky", "bsky.app", "staging.bsky.app"],
    ["youtube", "youtube.com", "music.youtube.com"],
  ] as const)("recognizes %s roots and subdomains", (id, root, subdomain) => {
    expect(socialPlatformForOrigin(`https://${root}`)?.id).toBe(id);
    expect(socialPlatformForOrigin(`https://${subdomain}`)?.id).toBe(id);
  });

  it("exports the ordered social-platform catalog", () => {
    expect(socialPlatforms.map(({ id }) => id)).toEqual([
      "facebook", "instagram", "reddit", "x", "tiktok", "threads", "bluesky", "youtube",
    ]);
  });

  it.each([
    "https://reddit.com.evil.example",
    "https://notreddit.com",
    "https://redd.it/test",
    "https://youtu.be/watch",
    "https://www.youtube-nocookie.com/embed/abc",
  ])("rejects non-platform host %s", (origin) => {
    expect(socialPlatformForOrigin(origin)).toBeNull();
  });

  it("uses a platform rule before an exact-origin legacy rule and defaults social sites to protected", async () => {
    const origin = "https://www.reddit.com";
    const area = {
      get: vi.fn().mockResolvedValue({
        [socialPolicyKey("reddit")]: "trusted",
        [policyKey(origin)]: "protected",
      }),
      set: vi.fn(),
    };
    const store = new SitePolicyStore(area);

    await expect(store.get(origin)).resolves.toBe("trusted");
    await expect(new SitePolicyStore({ get: vi.fn().mockResolvedValue({}), set: vi.fn() }).get(origin))
      .resolves.toBe("protected");
  });

  it("resolves a subreddit override before the inherited Reddit-wide mode", async () => {
    const url = "https://www.reddit.com/r/OpenAI/comments/abc123/story";
    const area = {
      get: vi.fn().mockResolvedValue({
        [subredditPolicyKey("openai")]: "trusted",
        [socialPolicyKey("reddit")]: "protected",
      }),
      set: vi.fn(),
    };

    await expect(new SitePolicyStore(area).resolve(url)).resolves.toEqual({
      mode: "trusted",
      reddit: {
        displayName: "OpenAI",
        canonicalName: "openai",
        inheritedMode: "protected",
        hasOverride: true,
      },
    });
  });

  it("inherits the Reddit-wide mode when a subreddit override is absent or invalid", async () => {
    const url = "https://old.reddit.com/r/OpenAI/";
    const area = {
      get: vi.fn().mockResolvedValue({
        [subredditPolicyKey("openai")]: "strict",
        [socialPolicyKey("reddit")]: "trusted",
      }),
      set: vi.fn(),
    };

    await expect(new SitePolicyStore(area).resolve(url)).resolves.toEqual({
      mode: "trusted",
      reddit: {
        displayName: "OpenAI",
        canonicalName: "openai",
        inheritedMode: "trusted",
        hasOverride: false,
      },
    });
  });

  it("stores validated display casing and resets both subreddit keys", async () => {
    const area = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    const store = new SitePolicyStore(area);

    await store.setSubreddit("openai", "trusted", "OpenAI");
    await store.resetSubreddit("OPENAI");

    expect(area.set).toHaveBeenCalledWith({
      "reddit-subreddit-policy:openai": "trusted",
      "reddit-subreddit-display:openai": "OpenAI",
    });
    expect(area.remove).toHaveBeenCalledWith([
      "reddit-subreddit-policy:openai",
      "reddit-subreddit-display:openai",
    ]);
  });

  it("does not store mismatched subreddit display metadata", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };

    await new SitePolicyStore(area).setSubreddit("openai", "trusted", "TypeScript");

    expect(area.set).toHaveBeenCalledWith({
      [subredditPolicyKey("openai")]: "trusted",
    });
    expect(subredditDisplayKey("openai")).toBe("reddit-subreddit-display:openai");
  });

  it.each([
    ["facebook", "https://www.facebook.com"],
    ["instagram", "https://instagram.com"],
    ["reddit", "https://old.reddit.com"],
    ["x", "https://mobile.x.com"],
    ["x twitter alias", "https://mobile.twitter.com"],
    ["tiktok", "https://www.tiktok.com"],
    ["threads", "https://www.threads.net"],
    ["bluesky", "https://staging.bsky.app"],
    ["youtube", "https://music.youtube.com"],
  ])("defaults %s to protected", async (_name, origin) => {
    const store = new SitePolicyStore({ get: vi.fn().mockResolvedValue({}), set: vi.fn() });

    await expect(store.get(origin)).resolves.toBe("protected");
  });

  it("uses a legacy exact-origin social rule only while the platform rule is missing", async () => {
    const origin = "https://www.reddit.com";
    const area = {
      get: vi.fn().mockResolvedValue({ [policyKey(origin)]: "trusted" }),
      set: vi.fn(),
    };

    await expect(new SitePolicyStore(area).get(origin)).resolves.toBe("trusted");
  });

  it("keeps non-social exact-origin rules separate by scheme and port", async () => {
    const secure = "https://example.com";
    const alternate = "http://example.com:8080";
    const area = {
      get: vi.fn().mockResolvedValue({ [policyKey(secure)]: "protected" }),
      set: vi.fn(),
    };
    const store = new SitePolicyStore(area);

    await expect(store.get(secure)).resolves.toBe("protected");
    await expect(store.get(alternate)).resolves.toBe("trusted");
  });

  it("writes social origins to their platform key and non-social origins to their exact-origin key", async () => {
    const area = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const store = new SitePolicyStore(area);

    await store.set("https://old.reddit.com/r/goggles", "trusted");
    await store.set("https://example.com:8443/story", "protected");

    expect(area.set).toHaveBeenNthCalledWith(1, { [socialPolicyKey("reddit")]: "trusted" });
    expect(area.set).toHaveBeenNthCalledWith(2, {
      [policyKey("https://example.com:8443")]: "protected",
    });
  });

  it("watches the social platform and legacy exact-origin keys, then recomputes policy", async () => {
    const origin = "https://www.reddit.com";
    const values: Record<string, unknown> = { [policyKey(origin)]: "trusted" };
    let onChange!: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;
    const area = {
      get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, values[key]]))),
      set: vi.fn(),
    };
    const changes = {
      addListener: vi.fn((listener) => { onChange = listener; }),
      removeListener: vi.fn(),
    };
    const listener = vi.fn();
    const store = new SitePolicyStore(area, changes);
    store.watch(origin, listener);

    values[socialPolicyKey("reddit")] = "protected";
    onChange({ [socialPolicyKey("reddit")]: { newValue: "protected" } }, "local");

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith("protected"));
    onChange({ [policyKey(origin)]: { newValue: "trusted" } }, "local");
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
  });

  it("watches a subreddit override and its inherited Reddit-wide policy", async () => {
    const url = "https://www.reddit.com/r/OpenAI/comments/abc123/story";
    const origin = "https://www.reddit.com";
    const subredditKey = subredditPolicyKey("openai");
    const platformKey = socialPolicyKey("reddit");
    const values: Record<string, unknown> = { [platformKey]: "protected" };
    let onChange!: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;
    const area = {
      get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, values[key]]))),
      set: vi.fn(),
    };
    const changes = {
      addListener: vi.fn((listener) => { onChange = listener; }),
      removeListener: vi.fn(),
    };
    const listener = vi.fn();
    const dispose = new SitePolicyStore(area, changes).watch(url, listener);

    values[subredditKey] = "trusted";
    onChange({ [subredditKey]: { newValue: "trusted" } }, "local");
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith("trusted"));

    delete values[subredditKey];
    values[platformKey] = "trusted";
    onChange({ [platformKey]: { newValue: "trusted" } }, "local");
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));

    onChange({ [policyKey(origin)]: { newValue: "protected" } }, "sync");
    expect(listener).toHaveBeenCalledTimes(2);
    dispose();
    expect(changes.removeListener).toHaveBeenCalledWith(onChange);
  });
});

describe("prepareSocialPolicies", () => {
  it("migrates an explicit trusted legacy social origin once without deleting it", async () => {
    const values: Record<string, unknown> = {
      [policyKey("https://old.reddit.com")]: "trusted",
    };
    const area = {
      get: vi.fn().mockResolvedValue(values),
      set: vi.fn(async (updates: Record<string, unknown>) => { Object.assign(values, updates); }),
    };

    await prepareSocialPolicies(area);
    await prepareSocialPolicies(area);

    expect(area.set).toHaveBeenCalledTimes(1);
    expect(area.set).toHaveBeenCalledWith({ [socialPolicyKey("reddit")]: "trusted" });
    expect(values[policyKey("https://old.reddit.com")]).toBe("trusted");
  });

  it("does not overwrite an existing platform policy during migration", async () => {
    const area = {
      get: vi.fn().mockResolvedValue({
        [socialPolicyKey("reddit")]: "protected",
        [policyKey("https://old.reddit.com")]: "trusted",
      }),
      set: vi.fn(),
    };

    await prepareSocialPolicies(area);

    expect(area.set).not.toHaveBeenCalled();
  });
});
