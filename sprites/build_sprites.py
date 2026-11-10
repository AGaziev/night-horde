#!/usr/bin/env python3
"""Build the Night Horde sprite pack from generated PNG source sheets.

Pillow is not available in the sandbox, so this script keeps the requested
Python workflow while using a small, task-local PNG reader/writer. It supports
the 8-bit RGB/RGBA, non-interlaced PNG files produced for this pack.
"""

from __future__ import annotations

import json
import math
import struct
import zlib
from collections import Counter, deque
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "_generated"
OUT = ROOT / "out"


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


@dataclass
class Image:
    width: int
    height: int
    pixels: bytearray

    @classmethod
    def blank(cls, width: int, height: int, color=(0, 0, 0, 0)) -> "Image":
        return cls(width, height, bytearray(color * (width * height)))

    @classmethod
    def load(cls, path: Path) -> "Image":
        raw = path.read_bytes()
        if raw[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError(f"Not a PNG: {path}")
        pos = 8
        idat = bytearray()
        width = height = bit_depth = color_type = interlace = None
        while pos < len(raw):
            length = struct.unpack(">I", raw[pos:pos + 4])[0]
            kind = raw[pos + 4:pos + 8]
            data = raw[pos + 8:pos + 8 + length]
            pos += 12 + length
            if kind == b"IHDR":
                width, height, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", data)
            elif kind == b"IDAT":
                idat.extend(data)
            elif kind == b"IEND":
                break
        if bit_depth != 8 or color_type not in (2, 6) or interlace != 0:
            raise ValueError(f"Unsupported PNG layout in {path}: depth={bit_depth}, type={color_type}, interlace={interlace}")
        channels = 4 if color_type == 6 else 3
        stride = width * channels
        decoded = zlib.decompress(bytes(idat))
        rows = []
        cursor = 0
        previous = bytearray(stride)
        for _ in range(height):
            filter_type = decoded[cursor]
            cursor += 1
            packed = bytearray(decoded[cursor:cursor + stride])
            cursor += stride
            row = bytearray(stride)
            for x, value in enumerate(packed):
                left = row[x - channels] if x >= channels else 0
                up = previous[x]
                up_left = previous[x - channels] if x >= channels else 0
                if filter_type == 0:
                    result = value
                elif filter_type == 1:
                    result = (value + left) & 255
                elif filter_type == 2:
                    result = (value + up) & 255
                elif filter_type == 3:
                    result = (value + ((left + up) // 2)) & 255
                elif filter_type == 4:
                    result = (value + paeth(left, up, up_left)) & 255
                else:
                    raise ValueError(f"Unsupported PNG filter {filter_type} in {path}")
                row[x] = result
            rows.append(row)
            previous = row
        rgba = bytearray(width * height * 4)
        out = 0
        for row in rows:
            for x in range(width):
                base = x * channels
                rgba[out:out + 3] = row[base:base + 3]
                rgba[out + 3] = row[base + 3] if channels == 4 else 255
                out += 4
        return cls(width, height, rgba)

    def save(self, path: Path, compress_level: int = 9) -> None:
        def chunk(kind: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

        scan = bytearray()
        stride = self.width * 4
        for y in range(self.height):
            scan.append(0)
            start = y * stride
            scan.extend(self.pixels[start:start + stride])
        header = struct.pack(">IIBBBBB", self.width, self.height, 8, 6, 0, 0, 0)
        payload = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
        payload += chunk(b"IDAT", zlib.compress(bytes(scan), compress_level))
        payload += chunk(b"IEND", b"")
        path.write_bytes(payload)

    def pixel(self, x: int, y: int) -> tuple[int, int, int, int]:
        i = (y * self.width + x) * 4
        return tuple(self.pixels[i:i + 4])

    def set_pixel(self, x: int, y: int, color) -> None:
        i = (y * self.width + x) * 4
        self.pixels[i:i + 4] = bytes(color)

    def copy(self) -> "Image":
        return Image(self.width, self.height, bytearray(self.pixels))

    def crop(self, left: int, top: int, right: int, bottom: int) -> "Image":
        left = max(0, min(self.width, left))
        right = max(left, min(self.width, right))
        top = max(0, min(self.height, top))
        bottom = max(top, min(self.height, bottom))
        result = Image.blank(right - left, bottom - top)
        for y in range(result.height):
            src_start = ((top + y) * self.width + left) * 4
            dst_start = y * result.width * 4
            result.pixels[dst_start:dst_start + result.width * 4] = self.pixels[src_start:src_start + result.width * 4]
        return result

    def alpha_bbox(self, threshold: int = 8):
        xs = []
        ys = []
        for y in range(self.height):
            for x in range(self.width):
                if self.pixels[(y * self.width + x) * 4 + 3] > threshold:
                    xs.append(x)
                    ys.append(y)
        if not xs:
            return None
        return min(xs), min(ys), max(xs) + 1, max(ys) + 1

    def resize_nearest(self, width: int, height: int) -> "Image":
        result = Image.blank(width, height)
        for y in range(height):
            sy = min(self.height - 1, (y * self.height) // height)
            for x in range(width):
                sx = min(self.width - 1, (x * self.width) // width)
                src = (sy * self.width + sx) * 4
                dst = (y * width + x) * 4
                result.pixels[dst:dst + 4] = self.pixels[src:src + 4]
        return result

    def paste(self, other: "Image", left: int, top: int, alpha_blend: bool = True) -> None:
        for y in range(other.height):
            dy = top + y
            if dy < 0 or dy >= self.height:
                continue
            for x in range(other.width):
                dx = left + x
                if dx < 0 or dx >= self.width:
                    continue
                s = (y * other.width + x) * 4
                d = (dy * self.width + dx) * 4
                sr, sg, sb, sa = other.pixels[s:s + 4]
                if sa == 0:
                    continue
                if not alpha_blend or sa == 255:
                    self.pixels[d:d + 4] = other.pixels[s:s + 4]
                    continue
                dr, dg, db, da = self.pixels[d:d + 4]
                out_a = sa + (da * (255 - sa) + 127) // 255
                if out_a == 0:
                    self.pixels[d:d + 4] = b"\0\0\0\0"
                    continue
                self.pixels[d] = (sr * sa + dr * da * (255 - sa) // 255) // out_a
                self.pixels[d + 1] = (sg * sa + dg * da * (255 - sa) // 255) // out_a
                self.pixels[d + 2] = (sb * sa + db * da * (255 - sa) // 255) // out_a
                self.pixels[d + 3] = out_a

    def clean_alpha(self) -> None:
        for i in range(0, len(self.pixels), 4):
            if self.pixels[i + 3] < 80:
                self.pixels[i:i + 4] = b"\0\0\0\0"
            else:
                self.pixels[i + 3] = 255


def quantize(image: Image, colors: int) -> Image:
    counts = Counter()
    for i in range(0, len(image.pixels), 4):
        if image.pixels[i + 3] >= 128:
            counts[tuple(image.pixels[i:i + 3])] += 1
    if len(counts) <= colors:
        return image
    seeds = [list(color) for color, _ in counts.most_common(colors)]
    items = list(counts.items())
    for _ in range(7):
        sums = [[0, 0, 0, 0] for _ in seeds]
        for color, weight in items:
            index = min(range(len(seeds)), key=lambda j: sum((color[k] - seeds[j][k]) ** 2 for k in range(3)))
            bucket = sums[index]
            bucket[0] += color[0] * weight
            bucket[1] += color[1] * weight
            bucket[2] += color[2] * weight
            bucket[3] += weight
        for index, bucket in enumerate(sums):
            if bucket[3]:
                seeds[index] = [bucket[k] // bucket[3] for k in range(3)]
    cache = {}
    result = image.copy()
    for i in range(0, len(result.pixels), 4):
        if result.pixels[i + 3] < 128:
            result.pixels[i:i + 4] = b"\0\0\0\0"
            continue
        color = tuple(result.pixels[i:i + 3])
        if color not in cache:
            cache[color] = tuple(min(seeds, key=lambda seed: sum((color[k] - seed[k]) ** 2 for k in range(3))))
        result.pixels[i:i + 3] = bytes(cache[color])
        result.pixels[i + 3] = 255
    return result


def fit_frame(frame: Image, cell_w: int, cell_h: int, padding: int, grounded: bool) -> Image:
    frame.clean_alpha()
    bbox = frame.alpha_bbox()
    if bbox is None:
        return Image.blank(cell_w, cell_h)
    frame = frame.crop(*bbox)
    max_w = cell_w - padding * 2
    max_h = cell_h - padding * 2
    scale = min(max_w / frame.width, max_h / frame.height)
    new_w = max(1, round(frame.width * scale))
    new_h = max(1, round(frame.height * scale))
    frame = frame.resize_nearest(new_w, new_h)
    result = Image.blank(cell_w, cell_h)
    left = (cell_w - new_w) // 2
    top = cell_h - padding - new_h if grounded else (cell_h - new_h) // 2
    result.paste(frame, left, top, alpha_blend=False)
    return result


def build_strip(asset_id: str, frames: int, cell, palette: int, padding: int, grounded: bool) -> Image:
    source = Image.load(SRC / f"{asset_id}.png")
    cell_w, cell_h = cell
    result = Image.blank(cell_w * frames, cell_h)
    for index in range(frames):
        left = round(source.width * index / frames)
        right = round(source.width * (index + 1) / frames)
        frame = fit_frame(source.crop(left, 0, right, source.height), cell_w, cell_h, padding, grounded)
        result.paste(frame, index * cell_w, 0, alpha_blend=False)
    return quantize(result, palette)


def connected_components(points: set[tuple[int, int]]):
    components = []
    remaining = set(points)
    while remaining:
        start = remaining.pop()
        queue = deque([start])
        component = {start}
        while queue:
            x, y = queue.popleft()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    component.add(neighbor)
                    queue.append(neighbor)
        components.append(component)
    return components


def make_hero_mask(asset_id: str, sheet: Image, frames: int, cell_w: int, cell_h: int) -> Image:
    mask = Image.blank(sheet.width, sheet.height)
    for frame_index in range(frames):
        points = set()
        offset = frame_index * cell_w
        for y in range(cell_h):
            for x in range(cell_w):
                r, g, b, a = sheet.pixel(offset + x, y)
                if a and max(r, g, b) - min(r, g, b) <= 52 and 120 <= (r + g + b) // 3 <= 245:
                    points.add((x, y))
        components = []
        for component in connected_components(points):
            if len(component) < 3:
                continue
            xs = [p[0] for p in component]
            ys = [p[1] for p in component]
            width = max(xs) - min(xs) + 1
            height = max(ys) - min(ys) + 1
            aspect = max(width / height, height / width)
            if aspect <= 5.0:
                components.append(component)
        components.sort(key=len, reverse=True)
        if not components:
            continue
        if asset_id == "knight":
            selected = []
            for component in components:
                xs = [p[0] for p in component]
                ys = [p[1] for p in component]
                center_x = (min(xs) + max(xs)) / 2
                is_back_cape = min(xs) < 32 and min(ys) >= 45
                is_front_tabard = min(ys) >= 64 and 36 <= center_x <= 68
                if len(component) >= 25 and (is_back_cape or is_front_tabard):
                    selected.append(component)
        elif asset_id == "stormcaller":
            threshold = max(8, round(len(components[0]) * 0.18))
            selected = [component for component in components[:6] if len(component) >= threshold]
        else:
            selected = [components[0]]
        for component in selected:
            for x, y in component:
                mask.set_pixel(offset + x, y, (255, 255, 255, 255))
    return mask


HEROES = ["knight", "witch", "ranger", "herald", "smith", "stormcaller", "alchemist"]
ENEMIES = ["bat", "ghoul", "wisp", "skel", "brute", "spitter", "bloater"]
BOSSES = ["boss", "brood", "ram", "gunner", "twin", "twinhalf"]
PROJECTILES = ["bolt", "knife", "sickle", "icedisc", "spear", "hostile"]
PROPS = ["prop_gravestone", "prop_stump", "prop_mushrooms"]


def make_ground() -> Image:
    source = Image.load(SRC / "ground.png")
    size = min(source.width, source.height)
    left = (source.width - size) // 2
    top = (source.height - size) // 2
    tile = source.crop(left, top, left + size, top + size).resize_nearest(256, 256)
    tile = quantize(tile, 16)
    # Blend a narrow wrap band, then enforce identical opposing edge pixels.
    original = tile.copy()
    band = 12
    for y in range(256):
        for x in range(band):
            t = x / max(1, band - 1)
            a = original.pixel(x, y)
            b = original.pixel(255 - band + 1 + x, y)
            mixed = tuple(round(a[i] * t + b[i] * (1 - t)) for i in range(3)) + (255,)
            tile.set_pixel(x, y, mixed)
            tile.set_pixel(255 - x, y, mixed)
    original = tile.copy()
    for x in range(256):
        for y in range(band):
            t = y / max(1, band - 1)
            a = original.pixel(x, y)
            b = original.pixel(x, 255 - band + 1 + y)
            mixed = tuple(round(a[i] * t + b[i] * (1 - t)) for i in range(3)) + (255,)
            tile.set_pixel(x, y, mixed)
            tile.set_pixel(x, 255 - y, mixed)
    for y in range(256):
        tile.set_pixel(255, y, tile.pixel(0, y))
    for x in range(256):
        tile.set_pixel(x, 255, tile.pixel(x, 0))
    return quantize(tile, 16)


def build_manifest() -> dict:
    body = {
        "bat": 10, "wisp": 8, "ghoul": 14, "skel": 13, "brute": 22, "spitter": 12, "bloater": 13,
        "boss": 40, "brood": 44, "ram": 38, "gunner": 36, "twin": 40, "twinhalf": 28,
    }
    manifest = {}
    for asset_id in HEROES:
        manifest[asset_id] = {
            "file": f"{asset_id}.png", "cell": [96, 96], "frames": 5, "fps": 8,
            "anchor": [48, 90], "bodyRadius": 14, "mask": f"{asset_id}_mask.png",
        }
    for asset_id in ENEMIES:
        cell = [96, 96] if asset_id == "brute" else [64, 64]
        anchor = [48, 90] if asset_id == "brute" else ([32, 46] if asset_id in ("bat", "wisp") else [32, 60])
        manifest[asset_id] = {
            "file": f"{asset_id}.png", "cell": cell, "frames": 4, "fps": 8,
            "anchor": anchor, "bodyRadius": body[asset_id],
        }
    for asset_id in BOSSES:
        cell = [128, 128] if asset_id == "twinhalf" else [192, 192]
        anchor = [64, 122] if asset_id == "twinhalf" else [96, 184]
        manifest[asset_id] = {
            "file": f"{asset_id}.png", "cell": cell, "frames": 6, "fps": 6,
            "anchor": anchor, "bodyRadius": body[asset_id], "attackFrames": [4, 5],
        }
    for asset_id in PROJECTILES:
        manifest[asset_id] = {
            "file": f"{asset_id}.png", "cell": [32, 32], "frames": 4, "fps": 12,
            "anchor": [16, 16], "bodyRadius": 4,
        }
    manifest["ground"] = {
        "file": "ground.png", "cell": [256, 256], "frames": 1, "fps": 0,
        "anchor": [128, 128], "bodyRadius": 0,
    }
    for asset_id in PROPS:
        manifest[asset_id] = {
            "file": f"{asset_id}.png", "cell": [64, 64], "frames": 1, "fps": 0,
            "anchor": [32, 60], "bodyRadius": 0,
        }
    return manifest


def make_preview(manifest: dict, ground: Image) -> Image:
    ids = HEROES + ENEMIES + BOSSES + PROJECTILES + PROPS
    columns = 5
    box_w, box_h = 240, 210
    rows = math.ceil(len(ids) / columns)
    preview = Image.blank(columns * box_w, rows * box_h, (27, 36, 32, 255))
    for y in range(0, preview.height, 256):
        for x in range(0, preview.width, 256):
            preview.paste(ground, x, y, alpha_blend=False)
    for index, asset_id in enumerate(ids):
        spec = manifest[asset_id]
        sheet = Image.load(OUT / spec["file"])
        cell_w, cell_h = spec["cell"]
        frame = sheet.crop(0, 0, cell_w, cell_h)
        bbox = frame.alpha_bbox()
        if bbox:
            frame = frame.crop(*bbox)
        max_w = 190
        max_h = 165
        scale = min(max_w / frame.width, max_h / frame.height, 2.4)
        frame = frame.resize_nearest(max(1, round(frame.width * scale)), max(1, round(frame.height * scale)))
        col = index % columns
        row = index // columns
        left = col * box_w + (box_w - frame.width) // 2
        top = row * box_h + (box_h - frame.height) // 2
        preview.paste(frame, left, top)
    return preview


def main() -> None:
    OUT.mkdir(exist_ok=True)
    manifest = build_manifest()
    for asset_id in HEROES:
        sprite_path = OUT / f"{asset_id}.png"
        mask_path = OUT / f"{asset_id}_mask.png"
        if not sprite_path.exists() or not mask_path.exists():
            sheet = build_strip(asset_id, 5, (96, 96), 24, 4, True)
            sheet.save(sprite_path)
            make_hero_mask(asset_id, sheet, 5, 96, 96).save(mask_path)
    for asset_id in ENEMIES:
        cell = (96, 96) if asset_id == "brute" else (64, 64)
        padding = 4 if asset_id == "brute" else 3
        grounded = asset_id not in ("bat", "wisp")
        path = OUT / f"{asset_id}.png"
        if not path.exists():
            build_strip(asset_id, 4, cell, 24, padding, grounded).save(path)
    for asset_id in BOSSES:
        cell = (128, 128) if asset_id == "twinhalf" else (192, 192)
        padding = 5 if asset_id == "twinhalf" else 6
        path = OUT / f"{asset_id}.png"
        if not path.exists():
            build_strip(asset_id, 6, cell, 24, padding, True).save(path)
    for asset_id in PROJECTILES:
        path = OUT / f"{asset_id}.png"
        if not path.exists():
            build_strip(asset_id, 4, (32, 32), 16, 2, False).save(path)
    for asset_id in PROPS:
        path = OUT / f"{asset_id}.png"
        if not path.exists():
            build_strip(asset_id, 1, (64, 64), 24, 3, True).save(path)
    ground_path = OUT / "ground.png"
    if not ground_path.exists():
        make_ground().save(ground_path)
    ground = Image.load(ground_path)
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    make_preview(manifest, ground).save(OUT / "preview.png")


if __name__ == "__main__":
    main()
