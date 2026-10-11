/**
 * Pure extraction of photo galleries, the practice's own website and social
 * links from a cached Doctoralia profile page. No network, no I/O — feed it the
 * HTML string.
 *
 * Where Doctoralia puts each thing (checked against the cached pages):
 *   gallery  <gallery-app :media="[&quot;//s3…_large.jpg&quot;, …]"> — the full
 *            list (doctor AND clinic pages). Entries are strings, or for video
 *            {embedUrl, src, provider} objects, which we skip. Falls back to the
 *            visible `img.gallery-image` tags if the Vue prop is absent.
 *   website  <a data-avo-track="doctor-website-link"> (doctors) or
 *            "clinic-website-link" (clinics).
 *   socials  <a data-avo-track="clinic-social-media-link"> (clinic pages), the
 *            "Redes sociales" list in a doctor's about-details modal, plus the
 *            profile link of an embedded Instagram post on a doctor page.
 *
 * Doctoralia's own og:image banner, its own social accounts and share buttons
 * are excluded.
 */
import * as cheerio from 'cheerio';

export type SocialKey = 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'x' | 'linkedin' | 'whatsapp';
export type Socials = Partial<Record<SocialKey, string>>;

export interface Media {
  /** Ordered image URLs (https, no query), main portrait excluded. */
  galleryUrls: string[];
  website?: string;
  socials: Socials;
}

/** Same rule as src/utils/images.ts. */
const PLACEHOLDER = /open-graph|\/og\.png/i;

/** Handles that belong to Doctoralia / Docplanner themselves. */
const OWN_HANDLE = /^(doctoralia|docplanner)[\w.-]*$/i;
const OWN_HOST =
  /(^|\.)(doctoralia\.[a-z.]+|docplanner\.com|noa\.ai|doctoraliar\.com|znanylekarz\.pl|miodottore\.it|jameda\.de|doktortakvimi\.com|znamylekar\.cz)$/i;

const TRACKING =
  /^(utm_[a-z]+|fbclid|gclid|igsh|igshid|mibextid|si|feature|ref|ref_src|ref_url|fb_source|hl|locale|_rdr|view_as)$/i;

function toUrl(raw: string): URL | null {
  let s = raw.trim().replace(/&amp;/g, '&');
  if (!s) return null;
  if (s.startsWith('//')) s = 'https:' + s;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^(www|m|web|mobile|es-la|es|l)\./, '');

// ---------- images ----------

/** Filename stem without the size suffix, to recognise the same photo at another size. */
function stem(url: string): string {
  const file = url.split('?')[0].split('/').pop() ?? url;
  return file
    .replace(/\.[a-z]+$/i, '')
    .replace(/_(small_square|\d+_square|large|medium|small|thumb|original|\d+x\d+)$/i, '');
}

export function normalizeImage(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const u = toUrl(raw);
  if (!u) return null;
  if (PLACEHOLDER.test(u.href)) return null;
  if (!/\.(jpe?g|png|webp|avif)$/i.test(u.pathname)) return null;
  u.search = '';
  u.hash = '';
  return u.href;
}

function extractGallery($: cheerio.CheerioAPI): string[] {
  const raw: string[] = [];
  const prop = $('gallery-app').first().attr(':media');
  if (prop) {
    try {
      const arr = JSON.parse(prop);
      if (Array.isArray(arr)) for (const it of arr) if (typeof it === 'string') raw.push(it);
    } catch {
      // prop shape changed — fall through to the visible tags
    }
  }
  if (!raw.length) {
    $('[data-id="profile-gallery-carousel"] img.gallery-image, [data-id="gallery-container"] img.gallery-image').each(
      (_i, el) => {
        const src = $(el).attr('src');
        if (src) raw.push(src);
      },
    );
  }

  const og = normalizeImage($('meta[property="og:image"]').attr('content'));
  const portraitStem = og ? stem(og) : null;

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const url = normalizeImage(r);
    if (!url) continue;
    const s = stem(url);
    if (s === portraitStem || seen.has(s)) continue;
    seen.add(s);
    out.push(url);
  }
  return out;
}

