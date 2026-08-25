import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));

  it("loads the content script at document_start in every frame", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.content_scripts).toEqual([
      expect.objectContaining({
        matches: ["http://*/*", "https://*/*"],
        js: ["shadow-bridge.js"],
        run_at: "document_start",
        world: "MAIN",
        all_frames: true,
        match_about_blank: true,
        match_origin_as_fallback: true,
      }),
      expect.objectContaining({
      matches: ["http://*/*", "https://*/*"],
      js: ["content.js"],
      run_at: "document_start",
      all_frames: true,
      match_about_blank: true,
      match_origin_as_fallback: true,
      }),
    ]);
  });

  it("requests only the agreed permissions", () => {
    expect(manifest.permissions.sort()).toEqual([
      "activeTab",
      "storage",
    ].sort());
    expect(manifest.host_permissions).toBeUndefined();
  });

  it("ships no browser-level provider request gate", () => {
    expect(manifest.declarative_net_request).toBeUndefined();
    expect(manifest.web_accessible_resources).toBeUndefined();
    expect(existsSync("public/provider-rules.json")).toBe(false);
    expect(existsSync("public/provider-blocked.html")).toBe(false);
  });

  it("can be loaded unpacked from the project root after building", () => {
    expect(existsSync("manifest.json")).toBe(true);
    expect(existsSync("provider-blocked.html")).toBe(false);
    if (!existsSync("manifest.json")) return;

    const rootManifest = JSON.parse(readFileSync("manifest.json", "utf8"));
    expect(rootManifest.permissions.sort()).toEqual(["activeTab", "storage"]);
    expect(rootManifest.declarative_net_request).toBeUndefined();
    expect(rootManifest.web_accessible_resources).toBeUndefined();
    expect(rootManifest.background.service_worker).toBe("dist/service-worker.js");
    expect(rootManifest.action.default_popup).toBe("dist/popup/popup.html");
    expect(rootManifest.content_scripts.map((script: { js: string[] }) => script.js)).toEqual([
      ["dist/shadow-bridge.js"],
      ["dist/content.js"],
    ]);
  });
});
