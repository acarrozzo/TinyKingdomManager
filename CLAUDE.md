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

## Verifying changes — match the check to the change

There are five harnesses and a screenshot tool, and they exist because this
project has whole classes of bug that reading code will not catch. They are not
a checklist to run end to end every time: each one answers a particular kind of
question, and running the ones your change cannot possibly have affected costs
minutes and tells you nothing.

Scope the verification to what you actually touched:

| what changed | what to run |
|---|---|
| documentation or user-facing copy | nothing automated, unless the copy states a mechanic you also changed |
| ordinary TypeScript | `npm run typecheck` |
| anything under `src/sim/`, or `defs.ts` | typecheck, plus one simulation run of 600–1000 game-minutes |
| visuals, layout, or input | typecheck, plus a screenshot of the viewport(s) the change can affect |
| saving or loading | typecheck, plus the round-trip check on a dumped save |
| a broad refactor, or work you are calling finished | `npm run build`, plus whichever harnesses the change touches |

Three rules that keep this cheap:

- **`npm run build` already runs the typechecker.** Do not run `npm run
  typecheck` separately alongside it.
- **Do not run unrelated harnesses just in case.** A copy fix in `ui/modals.ts`
  does not need the world generator exercised over ten thousand seeds, and a
  palette tweak does not need a twenty-day kingdom simulated.
- **Batch verification after a coherent set of edits**, not after each one. Get
  the change into a state you would be willing to show somebody, then check it.

The sections below say what each harness catches, so you can tell whether your
change is in its territory.

### Simulation: `npm run sim`

```bash
npm run sim -- 600                    # 600 game-minutes (20 kingdom days)
npm run sim -- 600 4242               # …on a different island
TKM_DUMP=k.json npm run sim -- 600    # …and write the end state as a save file
npm run roundtrip -- k.json           # check a save survives serialisation
```

Runs the whole kingdom headless with no rendering, playing it roughly the way a
player would — placing buildings, staffing jobs, reacting to shortages,
decorating once the food is coming — then prints population against beds, the
Vibes broken into their three parts, the arrival window and what is on its way,
storage, every villager's experience, when each species was first noticed,
goals, journal, and consistency checks. The arrivals list at the end is the
quickest read on pacing: the gap between each line should sit inside the window
printed at the top.

**This is the check for changes under `sim/` or to `defs.ts`** — one run in the
600–1000 range is enough, and a second seed only when a number surprises you. It
is how the economy was balanced and it catches things that look fine in code:
production chains that silently never run, one resource crowding every other out
of storage, wildlife arriving far too fast, XP curves that take 40 hours.

It also asserts the things that must never be true whatever the balance: stone
in a kingdom with no quarry, fish with no fishing hut, cooked food with no
kitchen, ore before an Iron Mine, coal before a Deep Mine, bars with no forge,
any mithril at all, water rested past nought or one, and rubble counting down to
become a boulder again. Those are the rules of the world rather than tuning, so
they fail the run rather than showing up in a number somebody has to notice.

One assertion is a *balance* rule rather than a world rule, and it is there
because the failure hides: a larder wildly out of proportion to the population
fails the run. A kingdom with four hundred loaves looks perfectly healthy in
every other line of the report.

It also prints **the day as lived**: the run sampled every five game-seconds and
broken down by which stretch of the day it was — asleep, working, walking,
eating, or about. That is the only place the routine is visible at all. A
schedule reads perfectly well as six constants and can still leave the midday
break unattended or put half the kingdom in bed through the afternoon, and none
of that shows up in a resource line. Expect ~90% asleep at night, nought asleep
during either work stretch, and the meals to appear in the break rows.

Three things about the harness are load-bearing and easy to undo by tidying. It
**staffs before it builds**, and never gates staffing on whether something is
under construction — it used to do both at the foot of one early return, so a
site the kingdom could not yet pay for froze the whole run: nobody could be put
on the mine, so no stone was cut, so the site stayed unpaid, for twenty days.
It **treats wood as payable over time and every other material as needing to be
in store**: since General Workers stop hand-felling at the reserve, a kingdom is
routinely short of a building's full wood cost, and a player in that position
places the building anyway and lets the site fill a dozen at a time. Requiring
the whole cost in the barn at once made the run stall at six people with nothing
to eat — a measurement of the harness rather than of the game. Waiting is still
right for everything else, because a site the kingdom genuinely cannot pay for
is the standstill this list was rewritten to avoid.
And it plays by the interface's own rules, including `needsRock` and
`nearWater`, so it can no more drop a quarry on a meadow than the player can,
nor a fishing hut in the middle of a field. It builds *both* branches of the
food chain, which is the only way the run exercises either of them honestly.

**`SOFT_CAP` is a model of how a player staffs, and it is delicate.** The lodge
sits second in `PRIORITY` now that wood is gated on a woodcutter, but capped at
*one*: two woodcutters ahead of anybody fishing left the run with a fat woodpile
and an empty larder, because the harness keeps a third of the kingdom free and
the first four pairs of hands were all raw materials. One woodcutter, then food,
is both what a player does and what produces a kingdom worth reading.

A run of ~600–1000 game-minutes is the useful range. Under ~300 you will not see
the kitchen come online, and under ~450 you will not see a forge; over ~1200 the
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
its reach — at least three a Fishing Hut could, a beach that connects to it on
foot, sane tiles, and the same seed giving the same world twice.

**This is the check for `world/terrain.ts`, and only for it.** Generation leans on random
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

The hut check is the same argument one step gentler. Fishing is optional, so an
island with poor water is not unplayable the way an island with no rock is —
what it *is* is an island where half of what the storehouse unlocked turns out
to be a row that cannot be used, and the player has no way of knowing that is
the island's fault. It asks for three sites with four good spots each, which
every seed in ten thousand clears comfortably (21–132 sites). It also reports
the size of the inland lake and how often one meets the sea and stops being a
lake at all — a bay is perfectly good fishing, but a generation change that
quietly turns half the islands into bays is one worth seeing.

