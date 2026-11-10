#!/usr/bin/env python3

import json
from pathlib import Path

from build_sprites import Image, build_strip, connected_components, make_hero_mask


ROOT = Path(__file__).parent
OUT = ROOT / "out"
SHOTS = ROOT / "shots"

SPEC = {
    "file": "spearmaiden.png",
    "cell": [96, 96],
    "frames": 5,
    "fps": 8,
    "anchor": [48, 90],
    "bodyRadius": 14,
    "mask": "spearmaiden_mask.png",
}


def recolor_masked(sheet: Image, mask: Image, color: tuple[int, int, int]) -> Image:
    result = sheet.copy()
    for y in range(sheet.height):
        for x in range(sheet.width):
            if mask.pixel(x, y)[3] == 0:
                continue
            r, g, b, a = sheet.pixel(x, y)
            result.set_pixel(
                x,
                y,
                (
                    round(r * color[0] / 255),
                    round(g * color[1] / 255),
                    round(b * color[2] / 255),
                    a,
                ),
            )
    return result


def make_spearmaiden_mask(sheet: Image) -> Image:
    mask = make_hero_mask("spearmaiden", sheet, 5, 96, 96)
    for frame_index in range(5):
        offset = frame_index * 96
        points = set()
        for y in range(96):
            for x in range(96):
                r, g, b, a = sheet.pixel(offset + x, y)
                if a and max(r, g, b) - min(r, g, b) <= 52 and 120 <= (r + g + b) // 3 <= 245:
                    points.add((x, y))
        for component in connected_components(points):
            if len(component) < 20:
                continue
            xs = [point[0] for point in component]
            ys = [point[1] for point in component]
            center_x = (min(xs) + max(xs)) / 2
            is_cape = center_x < 60 and min(ys) >= 30
            if not is_cape:
                continue
            for x, y in component:
                mask.set_pixel(offset + x, y, (255, 255, 255, 255))
    return mask


def tiled_ground(width: int, height: int) -> Image:
    ground = Image.load(OUT / "ground.png")
    result = Image.blank(width, height, (27, 36, 32, 255))
    for y in range(0, height, ground.height):
        for x in range(0, width, ground.width):
            result.paste(ground, x, y, alpha_blend=False)
    return result


def make_check(sheet: Image, mask: Image) -> Image:
    knight = Image.load(OUT / "knight.png")
    variants = [
        sheet,
        knight,
        recolor_masked(sheet, mask, (224, 80, 80)),
        recolor_masked(sheet, mask, (80, 160, 224)),
        recolor_masked(sheet, mask, (96, 192, 96)),
    ]
    scaled = [image.resize_nearest(image.width * 3, image.height * 3) for image in variants]
    padding = 24
    cell_w = scaled[0].width
    cell_h = scaled[0].height
    canvas = tiled_ground(cell_w * 2 + padding * 3, cell_h * 3 + padding * 4)
    positions = [
        (padding, padding),
        (cell_w + padding * 2, padding),
        (padding, cell_h + padding * 2),
        (cell_w + padding * 2, cell_h + padding * 2),
        (padding, cell_h * 2 + padding * 3),
    ]
    for image, (left, top) in zip(scaled, positions):
        canvas.paste(image, left, top)
    return canvas


def update_manifest() -> None:
    path = OUT / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["spearmaiden"] = SPEC
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    SHOTS.mkdir(exist_ok=True)
    sheet = build_strip("spearmaiden", 5, (96, 96), 24, 4, True)
    mask = make_spearmaiden_mask(sheet)
    sheet.save(OUT / "spearmaiden.png")
    mask.save(OUT / "spearmaiden_mask.png")
    update_manifest()
    make_check(sheet, mask).save(SHOTS / "spearmaiden-check.png")


if __name__ == "__main__":
    main()
