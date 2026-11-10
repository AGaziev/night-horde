#!/usr/bin/env python3
"""v18 enemy sheets derived from the existing pack (same palette family, same cell layout).

sniper    «Трубач»      — the bone organist scaled down 2x, hood and eyes recoloured to teal.
shield    «Щитоносец»   — the shielded skeleton scaled up 1.5x, bones turned to cold iron, the shield brightened.
goldshade «Золотая тень» — the bat recoloured to gold.

Writes PNGs and manifest entries straight into app/public/sprites.
"""

import colorsys
import json
from pathlib import Path

from build_sprites import Image

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "app" / "public" / "sprites"


def recolor(img: Image, fn) -> Image:
    out = img.copy()
    px = out.pixels
    for i in range(0, len(px), 4):
        if px[i + 3] == 0:
            continue
        r, g, b = px[i] / 255, px[i + 1] / 255, px[i + 2] / 255
        h, s, v = colorsys.rgb_to_hsv(r, g, b)
        h, s, v = fn(h, s, v)
        r, g, b = colorsys.hsv_to_rgb(h % 1, max(0, min(1, s)), max(0, min(1, v)))
        px[i], px[i + 1], px[i + 2] = round(r * 255), round(g * 255), round(b * 255)
    return out


def downscale2(img: Image) -> Image:
    """2x box filter with premultiplied alpha, then a hard alpha cut to keep pixel-art edges."""
    w, h = img.width // 2, img.height // 2
    out = Image.blank(w, h)
    src = img.pixels
    for y in range(h):
        for x in range(w):
            acc = [0, 0, 0, 0]
            for dy in (0, 1):
                for dx in (0, 1):
                    i = ((y * 2 + dy) * img.width + x * 2 + dx) * 4
                    a = src[i + 3]
                    acc[0] += src[i] * a
                    acc[1] += src[i + 1] * a
                    acc[2] += src[i + 2] * a
                    acc[3] += a
            if acc[3] < 2 * 255:
                continue
            o = (y * w + x) * 4
            out.pixels[o:o + 4] = bytes([acc[0] // acc[3], acc[1] // acc[3], acc[2] // acc[3], 255])
    return out


def scale_nearest(img: Image, k: float) -> Image:
    return img.resize_nearest(round(img.width * k), round(img.height * k))


def sniper_color(h, s, v):
    deg = h * 360
    if 250 <= deg <= 345 and s > 0.15:  # purple hood and magenta eyes -> teal
        return 0.47 + (deg - 290) / 900, s * 1.05, v * (1.25 if s > 0.5 and v > 0.6 else 1.0)
    return h, s * 0.8, v


def shield_color(h, s, v):
    if v > 0.55 and s < 0.35:  # bone and the shield face -> cold iron
        return 0.58, 0.18 + s * 0.3, v * 0.95
    if s > 0.12:  # cloth and leather -> dark steel blue
        return 0.6, s * 0.6, v * 0.9
    return 0.6, s + 0.08, v * 1.05


def gold_color(h, s, v):
    return 0.12 + (h - 0.75) * 0.05, min(1, s * 0.9 + 0.35), min(1, v * 1.35 + 0.08)


def main():
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())

    gunner = Image.load(OUT / "gunner.png")
    recolor(downscale2(gunner), sniper_color).save(OUT / "sniper.png")
    manifest["sniper"] = {"file": "sniper.png", "cell": [96, 96], "frames": 6, "fps": 6, "anchor": [48, 92], "bodyRadius": 18, "attackFrames": [4, 5]}

    skel = Image.load(OUT / "skel.png")
    recolor(scale_nearest(skel, 1.5), shield_color).save(OUT / "shield.png")
    manifest["shield"] = {"file": "shield.png", "cell": [96, 96], "frames": 4, "fps": 6, "anchor": [48, 90], "bodyRadius": 21}

    bat = Image.load(OUT / "bat.png")
    recolor(bat, gold_color).save(OUT / "goldshade.png")
    manifest["goldshade"] = {**manifest["bat"], "file": "goldshade.png", "bodyRadius": 13, "fps": 12}

    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
