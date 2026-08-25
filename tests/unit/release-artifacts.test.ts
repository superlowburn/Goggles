import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readJson = (path: string): { version: string } =>
  JSON.parse(readFileSync(path, "utf8")) as { version: string };

describe("v0.2 release artifacts", () => {
  it("uses version 0.2.0 in package and manifest metadata", () => {
    const packagedManifest = JSON.parse(execFileSync(
      "unzip",
      ["-p", "goggles-0.2.0.zip", "manifest.json"],
      { encoding: "utf8" },
    )) as { version: string };
    expect([
      readJson("package.json").version,
      readJson("package-lock.json").version,
      readJson("manifest.json").version,
      readJson("public/manifest.json").version,
      packagedManifest.version,
    ]).toEqual(["0.2.0", "0.2.0", "0.2.0", "0.2.0", "0.2.0"]);
  });

  it("packages the built extension at the ZIP root without removed provider assets", () => {
    const entries = execFileSync("unzip", ["-Z1", "goggles-0.2.0.zip"], {
      encoding: "utf8",
    }).trim().split("\n");

    expect(entries).toContain("manifest.json");
    expect(entries.some((entry) => entry.startsWith("dist/"))).toBe(false);
    expect(entries.some((entry) => /provider-(?:blocked|rules)/u.test(entry))).toBe(false);
  });
});
