import type { SiteMode } from "./media-types";

type StorageArea = {
  get(key: null | string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(key: string | string[]): Promise<void>;
};

type StorageChange = { newValue?: unknown };
type StorageChangeListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void;

type StorageChangeEvent = {
  addListener(listener: StorageChangeListener): void;
  removeListener(listener: StorageChangeListener): void;
};

const socialMigrationPromises = new WeakMap<StorageArea, Promise<void>>();

const protectedMode: SiteMode = "protected";
const trustedMode: SiteMode = "trusted";
const redditPseudoCommunities = new Set(["all", "popular", "mod", "friends"]);
export const defaultPolicyKey = "default-site-mode";

export const socialPlatforms = [
  { id: "facebook", hosts: ["facebook.com"] },
  { id: "instagram", hosts: ["instagram.com"] },
  { id: "reddit", hosts: ["reddit.com"] },
  { id: "x", hosts: ["x.com", "twitter.com"] },
  { id: "tiktok", hosts: ["tiktok.com"] },
  { id: "threads", hosts: ["threads.com", "threads.net"] },
  { id: "bluesky", hosts: ["bsky.app"] },
  { id: "youtube", hosts: ["youtube.com"] },
] as const;

export type SocialPlatformId = (typeof socialPlatforms)[number]["id"];
export type SocialPlatform = (typeof socialPlatforms)[number];

export interface RedditCommunity {
  displayName: string;
  canonicalName: string;
}

export interface RedditPolicyContext extends RedditCommunity {
  inheritedMode: Exclude<SiteMode, "strict">;
  hasOverride: boolean;
}

export interface PolicyResolution {
  mode: SiteMode;
  reddit?: RedditPolicyContext;
}

export function policyKey(origin: string): string {
  return `site-policy:${origin}`;
}

export function socialPolicyKey(platform: SocialPlatformId): string {
  return `social-policy:${platform}`;
}

export function subredditPolicyKey(name: string): string {
  return `reddit-subreddit-policy:${name.toLowerCase()}`;
}

export function subredditDisplayKey(name: string): string {
  return `reddit-subreddit-display:${name.toLowerCase()}`;
}

export function descriptionsKey(origin: string): string {
  return `site-descriptions:${origin}`;
}

export function isSiteMode(value: unknown): value is SiteMode {
  return value === "trusted" || value === "protected" || value === "strict";
}

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function socialPlatformForOrigin(origin: string): SocialPlatform | null {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return null;

  const hostname = new URL(normalizedOrigin).hostname;
  return socialPlatforms.find(({ hosts }) =>
    hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)),
  ) ?? null;
}

export function parseRedditCommunity(value: string): RedditCommunity | null {
  try {
    const url = new URL(value);
    if (socialPlatformForOrigin(url.origin)?.id !== "reddit") return null;

    const segments = url.pathname.split("/");
    const displayName = segments[1] === "r" ? segments[2] : undefined;
    if (!displayName || !/^[A-Za-z0-9_]{3,21}$/.test(displayName)) return null;

    const canonicalName = displayName.toLowerCase();
    if (redditPseudoCommunities.has(canonicalName)) return null;

    return { displayName, canonicalName };
  } catch {
    return null;
  }
}

export function defaultPolicyForOrigin(origin: string): SiteMode {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return protectedMode;
  return socialPlatformForOrigin(normalizedOrigin) ? protectedMode : trustedMode;
}

function supportedMode(value: unknown): SiteMode | null {
  if (value === "strict") return "protected";
  return value === "trusted" || value === "protected" ? value : null;
}

function supportedSubredditMode(value: unknown): Exclude<SiteMode, "strict"> | null {
  return value === "trusted" || value === "protected" ? value : null;
}

function canonicalSubredditName(value: string): string | null {
  return /^[A-Za-z0-9_]{3,21}$/.test(value) ? value.toLowerCase() : null;
}

export function isCanonicalSubredditName(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_]{3,21}$/.test(value);
}

export function isSubredditDisplayNameForCanonical(
  value: unknown,
  canonicalName: string,
): value is string {
  return typeof value === "string" && canonicalSubredditName(value) === canonicalName;
}

export class SitePolicyStore {
  constructor(
    private readonly area: StorageArea,
    private readonly onChanged?: StorageChangeEvent,
  ) {}

  async get(origin: string): Promise<SiteMode> {
    return (await this.resolve(origin)).mode;
  }

