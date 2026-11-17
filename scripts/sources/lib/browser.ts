/**
 * A real browser (Playwright Chromium) for sources whose pages only exist
 * after JavaScript runs, or that refuse plain HTTP clients.
 *
 * Identification (docs/adr/0002): by default the browser's user agent carries
 * "MedSocietyBot/1.0 (+https://www.medsociety.one)" and every
 * request sends an `X-Client: MedSocietyBot` header. Only an adapter whose recorded
 * permission waives 'block' may use the plain Chrome identity instead, and it
 * still sends the X-Client header.
 */
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { USER_AGENT } from './http';
import type { Permission } from './types';

const MIN_DELAY_MS = Number(process.env.SOURCES_MIN_DELAY_MS ?? 3000);
const JITTER_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let lastActionAt = 0;
/** Same pacing as lib/http.ts: one navigation or lookup every few seconds. */
export async function pace() {
    const wait = lastActionAt + MIN_DELAY_MS + Math.random() * JITTER_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastActionAt = Date.now();
}

export interface OpenBrowser {
    browser: Browser;
    context: BrowserContext;
    close(): Promise<void>;
}

export async function openBrowser(permission?: Permission): Promise<OpenBrowser> {
    const browser = await chromium.launch();
    const probe = await browser.newPage();
    const chromeUa = (await probe.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
    await probe.close();
    const plainChrome = permission?.waives?.includes('block') ?? false;
    const context = await browser.newContext({
        userAgent: plainChrome ? chromeUa : `${chromeUa} ${USER_AGENT}`,
        locale: 'es-MX',
        extraHTTPHeaders: { 'X-Client': USER_AGENT },
    });
    return { browser, context, close: () => browser.close() };
}