### Moving buildings: `npm run reloccheck`

```bash
npm run reloccheck
```

Drives one relocation the whole way through on a real kingdom — start the move,
check the original is still working and still staffed, save and reload it
half-finished, then let villagers actually carry the materials and build it.

**This is the check for relocation, `completeConstruction` and
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

**This is the check for `population.ts`, `vibes.ts`, and anything that adds or
removes beds.** `simcheck` shows that people turn up and roughly how
fast; it cannot show the edges, and every one of those is invisible in the
source and on screen alike. A kingdom that loses its accumulated wait the moment
the beds fill, or hands the next traveller a fresh roll on every reload, looks
exactly like a kingdom that does not — for hours.

### Saves: `npm run roundtrip`

```bash
TKM_DUMP=k.json npm run sim -- 600    # a real kingdom to test against
npm run roundtrip -- k.json           # serialise → deserialise → serialise
```

Loads a save through the game's own code and writes it back out, reporting what
survived: villagers, buildings, tiles, blocked tiles, props, farm plots, the
discovery set and finished goals.

**This is the check for `save/save.ts` and for any new field on `GameState`, a
`Building` or a `Villager` that is meant to persist.** A field that is never
written is invisible until somebody reopens a kingdom and finds their focus
setting, their fixed homes or their wildlife cooldowns quietly back at the
defaults.

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

**When a change is visual, take the shot and look at it.** Every visual bug in
this build — roofs rendering as flat plates, an invisible element eating clicks
on half the toolbar, lit windows bleeding through the building in front — was
invisible in the source and obvious in a screenshot. One or two viewports that
could actually show the change are the whole of it; there is no standing set to
recapture, and a change with no visual surface needs none of them.

`PRELOAD` seeds a save and loads it through the game's own code path rather than
reloading the page, because a reload lets the throwaway kingdom's
autosave-on-unload clobber the seeded slot.

`DEVICE=<w>x<h>[@dpr]` emulates a phone or tablet with touch input. Reach for it
when the change touches layout or input: a 390px screen is where overlapping panels
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
    sky.ts            where the sun and moon are; sky bands; the shadow vector
    sprites.ts        procedural pixel art, baked to offscreen canvases
    actors.ts         villagers and animals, drawn per frame
    camera.ts         pan, integer zoom, follow
    renderer.ts       depth sorting, lighting, weather, labels
  audio/audio.ts      WebAudio synthesis (no files)
  save/save.ts        slots, RLE tile packing, export/import
  ui/ui.ts            the shell: what is open, where it goes, what a click means
  ui/context.ts       UIEnv (compact/short/touch), esc/el, activity labels
  ui/daystrip.ts      the day laid flat along the top edge, sun or moon on it
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
they are properly hungry, or merely hungry and on a break → the founding sequence
if one is running → job work if it is work hours → leisure. Everybody falls
through the **General Worker** ladder when their own work has nothing in it:
supply construction sites, then build them, then restock workshops, then clear
finished goods, then fell a tree — and that last one only below the reserve.

**The day has three breaks in it, and they are the shape of the kingdom.**
`SCHEDULE` in `defs.ts` owns the six boundaries — up at half five, out at seven,
an hour off at noon, finished at nine, bed at half eleven — and `isWorkTime`,
`isBreak` and `shouldSleep` are the whole of what reads them. Thirteen hours of
work, five of breaks, six of sleep. The point of the middle break is that the
place visibly collects itself three times a day rather than running flat from
waking to bed, and `planLeisure`'s `gathering` argument is what makes that true:
on a break the roll is bent toward the commons and the comforts.

**A trait moves the outer ends of somebody's day and never the middle.**
`dayShift` is trait plus a little of their own, applied to waking, the morning
start, the evening finish and bedtime alike — so an early riser is out on the
job while the rest are still at breakfast, an owl is still at it after they have
gone in, and *both ends move together* so everyone still sleeps six hours and
energy needs no special case. The midday hour is deliberately exempt: it is only
an hour long, and a shifted one would leave the risers and the owls sharing none
of it. Do not give a trait its own work *length*; that is how the old schedule
had night owls working an hour later than everybody for nothing.

**Ordinary hunger waits for a break; severe hunger does not.** Eating used to
interrupt whatever was happening the moment somebody passed 0.7. Now that there
is a break along shortly whatever the hour, only `SEVERE_HUNGER` cuts into work.

**Having nothing to do earns a meal, once a day.** A villager is *underemployed*
only when the planner, during work hours, finds them no specialty work and no
General Worker task — `think()` marks `underworkedDay` at exactly that point, so
breaks, sleep, the walk between two jobs and the moment spent deciding are all
somebody perfectly well occupied. They then take one extra meal at a break, and
`extraMealDay` is set by the `eat` effect rather than when the plan is made, so
a plan dropped halfway does not cost them their one chance. Both fields are
saved. This is the food sink that keeps a finished kingdom's larder worth
filling — a kitchen with nothing left to feed is a building the player stops
looking at — and the one-a-day cap is what stops it becoming a drain.

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

**A cabin takes its sleepers in; the commons does not.** `sheltered` on a
`BuildingDef` says the beds are under a roof, and `sleepingIndoors(g, v)` in
`state.ts` is the one place that answers "is this person inside" — asleep, at a
finished home, and that home `sheltered`. The renderer leaves anybody it answers
for out of the world entirely: no figure, no shadow, no name, no badge. Nothing
in the sim moves, so "Here now" still counts them and the roster still says
where they sleep; they walk to the door exactly as before and stop being drawn
when they get there.

