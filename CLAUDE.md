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
npm run build        # typecheck + production bundle (~80 kB gzipped)
```

---

## Verifying changes — do not skip this

There are four harnesses, and they exist because this project has four whole
classes of bug that reading code will not catch.

### Simulation: `npm run sim`

```bash
npm run sim -- 600                    # 600 game-minutes (20 kingdom days)
npm run sim -- 600 4242               # …on a different island
TKM_DUMP=k.json npm run sim -- 600    # …and write the end state as a save file
npm run roundtrip -- k.json           # check a save survives serialisation
```

Runs the whole kingdom headless with no rendering, playing it roughly the way a
player would — placing buildings, staffing jobs, reacting to shortages,
decorating once the bread is coming — then prints population against beds, the
Vibes broken into their three parts, the arrival window and what is on its way,
storage, every villager's experience, when each species was first noticed,
goals, journal, and consistency checks. The arrivals list at the end is the
quickest read on pacing: the gap between each line should sit inside the window
printed at the top.

**Run this after any change to `sim/`, and always after touching `defs.ts`.** It
is how the economy was balanced and it catches things that look fine in code:
production chains that silently never run, one resource crowding every other out
of storage, wildlife arriving far too fast, XP curves that take 40 hours.

It also asserts the things that must never be true whatever the balance: stone
in a kingdom with no quarry, ore before an Iron Mine, coal before a Deep Mine,
bars with no forge, any mithril at all, and rubble counting down to become a
boulder again. Those are the rules of the world rather than tuning, so they fail
the run rather than showing up in a number somebody has to notice.

Two things about the harness are load-bearing and easy to undo by tidying. It
**staffs before it builds**, and never gates staffing on whether something is
under construction — it used to do both at the foot of one early return, so a
site the kingdom could not yet pay for froze the whole run: nobody could be put
on the mine, so no stone was cut, so the site stayed unpaid, for twenty days.
And it plays by the interface's own rules, including `needsRock`, so it can no
more drop a quarry on a meadow than the player can.

A run of ~600–1000 game-minutes is the useful range. Under ~300 you will not see
the bakery come online, and under ~450 you will not see a forge; over ~1200 the
kingdom has plateaued and tells you little.

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
start on: the wood and stone the first hour needs, a choice of at least six
three-by-three campsites the game's own rule would accept, at least four trees
the founder can walk to from where they start, at least three places a Quarry
could legally stand — on or against rock, with twenty-five tiles of rock inside
its reach — a beach that connects to it on foot, sane tiles, and the same seed
giving the same world twice.

**Run this after any change to `world/terrain.ts`.** Generation leans on random
scatter, and a scatter with a give-up guard is not a guarantee — the failures it
finds are single seeds in the tens of thousands where the noise came out badly
and the founder walks up a beach to an island with no firewood on it. It prints
the failing seed so the world can be regenerated on its own.

The quarry check earns its place now that stone comes from a quarry and from
nowhere else: an island whose rock is all across the water or all under the pond
is not a hard start, it is a kingdom that cannot pass its second commons. It
measures *rocky ground* rather than boulders, because that is what the mine
works — boulders are finite scenery, and a site with none of them left beside it
is still a perfectly good mine.

### Moving buildings: `npm run reloccheck`

```bash
npm run reloccheck
```

Drives one relocation the whole way through on a real kingdom — start the move,
check the original is still working and still staffed, save and reload it
half-finished, then let villagers actually carry the materials and build it.

**Run this after any change to relocation, `completeConstruction`, or
`removeBuilding`.** Moving a building is the only thing in the game that changes
a finished building's coordinates, and everything it can get wrong is invisible
both in the source and on screen: a footprint left claimed by a building that
has walked away, a worker pointing at a corner with nothing on it, a level or a
name quietly reset to what a new one would have had.

### Arrivals: `npm run popcheck`

```bash
npm run popcheck
npm run popcheck -- 4242              # …on a different island
```

Drives the arrival rules one at a time on a real kingdom: the clock that must
not run during the founding, the first companion landing inside six to nine
game-minutes of the camp's second bed existing, progress *freezing* rather than
emptying when every bed is full, both halves of a walk surviving a save, and
Vibes shortening the wait without ever moving it outside the window.

**Run this after any change to `population.ts`, `vibes.ts`, or anything that
adds or removes beds.** `simcheck` shows that people turn up and roughly how
fast; it cannot show the edges, and every one of those is invisible in the
source and on screen alike. A kingdom that loses its accumulated wait the moment
the beds fill, or hands the next traveller a fresh roll on every reload, looks
exactly like a kingdom that does not — for hours.

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
    terrain.ts        map generation, tile queries, tree regrowth, rock queries
    path.ts           A* weighted by terrain speed
  sim/
    defs.ts           ALL game data and tuning — see below
    state.ts          GameState construction, storage, buildings, claims
    founding.ts       the opening: campsite rules and the stages after it
    villager.ts       needs, schedule, the planner — the heart of the sim
    wildlife.ts       habitat model, spawning, animal behaviour
    population.ts     beds, arrival windows, who walks in
    vibes.ts          how nice the place is, out of a hundred
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
scripts/              simcheck.ts, worldcheck.ts, relocheck.ts, popcheck.ts,
                      roundtrip.ts, shot.mjs
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

The beats: walk inland and look around → the player clicks open grass within nine
tiles of the island's middle (`campProblem` is the rule *and* the wording the
player reads) → **a rough camp goes down on those nine tiles at once**, which is
both the acknowledgement and the Base Camp's construction site → the founder
walks out to it → fells one ordinary tree by hand for one full load of twelve
wood → builds the Base Camp out of that load, with no second placement at all →
finishing it ends founding and opens the ordinary economy.

**There is exactly one placement in the opening, and the camp is all of it.** The
Base Camp *is* the fire, the first store and the first two beds, so it is
`order: -1` and never appears in the build menu, and nothing else is offered
until it stands. Asking where the fire goes after asking where the camp goes
would be asking the same question twice.

**The camp is a centred 3×3 and the cursor is its middle.** `campProblem` checks
all nine tiles, `CAMP_HALF` / `CAMP_SPAN` in `world/terrain.ts` own the shape, and
`Founding.x/y` stores the *centre* — the tile the fire ends up on — while
`Building.x/y` is the top-left corner like every other building. Props inside the
footprint are cleared when it is placed and yield nothing, because there is no
store yet to put them in.

**Nobody idles during the opening.** The founder fells their tree while the
player is still choosing the ground — the wood is wanted wherever the camp ends
up — so a quick decision costs nothing and a slow one is spent usefully. There is
one deliberate pause, the beat before "This seems like a good place to begin",
and it uses the `arriving` activity rather than `watching`. The leisure planner
is never reached before the camp is finished, and `planSurvey` (pacing the
clearing) covers any wait. Idling is the product *after* the kingdom exists;
during the opening it reads as a broken game.

**The founder carries the treasury.** There is no store until the camp exists,
so `think()` skips its "put down anything carried" rule for the founder while
founding runs (`isFounder`), gathering runs with `haul` off, and the camp is paid
straight out of their arms — that is what `qty` on a `give` step is for. Nothing
else in the game has a personal inventory, and the exception ends with the camp.
Balance is exact: one tree, four swings, twelve wood, twelve spent.

The founding fell runs at the *ordinary* chop speed rather than the untrained
one (`slow: false`). It is the first minute of the game; it should read as
deliberate, not as a penalty for not owning an axe yet.

`availableToBuild()` in `goals.ts`, not `isUnlocked()`, is what the build menu and
`canPlace` ask. It hides `once` buildings that already stand, and during founding
offers **nothing at all** — the opening's one decision is not a building, and
everything else would be unaffordable anyway.

**The interface hides the store until there is one.** `#ui.founding` drops the
resource chips and the store meter rather than showing `Store 0/0` about a pool
that does not exist, and the goals panel shows one instruction instead of two and
says what the founder is carrying. The people-and-Vibes pill beside them stays
up throughout — `1/1` is a true thing to say about a kingdom of one, and it is
the pill that answers "when does anybody else turn up". During founding the placement bar *is* the instruction, so
the objective is hidden while it is up (`has-hint`) rather than saying the same
thing twice — which is what went wrong at 844×390, where neither the old 600 nor
the 820 pixel breakpoint fired and both were on screen at once.

