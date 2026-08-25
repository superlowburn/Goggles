import type { SocialPlatformId } from "./site-policy";

export type SiteMode = "trusted" | "protected" | "strict";

export type MediaKind =
  | "image"
  | "background-image"
  | "native-video"
  | "video-iframe";

export interface MediaCandidate {
  element: HTMLElement;
  kind: MediaKind;
}

export interface PolicyContext {
  origin: string;
  mode: SiteMode;
  descriptionsVisible?: boolean;
  blockedSubjects?: import("./blocked-subjects").BlockedSubjectsConfig;
}

export type ExtensionMessage =
  | { type: "policy:get-current" }
  | { type: "policy:get-tab"; tabId: number }
  | { type: "policy:set-tab"; tabId: number; mode: SiteMode; expectedOrigin: string }
  | { type: "policy:get-social" }
  | {
    type: "policy:set-social";
    platform: SocialPlatformId;
    mode: Exclude<SiteMode, "strict">;
  }
  | { type: "options:open" };
