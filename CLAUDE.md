# CLAUDE.md — Tiny Kingdom Manager

A peaceful isometric kingdom simulation for the browser. Vite + TypeScript +
Canvas 2D, no framework, no runtime dependencies, **no asset files** — all art
and audio are generated in code.

Read `DESIGN.md` before proposing anything new. It is the original brief and the
statement of intent; most of it is deliberately not built yet. This file
describes what exists **today** and how to work on it.

---

## The one thing to internalise

This is not a strategy game with a nice skin. It is a **terrarium**. Every design
call bends toward "pleasant to leave running on a second monitor."

Concretely, that means:

- **Nothing is ever punishing.** No fail state, no death, no disasters. Running
  out of something makes a system *wait*, never collapse. If you add a mechanic
  that can hurt the player, you have got it wrong.
- **A large part of the sim earns nothing.** Villagers sit on benches, watch
  ducks, and stand about. Do not attach a stat to charming behaviour, and do not
  "optimise away" idle behaviour as wasted CPU. It is the product.
- **The economy is physical and watchable.** Goods only enter the shared store
  when somebody has carried them there. Never add a mechanic that teleports
  resources; if you cannot see it happen on the map, it does not belong.
- **Ecology stays mysterious, economy stays transparent.** Costs, recipes and
  job slots are all shown plainly. Wildlife spawn rules are never surfaced as
  numbers — only as observational hints in the wildlife panel.
- **Tone: sincere and understated.** Warm, plain, occasionally dry. Real UI copy
  from the game: *"Nobody remembers putting it there, which is impressive,
  because you did."* Not zany, not quippy, no exclamation marks.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # tsc --noEmit — strict, noUnusedLocals/Parameters on
npm run build        # typecheck + production bundle (~50 kB gzipped)
```

---

## Verifying changes — do not skip this

There are two harnesses, and they exist because this project has two whole
classes of bug that reading code will not catch.

### Simulation: `npm run sim`

```bash
npm run sim -- 600                    # 600 game-minutes (20 kingdom days)
TKM_DUMP=k.json npm run sim -- 600    # …and write the end state as a save file
npm run roundtrip -- k.json           # check a save survives serialisation
```

Runs the whole kingdom headless with no rendering, playing it roughly the way a
player would — placing buildings, staffing jobs, reacting to shortages — then
prints population, storage, every villager's experience, when each species was
first noticed, goals, journal, and consistency checks.

**Run this after any change to `sim/`, and always after touching `defs.ts`.** It
is how the economy was balanced and it catches things that look fine in code:
production chains that silently never run, one resource crowding every other out
of storage, wildlife arriving far too fast, XP curves that take 40 hours.

A run of ~600–1000 game-minutes is the useful range. Under ~300 you will not see
the bakery come online; over ~1200 the kingdom has plateaued and tells you little.

### Visuals: `scripts/shot.mjs`

```bash
npm run dev &
node scripts/shot.mjs                                     # default view
node scripts/shot.mjs http://localhost:5173/ out.png 6 "window.tkm.game.camera.zoomIndex = 3"
PRELOAD=k.json node scripts/shot.mjs http://localhost:5173/ late.png
DEVICE=390x844@3 node scripts/shot.mjs                    # as a phone, with touch
DEVICE=768x1024@2 node scripts/shot.mjs                   # as a tablet
```

Drives headless Chrome over DevTools, runs your JS in the page, captures a PNG,
and reports console errors. `window.tkm` exposes `{ game, ui }` so a snippet can
set the season, jump to night, open a panel, or arm a tool before the shot.

**Look at the picture.** Every visual bug in this build — roofs rendering as flat
plates, an invisible element eating clicks on half the toolbar, lit windows
bleeding through the building in front — was invisible in the source and obvious
in a screenshot.

`PRELOAD` seeds a save and loads it through the game's own code path rather than
reloading the page, because a reload lets the throwaway kingdom's
autosave-on-unload clobber the seeded slot.

`DEVICE=<w>x<h>[@dpr]` emulates a phone or tablet with touch input. Use it for
anything touching layout or input: a 390px screen is where overlapping panels
and blocked gestures show up, and neither is visible in a desktop window. In the
page you can dispatch `PointerEvent`s with `pointerType: 'touch'` (two ids for a
pinch) and assert on `window.tkm.game.camera` — that is how the pan, pinch and
wheel behaviours are checked.

---

## Where things live

```
src/
  types.ts            shared vocabulary; every entity shape is here
  core/util.ts        seeded RNG, value noise, small maths, id counter
  world/
    iso.ts            projection (32×16 diamonds, 2:1)
    terrain.ts        map generation, tile queries, node regrowth
    path.ts           A* weighted by terrain speed
  sim/
    defs.ts           ALL game data and tuning — see below
    state.ts          GameState construction, storage, buildings, claims
    founding.ts       the opening: campsite rules and the stages after it
    villager.ts       needs, schedule, the planner — the heart of the sim
    wildlife.ts       habitat model, spawning, animal behaviour
    population.ts     arrival pacing
    goals.ts          onboarding goals and unlocks
    journal.ts        kingdom history + transient toasts
    names.ts          name generation and villager chatter
  render/
    palette.ts        season colour ramps, ambient day/night tint
    sprites.ts        procedural pixel art, baked to offscreen canvases
    actors.ts         villagers and animals, drawn per frame
    camera.ts         pan, integer zoom, follow
    renderer.ts       depth sorting, lighting, weather, labels
  audio/audio.ts      WebAudio synthesis (no files)
  save/save.ts        slots, RLE tile packing, export/import
  ui/ui.ts            all DOM interface
  ui/portraits.ts     map art painted into interface canvases
  ui/style.css        all styling
  game.ts             clock, input routing, every player-facing operation
