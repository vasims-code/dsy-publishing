/* Copy deck and the components' dialogs: what a dialog says about a field - a
 * text, a setting, English for analytics - read through includes the way AEM
 * holds them, and what that changes on the sheet and in "Fields not on the
 * sheet".
 *
 * The dialogs are the real ones from p6-ap-author, trimmed: the Showcase Card
 * (CO35), whose fields are four includes down; the Feature Full Bleed (FT03);
 * and the page-static-gnb page properties.
 */
import { pathToFileURL } from 'node:url';

const base = 'D:/chrome-extensions/aem-toolkit/';
const core = await import(pathToFileURL(base + 'src/features/copy-deck/core.js'));
const { dialogFields, readDialogs, forgetDialogs } = await import(pathToFileURL(base + 'src/features/copy-deck/dialog.js'));
const { AemClient } = await import(pathToFileURL(base + 'src/core/aem-client.js'));
const { actions } = await import(pathToFileURL(base + 'src/features/copy-deck/worker.js'));

let pass = 0;
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        ${detail}`}`);
  ok ? pass++ : failed++;
};
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------- dialogs */

const G = 'granite/ui/components/coral/foundation';
const SC = 'samsung/components/content/consumer/global/home/ho-g-showcase-card';
const FB = 'samsung/components/content/consumer/global/product/pd-g-feature-benefit-full-bleed';
const PG = 'samsung/components/structure/consumer/global/page-static-gnb';
const ITEMS = `/apps/${SC}/datasources/dialog-items`;
const EN = { pattern: '^[A-Za-z0-9(:;,|)\\s]+$', message: 'Please enter valid text.', removeyn: 'N' };
const include = (path) => ({ 'sling:resourceType': `${G}/include`, path });
const text = (name, fieldLabel, extra = {}) => ({ 'sling:resourceType': `${G}/form/textfield`, name, fieldLabel, ...extra });
const area = (name, fieldLabel, extra = {}) => ({ 'sling:resourceType': `${G}/form/textarea`, name, fieldLabel, ...extra });
const of = (type, name, extra = {}) => ({ 'sling:resourceType': `${G}/form/${type}`, name, ...extra });

