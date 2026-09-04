import { describe, expect, it } from "vitest";
import { isSupportedVideoFrame, supportedProviderUrl } from "../../src/media/provider-frames";

function frame(source?: string): HTMLIFrameElement {
  const element = document.createElement("iframe");
  if (source !== undefined) element.setAttribute("src", source);
  return element;
}

describe("provider frame recognition", () => {
  it.each([
    "https://www.youtube.com/embed/abc123",
    "https://www.youtube-nocookie.com/embed/abc123",
    "https://player.vimeo.com/video/123456",
  ])("recognizes the supported provider embed %s", (source) => {
    expect(isSupportedVideoFrame(frame(source))).toBe(true);
    expect(supportedProviderUrl(source)?.href).toBe(source);
  });

  it.each([
    "https://www.youtube.com/watch?v=abc123",
    "https://www.google.com/maps/embed?pb=location",
    "https://docs.google.com/forms/d/e/form-id/viewform",
    "",
    "https://www.youtube.com.evil.test/embed/abc123",
    "https://player.vimeo.com.evil.test/video/123456",
    "http://www.youtube.com/embed/abc123",
  ])("rejects the unsupported or deceptive source %j", (source) => {
    expect(isSupportedVideoFrame(frame(source))).toBe(false);
    expect(supportedProviderUrl(source)).toBeNull();
  });

  it("rejects non-iframe elements", () => {
    expect(isSupportedVideoFrame(document.createElement("video"))).toBe(false);
  });
});