scripts/              simcheck.ts, roundtrip.ts, shot.mjs
```

**`src/sim/defs.ts` holds essentially all the tuning**: buildings (size, cost,
labour, job slots, recipes, upgrade curve, lights), job and trait definitions,
wildlife species with habitat weights and rarity, terrain movement speeds, the
XP curve, day length and season length. Balance changes almost always belong
here rather than in logic.

It also holds the player-facing copy that describes the world rather than a
building: `TERRAIN_META` and `PROP_META` (what the tile inspector says about
ground and what is standing on it) and `RESOURCE_INFO` (the from/for lines in
the top-bar hover). New descriptive copy of that kind goes here too.

Every building has two strings: `desc`, the one-line summary in the build menu,
and `how`, a paragraph in its own panel explaining what it actually does —
ranges, batch times, when workers stop. `how` states real mechanics, so a change
to those numbers means a change to that copy.

---

## How the simulation works

**The planner.** When a villager's plan is empty, `think()` builds a new one out
of concrete steps — `move`, `act`, `take`, `give`, `labour`, `sleep`, `effect`.
Every economic action is therefore something you can watch happen on the map.

Priority order: put down anything carried → sleep if it is their bedtime → eat if
hungry and bread exists → the founding sequence if one is running → job work if
it is work hours → leisure. Helpers fall through a task ladder: supply
construction sites, then build them, then restock workshops, then clear finished
goods, then hand-gather whatever is scarcest.

**Plans are transient and never serialised.** They can hold closures and derived
data freely. After a load everyone simply re-decides. Do not try to save them.

**Deferred consequences use `effect` steps**, not callbacks — `{ t: 'effect',
kind: 'batch' | 'sow' | 'reap' | 'eat' | 'arrived' | 'settled' }`. That keeps
steps plain data and consequences exactly aligned with the end of the action that
caused them.

**The kingdom is founded, not handed over.** A new game has no fire, no store and
no bed: one person walks up a beach and the player chooses where they stop.
`sim/founding.ts` owns the stages — `arriving`, `choosing`, `settling`, `camp`,
`done` — and the plans that carry them out live in the planner with everything
else. The beats are: walk inland and look around → the player clicks clear grass
within nine tiles of the island's middle (`campProblem` is the rule and the
wording the player reads) → the founder walks there, stands a moment, and starts
a **woodpile**, a 12-capacity store that is not really a building → they gather
fallen branches by hand → the player places the **campfire** (5 wood) and they
lay and light it → then the **rough chest** (10 wood, holds 50), which quietly
removes the woodpile and opens the rest of the build menu.

Three things about that are load-bearing. The woodpile has to exist *before*
anybody sets off to gather, because wood with no store to land in goes nowhere
watchable. During founding the helper ladder runs with its gathering step
switched off (`planHelper(g, v, false)`) and wood is fetched to a flat target
instead — the ordinary rules stop gathering with more room free than a
twelve-stick pile has, which would strand the founder unable to afford the chest
that fixes it. And `availableToBuild()` in `goals.ts`, not `isUnlocked()`, is
what the build menu and `canPlace` ask: it also hides the fire and the chest once
they stand (`once` on the def) and everything else until the chest does.

**Fallen branches** (`branches`) are deadfall scattered near the middle at map
generation: six wood, no axe needed, gone for good once picked up, and preferred
over trees by every hand-gatherer. They are why the opening does not require a
woodcutter's lodge to get started.

**Beds are automatic until the player says otherwise.** `assignHome()` puts
somebody in the nearest free bed, and a finished house collects anyone still
sleeping by the campfire. `setHome()` is the player's version and sets
`homeFixed`, which both of those then leave alone — without that flag the next
cottage would quietly undo whatever arrangement was just made. The flag clears
if the house is demolished, or through "let them settle wherever".

**Claims prevent collisions.** `claim()` / `releaseClaim()` reserve a tree, a
farm plot, or a task so two villagers do not walk to the same one. Always release
through `releaseClaim` — it also clears the tile/plot flags. Plot claims are
keyed `farmId * 100 + slot`.

**Gluts, not jams.** `glutOf()` makes specialists stop when their own resource
exceeds 35% of storage capacity. Without it, woodcutters fill the barn and the
food chain starves. This is the mechanism that makes "the kingdom stalls but
never collapses" actually true.

Hand-gathering has the same idea in `gatherTarget()`: the flat targets (120 wood,
90 stone) are additionally capped at a share of what the kingdom can actually
hold. With a storehouse up this never binds. It exists for the opening chest,
which holds fifty: without it helpers cheerfully fill that with stone nothing
needs yet and leave the kingdom unable to afford the 25-wood storehouse that
would fix it — a stall with no way out, which is worse than a slow kingdom. This
is the same trap `DESIGN.md`-style per-resource shelf limits keep falling into,
and the reason any future version of them has to clear the early costs.

**Putting a load down never fails.** `deposit()` is clipped by capacity, but
`deliver()` — what a villager carrying goods actually calls — always accepts the
lot, so the store can briefly read over its limit while loads land. This is not
sloppiness, it is the fix for a hard deadlock: `think()` refuses to make a new
plan for anybody still holding something, so when a full store rejected a
delivery the villager walked to the barn and back forever and the kingdom could
never build again. Capacity governs when people stop *fetching more*
(`storageFree(g) < 4` in the gathering planners); it must never govern whether
something already in someone's arms can be set down. `simcheck` now fails on any
villager left idle while carrying, which is what that deadlock looked like.

**Wildlife.** `survey()` scores habitat across the map every 20 game-seconds from
terrain, nearby props, farm plots and season. Spawn chance is `0.45 / rarity³`,
cut to 0.3× again for a species' first-ever appearance, plus a per-species
cooldown. A species counts as *discovered* only once one comes within 7 tiles of
a villager or building — so ducks across the pond stay unlisted until somebody
wanders down there. Current pacing: commons day 1, deer ~day 9, snowy owl in the
first winter or two.

---

## How rendering works

**Pixel-perfect pipeline.** The world is drawn into an offscreen buffer at
exactly one canvas pixel per art pixel, then upscaled nearest-neighbour at an
**integer** scale (`round(zoom × dpr)`). This is what keeps the art crisp. Never
draw world content directly to the display canvas, and never introduce a
fractional scale.

**Ground is baked once** into a single map-sized canvas and blitted as one
image. Call `renderer.invalidateGround()` after any terrain or season change.

**Everything else is depth-sorted** by `x + y` per frame. Buildings sort from
their front tile minus a hair; farms sort from their *back* corner so crops draw
over the plot. Anything drawn outside that sorted pass will render on top of the
whole world — that was the lit-window bug.

**Sprites are procedural.** `sprites.ts` builds terrain, props, buildings and
crops into cached canvases from the season palette; `actors.ts` draws villagers
and animals per frame with `fillRect`, since they are tiny and each has its own
colouring. A season change simply re-bakes everything.

Building geometry: `isoWalls()` for the box, `gableRoof()` for a pitched roof
whose ridge runs along the grid x-axis, both filled column-by-column via
`fillPoly()` so edges stay hard. Buildings need visibly more wall than roof or
they read as flat plates. Sprites carry `padX` (roof overhang) and `rise`
(height above the footprint) — honour both when positioning.

**Lighting** is a separate buffer: ambient tint from `ambientTint()`, plus
radial sources composited `lighter`, then the whole thing multiplied over the
world. Anything that should glow at night must contribute to the light buffer;
drawing it bright in the world buffer alone will just get darkened.

**Activity badges are the one exception to the sorted pass.** The little glyph
over each villager's head (`drawActivityIcon` in `actors.ts`, glyphs defined as
7×7 character rows) is collected during the world pass and drawn in
`drawBadges()` *after* lighting, so it stays readable in the dark — held back a
little by `darkness` so it does not become the brightest thing at night. It is
still pixel art in the world buffer, unlike the names and speech bubbles, which
are screen-space text drawn after upscaling.

---

## Input and the view

**Zoom is stepped and always will be.** `ZOOM_LEVELS = [1, 2, 3, 4, 6]` feeds
`round(zoom × dpr)`, and the pixel pipeline depends on that being an integer.
There is no smooth zoom to add; what can be smoothed is the *input*.

**Scrolling always zooms; what varies is the runway.** A trackpad fires dozens
of wheel events per swipe, so stepping a level per event blew through every
level in one flick — the original bug. `handleWheel()` classifies the gesture
once, after a 180ms gap, and holds that classification until it ends:

- **wheel** (`deltaMode !== 0`, or a lone vertical delta of 50+) — one notch is
  one level, ignoring delta size, because mice disagree wildly about it (120 on
  a Mac, 53 on some Windows mice). A fast spin is simply more notches.
- **trackpad** — accumulate against a 90-pixel threshold, so a normal swipe is
  about one level.
- **pinch** (ctrl+wheel, tiny deltas) — same accumulator, 24-pixel threshold.

Panning is drag-only, by deliberate choice: the player asked for scroll to zoom
after trying scroll-to-pan.

**Touch is pointer events, not touch events.** One pointer drags, two pinch
(`handlePinch`). Pinch needs a large ratio change (1.3×) before it clicks over a
level, because the steps are coarse. `setPointerCapture` is wrapped in
try/catch — it throws for pointers the browser will not capture, and an
exception there used to abort the whole gesture.

**The bottom-right view pad is the entire interface on a touchscreen**: zoom out,
zoom in, recentre — three separate buttons, no group chrome. It is a row in the
corner on desktop and a centred row along the bottom on phones. Do not let
panels overlap it; `.side.right` stops short for exactly that reason.

Its hover labels live on a `.vwrap` wrapper rather than on the button, because a
`disabled` button takes no pointer events and so can never show a tooltip — and
the greyed-out one is precisely the button people need explained. The zoom
buttons disable at each end of the ladder and say the current level.

**The campsite marker is the one tool that arms itself.** `Game.syncCampTool()`
puts it on the cursor while founding is at `choosing` and takes it off the moment
the ground is picked; `cancelTool()` deliberately re-arms it rather than clearing
it, and its toolbar hint has no Done button. At that moment it is the only thing
the player can do, so an interface that let them put it away would only be a way
of getting stuck with nothing on screen to explain why.

**Speed lives in Settings → Viewing**, not on the map, along with `space` and
`1`/`2`/`3`. **Removing a building lives at the foot of the build panel**, not in
the top bar; a building's own panel has Improve, Show me and Remove in its
footer. Both were moved out of the way deliberately — do not put them back on
the map chrome.

**Villagers, animals and tiles get a card in the right margin; a building gets
the whole modal.** Clicking a building on the map fires `game.onBuildingClicked`
— deliberately not fired by `place()`, so laying out a row of houses is not
interrupted by a panel — and the UI opens a **People · Work · About** panel
(**Site · About** while it is still being built). The margin has no building
card at all any more. Closing the panel clears the selection, so nothing is left
outlined on the map with nothing to explain it.

That panel is a *live* view: `refreshPanels()` redraws it a few times a second so
"Here now", batch progress and site materials keep up. Two consequences worth
knowing. It skips the redraw while a `<select>` inside it has focus, or opening a
dropdown would slam shut under the player. And it updates the existing nodes in
place rather than rewriting `modalHost.innerHTML` — replacing the whole modal
restarts the scrim's fade animation, which reads as a flicker (invisible in the
source, obvious in a screenshot) and throws away the body's scroll position.

**`ui/portraits.ts` paints the map's own art into the interface** — the figure
beside a name in a roster is `drawVillager` at 2× on a still, empty-handed pose,
and the picture in the header is the building's cached sprite at 1:1. Both go
into `<canvas>` nodes the panel has already inserted, painted in the same task,
rather than into `<img src="data:…">` that could be caught mid-decode by the
next redraw. Poses are deliberately frozen: at 2.6 redraws a second a walk cycle
twitches and a windmill's sails look broken rather than turning. That is also
why `drawMillSails` lives in `sprites.ts` and not privately in the renderer —
the sails are not baked into the sprite, so the panel has to draw them too.

**"Here now" is a fixed height, not a minimum.** People wander in and out of it
constantly; a box that grows and shrinks drags everything below it up and down
the whole time. It holds two rows and scrolls, and its scroll position is one of
the things the in-place update has to preserve. Mobile rows are half again as
tall, so that height is set per breakpoint.

**"Here now" means within one tile of the footprint**, which is exactly where
`footprintApproach()` puts people, so it is the honest definition of being at a
building. It is not the same as the roster: `findPath` gets as close as it can,
so a house hemmed in by other buildings has residents who bed down several tiles
away. Do not label a bed row "asleep here" — say what they are doing and let
"Here now" answer where they are.

**`touch-action: manipulation` on `#ui` is load-bearing.** Without it, tapping
the same button twice quickly triggers the browser's double-tap-to-zoom and
wrecks the layout. iOS ignores `user-scalable=no` in the viewport meta, so this
declaration is the only thing that actually prevents it.

