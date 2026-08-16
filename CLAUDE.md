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

There are three harnesses, and they exist because this project has three whole
classes of bug that reading code will not catch.

### Simulation: `npm run sim`

```bash
npm run sim -- 600                    # 600 game-minutes (20 kingdom days)
npm run sim -- 600 4242               # …on a different island
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

**The run is reproducible.** The gameplay RNG starts from the world's seed
rather than the clock, so two runs of the same seed and length are byte-for-byte
identical and a diff between them is meaningful. It also means one run is one
island: before concluding anything from a number, try `npm run sim -- 700 4242`
and see whether it holds somewhere else.

### Worlds: `npm run worldcheck`

```bash
npm run worldcheck                    # 10,000 seeds
npm run worldcheck -- 100000 900000000  # …a different, larger slice
npx tsx scripts/worldcheck.ts 1 8     # one seed, the way a failure reports itself
```

Generates island after island and checks each one is a kingdom somebody could
start on: the wood and stone the first hour needs, exactly six deadfall piles
with at least two the founder can walk to, a campsite the game's own rule would
accept, a beach that connects to it on foot, sane tiles, and the same seed
giving the same world twice.

**Run this after any change to `world/terrain.ts`.** Generation leans on random
scatter, and a scatter with a give-up guard is not a guarantee — the failures it
finds are single seeds in the tens of thousands where the noise came out badly
and the founder walks up a beach to an island with no firewood on it. It prints
the failing seed so the world can be regenerated on its own.

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
  ui/ui.ts            the shell: what is open, where it goes, what a click means
  ui/context.ts       UIEnv (compact/short/touch), esc/el, activity labels
  ui/hud.ts           top strip — resources, store meter, clock, stores sheet
  ui/nav.ts           desktop toolbar, phone bottom nav, view pad, More sheet
  ui/goals.ts         goal panel, phone objective chip, full goal sheet
  ui/build.ts         build list, placement bar, tool hints
  ui/inspector.ts     villager / animal / tile cards
  ui/modals.ts        building panel, people, journal, wildlife, settings
  ui/a11y.ts          focus trap, focus restore, live region
  ui/portraits.ts     map art painted into interface canvases
  ui/style.css        all styling
  game.ts             clock, input routing, every player-facing operation
scripts/              simcheck.ts, worldcheck.ts, roundtrip.ts, shot.mjs
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
no bed: one person walks up a beach, and the opening asks the player exactly one
question — *where should this kingdom begin?* `sim/founding.ts` owns the stages —
`arriving`, `choosing`, `settling`, `camp`, `done` — and the plans that carry them
out live in the planner with everything else.

The beats: walk inland and look around → the player clicks clear grass within
nine tiles of the island's middle (`campProblem` is the rule *and* the wording
the player reads) → **an unlit fire ring goes down on that tile at once**, which
is both the acknowledgement and the campfire's construction site → the founder
walks out to it → gathers two piles of deadfall, twelve wood, and carries them →
lays and lights the fire out of that load (4 wood) with no placement step at all
→ the player sites the **Small Chest** beside it (8 wood, the exact remainder) →
finishing it ends founding and opens the ordinary economy.

**The campsite and the campfire are the same decision**, which is why the fire is
`order: -1` and never appears in the build menu. Asking for the fire's position
after asking for the campsite would be asking the same question twice.

**Nobody idles during the opening.** The founder gathers deadfall while the
player is still choosing the ground — the wood is wanted wherever the camp ends
up — and feeds the fire while the player decides where the chest goes. There is
one deliberate pause, the beat before "This seems like a good place to begin",
and it uses the `arriving` activity rather than `watching`. The leisure planner
is never reached before the chest is finished. Idling is the product *after* the
kingdom exists; during the opening it reads as a broken game.

**The founder carries the treasury.** There is no store until the chest exists,
so `think()` skips its "put down anything carried" rule for the founder while
founding runs (`isFounder`), gathering runs with `haul` off, and both founding
builds are paid straight out of their arms — that is what `qty` on a `give` step
is for: the fire takes four of the twelve and the rest stays held. Nothing else
in the game has a personal inventory, and the exception ends with the chest.
Balance is exact: 6 + 6 gathered, −4 fire, −8 chest, 0 left.

`availableToBuild()` in `goals.ts`, not `isUnlocked()`, is what the build menu and
`canPlace` ask. It hides `once` buildings that already stand, and during founding
offers only the chest. After that the menu opens a step at a time rather than all
at once: the chest goal unlocks the Cabin, the cabin goal the Storehouse and
Quarry, the storehouse goal the Lodge and Farm. `unlocks` on a goal therefore
takes a key *or a list*.

**Fallen branches** (`branches`) are deadfall scattered near the middle at map
generation: six wood a pile, no axe needed, gone for good once picked up, and
preferred over trees by every hand-gatherer. Two piles are exactly one founding.

There are **exactly six**, and at least two of them are guaranteed walkable from
a legal campsite — `generateMap` checks this against the same flood fill the
beach is checked against, and moves a stranded pile rather than adding a seventh.
Six is a head start rather than a supply: enough for the founding and a short
grace period, and then somebody needs an axe. Do not raise the count to smooth
the early game — deadfall never regrows, so more of it only moves the moment the
lodge starts mattering, and `npm run worldcheck` asserts the number.

**The interface hides the store until there is one.** `#ui.founding` drops the
whole resource cluster rather than showing `Store 0/0` about a pool that does not
exist, and the goals panel shows one instruction instead of two and says what the
founder is carrying. During founding the placement bar *is* the instruction, so
the objective is hidden while it is up (`has-hint`) rather than saying the same
thing twice — which is what went wrong at 844×390, where neither the old 600 nor
the 820 pixel breakpoint fired and both were on screen at once.

