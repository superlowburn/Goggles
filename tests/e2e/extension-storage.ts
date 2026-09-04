import { expect, type BrowserContext, type Page, type Worker } from "@playwright/test";

export async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

export async function seedProtectedOrigin(context: BrowserContext, origin: string): Promise<Worker> {
  const worker = await extensionWorker(context);
  await worker.evaluate(async ({ key }) => chrome.storage.local.set({ [key]: "protected" }), {
    key: `site-policy:${origin}`,
  });
  await dismissFirstRun(context);
  return worker;
}

export async function firstRunPage(context: BrowserContext): Promise<Page> {
  await expect.poll(() => context.pages().find((page) =>
    page.url().includes("/options/options.html"))?.url()).toContain("/options/options.html");
  return context.pages().find((page) => page.url().includes("/options/options.html"))!;
}

export async function dismissFirstRun(context: BrowserContext): Promise<void> {
  await (await firstRunPage(context)).close();
}
