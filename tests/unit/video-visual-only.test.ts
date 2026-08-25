import { describe, expect, it, vi } from "vitest";
import {
  ContentController,
  type DocumentObserverPort,
} from "../../src/content/content-controller";
import type { MediaCandidate } from "../../src/shared/media-types";
import {
  ProtectionRenderer,
  type ProtectionHandle,
  type ProtectionOptions,
} from "../../src/protection/renderer";

class Observer implements DocumentObserverPort {
  private callback: ((elements: readonly Element[]) => void) | undefined;

  start(callback: (elements: readonly Element[]) => void): void {
    this.callback = callback;
  }

  scan(): void {}

  stop(): void {}

  emit(elements: readonly Element[]): void {
    this.callback?.(elements);
  }
}

describe("video protection", () => {
  it("changes only overlays for native video and supported provider frames", () => {
    const video = document.createElement("video");
    const frame = document.createElement("iframe");
    const source = "https://www.youtube.com/embed/astronomy?autoplay=1&start=12";
    frame.setAttribute("src", source);
    document.body.append(video, frame);
    const play = video.play;
    const pause = vi.spyOn(video, "pause");
    const observer = new Observer();
    const handles: Array<{ options: ProtectionOptions; handle: ProtectionHandle }> = [];
    const renderer = {
      protect: vi.fn((_candidate: MediaCandidate, options: ProtectionOptions) => {
        const handle = {
          reveal: vi.fn(),
          reprotect: vi.fn(),
          remove: vi.fn(),
          update: vi.fn(),
          setBlockedSubject: vi.fn(),
          setDescriptionVisible: vi.fn(),
          isRevealed: () => false,
        } as ProtectionHandle;
        handles.push({ options, handle });
        return handle;
      }),
    };
    const candidates = new Map<Element, MediaCandidate>([
      [video, { element: video, kind: "native-video" }],
      [frame, { element: frame, kind: "video-iframe" }],
    ]);
    const controller = new ContentController({
      document,
      observer,
      renderer,
      classify: (element) => candidates.get(element) ?? null,
      resolveDescription: () => "Video",
      development: false,
    });

    controller.start({ origin: "https://news.example", mode: "protected" });
    observer.emit([video, frame]);
    handles.forEach(({ handle }) => {
      handle.reveal();
      handle.reprotect();
    });

    expect(renderer.protect).toHaveBeenCalledTimes(2);
    expect(video.play).toBe(play);
    expect(video.muted).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    expect(frame.getAttribute("src")).toBe(source);
  });

  it("reveal and refrost change only the native-video overlay", () => {
    const video = document.createElement("video");
    const play = video.play;
    const pause = vi.spyOn(video, "pause");
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 640, 360),
    );
    document.body.append(video);
    const renderer = new ProtectionRenderer({ trustedActivation: () => true });
    const handle = renderer.protect({ element: video, kind: "native-video" }, {
      description: "Video",
      mode: "protected",
      onToggleDescriptions: vi.fn(),
      descriptionsVisible: false,
    });

    handle.reveal();
    handle.reprotect();

    expect(video.getAttribute("data-eclipse-goggles-protected")).toBe("video");
    expect(video.play).toBe(play);
    expect(video.muted).toBe(false);
    expect(pause).not.toHaveBeenCalled();
  });
});
