from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "gas-lp-logo.png"
OUTPUT = ROOT / "public" / "icons"
BACKGROUND = (3, 14, 35, 255)
ACCENT = (7, 42, 86, 255)


def make_icon(size: int, padding_ratio: float) -> Image.Image:
    source = Image.open(SOURCE).convert("RGBA")
    # The upper emblem is clearer at launcher size than the complete wordmark.
    emblem = source.crop((145, 55, 1110, 700))
    alpha_box = emblem.getchannel("A").getbbox()
    if alpha_box:
        emblem = emblem.crop(alpha_box)

    canvas = Image.new("RGBA", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    inset = max(2, round(size * 0.025))
    radius = round(size * 0.22)
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset),
        radius=radius,
        fill=BACKGROUND,
        outline=ACCENT,
        width=max(2, round(size * 0.012)),
    )

    available = round(size * (1 - 2 * padding_ratio))
    scale = min(available / emblem.width, available / emblem.height)
    resized = emblem.resize(
        (round(emblem.width * scale), round(emblem.height * scale)),
        Image.Resampling.LANCZOS,
    )
    position = ((size - resized.width) // 2, (size - resized.height) // 2)
    canvas.alpha_composite(resized, position)
    return canvas


OUTPUT.mkdir(parents=True, exist_ok=True)
make_icon(192, 0.10).save(OUTPUT / "icon-192.png", optimize=True)
make_icon(512, 0.10).save(OUTPUT / "icon-512.png", optimize=True)
make_icon(512, 0.21).save(OUTPUT / "icon-maskable-512.png", optimize=True)
make_icon(180, 0.10).save(OUTPUT / "apple-touch-icon.png", optimize=True)
