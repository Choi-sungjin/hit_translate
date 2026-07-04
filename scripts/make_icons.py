#!/usr/bin/env python3
"""Build extension icons from a square master image.

Usage: python3 scripts/make_icons.py <master.png> [corner_radius_ratio]

Applies a rounded-rectangle alpha mask (the AI image models usually return
RGB with dark corners instead of transparency), saves a 512px master and
the 16/32/48/128 sizes into icons/.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    ratio = float(sys.argv[2]) if len(sys.argv) > 2 else 0.136
    out_dir = Path(__file__).resolve().parent.parent / 'icons'
    out_dir.mkdir(exist_ok=True)

    img = Image.open(src).convert('RGBA')
    if img.size[0] != img.size[1]:
        side = min(img.size)
        img = img.crop((0, 0, side, side))
    side = img.size[0]

    # Anti-aliased rounded-rect mask (drawn 4x, downscaled).
    big = side * 4
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, big - 1, big - 1], radius=int(big * ratio), fill=255
    )
    img.putalpha(mask.resize((side, side), Image.LANCZOS))

    img.resize((512, 512), Image.LANCZOS).save(out_dir / 'master-512.png')
    for s in (16, 32, 48, 128):
        img.resize((s, s), Image.LANCZOS).save(out_dir / f'{s}.png')
    print(f'wrote icons/master-512.png and 16/32/48/128 from {src}')

if __name__ == '__main__':
    main()
