import { classifyElement } from "../media/classifier";
import { resolveDescription } from "../media/description";
import {
  ProtectionRenderer,
  isSiteControlEligible,
  type ProtectionHandle,
  type ProtectionOptions,
  type SiteControl,
} from "../protection/renderer";
import type {
  MediaCandidate,
  PolicyContext,
  SiteMode,
} from "../shared/media-types";
import {
  candidateMatchesBlockedSubject,
  parseBlockedSubjects,
  type BlockedSubjectsConfig,
} from "../shared/blocked-subjects";
import { socialPlatformForOrigin } from "../shared/site-policy";
import { DocumentObserver } from "./document-observer";

declare const __DEV__: boolean;

export interface DocumentObserverPort {
  start(
    onCandidates: (elements: readonly Element[]) => void,
    onLayoutChange?: () => void,
  ): void;
  scan(root: ParentNode): void;
  stop(): void;
  hadRelevantAttributeChange?(element: Element): boolean;
  trackLayout?(element: Element): void;
  untrackLayout?(element: Element): void;
}

interface RendererPort {
  protect(candidate: MediaCandidate, options: ProtectionOptions): ProtectionHandle;
}

export interface ContentControllerDependencies {
  document?: Document;
  observer?: DocumentObserverPort;
  renderer?: RendererPort;
  classify?: (element: Element) => MediaCandidate | null;
  resolveDescription?: (candidate: MediaCandidate) => string;
  development?: boolean;
  logDiagnostic?: (tagName: string, message: string) => void;
  setSiteMode?: (origin: string, mode: SiteMode) => void | Promise<void>;
  setDescriptionsVisible?: (origin: string, visible: boolean) => void | Promise<void>;
  openSettings?: () => void | Promise<void>;
  enableSiteControl?: boolean;
}

interface ProtectionRecord {
  candidate: MediaCandidate;
  handle: ProtectionHandle;
  passive: boolean;
  providerSource?: string | null;
}

export class ContentController {
  private readonly document: Document;
  private readonly observer: DocumentObserverPort;
  private readonly renderer: RendererPort;
  private readonly classify: (element: Element) => MediaCandidate | null;
  private readonly describe: (candidate: MediaCandidate) => string;
  private readonly development: boolean;
  private readonly logDiagnostic: (tagName: string, message: string) => void;
  private readonly setDescriptionsVisible: (origin: string, visible: boolean) => void | Promise<void>;
  private readonly setSiteMode: (origin: string, mode: SiteMode) => void | Promise<void>;
  private readonly enableSiteControl: boolean;
  private readonly byElement = new WeakMap<Element, ProtectionRecord>();
  private readonly records = new Set<ProtectionRecord>();
  private mode: SiteMode = "trusted";
  private origin: string | null = null;
  private descriptionsVisible = true;
  private blockedSubjects = parseBlockedSubjects(null);
  private started = false;
  private observing = false;

  constructor(dependencies: ContentControllerDependencies = {}) {
    this.document = dependencies.document ?? document;
    this.observer = dependencies.observer ?? new DocumentObserver({ document: this.document });
    this.renderer = dependencies.renderer ??
      new ProtectionRenderer({
        document: this.document,
        window: this.document.defaultView ?? window,
      });
    const view = this.document.defaultView ?? window;
    this.classify = dependencies.classify ??
      ((element) =>
        classifyElement(element, {
          box: (target) => target.getBoundingClientRect(),
          style: (target) => view.getComputedStyle(target),
        }));
    this.describe = dependencies.resolveDescription ?? resolveDescription;
    this.development = dependencies.development ?? isDevelopmentRuntime();
    this.logDiagnostic = dependencies.logDiagnostic ??
      ((tagName, message) => console.warn(`Goggles: ${tagName}: ${message}`));
    this.setDescriptionsVisible = dependencies.setDescriptionsVisible ?? (() => undefined);
    this.setSiteMode = dependencies.setSiteMode ?? (() => undefined);
    this.enableSiteControl = dependencies.enableSiteControl ?? false;
  }

