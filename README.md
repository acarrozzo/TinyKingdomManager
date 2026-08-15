# Tiny Kingdom Manager

A peaceful, isometric kingdom simulation for the browser. You start with one
person and nothing else. They begin gathering wood. Everything after that is up
to you — and to them.

There is no win condition, no threat, and no failure state. If you stop paying
attention the kingdom slows down; it never collapses.

```
npm install
npm run dev      # http://localhost:5173
```

---

## What's in this version

The brief's "Initial Scope" loop, built end to end and balanced against a
headless simulator (see [Development tools](#development-tools)).

**The world.** A 40×40 isometric island generated per save: woodland, meadow,
rocky ground, a pond, and a beach. Trees and boulders are real resource nodes
that deplete, leave stumps and rubble, and slowly grow back.

**The loop.** One villager → gather wood by hand → Shelter → Storehouse →
Woodcutter's Lodge → Quarry → Wheat Farm → Windmill → Bakery. Wheat becomes
flour becomes bread, and every step of that is carried across the map on foot by
someone you can click on.

**Construction.** Nothing appears when you buy it. A placed building becomes a
site with corner posts; villagers haul the materials over, then put in the
labour, then it stands up. You can watch the whole thing.

**Roads.** Dirt paths and stone roads are placed by dragging. They are
substantially faster than open ground (1.45× and 1.95× against grass), and the
pathfinder is weighted by the same numbers, so traffic genuinely re-routes onto
a road you lay down.

**Storage is physical.** Goods only exist in the shared store once somebody has
carried them to a storage building. Where you put your storehouses decides how
much of the day your workers spend walking.

**Jobs and experience.** Helper, Woodcutter, Stoneworker, Farmer, Miller, Baker.
Experience accrues per profession, only from doing the work, and is kept
forever — Novice / Adept / Journeyman / Expert / Master. Moving a master farmer
to the mill costs you their farming output, not their farming history. Skill is
worth roughly 0.8× to 1.4× work speed, so it matters without being decisive.

**People.** Generated names you can change, one gentle trait each, a home, a
work history, a personal record of what they have done, and a favourite toggle.
Individual sleep and wake times, so mornings stagger. Clicking anyone opens
their page; double-clicking follows them around.

**Leisure.** A large part of what villagers do earns nothing at all: sitting on
benches, standing by the water, watching an animal, wandering, talking, or just
stopping somewhere. Occasional, sparse speech bubbles.

**Wildlife.** Ten species, spawned from an actual habitat model — terrain,
nearby props, time of day, and season. Plant trees and squirrels arrive. Dig
out flowers and you get butterflies and bees. A creature is only recorded as
discovered once it comes close enough to your people for somebody to have
noticed it, so ducks on the far side of the pond stay unlisted until a villager
wanders down there. The wildlife page gives observational hints, never numbers.
Animals can be named, which is also what stops them wandering off for good.

**Population.** Newcomers arrive rarely, gated on spare beds, food and comfort,
with a hard minimum gap of most of a day between arrivals. Roughly one every day
or so early on, slowing down as the kingdom grows.

**Time.** A day is 30 real minutes at 1× — about 20 minutes of daylight and 10
of night — with 1×/2×/4× and pause. Six days to a season, twenty-four to a year.
Time only passes while the tab is open; there is no offline simulation.

**Night.** Windows light up, the campfire pools warm light with a flicker,
lanterns work, colour drains toward blue, and nocturnal wildlife comes out. It
is not a danger phase.

**Seasons.** Full palette recolouring of terrain, foliage, crops and roofs, plus
snow in winter and a real effect on how fast wheat grows (slow in winter, never
fatal). Conifers hold their colour all year, which keeps autumn from turning
into an undifferentiated orange field.

**Clean viewing mode** (`H`). Hides the entire interface except a small time and
season chip. This is the point of the whole thing.

**Journal and goals.** The kingdom keeps a dated written record of its own
history. Thirteen onboarding goals and milestones gradually unlock the build
menu rather than presenting it all on day one.

**Saving.** Named save slots in `localStorage`, autosaving every 30 seconds and
on close, plus JSON export/import for backups.

**Audio.** Everything is synthesised at runtime: a wind bed that wanders,
sparse birdsong during the day, crickets and the odd owl at night, water when
you are near it, and short one-shots for work and building.

### Not in this version

Deliberately left for later, per the brief: expeditions, domestic animals, a
research tree, visiting merchants, aging and retirement, land expansion, and
the wider collections. The systems they'd hang off — journal, discovery,
unlocks, per-building job slots, the goal list — are all in place.

---

## Controls

| | |
|---|---|
| Drag | Pan |
| Scroll | Zoom (four integer levels) |
| Click | Select a villager, animal or building |
| Double-click | Follow someone with the camera |
| **Build** | Pick a building, then click where it goes |
| **Path** / **Road** | Drag across the map to lay a line of it |
| **Remove** | Click a building, path or road to take it away |
| `B` | Build menu |
| `P` / `J` | People · Journal |
| `H` | Clean viewing mode |
| `Space` | Pause |
| `1` `2` `3` | 1× · 2× · 4× |
| `Esc` | Cancel the current tool, or close a panel |
| Right-click | Cancel the current tool |

---

## How it's built

Vite + TypeScript, Canvas 2D, no framework and no runtime dependencies. The
production bundle is about 49 kB gzipped.

**All art is generated in code.** There are no image files. Terrain, trees,
buildings, crops and props are drawn pixel by pixel into offscreen canvases at
load, from a season-aware palette; villagers and animals are drawn per frame
because they are tiny and every one of them has their own colouring. This is
what lets a season change recolour the entire world for free, and it means the
whole game is a single self-contained bundle.

**Rendering.** The world is drawn into a buffer at exactly one canvas pixel per
art pixel, then upscaled with nearest-neighbour at an integer scale — that is
what keeps the pixel art crisp instead of smeared at every zoom level. Ground is
baked once into a single map-sized canvas and blitted as one image; only things
that need depth sorting against moving actors are drawn per frame. Lighting is a
separate light buffer (ambient tint plus radial sources) composited with
`multiply`.

**Simulation.** Villagers run a small planner: when a villager has nothing to
do, a brain function builds a plan out of concrete steps — walk here, work for
n seconds, pick this up, put it down. Every economic action is therefore
something you can watch happen. Plans are transient and are never saved; after
a load everyone simply decides again.

Reservations stop two villagers walking to the same tree, and specialists back
off when the stores are already dominated by what they produce, so a full
storehouse slows the kingdom rather than jamming it.

### Layout

```
src/
  core/util.ts      seeded RNG, noise, small maths
  types.ts          the shared vocabulary
  world/            iso projection, map generation, weighted A*
  sim/              defs (all game data), state, villagers, wildlife,
                    population, goals, journal, names
  render/           palette, procedural sprites, actors, camera, renderer
  audio/            WebAudio synthesis
  save/             slots, serialisation, export/import
  ui/               DOM interface and styles
  game.ts           clock, input, and everything the player can do
```

`src/sim/defs.ts` holds essentially all the tuning: buildings, costs, recipes,
job definitions, traits, wildlife, experience curves and day length.

---

## Development tools

```
npm run typecheck                # tsc --noEmit
npm run build                    # typecheck + production bundle
npm run sim -- 600               # run 600 game-minutes headless and report
TKM_DUMP=k.json npm run sim -- 600   # …and write the result as a save file
npm run roundtrip -- k.json      # verify a save survives serialisation
```

`npm run sim` plays the kingdom without any rendering — placing buildings,
assigning jobs, and reacting to shortages the way a player would — then prints
population, storage, every villager's experience, when each species was first
seen, the goal list and the journal, followed by consistency checks. It is how
the economy was balanced, and it is the fastest way to see the effect of a
change in `defs.ts` without watching for an hour.

A save produced with `TKM_DUMP` can be dropped into `localStorage` under
`tkm.save.<id>` to inspect a mature kingdom in the browser immediately.
