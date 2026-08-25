import { describe, expect, it, vi } from "vitest";
import {
  handleExtensionMessage,
  installFirstRun,
} from "../../src/background/service-worker";
import { defaultTrumpKeywords } from "../../src/shared/blocked-subjects";
import { policyKey, prepareSocialPolicies, socialPolicyKey } from "../../src/shared/site-policy";

describe("handleExtensionMessage", () => {
  it("returns effective social policies to an extension Settings sender", async () => {
    const deps = {
      storage: {
        get: vi.fn().mockResolvedValue({ [socialPolicyKey("reddit")]: "trusted" }),
        set: vi.fn(),
      },
      tabs: { get: vi.fn() },
      extensionId: "extension-id",
    };

    await expect(handleExtensionMessage(
      { type: "policy:get-social" },
      {
        id: "extension-id",
        url: "chrome-extension://extension-id/dist/options/options.html?source=menu#social",
        tab: { id: 7, url: "chrome-extension://extension-id/dist/options/options.html?source=menu#social" },
      },
      deps,
    )).resolves.toEqual({
      socialPolicies: {
        facebook: "protected",
        instagram: "protected",
        reddit: "trusted",
        x: "protected",
        tiktok: "protected",
        threads: "protected",
        bluesky: "protected",
        youtube: "protected",
      },
    });
  });

  it("accepts only validated social writes from its own extension", async () => {
    const deps = {
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
      tabs: { get: vi.fn() },
      extensionId: "extension-id",
    };

    await expect(handleExtensionMessage(
      { type: "policy:set-social", platform: "reddit", mode: "trusted" },
      {
        id: "extension-id",
        url: "chrome-extension://extension-id/dist/options/options.html",
        tab: { id: 7, url: "chrome-extension://extension-id/dist/options/options.html" },
      },
      deps,
    )).resolves.toEqual({ platform: "reddit", mode: "trusted" });
    expect(deps.storage.set).toHaveBeenCalledWith({ [socialPolicyKey("reddit")]: "trusted" });

    for (const [message, sender] of [
      [{ type: "policy:set-social", platform: "reddit", mode: "trusted" }, { id: "other-extension" }],
      [{
        type: "policy:set-social",
        platform: "reddit",
        mode: "trusted",
      }, {
        id: "extension-id",
        url: "https://reddit.com",
        tab: { id: 7, url: "https://reddit.com" },
      }],
      [{
        type: "policy:set-social",
        platform: "reddit",
        mode: "trusted",
      }, {
        id: "extension-id",
        url: "chrome-extension://extension-id/dist/popup/popup.html",
        tab: { id: 7, url: "chrome-extension://extension-id/dist/popup/popup.html" },
      }],
      [{
        type: "policy:set-social",
        platform: "reddit",
        mode: "trusted",
      }, {
        id: "extension-id",
        url: "chrome-extension://other-extension/dist/options/options.html",
        tab: { id: 7, url: "chrome-extension://other-extension/dist/options/options.html" },
      }],
      [{ type: "policy:set-social", platform: "reddit.example", mode: "trusted" }, {
        id: "extension-id",
        url: "chrome-extension://extension-id/dist/options/options.html",
      }],
      [{ type: "policy:set-social", platform: "reddit", mode: "strict" }, {
        id: "extension-id",
        url: "chrome-extension://extension-id/dist/options/options.html",
      }],
    ] as const) {
      await expect(handleExtensionMessage(message, sender, deps)).resolves.toEqual({
        error: "invalid-message",
      });
    }
    expect(deps.storage.set).toHaveBeenCalledTimes(1);
  });

  it("returns the sender tab policy for the current page", async () => {
    const deps = {
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
      tabs: { get: vi.fn() },
    };

    expect(
      await handleExtensionMessage(
        { type: "policy:get-current" },
        { tab: { id: 7, url: "https://news.example/story" } },
        deps,
      ),
    ).toEqual({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: false, keywords: defaultTrumpKeywords },
    });
  });

  it("returns the enabled blocked-subject configuration with a verified tab policy", async () => {
    const deps = {
      storage: {
        get: vi.fn().mockResolvedValue({
          "blocked-subjects": { enabled: true, keywords: ["Donald Trump"] },
        }),
        set: vi.fn(),
      },
      tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: "https://news.example/story" }) },
    };

    await expect(handleExtensionMessage(
      { type: "policy:get-tab", tabId: 7 },
      {},
      deps,
    )).resolves.toEqual({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Donald Trump"] },
    });
  });

  it("sets the verified tab origin policy", async () => {
    const deps = {
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
      tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: "https://news.example/story" }) },
    };

    expect(
      await handleExtensionMessage(
        {
          type: "policy:set-tab",
          tabId: 7,
          mode: "strict",
          expectedOrigin: "https://news.example",
        },
        {},
        deps,
      ),
    ).toEqual({ origin: "https://news.example", mode: "protected" });
    expect(deps.tabs.get).toHaveBeenCalledWith(7);
    expect(deps.storage.set).toHaveBeenCalledWith({
      "site-policy:https://news.example": "protected",
    });
  });

  it("sets a social tab through its platform policy", async () => {
    const deps = {
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
      tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: "https://old.reddit.com/r/goggles" }) },
    };

    await expect(handleExtensionMessage(
      {
        type: "policy:set-tab",
        tabId: 7,
        mode: "trusted",
        expectedOrigin: "https://old.reddit.com",
      },
      {},
      deps,
    )).resolves.toEqual({ origin: "https://old.reddit.com", mode: "trusted" });
    expect(deps.storage.set).toHaveBeenCalledWith({ [socialPolicyKey("reddit")]: "trusted" });
  });

  it("waits for shared migration before a social policy write", async () => {
    const legacyKey = policyKey("https://old.reddit.com");
    const platformKey = socialPolicyKey("reddit");
    const values: Record<string, unknown> = { [legacyKey]: "trusted" };
    let resolveMigrationRead!: (values: Record<string, unknown>) => void;
    const storage = {
      get: vi.fn((key: null | string | string[]) => key === null
        ? new Promise<Record<string, unknown>>((resolve) => { resolveMigrationRead = resolve; })
        : Promise.resolve(Object.fromEntries((Array.isArray(key) ? key : [key]).map((item) => [item, values[item]])))),
      set: vi.fn(async (updates: Record<string, unknown>) => { Object.assign(values, updates); }),
    };
    const deps = {
      storage,
      tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: "https://old.reddit.com/r/goggles" }) },
    };

    const migration = prepareSocialPolicies(storage);
    const write = handleExtensionMessage({
      type: "policy:set-tab",
      tabId: 7,
      mode: "protected",
      expectedOrigin: "https://old.reddit.com",
    }, {}, deps);
    expect(storage.set).not.toHaveBeenCalled();

    resolveMigrationRead({ ...values });
    await migration;
    await write;

    expect(storage.set).toHaveBeenNthCalledWith(1, { [platformKey]: "trusted" });
    expect(storage.set).toHaveBeenNthCalledWith(2, { [platformKey]: "protected" });
    expect(values[platformKey]).toBe("protected");
  });

  it("keeps policy messaging available and retries after a migration read fails", async () => {
    let failMigration = true;
    const storage = {
      get: vi.fn((key: null | string | string[]) => {
        if (key === null) {
          if (failMigration) {
            failMigration = false;
            return Promise.reject(new Error("temporary storage failure"));
          }
          return Promise.resolve({});
        }
        return Promise.resolve({});
      }),
      set: vi.fn(),
    };
    const deps = { storage, tabs: { get: vi.fn() } };
    const sender = { tab: { id: 7, url: "https://news.example/story" } };

    await expect(handleExtensionMessage({ type: "policy:get-current" }, sender, deps))
      .resolves.toMatchObject({ origin: "https://news.example", mode: "trusted" });
    await expect(handleExtensionMessage({ type: "policy:get-current" }, sender, deps))
      .resolves.toMatchObject({ origin: "https://news.example", mode: "trusted" });

    expect(storage.get).toHaveBeenCalledWith(null);
    expect(storage.get.mock.calls.filter(([key]) => key === null)).toHaveLength(2);
  });

  it("rejects a set-tab request when the tab redirected away from the displayed origin", async () => {
    const deps = {
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
      tabs: { get: vi.fn().mockResolvedValue({ id: 7, url: "https://redirected.example/login" }) },
    };

    await expect(handleExtensionMessage(
      {
        type: "policy:set-tab",
        tabId: 7,
        mode: "strict",
        expectedOrigin: "https://news.example",
      },
      {},
      deps,
    )).resolves.toEqual({ error: "origin-changed" });
    expect(deps.storage.set).not.toHaveBeenCalled();
  });

  it("rejects malformed tab URLs as unsupported pages", async () => {
    const deps = {
      storage: { get: vi.fn(), set: vi.fn() },
      tabs: { get: vi.fn() },
    };

    await expect(
      handleExtensionMessage(
        { type: "policy:get-current" },
        { tab: { url: "not a URL" } },
        deps,
      ),
    ).resolves.toEqual({ error: "unsupported-page" });
  });

  it("rejects malformed runtime messages without using extension APIs", async () => {
    const deps = {
      storage: { get: vi.fn(), set: vi.fn() },
      tabs: { get: vi.fn() },
    };

    await expect(handleExtensionMessage({}, {}, deps)).resolves.toEqual({
      error: "invalid-message",
    });
    expect(deps.tabs.get).not.toHaveBeenCalled();
    expect(deps.storage.set).not.toHaveBeenCalled();
  });

  it("rejects invalid set-tab modes without writing policy storage", async () => {
    const deps = {
      storage: { get: vi.fn(), set: vi.fn() },
      tabs: { get: vi.fn() },
    };

    await expect(
      handleExtensionMessage(
        { type: "policy:set-tab", tabId: 7, mode: "untrusted" },
        {},
        deps,
      ),
    ).resolves.toEqual({ error: "invalid-message" });
    expect(deps.tabs.get).not.toHaveBeenCalled();
    expect(deps.storage.set).not.toHaveBeenCalled();
  });

  it("opens the Goggles settings page from an extension message", async () => {
    const openOptionsPage = vi.fn().mockResolvedValue(undefined);
    const deps = {
      storage: { get: vi.fn(), set: vi.fn() },
      tabs: { get: vi.fn() },
      openOptionsPage,
    };

    await expect(handleExtensionMessage(
      { type: "options:open" },
      {},
      deps,
    )).resolves.toEqual({ opened: true });
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });
});

describe("installFirstRun", () => {
  it("opens onboarding once for a new install but not an update", async () => {
    let onInstalled!: (details: { reason: string }) => void;
    const openOptionsPage = vi.fn().mockResolvedValue(undefined);
    installFirstRun({
      onInstalled: { addListener: vi.fn((listener) => { onInstalled = listener; }) },
      openOptionsPage,
    });

    onInstalled({ reason: "update" });
    onInstalled({ reason: "install" });
    await Promise.resolve();

    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("migrates trusted legacy social policies on updates", async () => {
    let onInstalled!: (details: { reason: string }) => void;
    const storage = {
      get: vi.fn().mockResolvedValue({ [policyKey("https://old.reddit.com")]: "trusted" }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    installFirstRun({
      onInstalled: { addListener: vi.fn((listener) => { onInstalled = listener; }) },
      openOptionsPage: vi.fn().mockResolvedValue(undefined),
    }, storage);

    onInstalled({ reason: "update" });

    await vi.waitFor(() => {
      expect(storage.set).toHaveBeenCalledWith({ [socialPolicyKey("reddit")]: "trusted" });
    });
  });
});
