import type { MediaCandidate } from "./media-types";

type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

type StorageChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  area: string,
) => void;

type StorageChangeEvent = {
  addListener(listener: StorageChangeListener): void;
  removeListener(listener: StorageChangeListener): void;
};

export interface BlockedSubject {
  name: string;
  enabled: boolean;
  keywords: string[];
}

export interface BlockedSubjectsConfig {
  subjects?: BlockedSubject[];
  enabled?: boolean;
  keywords?: string[];
}

export const blockedSubjectsKey = "blocked-subjects";
export const defaultTrumpKeywords = [
  "Donald Trump",
  "Donald J. Trump",
  "President Trump",
  "Former President Trump",
  "Trump",
  "@realDonaldTrump",
  "The Donald",
];

export function parseBlockedSubjects(value: unknown): BlockedSubjectsConfig {
  if (!value || typeof value !== "object") {
    return { subjects: defaultSubjects() };
  }
  const candidate = value as { subjects?: unknown; enabled?: unknown; keywords?: unknown };
  if (Array.isArray(candidate.subjects)) {
    const subjects = candidate.subjects.flatMap((subject) => {
      if (!subject || typeof subject !== "object") return [];
      const item = subject as { name?: unknown; enabled?: unknown; keywords?: unknown };
      const name = typeof item.name === "string" ? normalizeName(item.name) : "";
      const keywords = Array.isArray(item.keywords)
        ? uniqueKeywords(item.keywords.filter((keyword): keyword is string => typeof keyword === "string"))
        : [];
      return name && keywords.length > 0
        ? [{ name, enabled: item.enabled === true, keywords }]
        : [];
    });
    return { subjects };
  }
  const keywords = Array.isArray(candidate.keywords)
    ? uniqueKeywords(candidate.keywords.filter((item): item is string => typeof item === "string"))
    : [];
  return {
    subjects: [{
      name: "Donald Trump",
      enabled: candidate.enabled === true,
      keywords: keywords.length > 0 ? keywords : [...defaultTrumpKeywords],
    }],
  };
}

export function suggestSubjectKeywords(name: string): string[] {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  const parts = normalized.split(" ");
  return uniqueKeywords([normalized, ...(parts.length > 1 ? [parts.at(-1)!] : [])]);
}

export function matchesBlockedSubject(
  element: HTMLElement,
  keywords: readonly string[],
): boolean {
  return textMatchesBlockedSubject(subjectContext(element), keywords);
}

export function candidateMatchesBlockedSubject(
  candidate: MediaCandidate,
  config: BlockedSubjectsConfig,
): boolean {
  const keywords = enabledSubjectKeywords(config);
  return keywords.length > 0 &&
    isSubjectCandidate(candidate) &&
    (matchesBlockedSubject(candidate.element, keywords) ||
      (candidate.kind === "background-image" && textMatchesBlockedSubject(
        candidate.element.ownerDocument.defaultView?.getComputedStyle(candidate.element).backgroundImage ?? "",
        keywords,
      )));
}

export function hasEnabledBlockedSubjects(config: BlockedSubjectsConfig): boolean {
  return enabledSubjectKeywords(config).length > 0;
}

export class BlockedSubjectsStore {
  constructor(
    private readonly area: StorageArea,
    private readonly onChanged?: StorageChangeEvent,
  ) {}

  async get(): Promise<BlockedSubjectsConfig> {
    return parseBlockedSubjects((await this.area.get(blockedSubjectsKey))[blockedSubjectsKey]);
  }

  async set(config: BlockedSubjectsConfig): Promise<void> {
    await this.area.set({ [blockedSubjectsKey]: parseBlockedSubjects(config) });
  }

  watch(listener: (config: BlockedSubjectsConfig) => void): () => void {
    const onChange: StorageChangeListener = (changes, area) => {
      if (area === "local" && blockedSubjectsKey in changes) {
        listener(parseBlockedSubjects(changes[blockedSubjectsKey]?.newValue));
      }
    };
    this.onChanged?.addListener(onChange);
    return () => this.onChanged?.removeListener(onChange);
  }
}

export function uniqueKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  return keywords.flatMap((keyword) => {
    const normalized = keyword.replace(/\s+/gu, " ").trim();
    const key = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function normalizeName(name: string): string {
  return name.replace(/\s+/gu, " ").trim();
}

function defaultSubjects(): BlockedSubject[] {
  return [{ name: "Donald Trump", enabled: false, keywords: [...defaultTrumpKeywords] }];
}

function enabledSubjectKeywords(config: BlockedSubjectsConfig): string[] {
  if (config.subjects) {
    return config.subjects
      .filter((subject) => subject.enabled)
      .flatMap((subject) => subject.keywords);
  }
  return config.enabled ? config.keywords ?? [] : [];
}

function subjectContext(element: HTMLElement): string {
  const values = ["alt", "aria-label", "title", "src", "data-src", "poster"]
    .map((name) => element.getAttribute(name) ?? "");
  const link = element.closest("a[href]");
  if (link) values.push(
    link.getAttribute("href") ?? "",
    link.getAttribute("aria-label") ?? "",
    link.getAttribute("title") ?? "",
  );
  const containers = new Set([
    element.closest("figure, shreddit-post, [data-testid*='post']"),
    element.closest("article"),
  ]);
  for (const container of containers) {
    if (!container) continue;
    values.push(...Array.from(container.querySelectorAll(
      "h1, h2, h3, h4, figcaption, [slot='title'], [slot='post-title']",
    )).map((node) => node.textContent ?? ""));
  }
  return values.join(" ").replace(/\s+/gu, " ");
}

function isSubjectCandidate(candidate: MediaCandidate): boolean {
  return candidate.kind === "image" ||
    candidate.kind === "background-image" ||
    candidate.kind === "native-video" ||
    candidate.kind === "video-iframe";
}

function subjectPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu");
}

function textMatchesBlockedSubject(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => subjectPattern(keyword).test(text));
}
