/* A translation tidied on import: another site's links made this page's, stray
 * spaces at line starts taken out, and a country other than the site's named in
 * the page properties pointed out. Made from the case that showed it: the
 * levant_ar Knox guide, translated from a sheet of the English /levant page.
 */
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/';
const core = await import(pathToFileURL(base + 'src/features/copy-deck/core.js'));

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};

const PAGE = '/content/samsung/levant_ar/mobile-phone-buying-guide/what-is-samsung-knox';
const RICH = 'samsung/components/content/consumer/global/product/pd-g-feature-benefit';
const TEXT = 'samsung/components/content/consumer/global/common/cm-g-text-block';

const tree = () => ({
  'jcr:primaryType': 'cq:PageContent',
  'jcr:title': 'What is Samsung Knox? | Samsung Security',
  ogTitle: 'What is Samsung Knox? | Samsung Security | Samsung Lebanon',
  description: 'Learn all about Samsung Knox. Keep your information private at Samsung Lebanon.',
  root: {
    responsivegrid: {
      fb: {
        'sling:resourceType': RICH,
        headlineText: 'How does Samsung Knox work?',
        description:
          'It works as follows:\r\n\r\n • It layers other Samsung security features for <u><a href="/levant_ar/mobile-phone-buying-guide/why-android/">Android</a></u>.\r\n • And <a href="https://www.samsungknox.com/en/">more</a>.'
      },
      tb: {
        'sling:resourceType': TEXT,
        description: 'First paragraph.\r\n\r\nSecond paragraph.'
      }
    }
  }
});

const AR = {
  '.@ogTitle': 'ما هو Samsung Knox؟ | أمان Samsung Security | \u200fSamsung الأردن',
  '.@description': 'تعرف على Samsung Knox. حافِظ على خصوصية معلوماتك مع سامسونج الأردن.',
  'root/responsivegrid/fb@description':
    'آلية عمله:\n \n  • تتكامل مع مزايا الأمان لنظام <u><a href="/levant/mobile-phone-buying-guide/why-android/">Android</a></u>.\n  • و<a href="https://www.samsungknox.com/en/">المزيد</a>.',
  'root/responsivegrid/tb@description': 'الفقرة الأولى.\n \n الفقرة الثانية.'
};

function plan(translations, opts) {
  const deck = core.extractCopyDeck(tree(), { pagePath: PAGE });
  const sheet = core.buildSheet(core.selectRows(deck.rows), { pagePath: PAGE, exportedAt: '2026-10-21 14:35' });
  const K = sheet.columns.indexOf('Key (do not edit)');
  const T = sheet.columns.indexOf('Translation');
  for (const rec of sheet.records) {
    const hit = rec[K].split('\n').find((k) => k in translations);
    if (hit) rec[T] = translations[hit];
  }
  const read = core.readSheet([sheet.columns, ...sheet.records]);
  return core.planImport(tree(), read, { pagePath: PAGE, ...opts });
}

const rowOf = (p, key) => p.rows.find((r) => r.key === key);
const written = (p, path, prop) => p.writes.find((w) => w.path === path && w.prop === prop)?.to;

{
  const p = plan(AR, { siteEnding: ' | \u200fSamsung لبنان' });
  const fb = rowOf(p, 'root/responsivegrid/fb@description');
  const to = written(p, 'root/responsivegrid/fb', 'description');
  check('link to the other site made this one', to?.includes('href="/levant_ar/mobile-phone-buying-guide/why-android/"') && !to.includes('"/levant/'), to);
  check('a link off the site left as it is', to?.includes('href="https://www.samsungknox.com/en/"'), to);
  check('the change is said', fb.warnings.some((w) => w.startsWith('Links made this site') && w.includes('/levant/mobile-phone-buying-guide/why-android/ →')), fb.warnings.join(' | '));
  check('no "links differ" once fixed', !fb.warnings.some((w) => w.startsWith('Links differ')), fb.warnings.join(' | '));
  check('rich text: indents as in the source', to?.includes('آلية عمله:\r\n\r\n • تتكامل') && to.includes('\r\n • و'), JSON.stringify(to));

  const tb = rowOf(p, 'root/responsivegrid/tb@description');
  check('plain text: stray spaces taken out', written(p, 'root/responsivegrid/tb', 'description') === 'الفقرة الأولى.\r\n\r\nالفقرة الثانية.', JSON.stringify(written(p, 'root/responsivegrid/tb', 'description')));
  check('…and said', tb.warnings.some((w) => w.startsWith('Spaces at the start')), tb.warnings.join(' | '));

  const og = rowOf(p, '.@ogTitle');
  const desc = rowOf(p, '.@description');
  check('title naming another country warned', og.warnings.some((w) => w.includes('"الأردن"')), og.warnings.join(' | '));
  check('description naming it warned too', desc.warnings.some((w) => w.includes('"الأردن"')), desc.warnings.join(' | '));
  check('warned, not changed', written(p, '', 'ogTitle')?.includes('الأردن'), written(p, '', 'ogTitle'));
  check('component text not checked for country', !fb.warnings.some((w) => w.includes('country')), fb.warnings.join(' | '));
}

{
  const fine = { ...AR, '.@ogTitle': 'ما هو Samsung Knox؟ | \u200fSamsung لبنان', '.@description': 'مع سامسونج لبنان.' };
  const p = plan(fine, { siteEnding: ' | \u200fSamsung لبنان' });
  check('the site\'s own country: no warning', !p.rows.some((r) => r.warnings.some((w) => w.includes('country'))), '');
}

{
  const p = plan(AR, {});
  check('no home page ending: nothing guessed', !p.rows.some((r) => r.warnings.some((w) => w.includes('country'))), '');
}

{
  // The same country in another language: re-pointed even when the page does not link there yet - and still flagged as a new link.
  const odd = { ...AR, 'root/responsivegrid/fb@description': AR['root/responsivegrid/fb@description'].replace('why-android', 'how-to-use-s-pen-on-tablets') };
  const p = plan(odd, { siteEnding: ' | Samsung لبنان' });
  const fb = rowOf(p, 'root/responsivegrid/fb@description');
  const to = written(p, 'root/responsivegrid/fb', 'description');
  check('sister-site link re-pointed', to?.includes('"/levant_ar/mobile-phone-buying-guide/how-to-use-s-pen-on-tablets/"') && !to.includes('"/levant/'), to);
  check('…said', fb.warnings.some((w) => w.startsWith('Links made this site') && w.includes('how-to-use-s-pen-on-tablets/ → /levant_ar/')), fb.warnings.join(' | '));
  check('…and still a new link to look at', fb.warnings.some((w) => w.startsWith('Links differ')), fb.warnings.join(' | '));
}

{
  // Another country's link is never guessed at: kept as typed, with the usual warning.
  const odd = { ...AR, 'root/responsivegrid/fb@description': AR['root/responsivegrid/fb@description'].replace('/levant/mobile-phone-buying-guide/why-android/', '/ae/mobile-phone-buying-guide/other-page/') };
  const p = plan(odd, { siteEnding: ' | Samsung لبنان' });
  const fb = rowOf(p, 'root/responsivegrid/fb@description');
  check('other country kept, warned', written(p, 'root/responsivegrid/fb', 'description')?.includes('"/ae/mobile-phone-buying-guide/other-page/"') && fb.warnings.some((w) => w.startsWith('Links differ')), fb.warnings.join(' | '));
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