**Beds are automatic until the player says otherwise.** `assignHome()` puts
somebody in the nearest free bed, and a finished house collects anyone still
sleeping by the campfire. `setHome()` is the player's version and sets
`homeFixed`, which both of those then leave alone — without that flag the next
cabin would quietly undo whatever arrangement was just made. The flag clears
if the house is demolished, or through "let them settle wherever".

**Nobody walks in on a kingdom that does not exist yet.** `updatePopulation`
returns before it even decrements its clock while founding runs, so the first
stranger is not already overdue by the time the chest is finished. And when the
*only* thing standing in the way is a bed, it retries after about a tenth of a
day rather than the usual gap of nearly one: the player has just built a cabin,
and being made to wait most of a day afterwards reads as the cabin not having
worked. Neither changes how many people end up in a kingdom — the appeal roll
still governs that — only how long the dead time is.

**Buildings grow rather than being replaced.** There is one house — the **Cabin**,
2 / 4 / 6 beds — and one first store — the **Chest**, 50 / 200 / 500, named Small,
Medium and Large by `levelNames`. A `levelNames` def means the panel, the toasts,
the journal and every "sleeps at the…" line must use `buildingName(def, level)`
rather than `def.name`; `def.name` is only right in the build menu, which is
always offering a level-1 one. Both change silhouette per level too, because a
store that holds ten times as much and looks identical is a change you cannot
see. Costs that a multiplier cannot express — a cabin starts as 20 wood and later
wants stone — go in `upgradeCosts`, an explicit per-step table; otherwise
`upgradeCostMul` compounds with level.

**Improving a building never takes it out of service** (`isOperational`). Storage,
housing and `nearestStore` all count a building that is mid-upgrade, at its
current level. Without that, improving the kingdom's only chest drops capacity to
zero, which leaves nobody able to fetch materials for the work under way — a
deadlock the headless run hit on the first attempt.

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

**A spawn can be refused, and a refused spawn costs nothing.** The survey lattice
is sampled every other tile and the chosen spot is then jittered, so the tile a
creature was about to appear on is checked with `canStand` first — in bounds, no
building, ground this species can be on. If nothing nearby will do, the moment
passes and the cooldown is *not* started, since a bad roll should not spend the
species' next chance.

**Wildlife pacing lives on the state, the habitat scores do not.** `g.wildlife`
holds each species' cooldown and the time to the next survey, and is saved.
`habitatCache` is a module-level cache of what the map currently looks like, and
`rebuildHabitat()` — called when a kingdom is opened or swapped — throws it away
and surveys the new one immediately. Keeping the timers in the module did neither
job: loading zeroed every cooldown *and* the survey timer, so the first tick
after a reload rolled for every species at once, and reloading was the fastest
way to find a snowy owl.

**The gameplay RNG is part of the world.** `rng` is seeded from the world's seed
in `newGame` and restored from `rngState` on load, so reopening a kingdom
continues it instead of re-rolling its future. Anything that would need to
survive a save belongs in `GameState` or in that stream — module-level mutable
state is neither saved nor cleared when the player opens a different kingdom, and
both of those bugs have now been found here.

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
corner on desktop and a column up the right-hand edge on a phone, sitting above
the dock. It fades out while a sheet is open (`#ui.compact.sheet-open`), because
the pad is for looking at the map and a sheet means the player is doing
something else; it must never be *covered* by one.

Its hover labels live on a `.vwrap` wrapper rather than on the button, because a
`disabled` button takes no pointer events and so can never show a tooltip — and
the greyed-out one is precisely the button people need explained. The zoom
buttons disable at each end of the ladder and say the current level.

**Founding's two placements arm themselves.** `Game.syncFoundingTool()` puts the
campsite marker on the cursor while founding is at `choosing` and takes it off
the moment the ground is picked; `cancelTool()` deliberately re-arms *that* one
rather than clearing it, and its hint has no Done button, because at that moment
it is the only thing the player can do. The chest is different: it is armed once
when the fire lights and can be dismissed, since by then there is a kingdom worth
looking at. Both exit the tool after a successful placement — the only placements
in the game that do, since laying out a row of houses should not mean going back
to the menu five times.

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
outlined on the map with nothing to explain it. On a phone that margin card
becomes a bottom sheet with a Close button of its own, and the roster in the
People panel becomes stacked cards — name, what they are doing, one job
dropdown — because four columns in 340 pixels makes all four illegible rather
than one of them.

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