// ---------- website ----------

/** Map pins, Google listing shortlinks and WhatsApp message links are not a website. */
const NOT_A_WEBSITE = /^(g\.co\/|maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google\.|wa\.me|api\.whatsapp\.com)/i;

export function normalizeWebsite(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const u = toUrl(raw);
  if (!u) return null;
  const h = host(u);
  if (!h.includes('.') || OWN_HOST.test(h) || NOT_A_WEBSITE.test(h + u.pathname)) return null;
  // "http://citas@clinica.com" is an email typed into the website field, not a site.
  if (u.username) return null;
  if (normalizeSocial(u.href)) return null; // a Facebook page is not a website; it goes to socials
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hash = '';
  let s = u.href;
  if (u.pathname === '/' && !u.search) s = s.replace(/\/$/, '');
  return s;
}

// ---------- socials ----------

const FB_RESERVED = new Set([
  'sharer', 'sharer.php', 'share.php', 'share', 'dialog', 'plugins', 'tr', 'login', 'login.php', 'l.php',
  'watch', 'hashtag', 'groups', 'events', 'policies', 'help', 'privacy', 'legal', 'ads', 'business', 'pages',
  'photo', 'photo.php', 'permalink.php', 'story.php', 'reel', 'video', 'videos', 'posts',
]);
const IG_RESERVED = new Set([
  'p', 'reel', 'reels', 'tv', 'explore', 'accounts', 'share', 'stories', 'direct', 'about', 'legal', 'developer', 'web',
  'embed.js',
]);
const X_RESERVED = new Set(['intent', 'share', 'home', 'search', 'hashtag', 'i', 'login', 'privacy', 'tos', 'widgets.js', 'settings']);

/** Returns [key, canonicalUrl] for a recognised profile link, else null. */
export function normalizeSocial(raw: string | undefined | null): [SocialKey, string] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^whatsapp:\/\/send/i.test(trimmed)) {
    const d = trimmed.match(/phone=\+?(\d{8,15})/)?.[1];
    return d ? ['whatsapp', `https://wa.me/${d}`] : null;
  }
  const u = toUrl(trimmed);
  if (!u) return null;
  const h = host(u);
  const seg = u.pathname
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

  if (h === 'facebook.com' || h === 'fb.com' || h === 'fb.me') {
    if (!seg.length) return null;
    const first = seg[0].toLowerCase();
    if (h === 'fb.me') return OWN_HANDLE.test(seg[0]) ? null : ['facebook', `https://www.facebook.com/${seg[0]}`];
    if (first === 'profile.php') {
      const id = u.searchParams.get('id');
      return id && /^\d+$/.test(id) ? ['facebook', `https://www.facebook.com/profile.php?id=${id}`] : null;
    }
    // facebook.com/share/<code>/ is a redirecting page link (new-style share of a page); /share/p|v|r are posts.
    if (first === 'share') return seg[1] && !['p', 'v', 'r'].includes(seg[1]) ? ['facebook', `https://www.facebook.com/share/${seg[1]}`] : null;
    if (first === 'people' && seg[1] && seg[2]) return ['facebook', `https://www.facebook.com/people/${seg[1]}/${seg[2]}`];
    // New-style pages without a vanity name: facebook.com/p/<Name>-<numeric id>/.
    // The slug is the page; "/p" alone is nothing.
    if (first === 'p') return seg[1] ? ['facebook', `https://www.facebook.com/p/${seg[1]}`] : null;
    if (FB_RESERVED.has(first) || OWN_HANDLE.test(seg[0])) return null;
    return ['facebook', `https://www.facebook.com/${seg[0]}`];
  }

  if (h === 'instagram.com' || h === 'instagr.am') {
    const handle = seg[0];
    if (!handle || IG_RESERVED.has(handle.toLowerCase()) || OWN_HANDLE.test(handle)) return null;
    if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return null;
    return ['instagram', `https://www.instagram.com/${handle}`];
  }

  if (h === 'tiktok.com') {
    const handle = seg[0];
    if (!handle?.startsWith('@') || handle.length < 2 || OWN_HANDLE.test(handle.slice(1))) return null;
    return ['tiktok', `https://www.tiktok.com/${handle}`];
  }

  if (h === 'youtube.com' || h === 'music.youtube.com') {
    const first = seg[0];
    if (!first) return null;
    if (first.startsWith('@') && first.length > 1) {
      return OWN_HANDLE.test(first.slice(1)) ? null : ['youtube', `https://www.youtube.com/${first}`];
    }
    if (['channel', 'c', 'user'].includes(first.toLowerCase()) && seg[1]) {
      return ['youtube', `https://www.youtube.com/${first.toLowerCase()}/${seg[1]}`];
    }
    return null; // watch, embed, playlist, shorts, results…
  }

  if (h === 'twitter.com' || h === 'x.com') {
    const handle = seg[0];
    if (!handle || X_RESERVED.has(handle.toLowerCase()) || OWN_HANDLE.test(handle) || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      return null;
    }
    return ['x', `https://x.com/${handle}`];
  }

  if (h === 'linkedin.com') {
    const first = seg[0]?.toLowerCase();
    if (['in', 'company', 'school'].includes(first) && seg[1]) return ['linkedin', `https://www.linkedin.com/${first}/${seg[1]}`];
    return null;
  }

  if (h === 'wa.me' || h === 'api.whatsapp.com' || h === 'whatsapp.com') {
    const digits = (h === 'wa.me' ? seg[0] : u.searchParams.get('phone'))?.replace(/^[+\s]+/, '');
    return digits && /^\d{8,15}$/.test(digits) ? ['whatsapp', `https://wa.me/${digits}`] : null;
  }

  return null;
}

