"""Bake the demo range's terrain into one image the console can show offline.

Source: AWS Open Data terrain tiles (Terrarium encoding; SRTM/USGS NED and
others, see https://registry.opendata.aws/terrain-tiles/). This runs once,
online, by hand; the console then reads demo/assets/terrain.jpg with no
network, the way a site package would ship to an air-gapped console.

    python3 demo/terrain.py   (needs numpy and Pillow)
"""
from __future__ import annotations

import io
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

# Must match LAT0/LON0 in demo/server.mjs.
LAT0, LON0 = 35.7392, -120.7654
HALF_E_M, HALF_N_M = 7000.0, 5000.0
Z = 14
OUT_W = 1400
OUT = Path(__file__).parent / "assets"

M_LAT = 110_540.0
M_LON = 111_320.0 * math.cos(math.radians(LAT0))
SOUTH, NORTH = LAT0 - HALF_N_M / M_LAT, LAT0 + HALF_N_M / M_LAT
WEST, EAST = LON0 - HALF_E_M / M_LON, LON0 + HALF_E_M / M_LON


def tile_xy(lat: float, lon: float) -> tuple[float, float]:
    n = 2**Z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def fetch(x: int, y: int) -> np.ndarray:
    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png"
    with urllib.request.urlopen(url, timeout=30) as r:
        rgb = np.asarray(Image.open(io.BytesIO(r.read())).convert("RGB"), dtype=np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def main() -> None:
    x0, y0 = tile_xy(NORTH, WEST)
    x1, y1 = tile_xy(SOUTH, EAST)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    mosaic = np.vstack([np.hstack([fetch(tx, ty) for tx in range(tx0, tx1 + 1)]) for ty in range(ty0, ty1 + 1)])

    out_h = round(OUT_W * HALF_N_M / HALF_E_M)
    lats = NORTH - (np.arange(out_h) + 0.5) / out_h * (NORTH - SOUTH)
    lons = WEST + (np.arange(OUT_W) + 0.5) / OUT_W * (EAST - WEST)
    px = np.array([tile_xy(LAT0, lon)[0] for lon in lons]) - tx0
    py = np.array([tile_xy(lat, LON0)[1] for lat in lats]) - ty0
    ix = np.clip((px * 256).astype(int), 0, mosaic.shape[1] - 1)
    iy = np.clip((py * 256).astype(int), 0, mosaic.shape[0] - 1)
    elev = mosaic[np.ix_(iy, ix)]

    # Hillshade, sun from the north-west at 40 degrees.
    cell = 2 * HALF_E_M / OUT_W
    gy, gx = np.gradient(elev, cell)
    slope = np.arctan(np.hypot(gx, gy) * 1.6)
    aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(40)
    shade = np.clip(np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect), 0, 1)

    # Dark console palette: elevation tint plus shade, then 20 m contours.
    lo, hi = np.percentile(elev, 2), np.percentile(elev, 98)
    e = np.clip((elev - lo) / max(1.0, hi - lo), 0, 1)
    base = np.array([9, 14, 20], dtype=np.float64)
    high = np.array([30, 44, 52], dtype=np.float64)
    img = base + (high - base) * (0.35 * e + 0.65 * shade)[..., None]
    minor = np.floor(elev / 20)
    edge = (np.abs(np.diff(minor, axis=0, prepend=minor[:1])) + np.abs(np.diff(minor, axis=1, prepend=minor[:, :1]))) > 0
    major = np.floor(elev / 100)
    medge = (np.abs(np.diff(major, axis=0, prepend=major[:1])) + np.abs(np.diff(major, axis=1, prepend=major[:, :1]))) > 0
    img[edge] = img[edge] * 0.7 + np.array([70, 110, 130]) * 0.3
    img[medge] = img[medge] * 0.45 + np.array([90, 140, 160]) * 0.55

    pic = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).filter(ImageFilter.SMOOTH)
    OUT.mkdir(exist_ok=True)
    pic.save(OUT / "terrain.jpg", quality=82, optimize=True)
    meta = {
        "south": SOUTH, "west": WEST, "north": NORTH, "east": EAST,
        "elevation_m": [round(float(elev.min())), round(float(elev.max()))],
        "attribution": "Terrain: AWS Terrain Tiles (SRTM, USGS NED). 20 m contours.",
    }
    (OUT / "terrain.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(meta)


if __name__ == "__main__":
    main()