**Beds are automatic until the player says otherwise.** `assignHome()` puts
somebody in the nearest free bed, and a finished house collects anyone still
sleeping out at the commons — which is what its 400-tile distance penalty in
`assignHome` is for: nobody chooses a bedroll by the fire over a roof, but it is
always there when there is no roof going. Nothing gives a villager a *preference*
for sleeping outdoors, and the outdoorsy trait deliberately does not; if that is
ever wanted it is a new trait, designed on purpose. `setHome()` is the player's
version — including pinning somebody at the commons — and sets
`homeFixed`, which both of those then leave alone — without that flag the next
cabin would quietly undo whatever arrangement was just made. The flag clears
if the house is demolished, or through "let them settle wherever".

**Beds are the population cap, and there is no other one.** `housingCapacity`
is the whole of it — two beds at the commons at every level, two, four or six in
a Cabin — and `bedsFree` is what `updatePopulation` asks. There is no hidden
hundred behind it any more. Housing under improvement keeps the beds it already
had (`isOperational`), and the new ones land when the work does. If housing is
taken down out from under people **nobody leaves**: the kingdom simply reads
8/6 and no one else arrives until it does not.

**An arrival is a promise, not a roll.** With a bed free somebody always turns
up, inside a window set by how many people are already here — six to nine
game-minutes for the second villager, out to fifty to seventy-five past sixteen
(`ARRIVAL_WINDOWS`). The old model rolled a chance every gap and could say no
twice running with nothing on screen to explain the silence; that is gone and
must not come back. What varies is *where in the window*: Vibes slide it from
the slow end to the fast end, and `arrival.jitter` — one hidden number per
arrival, saved with the kingdom — shifts it a tenth of the window either way, so
two identical kingdoms do not fill up in lockstep and a hundred Vibes is never
exactly the minimum.