function extractSocials($: cheerio.CheerioAPI): Socials {
  const socials: Socials = {};
  const add = (href: string | undefined) => {
    const hit = normalizeSocial(href);
    if (hit && !socials[hit[0]]) socials[hit[0]] = hit[1];
  };
  // Clinic pages: an explicit "Enlaces" list of the clinic's own profiles.
  $('a[data-avo-track="clinic-social-media-link"]').each((_i, el) => add($(el).attr('href')));
  // Doctor pages: the "Redes sociales" block inside the about-details modal
  // ([data-id="about-details-modal"]) — <div><h3>Redes sociales</h3></div><ul><li><a href="//www.facebook.com/…">.
  $('h3')
    .filter((_i, el) => /^\s*redes sociales\s*$/i.test($(el).text()))
    .each((_i, el) => {
      $(el).parent().nextAll('ul').first().find('a[href]').each((_j, a) => add($(a).attr('href')));
    });
  // Doctor pages: a doctor may embed one of their own Instagram posts; its header links their profile.
  $('blockquote.instagram-media a[href*="instagram.com"]').each((_i, el) => add($(el).attr('href')));
  return socials;
}

// ---------- public ----------

export function extractMedia(html: string): Media {
  const $ = cheerio.load(html);
  const galleryUrls = extractGallery($);
  const socials = extractSocials($);

  let website: string | undefined;
  $('a[data-avo-track="doctor-website-link"], a[data-avo-track="clinic-website-link"]').each((_i, el) => {
    const href = $(el).attr('href');
    const site = normalizeWebsite(href);
    if (site) {
      if (!website) website = site;
      return;
    }
    // A "website" that is really a Facebook/Instagram page is kept as a social instead.
    const hit = normalizeSocial(href);
    if (hit && !socials[hit[0]]) socials[hit[0]] = hit[1];
  });

  return website ? { galleryUrls, website, socials } : { galleryUrls, socials };
}
