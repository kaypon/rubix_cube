# /CUBE

A Rubik's cube you can twist, paint to match yours, and watch solve itself.
Three.js + Vite + TypeScript, styled to sit next to kevs_site's `/spin` and `/cables`.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # notation/geometry checked against cubejs, plus solver round-trips
npm run build    # typecheck + production build in dist/
```

## Using it

- **Turn**: drag a face. Flick to carry the turn through. Drag the background to look around.
- **Keys**: `U R F D L B M E S x y z`, hold Shift for the reverse turn.
- **Paint**: hold your cube white on top, green facing you, then paint what you see.
  `Clear stickers` blanks everything but the centers. Keys `1`–`6` pick colours, `Esc` exits.
- **Solve**: finds a ~20-move solution (Kociemba two-phase) and plays it.
  Scrub the move list, step with `←` `→`, `Space` to play/pause.
  If the painted cube can't exist, it tells you why (a twisted corner, a flipped edge, …).
- **Skin**: `Classic`, `Toon` (flat bands, fat ink outlines, bouncy turns), `Metal`
  (brushed gunmetal, chrome and gold), `Glass` (ice-blue glass with rainbow dispersion).
  Remembered between visits; `?skin=glass` links straight to one.
- **How to solve** (or `?`): a side panel walking through the beginner's layer-by-layer
  method, plus how the Solve button's two-phase algorithm differs. Tap any sequence and
  it loops on a little demo cube in the panel; your own cube is left alone.
- **Screen**: `Dots` / `Ink` run the render through a halftone screen.
  **Explode** spreads the cubies apart.

## Layout

```
src/
  main.ts               UI wiring, solution playback, keyboard
  style.css             kevs_site tokens (paper, ink, Archivo Black, Courier)
  cube/CubeView.ts      scene, turn queue, drag-to-turn, paint, animations
  cube/notation.ts      moves <-> axis/layer/quarter turns, scrambles
  cube/facelets.ts      sticker <-> Kociemba facelet string, validity checks
  cube/rotate.ts        integer 90° rotations
  cube/skins.ts         skin materials + the studio reflection environment
  fx/confetti.ts        solved confetti
  guide/content.ts      the solving guide's copy and demo sequences
  guide/guide.ts        side panel + looping demo cube
  solver/               cubejs in a Web Worker
tests/logic.test.ts
```

`CubeView` takes a host element and knows nothing about the page around it, so it
can move into kevs_site as a client component (`new CubeView(ref.current)`) without changes.
