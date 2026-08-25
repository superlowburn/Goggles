import { describe, expect, it, vi } from "vitest";
import {
  defaultPolicyKey,
  migrateSocialPolicies,
  SitePolicyStore,
  policyKey,
  socialPlatformForOrigin,
  socialPolicyKey,
  socialPlatforms,
} from "../../src/shared/site-policy";

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
});

describe("migrateSocialPolicies", () => {
  it("migrates an explicit trusted legacy social origin once without deleting it", async () => {
    const values: Record<string, unknown> = {
      [policyKey("https://old.reddit.com")]: "trusted",
    };
    const area = {
      get: vi.fn().mockResolvedValue(values),
      set: vi.fn(async (updates: Record<string, unknown>) => { Object.assign(values, updates); }),
    };

    await migrateSocialPolicies(area);
    await migrateSocialPolicies(area);

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

    await migrateSocialPolicies(area);

    expect(area.set).not.toHaveBeenCalled();
  });
});
