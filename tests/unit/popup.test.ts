import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { mountPopup, type PopupChromeApi } from "../../src/popup/popup";

function policyContext(enabled: boolean, mode: "protected" | "trusted" = "protected") {
  return {
    origin: "https://verified.example",
    mode,
    blockedSubjects: { enabled, keywords: ["Donald Trump"] },
  };
}

function redditPolicyContext(
  mode: "protected" | "trusted" = "protected",
  inheritedMode: "protected" | "trusted" = "protected",
  hasOverride = false,
) {
  return {
    origin: "https://www.reddit.com",
    mode,
    reddit: {
      displayName: "OpenAI",
      canonicalName: "openai",
      inheritedMode,
      hasOverride,
    },
    blockedSubjects: { enabled: true, keywords: ["Donald Trump"] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function createChromeApi(
  sendMessage: PopupChromeApi["runtime"]["sendMessage"] = vi
    .fn()
    .mockResolvedValue(policyContext(true)),
): PopupChromeApi {
  return {
    tabs: {
      query: vi.fn().mockResolvedValue([
        { id: 7, url: "https://untrusted-tab-value.example/story" },
      ]),
    },
    runtime: { sendMessage, openOptionsPage: vi.fn().mockResolvedValue(undefined) },
  };
}

function getSwitch(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('[role="switch"]')!;
}

describe("mountPopup", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    root = document.querySelector<HTMLElement>("#app")!;
  });

  it("renders one subject-first switch with blocked subjects on everywhere", async () => {
    const chromeApi = createChromeApi();

    await mountPopup(root, chromeApi);

    expect(chromeApi.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "policy:get-tab",
      tabId: 7,
    });
    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelector("h1")?.textContent).toBe("Goggles");
    expect(root.querySelector(".popup-site")?.textContent).toBe("verified.example");
    expect(root.textContent).not.toContain("untrusted-tab-value.example");

    expect(root.querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(root.querySelector(".popup-switch-title")?.textContent).toBe("Frost images and videos");
    expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
      "On — click an item to reveal it.",
    );
    expect(root.querySelector(".popup-subjects-title")?.textContent).toBe("Blocked subjects");
    expect(root.querySelector(".popup-subjects-state")?.textContent).toBe("On");
    expect(root.querySelector(".popup-subjects-description")?.textContent).toBe(
      "Stay frosted on every site.",
    );
    expect(root.querySelector(".popup-settings")?.textContent).toBe("Open settings");
    expect(getSwitch(root).getAttribute("aria-checked")).toBe("true");
  });

  it("renders blocked subjects as off when the verified policy context disables them", async () => {
    await mountPopup(root, createChromeApi(vi.fn().mockResolvedValue(policyContext(false))));

    expect(root.querySelector(".popup-subjects-state")?.textContent).toBe("Off");
    expect(root.querySelector(".popup-subjects-description")?.textContent).toBe(
      "Turn on matching in Settings.",
    );
  });

  it("renders an inherited subreddit switch with Reddit-wide context and no reset", async () => {
    await mountPopup(root, createChromeApi(vi.fn().mockResolvedValue(redditPolicyContext())));

    const protectionSwitch = getSwitch(root);
    expect(root.querySelector(".popup-site")?.textContent).toBe("Reddit");
    expect(root.querySelector(".popup-community")?.textContent).toBe("r/OpenAI");
    expect(root.querySelector(".popup-switch-title")?.textContent).toBe(
      "Frost media in r/OpenAI",
    );
    expect(protectionSwitch.getAttribute("aria-label")).toBe("Frost media in r/OpenAI");
    expect(protectionSwitch.getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
      "On - using your Reddit setting.",
    );
    expect(root.querySelector(".popup-reddit-state")?.textContent).toBe("All Reddit: On");
    expect(root.querySelector(".popup-reset-subreddit")).toBeNull();
    expect(root.querySelector(".popup-subjects-description")?.textContent).toBe(
      "Blocked subjects stay frosted here.",
    );
  });

  it("does not flash subreddit-only controls while the active policy is loading", async () => {
    const initial = deferred<unknown>();
    const mounting = mountPopup(root, createChromeApi(vi.fn(() => initial.promise)));
    await vi.waitFor(() => expect(root.querySelector(".popup-community")).not.toBeNull());

    expect(root.querySelector<HTMLElement>(".popup-community")?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>(".popup-reddit-context")?.hidden).toBe(true);

    initial.resolve(policyContext(true));
    await mounting;
  });

  it("renders a subreddit override with its explicit reset action", async () => {
    await mountPopup(root, createChromeApi(
      vi.fn().mockResolvedValue(redditPolicyContext("trusted", "protected", true)),
    ));

    expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
      "Off - media shows normally in r/OpenAI.",
    );
    expect(root.querySelector(".popup-reddit-state")?.textContent).toBe("All Reddit: On");
    expect(root.querySelector<HTMLButtonElement>(".popup-reset-subreddit")?.textContent).toBe(
      "Use Reddit setting",
    );
  });

  it("creates a subreddit override from the contextual switch", async () => {
    const save = deferred<unknown>();
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(redditPolicyContext())
      .mockImplementationOnce(() => save.promise);
    await mountPopup(root, createChromeApi(sendMessage));
    const protectionSwitch = getSwitch(root);

    protectionSwitch.focus();
    protectionSwitch.click();

    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "policy:set-subreddit",
      tabId: 7,
      expectedSubreddit: "openai",
      mode: "trusted",
    });
    expect(protectionSwitch.disabled).toBe(true);
    expect(protectionSwitch.getAttribute("aria-busy")).toBe("true");
    expect(protectionSwitch.getAttribute("aria-checked")).toBe("false");
    expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
      "Off - media shows normally in r/OpenAI.",
    );

    save.resolve(redditPolicyContext("trusted", "protected", true));
    await vi.waitFor(() => expect(protectionSwitch.disabled).toBe(false));
    expect(protectionSwitch.getAttribute("aria-busy")).toBe("false");
    expect(root.querySelector(".popup-reset-subreddit")).not.toBeNull();
    expect(root.querySelector(".popup-status")?.textContent).toBe("Saved for r/OpenAI.");
    expect(document.activeElement).toBe(protectionSwitch);
  });

  it("rolls back a stale-route subreddit save with a specific alert and focus", async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(redditPolicyContext())
      .mockResolvedValueOnce({ error: "subreddit-changed" });
    await mountPopup(root, createChromeApi(sendMessage));
    const protectionSwitch = getSwitch(root);

    protectionSwitch.focus();
    protectionSwitch.click();

    await vi.waitFor(() => expect(protectionSwitch.disabled).toBe(false));
    expect(protectionSwitch.getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
      "On - using your Reddit setting.",
    );
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "Reddit changed communities. Reopen Goggles and try again.",
    );
    expect(document.activeElement).toBe(protectionSwitch);
  });

  it("resets an override to the inherited Reddit setting and preserves focus", async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(redditPolicyContext("trusted", "protected", true))
      .mockResolvedValueOnce(redditPolicyContext("protected", "protected", false));
    await mountPopup(root, createChromeApi(sendMessage));
    const reset = root.querySelector<HTMLButtonElement>(".popup-reset-subreddit")!;

    reset.focus();
    reset.click();

    await vi.waitFor(() => expect(root.querySelector(".popup-reset-subreddit")).toBeNull());
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "policy:reset-subreddit",
      tabId: 7,
      expectedSubreddit: "openai",
    });
    expect(getSwitch(root).getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
      "On - using your Reddit setting.",
    );
    expect(root.querySelector(".popup-status")?.textContent).toBe("Using your Reddit setting.");
    expect(document.activeElement).toBe(getSwitch(root));
  });

  it("marks the subreddit reset busy while its save is pending", async () => {
    const pending = deferred<unknown>();
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(redditPolicyContext("trusted", "protected", true))
      .mockImplementationOnce(() => pending.promise);
    await mountPopup(root, createChromeApi(sendMessage));
    const reset = root.querySelector<HTMLButtonElement>(".popup-reset-subreddit")!;

    reset.click();

    expect(reset.disabled).toBe(true);
    expect(reset.getAttribute("aria-busy")).toBe("true");
    pending.resolve(redditPolicyContext("protected", "protected", false));
    await vi.waitFor(() => expect(root.querySelector(".popup-reset-subreddit")).toBeNull());
  });

  it("rolls back a failed subreddit reset and refocuses the reset action", async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(redditPolicyContext("trusted", "protected", true))
      .mockRejectedValueOnce(new Error("storage unavailable"));
    await mountPopup(root, createChromeApi(sendMessage));
    const reset = root.querySelector<HTMLButtonElement>(".popup-reset-subreddit")!;

    reset.focus();
    reset.click();

    await vi.waitFor(() => expect(reset.disabled).toBe(false));
    expect(reset.getAttribute("aria-busy")).toBe("false");
    expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
      "Off - media shows normally in r/OpenAI.",
    );
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not update protection. Try again.",
    );
    expect(document.activeElement).toBe(reset);
  });

  it("rolls back a stale-route subreddit reset with route guidance and reset focus", async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(redditPolicyContext("trusted", "protected", true))
      .mockResolvedValueOnce({ error: "subreddit-changed" });
    await mountPopup(root, createChromeApi(sendMessage));
    const reset = root.querySelector<HTMLButtonElement>(".popup-reset-subreddit")!;

    reset.focus();
    reset.click();

    await vi.waitFor(() => expect(reset.disabled).toBe(false));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "Reddit changed communities. Reopen Goggles and try again.",
    );
    expect(root.querySelector(".popup-reset-subreddit")).toBe(reset);
    expect(document.activeElement).toBe(reset);
  });

  it("keeps the scoped controls readable and touchable at the 320px popup width", async () => {
    const css = await readFile("src/popup/popup.css", "utf8");

    expect(css).toMatch(/\.popup-switch\s*\{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.popup-switch-copy\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.popup-community\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(css).toMatch(/\.popup-reset-subreddit\s*\{[^}]*min-height:\s*44px/s);
  });

  it("shows ordinary media for the active tab when the switch is turned off", async () => {
    const chromeApi = createChromeApi(
      vi
        .fn()
        .mockResolvedValueOnce(policyContext(true))
        .mockResolvedValueOnce({ origin: "https://verified.example", mode: "trusted" }),
    );
    await mountPopup(root, chromeApi);
    const protectionSwitch = getSwitch(root);

    protectionSwitch.click();

    await vi.waitFor(() => {
      expect(chromeApi.runtime.sendMessage).toHaveBeenLastCalledWith({
        type: "policy:set-tab",
        tabId: 7,
        mode: "trusted",
        expectedOrigin: "https://verified.example",
      });
      expect(protectionSwitch.getAttribute("aria-checked")).toBe("false");
      expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
        "Off — ordinary media shows normally.",
      );
    });
  });

  it("sends the verified social origin so the worker can route the platform-family write", async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({
        ...policyContext(true),
        origin: "https://old.reddit.com",
      })
      .mockResolvedValueOnce({ origin: "https://old.reddit.com", mode: "trusted" });
    const chromeApi = createChromeApi(sendMessage);
    await mountPopup(root, chromeApi);

    getSwitch(root).click();

    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenLastCalledWith({
        type: "policy:set-tab",
        tabId: 7,
        mode: "trusted",
        expectedOrigin: "https://old.reddit.com",
      });
    });
  });

  it("frosts ordinary media when the site switch is turned on", async () => {
    const chromeApi = createChromeApi(
      vi
        .fn()
        .mockResolvedValueOnce(policyContext(true, "trusted"))
        .mockResolvedValueOnce({ origin: "https://verified.example", mode: "protected" }),
    );
    await mountPopup(root, chromeApi);
    const protectionSwitch = getSwitch(root);
    expect(protectionSwitch.getAttribute("aria-checked")).toBe("false");

    protectionSwitch.click();

    await vi.waitFor(() => {
      expect(chromeApi.runtime.sendMessage).toHaveBeenLastCalledWith({
        type: "policy:set-tab",
        tabId: 7,
        mode: "protected",
        expectedOrigin: "https://verified.example",
      });
      expect(protectionSwitch.getAttribute("aria-checked")).toBe("true");
      expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
        "On — click an item to reveal it.",
      );
    });
  });

  it("opens the full settings page from the navigation row", async () => {
    const chromeApi = createChromeApi();
    await mountPopup(root, chromeApi);

    (root.querySelector(".popup-settings") as HTMLButtonElement).click();

    expect(chromeApi.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it("rejects a successful-looking response for a different origin", async () => {
    const chromeApi = createChromeApi(
      vi
        .fn()
        .mockResolvedValueOnce(policyContext(true))
        .mockResolvedValueOnce({ origin: "https://redirected.example", mode: "trusted" }),
    );
    await mountPopup(root, chromeApi);
    const protectionSwitch = getSwitch(root);

    protectionSwitch.click();

    await vi.waitFor(() => {
      expect(protectionSwitch.getAttribute("aria-checked")).toBe("true");
      expect(root.querySelector(".popup-switch-description")?.textContent).toBe(
        "On — click an item to reveal it.",
      );
      expect(root.querySelector('[role="alert"]')?.textContent).toBe(
        "Could not update protection. Try again.",
      );
    });
  });

  it("rolls back an optimistic mode change and shows a local error when saving fails", async () => {
    const save = deferred<unknown>();
    const chromeApi = createChromeApi(
      vi
        .fn()
        .mockResolvedValueOnce(policyContext(true))
        .mockImplementationOnce(() => save.promise),
    );
    await mountPopup(root, chromeApi);
    const protectionSwitch = getSwitch(root);

    protectionSwitch.click();
    expect(protectionSwitch.getAttribute("aria-checked")).toBe("false");

    save.reject(new Error("storage unavailable"));

    await vi.waitFor(() => {
      expect(protectionSwitch.getAttribute("aria-checked")).toBe("true");
      expect(root.querySelector('[role="alert"]')?.textContent).toBe(
        "Could not update protection. Try again.",
      );
    });
    expect((root.querySelector('[role="alert"]') as HTMLElement).hidden).toBe(false);
  });
});