/** Every node a dialog reaches, by path - what AEM serves as <path>.infinity.json. */
const REPO = {
  [`/mnt/override/apps/${SC}/cq:dialog`]: {
    'sling:resourceType': 'cq/gui/components/authoring/dialog',
    'jcr:title': 'CO35_Showcase Card',
    content: {
      'sling:resourceType': `${G}/container`,
      items: {
        tabs: {
          'sling:resourceType': `${G}/tabs`,
          items: {
            setting: { 'sling:resourceType': `${G}/container`, items: { columns: include(`${ITEMS}/tab-panels/tab-setting`) } },
            cardList: { 'sling:resourceType': `${G}/container`, items: { columns: include(`${ITEMS}/tab-panels/tab-cardlist`) } }
          }
        }
      }
    }
  },
  [`${ITEMS}/tab-panels/tab-setting`]: {
    'sling:resourceType': `${G}/fixedcolumns`,
    items: {
      container: {
        name: './setting',
        'sling:resourceType': `${G}/named-container`,
        items: { useCta: of('switch', 'useCta'), theme: of('select', 'theme', { fieldLabel: 'Theme' }) }
      }
    }
  },
  [`${ITEMS}/tab-panels/tab-cardlist`]: {
    'sling:resourceType': `${G}/fixedcolumns`,
    items: {
      container: {
        name: './column',
        'sling:resourceType': `${G}/named-container`,
        items: {
          fieldSet: {
            'sling:resourceType': `${G}/form/fieldset`,
            items: {
              cardLayout: of('select', 'layout', { fieldLabel: 'Layout', datasource: { 'sling:resourceType': 'samsung/x/node-items' } }),
              cardTitle: { fieldLabel: 'Card List', 'sling:resourceType': `${G}/form/field` },
              'item1-container': { name: 'item1', 'sling:resourceType': `${G}/named-container`, items: { 'item-content': include(`${ITEMS}/items/fieldset-item1`) } },
              'item2-container': { name: 'item2', 'sling:resourceType': `${G}/named-container`, items: { 'item-content': include(`${ITEMS}/items/fieldset-item2`) } }
            }
          }
        }
      }
    }
  },
  ...Object.fromEntries(
    [1, 2].map((n) => [
      `${ITEMS}/items/fieldset-item${n}`,
      {
        'sling:resourceType': `${G}/form/fieldset`,
        items: {
          title: { fieldLabel: `${n}. Top Left`, 'sling:resourceType': `${G}/form/field` },
          layout: {
            'sling:resourceType': `${G}/container`,
            items: Object.fromEntries(['style', 'text', 'image', 'link'].map((k) => [`${k}-content`, include(`${ITEMS}/fieldsets/fieldset-${k}`)]))
          }
        }
      }
    ])
  ),
  [`${ITEMS}/fieldsets/fieldset-style`]: {
    'sling:resourceType': `${G}/form/fieldset`,
    items: {
      position: of('select', 'position', { fieldLabel: 'Position' }),
      textColor: of('buttongroup', 'textColor', { fieldLabel: 'Text Color' }),
      textAlign: of('select', 'textAlign', { fieldLabel: 'Text Align' }),
      badgeText: text('badgeText', 'Badge Text', { bottomDiscription: 'Recommend to enter up to 17 characters' })
    }
  },
  [`${ITEMS}/fieldsets/fieldset-text`]: {
    'sling:resourceType': `${G}/form/fieldset`,
    items: {
      pcText: area('pcText', 'Desktop Text', { bottomDiscription: 'Recommend to enter up to 30 characters and 2 lines' }),
      moText: area('moText', 'Mobile Text', { bottomDiscription: 'Recommend to enter up to 30 characters and 2 lines' }),
      engText: text('engText', 'Text for Analytics (English)', { validation: 'smg-text-validate', 'granite:data': EN }),
      reportTitle: text('reportTitle', 'Title for Analytics (English)'),
      pcDesc: area('pcDesc', 'Desktop Description Text', { bottomDiscription: 'Recommend to enter up to 35 characters and 2 lines' }),
      moDesc: area('moDesc', 'Mobile Description Text', { bottomDiscription: 'Recommend to enter up to 42 characters and 3 lines' })
    }
  },
  [`${ITEMS}/fieldsets/fieldset-image`]: {
    'sling:resourceType': `${G}/form/fieldset`,
    items: {
      well: {
        'sling:resourceType': `${G}/well`,
        items: {
          altText: text('altText', 'Alternative Text'),
          pcImage: { 'sling:resourceType': 'cq/gui/components/authoring/dialog/fileupload', name: 'pcImage', fileReferenceParameter: './pcImageRef', fileNameParameter: './pcImageName', fieldLabel: 'Desktop Image' },
          useImageLink: {
            'sling:resourceType': `${G}/container`,
            items: { switch: of('switch', 'useImageLink'), linkTitle: text('imageLinkTitle', 'Link Title'), linkPath: of('pathfield', 'imageLinkPath') }
          }
        }
      }
    }
  },
  [`${ITEMS}/fieldsets/fieldset-link`]: {
    'sling:resourceType': `${G}/form/fieldset`,
    items: {
      text: text('text', 'Text', { bottomDiscription: 'Recommend to enter up to 25 characters' }),
      linkEng: text('linkEng', 'Text for Analytics (English)', { validation: 'smg-text-validate', 'granite:data': EN }),
      linkTitle: text('linkTitle', 'Link Title'),
      linkPath: of('pathfield', 'linkPath', { fieldLabel: 'Link Path' }),
      target: of('buttongroup', 'target', { fieldLabel: 'Open Action' }),
      videoId: text('videoId', 'Video ID'),
      // The same check as the analytics fields, but no English-only pattern: a screen reader reads it.
      videoAlt: text('videoAlt', 'Video Title', { validation: 'smg-text-validate', bottomDiscription: 'Link aria-label / Video title attribute' }),
      caption: area('caption', 'Video Caption'),
      datePublished: of('datepicker', './datePublished', { fieldLabel: 'Date Published for SEO' })
    }
  },

  [`/mnt/override/apps/${FB}/cq:dialog`]: {
    'sling:resourceType': 'cq/gui/components/authoring/dialog',
    content: {
      'sling:resourceType': `${G}/container`,
      items: {
        tabs: {
          'sling:resourceType': `${G}/tabs`,
          items: {
            setting: {
              'sling:resourceType': `${G}/container`,
              items: {
                componentId: { name: './componentId', path: '/apps/samsung/components/content/consumer/global/common-dialog/cq:dialog/content/items/componentid', 'sling:resourceType': 'granite/ui/components/foundation/include' },
                containerWidth: of('select', './containerWidth', { fieldLabel: 'Container Width' }),
                desktopTextPosition: of('select', './desktopTextLayout', { fieldLabel: 'Desktop Text Position' }),
                lazyLoadingOption: of('switch', './lazyLoadingOption')
              }
            },
            contents: {
              'sling:resourceType': `${G}/container`,
              items: {
                text: {
                  'sling:resourceType': `${G}/well`,
                  items: {
                    eyebrowText: text('./eyebrowText', 'Eyebrow Text', { bottomDiscription: 'Recommend to enter up to 37 characters and 1 line' }),
                    headlineText: area('./headlineText', 'Headline Text', {
                      bottomDiscription: 'Recommend to enter up to 14 characters and 2 lines (X Large), 16 characters and 2 Lines (Large)'
                    }),
                    headlineTextForAnalytics: text('./headlineTextForAnalytics', 'Headline Text For Analytics (English)', { validation: 'smg-text-validate', 'granite:data': EN }),
                    headlineTextSize: of('select', './headlineTextSize', { fieldLabel: 'Headline Text Size' }),
                    description: area('./description', 'Description'),
                    disclaimer: {
                      composite: true,
                      fieldLabel: 'Disclaimer',
                      'sling:resourceType': `${G}/form/multifield`,
                      field: {
                        name: './disclaimerList',
                        'sling:resourceType': `${G}/container`,
                        items: { text: { 'sling:resourceType': `${G}/container`, items: { disclaimer: text('disclaimer', 'Text') } } }
                      }
                    }
                  }
                },
                image: {
                  'sling:resourceType': `${G}/well`,
                  items: {
                    imageAlternativeText: text('./imageAlternativeText', 'Desktop Alternative Text'),
                    desktopMobileImage: { 'sling:resourceType': 'cq/gui/components/authoring/dialog/fileupload', name: './desktopImage', fileReferenceParameter: './desktopImageRef', fileNameParameter: './desktopImageName' },
                    imageMobileAlternativeText: text('./imageMobileAlternativeText', 'Mobile Alternative Text')
                  }
                },
                listMultifield: {
                  composite: true,
                  fieldLabel: 'Link & Action Group',
                  'sling:resourceType': `${G}/form/multifield`,
                  field: {
                    name: './list',
                    'sling:resourceType': `${G}/container`,
                    items: {
                      text: text('./text', 'Text', { bottomDiscription: 'Recommend to enter up to 25 characters' }),
                      textForAnalytics: text('./textForAnalytics', 'Text for Analytics (English)', { 'granite:data': EN }),
                      linkTitle: text('./linkTitle', 'Link Title'),
                      linkPath: of('pathfield', './linkPath'),
                      openAction: of('buttongroup', './openAction')
                    }
                  }
                },
                LinkAction1: {
                  'sling:resourceType': `${G}/container`,
                  items: {
                    text2: text('./text2', 'Text', { bottomDiscription: 'Recommend to enter up to 25 characters' }),
                    textForAnalytics2: text('./textForAnalytics2', 'Text for Analytics (English)', { validation: 'smg-text-validate', 'granite:data': EN }),
                    linkTitle2: text('./linkTitle2', 'Link Title')
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  '/apps/samsung/components/content/consumer/global/common-dialog/cq:dialog/content/items/componentid': text('./componentId', 'Component ID'),

  // The page's dialog is not under /mnt/override here: the plain /apps one is read instead.
  [`/apps/${PG}/cq:dialog`]: {
    'sling:resourceType': 'cq/gui/components/authoring/dialog',
    content: {
      items: {
        tabs: {
          items: {
            basic: {
              items: {
                title: text('./jcr:title', 'Page Title', { maxlength: 1000, fieldDescription: 'Input page title to display on browser tab (max. 1000 characters)' }),
                titleOption: of('radiogroup', './titleOption', { fieldLabel: 'Title Option' }),
                template: text('./cq:template', 'Page Template', { disabled: 'true' }),
                templateTitle: text('./templateTitle', 'Page Template Title', { disabled: 'true' }),
                subtitle: text('./subtitle', 'Subtitle'),
                breadcrumbTitle: text('./breadcrumbTitle', 'Breadcrumb Title', { fieldDescription: 'Crumb override of page title where in use' }),
                charset: of('hidden', '_charset_', { value: 'utf-8' }),
                hreflangGroupDel: of('hidden', './hreflangGroup@Delete')
              }
            },
            socialmedia: {
              items: {
                card: text('./twitterCard', 'Card'),
                title: text('./twitterTitle', 'Title', { fieldDescription: 'Input title of Twitter Cards (max. 1 line or 70 characters)' }),
                type: text('./ogType', 'Type')
              }
            },
            blueprint: include('/mnt/overlay/wcm/foundation/components/basicpage/v1/basicpage/tabs/blueprint')
          }
        }
      }
    }
  }
};

/** A client whose reads come from REPO; every path asked for is counted. */
function fakeClient(repo = REPO) {
  const asked = [];
  return {
    asked,
    async readJson(path, depth) {
      asked.push(path);
      if (depth !== 'infinity') throw new Error(`asked for depth ${depth}`);
      return repo[path] ? { status: 200, json: clone(repo[path]) } : { status: 404, json: null };
    }
  };
}

const find = (fields, path, prop) => fields.find((f) => f.path === path && f.prop === prop);

console.log('--- reading a dialog -------------------------------------------------');

forgetDialogs();
const client = fakeClient();
const read = await readDialogs(client, [SC, FB, PG, 'samsung/components/content/consumer/global/x/no-dialog']);
const sc = read.dialogs[SC] || [];
const fb = read.dialogs[FB] || [];
const pg = read.dialogs[PG] || [];

check('reads the dialog of every component that has one', sc.length && fb.length && pg.length && read.unread === 1, JSON.stringify({ read: read.read, unread: read.unread }));
check(
  'follows includes four levels down to the Showcase Card fields, each under the card it belongs to',
  find(sc, 'column/item1', 'pcText')?.kind === 'text' && find(sc, 'column/item2', 'pcText')?.kind === 'text' && find(sc, 'column/item1', 'text')?.kind === 'text',
  JSON.stringify(sc.filter((f) => f.prop === 'pcText'))
);
check(
  '...with the label the author sees and the length the page is made for',
  find(sc, 'column/item1', 'pcText').label === 'Desktop Text' && find(sc, 'column/item1', 'pcText').hint === 'Recommend to enter up to 30 characters and 2 lines',
  JSON.stringify(find(sc, 'column/item1', 'pcText'))
);
check(
  'a field included by every card is read once',
  client.asked.filter((p) => p.endsWith('/fieldsets/fieldset-text')).length === 1,
  JSON.stringify(client.asked.filter((p) => p.includes('fieldset')))
);
check(
  '"Text for Analytics (English)" with an English-only pattern is analytics: linkEng, engText',
  find(sc, 'column/item1', 'linkEng')?.kind === 'analytics' && find(sc, 'column/item1', 'engText')?.kind === 'analytics',
  JSON.stringify([find(sc, 'column/item1', 'linkEng'), find(sc, 'column/item1', 'engText')])
);
check('...and so is the label alone', find(sc, 'column/item1', 'reportTitle')?.kind === 'analytics', JSON.stringify(find(sc, 'column/item1', 'reportTitle')));
check('the same check without the pattern is a text a screen reader reads: videoAlt', find(sc, 'column/item1', 'videoAlt')?.kind === 'text', JSON.stringify(find(sc, 'column/item1', 'videoAlt')));
check(
  'selects, button groups, switches, path pickers, dates and images are settings',
  ['position', 'textColor', 'textAlign', 'linkPath', 'target', 'useImageLink', 'imageLinkPath', 'pcImage', 'pcImageRef', 'pcImageName', 'datePublished'].every((p) => find(sc, 'column/item1', p)?.kind === 'setting') &&
    find(sc, 'column', 'layout')?.kind === 'setting' &&
    find(sc, 'setting', 'theme')?.kind === 'setting',
  JSON.stringify(sc.filter((f) => f.kind === 'setting').map((f) => `${f.path}@${f.prop}`))
);
check('text found through the image and style pieces too: imageLinkTitle, badgeText', find(sc, 'column/item1', 'imageLinkTitle')?.kind === 'text' && find(sc, 'column/item1', 'badgeText')?.kind === 'text', '');

check('a composite multifield puts its items under "list/*"', find(fb, 'list/*', 'text')?.kind === 'text' && find(fb, 'list/*', 'textForAnalytics')?.kind === 'analytics' && find(fb, 'list/*', 'linkPath')?.kind === 'setting', JSON.stringify(fb.filter((f) => f.path)));
check('...and a field inside it without "./" too: disclaimerList/*', find(fb, 'disclaimerList/*', 'disclaimer')?.kind === 'text', '');
check('textForAnalytics2 is analytics - the name alone would let it through', find(fb, '', 'textForAnalytics2')?.kind === 'analytics', '');
check(
  'text the built-in rules do not know is found: eyebrowText, text2, linkTitle2',
  ['eyebrowText', 'text2', 'linkTitle2'].every((p) => find(fb, '', p)?.kind === 'text'),
  JSON.stringify(fb.filter((f) => !f.path && f.kind === 'text').map((f) => f.prop))
);
check('an include with a name of its own (componentId) is followed too', find(fb, '', 'componentId')?.kind === 'text', '');
check('an image keeps its reference and name parameters as settings', find(fb, '', 'desktopImageRef')?.kind === 'setting' && find(fb, '', 'desktopImageName')?.kind === 'setting', '');

check('the page dialog is read from /apps when /mnt/override has none', client.asked.includes(`/apps/${PG}/cq:dialog`) && find(pg, '', 'jcr:title')?.kind === 'text', '');
check('...a maxlength becomes the length', /1000 characters/.test(find(pg, '', 'jcr:title').hint), find(pg, '', 'jcr:title').hint);
check('...a disabled text field is a setting', find(pg, '', 'cq:template')?.kind === 'setting' && find(pg, '', 'templateTitle')?.kind === 'setting', '');
check('..."_charset_" and "@Delete" are not properties', !pg.some((f) => f.prop === '_charset_' || f.prop.includes('@')), JSON.stringify(pg.map((f) => f.prop)));
check('...an include that cannot be read is left out, nothing else', pg.length > 5 && client.asked.includes('/mnt/overlay/wcm/foundation/components/basicpage/v1/basicpage/tabs/blueprint'), '');
check('...twitterCard is a text field in the dialog - the block list keeps it off the sheet', find(pg, '', 'twitterCard')?.kind === 'text' && !core.fieldAllowed('twitterCard') && !core.fieldAllowed('ogType'), '');

{
  const again = fakeClient();
  await readDialogs(again, [SC, FB]);
  check('a component read once is not read again in the same tab', again.asked.length === 0, JSON.stringify(again.asked));
  forgetDialogs();
  await readDialogs(again, [SC]);
  check('...until forgotten', again.asked.length > 0, '');
}
{
  forgetDialogs();
  const loop = {
    '/mnt/override/apps/x/loop/cq:dialog': { items: { a: include('/apps/x/a') } },
    '/apps/x/a': { items: { one: text('./one', 'One'), b: include('/apps/x/b') } },
    '/apps/x/b': { items: { two: text('./two', 'Two'), back: include('/apps/x/a') } }
  };
  const r = await readDialogs(fakeClient(loop), ['x/loop']);
  check('an include that leads back to itself ends, with what it found', r.dialogs['x/loop']?.map((f) => f.prop).sort().join() === 'one,two', JSON.stringify(r.dialogs));
}
{
  forgetDialogs();
  const failing = { async readJson() { throw new Error('did not return JSON'); } };
  const r = await readDialogs(failing, [SC]);
  check('a dialog that cannot be read is no dialog - never an error', r.unread === 1 && !Object.keys(r.dialogs).length, JSON.stringify(r));
}
check('reads nothing but JSON nodes - a fresh walk gives the same fields', JSON.stringify(dialogFields(REPO[`${ITEMS}/fieldsets/fieldset-link`]).map((f) => f.prop)) === JSON.stringify(['text', 'linkEng', 'linkTitle', 'linkPath', 'target', 'videoId', 'videoAlt', 'caption', 'datePublished']), '');

console.log('\n--- what it changes on the sheet --------------------------------------');

/** The Levant "best tablet for work" page, trimmed: its showcase card, a full-bleed hero, the page itself. */
const PAGE = {
  'sling:resourceType': PG,
  'jcr:title': 'What is the best Samsung tablet for work?',
  twitterCard: 'Summary',
  subtitle: 'Work smarter',
  root: {
    'sling:resourceType': 'wcm/foundation/components/responsivegrid',
    responsivegrid: {
      'sling:resourceType': 'wcm/foundation/components/responsivegrid',
      pd_g_feature_benefit: {
        'sling:resourceType': FB,
        headlineText: 'What is the best Samsung tablet for work?',
        headlineTextForAnalytics: 'What is the best Samsung tablet for work',
        eyebrowText: 'Buying guide',
        imageAlternativeText: 'What is the best Samsung tablet for work?',
        desktopImageName: 'Desktop KV tablet work.png',
        text2: 'Shop tablets',
        textForAnalytics2: 'Shop tablets'
      },
      ho_g_showcase_card_c: {
        'sling:resourceType': `${SC}`,
        setting: { theme: 'white', useCta: 'true' },
        column: {
          layout: '5-122',
          item1: {
            text: 'Compare the models',
            linkEng: 'Compare the models',
            linkTitle: 'Compare the models',
            altText: 'Compare the models',
            pcText: 'Compare the models',
            moText: 'Compare the models',
            pcDesc: 'Find the best phone fit for you.',
            moDesc: 'Find the best phone fit for you.',
            engText: 'Compare the models',
            reportTitle: 'Compare Models Card',
            textAlign: 'Center',
            badgeText: 'New',
            linkPath: '/levant/smartphones/compare/'
          },
          item2: { text: 'Read more', linkEng: 'Read more', pcText: '<br>Best A Series Phone', moText: 'Best A Series Phone', engText: 'Best A Series Phone' }
        }
      }
    }
  }
};

const without = core.extractCopyDeck(clone(PAGE));
const withD = core.extractCopyDeck(clone(PAGE), { dialogs: read.dialogs });
const listed = (d) => d.newFields.map((f) => `${f.component}@${f.prop}`).sort();

check(
  'without the dialogs, a setting that reads like a word is offered (textAlign "Center"), and so is English for analytics no name gives away',
  listed(without).includes(`ho-g-showcase-card@textAlign`) && listed(without).includes('ho-g-showcase-card@reportTitle'),
  JSON.stringify(listed(without))
);
check(
  'with them, neither is: the dialog says what they are',
  !listed(withD).includes('ho-g-showcase-card@textAlign') && !listed(withD).includes('ho-g-showcase-card@reportTitle'),
  JSON.stringify(listed(withD))
);
check(
  '...and an image\'s file name is not offered either',
  listed(without).includes('pd-g-feature-benefit-full-bleed@desktopImageName') && !listed(withD).includes('pd-g-feature-benefit-full-bleed@desktopImageName'),
  JSON.stringify(listed(without))
);
check(
  'the card\'s own text is still offered: pcText, moText, pcDesc, moDesc, badgeText - and eyebrowText, text2, the page subtitle',
  ['ho-g-showcase-card@pcText', 'ho-g-showcase-card@moText', 'ho-g-showcase-card@pcDesc', 'ho-g-showcase-card@moDesc', 'ho-g-showcase-card@badgeText', 'pd-g-feature-benefit-full-bleed@eyebrowText', 'pd-g-feature-benefit-full-bleed@text2', 'page-static-gnb@subtitle'].every((id) => listed(withD).includes(id)),
  JSON.stringify(listed(withD))
);
{
  const pc = withD.newFields.find((f) => f.prop === 'pcText');
  check('...each with its label and length from the dialog', pc.label === 'Desktop Text' && pc.limit === 'Recommend to enter up to 30 characters and 2 lines', JSON.stringify(pc));
}
check(
  'linkEng, engText, twitterCard and textForAnalytics2 are never offered, with or without the dialogs',
  [without, withD].every((d) => !d.newFields.some((f) => ['linkEng', 'engText', 'twitterCard', 'textForAnalytics2'].includes(f.prop))),
  JSON.stringify(listed(without))
);
{
  const fields = {
    add: [
      { component: 'ho-g-showcase-card', prop: 'pcText', group: 'copy' },
      { component: 'ho-g-showcase-card', prop: 'reportTitle', group: 'copy' },
      { component: 'ho-g-showcase-card', prop: 'linkEng', group: 'cta' },
      { component: 'page-static-gnb', prop: 'twitterCard', group: 'page' }
    ]
  };
  const d = core.extractCopyDeck(clone(PAGE), { fields, dialogs: read.dialogs });
  const pc = d.rows.find((r) => r.key === 'root/responsivegrid/ho_g_showcase_card_c/column/item1@pcText');
  check('an added field is labelled as the dialog labels it', pc?.added && pc.field.endsWith('Desktop Text'), JSON.stringify(pc));
  check(
    'an added field the dialog says is English for analytics stays off the sheet - and so do linkEng and twitterCard',
    !d.rows.some((r) => ['reportTitle', 'linkEng', 'twitterCard'].includes(r.prop)),
    JSON.stringify(d.rows.filter((r) => ['reportTitle', 'linkEng', 'twitterCard'].includes(r.prop)).map((r) => r.key))
  );
  check('cleanFields drops linkEng and twitterCard from what is stored', JSON.stringify(core.cleanFields(fields).add.map((f) => f.prop)) === JSON.stringify(['pcText', 'reportTitle']), JSON.stringify(core.cleanFields(fields)));

  const sheet = core.buildSheet(d.rows, { pagePath: '/content/samsung/levant/x' });
  const col = Object.fromEntries(sheet.columns.map((c, i) => [c.split(' ')[0], i]));
  const compare = sheet.records.find((r) => r[col.Source] === 'Compare the models');
  check(
    'the length goes in the Notes: "Compare the models" is a link text of up to 25 characters and a card text of up to 30',
    compare && /Length: Recommend to enter up to 25 characters \/ Recommend to enter up to 30 characters and 2 lines/.test(compare[col.Notes]),
    compare && compare[col.Notes]
  );
  check(
    '...on one row for the four places it is used: text, link title, alt text, desktop text',
    compare && compare[col.Key].split('\n').length === 4 && /Used in 4 places/.test(compare[col.Notes]),
    compare && compare[col.Key]
  );
  const hero = sheet.records.find((r) => r[col.Key].split('\n').includes('root/responsivegrid/pd_g_feature_benefit@headlineText'));
  check(
    'a field the rules know gets the dialog\'s length too, and the page title with the same words shares its row',
    hero && /Length: Input page title to display on browser tab \(max\. 1000 characters\) \/ Recommend to enter up to 14 characters/.test(hero[col.Notes]) && hero[col.Key].split('\n')[0] === '.@jcr:title',
    hero && JSON.stringify([hero[col.Key], hero[col.Notes]])
  );
}

{
  // RC01_Static Content's dialog: three tabs, one text area each.
  const tab = (name, fieldLabel) => ({ items: { [name]: area(`./${name}`, fieldLabel, { 'granite:class': 'static-content-textarea' }) } });
  const dialog = { content: { items: { tabs: { items: { header: tab('headerInclude', 'Header (CSS)'), body: tab('bodyHtml', 'Body (HTML)'), footer: tab('footerInclude', 'Footer (JavaScript)') } } } } };
  const kinds = Object.fromEntries(dialogFields(dialog).map((f) => [f.prop, f.kind]));
  check('a text area labelled (CSS) or (JavaScript) is code; one labelled (HTML) is text', JSON.stringify(kinds) === JSON.stringify({ headerInclude: 'code', bodyHtml: 'text', footerInclude: 'code' }), JSON.stringify(kinds));

  // On a component no list names, the label alone keeps it off: never offered, never on the sheet, even added.
  const RAW = 'samsung/components/content/consumer/global/common/cm-g-raw-code';
  const page = { 'jcr:title': 'x', root: { responsivegrid: { raw: { 'sling:resourceType': RAW, scriptCode: 'document.title = "Welcome to Samsung Health";' } } } };
  const dialogs = { [RAW]: dialogFields({ items: { scriptCode: area('./scriptCode', 'Script (Javascript)') } }) };
  const add = { add: [{ component: 'cm-g-raw-code', prop: 'scriptCode', group: 'copy' }] };
  check(
    '...so code is never offered, nor on the sheet even added - where without the dialog it reads like words',
    core.extractCopyDeck(clone(page)).newFields.some((f) => f.prop === 'scriptCode') &&
      !core.extractCopyDeck(clone(page), { dialogs }).newFields.some((f) => f.prop === 'scriptCode') &&
      !core.extractCopyDeck(clone(page), { dialogs, fields: add }).rows.some((r) => r.prop === 'scriptCode'),
    JSON.stringify(dialogs)
  );
}

console.log('\n--- the worker reads the dialogs with the page ---------------------------');

{
  forgetDialogs();
  const mk = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => body, json: async () => JSON.parse(body) });
  const pagePath = '/content/samsung/levant/best-tablet-for-work';
  const repo = { ...REPO, [pagePath]: { 'jcr:primaryType': 'cq:Page', 'jcr:content': clone(PAGE) }, [`${pagePath}/jcr:content`]: clone(PAGE) };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURI(String(url).split('?')[0]);
    calls.push(`${(init.method || 'GET').toUpperCase()} ${u}`);
    const m = u.match(/^(.*)\.(\d+|infinity)\.json$/);
    const node = m && repo[m[1]];
    return node ? mk(200, JSON.stringify(node)) : mk(404, 'nf');
  };
  const lines = [];
  const report = (level, message, data) => lines.push({ level, message, data });
  const result = await actions.read({ client: new AemClient({ report }), report, params: { page: pagePath }, settings: {} });
  check('reads only', calls.every((c) => c.startsWith('GET ')), JSON.stringify(calls.filter((c) => !c.startsWith('GET '))));
  check('hands the panel the dialogs with the page, so a redraw needs no second read', result.dialogs?.[SC]?.length > 0 && result.dialogs?.[PG]?.length > 0, Object.keys(result.dialogs || {}).join());
  check('...and its rows and fields were built with them', !result.newFields.some((f) => f.prop === 'textAlign') && result.newFields.find((f) => f.prop === 'pcText')?.label === 'Desktop Text', JSON.stringify(result.newFields.map((f) => f.prop)));
  check('says how many dialogs it read', lines.some((l) => l.level === 'info' && /^Read the dialogs of 3 of 3 components/.test(l.message)), JSON.stringify(lines.filter((l) => l.level === 'info').map((l) => l.message)));
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