Two halves of that are deliberate. The commons is **not** `sheltered`, because
its two beds are bedrolls by the fire and a young kingdom whose only night-time
inhabitants vanished would look abandoned rather than asleep. And going indoors
is a *rendering* fact rather than a position: putting somebody on a tile under a
solid building would mean pathing out of a blocked tile in the morning, for a
picture the hover fade already gives.

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

**Somebody who has just walked in is marked until they have been looked at.**
`met` on a `Villager` is false from `makeVillager` and set by `Game.meet` — the
only thing that clears it is that person's card being opened, from the map or
from the roster, and nothing about time passing does. It is saved, and an older
kingdom opens with everybody met (`met: v.met ?? true`), because a settled
village greeting its own twenty residents as strangers is a worse failure than
missing one real newcomer.

It says the same thing in three places at once and they clear together: a star
beside them on the map, a `new` tag on their row in People, and a count on the
People button (`NavState.newcomers`). The founder is the one exception, set met
in `newGame` — the opening is three minutes of watching that one person, and a
mark saying somebody new has turned up would be telling the player what they are
already doing. It is a mark and never a toast or a modal: a kingdom that
interrupts you to introduce someone is a kingdom you stop leaving running.

**Vibes are how nice the place is, out of a hundred, and they do exactly one
thing.** `sim/vibes.ts` is the only place that reckons them, out of three parts:

| source | max | what moves it |
|---|---:|---|
| Decorations | 60 | one of every comfort, at its own flat limit |
| Food security | 30 | **meals** per villager — bread and cooked fish together, a ramp through `FOOD_VIBES` |
| Resident wellbeing | 10 | whether anybody is past `SEVERE_HUNGER` |

The one thing they do is decide where in its window the next arrival lands.
They are not a currency, they gate nothing, and no building's output depends on
them. **Employment must never touch them**: an open job slot, a closed
workplace and a kingdom of General Workers all score the same, because being quietly
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
| 3 Village Commons | food cooked in a kitchen of your own, six people, somebody in a trade | Standing Stone | 3 / 3 |
| 4 Kingdom Commons | *a way of building nobody knows yet* | — | 4 / 4 |

The food chain is not on that table, because it hangs off **goals** instead —
40 stone opens the Windmill, a Storehouse opens the Wheat Farm *and* the Fishing
Hut together, and the first flour or the first fish opens the Kitchen. That is
the same rule as everywhere else: no level may require something it is itself
responsible for unlocking, and the Village Commons asks for a cooked meal.

The Base Camp hands over all four foundations at once, on purpose: the first
hour is about deciding where those four go, and a kingdom that can fell trees
but not break stone is one waiting on permission rather than on itself. What the
later levels give is mostly *room* — one more cabin and one more storehouse each
— which is a reward you can act on rather than a new menu entry.

The mine's ladder follows the same two rules, and the second one is why the
Deep Mine asks for a forge rather than the Iron Mine doing so: the Iron Mine is
what opens the forge.

Two rules that are easy to break. **No level may require something it is itself
responsible for unlocking** — that is why cooked food gates the Village Commons
rather than the Settled Camp, and why the food chain (Farm, Fishing Hut,
Windmill, Kitchen) is unlocked by *goals* instead. The Settled Camp asking for a quarry is fine
precisely because the Base Camp is what opened the quarry. And **every cost must
fit inside the storage the previous level left behind**: a cost above that line
is one nobody can ever pay. Hand-gathering no longer sets a second ceiling — the
wood reserve caps fetching rather than spending, so a cost above it is slow
rather than impossible — but storage still does. The requirements are written to be things that cannot un-happen,
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

Nothing else may ever produce stone. Not a General Worker with bare hands, not a goal
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

**There are two ways to feed a kingdom and neither is the real one.** The
storehouse hands over the **Wheat Farm** and the **Fishing Hut** together, and
the **Kitchen** opens on the first thing worth cooking out of either — one
flour, or one fish. So a kingdom that never sows and a kingdom that never casts
arrive at the same building by different roads, and nothing downstream asks
which road it was:

> **wheat → flour → bread** ↘ **Kitchen** ↙ **water → fish → cooked fish**

A loaf and a cooked fish fill somebody up identically, are worth identically
much to Vibes, and count identically toward `stats.cooked`, which is what the
Village Commons asks for. Villagers have a `favoriteFood` and it is personality
and nothing else: `mealFor` reaches for theirs if it is in store and takes the
other quite happily if it is not. **Do not let a preference become a
requirement** — no building's output, no Vibe and no arrival may ever read it.

The two branches differ in *shape* rather than in quality. Fishing is one cheap
building (25 wood, no stone) and one pair of hands, so it feeds a young kingdom
long before a farm could; it is capped at two fishers and limited by water that
needs to rest, so it does not scale. Bread is three buildings and four or five
people and arrives much later; then it keeps up with any population. In a
700-minute run the kingdom lives almost entirely on fish through day 14 and the
two are level by day 24, which is the intended shape.

**The hut works the water it can reach, and the water is never used up.**
`fishes` on the def is the counterpart of `needsRock`: `nearWater` refuses any
spot more than `WATER_NEAR` tiles from anything wet, and after that `rangeOf`
decides how much water is in play. There are no nodes. `fishQuality` scores each
wet tile out of one from three things — cover (reeds and lily pads), how far the
shore turns back on itself, and whether the drop-off is here — and `t.fish` is
how *rested* that tile is, dropping by `FISH_TIRE` per cast and recovering in
`updateTerrain` alongside the tree stumps. `spotYield` multiplies the two, with
`FISH_FLOOR` under it, so a spot fished flat is slow and a hut on thin water is
slow, and **neither is ever idle** — the same promise the mine makes about thin
rock, and the placement bar says it in those words.

