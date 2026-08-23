# Tiny Kingdom Manager

A peaceful, isometric kingdom simulation for the browser. You start with one
person walking up a beach with nothing at all, and one question: where should
this kingdom begin? Choose the ground and they make camp there. Everything after
that is up to you — and to them.

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
rocky ground, a pond, and a beach. Trees are real resource nodes that deplete,
leave stumps and grow back. Surface boulders do not: they are finite, and one
built over is gone for good. Everything the kingdom digs up comes instead out of
the rocky ground a mine stands on, which does not run out.

**The loop.** One villager → choose a campsite → fell one tree by hand → the
Base Camp goes up on that load → Cabin → Storehouse → Woodcutter's Lodge →
Quarry → Wheat Farm → Windmill → Bakery, and then the mine sunk deeper into an
Iron Mine and a Deep Mine with a Forge behind it. Wheat becomes flour becomes
bread; ore becomes iron becomes steel. Every step of that is carried across the
map on foot by someone you can click on.

**Construction.** Nothing appears when you buy it. A placed building becomes a
site with corner posts; villagers haul the materials over, then put in the
labour, then it stands up. You can watch the whole thing.

**Storage is physical, and it belongs to places.** There is no shared pile.
Every resource lives in the building responsible for it — wood at the lodge,
stone at the mine, supper at the kitchen — each in its own compartment, and it
only gets there because somebody carried it. Anyone who needs some walks there
for it, so where you site a building decides how much of the day your workers
spend walking. A storehouse takes any resource at all, which is what makes one
out by the work worth building.

For the first minute of a new kingdom there is nowhere to put anything, so the
founder simply carries what they gather until the Base Camp stands. The camp
then holds a hundred wood — enough for anything a kingdom without a woodcutter
can reach. The day a Woodcutter's Lodge opens, that founding woodpile closes and
whatever is banked in it is carried across to the lodge, load by load. Nothing
teleports; you can watch it happen.

A full compartment stops people gathering more of that one thing, and nothing
else. It never stops someone putting down what they are already holding, so a
figure can read a little over its limit while the last loads come in.

**Jobs and experience.** Helper, Woodcutter, Miner, Farmer, Miller, Baker, Smith.
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

**Everything is inspectable.** Click a person, an animal, a building — or bare
ground, which tells you what the terrain is, what is standing on it, how much is
left in it, and what you have seen living on ground like that. A small badge
over each villager's head says what they are doing at that moment.

The top bar carries four chips, not thirteen. Wood and stone keep their own
numbers, because they are what everything costs. Food carries one figure — meals
ready to eat — and Goods carries what the mine and forge have between them; both
open, on hover or a tap, into the resources behind them with a bar apiece for
how full each compartment is. A quiet mark says a compartment is nearly full and
a louder one says it is. Opening a chip takes you to the same thing at length:
which buildings are holding it and how much room each has left, how much is
stored against how much is on workshop benches or in somebody's arms, and where
the resource comes from and what it is for.

**Clean viewing mode** (`H`). Hides the entire interface except a small time and
season chip. This is the point of the whole thing.

**Drawing** (Kingdom → Settings). How often the island is repainted — Smooth,
Easy or Gentle. Drawing is nearly the whole cost of running this, so the lower
settings are markedly kinder to a laptop left open all day; the kingdom itself
runs at the same rate whichever you pick, and the map returns to full speed
while you are dragging it or placing something.

**Journal and goals.** The kingdom keeps a dated written record of its own
history. Thirteen onboarding goals and milestones gradually unlock the build
menu rather than presenting it all on day one. Both live under **Kingdom**,
along with the wildlife you have seen and the settings — three buttons in the
bottom-right corner and nothing else to learn, whatever you are playing on.

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
| Drag · one finger | Pan |
| Scroll · wheel · pinch | Zoom (1×, 2×, 3×, 4×, 6×) |
| Click | Select a villager, animal, building or tile |
| Double-click | Follow someone with the camera |
| **Build** | Pick a building, then click where it goes; removing is at the foot of the same panel |
| Bottom right | Kingdom · People · **Build** — the same three on a desktop and a phone |
| `B` | Build menu |
| `P` / `J` | People · the kingdom's journal |
| `H` | Clean viewing mode |
| `Space` | Pause |
| `1` `2` `3` | 1× · 2× · 4× (also under Kingdom → Settings) |
| `Esc` | Cancel the current tool, or close a panel |
| Right-edge pad | Zoom in, zoom out, recentre — the whole of the controls on a touchscreen |
| Right-click | Cancel the current tool |

---

## How it's built

Vite + TypeScript, Canvas 2D, no framework and no runtime dependencies. The
production bundle is about 49 kB gzipped.

**All art is generated in code.** There are no image files. Terrain, trees,
buildings, crops and props are drawn pixel by pixel into offscreen canvases at
load, from a season-aware palette; villagers and animals are drawn per frame
because they are tiny and every one of them has their own colouring. The
interface is drawn the same way — every icon in it is a twelve-by-twelve grid
baked at boot, so a button can tint its own icon and nothing is left to whatever
emoji the operating system happens to have. This is
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
  ui/               DOM interface, its own pixel icon set, and styles
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
