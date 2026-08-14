#!/usr/bin/env python3
"""Regenerate every app launcher icon from the master Onwebs mark.

The mark used to sit at roughly a third of the canvas width, which reads as a
small blue dot once the OS shrinks it to a dock or home-screen tile. Each family
below gets the largest fill its platform mask allows.

Launcher icons are on white, per the brand rule; the in-app artwork under
`public/` stays transparent and is not touched here.

    python3 scripts/icons/generate_icons.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MASTER = "/Users/amir/Desktop/projects/onwebs 3d -v3/assets-src/originals/assets/onwebs-logo.png"
ICONS = os.path.join(REPO, "src-tauri", "icons")

WHITE = (255, 255, 255, 255)
YELLOW = (245, 197, 24)


def recolour(mark: Image.Image, rgb) -> Image.Image:
    """The mark in another colour, keeping its own shading.

    Flat-filling every opaque pixel would turn the 3D mark into a silhouette,
    so each pixel's luminance is carried across as a shade of the new colour.
    """
    r, g, b, a = mark.split()
    lum = Image.merge("RGB", (r, g, b)).convert("L")
    out = Image.new("RGBA", mark.size)
    px_l, px_a, px_o = lum.load(), a.load(), out.load()
    for y in range(mark.height):
        for x in range(mark.width):
            alpha = px_a[x, y]
            if alpha == 0:
                px_o[x, y] = (0, 0, 0, 0)
                continue
            k = 0.72 + 0.28 * (px_l[x, y] / 255)
            px_o[x, y] = (int(rgb[0] * k), int(rgb[1] * k), int(rgb[2] * k), alpha)
    return out

# How much of each canvas the mark fills. The master art is already trimmed to
# its own edges, so these are effectively full-bleed: square tiles keep only a
# hairline so the shape does not touch the very pixel edge, iOS leaves room for
# the squircle corner cut, and Android's adaptive foreground stays inside the
# circular mask crop.
FILL_SQUARE = 0.88
# Android masks the adaptive foreground and only guarantees the middle
# 264 of 432 — 61%. At 0.70 the mark's edges sat outside that and the
# launcher cropped them, which is what made the icon look broken next to
# every other app on the home screen. 0.58 keeps it clear of the mask with
# a little room for the more aggressive masks some launchers use.
FILL_ADAPTIVE = 0.46
# Android draws the legacy icon inside its own mask too, so the mark needs the
# same restraint there as in the adaptive foreground.
FILL_ANDROID_LEGACY = 0.60
FILL_IOS = 0.84


def load_mark() -> Image.Image:
    """The master mark, cropped to its own ink so padding is ours to decide."""
    mark = Image.open(MASTER).convert("RGBA")
    box = mark.getchannel("A").getbbox()
    return mark.crop(box) if box else mark


def tile(mark: Image.Image, size: int, fill: float, background=WHITE,
         circle: bool = False) -> Image.Image:
    """Centre `mark` on a `size` square, scaled so its long side is `fill` of it."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if background is not None:
        if circle:
            draw = ImageDraw.Draw(canvas)
            draw.ellipse((0, 0, size - 1, size - 1), fill=background)
        else:
            canvas.paste(background, (0, 0, size, size))

    target = max(1, int(round(size * fill)))
    scaled = mark.copy()
    scaled.thumbnail((target, target), Image.LANCZOS)
    canvas.alpha_composite(
        scaled,
        ((size - scaled.width) // 2, (size - scaled.height) // 2),
    )
    return canvas


# Apple's macOS icon grid, as ratios of the canvas. macOS does *not* round an
# app icon for you — whatever shape the artwork has is the shape in the Dock.
# Shipping a full-bleed square is why this icon sat there with hard corners,
# visibly larger than every rounded neighbour beside it. On Apple's 1024 grid
# the body is 824 wide with a 185.4 corner radius, which is where these come
# from; the leftover margin is what makes the icon read as the same size as
# its neighbours rather than overflowing them.
MAC_BODY = 824 / 1024
MAC_RADIUS = 185.4 / 824


def macos_tile(mark: Image.Image, size: int, fill: float) -> Image.Image:
    """`mark` on the rounded-square body macOS expects, with Apple's margin."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    body = max(1, int(round(size * MAC_BODY)))
    offset = (size - body) // 2
    radius = max(1, int(round(body * MAC_RADIUS)))

    # Drawn at 4x and downsampled: rounded_rectangle aliases badly at 16px,
    # and these icons are read at exactly that size in menus and the switcher.
    scale = 4
    shape = Image.new("RGBA", (body * scale, body * scale), (0, 0, 0, 0))
    ImageDraw.Draw(shape).rounded_rectangle(
        (0, 0, body * scale - 1, body * scale - 1),
        radius=radius * scale,
        fill=WHITE,
    )
    shape = shape.resize((body, body), Image.LANCZOS)

    target = max(1, int(round(body * fill)))
    scaled = mark.copy()
    scaled.thumbnail((target, target), Image.LANCZOS)
    shape.alpha_composite(
        scaled,
        ((body - scaled.width) // 2, (body - scaled.height) // 2),
    )

    canvas.alpha_composite(shape, (offset, offset))
    return canvas


def write(img: Image.Image, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


def build_desktop(mark: Image.Image) -> list[str]:
    written = []
    # macOS reads these, so they carry Apple's rounded body and margin.
    mac = {
        "32x32.png": 32, "64x64.png": 64,
        "128x128.png": 128, "128x128@2x.png": 256,
        "icon.png": 512,
    }
    # Windows draws its own container and expects full-bleed art.
    plain = {"StoreLogo.png": 50}
    squares = {
        "Square30x30Logo.png": 30, "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71, "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107, "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150, "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
    }
    for name, size in mac.items():
        path = os.path.join(ICONS, name)
        write(macos_tile(mark, size, FILL_SQUARE), path)
        written.append(path)

    for name, size in {**plain, **squares}.items():
        path = os.path.join(ICONS, name)
        write(tile(mark, size, FILL_SQUARE), path)
        written.append(path)

    # .ico carries several sizes in one file.
    ico = os.path.join(ICONS, "icon.ico")
    tile(mark, 256, FILL_SQUARE).save(
        ico, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    )
    written.append(ico)

    # .icns is built by iconutil from an .iconset directory.
    icns = os.path.join(ICONS, "icon.icns")
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "icon.iconset")
        os.makedirs(iconset)
        for base in (16, 32, 128, 256, 512):
            macos_tile(mark, base, FILL_SQUARE).save(
                os.path.join(iconset, f"icon_{base}x{base}.png"))
            macos_tile(mark, base * 2, FILL_SQUARE).save(
                os.path.join(iconset, f"icon_{base}x{base}@2x.png"))
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns], check=True)
    written.append(icns)
    return written


ANDROID_DENSITIES = {
    "mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192,
}
# The adaptive foreground is authored on a larger canvas than the legacy icon.
ADAPTIVE_SCALE = 432 / 192


def build_android(mark: Image.Image, root: str) -> list[str]:
    # The phone app is yellow on near-black, and a navy launcher icon belonged
    # to a different product. White stays as the tile so the mark reads at the
    # small sizes a home screen actually uses.
    mark = recolour(mark, YELLOW)
    written = []
    for density, size in ANDROID_DENSITIES.items():
        base = os.path.join(root, density)
        write(tile(mark, size, FILL_ANDROID_LEGACY), os.path.join(base, "ic_launcher.png"))
        write(tile(mark, size, FILL_ANDROID_LEGACY, circle=True),
              os.path.join(base, "ic_launcher_round.png"))
        write(tile(mark, int(round(size * ADAPTIVE_SCALE)), FILL_ADAPTIVE, background=None),
              os.path.join(base, "ic_launcher_foreground.png"))
        written += [os.path.join(base, n) for n in
                    ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png")]
    return written


def build_ios(mark: Image.Image) -> list[str]:
    ios_dir = os.path.join(ICONS, "ios")
    if not os.path.isdir(ios_dir):
        return []
    written = []
    for name in sorted(os.listdir(ios_dir)):
        if not name.endswith(".png"):
            continue
        path = os.path.join(ios_dir, name)
        size = Image.open(path).size[0]
        write(tile(mark, size, FILL_IOS), path)
        written.append(path)
    return written


def main() -> None:
    if not os.path.exists(MASTER):
        sys.exit(f"master mark not found: {MASTER}")
    mark = load_mark()
    print(f"master mark: {mark.size[0]}x{mark.size[1]} (cropped to its ink)")

    written = build_desktop(mark)
    written += build_android(mark, os.path.join(ICONS, "android"))
    written += build_ios(mark)

    # Mirror into the generated Android project so a build picks them up.
    gen = os.path.join(REPO, "src-tauri", "gen", "android", "app", "src", "main", "res")
    if os.path.isdir(gen):
        written += build_android(mark, gen)

    print(f"wrote {len(written)} icon files")
    for group in ("icon.png", "icon.icns", "icon.ico"):
        print("  ", os.path.join(ICONS, group))


if __name__ == "__main__":
    main()