Both halves of that are load-bearing. Water that could be exhausted would make
the lake a finite resource somebody has to ration, which is the sort of pressure
this game does not do; and quality that did not vary would make where the hut
goes a non-decision. Reeds and lily pads are what carry it, which is why they
are scattered at roughly a quarter density along the open coast: without that
rule the sea scored exactly as well as the lake over two hundred islands and
nine tenths of all water counted as a good spot, so the ring's marks were a
wash and the lake was not the better fishing the brief asked for. It now runs
about 70% good on the lake against 9% on the coast.

**Fishing is not hunting, and the two systems never touch.** No fisher catches
an animal, no animal is consumed, and `fishQuality` reads reeds and lily pads
because of what reeds and lily pads *are* rather than through the habitat model.
Ducks like the same water for the same reason and that is the whole of the
connection. Do not wire the wildlife survey into the catch.

**Buildings come in four kinds, and the kind is a `BuildingDef` flag.**

- **The commons** — `once`, never in the menu, never removable, never movable.
  It stands where the kingdom began.
- **`unique: true`** — Lodge, Quarry, Farm, Fishing Hut, Windmill, Kitchen,
  Forge. One at a
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
original `movingTo`. General Workers then supply and build that site exactly as they
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

**Food is glutted against the people who eat it, not against the barn**, and
that is a different question. `FOOD_CHAIN_VALUE` in `defs.ts` says what each
link is worth on a plate — a wheat is a meal, a flour is one and a half, a fish
is one — and `foodComfort` is what the kingdom is content to hold: five meals a
head plus a small pantry. Two rules come out of that, and they must stay
separate:

- **cooked food** (`PREPARED_FOODS`) is judged on `preparedFood(g)` alone;
- **ingredients** are judged on `foodPotential(g)` against `foodComfort ×
  FOOD_CHAIN_HEADROOM`, so the farmers, the millers and the fishers all ease off
  together and the cooks stopping does not just move the pile upstream.

Crossing those two wires is a real bug and it has been made once: measuring the
*cooks* against the whole pipeline stops them for having too much to cook, which
is the one job that would have fixed it. Seed 12345 came out of a twenty-three
day run with seventy raw fish, eighty wheat, no supper at all and nineteen
people hungry in front of it. `simcheck` now fails a run whose larder is wildly
out of proportion to its population, in either direction.

It applies to **workshops as well as gatherers**, and that was missing for a
long time without showing: a mill with wheat coming in and no kitchen built yet
ground every last sheaf into flour, filled the store with it, and left the
miners who would have cut the stone the kitchen was waiting on with nowhere to
put anything down. `chooseRecipe` checks the glut before a workshop starts
anything, and `planGeneralWork`'s restock step goes through the same function, so
it will not carry wheat to a mill that has stopped or coal to a forge that has. Clearing the output shelf is deliberately *not* gated —
a workshop that has already made the stuff still gets it carried off.

**Hand-felling is an emergency float, not a supply.** `WOOD_RESERVE` is 32, and
it is the whole of what a General Worker will fetch by hand — below it they fell
a tree, above it they do not, whatever the kingdom is saving for. They also swing
at **half a woodcutter's pace** (`HAND_FELL_MUL`), so replacing them with a lodge
is worth doing rather than a rounding error. That gives the woodcutter the one
thing they lacked, which is a reason to exist: wood is the cost every building
shares, and the lodge is the only way to have it faster than a trickle.

It is emphatically **not a gate**, and the difference matters. The reserve caps
*fetching*, never storing or spending: a site takes its materials a dozen at a
time and the store is topped back up between loads, so a ninety-wood commons is
paid for in seven trips rather than not at all. A kingdom that never staffs a
lodge still grows — measured, with the lodge taken out of the harness's staffing
list entirely: on seed 12345 it reaches ten people in twenty-three days, fed,
housed and at 90 Vibes, against twenty with one woodcutter on the job. Slower,
never stuck, and nothing anywhere *requires* the building. Do not turn this into a
requirement, and do not raise the reserve to make hand-felling viable again;
both undo the point.

**Wood is the only thing hands alone can fetch.** `NODE_WORK` lists trees and
nothing else, so there is no path through `planGatherNode` that produces stone
and no way for a General Worker to find one.
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

**The sea is the map's own water, tiled for ever.** Everything outside the
island's diamond is `bakeOcean` — one 512×256 patch of `water` tiles filled as a
repeating pattern aligned to *world* coordinates, so the map's outer ring of
water carries straight on into it and there is no boundary left to see. It is
seamless because the isometric lattice has a rectangular period: tile centres
sit at world `(16u, 8v)` for integers of the same parity, so any multiple of
32 by 16 repeats exactly, and a diamond overhanging one edge is drawn again on
the opposite one. It used to be a single flat `fillRect` in a colour of its own,
which is what made the island read as a shape cut out of a slab — worst at
night, when the two were furthest apart. Do not put a colour of its own back.

**The haze is drawn after the world, not before it, and it is the only depth
cue there is.** In this projection screen-y *is* distance, so a fade down from
the horizon is the whole of atmospheric perspective — there is nothing to fade
at the sides or the bottom, because that water is near. `drawHaze` runs after
`drawWorld` and before `drawPlacement`: after, because the island's own
northern tiles are water like the sea around them and hazing one and not the
other draws the map's boundary straight back in as a dark wedge above the
beach; before the tools, because what is being placed has to stay readable at
the rim. It starts ten pixels *above* the horizon, since the northernmost tile
straddles world y 0 and its top half is drawn against the sky. The lighting
pass keeps its own shorter `LIGHT_FADE` — stretching that to match would leave
a lit band lying across the sea at midnight.

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

**Fish breaking the surface live on `GameState` and are never saved.**
`g.splashes` is a short transient list — the sim pushes to it because the sim is
what knows a fish was landed, the renderer walks it inside the *sorted* pass so
a ring on the far side of the lake goes behind the reeds in front of it, and
`updateSplashes` expires them whether or not anything is watching, so the
headless run behaves. A jump accompanies a catch **45% of the time and not
always**: one every time makes it a progress bar for the catch rather than
something that happens in a lake, and the ones that come to nothing are what
stop the player reading it as an indicator. Ambient jumps fire about once a
game-minute somewhere plausible.

