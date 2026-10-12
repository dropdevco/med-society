/**
 *   npx tsx scripts/doctoralia/media-selftest.ts
 *
 * Fixtures are trimmed copies of the markup found in real cached profiles.
 */
import { extractMedia, normalizeSocial, normalizeWebsite } from './parse-media';

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) console.log(`  ok   ${name}`);
  else {
    failed++;
    console.error(`  FAIL ${name}\n       got  ${g}\n       want ${w}`);
  }
}

const OG_PORTRAIT = '<meta property="og:image" content="//s3.us-east-1.amazonaws.com/doctoralia.com.mx/doctor/11d9e5/11d9e55d_220_square.jpg" />';
const OG_BANNER = '<meta property="og:image" content="//platform.docplanner.com/img/mx/open-graph/og.png?3060678595" />';

// Footer / decoys: Doctoralia's own links must never leak out.
const FOOTER = `
<footer>
  <a href="https://www.facebook.com/doctoralia.mx" rel="nofollow">Facebook</a>
  <a href="https://www.instagram.com/doctoralia_mx/">Instagram</a>
  <a href="https://twitter.com/doctoralia">X</a>
  <a href="https://www.youtube.com/@Doctoralia">YouTube</a>
  <a href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fwww.doctoralia.com.mx%2Fperfil%2Fx">Compartir</a>
  <a href="https://pro.doctoralia.com.mx/">Para profesionales</a>
  <a href="https://www.docplanner.com/">Docplanner</a>
</footer>`;

// 1. Doctor page with no gallery and no website.
const noGallery = `<html><head>${OG_PORTRAIT}</head><body><h1>Dr. X</h1>${FOOTER}</body></html>`;
check('no gallery', extractMedia(noGallery), { galleryUrls: [], socials: {} });

// 2. Doctor page with a gallery (Vue prop lists every photo; a video entry is skipped;
//    the portrait reappearing in the gallery at another size is dropped) and a website.
const gallery = `<html><head>${OG_PORTRAIT}</head><body>
<gallery-app :media="[&quot;//s3.us-east-1.amazonaws.com/doctoralia.com.mx/doctor/493508/493508e4_large.jpg&quot;,&quot;//s3.us-east-1.amazonaws.com/doctoralia.com.mx/doctor/11d9e5/11d9e55d_large.jpg&quot;,{&quot;embedUrl&quot;:&quot;https://www.youtube.com/embed/abc&quot;,&quot;src&quot;:&quot;https://i.ytimg.com/vi/abc/hq.jpg&quot;,&quot;provider&quot;:&quot;youtube&quot;},&quot;//pixel-p3.s3.us-east-1.amazonaws.com/doctor/photos/c0406c9c/c0406c9c-6fe8_large.jpg?v=2&quot;,&quot;//s3.us-east-1.amazonaws.com/doctoralia.com.mx/doctor/493508/493508e4_large.jpg&quot;]"></gallery-app>
<a href="http://www.saludangeles.com/?utm_source=doctoralia&amp;fbclid=zzz" rel="nofollow noopener noreferrer" target="_blank" data-avo-track="doctor-website-link">Sitio web</a>
${FOOTER}</body></html>`;
check('gallery + website', extractMedia(gallery), {
  galleryUrls: [
    'https://s3.us-east-1.amazonaws.com/doctoralia.com.mx/doctor/493508/493508e4_large.jpg',
    'https://pixel-p3.s3.us-east-1.amazonaws.com/doctor/photos/c0406c9c/c0406c9c-6fe8_large.jpg',
  ],
  website: 'http://www.saludangeles.com',
  socials: {},
});

// 2b. Fallback to the visible carousel when the Vue prop is missing.
const carousel = `<html><head>${OG_PORTRAIT}</head><body><ul data-id="profile-gallery-carousel">
<li><img src="//pixel-p3.s3.us-east-1.amazonaws.com/doctor/photos/aaaa/aaaa-1_large.jpg" class="gallery-image h-100" /></li>
<li><img src="//pixel-p3.s3.us-east-1.amazonaws.com/doctor/photos/bbbb/bbbb-2_large.jpg" class="gallery-image h-100" /></li></ul></body></html>`;
check('carousel fallback', extractMedia(carousel).galleryUrls.length, 2);

// 3. Clinic page with the "Enlaces" list of socials + website.
const clinic = `<html><head>${OG_BANNER}</head><body>
<a href="http://clinicarealief.com" class="text-body" data-avo-track="clinic-website-link">web</a>
<div data-test-id="contact-modal-links-section"><h5>Enlaces</h5>
<a href="https://www.facebook.com/realief2022/" data-avo-track="clinic-social-media-link">Facebook</a>
<a href="https://instagram.com/stardentalmexico?utm_medium=copy_link" data-avo-track="clinic-social-media-link">Instagram</a>
<a href="https://www.linkedin.com/in/lymbika-healthcare-agency-4b4113285/" data-avo-track="clinic-social-media-link">LinkedIn</a>
<a href="https://www.youtube.com/@Lymbika/shorts" data-avo-track="clinic-social-media-link">YouTube</a>
<a href="https://web.facebook.com/odontoespecializadachih" data-avo-track="clinic-social-media-link">Facebook 2</a>
</div>${FOOTER}</body></html>`;
check('clinic socials', extractMedia(clinic), {
  galleryUrls: [],
  website: 'http://clinicarealief.com',
  socials: {
    facebook: 'https://www.facebook.com/realief2022',
    instagram: 'https://www.instagram.com/stardentalmexico',
    linkedin: 'https://www.linkedin.com/in/lymbika-healthcare-agency-4b4113285',
    youtube: 'https://www.youtube.com/@Lymbika',
  },
});

