/**
 * Practice-website email pass.
 *
 *   npx tsx scripts/doctoralia/emails.ts --city=tijuana            # all profiles with a website
 *   npx tsx scripts/doctoralia/emails.ts --city=tijuana --limit=20
 *
 * Doctoralia publishes no contact email (see parse-email.ts), but ~40% of the
 * Tijuana profiles sampled link their own website. For each distinct site this
 * reads the home page and, if that has no address, up to two same-site pages
 * whose link looks like a contact page ("contacto", "nosotros", "citas"…).
 *
 * These are third-party sites, not Doctoralia, so the budget is separate: a few
 * sites in parallel, never two requests to the same host at once, a site's
 * robots.txt `Disallow: /` for all agents is honoured, 15s timeout, no retries
 * beyond one. Responses are gzipped into .cache-web/ and results appended to
 * out/<city>/emails.jsonl, so the pass is resumable like the scrape.
 *
 * Emails published by a practice on its own site are still personal data under
 * LFPDPPP when they name a person (drmiguelhdez@…) — same obligations as the
 * README's "Personal data" note.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';
import { OUT_DIR, PROFILES_FILE, USER_AGENT } from './config';
import { extractEmails } from './parse-email';
import { normalizeWebsite } from './parse-media';
import type { DoctoraliaProfile } from './types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_CACHE = path.join(__dirname, '.cache-web');
const EMAILS_FILE = path.join(OUT_DIR, 'emails.jsonl');

const argv = process.argv.slice(2);
const limit = Number(argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);
const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;
const CONTACT_LINK = /contact|contacto|nosotros|about|acerca|quienes|citas|agenda|ubicaci|location/i;

export interface EmailRecord {
  doctoraliaId: string;
  website: string;
  emails: { email: string; foundOn: string; onSiteDomain: boolean }[];
  pagesRead: string[];
  /** Why nothing was read, when that is the case. */
  skipped: 'robots' | 'unreachable' | 'not-html' | null;
  checkedAt: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as T];
    } catch {
      return [];
    }
  });
}

function cacheFile(url: string) {
  const h = crypto.createHash('sha1').update(url).digest('hex');
  const dir = path.join(WEB_CACHE, h.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${h}.gz`);
}

/** One GET with a single retry. Returns null for anything that isn't an HTML/text page. */
async function get(url: string): Promise<{ body: string; finalUrl: string } | null> {
  const file = cacheFile(url);
  if (fs.existsSync(file)) {
    try {
      const cached = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf-8'));
      return cached.body === null ? null : cached;
    } catch {
      // truncated entry — refetch
    }
  }
  let result: { body: string; finalUrl: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8' },
      });
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && /html|text/i.test(type)) {
        // Cap at 2MB: an email is never deeper than that, a runaway page could be.
        result = { body: (await res.text()).slice(0, 2_000_000), finalUrl: res.url || url };
      }
      if (res.status < 500) break;
    } catch {
      if (attempt === 0) await sleep(2000);
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(result ?? { body: null })));
  } catch {
    // cache is an optimisation only
  }
  return result;
}

/** True when robots.txt shuts every agent out of the whole site. */
async function robotsBlocksAll(origin: string): Promise<boolean> {
  const r = await get(`${origin}/robots.txt`);
  if (!r) return false;
  let applies = false;
  for (const raw of r.body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const [k, ...rest] = line.split(':');
    const v = rest.join(':').trim();
    if (/^user-agent$/i.test(k)) applies = v === '*';
    else if (applies && /^disallow$/i.test(k) && v === '/') return true;
  }
  return false;
}

function contactLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const [, href, label] = m;
    if (!CONTACT_LINK.test(href) && !CONTACT_LINK.test(label.replace(/<[^>]+>/g, ''))) continue;
    try {
      const u = new URL(href, base);
      if (u.host.replace(/^www\./, '') !== base.host.replace(/^www\./, '')) continue;
      u.hash = '';
      if (!out.includes(u.href) && u.href !== base.href) out.push(u.href);
    } catch {
      // malformed href
    }
  }
  return out.slice(0, 2);
}

async function checkSite(website: string): Promise<Omit<EmailRecord, 'doctoraliaId' | 'checkedAt'>> {
  const start = new URL(website.startsWith('http') ? website : `https://${website}`);
  const siteHost = start.host.replace(/^www\./, '');
  const empty = { website, emails: [], pagesRead: [] as string[] };

  if (await robotsBlocksAll(start.origin)) return { ...empty, skipped: 'robots' };

  const home = (await get(start.href)) ?? (start.protocol === 'https:' ? await get(start.href.replace(/^https:/, 'http:')) : null);
  if (!home) return { ...empty, skipped: 'unreachable' };

  const emails: EmailRecord['emails'] = [];
  const add = (html: string, on: string) => {
    for (const email of extractEmails(html)) {
      if (emails.some((e) => e.email === email)) continue;
      emails.push({ email, foundOn: on, onSiteDomain: email.endsWith(`@${siteHost}`) || email.endsWith(`.${siteHost}`) });
    }
  };
  const pagesRead = [home.finalUrl];
  add(home.body, home.finalUrl);

  if (!emails.length) {
    for (const link of contactLinks(home.body, new URL(home.finalUrl))) {
      const page = await get(link);
      if (!page) continue;
      pagesRead.push(page.finalUrl);
      add(page.body, page.finalUrl);
      if (emails.length) break;
    }
  }
  return { website, emails, pagesRead, skipped: null };
}

async function main() {
  const profiles = [
    ...new Map(readJsonl<DoctoraliaProfile>(PROFILES_FILE).map((p) => [p.doctoraliaId, p])).values(),
  ];
  const done = new Set(readJsonl<EmailRecord>(EMAILS_FILE).map((r) => r.doctoraliaId));
  const todo = profiles
    .map((p) => ({ id: p.doctoraliaId, website: normalizeWebsite(p.website) }))
    .filter((t): t is { id: string; website: string } => !!t.website && !done.has(t.id))
    .slice(0, limit);

  // One check per site: several doctors of one clinic often share a website.
  const bySite = new Map<string, string[]>();
  for (const t of todo) bySite.set(t.website, [...(bySite.get(t.website) ?? []), t.id]);
  const sites = [...bySite.keys()];
  console.log(`\n✉  Website email pass — ${todo.length} profiles, ${sites.length} distinct sites (${done.size} already done)\n`);

  let next = 0;
  let withEmail = 0;
  const busyHosts = new Set<string>();
  const worker = async () => {
    while (next < sites.length) {
      const site = sites[next++];
      const host = (() => {
        try {
          return new URL(site).host;
        } catch {
          return site;
        }
      })();
      while (busyHosts.has(host)) await sleep(500);
      busyHosts.add(host);
      let res: Omit<EmailRecord, 'doctoraliaId' | 'checkedAt'>;
      try {
        res = await checkSite(site);
      } catch {
        res = { website: site, emails: [], pagesRead: [], skipped: 'unreachable' };
      } finally {
        busyHosts.delete(host);
      }
      if (res.emails.length) withEmail++;
      const checkedAt = new Date().toISOString();
      for (const id of bySite.get(site)!) {
        fs.appendFileSync(EMAILS_FILE, `${JSON.stringify({ doctoraliaId: id, checkedAt, ...res })}\n`, 'utf-8');
      }
      process.stdout.write(`\r  ${next}/${sites.length} sites · ${withEmail} with an email   `);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n\n  ✅ ${withEmail} of ${sites.length} sites published an email → ${EMAILS_FILE}`);
}

main().catch((err) => {
  console.error('\n✖ fatal:', err);
  process.exit(1);
});