Three properties of `updatePopulation` are load-bearing and easy to break by
tidying. Progress is a **count-up in `g.arrival.progress`, and the target is
recomputed from the current Vibes every tick** — storing a duration instead
would mean a flowerbed planted mid-journey did nothing until the *next*
traveller. A full kingdom **freezes** that progress rather than clearing it, so
finishing a cabin ten minutes into a wait does not throw ten minutes away. And
nothing about the arrival resets when beds are added: only an actual arrival
does that. The interface is shown a *range* (`arrivalEta`) and never a
countdown, and never the jitter.

**Nobody walks in on a kingdom that does not exist yet.** `updatePopulation`
returns before it touches anything while founding runs, so the first companion
sets off when the Base Camp's second bed exists and not from a clock that was
already running. During founding the top bar reads `1/1` rather than `1/0`.

**Vibes are how nice the place is, out of a hundred, and they do exactly one
thing.** `sim/vibes.ts` is the only place that reckons them, out of three parts:

| source | max | what moves it |
|---|---:|---|
| Decorations | 60 | one of every comfort, at its own flat limit |
| Food security | 30 | loaves per villager, a ramp through `FOOD_VIBES` |
| Resident wellbeing | 10 | whether anybody is past `SEVERE_HUNGER` |

The one thing they do is decide where in its window the next arrival lands.
They are not a currency, they gate nothing, and no building's output depends on
them. **Employment must never touch them**: an open job slot, a closed
workplace and a kingdom of helpers all score the same, because being quietly
marked down for not filling a post is the sort of hidden pressure this game does
not do.

Before the kingdom has ever baked (`stats.baked === 0`) food sits at a neutral
15 and wellbeing at its full 10. That is not a rounding-off — it is the rule
that the player is never marked down for a system they have not been handed yet,
and the same rule any future source of Vibes has to follow.

**Decorations are limited, and the limits are the design.** `maxTotal` on a
`BuildingDef` is a flat ceiling the commons has no say in: Well 1, Bench 2,
Lantern 8, Flower Bed 4, Standing Stone 1 — sixteen objects, and one of
everything comes to exactly sixty. Decorating is therefore a set of decisions
about *which*, made once, rather than a slider you drag until the meter fills.
Adding a new comfort means taking Vibes off something else, not raising the
total; `simcheck` fails a run whose decorations are worth more than sixty.

