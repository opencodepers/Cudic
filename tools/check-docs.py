#!/usr/bin/env python3
"""Fail when AGENTS.md / PROJECT_MEMORY.md drift from the repository.

Docs rot. This makes drift a red check instead of a silent trap:

  python tools/check-docs.py

Checks: the GitHub remote slug appears in both files; the `?v=` numbers claimed
for shared assets match what the pages actually load; every file under
`studio/src/` is described; every page in `public/` is either routed (Vercel
rewrite + server.js redirect) or on AGENTS.md's "route-less" list.
Exit 1 on failure, 0 when the docs are current.
"""

import collections
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

fails = []
warns = []


def read(path):
    with open(path, encoding='utf-8', errors='replace') as handle:
        return handle.read()


agents = read('AGENTS.md')
memory = read('PROJECT_MEMORY.md')

# 1. Remote slug -----------------------------------------------------------
try:
    remotes = subprocess.run(['git', 'remote', '-v'], capture_output=True,
                             text=True, check=False).stdout
except OSError:
    remotes = ''
match = re.search(r'github\.com[:/]([\w.\-]+/[\w.\-]+?)(?:\.git)?\s', remotes)
fix = re.search(r'github\.com[:/]([\w.\-]+/[\w.\-]+?)(?:\.git)?\s',
                re.sub(r'^\s*[-*]\s*', '', memory, flags=re.M))
if not match:
    warns.append('no GitHub remote configured — remote check skipped')
else:
    slug = match.group(1)
    for name, text in (('AGENTS.md', agents), ('PROJECT_MEMORY.md', memory)):
        if slug not in text:
            fails.append('%s never mentions the real remote %s' % (name, slug))
    if fix and fix.group(1) != slug:
        fails.append('PROJECT_MEMORY.md names %s, the remote is %s'
                     % (fix.group(1), slug))

# 2. Shared asset versions -------------------------------------------------
pages = sorted(glob.glob('public/*.html'))
for asset in ('sidebar.css', 'sidebar.js', 'client.js', 'islands.js'):
    version = re.compile(re.escape(asset) + r'\?v=(\d+)')
    counts = collections.Counter()
    per_page = {}
    for page in pages:
        found = [int(v) for v in version.findall(read(page))]
        per_page[page] = found
        counts.update(found)
    if not counts:
        continue
    real = counts.most_common(1)[0][0]
    claimed = sorted(set(version.findall(agents)), key=int)
    if not claimed:
        fails.append('AGENTS.md never states the current %s?v= number' % asset)
    for value in claimed:
        if int(value) != real:
            fails.append('AGENTS.md says %s?v=%s but the pages load v%d'
                         % (asset, value, real))
    for page, found in per_page.items():
        if found and real not in found:
            warns.append('%s loads %s?v=%d (most pages v%d)'
                         % (page, asset, found[0], real))

# 3. Studio source inventory ----------------------------------------------
for path in sorted(glob.glob('studio/src/**/*', recursive=True)):
    if not path.endswith(('.ts', '.css', '.html', '.svg')):
        continue
    name = os.path.basename(path)
    if name not in agents:
        fails.append('AGENTS.md does not describe studio source %s' % path)

# 4. Route wiring ----------------------------------------------------------
vercel = read('vercel.json') if os.path.exists('vercel.json') else ''
server = read('server.js')
block = re.search(r'Known route-less files(.{0,700}?)\.\s', agents, re.S)
if block:
    route_less = re.findall(r'`([\w<>/.\-]+)`', block.group(1))
else:
    route_less = []
    fails.append('AGENTS.md lost its "Known route-less files" list')

for page in pages:
    name = os.path.basename(page)[:-5]
    if name in route_less:
        continue
    if name.startswith('google') and 'google<hex>.html' in route_less:
        continue
    has_rewrite = '"/%s"' % name in vercel
    has_redirect = "'/%s'" % name in server
    if has_rewrite and has_redirect:
        continue
    missing = [label for label, ok in
               (('vercel.json rewrite', has_rewrite),
                ('server.js redirect', has_redirect)) if not ok]
    if has_rewrite or has_redirect:
        warns.append('/%s is half-wired — missing %s' % (name, ', '.join(missing)))
    else:
        fails.append('/%s is unrouted and not on the route-less list' % name)

# Report -------------------------------------------------------------------
for line in warns:
    print('warn  %s' % line)
for line in fails:
    print('FAIL  %s' % line)
print('docs check: %d failure(s), %d warning(s)' % (len(fails), len(warns)))
sys.exit(1 if fails else 0)
