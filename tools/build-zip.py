"""Build the release zip Chrome installs.

Editing this folder changes nothing a person can see until the version in
manifest.json is bumped and a zip is built: Chrome runs the copy that was
installed, not the source.

    python tools/build-zip.py           # zip at the version in the manifest
    python tools/build-zip.py 1.1.0     # bump the manifest first, then zip

The zip holds the extension's files at its root - no wrapping folder, which
Chrome would refuse - and leaves out everything that is only for developing:
preview/, tools/, .claude/.
"""
import io
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_DIRS = {'preview', 'tools', '.claude', '.git', 'node_modules'}
SKIP_FILES = {'.DS_Store', 'Thumbs.db'}


def read_manifest():
    with io.open(os.path.join(ROOT, 'manifest.json'), encoding='utf-8') as f:
        return f.read()


def set_version(text, version):
    return re.sub(r'("version":\s*")[^"]+(")', r'\g<1>' + version + r'\g<2>', text, count=1)


def main():
    text = read_manifest()
    if len(sys.argv) > 1:
        text = set_version(text, sys.argv[1])
        with io.open(os.path.join(ROOT, 'manifest.json'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    version = json.loads(text)['version']

    out = os.path.join(os.path.dirname(ROOT), 'dsy-%s.zip' % version)
    count = 0
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for folder, dirs, files in os.walk(ROOT):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for name in files:
                if name in SKIP_FILES:
                    continue
                full = os.path.join(folder, name)
                rel = os.path.relpath(full, ROOT).replace(os.sep, '/')
                if rel.startswith('_'):
                    # Chrome refuses a name starting with an underscore.
                    continue
                z.write(full, rel)
                count += 1

    print('wrote %s (%d files, version %s)' % (out, count, version))
    print('Load it at chrome://extensions. The card should say version %s.' % version)


if __name__ == '__main__':
    main()