**Buildings grow rather than being replaced.** There is one house — the **Cabin**,
2 / 4 / 6 beds — and one heart — the **Commons**, named Base Camp, Settled Camp,
Village Commons and Kingdom Commons by `levelNames`. A `levelNames` def means the
panel, the toasts, the journal and every "sleeps at the…" line must use
`buildingName(def, level)` rather than `def.name`; `def.name` is only right in the
build menu, which is always offering a level-1 one. Both change silhouette per
level too, because a store that holds ten times as much and looks identical is a
change you cannot see. Costs that a multiplier cannot express — a cabin starts as
20 wood and later wants stone — go in `upgradeCosts`, an explicit per-step table;
otherwise `upgradeCostMul` compounds with level.

**The commons is the kingdom's spine, and the only building with a gate on it.**
`upgradeReqs` on a `BuildingDef` is a per-step list of `{ label, met(g) }` —
things the kingdom must have *done*, not have in store — and `canUpgrade` refuses
until every one is met. `COMMONS_REQS` in `defs.ts` holds them, and each level
hands over a tier of the build menu through `unlockCommonsTier` in `goals.ts`,
called from `completeConstruction`:

| level | asks for | opens | cabins / storehouses |
|---|---|---|---|
| 1 Base Camp | the founding | Cabin, Storehouse, Lodge, Quarry | 1 / 1 |
| 2 Settled Camp | a cabin, a quarry, three people | Well | 2 / 2 |
| 3 Village Commons | bread of your own, six people, somebody in a trade | Standing Stone | 3 / 3 |
| 4 Kingdom Commons | *a way of building nobody knows yet* | — | 4 / 4 |

The Base Camp hands over all four foundations at once, on purpose: the first
hour is about deciding where those four go, and a kingdom that can fell trees
but not break stone is one waiting on permission rather than on itself. What the
later levels give is mostly *room* — one more cabin and one more storehouse each
— which is a reward you can act on rather than a new menu entry.

The mine's ladder follows the same two rules, and the second one is why the
Deep Mine asks for a forge rather than the Iron Mine doing so: the Iron Mine is
what opens the forge.

Two rules that are easy to break. **No level may require something it is itself
responsible for unlocking** — that is why bread gates the Village Commons rather
than the Settled Camp, and why the food chain (Farm, Windmill, Bakery) is
unlocked by *goals* instead. The Settled Camp asking for a quarry is fine
precisely because the Base Camp is what opened the quarry. And **every cost must
fit inside the storage the previous level left behind, and under what
`gatherTarget` will actually fetch**: a cost above that line is one nobody can
ever pay. The requirements are written to be things that cannot un-happen,
because a kingdom is never told it has gone backwards.

**Every step of every building shows its whole price before you commit.**
`improveSection` in `ui/modals.ts` draws it as one checklist and draws it
*always* — materials with what is free in store against what is wanted,
accomplishments ticked off one at a time, what the step hands back, and a plain
sentence naming everything still outstanding. Not only when the button is live:
a disabled button is not an explanation, and the thing a player needs to read is
what they are waiting for, which is by definition something they cannot do yet.
A requirement nothing can currently satisfy is shown in the same row shape as
one that is met, which is how the Kingdom Commons reads as a horizon rather than
as something broken.

**Level 4 is deliberately out of reach.** Its requirement is `met: () => false`
with a label saying so, and the panel shows it greyed rather than hiding it. The
Village Commons is the end of the current arc; turning the last step on later is
a one-line change to that predicate.

**Improving a building never takes it out of service** (`isOperational`). Storage,
housing and `nearestStore` all count a building that is mid-upgrade, at its
current level. Without that, improving the kingdom's only store drops capacity to
zero, which leaves nobody able to fetch materials for the work under way — a
deadlock the headless run hit on the first attempt. The commons makes this
load-bearing rather than theoretical: it is the only store a young kingdom has.

