/** Checks for parse-email.ts — run: npx tsx scripts/doctoralia/email-selftest.ts */
import { extractEmails } from './parse-email';
const cases: [string, string[]][] = [
  ['<a href=\\"mailto:info@viveplasticsurgery.com\\">x</a>', ['info@viveplasticsurgery.com']],
  ['<a href="http://citas@dryairbarbosa.com">', ['citas@dryairbarbosa.com']],
  ['<a href="http://www.sportsmedicinejuarez@gmail.com">', ['sportsmedicinejuarez@gmail.com']],
  ['correo a: drmiguelhdez@gmail.com para agendar.', ['drmiguelhdez@gmail.com']],
  ['dermaclear@qodeinteractive.com y soporte-mx@doctoralia.com', []],
  ['<img src="logo@2x.png"> o@sentry.io tu@correo.com', []],
  ['<span class="__cf_email__" data-cfemail="0f666169604f6b606c7b607d216c6062">[email protected]</span>', ['info@doctor.com']],
  ['citas [arroba] clinica.mx', ['citas@clinica.mx']],
  ['info&#64;clinica.com.mx', ['info@clinica.com.mx']],
];
let fail = 0;
for (const [input, want] of cases) {
  const got = extractEmails(input);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(got), input.slice(0, 50));
}
process.exit(fail ? 1 : 0);
