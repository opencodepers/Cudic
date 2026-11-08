#!/usr/bin/env python3
"""What does the repo already know about this file?

    python tools/file-docs.py                  coverage gate: files with no note
    python tools/file-docs.py --path <file>     everything written about one file
    python tools/file-docs.py --list            one line per source file

A file's note is the comment block at the top of the file (AGENTS.md section 2b):
`what:` it is, the `invariants:` that break silently, and where `see:` the long
version. `--path` prints that note, then every AGENTS.md / CHANGELOG.md /
docs.html line that mentions the file, the files that import it, and the tests
that pin it. Exit 1 when a source file has no note.
"""

import ast
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

try:  # Windows consoles default to cp1252 and choke on the notes' punctuation
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, OSError):
    pass

DOC_FILES = ('AGENTS.md', 'CHANGELOG.md', 'public/docs.html')
SKIP_DIRS = ('node_modules', 'public/studio', 'public/islands', 'studio/dist', 'archive')
DOC_START = ('//', '/*', '*', '#', '"""', "'''", '<!--')
MAX_NOTE = 18


def read(path):
    with open(path, encoding='utf-8', errors='replace') as handle:
        # A BOM would hide the opening `/*` from the note scan.
        return handle.read().lstrip('\ufeff')


def sources():
    found = ['server.js'] if os.path.exists('server.js') else []
    patterns = ('public/*.js', 'studio/src/**/*.ts', 'studio/src/**/*.css',
                'cli/*.mjs', 'islands/src/**/*.ts', 'islands/src/**/*.tsx',
                'tools/*.py')
    for pattern in patterns:
        for path in glob.glob(pattern, recursive=True):
            label = path.replace('\\', '/')
            if any(part in label for part in SKIP_DIRS):
                continue
            found.append(label)
    return sorted(set(found))


def note(path):
    lines = read(path).splitlines()
    out = []
    in_block = False
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if out:
                out.append(line)
            continue
        if not out and stripped.startswith('#!'):
            continue
        if in_block:
            out.append(line)
            if '*/' in stripped or '-->' in stripped:
                in_block = False
            if len(out) >= MAX_NOTE:
                break
            continue
        if stripped.startswith(('/*', '<!--')) and '*/' not in stripped and '-->' not in stripped:
            in_block = True
            out.append(line)
            continue
        if stripped.startswith(DOC_START):
            out.append(line)
            if len(out) >= MAX_NOTE:
                break
            continue
        break
    while out and not out[-1].strip():
        out.pop()
    return out


def module_docstring(path):
    try:
        return ast.get_docstring(ast.parse(read(path))) or ''
    except SyntaxError:
        return ''


def has_note(path):
    if path.endswith('.py') and len(module_docstring(path).strip().splitlines()) >= 2:
        return True
    return len([line for line in note(path) if line.strip()]) >= 2


def mentions(path):
    hits = []
    stem = os.path.basename(path)
    for doc in DOC_FILES:
        if not os.path.exists(doc):
            continue
        for number, line in enumerate(read(doc).splitlines(), 1):
            if stem in line or path in line:
                hits.append('%s:%d  %s' % (doc, number, line.strip()[:160]))
    return hits


def importers(path):
    stem = os.path.splitext(os.path.basename(path))[0]
    hits = []
    for other in glob.glob('studio/src/**/*.ts', recursive=True) + \
            glob.glob('islands/src/**/*.ts*', recursive=True) + \
            glob.glob('public/*.js'):
        other = other.replace('\\', '/')
        if other == path:
            continue
        text = read(other)
        if re.search(r"""(from\s+['"][^'"]*%s['"]|require\(['"][^'"]*%s['"]\))""" % (re.escape(stem), re.escape(stem)), text):
            hits.append(other)
    return hits


def pins(path):
    hits = []
    stem = os.path.basename(path)
    for test in sorted(glob.glob('tests/*.py')):
        for number, line in enumerate(read(test).splitlines(), 1):
            if stem in line:
                hits.append('%s:%d  %s' % (test, number, line.strip()[:140]))
    return hits


def detail(path):
    if not os.path.exists(path):
        print('no such file: %s' % path)
        return 1
    path = path.replace('\\', '/')
    print('== %s' % path)
    block = note(path)
    print('\n'.join(block) if block else '  (no note at the top of this file — add one, AGENTS.md 2b)')
    for title, items in (('mentioned in', mentions(path)),
                         ('imported by', importers(path)),
                         ('pinned by tests', pins(path))):
        print('\n-- %s (%d)' % (title, len(items)))
        for item in items:
            print('   ' + item)
    return 0


def main(argv):
    if '--path' in argv:
        return detail(argv[argv.index('--path') + 1])
    files = sources()
    missing = [path for path in files if not has_note(path)]
    if '--list' in argv:
        for path in files:
            mark = 'note' if has_note(path) else 'MISS'
            first = next((line for line in note(path) if 'what:' in line), '')
            print('%-4s %-46s %s' % (mark, path, first.strip()[:80]))
        print('\n%d files, %d without a note' % (len(files), len(missing)))
        return 0
    for path in missing:
        print('MISS  %s' % path)
    print('file notes: %d/%d documented' % (len(files) - len(missing), len(files)))
    if missing:
        print('Add the 4-line note to each (AGENTS.md 2b), or the repo keeps '
              're-learning these files from scratch.')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