**The commons earns nothing, and that is most of its job.** It is in
`LEISURE_BUILDINGS`, and unlike the other spots there people stay half again as
long and are twice as likely to say something (`maybeSay`'s chance is a
parameter for exactly this). Newcomers walk to it before they do anything else —
`planArrivalWelcome`, called from `arrive()` — rather than starting wherever the
planner would have sent them. None of this pays anything, and none of it should
start to: celebrations, announcements and memorials all belong here later, and
they belong here as behaviour rather than as a bonus.

**Stone comes from a quarry, and from nowhere else at all.** This is the
kingdom's second real decision and the spine of the early game:

> **wood → Quarry → stone → the commons grows**

Nothing else may ever produce stone. Not a helper with bare hands, not a goal
reward, not starting stock, and not clearing a boulder to build on — `place()`
and `relocate()` both check `hasQuarry()` before a cleared boulder gives anything
back, so building on top of the rock is not a way round the rule. The Quarry's
own cost is therefore **wood only, and must stay that way**: a quarry that cost
stone could never be built. For the same reason no requirement or cost that
comes before the quarry may ask for stone. `simcheck` fails the run if a kingdom
with no quarry has any stone at all, which is the cheapest way to catch a new
source being added by accident.

**The mine works the ground it stands on, not the boulders lying on it.** There
are no nodes involved and nothing to walk out to: `needsRock` on the def makes
`footprintProblem` refuse any spot that is not on or against rocky terrain, and
after that the seam is endless. What the site decides is only how *fast* —
`rockInRange` counts the rocky tiles inside `rangeOf`, and `richnessMul` turns
that into a multiplier between `RICH_MIN` and 1. Thin rock means slow, never
idle, and the placement bar says so in those words: telling somebody their mine
would stand idle would be a lie about the one building that never stops.

That is what lets surface rock be **finite**. Boulders never come back —
`updateTerrain` regrows stumps and nothing else, `sweepDepletedNodes` has no
boulder branch, and the only thing that ever removes one is building over it,
which is meant to be permanent. Do not reintroduce boulder regrowth or a
`BOULDER_REGROW`; the finite half of the kingdom's stone is scenery, and the
endless half is a building somebody had to site properly.

**The mine is a ladder, and it is the game's second one.** Quarry → Iron Mine →
Deep Mine → Mithril Mine, through `levelNames` and `MINE_REQS` in `defs.ts`,
with `unlockMineTier` in `goals.ts` handing over the Forge when it reaches an
Iron Mine — exactly as `unlockCommonsTier` hands over its own tier. `extracts`
lists what each level brings up and it **never shrinks**: a Deep Mine still cuts
stone, so no improvement ever asks the kingdom to give something up. The last
step is `met: () => false` with `impossible: true`, and that flag is what stops
the panel describing mithril as something to work towards.

**One trade works the whole mine.** `miner` covers stone, ore and coal alike;
improving the building never reassigns anybody, and there are no tools, no
pickaxes, no durability and no per-material workers. If that ever seems wanted,
it is not: the whole point of the building is that it is one place with one job
at it.

**Buildings come in four kinds, and the kind is a `BuildingDef` flag.**

- **The commons** — `once`, never in the menu, never removable, never movable.
  It stands where the kingdom began.
- **`unique: true`** — Lodge, Quarry, Farm, Windmill, Bakery, Forge. One at a
  time.
  They grow through improvement rather than duplication, and rather than
  building a second you **move** the one you have.
- **`maxCount: [...]`** — Cabin and Storehouse, indexed by the commons' level.
  Not unique, not unlimited; the count is one of the things the commons hands
  over as it grows.
- **`maxTotal: n`** — the comforts. A flat ceiling nothing raises, because those
  counts are what hold the decoration half of Vibes to sixty. Nothing is freely
  repeatable any more.

`buildLimit()` in `goals.ts` is the one place that answers "how many, out of how
many". The build menu shows the tally on **every** limited kind whether or not
the kingdom is at the ceiling, and a kind that is full stays in the list, greyed,
rather than vanishing: a row that quietly disappears teaches nothing, and the
limit is exactly the thing the player has to plan around. Being at the limit is
deliberately not part of `availableToBuild` — `Game.placeProblem` is what
refuses, and it says what to do instead.

