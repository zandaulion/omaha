#!/usr/bin/env python3
"""Render Pocket Omaha's Review Radar icon family from one geometry."""

from pathlib import Path
from math import cos, radians, sin
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "icons"
ANDROID = ROOT / "android" / "app" / "src" / "main" / "res"
PLAY = ROOT / "play-store"
SCALE = 4
BASE = 512
HI = BASE * SCALE

NAVY_0 = (15, 23, 42, 255)
NAVY_1 = (2, 6, 23, 255)
TRACK = (30, 41, 59, 255)
TEAL = (20, 184, 166, 255)
CYAN = (6, 182, 212, 255)
NODE = (42, 220, 224, 255)
AMBER = (251, 191, 36, 255)
PALE_GOLD = (255, 243, 180, 255)
OUTER = [(256, 129), (377, 217), (331, 359), (181, 359), (135, 217)]
INNER = [(256, 160), (345, 227), (303, 321), (196, 339), (188, 234)]
CENTER = (256, 256)


def q(value):
    return int(round(value * SCALE))


def points(values):
    return [(q(x), q(y)) for x, y in values]


def diagonal_gradient(c0, c1):
    x = np.linspace(0, 1, HI, dtype=np.float32)[None, :]
    y = np.linspace(0, 1, HI, dtype=np.float32)[:, None]
    amount = ((x + y) / 2)[..., None]
    start = np.array(c0, dtype=np.float32)
    end = np.array(c1, dtype=np.float32)
    pixels = np.rint(start + (end - start) * amount).astype(np.uint8)
    return Image.fromarray(pixels)


def line_mask(values, width, *, closed=False):
    mask = Image.new("L", (HI, HI), 0)
    draw = ImageDraw.Draw(mask)
    line = points(values)
    if closed:
        line.append(line[0])
    draw.line(line, fill=255, width=q(width), joint="curve")
    return mask


def rounded_arc_mask(box, start, end, width):
    mask = Image.new("L", (HI, HI), 0)
    draw = ImageDraw.Draw(mask)
    scaled_box = tuple(q(v) for v in box)
    draw.arc(scaled_box, start=start, end=end, fill=255, width=q(width))
    cx = (box[0] + box[2]) / 2
    cy = (box[1] + box[3]) / 2
    radius = (box[2] - box[0]) / 2
    cap = width / 2
    for angle in (start, end):
        x = cx + radius * cos(radians(angle))
        y = cy + radius * sin(radians(angle))
        draw.ellipse((q(x-cap), q(y-cap), q(x+cap), q(y+cap)), fill=255)
    return mask


def render_icon(*, rounded):
    transparent = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    background = diagonal_gradient(NAVY_0, NAVY_1)
    if rounded:
        shape = Image.new("L", (HI, HI), 0)
        ImageDraw.Draw(shape).rounded_rectangle((0, 0, HI-1, HI-1), radius=q(112), fill=255)
        canvas = Image.composite(background, transparent, shape)
    else:
        canvas = background

    depth = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    ImageDraw.Draw(depth).ellipse((q(95), q(94), q(417), q(416)), fill=(6, 182, 212, 17))
    depth = depth.filter(ImageFilter.GaussianBlur(q(42)))
    canvas = Image.alpha_composite(canvas, depth)

    draw = ImageDraw.Draw(canvas)
    ring_box = (73, 73, 439, 439)
    draw.ellipse(tuple(q(v) for v in ring_box), outline=TRACK, width=q(12))
    brand_gradient = diagonal_gradient(TEAL, CYAN)
    canvas = Image.composite(
        brand_gradient,
        canvas,
        rounded_arc_mask(ring_box, -58, 244, 17),
    )

    face = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    face_draw = ImageDraw.Draw(face)
    face_draw.polygon(points(OUTER), fill=(8, 47, 73, 130))
    face_draw.polygon(points(INNER), fill=(20, 184, 166, 86))
    for vertex in OUTER:
        face_draw.line(points([CENTER, vertex]), fill=(35, 107, 128, 180), width=q(4))
    canvas = Image.alpha_composite(canvas, face)

    canvas = Image.composite(brand_gradient, canvas, line_mask(OUTER, 11, closed=True))
    canvas = Image.composite(brand_gradient, canvas, line_mask(INNER, 7, closed=True))

    details = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    details_draw = ImageDraw.Draw(details)
    for x, y in OUTER:
        details_draw.ellipse((q(x-7), q(y-7), q(x+7), q(y+7)), fill=NODE)
    canvas = Image.alpha_composite(canvas, details)

    signal = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    signal_draw = ImageDraw.Draw(signal)
    signal_draw.ellipse((q(217), q(217), q(295), q(295)), fill=(251, 191, 36, 95))
    signal = signal.filter(ImageFilter.GaussianBlur(q(19)))
    canvas = Image.alpha_composite(canvas, signal)
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((q(238), q(238), q(274), q(274)), fill=AMBER)
    draw.ellipse((q(249), q(249), q(263), q(263)), fill=PALE_GOLD)

    return canvas.resize((BASE, BASE), Image.Resampling.LANCZOS)


