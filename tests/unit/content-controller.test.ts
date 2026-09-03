import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContentController,
  type ContentControllerDependencies,
  type DocumentObserverPort,
} from "../../src/content/content-controller";
import {
  bootstrapContentScript,
  type ContentBootstrapDependencies,
} from "../../src/content/index";
import type { MediaCandidate, MediaKind, SiteMode } from "../../src/shared/media-types";
import type {
  ProtectionHandle,
  ProtectionOptions,
} from "../../src/protection/renderer";
import { ProtectionRenderer } from "../../src/protection/renderer";
import { classifyElement } from "../../src/media/classifier";
import type { BlockedSubjectsConfig } from "../../src/shared/blocked-subjects";

class FakeDocumentObserver implements DocumentObserverPort {
  readonly start = vi.fn((callback: (elements: readonly Element[]) => void) => {
    this.callback = callback;
  });
  readonly scan = vi.fn();
  readonly stop = vi.fn();
  private callback: ((elements: readonly Element[]) => void) | null = null;
  private readonly attributeChanges = new WeakSet<Element>();

  emit(elements: readonly Element[], attributes: readonly Element[] = []): void {
    for (const element of attributes) this.attributeChanges.add(element);
    this.callback?.(elements);
    for (const element of attributes) this.attributeChanges.delete(element);
  }

  hadRelevantAttributeChange(element: Element): boolean {
    return this.attributeChanges.has(element);
  }
}

interface RenderedItem {
  candidate: MediaCandidate;
  options: ProtectionOptions;
  handle: ProtectionHandle;
  isRemoved(): boolean;
}

function rendererHarness() {
  const items: RenderedItem[] = [];
  const protect = vi.fn((candidate: MediaCandidate, options: ProtectionOptions) => {
    let revealed = false;
    let removed = false;
    const handle: ProtectionHandle = {
      reveal: vi.fn(() => {
        if (revealed || removed) return;
        revealed = true;
      }),
      reprotect: vi.fn(() => {
        if (!revealed || removed) return;
        revealed = false;
      }),
      remove: vi.fn(() => {
        removed = true;
      }),
      update: vi.fn(),
      setDescriptionVisible: vi.fn(),
      setPolicy: vi.fn((mode: SiteMode, siteControl?: ProtectionOptions["siteControl"]) => {
        options.mode = mode;
        if (siteControl) options.siteControl = siteControl;
        else delete options.siteControl;
      }),
      isRevealed: () => revealed,
      setBlockedSubject: vi.fn((blocked: boolean) => {
        options.blockedSubject = blocked;
      }),
    } as ProtectionHandle;
    items.push({ candidate, options, handle, isRemoved: () => removed });
    return handle;
  });
  return {
    protect,
    items,
    activeFor: (element: HTMLElement) =>
      items.filter((item) => item.candidate.element === element && !item.isRemoved()),
  };
}

function candidate(element: HTMLElement, kind: MediaKind): MediaCandidate {
  return { element, kind };
}

function controllerHarness(
  classifications = new Map<Element, MediaCandidate>(),
  overrides: Partial<ContentControllerDependencies> = {},
) {
  const observer = new FakeDocumentObserver();
  const renderer = rendererHarness();
  const classify = vi.fn((element: Element) => classifications.get(element) ?? null);
  const resolveDescription = vi.fn((media: MediaCandidate) => `Description for ${media.kind}`);
  const controller = new ContentController({
    document,
    observer,
    renderer,
    classify,
    resolveDescription,
    development: false,
    ...overrides,
  });
  return {
    controller,
    observer,
    renderer,
    classify,
    resolveDescription,
  };
}

afterEach(() => {
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
});

beforeEach(() => {
  vi.mocked(chrome.storage.local.set).mockClear();
});

