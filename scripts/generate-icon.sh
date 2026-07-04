#!/bin/sh
# Regenerate the extension icon with an AI image model via the Codex CLI
# (uses your ChatGPT account's built-in image generation), then rebuild
# all icon sizes. Requires: codex (npm i -g @openai/codex), Python + Pillow.
set -e
cd "$(dirname "$0")/.."

WORK=$(mktemp -d)
codex exec --skip-git-repo-check --sandbox workspace-write -C "$WORK" \
  "Use your image generation tool to create ONE app icon image, then save it \
as icon.png in the current working directory. Requirements: modern flat \
rounded-square app icon for a browser translation extension named 'Hit \
Translate', vibrant sky-blue to indigo vertical gradient; two overlapping \
chat speech bubbles — upper-left white bubble with bold letter 'A', \
lower-right dark navy bubble with white outline containing the white Korean \
character '가'. Clean vector style, no other text, no watermark, crisp when \
downscaled to 16px, square 1024x1024. Do nothing else."

python3 scripts/make_icons.py "$WORK/icon.png"
rm -rf "$WORK"
echo "Done. Reload the extension at chrome://extensions to see the new icon."
