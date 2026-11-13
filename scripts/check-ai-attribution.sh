#!/bin/sh
# SPDX-FileCopyrightText: 2026 Chams Bensalem
# SPDX-License-Identifier: MIT
#
# Fails if a commit message of the given range carries an AI attribution trailer (same rule as .githooks/commit-msg).
#   scripts/check-ai-attribution.sh <base>..<head>
set -eu
range="${1:?usage: scripts/check-ai-attribution.sh <base>..<head>}"
pattern='Co-Authored-By:[[:space:]]*Claude|Generated with Claude Code|Claude-Session:'

found=0
for sha in $(git rev-list "$range"); do
  if git log -1 --format=%B "$sha" | grep -qiE "$pattern"; then
    echo "AI attribution in commit $(git log -1 --format='%h %s' "$sha")" >&2
    found=1
  fi
done
if [ "$found" -ne 0 ]; then
  exit 1
fi
echo "AI attribution: $(git rev-list --count "$range") commit message(s) checked, none found."