---

## Gotchas that have already bitten

- **`#ui > * { pointer-events: auto }` outranks a bare class selector.** A hidden
  overlay with `.thing { pointer-events: none }` stays clickable and silently
  eats clicks on whatever is beneath it. Scope such rules as `#ui .thing`. This
  broke half the toolbar — and later the whole of mobile: `.side` is pinned
  `top: 62px; bottom: 14px`, so on a 390px-wide phone the two empty panel
  columns covered every pixel of the map and swallowed every drag. Any
  full-height layout box that is usually empty must be `pointer-events: none`
  with `auto` on its children. `document.elementFromPoint()` in a device-
  emulated screenshot is the fastest way to catch it.
- **Vite dev serves `index.html` for unknown paths.** You cannot get a
  same-origin "blank" page from the dev server to seed `localStorage`; the app
  boots and autosaves over you.
- **Villagers must be in work hours to work.** A fresh game starts at `dayT`
  0.17 for exactly this reason — earlier and the founder idles through the
  intro instead of chopping wood.
- **`noUnusedLocals` / `noUnusedParameters` are on.** Removing an export means
  removing its now-unused imports too.
- **Emoji render unreliably in headless Chrome.** Do not judge icon-only UI from
  a screenshot; label things with text anyway, which is better UI regardless.