  start(context: PolicyContext): void {
    if (this.started) this.stop();
    this.started = true;
    this.origin = context.origin;
    this.mode = normalizeMode(context.mode);
    this.descriptionsVisible = context.descriptionsVisible ?? false;
    this.blockedSubjects = parseBlockedSubjects(context.blockedSubjects);
    this.startObservation();
  }

  applyMode(mode: SiteMode): void {
    mode = normalizeMode(mode);
    if (!this.started || mode === this.mode) return;

    this.mode = mode;
    this.reconcileProtection();
  }

  applyBlockedSubjects(config: BlockedSubjectsConfig): void {
    this.blockedSubjects = parseBlockedSubjects(config);
    if (this.started) this.reconcileProtection();
  }

  stop(): void {
    this.stopObservation();
    this.clearProtection();
    this.mode = "trusted";
    this.origin = null;
    this.started = false;
  }

  private startObservation(): void {
    if (this.observing) return;
    this.observing = true;
    this.observer.start(
      (elements) => {
        for (const element of elements) this.processCandidate(element);
      },
      () => {
        for (const record of this.records) record.handle.update();
      },
    );
    this.observer.scan(this.document);
  }

  private stopObservation(): void {
    if (!this.observing) return;
    this.observer.stop();
    this.observing = false;
  }

  private processCandidate(element: Element): void {
    try {
      const existing = this.byElement.get(element);
      if (existing) {
        if (!element.isConnected) {
          this.detachRecord(existing);
          return;
        }

        if (!this.observer.hadRelevantAttributeChange?.(element)) {
          existing.handle.update();
          return;
        }

        if (existing.handle.isRevealed() && (
          existing.candidate.kind !== "video-iframe" ||
          (element instanceof HTMLIFrameElement &&
            element.getAttribute("src") === existing.providerSource)
        )) {
          existing.handle.update();
          return;
        }

        this.detachRecord(existing);
      }

      if (!element.isConnected) return;
      if (this.mode === "trusted") {
        const candidate = this.classify(element);
        if (!candidate) return;
        const blockedSubject = candidateMatchesBlockedSubject(candidate, this.blockedSubjects);
        if (blockedSubject || (this.offersTrustedSiteControl() && isSiteControlEligible(candidate))) {
          this.createProtection(candidate, blockedSubject);
        }
        return;
      }
      const candidate = this.classify(element);
      if (!candidate) return;
      this.createProtection(candidate);
    } catch {
      this.reportCandidateFailure(element);
    }
  }

  private createProtection(
    candidate: MediaCandidate,
    blockedSubject = candidateMatchesBlockedSubject(candidate, this.blockedSubjects),
  ): void {
    if (isVisualCandidate(candidate) && this.hasOverlappingVideoRecord(candidate)) return;
    if (isVideoCandidate(candidate)) this.removeOverlappingVisualRecords(candidate);

    const siteControl = this.siteControl(blockedSubject);
    const handle = this.renderer.protect(candidate, {
      description: this.describe(candidate),
      blockedSubject,
      mode: this.mode,
      onToggleDescriptions: () => this.toggleDescriptions(),
      descriptionsVisible: this.descriptionsVisible,
      ...(siteControl ? { siteControl } : {}),
    });
    const record: ProtectionRecord = {
      candidate,
      handle,
      passive: this.mode === "trusted" && !blockedSubject,
      ...(candidate.kind === "video-iframe" && candidate.element instanceof HTMLIFrameElement
        ? { providerSource: candidate.element.getAttribute("src") }
        : {}),
    };
    this.byElement.set(candidate.element, record);
    this.records.add(record);
    this.observer.trackLayout?.(candidate.element);
  }

  private offersTrustedSiteControl(): boolean {
    return this.enableSiteControl && Boolean(this.origin) && !socialPlatformForOrigin(this.origin!);
  }

  private siteControl(blockedSubject: boolean): SiteControl | undefined {
    if (!this.enableSiteControl || !this.origin) return undefined;
    if (this.mode === "trusted") {
      if (blockedSubject || socialPlatformForOrigin(this.origin)) return undefined;
      return {
        mode: "protected",
        save: () => Promise.resolve(this.setSiteMode(this.origin!, "protected")),
      };
    }
    return {
      mode: "trusted",
      save: () => Promise.resolve(this.setSiteMode(this.origin!, "trusted")),
    };
  }

