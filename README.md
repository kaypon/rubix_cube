# /CUBE

A Rubik's cube you can twist, paint to match yours, and watch solve itself.
Three.js + Vite + TypeScript, styled to sit next to kevs_site's `/spin` and `/cables`.

```sh
npm install
npm run dev      # http://localhost:5173 (and /timer); /api/scores runs too, on the dev board
npm test         # notation/geometry checked against cubejs, plus solver round-trips
npm run build    # typecheck + production build in dist/
npm run board    # list the real leaderboard; `-- remove 3`, `-- clear --yes`, add `--dev` for the dev one
```

The leaderboard needs the Redis env vars: `vercel env pull .env.local --yes`.

## Using it

- **Turn**: drag a face. Flick to carry the turn through.
- **Look around**: drag the background. It turns any way, upside down included.
  Double-click the background (or press Reset) to stand it back up.
- **Keys**: `U R F D L B M E S x y z`, hold Shift for the reverse turn. Keys follow
  the view: `U` turns whatever face is on top of the screen right now.
- **Paint**: hold your cube white on top, green facing you, then paint what you see.
  `Clear stickers` blanks everything but the centers. Keys `1`–`6` pick colours, `Esc` exits.
- **Solve**: finds a ~20-move solution (Kociemba two-phase) and plays it.
  Scrub the move list, step with `←` `→`, `Space` to play/pause.
  If the painted cube can't exist, it tells you why (a twisted corner, a flipped edge, …).
- **Mix**: resets to solved, then walks through a 20-move mix one move at a time
  (`>` or `→` for each), so you can copy it onto a real cube held white on top, green in front.
- **Share**: copies a link (`?cube=` plus 21 characters) to the cube exactly as it is.
  Opening it shows that cube, and `|<` walks back to solved so the mix can be copied move by move.
- **Timer** (`/timer`): hold Space (or the clock) until it goes green, let go to start,
  any key or tap to stop. Shows a scramble and its net, keeps your times in the browser
  (best, Ao5, Ao12, mean), and offers the shared top 10 when a time makes it.
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
  cube/state.ts         the cube as 54 stickers with no 3D (timer net, tests)
  cube/share.ts         cube state <-> 21-character link code
  solver/               cubejs in a Web Worker
  timer/                /timer page: clock, stats, board client
timer/index.html        /timer entry
api/scores.js           GET/POST the top 10 (Vercel Function, Upstash Redis)
api/_board.js           board rules shared by the API, the timer and the admin script
scripts/board.ts        list/remove/clear entries
tests/logic.test.ts
```

## Leaderboard

Top 10 in a Redis sorted set (score = ms). The Redis is one-light-day's free Upstash
database, connected to this project too; everything here lives under `cube:` (production)
or `cube-dev:` (local and previews), so neither app touches the other's keys.
The timer is for a real cube, so nothing can prove a solve happened. The API refuses times
under 3 s or over an hour, takes 5 posts per address (IPv6: per /64) per 10 minutes, 20 a minute and 3000 a month
(only times that would make the board count toward those last two),
only accepts posts from its own page, and keeps names to 12 plain characters.
Anything rude: `npm run board -- remove <rank>`.

`CubeView` takes a host element and knows nothing about the page around it, so it
can move into kevs_site as a client component (`new CubeView(ref.current)`) without changes.