describe("ContentController", () => {
  it("adds one exact-origin frost action to current and future trusted non-social media", async () => {
    const first = document.createElement("img");
    const second = document.createElement("img");
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 200));
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 200));
    document.body.append(first, second);
    const setSiteMode = vi.fn().mockResolvedValue(undefined);
    const harness = controllerHarness(new Map([
      [first, candidate(first, "image")],
      [second, candidate(second, "image")],
    ]), { enableSiteControl: true, setSiteMode });

    harness.controller.start({ origin: "https://news.example", mode: "trusted" });
    harness.observer.emit([first]);
    harness.observer.emit([first, second]);

    expect(harness.renderer.activeFor(first)).toHaveLength(1);
    expect(harness.renderer.activeFor(second)).toHaveLength(1);
    const control = harness.renderer.activeFor(first)[0]?.options.siteControl;
    expect(control?.mode).toBe("protected");
    await control?.save();
    expect(setSiteMode).toHaveBeenCalledWith("https://news.example", "protected");
  });

  it("offers a frost action on an Amazon-sized portrait product image", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 163, 200));
    document.body.append(image);
    const harness = controllerHarness(new Map([[image, candidate(image, "image")]]), {
      enableSiteControl: true,
      setSiteMode: vi.fn(),
    });

    harness.controller.start({ origin: "https://www.amazon.ca", mode: "trusted" });
    harness.observer.emit([image]);

    expect(harness.renderer.activeFor(image)[0]?.options.siteControl?.mode).toBe("protected");
  });

  it("does not add Always frost controls to a social platform switched Off", () => {
    const image = document.createElement("img");
    document.body.append(image);
    const harness = controllerHarness(new Map([[image, candidate(image, "image")]]), {
      enableSiteControl: true,
      setSiteMode: vi.fn(),
    });

    harness.controller.start({ origin: "https://old.reddit.com", mode: "trusted" });
    harness.observer.emit([image]);

    expect(harness.renderer.protect).not.toHaveBeenCalled();
  });

  it("does not create a trusted-page control root below 96x96", () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 95, 96));
    document.body.append(image);
    const harness = controllerHarness(new Map([[image, candidate(image, "image")]]), {
      enableSiteControl: true,
      setSiteMode: vi.fn(),
    });

    harness.controller.start({ origin: "https://news.example", mode: "trusted" });
    harness.observer.emit([image]);

    expect(harness.renderer.protect).not.toHaveBeenCalled();
  });

  it("offers Always show on protected media and reconciles current and future ordinary media", async () => {
    const current = document.createElement("img");
    const future = document.createElement("img");
    vi.spyOn(current, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 200));
    vi.spyOn(future, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 200));
    document.body.append(current, future);
    const setSiteMode = vi.fn().mockResolvedValue(undefined);
    const harness = controllerHarness(new Map([
      [current, candidate(current, "image")],
      [future, candidate(future, "image")],
    ]), { enableSiteControl: true, setSiteMode });
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([current]);

    const control = harness.renderer.activeFor(current)[0]?.options.siteControl;
    expect(control?.mode).toBe("trusted");
    await control?.save();
    expect(setSiteMode).toHaveBeenCalledWith("https://news.example", "trusted");

    harness.controller.applyMode("trusted");
    harness.observer.emit([current, future]);
    expect(harness.renderer.activeFor(current)[0]?.options.siteControl?.mode).toBe("protected");
    expect(harness.renderer.activeFor(future)[0]?.options.siteControl?.mode).toBe("protected");
  });

  it("keeps a manually revealed subject while Always show removes only ordinary protection", async () => {
    const subject = document.createElement("img");
    subject.alt = "Donald Trump at an event";
    const ordinary = document.createElement("img");
    ordinary.alt = "A quiet lake";
    const futureSubject = document.createElement("img");
    futureSubject.alt = "Donald Trump at another event";
    vi.spyOn(ordinary, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 200));
    document.body.append(subject, ordinary, futureSubject);
    const harness = controllerHarness(new Map([
      [subject, candidate(subject, "image")],
      [ordinary, candidate(ordinary, "image")],
      [futureSubject, candidate(futureSubject, "image")],
    ]), { enableSiteControl: true, setSiteMode: vi.fn().mockResolvedValue(undefined) });
    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([subject, ordinary]);
    const subjectRecord = harness.renderer.activeFor(subject)[0]!;
    subjectRecord.handle.reveal();

    await harness.renderer.activeFor(ordinary)[0]?.options.siteControl?.save();
    harness.controller.applyMode("trusted");
    harness.observer.emit([subject, ordinary, futureSubject]);

    expect(harness.renderer.activeFor(subject)[0]).toBe(subjectRecord);
    expect(subjectRecord.handle.isRevealed()).toBe(true);
    expect(harness.renderer.activeFor(ordinary)[0]?.options.siteControl?.mode).toBe("protected");
    expect(harness.renderer.activeFor(futureSubject)[0]?.options.blockedSubject).toBe(true);
    expect(harness.renderer.activeFor(futureSubject)[0]?.handle.isRevealed()).toBe(false);
  });

  it("refreshes a retained revealed subject so refrost and rereveal do not offer stale Always show", async () => {
    const image = document.createElement("img");
    image.alt = "Donald Trump at an event";
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 200));
    document.body.append(image);
    const observer = new FakeDocumentObserver();
    const renderer = new ProtectionRenderer({ trustedActivation: () => true });
    const setSiteMode = vi.fn().mockResolvedValue(undefined);
    const controller = new ContentController({
      document,
      observer,
      renderer,
      classify: (element) => element === image ? candidate(image, "image") : null,
      resolveDescription: () => "Donald Trump at an event",
      enableSiteControl: true,
      setSiteMode,
    });
    controller.start({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    observer.emit([image]);
    const layer = renderer.debugLayerFor(image)!;
    layer.querySelector<HTMLButtonElement>(".eg-reveal-surface")!.click();
    const alwaysShow = layer.querySelector<HTMLButtonElement>(".eg-site-action")!;

    alwaysShow.click();
    await vi.waitFor(() => expect(setSiteMode).toHaveBeenCalledWith("https://news.example", "trusted"));
    controller.applyMode("trusted");
    expect(layer.querySelector(".eg-reprotect")).not.toBeNull();

    layer.querySelector<HTMLButtonElement>(".eg-reprotect")!.click();
    layer.querySelector<HTMLButtonElement>(".eg-reveal-surface")!.click();

    expect(layer.querySelector(".eg-reprotect")).not.toBeNull();
    expect(layer.querySelector(".eg-site-action")).toBeNull();
  });

  it("observes Trusted mode without protecting unrelated dynamic media", () => {
    const image = document.createElement("img");
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/trusted-dynamic";
    document.body.append(image, frame);
    const harness = controllerHarness(new Map([[image, candidate(image, "image")]]));

    harness.controller.start({ origin: "https://news.example", mode: "trusted" });
    harness.observer.emit([image, frame]);

    expect(harness.observer.start).toHaveBeenCalledTimes(1);
    expect(harness.observer.scan).toHaveBeenCalledWith(document);
    expect(harness.renderer.protect).not.toHaveBeenCalled();
  });

  it("keeps matching subject images protected on a Trusted site", () => {
    const trump = document.createElement("img");
    trump.alt = "Donald Trump at a campaign event";
    const unrelated = document.createElement("img");
    unrelated.alt = "A quiet lake";
    document.body.append(trump, unrelated);
    const harness = controllerHarness(new Map([
      [trump, candidate(trump, "image")],
      [unrelated, candidate(unrelated, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Trump", "Donald Trump"] },
    });
    harness.observer.emit([trump, unrelated]);

    expect(harness.renderer.protect).toHaveBeenCalledTimes(1);
    expect(harness.renderer.protect).toHaveBeenCalledWith(
      candidate(trump, "image"),
      expect.objectContaining({ mode: "trusted", blockedSubject: true }),
    );
  });

  it.each([
    ["poster first", ["poster", "video"] as const],
    ["video first", ["video", "poster"] as const],
  ])(
    "keeps one blocked-subject layer over an overlapping poster/video stack when processed %s",
    (_label, order) => {
      const stack = document.createElement("div");
      const poster = document.createElement("img");
      poster.alt = "Donald Trump at an event";
      const video = document.createElement("video");
      video.setAttribute("aria-label", "News clip");
      stack.append(poster, video);
      document.body.append(stack);

      const sharedBox = new DOMRect(20, 30, 320, 180);
      const boxes = new Map<Element, DOMRect>([
        [poster, sharedBox],
        [video, sharedBox],
      ]);
      const classify = (element: Element) => classifyElement(element, {
        box: (target) => boxes.get(target) ?? new DOMRect(),
        style: (target) => getComputedStyle(target),
      });
      const harness = controllerHarness(new Map(), { classify });

      harness.controller.start({
        origin: "https://news.example",
        mode: "trusted",
        blockedSubjects: { enabled: true, keywords: ["Trump"] },
      });
      harness.observer.emit(order.map((item) => item === "poster" ? poster : video));

      const active = harness.renderer.items.filter((item) => !item.isRemoved());
      expect(active).toHaveLength(1);
      expect(active[0]?.candidate.element).toBe(poster);
      expect(active[0]?.options.blockedSubject).toBe(true);
      expect(active[0]?.handle.isRevealed()).toBe(false);
    },
  );

  it("keeps matching subjects protected while a site becomes Trusted", () => {
    const blockedImage = document.createElement("img");
    blockedImage.alt = "Donald Trump at a campaign event";
    const ordinaryImage = document.createElement("img");
    ordinaryImage.alt = "A quiet lake";
    document.body.append(blockedImage, ordinaryImage);
    const blockedSubjects = { enabled: true, keywords: ["Trump"] };
    const harness = controllerHarness(new Map([
      [blockedImage, candidate(blockedImage, "image")],
      [ordinaryImage, candidate(ordinaryImage, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects,
    });
    harness.observer.emit([blockedImage, ordinaryImage]);

    expect(harness.renderer.activeFor(blockedImage)[0]?.options.blockedSubject).toBe(true);
    harness.controller.applyMode("trusted");

    expect(harness.renderer.activeFor(blockedImage)).toHaveLength(1);
    expect(harness.renderer.activeFor(ordinaryImage)).toHaveLength(0);
  });

  it("keeps matching native and provider videos protected while a site becomes Trusted", () => {
    const nativeVideo = document.createElement("video");
    nativeVideo.poster = "donald-trump-campaign.jpg";
    const providerFrame = document.createElement("iframe");
    providerFrame.title = "Donald Trump campaign video";
    document.body.append(nativeVideo, providerFrame);
    const harness = controllerHarness(new Map<Element, MediaCandidate>([
      [nativeVideo, candidate(nativeVideo, "native-video")],
      [providerFrame, candidate(providerFrame, "video-iframe")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([nativeVideo, providerFrame]);
    harness.controller.applyMode("trusted");

    expect(harness.renderer.activeFor(nativeVideo)).toHaveLength(1);
    expect(harness.renderer.activeFor(providerFrame)).toHaveLength(1);
  });

  it("protects matching native and provider videos discovered on a Trusted site", () => {
    const nativeVideo = document.createElement("video");
    nativeVideo.poster = "donald-trump-campaign.jpg";
    const providerFrame = document.createElement("iframe");
    providerFrame.title = "Donald Trump campaign video";
    const harness = controllerHarness(new Map<Element, MediaCandidate>([
      [nativeVideo, candidate(nativeVideo, "native-video")],
      [providerFrame, candidate(providerFrame, "video-iframe")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    document.body.append(nativeVideo, providerFrame);
    harness.observer.emit([nativeVideo, providerFrame]);

    expect(harness.renderer.activeFor(nativeVideo)).toHaveLength(1);
    expect(harness.renderer.activeFor(providerFrame)).toHaveLength(1);
  });

  it("adds ordinary media when a Trusted site becomes Protected without duplicating subjects", () => {
    const blockedImage = document.createElement("img");
    blockedImage.alt = "Donald Trump at a campaign event";
    const ordinaryImage = document.createElement("img");
    ordinaryImage.alt = "A quiet lake";
    document.body.append(blockedImage, ordinaryImage);
    const harness = controllerHarness(new Map([
      [blockedImage, candidate(blockedImage, "image")],
      [ordinaryImage, candidate(ordinaryImage, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([blockedImage, ordinaryImage]);
    harness.controller.applyMode("protected");
    harness.observer.emit([blockedImage, ordinaryImage]);

    expect(harness.renderer.activeFor(blockedImage)).toHaveLength(1);
    expect(harness.renderer.activeFor(ordinaryImage)).toHaveLength(1);
  });

  it("reconciles subject preference changes without replacing matching records", () => {
    const blockedImage = document.createElement("img");
    blockedImage.alt = "Donald Trump at a campaign event";
    const ordinaryImage = document.createElement("img");
    ordinaryImage.alt = "A quiet lake";
    document.body.append(blockedImage, ordinaryImage);
    const enabled = { enabled: true, keywords: ["Trump"] };
    const disabled = { enabled: false, keywords: ["Trump"] };
    const harness = controllerHarness(new Map([
      [blockedImage, candidate(blockedImage, "image")],
      [ordinaryImage, candidate(ordinaryImage, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: disabled,
    });
    harness.observer.emit([blockedImage, ordinaryImage]);
    harness.controller.applyBlockedSubjects(enabled);
    harness.observer.emit([blockedImage, ordinaryImage]);
    const matchingRecord = harness.renderer.activeFor(blockedImage)[0];
    harness.controller.applyBlockedSubjects(enabled);
    harness.observer.emit([blockedImage, ordinaryImage]);

    expect(harness.renderer.activeFor(blockedImage)[0]).toBe(matchingRecord);
    expect(harness.renderer.activeFor(ordinaryImage)).toHaveLength(0);
    harness.controller.applyBlockedSubjects(disabled);
    expect(harness.renderer.activeFor(blockedImage)).toHaveLength(0);
  });

  it("updates a retained protected record's subject reason without losing its reveal", () => {
    const image = document.createElement("img");
    image.alt = "Donald Trump at a campaign event";
    document.body.append(image);
    const harness = controllerHarness(new Map([[image, candidate(image, "image")]]));
    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects: { enabled: false, keywords: ["Trump"] },
    });
    harness.observer.emit([image]);
    const record = harness.renderer.activeFor(image)[0]!;
    record.handle.reveal();

    harness.controller.applyBlockedSubjects({ enabled: true, keywords: ["Trump"] });

    expect(harness.renderer.activeFor(image)[0]).toBe(record);
    expect(record.handle.isRevealed()).toBe(true);
    expect((record.handle as ProtectionHandle & { setBlockedSubject: ReturnType<typeof vi.fn> })
      .setBlockedSubject).toHaveBeenLastCalledWith(true);

    harness.controller.applyBlockedSubjects({ enabled: false, keywords: ["Trump"] });
    expect(harness.renderer.activeFor(image)[0]).toBe(record);
    expect(record.handle.isRevealed()).toBe(true);
    expect((record.handle as ProtectionHandle & { setBlockedSubject: ReturnType<typeof vi.fn> })
      .setBlockedSubject).toHaveBeenLastCalledWith(false);
  });

  it("protects matching subject media discovered after a Trusted site starts", () => {
    const blockedImage = document.createElement("img");
    blockedImage.alt = "Donald Trump at a campaign event";
    const harness = controllerHarness(new Map([
      [blockedImage, candidate(blockedImage, "image")],
    ]));

    harness.controller.start({
      origin: "https://news.example",
      mode: "trusted",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    document.body.append(blockedImage);
    harness.observer.emit([blockedImage]);
    harness.observer.emit([blockedImage]);

    expect(harness.renderer.activeFor(blockedImage)).toHaveLength(1);
  });

  it("classifies, describes, and protects one discovered candidate", () => {
    const image = document.createElement("img");
    document.body.append(image);
    const media = candidate(image, "image");
    const harness = controllerHarness(new Map([[image, media]]));
    harness.controller.start({ origin: "https://news.example", mode: "protected" });

    harness.observer.emit([image]);

    expect(harness.observer.scan).toHaveBeenCalledWith(document);
    expect(harness.classify).toHaveBeenCalledWith(image);
    expect(harness.resolveDescription).toHaveBeenCalledWith(media);
    expect(harness.renderer.protect).toHaveBeenCalledWith(
      media,
      expect.objectContaining({
        description: "Description for image",
        mode: "protected",
      }),
    );
  });

  it("persists the site description choice and applies it to current and future media", () => {
    const first = document.createElement("img");
    const second = document.createElement("img");
    document.body.append(first, second);
    const setDescriptionsVisible = vi.fn();
    const harness = controllerHarness(new Map([
      [first, candidate(first, "image")],
      [second, candidate(second, "image")],
    ]), { setDescriptionsVisible } as Partial<ContentControllerDependencies>);
    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      descriptionsVisible: false,
    });
    harness.observer.emit([first]);

    const firstOptions = harness.renderer.items[0]?.options as ProtectionOptions & {
      onToggleDescriptions?: () => void;
      descriptionsVisible?: boolean;
    };
    expect(firstOptions.descriptionsVisible).toBe(false);
    expect(typeof firstOptions.onToggleDescriptions).toBe("function");
    firstOptions.onToggleDescriptions?.();
    expect(setDescriptionsVisible).toHaveBeenCalledWith("https://news.example", true);
    expect(harness.renderer.items[0]?.handle.setDescriptionVisible).toHaveBeenCalledWith(true);

    harness.observer.emit([second]);
    const secondOptions = harness.renderer.items[1]?.options as ProtectionOptions & {
      descriptionsVisible?: boolean;
    };
    expect(secondOptions.descriptionsVisible).toBe(true);
  });

  it("switching to Trusted removes image and video layers", () => {
    const image = document.createElement("img");
    const video = document.createElement("video");
    const frame = document.createElement("iframe");
    document.body.append(image, video, frame);
    const harness = controllerHarness(
      new Map<Element, MediaCandidate>([
        [image, candidate(image, "image")],
        [video, candidate(video, "native-video")],
        [frame, candidate(frame, "video-iframe")],
      ]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([image, video, frame]);

    harness.controller.applyMode("trusted");

    expect(harness.observer.stop).not.toHaveBeenCalled();
    expect(harness.observer.scan).toHaveBeenLastCalledWith(document);
    expect(harness.renderer.items.map(({ handle }) => handle.remove)).toSatisfy(
      (removes: Array<ReturnType<typeof vi.fn>>) =>
        removes.every((remove) => remove.mock.calls.length === 1),
    );
  });

  it("keeps a deliberately revealed subject visible across a legacy Strict transition", () => {
    const image = document.createElement("img");
    image.alt = "Donald Trump at a campaign event";
    document.body.append(image);
    const harness = controllerHarness(
      new Map([[image, candidate(image, "image")]]),
    );
    harness.controller.start({
      origin: "https://news.example",
      mode: "protected",
      blockedSubjects: { enabled: true, keywords: ["Trump"] },
    });
    harness.observer.emit([image]);
    const matchingRecord = harness.renderer.activeFor(image)[0];
    matchingRecord?.handle.reveal();

    harness.controller.applyMode("strict");

    expect(harness.renderer.activeFor(image)[0]).toBe(matchingRecord);
    expect(matchingRecord?.handle.isRevealed()).toBe(true);
    expect(harness.renderer.protect).toHaveBeenCalledTimes(1);
    expect(matchingRecord?.handle.remove).not.toHaveBeenCalled();
  });

  it("updates protected rectangles on resize and rebuilds on relevant attribute changes", () => {
    const image = document.createElement("img");
    document.body.append(image);
    const harness = controllerHarness(
      new Map([[image, candidate(image, "image")]]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([image]);

    harness.observer.emit([image]);
    expect(harness.classify).toHaveBeenCalledTimes(1);
    expect(harness.renderer.items[0]?.handle.update).toHaveBeenCalledTimes(1);

    image.alt = "Changed description";
    harness.observer.emit([image], [image]);
    expect(harness.renderer.items[0]?.handle.remove).toHaveBeenCalledTimes(1);
    expect(harness.classify).toHaveBeenCalledTimes(2);
    expect(harness.renderer.protect).toHaveBeenCalledTimes(2);
  });

  it("keeps a revealed provider frame visible through presentation-only attribute churn", () => {
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/astronomy?autoplay=1";
    document.body.append(frame);
    const harness = controllerHarness(
      new Map([[frame, candidate(frame, "video-iframe")]]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([frame]);
    harness.renderer.items[0]?.handle.reveal();

    frame.title = "Updated video title";
    harness.observer.emit([frame], [frame]);

    expect(harness.renderer.protect).toHaveBeenCalledTimes(1);
    expect(harness.renderer.items[0]?.handle.isRevealed()).toBe(true);
    expect(harness.renderer.items[0]?.handle.update).toHaveBeenCalledTimes(1);
  });

  it("reclassifies a revealed provider frame after its source is replaced", () => {
    const frame = document.createElement("iframe");
    frame.src = "https://www.youtube.com/embed/first?autoplay=1";
    document.body.append(frame);
    const harness = controllerHarness(
      new Map([[frame, candidate(frame, "video-iframe")]]),
    );
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([frame]);
    harness.renderer.items[0]?.handle.reveal();

    frame.src = "https://player.vimeo.com/video/second?autoplay=1";
    harness.observer.emit([frame], [frame]);

    expect(harness.renderer.items[0]?.handle.remove).toHaveBeenCalledTimes(1);
    expect(harness.renderer.protect).toHaveBeenCalledTimes(2);
    expect(harness.renderer.items[1]?.handle.isRevealed()).toBe(false);
  });

  it("isolates malformed candidates and logs no page-derived values", () => {
    const broken = document.createElement("img");
    broken.alt = "private alt";
    broken.src = "https://private.example/secret.png";
    const healthy = document.createElement("img");
    document.body.append(broken, healthy);
    const healthyCandidate = candidate(healthy, "image");
    const log = vi.fn();
    const classify = vi.fn((element: Element) => {
      if (element === broken) {
        throw new Error("bad https://private.example/secret.png <img alt='private alt'>");
      }
      return healthyCandidate;
    });
    const harness = controllerHarness(new Map(), {
      classify,
      development: true,
      logDiagnostic: log,
    });
    harness.controller.start({ origin: "https://news.example", mode: "protected" });

    harness.observer.emit([broken, healthy]);

    expect(harness.renderer.protect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("IMG", "candidate processing failed");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    expect(JSON.stringify(log.mock.calls)).not.toContain("https://");
    expect(JSON.stringify(log.mock.calls)).not.toContain("<img");
  });

  it("uses the browser development build flag for default sanitized diagnostics", () => {
    const broken = document.createElement("img");
    broken.alt = "private alt";
    broken.src = "https://private.example/secret.png";
    document.body.append(broken);
    const observer = new FakeDocumentObserver();
    const renderer = rendererHarness();
    const log = vi.fn();
    vi.stubGlobal("process", undefined);

    try {
      const controller = new ContentController({
        document,
        observer,
        renderer,
        classify: () => {
          throw new Error("bad https://private.example/secret.png <img alt='private alt'>");
        },
        logDiagnostic: log,
      });
      controller.start({ origin: "https://news.example", mode: "protected" });

      observer.emit([broken]);

      expect(log).toHaveBeenCalledWith("IMG", "candidate processing failed");
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
      expect(JSON.stringify(log.mock.calls)).not.toContain("https://");
      expect(JSON.stringify(log.mock.calls)).not.toContain("<img");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rebuilds a native-video overlay during attribute churn and continues the batch", () => {
    const video = document.createElement("video");
    const healthyImage = document.createElement("img");
    document.body.append(video, healthyImage);
    const videoCandidate = candidate(video, "native-video");
    const imageCandidate = candidate(healthyImage, "image");
    const classify = vi.fn((element: Element) => {
      if (element === video) return videoCandidate;
      return element === healthyImage ? imageCandidate : null;
    });
    const harness = controllerHarness(new Map(), { classify });
    harness.controller.start({ origin: "https://news.example", mode: "protected" });
    harness.observer.emit([video]);

    harness.observer.emit([video, healthyImage], [video]);

    expect(harness.renderer.items[0]?.handle.remove).toHaveBeenCalledTimes(1);
    expect(harness.renderer.protect).toHaveBeenCalledTimes(3);
    expect(harness.renderer.items[2]?.candidate).toBe(imageCandidate);
  });

});

function bootstrapHarness(
  overrides: Partial<ContentBootstrapDependencies> = {},
): {
  dependencies: ContentBootstrapDependencies;
  controller: {
    start: ReturnType<typeof vi.fn>;
    applyMode: ReturnType<typeof vi.fn>;
    applyBlockedSubjects: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  sendMessage: ReturnType<typeof vi.fn>;
  watchPolicy: ReturnType<typeof vi.fn>;
  addPageHideListener: ReturnType<typeof vi.fn>;
} {
  const controller = {
    start: vi.fn(),
    applyMode: vi.fn(),
    applyBlockedSubjects: vi.fn(),
    stop: vi.fn(),
  };
  const sendMessage = vi.fn().mockResolvedValue({
    origin: "https://top.example",
    mode: "strict" satisfies SiteMode,
  });
  const watchPolicy = vi.fn(() => vi.fn());
  const getDescriptionsVisible = vi.fn().mockResolvedValue(false);
  const getBlockedSubjects = vi.fn().mockResolvedValue({ enabled: false, keywords: [] });
  const watchBlockedSubjects = vi.fn(() => vi.fn());
  const addPageHideListener = vi.fn();
  const dependencies: ContentBootstrapDependencies = {
    href: "https://child.example/story",
    isChildFrame: false,
    parentLocation: () => null,
    createController: () => controller,
    sendMessage,
    getDescriptionsVisible,
    getBlockedSubjects,
    watchPolicy,
    watchBlockedSubjects,
    addPageHideListener,
    ...overrides,
  };
  return { dependencies, controller, sendMessage, watchPolicy, addPageHideListener };
}

describe("content-script bootstrap", () => {
  it("falls back to Trusted on non-social sites when policy messaging rejects", async () => {
    const harness = bootstrapHarness({
      sendMessage: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://child.example",
      mode: "trusted",
    });
    expect(harness.watchPolicy).toHaveBeenCalledWith("https://child.example", expect.any(Function));
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("falls back to Trusted on a non-social site when the policy response is malformed", async () => {
    const harness = bootstrapHarness({
      sendMessage: vi.fn().mockResolvedValue({ error: "unsupported-page" }),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://child.example",
      mode: "trusted",
    });
    expect(harness.watchPolicy).toHaveBeenCalledWith("https://child.example", expect.any(Function));
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("falls back to Protected on social sites when policy messaging rejects", async () => {
    const harness = bootstrapHarness({
      href: "https://www.reddit.com/r/goggles",
      sendMessage: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://www.reddit.com",
      mode: "protected",
    });
  });

  it("live-reconciles a fallback contextual action after its policy save", async () => {
    const image = document.createElement("img");
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 200));
    document.body.append(image);
    const observer = new FakeDocumentObserver();
    const renderer = rendererHarness();
    let policyListener: ((mode: SiteMode) => void) | undefined;
    const setSiteMode = vi.fn(async (_origin: string, mode: SiteMode) => {
      policyListener?.(mode);
    });
    const controller = new ContentController({
      document,
      observer,
      renderer,
      classify: (element) => element === image ? candidate(image, "image") : null,
      resolveDescription: () => "A quiet lake",
      enableSiteControl: true,
      setSiteMode,
    });
    const dependencies = bootstrapHarness({
      sendMessage: vi.fn().mockRejectedValue(new Error("worker unavailable")),
      createController: () => controller,
      watchPolicy: vi.fn((_origin, listener) => {
        policyListener = listener;
        return vi.fn();
      }),
    }).dependencies;

    await bootstrapContentScript(dependencies);
    observer.emit([image]);
    const action = renderer.activeFor(image)[0]?.options.siteControl;
    expect(action?.mode).toBe("protected");

    await action?.save();
    observer.emit([image]);

    expect(setSiteMode).toHaveBeenCalledWith("https://child.example", "protected");
    expect(renderer.activeFor(image)).toHaveLength(1);
    expect(renderer.activeFor(image)[0]?.options.mode).toBe("protected");
    expect(renderer.activeFor(image)[0]?.options.siteControl?.mode).toBe("trusted");
  });

  it("keeps configured subject matches frosted after fallback Always show", async () => {
    const subject = document.createElement("img");
    subject.alt = "Donald Trump at an event";
    const ordinary = document.createElement("img");
    ordinary.alt = "A quiet lake";
    vi.spyOn(subject, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 320, 200));
    vi.spyOn(ordinary, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 220, 320, 200));
    document.body.append(subject, ordinary);
    const observer = new FakeDocumentObserver();
    const renderer = new ProtectionRenderer({ trustedActivation: () => true });
    let policyListener: ((mode: SiteMode) => void) | undefined;
    let subjectListener: ((config: BlockedSubjectsConfig) => void) | undefined;
    const setSiteMode = vi.fn(async (_origin: string, mode: SiteMode) => policyListener?.(mode));
    const controller = new ContentController({
      document,
      observer,
      renderer,
      classify: (element) => element === subject
        ? candidate(subject, "image")
        : element === ordinary ? candidate(ordinary, "image") : null,
      resolveDescription: (media) => media.element.getAttribute("alt") ?? "",
      enableSiteControl: true,
      setSiteMode,
    });
    const harness = bootstrapHarness({
      href: "https://old.reddit.com/r/goggles",
      sendMessage: vi.fn().mockRejectedValue(new Error("worker unavailable")),
      createController: () => controller,
      getBlockedSubjects: vi.fn().mockResolvedValue({ enabled: true, keywords: ["Trump"] }),
      watchPolicy: vi.fn((_origin, listener) => {
        policyListener = listener;
        return vi.fn();
      }),
      watchBlockedSubjects: vi.fn((listener) => {
        subjectListener = listener;
        return vi.fn();
      }),
    });

    await bootstrapContentScript(harness.dependencies);
    observer.emit([subject, ordinary]);
    const ordinaryLayer = renderer.debugLayerFor(ordinary)!;
    ordinaryLayer.querySelector<HTMLButtonElement>(".eg-reveal-surface")!.click();
    ordinaryLayer.querySelector<HTMLButtonElement>(".eg-site-action")!.click();
    await vi.waitFor(() => expect(setSiteMode).toHaveBeenCalledWith("https://old.reddit.com", "trusted"));

    expect(subjectListener).toBeTypeOf("function");
    expect(renderer.debugLayerFor(subject)?.querySelector(".eg-reveal-surface")).not.toBeNull();
    expect(subject.getAttribute("data-eclipse-goggles-protected")).toBe("image");
    expect(renderer.debugLayerFor(ordinary)).toBeNull();
  });

  it("starts the returned policy and watches only its exact top origin", async () => {
    const harness = bootstrapHarness();

    await bootstrapContentScript(harness.dependencies);

    expect(harness.sendMessage).toHaveBeenCalledWith({ type: "policy:get-current" });
    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "strict",
      descriptionsVisible: false,
    });
    expect(harness.watchPolicy).toHaveBeenCalledWith(
      "https://top.example",
      expect.any(Function),
    );
    const listener = harness.watchPolicy.mock.calls[0]?.[1] as
      | ((mode: SiteMode) => void)
      | undefined;
    listener?.("trusted");
    expect(harness.controller.applyMode).toHaveBeenCalledWith("trusted");
  });

  it("starts with a policy change received while preferences are still loading", async () => {
    let resolveDescriptions: ((visible: boolean) => void) | undefined;
    const descriptions = new Promise<boolean>((resolve) => {
      resolveDescriptions = resolve;
    });
    let listener: ((mode: SiteMode) => void) | undefined;
    const harness = bootstrapHarness({
      getDescriptionsVisible: vi.fn(() => descriptions),
      watchPolicy: vi.fn((_origin, next) => {
        listener = next;
        return vi.fn();
      }),
    });

    const bootstrapping = bootstrapContentScript(harness.dependencies);
    await vi.waitFor(() => expect(listener).toBeTypeOf("function"));
    listener?.("trusted");
    resolveDescriptions?.(false);
    await bootstrapping;

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "trusted",
      descriptionsVisible: false,
    });
    expect(harness.controller.applyMode).not.toHaveBeenCalled();
  });

  it("confirms the current policy after subscribing so an earlier change is not missed", async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ origin: "https://top.example", mode: "protected" })
      .mockResolvedValueOnce({ origin: "https://top.example", mode: "trusted" });
    const harness = bootstrapHarness({
      sendMessage,
    });

    await bootstrapContentScript(harness.dependencies);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "trusted",
      descriptionsVisible: false,
    });
  });

  it("does not let a stale confirmation overwrite a newer policy event", async () => {
    let resolveConfirmation: ((value: unknown) => void) | undefined;
    const confirmation = new Promise<unknown>((resolve) => {
      resolveConfirmation = resolve;
    });
    let listener: ((mode: SiteMode) => void) | undefined;
    const harness = bootstrapHarness({
      sendMessage: vi.fn()
        .mockResolvedValueOnce({ origin: "https://top.example", mode: "protected" })
        .mockImplementationOnce(() => confirmation),
      watchPolicy: vi.fn((_origin, next) => {
        listener = next;
        return vi.fn();
      }),
    });

    const bootstrapping = bootstrapContentScript(harness.dependencies);
    await vi.waitFor(() => expect(listener).toBeTypeOf("function"));
    listener?.("trusted");
    resolveConfirmation?.({ origin: "https://top.example", mode: "protected" });
    await bootstrapping;

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "trusted",
      descriptionsVisible: false,
    });
  });

  it("starts with a blocked-subject change received while preferences are loading", async () => {
    let resolveSubjects: ((config: { enabled: boolean; keywords: string[] }) => void) | undefined;
    const subjects = new Promise<{ enabled: boolean; keywords: string[] }>((resolve) => {
      resolveSubjects = resolve;
    });
    let listener: ((config: { enabled: boolean; keywords: string[] }) => void) | undefined;
    const harness = bootstrapHarness({
      getBlockedSubjects: vi.fn(() => subjects),
      watchBlockedSubjects: vi.fn((next) => {
        listener = next;
        return vi.fn();
      }),
    });

    const bootstrapping = bootstrapContentScript(harness.dependencies);
    await vi.waitFor(() => expect(listener).toBeTypeOf("function"));
    listener?.({ enabled: true, keywords: ["Donald Trump"] });
    resolveSubjects?.({ enabled: false, keywords: [] });
    await bootstrapping;

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "strict",
      descriptionsVisible: false,
      blockedSubjects: { enabled: true, keywords: ["Donald Trump"] },
    });
    expect(harness.controller.applyBlockedSubjects).not.toHaveBeenCalled();
  });

  it("starts with the permanent description choice for the top origin", async () => {
    const getDescriptionsVisible = vi.fn().mockResolvedValue(true);
    const harness = bootstrapHarness({ getDescriptionsVisible });

    await bootstrapContentScript(harness.dependencies);

    expect(getDescriptionsVisible).toHaveBeenCalledWith("https://top.example");
    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "strict",
      descriptionsVisible: true,
    });
  });

  it("starts and live-updates the enabled blocked-subject preset", async () => {
    const initial = { enabled: true, keywords: ["Trump", "Donald Trump"] };
    let listener: ((config: typeof initial) => void) | undefined;
    const harness = bootstrapHarness({
      getBlockedSubjects: vi.fn().mockResolvedValue(initial),
      watchBlockedSubjects: vi.fn((next) => {
        listener = next;
        return vi.fn();
      }),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "strict",
      descriptionsVisible: false,
      blockedSubjects: initial,
    });
    const updated = { enabled: true, keywords: ["President Trump"] };
    listener?.(updated);
    expect(harness.controller.applyBlockedSubjects).toHaveBeenCalledWith(updated);
  });

  it("keeps the site policy when the optional description preference cannot load", async () => {
    const harness = bootstrapHarness({
      getDescriptionsVisible: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.controller.start).toHaveBeenCalledWith({
      origin: "https://top.example",
      mode: "strict",
      descriptionsVisible: false,
    });
    expect(harness.watchPolicy).toHaveBeenCalledWith(
      "https://top.example",
      expect.any(Function),
    );
  });

  it.each([
    "https://www.youtube.com/embed/abc",
    "https://www.youtube-nocookie.com/embed/abc?start=10",
    "https://player.vimeo.com/video/123#t=5s",
  ])("returns before policy lookup in a recognized provider child document: %s", async (href) => {
    const harness = bootstrapHarness({ href, isChildFrame: true });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(harness.controller.start).not.toHaveBeenCalled();
    expect(harness.watchPolicy).not.toHaveBeenCalled();
  });

  it("allows a child about:blank created by a supported parent", async () => {
    const harness = bootstrapHarness({
      href: "about:blank",
      isChildFrame: true,
      parentLocation: () => ({ protocol: "https:", origin: "https://top.example" }),
    });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.sendMessage).toHaveBeenCalledWith({ type: "policy:get-current" });
    expect(harness.controller.start).toHaveBeenCalled();
  });

  it("returns on unsupported top-level schemes", async () => {
    const harness = bootstrapHarness({ href: "file:///tmp/page.html" });

    await bootstrapContentScript(harness.dependencies);

    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(harness.controller.start).not.toHaveBeenCalled();
  });

  it("stops policy watching and removes visual layers on pagehide", async () => {
    const stopWatching = vi.fn();
    const harness = bootstrapHarness({ watchPolicy: vi.fn(() => stopWatching) });
    await bootstrapContentScript(harness.dependencies);

    const onPageHide = harness.addPageHideListener.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    onPageHide?.();

    expect(stopWatching).toHaveBeenCalledTimes(1);
    expect(harness.controller.stop).toHaveBeenCalledWith();
  });

  it("does not start after pagehide wins a pending policy lookup", async () => {
    let resolvePolicy!: (value: unknown) => void;
    const pendingPolicy = new Promise<unknown>((resolve) => {
      resolvePolicy = resolve;
    });
    const harness = bootstrapHarness({ sendMessage: vi.fn(() => pendingPolicy) });

    const bootstrap = bootstrapContentScript(harness.dependencies);
    const onPageHide = harness.addPageHideListener.mock.calls[0]?.[0] as
      | (() => void)
      | undefined;
    onPageHide?.();
    resolvePolicy({ origin: "https://top.example", mode: "strict" });
    await bootstrap;

    expect(harness.controller.stop).toHaveBeenCalledWith();
    expect(harness.controller.start).not.toHaveBeenCalled();
    expect(harness.watchPolicy).not.toHaveBeenCalled();
  });
});
