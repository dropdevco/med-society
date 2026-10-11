/**
 * Pure email extraction, shared by the Doctoralia profile parser and the
 * practice-website pass (emails.ts). No network, no I/O.
 *
 * Doctoralia does not publish a contact email for anyone. What exists:
 *   - doctors who typed an address into their *website* field
 *     (`<a href="http://citas@dryairbarbosa.com">`), and
 *   - doctors who wrote one into their own text (about, service descriptions,
 *     Q&A): "envíeme un correo a: drmiguelhdez@gmail.com".
 * Across 3,281 cached Juárez pages that is 7 profiles, so the practice's own
 * website is where nearly all emails come from.
 *
 * Doctoralia's own inboxes (soporte-mx@, contacto-mx@) appear on every page in
 * the refund policy and are excluded, as are the usual false positives: image
 * names like logo@2x.png, Sentry/Wix DSNs, and form placeholders.
 */

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;

const BLOCKED_DOMAINS = [
  'doctoralia\\.[a-z.]+', 'docplanner\\.com',
  'sentry\\.io', 'wixpress\\.com', 'wix\\.com', 'godaddy\\.com', 'squarespace\\.com',
  'example\\.(com|org|net)', 'domain\\.com', 'dominio\\.com', 'email\\.com', 'correo\\.com', 'test\\.com',
  'yourdomain\\.com', 'mysite\\.com',
  // WordPress theme vendors whose demo contact address ships inside the template
  'qodeinteractive\\.com', 'qode\\.com', 'mikado-themes\\.com', 'elated-themes\\.com', 'select-themes\\.com',
  'themeforest\\.net', 'envato\\.com', 'themerex\\.net', 'themefusion\\.com', 'anpsthemes\\.com',
];
const BLOCKED_DOMAIN = new RegExp(`(^|\\.)(${BLOCKED_DOMAINS.join('|')})$`, 'i');
const PLACEHOLDER_LOCAL = /^(user|usuario|name|nombre|tu|tucorreo|your|youremail|email|correo|mail|ejemplo|example|test|info@example)$/i;
const FILE_LIKE = /\.(png|jpe?g|gif|webp|svg|avif|css|js|woff2?)$/i;

/** Decodes HTML entities and URL escapes that hide addresses in markup. */
function deobfuscate(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&commat;|&#64;/gi, '@')
    .replace(/%40/g, '@')
    .replace(/\\u0040/gi, '@')
    .replace(/\s*\[\s*(?:at|arroba)\s*\]\s*/gi, '@')
    .replace(/\s*\(\s*(?:at|arroba)\s*\)\s*/gi, '@')
    .replace(/\s*\[\s*(?:dot|punto)\s*\]\s*/gi, '.');
}

/** Cloudflare's email protection: `data-cfemail="hex"`, XOR-keyed by the first byte. */
function cloudflareEmails(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"|\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const hex = m[1] ?? m[2];
    if (!hex || hex.length < 4) continue;
    const key = parseInt(hex.slice(0, 2), 16);
    let s = '';
    for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    out.push(s);
  }
  return out;
}

export function cleanEmail(raw: string): string | null {
  const e = raw
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^www\./i, '')
    .split('?')[0]
    .replace(/[\\"'.,;:)\]]+$/, '') // JSON-escaped markup leaves `info@x.com\` behind
    .toLowerCase();
  const m = e.match(/^([^@]+)@(.+)$/);
  if (!m) return null;
  const [, local, domain] = m;
  if (FILE_LIKE.test(e) || /@\d+x\./.test(e)) return null;
  if (BLOCKED_DOMAIN.test(domain) || PLACEHOLDER_LOCAL.test(local)) return null;
  if (/^[0-9a-f]{20,}$/.test(local)) return null; // tracking / DSN hashes
  return e;
}

/** Every plausible contact email in a chunk of HTML or text, de-duplicated, in page order. */
export function extractEmails(htmlOrText: string): string[] {
  const text = deobfuscate(htmlOrText);
  const found = [
    ...[...text.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => decodeURIComponent(m[1])),
    ...cloudflareEmails(htmlOrText),
    ...(text.match(EMAIL) ?? []),
  ];
  const out: string[] = [];
  for (const f of found) {
    const e = cleanEmail(f);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}