`ripple()` walks the ellipse along **both** axes and puts the pixels through a
set. Even steps of *angle* bunch up at the ends of a 2:1 ellipse and spread out
along its sides, so a new ring three pixels across came out as five dots; and
because the rings are drawn at part alpha, a pixel plotted twice is visibly
brighter than its neighbours, which put a bead at each end of every ripple.

**Activity badges are the one exception to the sorted pass.** The little glyph
over each villager's head (`drawActivityIcon` in `actors.ts`, glyphs defined as
7×7 character rows) is collected during the world pass and drawn in
`drawBadges()` *after* lighting, so it stays readable in the dark — held back a
little by `darkness` so it does not become the brightest thing at night. It is
still pixel art in the world buffer, unlike the names and speech bubbles, which
are screen-space text drawn after upscaling.

**Two more marks go on after the lighting, and they are a different kind of
thing.** `drawAttention()` draws a workplace with nobody at it (`wantsWorker`,
the trade's own tool on a ringed plate) and somebody nobody has looked at yet
(`!v.met`, a star beside their head). Both are *asks* rather than descriptions,
so they stand down in clean view — `showMarks` on `RenderOptions`, which is
`!cleanMode` and deliberately not the activity-badge setting: turning off "what
everybody is doing" is not the same as turning off "this lodge is standing
idle". They pulse on one shared phase, because two of them out of step read as
an animation and one slow rise and fall across the kingdom reads as the place
waiting.

`wantsWorker` is **nobody at all**, never "short-handed". A quarry with one
miner of three is a quarry that works, and a mark on every unfilled slot would
be a mark on nearly every building nearly all the time.

**Hovering a building fades it, and shows who is asleep inside.** A building
fades at `HOVER_FADE` when the cursor is on **either** its art or its ground,
and several may fade at once because each one answers for itself — there is no
arbitration step, and there must not be. The two rules exist because they answer
two different questions:

- **the art** — `spriteHit` tests a painted pixel of the building's sprite,
  through an alpha mask read out of the cached canvas once and kept with it.
  This is the one the player means: in this projection a roof is drawn over the
  tiles *behind* the building, so asking the ground what the cursor is on gets
  the wrong answer for every pixel above the footprint — hovering a cabin's roof
  used to fade a bench two tiles away. It is pixel-accurate rather than a
  bounding box because a roof overhang leaves a wedge of empty canvas beside the
  wall below it, and fading a building while the cursor is on the grass in that
  wedge is worse than not fading at all.
- **the ground** — the footprint tile under the cursor, which is what a *click*
  still selects. Clicking deliberately did not move to the sprite: the tiles
  behind a roof are only reachable through it, and picking by art would strand
  them for good. So the building a click would open has to be among the ones
  that go translucent, or the fade would highlight one thing and the click open
  another.

`RenderOptions.hoverPx` carries the cursor in world pixels for the first rule;
`hover` stays the tile, for the second and for everything else.

The indoor sleepers go on **over** the faded wall at `INDOOR_ALPHA`, not under
it. Under it was the prettier idea — people showing through the wall — but a
wall at two thirds leaves a third of a villager, which at this size is nothing
at all; ghosted on top reads as seeing into the house, and solid would read as
somebody asleep on the roof. They are laid out on a lattice in **tile** space
and then projected, so the beds stagger the way a floor seen from this angle
does; spacing them along the screen's x-axis instead turned six people in a
cottage into one long purple slab. They are drawn at the middle of the footprint
rather than where they actually are, which is the doorstep, because the honest
position would show somebody asleep on the porch — the exact thing going indoors
was meant to stop. Depth sorting still applies to the whole business, so a
storehouse standing in front of a cabin hides its sleepers, which is what a
storehouse standing in front of a cabin does.

---

## The time of day, drawn three times

`render/sky.ts` is the one place that turns `dayT` into something to look at,
and **three things read from it that must never disagree**: the sky above the
island's horizon, the day strip along the top of the screen, and the direction
every shadow on the ground falls. That is the same fact told three times, and
it is told three times on purpose, because each one answers a question the
others cannot:

| | answers | on screen |
|---|---|---|
| the sky | what it looks like out there | zoomed out, or panned north |
| the day strip | what the hour is, and how much light is left | always |
| the shadows | roughly when it is, without looking away from the work | every tile, every zoom |

The strip alone carries a fourth thing, and it is not about the light at all:
the kingdom's three breaks, ruled underneath the day. That is deliberate — the
strip is the one of the three that is always on screen, and "is anybody working
right now" is a question about the hour that the sky cannot answer.

The sky came first and is the most beautiful of the three; it is also the one
you cannot see with the camera down among the buildings, which is what the other
two are for. **`drawSun` and `drawMoon` live in `sky.ts`** rather than in the
renderer, because both the sky and the strip put a sun on a canvas and a sun
that is a different sun in each of them is two suns.

**The strip is the whole day, and the bands never move.** The body's position
along it *is* the time, and because dusk always begins in the same place you can
see how much daylight is left without anything saying so in words. A strip that
showed only the current crossing would answer "how far through this one" and not
"how much is left", which is the question somebody with a half-built cabin
actually has.

**`stripT` decides where in the day the left edge falls, and everything the
strip draws goes through it** — the body, the four marks, and the colours (via
its inverse, `stripDayT`). It is rotated so the sun is highest exactly halfway
across, which puts daylight in the middle with dawn and dusk flanking it and
night at both ends, symmetrical about the centre. Centring on twelve *by the
clock* would push the whole arc right, because this kingdom's day runs half five
to a quarter to eleven and its `DAY_MIDPOINT` is nearer two. The colours are
sampled from `skyColors` at even spacings across the width rather than mapped
from the stop table, because the day wraps round the ends of the strip and
mapped stops come out of order there.

**It is a track, not a street.** The ribbon is seven pixels deep and drawn at
`TRACK_ALPHA`, so the map still shows through it, and the body is larger than
the ribbon and overhangs it top and bottom. A band as tall as the thing riding
it reads as another bar of interface; a wire with a bead on it reads as a sky.
The four marks are drawn at *full* strength either side of the ribbon rather
than through its alpha, where they came out invisible — and each is a dark line
with a light one beside it, because a dark tick disappears against a night
kingdom and a light one disappears against a meadow.

**The kingdom's three breaks are ruled underneath the day, and that is a
separate layer from the sky.** Everything above the rule — the ribbon's
colours, the four landmarks, the body — answers *what is the light doing*;
`BREAKS` in `defs.ts` answers *is anybody working*, and the two must not be
allowed to say each other's lines. They were briefly both saying "tools down at
nine" and the hover tip read it twice in three lines. `BAND_META`'s notes are
about the light and nothing else now; `dayDoing` names the stretch.

They are drawn as **stretches rather than ticks**, because the useful part is
the length: the midday hour being a third of the evening's is why somebody
looking for everybody knows to look at nine and not at noon. The one in
progress is thicker *and* brighter — at two pixels a difference in brightness
alone is one nobody can see.

The rule is drawn **after the body and below the disc**, which is not
tidiness. The strip is the day and the body is the hour, so the stretch in
progress is always the one directly under the sun: the mark that most wants
reading is by construction the one the bloom would wash out. `BREAKS` is
derived from `SCHEDULE` rather than written out again, so retuning the day
moves the marks with it.

**The strip takes no pointer events at all.** Most of its height is transparent,
and a full-width see-through box that swallows drags on the map is the exact bug
`#ui > * { pointer-events: auto }` has caused twice already. The hover is picked
up from a `window` listener against a cached rect instead.

It is a picture and not a control — nothing on it can be clicked, because time
is the one thing here nobody can hurry. It repaints only when the signature
changes, which at ordinary speed is a couple of times a second: the body crosses
about a pixel a second, and repainting a gradient sixty times a second to move
something that far is work nobody asked for.

**`DAY_STRIP_H` and `--sky-h` have to agree**, and both are the box rather than
the ribbon. `DAY_STRIP_H` sizes the strip's own canvas; `--sky-h` is what the
rest of the layout positions off, and it is the one that goes to zero when the
strip stands down. The strip is folded into the measured `--top-h`, so
everything positioned off that clears it; without that the whole interface rides
up under the pills the moment the strip appears.

**The sky sits above the island's north corner, which is world y 0.** Everything
above that row is off the map entirely, so it can honestly be called sky; the
sea, the ground and everything on them draw over it in the ordinary way. Pan
south and the island fills the screen and the sky goes, which is what looking
down at your feet does. `horizonY()` is the whole of that rule. The camera's
north clamp carries `SKY_HEADROOM` — **a share of the view's height, not a
number of pixels**, because the same margin that shows a strip of sky at 1×
fills the entire screen with it at 6×. That is why north keeps its own short
margin in `clampToMap` while the other three run out to twenty tiles: east,
west and south are open sea now and worth panning over, but north is sky, and
how much of it is reasonable to look at is a share of the view rather than a
distance.

**The bands of the day are the sky's own colour and nothing else.** `SKY_STOPS`
lines up with the stops `ambientTint` uses, so the light on the ground and the
light in the sky never tell different stories. There is no gauge drawn over the
sky saying "dusk"; the rim going orange under a violet zenith is the kingdom
saying so, and the four names live in `BAND_META` for the hover tip alone.

**The sky is where the light comes from, so the lighting pass does not fall on
it.** `applyLighting` paints the light buffer white above the horizon and hands
back to the ambient tint across the last stretch of it, which doubles as haze.
Multiplying the night tint over an already-dark sky drove it to black and took
the stars with it. For the same reason the sun's halo is composited `lighter`
rather than laid over the top: a warm ring at any alpha is *darker* than a pale
evening sky, which drew a grey washer round the setting sun.

**Only one body is ever up.** Sun from `SUNRISE` to `SUNSET`, moon for what is
left, handing over at the rim — so "what is up there" is a glance rather than a
comparison. The moon runs an eight-day phase cycle and is **deliberately never
new**: an invisible moon is one night in eight with nothing to read the hour
from, which is a worse trade than a crescent slightly fuller than it should be.

**The sky's bodies are large, and at the widest zoom the strip stands down for
them.** `SUN_R` and `MOON_R` in the renderer are both 64 art pixels — 128
across: this sun is the view out of the window rather than a marker saying where
the sun is, and at the old eight pixels it was a bead lost in three hundred
pixels of sky. Sun and moon are matched, because they are never up together and
a difference between them is a comparison nobody is in a position to make.
Because of that size the bloom is a *proportion* of the disc (`BLOOM_STEP` in
`sky.ts`) with a ring count that grows with it: three rings are a fall-off round
a bead and a bullseye round a setting sun.

At `camera.zoomIndex === 0` the whole day strip goes — not just its bead —
because that is the view with the real sky in it, and the same hour told twice
in the smaller of the two skies is one telling too many. `#ui.no-daystrip` hides
it *and* zeroes `--sky-h`, and `--top-h` is measured off the strip's own height
rather than the `DAY_STRIP_H` constant, so the top bar takes the room back
instead of leaving a gap where the strip was. The clock in that bar says the
hour throughout, so nothing is actually lost.

**Cast shadows are the always-on half of the clock, and they are collected
before they are laid down.** `drawShadows` fills a separate buffer in solid
black and composites it once at `sunlight().alpha`. Drawing each shadow straight
onto the world at its own alpha makes every overlap darker than the shadows in
it, which turned a stand of trees at dawn into a black pool. Shapes are stamped
from a per-frame cache (`streak`) because every tree on the island casts the
same shape at the same moment and only the position differs; buildings get their
footprint swept along the reach instead, via a convex hull, because at that size
a roofline is a shape the eye recognises.

Shadow darkness is **mostly flat against altitude** (`0.12 + alt * 0.14`). A low
sun casts the longest shadow of the day, and scaling darkness off altitude alone
made the most dramatic hour the one you could barely see. `MAX_REACH` caps the
length: the true figure runs away to infinity at the rim, and a tree whose
shadow crosses half the island reads as a bug rather than as a sunrise.

**Nothing here is a mechanic.** Time of day already drives sleep, work hours and
which animals are about. All three of these only draw it, and the hover tip says
what is happening rather than offering anything to do about it. That tip is
raised from either place the body appears — over the island, or anywhere along
the strip, which is a far more forgiving target than a disc nine pixels across.

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
the only thing the player can do. The marker shades all nine tiles rather than
the one under the cursor, because the cursor is the camp's centre and the
footprint is the thing worth seeing.

**A build tool lets go exactly when there can be no more of that kind.**
`place()` asks `atBuildLimit` after the building is standing: a Quarry, a
Kitchen, a Forge or the last Cabin the commons allows all drop the cursor, and a
lantern with seven of its eight placed stays armed. Both halves matter. Most of
the kingdom is unique or capped at one per commons level, so staying armed left
the player holding something the very next click could only refuse, with the row
it came from greyed out behind it; but the comforts genuinely are laid out in
rows, and going back to the menu eight times to plant eight lanterns is the
irritation the armed tool was for in the first place. `atBuildLimit` is the one
rule for both, so a change to how many of something the kingdom may keep changes
this with it and nothing has to be remembered.

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

**Everything you can point at on the map gets a card in the right margin, and
that includes a building.** Clicking one fires `game.onBuildingClicked` —
deliberately not fired by `place()`, so laying out a row of houses is not
interrupted by a panel — and the UI opens a **People · Work · About** panel
(**Site · About** while it is still being built). Closing it clears the
selection, so nothing is left outlined on the map with nothing to explain it.

It is a *card*, not a modal wearing a margin: no scrim, no focus trap, and the
map stays live all round it, so the next building is one click away and the
build rail on the opposite side may stay open beside it. `setModal` therefore
exempts it from the one-surface-at-a-time rule that every other panel keeps —
the reason for that rule is the scrim dimming what is behind it, and there
isn't one. The other panels are about the whole kingdom and still take the
screen; a building is about one place on it and does not.

The margin is 274 pixels for the cards and **330 while a building is in it**
(`#ui.wide-rail`), because a roster row is three things and the cards have no
such row. Even at 330 it is not three *columns*: a name, an activity and a
control squeezed across that width ellipsise to "Poppy L…" beside "Watching
the world g…", so the rail borrows the phone's row instead — control on the
right, activity under the name. The centred modal has the width for all three
and keeps them.

On a phone there is no margin to put a card in, so a building is a bottom sheet
like every other panel, focus trap and all — `buildingInRail` in `ui.ts` is the
whole of that fork, and `buildingParts` builds the same pieces for both, since
a panel that said different things in the two places would be two panels.

That panel is a *live* view: `refreshPanels()` redraws it a few times a second so
"Here now", batch progress and site materials keep up. Two consequences worth
knowing. It skips the redraw while a `<select>` inside it has focus, or opening a
dropdown would slam shut under the player. And `updatePanel` swaps the existing
nodes in place rather than rewriting the host's `innerHTML` — replacing the whole
panel restarts the scrim's fade animation, which reads as a flicker (invisible in
the source, obvious in a screenshot) and throws away the body's scroll position.

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
the things the in-place update has to preserve. Two-line rows are half again as
tall, so wherever they are used — a phone sheet, or the margin card — that
height goes up to match.

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

