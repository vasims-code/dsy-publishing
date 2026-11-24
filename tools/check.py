"""The checks that need no browser.

    python tools/check.py

Three things:
  1. Every .js file parses as an ES module.
  2. panel.css has balanced braces.
  3. The engine is still the old extension's, file for file - so a change
     there is a decision, never a slip. Skipped if the old extension is not
     on this machine.

The screens themselves are checked in the browser: preview/test.html.
"""
import filecmp
import io
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = os.path.join(os.path.dirname(ROOT), 'chrome-extensions', 'aem-toolkit')
ENGINE = ['src/core', 'src/features', 'src/background', 'src/content']

fails = []


def js_files(*roots):
    for root in roots:
        base = os.path.join(ROOT, root)
        for folder, _dirs, files in os.walk(base):
            for name in files:
                if name.endswith('.js'):
                    yield os.path.join(folder, name)


def check_parses():
    """node --check reads a .js file as a script, so each is copied to .mjs."""
    tmp = tempfile.mkdtemp()
    try:
        for path in js_files('src', 'preview'):
            copy = os.path.join(tmp, 'chk.mjs')
            shutil.copyfile(path, copy)
            r = subprocess.run(['node', '--check', copy], capture_output=True, text=True)
            if r.returncode != 0:
                rel = os.path.relpath(path, ROOT)
                first = (r.stderr or '').strip().split('\n')
                fails.append('%s does not parse: %s' % (rel, first[-1] if first else ''))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check_css():
    path = os.path.join(ROOT, 'src/ui/panel.css')
    with io.open(path, encoding='utf-8') as f:
        text = f.read()
    if text.count('{') != text.count('}'):
        fails.append('panel.css braces do not balance: %d open, %d close' % (text.count('{'), text.count('}')))