- **A tool with no on-screen feedback is undiscoverable.** Arming a mode must
  show a persistent hint saying what it does and how to stop (`.toolbar-hint`).

---

## Conventions

- Comments explain **why**, not what. Match the density already in the file.
- British-ish spelling in user-facing copy ("favourite", "colour"); code
  identifiers are whatever reads best.
- No new runtime dependencies without asking. The zero-dependency,
  single-bundle, no-asset property is deliberate and worth protecting.
- Prefer adding data to `defs.ts` over adding branches in logic.
- User-facing copy is part of the design. Write it in the game's voice.

---

## What is not built yet

All specified in `DESIGN.md`, all deliberately deferred:

expeditions · research / Knowledge tree · traveling merchants and visitors ·
domestic animals (chickens, sheep, cows, dogs, cats) · aging and retirement ·
land expansion into new chunks · daily / weekly goals · achievements and the
wider collections · villager requests

The scaffolding they hang off already exists — journal, discovery set, unlock
keys, per-building job slots, the goal list, the coin resource. Adding one of
these is mostly new data in `defs.ts` plus a system module, not surgery.

Also unbuilt and worth knowing: there is currently no Carpenter, Scholar,
Merchant or Animal Keeper profession (the `keeper` job id exists but nothing
uses it), and `coin` has no sink beyond a single goal reward.