  async resolve(value: string): Promise<PolicyResolution> {
    const normalizedOrigin = normalizeOrigin(value);
    if (!normalizedOrigin) return { mode: defaultPolicyForOrigin(value) };

    const exactKey = policyKey(normalizedOrigin);
    const platform = socialPlatformForOrigin(normalizedOrigin);
    if (!platform) {
      return { mode: supportedMode((await this.area.get(exactKey))[exactKey]) ?? trustedMode };
    }

    const platformKey = socialPolicyKey(platform.id);
    const community = parseRedditCommunity(value);
    const subredditKey = community ? subredditPolicyKey(community.canonicalName) : null;
    const values = await this.area.get([
      ...(subredditKey ? [subredditKey] : []),
      platformKey,
      exactKey,
    ]);
    const inherited = platformKey in values
      ? supportedMode(values[platformKey]) ?? protectedMode
      : supportedMode(values[exactKey]) ?? protectedMode;
    const inheritedMode: Exclude<SiteMode, "strict"> =
      inherited === "trusted" ? "trusted" : "protected";
    if (!community || !subredditKey) return { mode: inheritedMode };

    const override = supportedSubredditMode(values[subredditKey]);
    return {
      mode: override ?? inheritedMode,
      reddit: {
        ...community,
        inheritedMode,
        hasOverride: override !== null,
      },
    };
  }

  async set(origin: string, mode: SiteMode): Promise<void> {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) return;

    const platform = socialPlatformForOrigin(normalizedOrigin);
    const key = platform ? socialPolicyKey(platform.id) : policyKey(normalizedOrigin);
    await this.area.set({ [key]: supportedMode(mode) ?? protectedMode });
  }

  async setDefault(mode: Exclude<SiteMode, "trusted">): Promise<void> {
    await this.area.set({ [defaultPolicyKey]: supportedMode(mode) ?? protectedMode });
  }

  async setSubreddit(
    name: string,
    mode: Exclude<SiteMode, "strict">,
    displayName?: string,
  ): Promise<void> {
    const canonicalName = canonicalSubredditName(name);
    if (!canonicalName) return;
    await this.area.set({
      [subredditPolicyKey(canonicalName)]: mode,
      ...(isSubredditDisplayNameForCanonical(displayName, canonicalName)
        ? { [subredditDisplayKey(canonicalName)]: displayName }
        : {}),
    });
  }

  async resetSubreddit(name: string): Promise<void> {
    const canonicalName = canonicalSubredditName(name);
    if (!canonicalName) return;
    await this.area.remove?.([
      subredditPolicyKey(canonicalName),
      subredditDisplayKey(canonicalName),
    ]);
  }

  async getDescriptionsVisible(origin: string): Promise<boolean> {
    const key = descriptionsKey(origin);
    return (await this.area.get(key))[key] === true;
  }

  async setDescriptionsVisible(origin: string, visible: boolean): Promise<void> {
    await this.area.set({ [descriptionsKey(origin)]: visible });
  }

  watch(origin: string, listener: (mode: SiteMode) => void): () => void {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) return () => {};

    const exactKey = policyKey(normalizedOrigin);
    const platform = socialPlatformForOrigin(normalizedOrigin);
    const community = parseRedditCommunity(origin);
    const keys = platform
      ? [
        ...(community ? [subredditPolicyKey(community.canonicalName)] : []),
        socialPolicyKey(platform.id),
        exactKey,
      ]
      : [exactKey];
    const onChange: StorageChangeListener = (changes, areaName) => {
      if (areaName !== "local" || !keys.some((key) => key in changes)) return;

      void this.get(origin).then(listener);
    };

    this.onChanged?.addListener(onChange);

    return () => this.onChanged?.removeListener(onChange);
  }
}

async function migrateSocialPolicies(area: StorageArea): Promise<void> {
  const values = await area.get(null) ?? {};
  const updates: Record<string, SiteMode> = {};

  for (const platform of socialPlatforms) {
    const platformKey = socialPolicyKey(platform.id);
    if (platformKey in values) continue;

    const hasTrustedLegacyRule = Object.entries(values).some(([key, value]) => {
      if (!key.startsWith("site-policy:") || supportedMode(value) !== trustedMode) return false;
      const origin = key.slice("site-policy:".length);
      return normalizeOrigin(origin) === origin && socialPlatformForOrigin(origin)?.id === platform.id;
    });
    if (hasTrustedLegacyRule) updates[platformKey] = trustedMode;
  }

  if (Object.keys(updates).length > 0) await area.set(updates);
}

export function prepareSocialPolicies(area: StorageArea): Promise<void> {
  let migration = socialMigrationPromises.get(area);
  if (!migration) {
    migration = migrateSocialPolicies(area).catch(() => {
      socialMigrationPromises.delete(area);
    });
    socialMigrationPromises.set(area, migration);
  }
  return migration;
}