**`touch-action: manipulation` is load-bearing, and is scoped to the controls.**
Without it, tapping the same button twice quickly triggers the browser's
double-tap-to-zoom and wrecks the layout; iOS ignores `user-scalable=no`, so it
is the only thing that prevents it. It is applied to buttons, selects, inputs
and the rows that behave like buttons rather than to the whole of `#ui`, and the
viewport meta no longer locks scaling — enlarging the interface text is a
reasonable thing to want, and the game camera does its own pinch handling on the
canvas, which is a separate element with `touch-action: none`.

---

## The two shapes of the interface

`UIEnv` in `ui/context.ts` decides which one, from three media queries rather
than from width alone:

- **`compact`** — `max-width: 820px`, *or* a short viewport with a coarse
  pointer. Below 820 there is no room for a build rail, an inspector and a map
  between them, and a large phone held sideways is 844 across and still wants
  the phone layout.
- **`short`** — `max-height: 520px`. Phone landscape: the bar puts its buttons
  back beside its words, and the objective chip stands down while a sheet is up.
- **`touch`** — `pointer: coarse`. Drives preview-and-confirm placement and
  44-pixel targets, independently of size, so a touchscreen laptop gets the
  safer placement without losing its rails.

**On a phone there is exactly one major sheet at a time.** `setModal`,
`toggleBuild` and `closeWhatIsCovered` enforce it in the shell — selecting
somebody on the map closes whatever was covering the map — and the stylesheet
makes an overlap impossible even for a frame. The five destinations along the
bottom (Build · People · Journal · Wildlife · More) are labelled, not just
iconed, and show which section is open.

**Everything pinned to the bottom edge lives in one flex column, `.dock`.**
Before, each box measured itself and told the next how far up to sit, and a hint
that ran to four lines was written straight over. Four measured custom
properties carry what CSS cannot know: `--dock-h`, `--top-h` (the strip wraps to
two rows on a narrow window), `--sheet-h` and `--goals-h`. Position off those,
never off a number that was true of one screen.

**Placement on a touchscreen is preview-and-confirm.** `Game.requireConfirm` is
set from `pointer: coarse`. A tap sets `Game.candidate` instead of building:
the ghost lands, `placeProblem()` says in words why that tile will not do —
"The cabin is already there. Somewhere clear." — and nothing happens until
Confirm. `placeProblem` is written the same way as `campProblem`: it says what
is wrong, not what the rule is. A mouse still builds on click, because the
cursor has been showing the ghost for as long as the player cared to look.

**Removal always asks, on every device.** `demolishAt` and the Remove button
both call `askDemolish`, which only sets `Game.demolishTarget`; the question
appears in the building's own footer if that panel is open and in the bottom bar
if it is not. It is the one action here that waiting does not undo.

**Accessibility lives in `ui/a11y.ts`.** `Focus` moves focus into an opened
panel, traps `Tab` inside true modals, and hands focus back on close — via a
`data-act` key rather than a node reference, since opening a panel re-renders
the bar it was opened from and detaches the original button. `keepFocus` does
the same for the panels that redraw themselves several times a second. Release
focus *after* the redraw, never before, or it lands on a node that is about to
be replaced.

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
- **`hash2` multiplies with `Math.imul`, and has to.** Plain `*` on a full 32-bit
  salt lands past 2^53, where the x and y terms round clean away and every tile
  on the map hashes to the same value. This was invisible while salts were 16
  bits. Any new hashing here uses `imul` throughout.
- **A guard that gives up is not a guarantee.** Every random scatter in
  `terrain.ts` — trees, boulders, deadfall — is followed by a deterministic fill
  from `candidateTiles`, because "throw 4000 darts and hope" fails on a few
  seeds in ten thousand and those are exactly the unplayable ones. When adding a
  guarantee, make sure the *counting* rule and the *placing* rule agree on the
  band: rounding a dart at radius 13.9 to a tile puts it at 14.2, and a fill
  that counts what it cannot measure reports success one node short.
- **Bumping `SAVE_VERSION` makes every existing kingdom unopenable.** That is the
  deliberate policy — files are refused rather than guessed at — but it means the
  bump is the whole decision, not a detail of one. The message the player gets
  lives in `ui.ts`, and must not name a particular update.

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
single shared pool fed by storage buildings: nothing at all until the Small Chest
is finished, then 50, 200 or 500 as it is widened, and +250 per storehouse ·
housing is Cabins alone, 2 / 4 / 6 beds · founding itself is about eighty seconds
at 1×, twenty of them the walk up the beach · a generated island carries at least
55 trees and 26 boulders within 14 tiles of the middle, and exactly 6 deadfall
piles, the nearest about 3 tiles from where the kingdom begins.

Per-resource shelf limits — one good never taking more than a share of the
store — have been discussed and deliberately deferred. Any such limit has to
clear the early costs (a Storehouse is 25 wood against an opening capacity of
50) or it recreates the deadlock it was meant to prevent. `gatherTarget()` is
the nearest thing to one that survived, and only because it caps *fetching*
rather than storing.