---

## Deliberately removed

**Roads and paths are gone, and are not coming back.** `DESIGN.md` specifies
them at length — player-placed roads, a meaningful movement bonus — and that
part of the brief has been dropped on purpose. There is no paint tool, no
`road`/`path` terrain, and no built surface anyone can walk faster on. Terrain
still has its own speeds (forest and rocky ground are slower), but the player
cannot buy speed. Old saves containing paved tiles load with those tiles turned
back to grass; see `deserialize` in `save/save.ts`.

---

## Scale reference

Map 40×40 · a day is 30 real minutes at 1× (20 day / 10 night) · 6 days a season,
24 a year · population cap 100, arriving roughly one per game-day early on ·
Master rank is ~10–15 real hours of dedicated work in one trade · storage is a
single shared pool fed by storage buildings: 12 in the founding woodpile, 50 in
the chest that replaces it, +250 per storehouse. Founding itself is four or five
real minutes at 1×.

Per-resource shelf limits — one good never taking more than a share of the
store — have been discussed and deliberately deferred. Any such limit has to
clear the early costs (a Storehouse is 25 wood against an opening capacity of
50) or it recreates the deadlock it was meant to prevent. `gatherTarget()` is
the nearest thing to one that survived, and only because it caps *fetching*
rather than storing.