**A modal closes the build rail on every screen, not only a phone.** A desktop
has the room for both, but nothing to gain by it: the scrim dims the rail and
takes its clicks, so what is left is a list sitting there lit up and
unreachable. `setModal` does it for everything **except a building on a
desktop**, which is a card in the opposite margin with no scrim at all — the
reason for the rule does not apply, and clicking a cabin to see who sleeps
there should not shut the list you were laying the next one out from. Esc then
steps back out one layer per press — modal, then the placement being
considered, then the tool holding it, then the list the tool came from, then
clean view, then the selection — which is the ladder in `bindKeys` and the
order they were opened in.

**Build is a primary control and the only one up there.** Everything else in
the toolbar and along the phone's bottom edge is somewhere to go and look at
the kingdom; Build is the thing that changes it, so it carries `primary`
whether or not the list is open, and `.btn.primary.on` / `.navbtn.primary.on`
are a further step up rather than the first time it is coloured at all.

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
- **`host.innerHTML !== html` is not a redraw guard, and never was.** Reading
  `innerHTML` back gives the *serialised DOM*, where the `&#39;` that `esc()`
  wrote has become `'` again — so any panel that mentions a Woodcutter's Lodge
  compares unequal to itself and is torn down and rebuilt every time it is
  drawn, which for the live panels is several times a second. What that looks
  like is a build list that will not stay scrolled, a hover highlight that goes
  out under the cursor, and focus jumping about; what it looks like in the
  source is a guard that is obviously correct. Use `setHtml()` from
  `ui/context.ts`, which compares against what was last *assigned* and says
  whether anything changed. A redraw that does happen still has to carry the
  scroll position of anything scrollable across it.
