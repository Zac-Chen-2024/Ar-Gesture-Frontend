# XBLab logo

All files are SVG with the text turned into outlines, so they look the same
without the fonts installed. `-green` is the Demo colour, `-red` the Game
colour; `-on-dark` files are for dark grounds (they have no background of
their own).

| File | Use |
|---|---|
| `xblab-primary-*.svg` | Mark and name. The site, slides, everyday use. |
| `xblab-institutional-*.svg` | Mark, name and "Human–Computer Interaction", as tall as the mark. Papers, posters, formal use. |
| `xblab-stacked-*.svg` | Mark over name. Square and narrow spaces. |
| `xblab-symbol-*.svg` | The mark alone. Avatars, favicons. |
| `xblab-app-icon-*.svg` | The mark reversed on an ink square. |
| `xblab-motion-*.svg` | The animation (X → ∞ → mark → name) as animated SVG, plays once and holds; `-loop` repeats. Open in a browser, or use as `<img>`. |
| `xblab-mark-motion-*.svg` | The mark alone drawing itself (X → ∞ → eight → pixels), about 1.4 s; used by the site's page transitions. |
| `xblab-motion-*-loop.gif` | The looping motion as GIF, 960 × 540, 25 fps, for places that do not play SVG (slides, chat, email). |

## Rules

- **Clear space:** keep at least three of the mark's pixels clear on every
  side (one pixel is 1/6 of the lower loop's width).
- **Minimum sizes:** institutional 48 px tall; below that use primary.
  Primary 24 px tall; below that use the symbol alone.
- **Colours:** ink `#111111`, paper `#faf8f3`, Demo green `#25915f`,
  Game red `#d6452b`.
- **Type:** X and Lab are TeX Gyre Pagella (Palatino); the B is drawn in the
  mark's pixels; the descriptor is Inter SemiBold with 0.2 em letter spacing.

`build.py` rebuilds every file from the geometry; `motion.py` rebuilds the animations and `gif.py` the GIFs (run motion, gif, then build, so the zip has everything).