# Engine files this extension changes deliberately, and why.
CHANGED_ON_PURPOSE = {
    # Whether a restored page has been edited since, asked of the version
    # itself rather than of a timestamp AEM rewrites on every restore. Page
    # properties an author sets count as drift and in the restore check; a
    # drift that could not be read says so; an unconfirmed restore is titled
    # so; the backup-page guard is insideBackupFolder.
    'src/features/page-versions/worker.js',
    # assertNotStripping: no write may empty components and put nothing back,
    # and three or more emptied need the removals box even when something else
    # is written. The read-back covers new components, missing nodes and
    # removals, and a partial result is a warning, never a match.
    'src/core/execute.js',
    # assertHasContent: a source page with no content in it is not a source.
    # Plus: removal rule by components emptied, not a share; a page the run
    # just created is not checked for removals; locale-owned properties kept
    # at the destination; a signed-out session stops the run.
    # Copy a component from another server: readPage carries only the
    # component, analyze and apply place it with page-upsert's component.js
    # and skip pairing, and `components` lists one page for the pickers.
    'src/features/page-transfer/worker.js',
    # A backup that cannot be taken is said out loud, not passed in silence.
    # A backup that differs is saved as a version before it is overwritten,
    # since it is the only copy; a backup that cannot be checked is shown as
    # unavailable rather than failing the analysis.
    # Copy a component: buildPlan narrows its two trees to one component when
    # params.component is set (./component.js), and a `components` action
    # lists a page's components for the picker. A whole-page plan is unchanged.
    'src/features/page-upsert/worker.js',
    # How long a quiet upload socket is given before it counts as stuck, and
    # how far it got when it is given up on. A sign-in page answered at 200
    # is a session that has ended, not a page that exists or a cut-off read.
    'src/core/aem-client.js',
    # A home page offers several readings of its title ending; the page being
    # copied decides which one its site actually uses - and only a reading
    # holding a word both home pages share, so a product list is not an ending.
    'src/core/site-values.js',
    # transferMaxImageMb: the biggest image a transfer carries, as a setting.
    # The removals fingerprint covers what is removed, not just its name, so
    # an edit between the review and the click is refused.
    'src/core/protocol.js',
    # keepPageProps: the review's page-properties box, unticked, keeps an
    # existing destination's own page properties instead of refusing the run.
    # Locale-owned properties are never written; the review lists every page
    # property the box would change, so ticking it is not refused.
    'src/core/diff.js',
    # insideBackupFolder: the one rule the Versions tool already enforced,
    # named once so versioning before a write can follow it too, and the same
    # rule as backupPathFor. A '.', '..' or encoded slash in a path is refused,
    # so no path is checked as one page and fetched as another. A site's home
    # page backs up to <site>/<folder>/home (HOME_BACKUP); a real page called
    # "home" right under the site is refused, since it would land on the same.
    # jiraTicket and ticketBackupPath: a second backup of a page, for a Jira
    # ticket, is a child page of its backup named by the ticket.
    'src/core/paths.js',
    # A component is named in the deck the way AEM's editor names it on the
    # page - its own jcr:title from /apps, "FT02_Feature Benefit" - instead of
    # a name worked out from its resource type.
    'src/features/copy-deck/dialog.js',
    'src/features/copy-deck/core.js',
    'src/features/copy-deck/worker.js',
    # Which templates make a product page is a setting, not one fixed name.
    'src/features/copy-deck/pd.js',
    'src/features/copy-deck-import/worker.js',
    # The import refuses a slipped Translation column, invisible text, a
    # typed (number, date) cell and data: links; a request AEM never answered
    # is put back too. The export leaves an over-long text off the sheet
    # rather than refusing the whole sheet. (core.js and import/worker.js above.)
    # The client's copy: Source text and Translation only, one sheet, named
    # _client (clientSheet, toClientXlsx); file names are site, last path
    # segment and a short date; the import names the client copy if pasted.
    'src/features/copy-deck/xlsx.js',
    # backupState says 'unavailable' with the reason instead of throwing; the
    # copy is read back for its jcr:content and template; a confirmed removal,
    # or a backup just saved as a version, is passed to the write's guard.
    # A backup named other than its page (the home page's) is made from the
    # page's template and filled by the sync plan: AEM's copy cannot rename.
    # A backup for a Jira ticket (params.ticket) goes under the page's own
    # backup, titled with the ticket, and is refused while that is not there.
    'src/features/page-copy/worker.js',
    # The Link Fixer: a bare host name, alt or title text and author-console
    # links are not links; only samsung.com and the author instances are
    # rewritten, never Copy a page's extra hosts; each pick must be one the
    # scanner finds now.
    'src/features/link-fixer/links.js',
    'src/features/link-fixer/worker.js',
    # A team file's settings are checked the way Settings checks a typed one.
    'src/core/team-defaults.js',
    # A command meant for another server is refused, so a tab that moved since
    # it was read is never written to.
    'src/content/runtime.js',
    # An image named by its Dynamic Media URL (images.samsung.com/is/image/
    # samsung/assets/<site>/...) - as a static content component's <picture>
    # names it - is read as the DAM image it serves: uploaded to the
    # destination's DAM and re-pointed at the destination site, in its own form.
    # (diff.js and page-upsert/worker.js count it as an image, not a link.)
    'src/core/dynamic-media.js',
    'src/core/rewrite.js',
}


def check_engine():
    if not os.path.isdir(OLD):
        print('engine comparison skipped - %s is not here' % OLD)
        return
    same = 0
    for root in ENGINE:
        for folder, _dirs, files in os.walk(os.path.join(ROOT, root)):
            for name in files:
                if not name.endswith('.js'):
                    continue
                mine = os.path.join(folder, name)
                rel = os.path.relpath(mine, ROOT).replace(os.sep, '/')
                theirs = os.path.join(OLD, rel)
                if not os.path.isfile(theirs):
                    fails.append('%s is not in the old extension' % rel)
                elif filecmp.cmp(mine, theirs, shallow=False):
                    same += 1
                else:
                    # Changed on purpose; anything else is a slip.
                    if rel not in CHANGED_ON_PURPOSE:
                        fails.append('%s differs from the old extension' % rel)
    print('engine files identical to the old extension: %d' % same)


check_parses()
check_css()
check_engine()

if fails:
    print('\n%d problem(s):' % len(fails))
    for f in fails:
        print('  - %s' % f)
    sys.exit(1)
print('all checks pass')