- **Everything floating over the map has an explicit `z-index`, and the ladder
  is written down in `style.css`** — day strip 14, rails and sheets 15,
  objectives 16, view
  pad 20, modals 24, dock 25, toasts 28, hover tips 40. Before that only the
  dock and the pad carried a number and the rest sorted by document order,
  which is how the zoom buttons came to paint through a modal's scrim. The dock
  sits above the modal deliberately: on a phone the bottom navigation is how
  you get from one sheet to another.
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
- **The lake grows along the shore, never out through it.** Its lobes are aimed
  perpendicular to the bearing from the island's middle, and that is load-bearing
  rather than tidy: the lake sits eleven tiles out on an island whose coast is
  about eighteen out, so a lobe pushed outward walks through the beach and the
  lake stops being a lake. Measured over five hundred seeds, the first version
  turned half of them into bays. Any change to `makeLake` wants that measurement
  taken again — `worldcheck` reports the lake size and the bay count for exactly
  this reason. Watch the other direction too: the first attempt put the lobes
  *closer* to the centre than the main body's own radius, so they were entirely
  inside it and the "bigger" lake came out 7% smaller than the plain circle it
  replaced.
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
keys, per-building job slots, the goal list. Adding one of these is mostly new
data in `defs.ts` plus a system module, not surgery. A currency is not part of
that scaffolding any more; see "Deliberately removed".

