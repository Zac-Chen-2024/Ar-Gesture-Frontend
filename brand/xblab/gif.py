"""Render the looping motion to GIF (needs Playwright with Chromium, and Pillow).

The animated SVG is stepped frame by frame (its animations paused and set to
each time) and the frames are written as a looping GIF.

    python3 gif.py          # writes xblab-motion-*-loop.gif
"""
import asyncio
import io
import re

from PIL import Image
from playwright.async_api import async_playwright

import build as B

FPS = 25
SCALE = 1.5  # 640 x 360 -> 960 x 540


async def render(svg_path, gif_path):
    text = svg_path.read_text()
    total = float(re.search(r'dur="([0-9.]+)s"', text).group(1))
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 640, "height": 360}, device_scale_factor=SCALE)
        await page.goto(svg_path.as_uri())
        frames = []
        for k in range(round(total * FPS)):
            await page.evaluate(f"(() => {{ const s = document.documentElement; s.pauseAnimations(); s.setCurrentTime({k / FPS}); }})()")
            frames.append(Image.open(io.BytesIO(await page.screenshot())).convert("RGB"))
        await browser.close()
    # one palette for every frame keeps the colours steady
    palette = frames[-1].quantize(colors=64, method=Image.Quantize.MEDIANCUT)
    frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
    frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=round(1000 / FPS), loop=0, optimize=True, disposal=1)


def main():
    for colour in B.ACCENTS:
        src = B.HERE / f"xblab-motion-{colour}-loop.svg"
        out = B.HERE / f"xblab-motion-{colour}-loop.gif"
        asyncio.run(render(src, out))
        print(out.name, out.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
