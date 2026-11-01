#!/bin/sh
# Push a ready-to-run build folder (or .zip) to itch.io with butler.
#
# Usage:  ./push.sh <project-slug> <channel> <build-path> [version]
#   e.g.  ./push.sh my-cool-game html5 ./my-cool-game v1.2
#
# <build-path> must contain index.html at its top level for html5 uploads
# (Cudic's "Export zip" output is already shaped right: unzip, then push).
#
# Requirements: butler (C:\Users\sophi\.local\bin) authenticated once —
# the itch API key is already in %USERPROFILE%\.config\itch\butler_creds.
set -e

SLUG="${1:?project slug, e.g. my-cool-game}"
CH="${2:-html5}"
SRC="${3:?path to build folder or .zip}"
VER="${4:-}"

TARGET="opencodepers/$SLUG"
echo "==> pushing $SRC -> $TARGET:$CH ${VER:+(userversion $VER)}"

butler push --userversion="${VER:-none}" "$SRC" "$TARGET:$CH"
echo "==> done: https://opencodepers.itch.io/$SLUG"