Also unbuilt and worth knowing: there is currently no Carpenter, Scholar,
Merchant or Animal Keeper profession — the `keeper` job id used to exist with
nothing using it and has been removed, so adding animal care means adding the
trade *and* the building it stands in. **Iron and steel
bars have no sink** — the chain is the content for now. Mithril is a step
further out: the resources, the Mithril Mine and the
forge's mithril recipe are all written down and none of them is reachable, and
`simcheck` fails the run if any mithril ever exists.

---

## Deliberately removed

**Coins are gone, and the goal reward went with them.** There used to be a
fourteenth resource that lived outside the storage pool, was paid out by three
goals, and bought nothing whatever — `STORED_RESOURCES` existed solely to
exclude it, and `deposit` had a branch for it. All of that is deleted:
`RESOURCE_ORDER` is now the whole list and everything on it is stored, and
`Goal` has no `reward` field at all. The three goals that paid wood lost it in
the same pass, which cost the kingdom forty wood spread across the first hour
and moved the twentieth arrival by two game-minutes in a 700-minute run — worth
saying out loud because rewards were never displayed anywhere, so no player ever
knew they had been given anything. That is also the argument against bringing
them back: a pile appearing in the barn that nobody carried there is the one
thing the economy is not allowed to do. A save carrying coins still opens —
`reviveStock` takes only the resources that still exist and drops the rest,
rather than spreading the saved object wholesale and quietly reviving a key
nothing iterates.

**Deadfall is gone, and is not coming back.** There used to be six piles of
fallen branches near the middle of every island — free wood, no axe needed —
and the opening was two of them. The prop, its sprite, its scatter and its
guarantees are all deleted: the founder now fells an ordinary tree, which
depletes, leaves a stump and grows back like every other tree. Do not reintroduce
a special opening-only resource; if the first minute needs to be gentler, tune
the chop, not the world.

**Hand-mining is gone, and is not coming back.** General Workers and the founder used to
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

**A second Lodge, Quarry, Farm, Fishing Hut, Windmill, Kitchen or Forge is gone, and is not
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

Map 40×40 · a day is 30 real minutes at 1× (20 day / 10 night) · the sun is up
from day-fraction 0.02 to 0.74 and the moon has the rest, on an eight-day phase
cycle · shadows run from about two-thirds of a caster's height at midday out to
the 3.2× cap near either rim · 6 days a season,
24 a year · the working day is up at 05:30, out at 07:00, an hour off at noon,
finished at 21:00 and asleep from 23:30 — thirteen hours of work, five of
breaks, six of sleep, which restores about 50 energy against the 32 an
eighteen-hour day drains · a trait or a villager's own habit shifts the day's
outer ends by up to about three quarters of an hour either way and never the
midday hour · General Workers hand-fell only below 32 wood and at half a
woodcutter's pace · **population is capped by beds and by nothing else** — 2 at the
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
at all, and 1 iron bar + 2 coal → 1 steel bar · the kitchen is 2 flour → 3 bread
in 22 seconds and 2 fish → 2 cooked fish in 16, and a loaf and a fish are worth
the same to everything · a fishing hut reaches 10 tiles, 13 improved, holds 1
fisher and then 2, and one cast is 11 seconds for about 3 fish at the best water
and 1 at the thinnest · a spot loses a third of its rest per cast and takes about
4 game-minutes to settle fully, never falling below 0.3× · seasons move the catch
between 1.1× in summer and 0.8× in winter and never stop it · the kingdom is
comfortable holding 5 meals a head plus 10, and eases off above that · founding
itself is about a minute and a half at 1×, twenty seconds of it the walk up the
beach and twenty the tree
· a generated island carries at least 55 trees and 26 boulders within 14 tiles of
the middle, a choice of at least 6 legal campsites, at least 4 trees within 9
tiles of where the kingdom begins — the nearest about 3 — at least 3 places a
quarry could legally stand with 25 tiles of rock inside its reach (in practice
fifty or more such sites, the best of them reaching 127 to 189 tiles of rock),
and at least 3 places a fishing hut could with 4 good spots inside its reach (in
practice 21 to 132 sites, the best of them seeing 10 to 122 spots) · the lake is
about 100 tiles of water and shallows, a main body with one or two lobes pushed
out along the shore rather than out through it, and about one island in two
hundred has one that meets the sea and becomes a bay.

Per-resource shelf limits — one good never taking more than a share of the
store — have been discussed and deliberately deferred. Any such limit has to
clear the early costs (a Storehouse is 25 wood against an opening capacity of
50) or it recreates the deadlock it was meant to prevent. `WOOD_RESERVE` is the
nearest thing to one that survived, and only because it caps *fetching* rather
than storing.