def render_badge():
    size = 96 * SCALE
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    box = (q(13), q(13), q(83), q(83))
    draw.arc(box, start=-58, end=244, fill="white", width=q(7))
    cx = cy = 48
    radius = 35
    cap = 3.5
    for angle in (-58, 244):
        x = cx + radius * cos(radians(angle))
        y = cy + radius * sin(radians(angle))
        draw.ellipse((q(x-cap), q(y-cap), q(x+cap), q(y+cap)), fill="white")
    outer = [(48, 25), (72, 42), (63, 70), (33, 70), (24, 42)]
    center = (48, 48)
    draw.line(points(outer + [outer[0]]), fill="white", width=q(5), joint="curve")
    for vertex in outer:
        draw.line(points([center, vertex]), fill=(255, 255, 255, 185), width=q(2))
    draw.ellipse((q(43.5), q(43.5), q(52.5), q(52.5)), fill="white")
    return image.resize((96, 96), Image.Resampling.LANCZOS)


def icon_svg(*, rounded):
    radius = ' rx="112"' if rounded else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- Pocket Omaha Review Radar: five fundamentals, a recurring review loop, and the thesis signal at its centre. -->
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0F172A"/>
      <stop offset="1" stop-color="#020617"/>
    </linearGradient>
    <linearGradient id="brand" x1="135" y1="129" x2="377" y2="359" gradientUnits="userSpaceOnUse">
      <stop stop-color="#14B8A6"/>
      <stop offset="1" stop-color="#06B6D4"/>
    </linearGradient>
    <radialGradient id="depth">
      <stop stop-color="#06B6D4" stop-opacity=".10"/>
      <stop offset="1" stop-color="#06B6D4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="signal">
      <stop stop-color="#FBBF24" stop-opacity=".58"/>
      <stop offset="1" stop-color="#FBBF24" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512"{radius} fill="url(#background)"/>
  <circle cx="256" cy="255" r="170" fill="url(#depth)"/>
  <circle cx="256" cy="256" r="183" fill="none" stroke="#1E293B" stroke-width="12"/>
  <path d="M352.98 100.81 A183 183 0 1 1 175.77 91.54" fill="none" stroke="url(#brand)" stroke-width="17" stroke-linecap="round"/>
  <path d="M256 129 L377 217 L331 359 L181 359 L135 217 Z" fill="#082F49" fill-opacity=".51" stroke="url(#brand)" stroke-width="11" stroke-linejoin="round"/>
  <g fill="none" stroke="#236B80" stroke-opacity=".72" stroke-width="4">
    <path d="M256 256 L256 129 M256 256 L377 217 M256 256 L331 359 M256 256 L181 359 M256 256 L135 217"/>
  </g>
  <path d="M256 160 L345 227 L303 321 L196 339 L188 234 Z" fill="#14B8A6" fill-opacity=".34" stroke="url(#brand)" stroke-width="7" stroke-linejoin="round"/>
  <g fill="#2ADCE0">
    <circle cx="256" cy="129" r="7"/><circle cx="377" cy="217" r="7"/><circle cx="331" cy="359" r="7"/><circle cx="181" cy="359" r="7"/><circle cx="135" cy="217" r="7"/>
  </g>
  <circle cx="256" cy="256" r="46" fill="url(#signal)"/>
  <circle cx="256" cy="256" r="18" fill="#FBBF24"/>
  <circle cx="256" cy="256" r="7" fill="#FFF3B4"/>
</svg>
'''


def badge_svg():
    return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
  <!-- Transparent, single-colour notification form of the Review Radar. -->
  <g fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
    <path d="M66.55 18.32 A35 35 0 1 1 32.65 16.46" stroke-width="7"/>
    <path d="M48 25 L72 42 L63 70 L33 70 L24 42 Z" stroke-width="5"/>
    <path d="M48 48 L48 25 M48 48 L72 42 M48 48 L63 70 M48 48 L33 70 M48 48 L24 42" stroke-width="2" stroke-opacity=".72"/>
  </g>
  <circle cx="48" cy="48" r="4.5" fill="#FFFFFF"/>
</svg>
'''


def android_foreground():
    return '''<?xml version="1.0" encoding="utf-8"?>
<!-- Review Radar adaptive foreground. The five axes are the app's five fundamental categories; the open ring is recurring review. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">

    <path android:pathData="M54,22 A32,32 0,1 1,54 86 A32,32 0,1 1,54 22"
        android:fillColor="#00000000" android:strokeColor="#FF1E293B" android:strokeWidth="2.4"/>
    <path android:pathData="M70.96,26.86 A32,32 0,1 1,39.97 25.24"
        android:fillColor="#00000000" android:strokeWidth="3.5" android:strokeLineCap="round">
        <aapt:attr name="android:strokeColor">
            <gradient android:type="linear" android:startX="34" android:startY="30" android:endX="78" android:endY="78">
                <item android:offset="0" android:color="#FF14B8A6"/><item android:offset="1" android:color="#FF06B6D4"/>
            </gradient>
        </aapt:attr>
    </path>
    <path android:pathData="M54,32 L75,47 L67,72 L41,72 L33,47 Z"
        android:fillColor="#66082F49" android:strokeWidth="2.2" android:strokeLineJoin="round">
        <aapt:attr name="android:strokeColor">
            <gradient android:type="linear" android:startX="33" android:startY="32" android:endX="75" android:endY="72">
                <item android:offset="0" android:color="#FF14B8A6"/><item android:offset="1" android:color="#FF06B6D4"/>
            </gradient>
        </aapt:attr>
    </path>
    <path android:pathData="M54,54 L54,32 M54,54 L75,47 M54,54 L67,72 M54,54 L41,72 M54,54 L33,47"
        android:fillColor="#00000000" android:strokeColor="#B3236B80" android:strokeWidth="0.9"/>
    <path android:pathData="M54,38 L69.5,49 L62,66.5 L43.5,68 L42,50 Z"
        android:fillColor="#6614B8A6" android:strokeWidth="1.5" android:strokeLineJoin="round">
        <aapt:attr name="android:strokeColor">
            <gradient android:type="linear" android:startX="42" android:startY="38" android:endX="69.5" android:endY="68">
                <item android:offset="0" android:color="#FF14B8A6"/><item android:offset="1" android:color="#FF06B6D4"/>
            </gradient>
        </aapt:attr>
    </path>
    <path android:pathData="M55.4,32 A1.4,1.4 0,1 1,52.6 32 A1.4,1.4 0,1 1,55.4 32 M76.4,47 A1.4,1.4 0,1 1,73.6 47 A1.4,1.4 0,1 1,76.4 47 M68.4,72 A1.4,1.4 0,1 1,65.6 72 A1.4,1.4 0,1 1,68.4 72 M42.4,72 A1.4,1.4 0,1 1,39.6 72 A1.4,1.4 0,1 1,42.4 72 M34.4,47 A1.4,1.4 0,1 1,31.6 47 A1.4,1.4 0,1 1,34.4 47"
        android:fillColor="#FF2ADCE0"/>
    <path android:pathData="M59.5,54 A5.5,5.5 0,1 1,48.5 54 A5.5,5.5 0,1 1,59.5 54" android:fillColor="#30FBBF24"/>
    <path android:pathData="M57.6,54 A3.6,3.6 0,1 1,50.4 54 A3.6,3.6 0,1 1,57.6 54" android:fillColor="#FFFBBF24"/>
    <path android:pathData="M55.4,54 A1.4,1.4 0,1 1,52.6 54 A1.4,1.4 0,1 1,55.4 54" android:fillColor="#FFFFF3B4"/>
</vector>
'''


def android_monochrome():
    return '''<?xml version="1.0" encoding="utf-8"?>
<!-- Single-colour Review Radar for Android 13+ themed launcher icons. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:pathData="M70.96,26.86 A32,32 0,1 1,39.97 25.24"
        android:fillColor="#00000000" android:strokeColor="#FF000000" android:strokeWidth="4" android:strokeLineCap="round"/>
    <path android:pathData="M54,32 L75,47 L67,72 L41,72 L33,47 Z"
        android:fillColor="#00000000" android:strokeColor="#FF000000" android:strokeWidth="3" android:strokeLineJoin="round"/>
    <path android:pathData="M54,54 L54,32 M54,54 L75,47 M54,54 L67,72 M54,54 L41,72 M54,54 L33,47"
        android:fillColor="#00000000" android:strokeColor="#FF000000" android:strokeWidth="1.5"/>
    <path android:pathData="M58,54 A4,4 0,1 1,50 54 A4,4 0,1 1,58 54" android:fillColor="#FF000000"/>
</vector>
'''


def android_status():
    return '''<?xml version="1.0" encoding="utf-8"?>
<!-- Monochrome status-bar form of the Review Radar; Android uses its alpha channel as the system-tinted glyph. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24"
    android:tint="#FFFFFFFF">
    <path android:pathData="M16.5,4.79 A8.5,8.5 0,1 1,8.27 4.37"
        android:fillColor="#00000000" android:strokeColor="#FFFFFFFF" android:strokeWidth="1.8" android:strokeLineCap="round"/>
    <path android:pathData="M12,6.2 L18,10.6 L15.7,17.6 L8.3,17.6 L6,10.6 Z"
        android:fillColor="#00000000" android:strokeColor="#FFFFFFFF" android:strokeWidth="1.6" android:strokeLineJoin="round"/>
    <path android:pathData="M12,12 L12,6.2 M12,12 L18,10.6 M12,12 L15.7,17.6 M12,12 L8.3,17.6 M12,12 L6,10.6"
        android:fillColor="#00000000" android:strokeColor="#BFFFFFFF" android:strokeWidth="0.7"/>
    <path android:pathData="M13.6,12 A1.6,1.6 0,1 1,10.4 12 A1.6,1.6 0,1 1,13.6 12" android:fillColor="#FFFFFFFF"/>
</vector>
'''


def update_manifest():
    path = ROOT / "web" / "manifest.webmanifest"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["icons"] = [
        {"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
        {"src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ]
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def update_service_worker():
    path = ROOT / "web" / "sw.js"
    source = path.read_text(encoding="utf-8")
    needle = "  '/icons/icon-512.png',\n"
    addition = needle + "  '/icons/icon-maskable-192.png',\n  '/icons/icon-maskable-512.png',\n"
    if "'/icons/icon-maskable-192.png'" not in source:
        if needle not in source:
            raise RuntimeError("Could not find PWA icon cache list")
        path.write_text(source.replace(needle, addition, 1), encoding="utf-8")


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    (ANDROID / "drawable-nodpi").mkdir(parents=True, exist_ok=True)
    (PLAY / "source").mkdir(parents=True, exist_ok=True)

    rounded = render_icon(rounded=True)
    square = render_icon(rounded=False)
    rounded.save(WEB / "icon-512.png", optimize=True)
    rounded.resize((192, 192), Image.Resampling.LANCZOS).save(WEB / "icon-192.png", optimize=True)
    square.save(WEB / "icon-maskable-512.png", optimize=True)
    square.resize((192, 192), Image.Resampling.LANCZOS).save(WEB / "icon-maskable-192.png", optimize=True)
    rounded.resize((192, 192), Image.Resampling.LANCZOS).save(ANDROID / "drawable-nodpi" / "omaha_brand.png", optimize=True)
    render_badge().save(WEB / "badge-96.png", optimize=True)

    # Google Play requires a 32-bit 512px PNG; retain an opaque alpha channel.
    square.save(PLAY / "app-icon.png", optimize=True)

    (WEB / "icon.svg").write_text(icon_svg(rounded=True), encoding="utf-8")
    (WEB / "favicon.svg").write_text(icon_svg(rounded=True), encoding="utf-8")
    (WEB / "badge.svg").write_text(badge_svg(), encoding="utf-8")
    (PLAY / "source" / "app-icon.svg").write_text(icon_svg(rounded=False), encoding="utf-8")
    (ANDROID / "drawable" / "ic_launcher_foreground.xml").write_text(android_foreground(), encoding="utf-8")
    (ANDROID / "drawable" / "ic_launcher_monochrome.xml").write_text(android_monochrome(), encoding="utf-8")
    (ANDROID / "drawable" / "ic_stat_omaha.xml").write_text(android_status(), encoding="utf-8")
    update_manifest()
    update_service_worker()

    # Apple supplies its own mask, so give it the opaque full-bleed asset.
    index = ROOT / "web" / "index.html"
    html = index.read_text(encoding="utf-8")
    html = html.replace('href="/icons/icon-192.png">', 'href="/icons/icon-maskable-192.png">', 1)
    index.write_text(html, encoding="utf-8")

    print("Rendered Review Radar icon family")


if __name__ == "__main__":
    main()
