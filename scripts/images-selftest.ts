/**
 * Checks for src/utils/images.ts: which file a listing card / tile / profile
 * asks for, per Doctoralia image family. Pure, no network.
 *
 *   npx tsx scripts/images-selftest.ts
 *
 * The expected pixel sizes in the comments were measured on the real files
 * (a 68px `_small` where a 320px one was assumed is what made old-path
 * listings look soft next to their profile page).
 */
import { portraitImage, portraitUrl, portraitUrlSized } from '../src/utils/images';

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const LEGACY = 'https://s3.us-east-1.amazonaws.com/doctoralia.com.mx/doctor/06c0a8/06c0a85fe542a83d70d0bc26f59b4495';
const MODERN = 'https://pixel-p3.s3.us-east-1.amazonaws.com/doctor/avatar/fb79e7d1/fb79e7d1-376a-4a34-8a70-a9cc7fcbbd12';

console.log('\nlegacy path family (small=68px, medium=120px, 220_square=220px, large≤530px)');
check('card: 120px for 1x, 220px for 2x', same(portraitImage(`${LEGACY}_large.jpg`, 'thumb'), { src: `${LEGACY}_medium.jpg`, srcSet: `${LEGACY}_220_square.jpg 2x` }));
check('tile: 220px for 1x, full size for 2x', same(portraitImage(`${LEGACY}_large.jpg`, 'tile'), { src: `${LEGACY}_220_square.jpg`, srcSet: `${LEGACY}_large.jpg 2x` }));
check('profile: the full-size file, as before', same(portraitImage(`${LEGACY}_large.jpg`, 'large'), { src: `${LEGACY}_large.jpg` }));
check('never the 68px _small for a card (the old bug)', !portraitImage(`${LEGACY}_large.jpg`, 'thumb')!.src.includes('_small'));
check('a stored _220_square gets the same ladder (older scrape)', same(portraitImage(`${LEGACY}_220_square.jpg`, 'tile'), { src: `${LEGACY}_220_square.jpg`, srcSet: `${LEGACY}_large.jpg 2x` }));
check('protocol-relative URLs are made absolute', portraitImage(`//s3.us-east-1.amazonaws.com/doctoralia.com.mx/doctor/06c0a8/06c0a85fe542a83d70d0bc26f59b4495_large.jpg`, 'thumb')!.src === `${LEGACY}_medium.jpg`);
check('a facility path works too', portraitImage('https://s3.us-east-1.amazonaws.com/doctoralia.com.mx/facility/7a69a2/7a69a2c730375a4f98d6515c455c094b_large.jpg', 'tile')!.src.endsWith('_220_square.jpg'));

console.log('\nmodern avatar family (small=320px, medium=640px, large≈850px)');
check('card: 320px for every screen (one file, no srcset)', same(portraitImage(`${MODERN}_large.jpg`, 'thumb'), { src: `${MODERN}_small.jpg` }));
check('tile: 320px for 1x, 640px for 2x', same(portraitImage(`${MODERN}_large.jpg`, 'tile'), { src: `${MODERN}_small.jpg`, srcSet: `${MODERN}_medium.jpg 2x` }));
check('profile: the full-size file', same(portraitImage(`${MODERN}_large.jpg`, 'large'), { src: `${MODERN}_large.jpg` }));
check('a stored _small_square is recognised', portraitImage(`${MODERN}_small_square.jpg`, 'tile')!.srcSet === `${MODERN}_medium.jpg 2x`);

console.log('\neverything else is left alone');
const GOOGLE = '/api/place-photo?placeId=abc&w=160';
check('Google proxy URL unchanged', same(portraitImage(GOOGLE, 'thumb'), { src: GOOGLE }));
check('unknown host unchanged', same(portraitImage('https://example.com/pic_large.jpg', 'tile'), { src: 'https://example.com/pic_large.jpg' }));
check('an S3 file with no size suffix unchanged', same(portraitImage(`${LEGACY}.jpg`, 'tile'), { src: `${LEGACY}.jpg` }));
check('a different bucket path is not rewritten', same(portraitImage('https://s3.us-east-1.amazonaws.com/other-bucket/doctor/06c0a8/x_large.jpg', 'tile'), { src: 'https://s3.us-east-1.amazonaws.com/other-bucket/doctor/06c0a8/x_large.jpg' }));
check('missing input → undefined', portraitImage(undefined, 'tile') === undefined && portraitImage('', 'thumb') === undefined);

console.log('\nplaceholders are not portraits');
check('Open Graph banner', portraitUrl('https://platform.docplanner.com/img/mx/open-graph/og.png?30') === undefined);
check('generic default doctor silhouette', portraitUrl('https://platform.docplanner.com/img/general/doctor/doctor-default_large.jpg') === undefined);
check('generic default clinic logo', portraitUrl('https://platform.docplanner.com/img/general/facility/facility-default-220-220.jpg') === undefined);
check('…and so no sized image either', portraitImage('https://platform.docplanner.com/img/general/doctor/doctor-default_large.jpg', 'thumb') === undefined);
check('a real photo is kept', portraitUrl(`${LEGACY}_large.jpg`) === `${LEGACY}_large.jpg`);

console.log('\nportraitUrlSized (callers with no srcset)');
check('returns just the 1x file', portraitUrlSized(`${LEGACY}_large.jpg`, 'thumb') === `${LEGACY}_medium.jpg`);

console.log(failures ? `\n${failures} failing` : '\nall checks passed');
process.exit(failures ? 1 : 0);