  private hasOverlappingVideoRecord(candidate: MediaCandidate): boolean {
    for (const record of this.records) {
      if (
        isVideoCandidate(record.candidate) &&
        sharesOverlappingMediaStack(candidate.element, record.candidate.element)
      ) {
        return true;
      }
    }
    return false;
  }

  private removeOverlappingVisualRecords(candidate: MediaCandidate): void {
    for (const record of [...this.records]) {
      if (
        isVisualCandidate(record.candidate) &&
        sharesOverlappingMediaStack(record.candidate.element, candidate.element)
      ) {
        this.detachRecord(record);
      }
    }
  }

  private toggleDescriptions(): void {
    this.descriptionsVisible = !this.descriptionsVisible;
    if (this.origin) {
      void Promise.resolve(this.setDescriptionsVisible(this.origin, this.descriptionsVisible))
        .catch(() => undefined);
    }
    for (const record of this.records) {
      record.handle.setDescriptionVisible(this.descriptionsVisible);
    }
  }

  private detachRecord(record: ProtectionRecord): void {
    record.handle.remove();
    this.records.delete(record);
    this.byElement.delete(record.candidate.element);
    this.observer.untrackLayout?.(record.candidate.element);
  }

  private clearProtection(): void {
    for (const record of [...this.records]) {
      this.detachRecord(record);
    }
  }

  private reconcileProtection(): void {
    for (const record of [...this.records]) {
      const blockedSubject = candidateMatchesBlockedSubject(record.candidate, this.blockedSubjects);
      const shouldBePassive = this.mode === "trusted" && !blockedSubject && this.offersTrustedSiteControl();
      if (
        !record.candidate.element.isConnected ||
        (this.mode === "trusted" && !blockedSubject && !shouldBePassive) ||
        record.passive !== shouldBePassive
      ) {
        this.detachRecord(record);
      } else {
        record.handle.setBlockedSubject(blockedSubject);
        record.handle.setPolicy(this.mode, this.siteControl(blockedSubject));
      }
    }
    this.observer.scan(this.document);
  }

  private reportCandidateFailure(element: Element): void {
    if (!this.development) return;
    this.logDiagnostic(element.tagName, "candidate processing failed");
  }

}

function isDevelopmentRuntime(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

function normalizeMode(mode: SiteMode): SiteMode {
  return mode === "strict" ? "protected" : mode;
}

function isVisualCandidate(candidate: MediaCandidate): boolean {
  return candidate.kind === "image" || candidate.kind === "background-image";
}

function isVideoCandidate(candidate: MediaCandidate): boolean {
  return candidate.kind === "native-video" || candidate.kind === "video-iframe";
}

function sharesOverlappingMediaStack(first: Element, second: Element): boolean {
  if (first.ownerDocument !== second.ownerDocument || !sharesNearbyAncestor(first, second)) {
    return false;
  }

  const firstBox = first.getBoundingClientRect();
  const secondBox = second.getBoundingClientRect();
  const smallerArea = Math.min(firstBox.width * firstBox.height, secondBox.width * secondBox.height);
  const largerArea = Math.max(firstBox.width * firstBox.height, secondBox.width * secondBox.height);
  if (smallerArea <= 0 || smallerArea / largerArea < 0.5) return false;

  const intersectionWidth = Math.max(
    0,
    Math.min(firstBox.right, secondBox.right) - Math.max(firstBox.left, secondBox.left),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(firstBox.bottom, secondBox.bottom) - Math.max(firstBox.top, secondBox.top),
  );
  return (intersectionWidth * intersectionHeight) / smallerArea >= 0.8;
}

function sharesNearbyAncestor(first: Element, second: Element): boolean {
  const firstAncestors = new Set<Element>();
  let current: Element | null = first;
  for (let depth = 0; current && current !== first.ownerDocument.body && depth < 8; depth += 1) {
    firstAncestors.add(current);
    current = current.parentElement;
  }

  current = second;
  for (let depth = 0; current && current !== second.ownerDocument.body && depth < 8; depth += 1) {
    if (firstAncestors.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}