**Moving a building never takes it out of service.** `relocate()` puts an
ordinary construction site on the new ground carrying `relocOf`, and marks the
original `movingTo`. Helpers then supply and build that site exactly as they
would any other — no planner needed a word changing, because `siteCost` and
`labourNeeded` simply have a third case. The original goes on working the whole
time, and only steps across in `finishRelocation` when the site is done.

That ordering is the entire point of the feature. Anything that tore the
building down first would lose the kingdom its only quarry halfway through
moving the quarry, drop storage below what is already stored, or turf workers
out of a workplace that does not exist yet.

**The record that survives a move is the original, moved.** `finishRelocation`
changes `b.x/b.y` and deletes the site; the id never changes, so every
`workplace`, every `home`, every claim and every line of history keeps pointing
at the right thing without being found and rewritten. Level, name, buffers and
the day it was built come along because they were never anywhere else. Farms are
the one thing that does not survive: fresh ground means fresh plots, and the
farm's own copy says to harvest first. Costs a full set of materials and the
full labour — it is not a discount, it is a way of keeping a building rather
than replacing it.

**Both ends of a move tidy each other up.** `removeBuilding` on the original
abandons the site; on the site it clears the original's `movingTo` and leaves it
where it was. `canUpgrade` refuses while a move is under way. Both ends are
saved, so closing the tab halfway through does not quietly put the building
back. `relocheck` exists because none of this is visible in a screenshot.

**A working range is shown before it is committed to, and it is the range the
workers keep.** `range` on a `BuildingDef` (per level) is read by `rangeOf`, and
that one number feeds the planner, the count in the building's own panel, and
the ring drawn on the map while it is being placed or moved. `findNode` now
tests the distance rather than only bounding the scan — it used to search a
*square*, which made "thirteen tiles" eighteen at the corners. That was
invisible while nothing drew the range and is a lie the moment something does.

The overlay is worth knowing about: a circle in tile space is exactly an
axis-aligned **ellipse** on screen — substitute the isometric projection into
the circle and you get `(sx/HALF_W)² + (sy/HALF_H)² ≤ 2r²` — so `drawWorkRange`
paints it column by column instead of filling five hundred separate diamonds
every frame. Every live node inside gets a mark of its own, and the placement
hint says the count out loud, because at the usual zoom the ring's edge is off
the side of the screen and the number is the part that always fits.

**Claims prevent collisions.** `claim()` / `releaseClaim()` reserve a tree, a
farm plot, or a task so two villagers do not walk to the same one. Always release
through `releaseClaim` — it also clears the tile/plot flags. Plot claims are
keyed `farmId * 100 + slot`.

**Gluts, not jams.** `glutOf()` makes specialists stop when their own resource
exceeds 35% of storage capacity. Without it, woodcutters fill the barn and the
food chain starves. This is the mechanism that makes "the kingdom stalls but
never collapses" actually true.

It applies to **workshops as well as gatherers**, and that was missing for a
long time without showing: a mill with wheat coming in and no bakery built yet
ground every last sheaf into flour, filled the store with it, and left the
miners who would have cut the stone the bakery was waiting on with nowhere to
put anything down. `chooseRecipe` checks the glut before a workshop starts
anything, and `planHelper`'s restock step goes through the same function, so it
will not carry wheat to a mill that has stopped or coal to a forge that has. Clearing the output shelf is deliberately *not* gated —
a workshop that has already made the stuff still gets it carried off.

Hand-gathering has the same idea in `gatherTarget()`: the flat target (120 wood)
is additionally capped at half of what the kingdom can actually hold. With a
storehouse up this never binds. It exists for the Base Camp, which holds sixty:
without it helpers cheerfully fill that and leave the kingdom unable to afford
the improvement that would fix it — a stall with no way out, which is worse than
a slow kingdom. It is also the ceiling every commons upgrade cost has to sit
under. This is the same trap `DESIGN.md`-style per-resource shelf limits keep
falling into, and the reason any future version of them has to clear the early
costs.

**Wood is the only thing hands alone can fetch.** `GATHER_TARGET` and
`NODE_WORK` list trees and nothing else, so there is no path through
`planGatherNode` that produces stone and no way for a helper to find one.
See "Stone comes from a quarry" below.