// 4. Decoys only: Doctoralia's own footer links and a share button, nothing of the doctor's.
check('decoy footer', extractMedia(`<html><head>${OG_PORTRAIT}</head><body>${FOOTER}</body></html>`).socials, {});
// ...even if they were marked like clinic links.
check(
  'decoy marked as clinic link',
  extractMedia(
    `<a data-avo-track="clinic-social-media-link" href="https://www.facebook.com/doctoralia.mx">f</a>
     <a data-avo-track="clinic-social-media-link" href="https://www.facebook.com/sharer/sharer.php?u=x">s</a>
     <a data-avo-track="doctor-website-link" href="https://www.doctoralia.com.mx/perfil/x">w</a>`,
  ),
  { galleryUrls: [], socials: {} },
);

// 5. Placeholder banner as og:image and as a gallery entry is never returned.
const banner = `<html><head>${OG_BANNER}</head><body>
<gallery-app :media="[&quot;//platform.docplanner.com/img/mx/open-graph/og.png?3060678595&quot;,&quot;//pixel-p3.s3.us-east-1.amazonaws.com/facility/photos/2af9e1d1/2af9e1d1-57bd_large.jpg&quot;]"></gallery-app></body></html>`;
check('placeholder banner excluded', extractMedia(banner).galleryUrls, [
  'https://pixel-p3.s3.us-east-1.amazonaws.com/facility/photos/2af9e1d1/2af9e1d1-57bd_large.jpg',
]);

// 6. Doctor page embedding one of their own Instagram posts.
const igEmbed = `<blockquote class="instagram-media"><a href="https://www.instagram.com/guinto_neurocirujano?igsh=dmN1eXRka2ttdzdj?utm_source=ig_embed&amp;utm_campaign=loading" target="_blank">v</a>
<a href="https://www.instagram.com/p/ABC123/">post</a></blockquote>`;
check('instagram embed', extractMedia(igEmbed).socials, { instagram: 'https://www.instagram.com/guinto_neurocirujano' });

// 7. Website that is really a Facebook page becomes a social, not a website.
check(
  'facebook as website',
  extractMedia('<a data-avo-track="doctor-website-link" href="http://www.facebook.com/dracristianicardiojrz">w</a>'),
  { galleryUrls: [], socials: { facebook: 'https://www.facebook.com/dracristianicardiojrz' } },
);

// Unit checks on the normalisers.
check('fb share code', normalizeSocial('https://www.facebook.com/share/15rEARQGg4/?mibextid=wwXIfr'), ['facebook', 'https://www.facebook.com/share/15rEARQGg4']);
check('fb people', normalizeSocial('https://www.facebook.com/people/Odonto-White/100036393132606/'), ['facebook', 'https://www.facebook.com/people/Odonto-White/100036393132606']);
// facebook.com/p/<Name-ID>/ — perfil/armando-zuniga-dominguez; used to collapse to ".../p".
check('fb /p/<slug>', normalizeSocial('https://www.facebook.com/p/DrArmando-zuñiga-100090845602098/'), ['facebook', 'https://www.facebook.com/p/DrArmando-zuñiga-100090845602098']);
check('fb /p/<slug> percent-encoded', normalizeSocial('https://facebook.com/p/DrArmando-zu%C3%B1iga-100090845602098/?ref=x'), ['facebook', 'https://www.facebook.com/p/DrArmando-zuñiga-100090845602098']);
check('fb bare /p rejected', normalizeSocial('https://www.facebook.com/p/'), null);
check('fb profile.php',normalizeSocial('https://facebook.com/profile.php?id=1000123&ref=x'), ['facebook', 'https://www.facebook.com/profile.php?id=1000123']);
check('tiktok', normalizeSocial('https://www.tiktok.com/@clinica.x?lang=es'), ['tiktok', 'https://www.tiktok.com/@clinica.x']);
check('twitter -> x', normalizeSocial('http://twitter.com/DrX_mx?s=20'), ['x', 'https://x.com/DrX_mx']);
check('x intent rejected', normalizeSocial('https://x.com/intent/tweet?text=hi'), null);
check('youtube watch rejected', normalizeSocial('https://www.youtube.com/watch?v=abc'), null);
check('youtube channel', normalizeSocial('https://www.youtube.com/channel/UCJMwp9jwxYJZgp3-F66Nj9A?view_as=subscriber'), ['youtube', 'https://www.youtube.com/channel/UCJMwp9jwxYJZgp3-F66Nj9A']);
check('wa.me', normalizeSocial('https://wa.me/5216561234567?text=hola'), ['whatsapp', 'https://wa.me/5216561234567']);
check('api.whatsapp', normalizeSocial('https://api.whatsapp.com/send?phone=+5216561234567'), ['whatsapp', 'https://wa.me/5216561234567']);
check('bare website gets no slash', normalizeWebsite('https://drluis.com/'), 'https://drluis.com');
check('website keeps path', normalizeWebsite('https://drluis.com/citas?utm_campaign=a&x=1'), 'https://drluis.com/citas?x=1');
check('doctoralia website rejected', normalizeWebsite('https://www.doctoralia.com.mx/clinicas/x'), null);
check('google listing shortlink rejected', normalizeWebsite('https://g.co/kgs/yi84hpG'), null);
check('maps pin rejected', normalizeWebsite('https://maps.app.goo.gl/58bQ'), null);
check('wa message link is not a website', normalizeWebsite('https://wa.me/message/LRNRTZ2DQ4ZMH1'), null);
check('linktree ok', normalizeWebsite('https://linktr.ee/drx'), 'https://linktr.ee/drx');
check('javascript rejected', normalizeWebsite('javascript:alert(1)'), null);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall media checks passed');
