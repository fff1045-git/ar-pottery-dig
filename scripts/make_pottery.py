"""도자기 원본 그림(art/raw/*.png, 마젠타 배경)을 게임용 그림으로 만든다.

- public/pottery/<id>.png         배경을 지운 완성품(긴 변 512px)
- public/pottery/<id>-<part>.png  입전·어깨·몸통·굽 4조각. 깨진 경계는 결정적 난수로 들쭉날쭉하게 자르고,
                                  이웃 조각과 경계를 공유해서 맞추면 원래 그림이 된다.

실행: python scripts/make_pottery.py   (Pillow 필요)
"""
from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "art" / "raw"
OUT = ROOT / "public" / "pottery"
IDS = ["onggi", "buncheong", "moonjar", "bluewhite", "celadon", "lotus"]
PARTS = ["rim", "shoulder", "body", "base"]
# 조각 경계(그림 높이 대비). 위에서 아래로.
CUTS = [0.24, 0.47, 0.74]
MAX_SIDE = 512


def remove_magenta(im: Image.Image) -> Image.Image:
    """마젠타 정도 key = (R+B)/2 - G 로 알파를 정하고, 가장자리의 마젠타 번짐을 뺀다."""
    im = im.convert("RGB")
    px = im.load()
    w, h = im.size
    out = Image.new("RGBA", (w, h))
    po = out.load()
    lo, hi = 50.0, 170.0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            key = (r + b) / 2 - g
            a = 1.0 if key <= lo else 0.0 if key >= hi else 1 - (key - lo) / (hi - lo)
            m = min(r, b)
            if m > g and key > 15:  # 번짐 제거: R·B가 G보다 높은 만큼 깎는다
                ex = m - g
                r, b = r - ex, b - ex
            po[x, y] = (r, g, b, round(a * 255))
    return out


def trim(im: Image.Image, pad: int = 4) -> Image.Image:
    alpha = im.getchannel("A").point(lambda v: 255 if v > 24 else 0)
    box = alpha.getbbox()
    if not box:
        return im
    l, t, r, b = box
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))


def fit(im: Image.Image, side: int = MAX_SIDE) -> Image.Image:
    s = side / max(im.size)
    if s >= 1:
        return im
    return im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)


def jagged_line(rng: random.Random, w: int, h: int, y_frac: float) -> list[tuple[float, float]]:
    """왼→오 깨진 경계선. 점 9~13개, 위아래로 흔들리고 가끔 크게 튄다."""
    n = rng.randint(9, 13)
    pts = []
    for i in range(n + 1):
        x = w * i / n + (rng.uniform(-0.3, 0.3) * w / n if 0 < i < n else 0)
        dy = rng.uniform(-0.035, 0.035) * h
        if rng.random() < 0.18:
            dy += rng.choice([-1, 1]) * rng.uniform(0.04, 0.08) * h
        pts.append((x, y_frac * h + dy))
    return [(-10, pts[0][1])] + pts + [(w + 10, pts[-1][1])]


def shard_masks(seed: str, w: int, h: int) -> list[Image.Image]:
    rng = random.Random(seed)
    lines = [[(-10, -10), (w + 10, -10)]] + [jagged_line(rng, w, h, c) for c in CUTS] + [[(-10, h + 10), (w + 10, h + 10)]]
    masks = []
    for top, bottom in zip(lines, lines[1:]):
        m = Image.new("L", (w, h), 0)
        ImageDraw.Draw(m).polygon(top + list(reversed(bottom)), fill=255)
        masks.append(m)
    return masks


def broken_edge(shard: Image.Image) -> Image.Image:
    """조각 가장자리를 조금 어둡게: 깨진 단면처럼 보이게."""
    a = shard.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    inner = a.filter(ImageFilter.MinFilter(5))
    edge = ImageChops.subtract(a, inner)
    dark = Image.new("RGBA", shard.size, (40, 28, 20, 255))
    shade = Image.composite(dark, shard, edge.point(lambda v: v * 0.45))
    shade.putalpha(shard.getchannel("A"))
    return shade


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for vid in IDS:
        src = RAW / f"{vid}.png"
        if not src.exists():
            print("없음:", src)
            continue
        whole = fit(trim(remove_magenta(Image.open(src))))
        whole.save(OUT / f"{vid}.png", optimize=True)
        for part, mask in zip(PARTS, shard_masks(f"pottery-dig:{vid}", whole.width, whole.height)):
            alpha = ImageChops.multiply(whole.getchannel("A"), mask)
            piece = whole.copy()
            piece.putalpha(alpha)
            piece = broken_edge(trim(piece, pad=2))
            piece.save(OUT / f"{vid}-{part}.png", optimize=True)
        print("완료:", vid, whole.size)


if __name__ == "__main__":
    main()