**A workshop may know several recipes, and the forge does.** `recipesOf` answers
for both shapes — `recipe` for the buildings with one, `recipes` for the forge —
and everything downstream reads inputs as a *set* rather than as
`Object.keys(inputs)[0]`, because Steel is one iron bar and two coal and a panel
that shows one of those is how somebody concludes their forge is broken. A
`batch` step carries the output it is paying for, since by the time it lands the
building may be minded to do something else. A recipe with `locked: true` — the
mithril one — is shown greyed and never run.

**Balanced is not "equal piles".** `chooseExtraction` and `chooseRecipe` both
pick whatever the kingdom is furthest below wanting, measured against
`BALANCE_TARGET` rather than against each other, because a kingdom wants far
more stone than it does ore. A focus is a *preference*: if the favoured material
is glutted the building quietly works on something else rather than stopping,
which is the same nothing-is-ever-punishing rule as everywhere else. `Focus`
lives on the `Building`, is saved, and `focusOptions` offers only what this
building at this level can actually produce.

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

**Founding's one placement arms itself.** `Game.syncFoundingTool()` puts the
campsite marker on the cursor while founding is at `choosing` and takes it off
the moment the ground is picked; `cancelTool()` deliberately re-arms it rather
than clearing it, and its hint has no Done button, because at that moment it is
the only thing the player can do. It is also the only placement in the game that
lets go of the tool afterwards — every other one stays armed, since laying out a
row of houses should not mean going back to the menu five times. The marker
shades all nine tiles rather than the one under the cursor, because the cursor is
the camp's centre and the footprint is the thing worth seeing.

**Speed lives in Settings → Viewing**, not on the map, along with `space` and
`1`/`2`/`3`. **Removing a building lives at the foot of the build panel**, not in
the top bar; a building's own panel has Improve, Move, Show me and Remove in its
footer. Both were moved out of the way deliberately — do not put them back on
the map chrome.

**Moving is offered on a building's own panel and nowhere else.** There is no
"move" mode in the build list, because moving is something you do to a
*particular* quarry — one with a level, a name and two people working at it —
rather than a mode you enter and then go looking for a target. The tool it arms
carries the building's id for the same reason, and it lets go of itself the
moment the ground is chosen: unlike laying out a row of houses there is exactly
one of these to place.

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
never off a number that was true of one screen. The objective chip was still
positioned off a hard-coded 48 and went straight through the resources the day
the top bar grew a fourth pill; both of its rules read `--top-h` now.

**Below 560 pixels the resource chips take a row of their own**, under the two
pills that are each a single number — people-and-Vibes, and the store. Three
pills and a clock do not fit across a phone held upright, and the strip is the
only one of them that can shrink, so it was squeezed to nothing while the store
pill ran on underneath the clock. Sideways there is width for all of it and
vertical space is what is short, so that rule is by width rather than by
`.compact`.

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
  `terrain.ts` — trees, boulders, the trees the founder can reach — is
  followed by a deterministic fill
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
uses it), and `coin` has no sink beyond a single goal reward. **Iron and steel
bars have no sink either** — the chain is the content for now, exactly as the
coin is. Mithril is a step further out: the resources, the Mithril Mine and the
forge's mithril recipe are all written down and none of them is reachable, and
`simcheck` fails the run if any mithril ever exists.

---

## Deliberately removed

**Deadfall is gone, and is not coming back.** There used to be six piles of
fallen branches near the middle of every island — free wood, no axe needed —
and the opening was two of them. The prop, its sprite, its scatter and its
guarantees are all deleted: the founder now fells an ordinary tree, which
depletes, leaves a stump and grows back like every other tree. Do not reintroduce
a special opening-only resource; if the first minute needs to be gentler, tune
the chop, not the world.

**Hand-mining is gone, and is not coming back.** Helpers and the founder used to
break boulders for stone the way they fell trees for wood. They cannot any more:
stone is the Quarry's alone, and the whole early game is shaped by that one
dependency. `NODE_WORK` lists trees and nothing else, so there is no code path
left to reintroduce it by accident. If the run-up to a quarry ever needs to be
gentler, tune the quarry — its cost, its reach, how fast a miner swings — not
the rule.

**Boulders as a renewable resource are gone, and are not coming back.** They
used to be the quarry's nodes and to regrow from rubble on a timer. Now nothing
harvests one, nothing regrows one, and the mine takes its material from the rock
underneath instead. Surface rock being finite is what gives the early kingdom a
clock; the mine's seam being endless is what stops that clock ever becoming a
dead end. Reintroducing regrowth would quietly undo both.

**Separate workers per material are gone before they arrived, and so are
tools.** One `miner` works whatever the mine has reached, one `smith` works
whatever the forge is set to. No pickaxes, no hatchets, no inventories, no
durability, no replacing anything. If a material ever needs to feel harder to
get, that is a number on the building, not a new class of person or a thing to
carry.

**A second Lodge, Quarry, Farm, Windmill, Bakery or Forge is gone, and is not
coming back.** These are institutions rather than production units. If one is in a bad
spot the answer is to move it, which keeps its level, its name, its workers and
its history; a duplicate would weaken all of that and quietly become the
optimal strategy besides. Adding a new principal production building means
`unique: true` on it, not a count.

**The Sapling is gone from the build menu, and the chance roll on arrivals is
gone with it.** The sapling was the one comfort that did nothing whatever — not
a tree anybody could fell, and worth no Vibes — so once comforts were counted it
was a row that only ever wasted the wood. Its def stays, at `order: -1`, purely
so that kingdoms with saplings already planted still open; they stand where they
were put and are worth nothing. Do not add a replacement decoration: the sixteen
that exist add up to sixty on purpose, and a seventeenth would have to take
Vibes off one of them.

The arrival roll went the same way. There is no `chance` anywhere in
`population.ts` any more, and reintroducing one — as a failure case, a "quiet
season", anything — undoes the whole point of the window.

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
24 a year · **population is capped by beds and by nothing else** — 2 at the
commons plus 2 / 4 / 6 a Cabin, so 20 at a Village Commons and 26 at a Kingdom
Commons · with a bed free somebody always arrives, in 6–9 game-minutes at one
villager, 18–26 at two or three, 25–35 to seven, 35–50 to fifteen and 50–75
after that, Vibes deciding where in the window · Vibes are 60 decorations + 30
food + 10 wellbeing, and the sixteen comforts a kingdom may keep come to exactly
60 · Master rank is ~10–15 real hours of dedicated work in one trade · storage is a
single shared pool fed by storage buildings: nothing at all until the Base Camp
is finished, then 60 / 200 / 450 / 800 as the commons grows, and +250 per
storehouse · housing is Cabins (2 / 4 / 6 beds) plus the commons' two beds
outdoors, which never increase · the kingdom keeps as many Cabins and
Storehouses as the commons has levels, 1 each at Base Camp up to 4 each at
Kingdom Commons, and exactly one of each principal production building · a lodge
or quarry reaches 13 tiles, and the mine's seam 13 / 15 / 17 / 19 as it is sunk
deeper · a mine works at full pace on 70 rocky tiles inside that reach and at
0.55× on none, never at nothing · the forge is 1 ore → 1 iron bar with no coal
at all, and 1 iron bar + 2 coal → 1 steel bar · founding itself is about a minute
and a half at 1×, twenty seconds of it the walk up the beach and twenty the tree
· a generated island carries at least 55 trees and 26 boulders within 14 tiles of
the middle, a choice of at least 6 legal campsites, at least 4 trees within 9
tiles of where the kingdom begins — the nearest about 3 — and at least 3 places a
quarry could legally stand with 25 tiles of rock inside its reach (in practice
fifty or more such sites, the best of them reaching 127 to 187 tiles of rock).

Per-resource shelf limits — one good never taking more than a share of the
store — have been discussed and deliberately deferred. Any such limit has to
clear the early costs (a Storehouse is 25 wood against an opening capacity of
50) or it recreates the deadlock it was meant to prevent. `gatherTarget()` is
the nearest thing to one that survived, and only because it caps *fetching*
rather than storing.
