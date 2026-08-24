# CLAUDE.md — Tiny Kingdom Manager

Tiny Kingdom Manager is a peaceful isometric kingdom simulation for the browser.

It uses Vite, TypeScript and Canvas 2D, with no framework, no runtime dependencies and no asset files. All art and audio are generated in code.

## Document authority

- `README.md` describes the player-facing game as it exists today.
- `DESIGN.md` is the original product vision. It includes deferred and abandoned ideas; do not treat it as a specification of current behavior.
- This file records the constraints needed to work safely on the current implementation.
- Code, tests and harnesses are the authority for exact mechanics and tuning.

Read `DESIGN.md` before proposing a major feature, then check the scope boundaries and deliberately removed mechanics in this file.

---

## Product principles

This is not a strategy game with a pleasant skin. It is a **terrarium** designed to be enjoyable on a second monitor.

- **Nothing is punishing.** There is no fail state, death or disaster. A shortage makes something wait; it must never make the kingdom collapse.
- **Leisure is part of the product.** Villagers sit, wander, talk, watch wildlife and do things that earn nothing. Do not attach a stat to every charming behavior or optimize leisure away.
- **The economy is physical and visible.** A resource reaches its destination only when somebody carries it there. Resources must never teleport.
- **Storage belongs to places.** There is no kingdom-wide stockpile. Every resource lives in the building responsible for it.
- **Ecology is mysterious; the economy is transparent.** Show costs, recipes, capacity and job slots plainly. Describe wildlife through observational hints, never exposed spawn formulas.
- **Preferences are personality, not pressure.** A favorite food or personal trait may shape behavior but must not become a hidden requirement or penalty.
- **Tone is sincere and understated.** Use warm, plain language with occasional dry humor. Avoid zaniness, constant quips and exclamation marks.

---

## Run the project

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck    # strict TypeScript, including unused checks
npm run build        # typecheck plus production bundle
```

Do not add runtime dependencies without asking. The zero-dependency, single-bundle, no-asset design is deliberate.

---

## Verification

Match the check to the change. Do not run every harness for every edit.

| Change | Verification |
|---|---|
| Documentation or copy only | No automated check unless the copy describes a changed mechanic |
| Ordinary TypeScript | `npm run typecheck` |
| `src/sim/` or `defs.ts` | Typecheck and one 600–1000 minute simulation |
| World generation | Typecheck and `npm run worldcheck` |
| Building relocation | Typecheck and `npm run reloccheck` |
| Population, Vibes or beds | Typecheck and `npm run popcheck` |
| Storage capacity, the camp woodpile or storage copy | Typecheck and `npm run woodcheck` |
| Saving, loading or persistent fields | Typecheck and `npm run roundtrip` |
| Visuals, layout or input | Typecheck and relevant screenshots |
| Broad refactor or finished feature | `npm run build` plus the affected harnesses |

`npm run build` already runs the typechecker. Do not run both separately.

Batch verification after a coherent set of changes rather than after every small edit.

### Simulation

```bash
npm run sim -- 600
npm run sim -- 600 4242
TKM_DUMP=k.json npm run sim -- 600
```

Use this for simulation logic and tuning. A run of 600–1000 game-minutes is normally useful. Under roughly 300 minutes, later production will not have come online; beyond roughly 1200, the kingdom has usually plateaued.

The run reports population, beds, Vibes, arrivals, storage, experience, wildlife, goals, the journal and the daily routine. It also enforces world invariants such as:

- resources only appearing after their required production building exists;
- resources living only in buildings that can hold them;
- no idle villager remaining stuck with a carried load;
- storage remaining within the allowed delivery overshoot;
- food supply staying within a credible range for the population;
- the sleep, work, meal and break schedule remaining recognizable.

The simulation is deterministic for a given seed and duration. If a surprising result may be seed-specific, run one additional seed rather than many.

The harness itself must continue to:

- assign available workers before deciding whether another building can be afforded;
- allow wood costs to be paid over time while requiring other materials to exist;
- improve buildings whose compartments have filled;
- exercise both food branches;
- obey the same placement rules as the interface;
- keep early staffing balanced rather than filling every raw-material job first.

### World generation

```bash
npm run worldcheck
npm run worldcheck -- 100000 900000000
npx tsx scripts/worldcheck.ts 1 8
```

Use this for changes to `world/terrain.ts`.

It verifies that generated islands are deterministic and playable: valid campsites, an open middle big enough to lay a village out in, reachable founding trees, usable quarry locations, viable fishing locations, connected terrain and sane tile data.

Random scatter is not a guarantee. Any required resource or placement count must have a deterministic fallback.

The middle of the island is an irregular clearing roughly thirteen tiles across, and it is the ground the kingdom is built on. `clearingEdge()` is the authority for where it ends — one signed distance, read like `lakeEdge()` — and every pass with an opinion about the middle asks it rather than carrying a radius of its own. Woodland, the outcrop and both node guarantees stop at it; flowers, bushes and a few trees at its rim do not, because a clearing with nothing growing in it reads as mown. It yields to the lake and to nothing else.

### Building relocation

```bash
npm run reloccheck
```

Use this for relocation, construction completion and building removal.

It verifies that a moving building remains operational, survives saving midway through the move, preserves its identity and contents, releases its old footprint and claims its new one.

### Population

```bash
npm run popcheck
npm run popcheck -- 4242
```

Use this for `population.ts`, `vibes.ts`, arrivals and changes to beds.

It verifies that:

- the arrival clock does not run during founding;
- the first companion arrives within the intended window;
- a full kingdom freezes arrival progress instead of losing it;
- arrivals survive saving and loading;
- Vibes move an arrival within its window rather than outside it.

### The camp woodpile

```bash
npm run woodcheck
```

Use this for storage capacity, `Building.cacheRetired`, the clearing rung of the helper ladder, and any change to where wood lives.

The ordinary simulation cannot cover this. Its kingdom spends wood as fast as it earns it, so by the time its Lodge finishes the camp is down to single figures and the transfer is over before it starts. This sets up the interesting case deliberately: a full camp, a Lodge, and nothing else to spend it on.

It verifies that:

- the camp holds its founding wood and accepts wood while it is the only woodpile;
- the cache retires the instant the Lodge completes, and the camp stops accepting wood;
- nothing moves or vanishes at that moment — the kingdom owns exactly what it owned a tick earlier;
- somebody is actually seen carrying the wood, and all of it reaches the Lodge;
- the retirement survives a save, and losing the Lodge later does not restore the cache.

### Saving

```bash
TKM_DUMP=k.json npm run sim -- 600
npm run roundtrip -- k.json
```

Use this for `save/save.ts` and any persistent field added to `GameState`, `Building` or `Villager`.

Plans and other transient presentation state are deliberately excluded from saves.

### Visual verification

```bash
npm run dev &
node scripts/shot.mjs
node scripts/shot.mjs http://localhost:5173/ out.png 6 "window.tkm.game.camera.zoomIndex = 3"
PRELOAD=k.json node scripts/shot.mjs http://localhost:5173/ late.png
DEVICE=390x844@3 node scripts/shot.mjs
DEVICE=768x1024@2 node scripts/shot.mjs
```

Take screenshots for visual, layout and input changes, then inspect the images.

Use `PRELOAD` to load an existing kingdom through the game’s own save path. Use `DEVICE` when touch behavior or compact layouts may be affected.

Capture only the viewports relevant to the change.

#### Contact sheets

Three of them, on `window.tkm`, none reachable from the interface:

```bash
node scripts/shot.mjs http://localhost:5173/ icons.png 3 "document.body.appendChild(window.tkm.iconSheet())"
node scripts/shot.mjs http://localhost:5173/ sprites.png 3 "document.body.appendChild(window.tkm.spriteSheet('summer', 3))"
PRELOAD=k.json node scripts/shot.mjs http://localhost:5173/ poses.png 3 \
  "document.body.appendChild(window.tkm.poseSheet(window.tkm.game.state.villagers[0], 6))"
```

- `iconSheet()` — every interface icon.
- `spriteSheet(season, zoom)` — every building at every level, then the props and the wheat plot through its stages.
- `poseSheet(villager, zoom)` — one person in every pose, both facings, carrying each kind of load, and every trade's tool.

Use these rather than hunting for an example on the map. Half the buildings are behind another building, the lighting is over all of it, and the one you want is at a level this kingdom has not reached — reviewing procedural art by looking for it in play does not work, and the bugs it hides are the ones a player sees first.

Judge art at the zoom it is played at as well as up close. Detail that reads at 6× and turns to noise at 1× is a loss.

---

## Project map

```text
src/
  types.ts            shared entity and state types
  core/util.ts        deterministic RNG, noise, maths and IDs

  world/
    iso.ts            isometric projection
    terrain.ts        world generation, terrain queries and regrowth
    path.ts           weighted A* pathfinding

  sim/
    defs.ts           game data, tuning, recipes, buildings and copy
    state.ts          GameState, buildings, storage and claims
    founding.ts       opening sequence and campsite rules
    villager.ts       needs, schedules and planning
    wildlife.ts       habitat, spawning and animal behavior
    population.ts     beds and arrival pacing
    vibes.ts          Vibes calculation
    goals.ts          progression, limits and unlocks
    journal.ts        kingdom history and toasts
    names.ts          names and chatter

  render/
    palette.ts        seasonal and day/night colors
    sky.ts            sky, sun, moon and shadow direction
    sprites.ts        procedural terrain, prop and building art
    actors.ts         villagers and animals
    camera.ts         pan, integer zoom and follow
    renderer.ts       world composition, depth, lighting and labels

  audio/audio.ts      generated WebAudio
  save/save.ts        save slots, serialization and import/export

  ui/
    ui.ts             interface shell and panel state
    context.ts        UI environment and shared helpers
    icons.ts          the interface's own pixel icon set
    daystrip.ts       time-of-day strip
    hud.ts            resources, clock and storage display
    nav.ts            the action cluster and the view pad
    goals.ts          objectives and goal views
    build.ts          build list and placement interface
    inspector.ts      villager, animal and tile cards
    people.ts         the roster and the jobs board
    modals.ts         building and kingdom-level panels
    a11y.ts           focus management and live regions
    portraits.ts      procedural art reused in interface canvases
    style.css         interface styling

  game.ts             clock, input and player-facing operations

scripts/
  simcheck.ts
  worldcheck.ts
  relocheck.ts
  popcheck.ts
  woodcheck.ts
  roundtrip.ts
  shot.mjs
```

`src/sim/defs.ts` is the normal home for:

- building definitions, costs, levels and recipes;
- jobs, traits, trait effects and experience curves;
- wildlife definitions;
- movement and time tuning;
- terrain, prop and resource descriptions;
- building `desc` and `how` copy.

Prefer data in `defs.ts` over new branches in simulation logic.

When a mechanic changes, update any player-facing copy that states how it works.

---

## Simulation invariants

### Planning and time

When a villager has no plan, `think()` builds one from concrete steps such as `move`, `act`, `take`, `give`, `labour`, `sleep` and `effect`.

The broad priority is:

1. Put down anything being carried.
2. Sleep at bedtime.
3. Eat when severely hungry, or ordinarily hungry during a break.
4. Perform the founding sequence if it is active.
5. Work during work hours.
6. Spend the remaining time at leisure.

When somebody’s specialist work has nothing useful to do, they may fall through to General Worker tasks: supply construction, build, restock workshops, clear finished output and finally fetch emergency wood.

Plans are transient and must not be serialized. After loading, every villager decides again.

Deferred consequences belong in serializable `effect` steps rather than callbacks.

`SCHEDULE` in `defs.ts` owns the boundaries of the day. Keep the three visible gathering periods: morning, midday and evening. Traits may shift the outer ends of an individual’s day, but not the common midday break or the total amount of sleep.

Ordinary hunger waits for a break. Severe hunger may interrupt work.

A villager who genuinely has no available work may take one additional meal that day. Breaks, sleep, walking and decision time do not count as underemployment.

### Determinism

Gameplay randomness is part of the world.

Seed the gameplay RNG from the world seed and restore it from saved RNG state. Persistent randomness must live in `GameState` or the saved stream, not mutable module-level state.

The same seed and duration should produce the same simulation result.

### Founding

A new game begins with one person, no finished building and nowhere to store resources.

The opening asks one placement question: where the kingdom begins.

- The chosen campsite is a centered 3×3 footprint.
- `Founding.x/y` stores its center.
- `Building.x/y` stores the top-left corner.
- The Base Camp is the fire, first wood storage and first two beds.
- The founder cuts one ordinary tree for twelve wood and spends that load on the camp.
- There is no second placement or special opening-only resource.
- Nothing else appears in the build menu until founding finishes.

The founder may temporarily carry the kingdom’s entire stock during founding. That exception ends when the Base Camp stands.

The founder should remain purposeful while the player chooses a campsite. Do not allow the ordinary leisure planner to take over during the opening.

Hide resource displays until storage actually exists.

### Homes and population

Beds are the only population cap.

- The commons always provides two outdoor beds.
- Cabins provide their level’s bed count.
- Improving housing preserves its existing beds until the improvement completes.
- If housing is removed, nobody leaves; arrivals pause until capacity catches up.

Automatic home assignment prefers available indoor beds over the commons. A player-fixed home must not be silently reassigned.

A villager sleeping in a sheltered home is omitted from world rendering while asleep. The commons is not sheltered; its sleepers remain visible outdoors.

An arrival is a promise, not a repeated chance roll:

- with a free bed, somebody eventually arrives;
- population and Vibes determine where the arrival lands inside its window;
- a full kingdom freezes arrival progress;
- adding beds does not reset progress;
- only an actual arrival resets the arrival;
- the interface shows an estimated range, not the hidden jitter or a precise countdown.

The arrival clock does not run during founding.

A newcomer remains marked until the player opens that person’s card. The founder begins already met. Newcomer marks are unobtrusive and must not interrupt the player.

### Vibes

Vibes measure how pleasant the kingdom is, out of 100:

| Source | Maximum |
|---|---:|
| Decorations | 60 |
| Food security | 30 |
| Resident wellbeing | 10 |

Vibes affect only the timing of the next arrival within its existing window. They are not currency, do not gate construction and do not modify production.

Employment must never affect Vibes.

Do not penalize the player for a system that has not been unlocked. Before the kingdom has cooked food, food Vibes remain neutral rather than reading as failure.

Decoration limits are part of the design. Adding another comfort requires rebalancing the existing 60 points rather than raising the maximum.

---

## Buildings and progression

Buildings grow through improvement rather than disposable replacement.

Use `buildingName(def, level)` wherever a level-specific name is shown. `def.name` is appropriate only when offering the level-one building in the build menu.

Explicit upgrade-cost tables are preferable when later levels require different materials. Generic multipliers are appropriate only when the cost really scales uniformly.

Improving a building does not take its current services offline. Storage, housing and jobs continue at the existing level until the improvement completes.

### Building limits

Buildings have four limit models:

- **Commons:** exists once, is created through founding and cannot be moved or removed.
- **Unique production buildings:** one of each. Improve or relocate them rather than duplicating them.
- **Cabins:** limited by the current commons level.
- **Comforts:** limited by a fixed `maxTotal`.

`buildLimit()` is the authority for counts. Limited entries remain visible when full and explain the limit instead of disappearing.

A placement tool should release automatically once no more of that building can be placed. It should remain armed while additional copies are still allowed.

### Commons progression

The commons is the kingdom’s progression spine.

| Level | Requirements | Main result |
|---|---|---|
| Base Camp | Founding | Cabin, Lodge and Quarry |
| Settled Camp | Cabin, Quarry and three people | Second Cabin and Well |
| Village Commons | Cooked food, six people and a trained worker | Third Cabin and Standing Stone |
| Kingdom Commons | Deliberately unreachable in the current build | Future horizon |

No level may require something that the level itself unlocks.

Requirements should describe accomplishments that cannot later become false.

Every reachable cost must fit inside the storage available before it is paid. Before a Woodcutter’s Lodge exists, the Base Camp’s 100 wood is the absolute reachable limit for a wood cost.

The panel must show the full material cost, requirements and rewards before the action becomes available. A disabled button alone is not an explanation.

The final Commons level and Mithril Mine are visible horizons, not currently reachable content.

### Stone and mining

Stone comes from the Quarry and nowhere else.

- The Quarry must cost wood, never stone.
- Nothing before the Quarry may require stone.
- General Workers cannot mine stone.
- Clearing a surface boulder does not bypass the Quarry requirement.
- Surface boulders are finite scenery and do not regrow.

The mine works the rocky ground in its range, not boulder nodes. Rock richness affects speed but must never reduce production to zero.

The mining ladder is Quarry → Iron Mine → Deep Mine → Mithril Mine. Improving a mine adds materials without removing earlier ones.

One Miner trade operates the whole mine. Do not add separate workers or tools for individual materials.

### Food

There are two valid food branches:

```text
wheat → flour → bread
water → fish → cooked fish
```

Both lead to the Kitchen. A loaf and cooked fish satisfy hunger and Vibes equally.

Favorite food is personality only. It must never gate eating, production, Vibes or arrivals.

Fishing is an early, low-staff branch whose water rests after use. Bread requires more buildings and workers but scales further.

Water quality may affect yield, but water must never be exhausted. Fishing and wildlife remain separate systems; fish are not wildlife animals and habitat spawning does not determine catches.

### Working ranges

`rangeOf()` is the authority for a building’s working range. The planner, interface and placement overlay must agree with it.

Range checks are circular in tile space, not square scans.

When placing or moving a ranged building, show the same range its workers will use and explain the amount of useful terrain or resources within it.

### Relocation

Relocation preserves a building instead of replacing it.

- The original building remains operational while the new site is built.
- Its identity, name, level, workers, homes, stored resources and history remain attached to the original object.
- The building’s coordinates change only when relocation finishes.
- Farms receive fresh plots at the new ground.
- Starting or canceling either end of a move must clean up the other end.
- A building cannot be improved while moving.
- Both ends of a move must survive saving and loading.

A move costs full materials and labor. It is not a discounted rebuild.

### Claims

Use `claim()` and `releaseClaim()` for trees, plots and tasks.

Always release through `releaseClaim()`, because it also clears the claimed tile or plot state.

---

## Resources and storage

Every resource lives in the building responsible for producing or keeping it.

`Building.store` is the kingdom’s stock. Use the established storage helpers rather than introducing a shared pool:

- `homeFor`
- `sourceOf`
- `roomIn`
- `totalOf`
- `capacityOf`

Do not reintroduce a kingdom-wide stockpile or `nearestStore`.

A workshop input bench is not storage. It holds a small working supply; the resource’s home remains the building that produced it.

The Forge may consume its own stored bars as recipe inputs after checking its input bench.

A full compartment stops new collection for that compartment only. It must not stop unrelated production elsewhere.

The Storehouse is an ordinary building that is the home of every resource. It needs no special case anywhere: `holdsOf` folds its `holds` list in with what a building produces, and `homeFor` is nearest-wins. It exists to shorten the walk, not to raise a ceiling. Siting one is a decision about distance.

### Stored, owned, and what the player is shown

Four figures, and they are not interchangeable:

- `storedOf` — in the compartments. The only one `capacityOf` applies to.
- `benchOf` — on workshop benches.
- `carriedOf` — in somebody’s arms.
- `totalOf` — the sum of all three.

The **simulation** spends `totalOf`: affordability, food throttling and goals all count everything the kingdom physically owns. A cost that stopped being affordable because somebody picked the wood up would be a kingdom arguing with itself.

The **interface** headlines `storedOf`, because that is the figure a capacity can honestly sit beside. Never print `totalOf` against `capacityOf`.

Where the parts are broken out for the player, show exact numbers rather than abbreviated ones. The point of that block is that the parts add up, and “2.5k + 36 + 14 = 2.5k” reads as a game that cannot count.

### The Base Camp woodpile retires

The commons’ `cache` of 100 wood is founding scaffolding, not storage.

- When the first Lodge completes, `Building.cacheRetired` is set on the commons, permanently and saved.
- `storesOf(def, level, retired)` then drops the cache, so `capacityIn` reads zero and the camp stops accepting wood.
- Nothing is moved by the retirement. The wood already banked stays there until General Workers physically carry it to the Lodge — the clearing rung of the helper ladder, which fires on any compartment with goods and no room, however its room went away.
- It is one-way. A kingdom that later loses its Lodge does not get the cache back, which is why the interface refuses to demolish the last building with wood capacity.

Wood capacity is therefore a plain 250, then 1,000, once a Lodge stands. Verified by `npm run woodcheck`.

### Storage exposition

The model is explained once, in the intro card. After that it is demonstrated.

Do not add prose to a panel restating that resources live where they are produced. The rows in that panel already say it with numbers, and the carrying is visible on the map.

### Food throttling

Food is judged against the needs of the whole kingdom, but each job must consider the correct portion of the chain.

- Prepared foods are judged against prepared food.
- A producer considers its own stage and everything downstream.
- A job must never be stopped by stock waiting upstream for that job to process.

The Miller must not stop because the Farm holds wheat. The cook must not stop because raw ingredients exist. A source producer may consider the whole downstream chain.

Workshop restocking must respect whether the intended recipe should currently run.

### Emergency wood

General Workers may hand-fell trees only below `WOOD_RESERVE`, and they work at half a Woodcutter’s pace.

This is an emergency float, not a progression gate and not a competitive supply chain.

The reserve limits fetching, never spending or accepting delivery. Construction may consume wood in several loads while the reserve is replenished between them.

Wood is the only raw resource General Workers can collect by hand.

### Recipes and focus

Use `recipesOf()` for both single- and multiple-recipe buildings.

Every recipe interface must show all required inputs. A batch step records the output it is producing so a later focus change cannot alter an in-progress batch.

A production focus is a preference, not a command to stop. If the preferred material is currently excessive, the building may produce another available material.

Balance production against its intended target, not by trying to keep every resource pile equal.

### Deliveries

Putting down a carried load must never fail.

Collection should stop before a compartment overfills, but `deliver()` must accept an already-carried load. A small temporary overshoot is preferable to a villager permanently trapped carrying goods.

---

## Wildlife

Wildlife is driven by terrain, nearby props, farm plots, season, rarity and cooldowns.

A species is discovered only when it comes close enough to a villager or building to have plausibly been noticed.

A failed spawn location does not spend the species’ cooldown.

Persistent wildlife timing belongs in `GameState`. Derived habitat scores may be cached, but the cache must be rebuilt when opening or switching kingdoms.

Never expose exact spawn formulas in the interface. Use observational hints.

---

## Rendering invariants

### Pixel pipeline

World art is drawn to an offscreen buffer at one canvas pixel per art pixel, then enlarged with nearest-neighbor scaling at an integer scale.

Never:

- draw world content directly to the display canvas;
- introduce fractional world scaling;
- allow smoothing to blur the pixel art.

The buffer is always one canvas pixel per art pixel. Overview is the single exception to the *blit*: below 1× the buffer is larger than the display, so the last step is a downsample and smoothing is switched on for it. That exception belongs to Overview alone and is not a precedent for the zooms the game is played at.

Ground is baked into a map-sized canvas. Call `renderer.invalidateGround()` after terrain or season changes, and `renderer.setMapSize()` when a kingdom of a different size is adopted — islands generated before the island grew are 40×40 and still load.

Everything that overlaps moving actors participates in the depth-sorted pass. Buildings generally sort from the front of their footprint; farms sort from the back so crops appear correctly.

Procedural terrain, props and buildings belong in `sprites.ts`. Villagers and animals are drawn per frame in `actors.ts`.

Respect sprite `padX` and `rise` when positioning building art.

### Where detail is affordable

The two halves of the world art have opposite budgets, and this is the single most useful thing to know before adding to either.

**Buildings and props are baked once and cached**, keyed on def, level, season, seed and stage. Detail there costs bake time and nothing else, so it can be as fine as it is worth drawing.

**Villagers and animals are redrawn every frame, for everybody on screen.** A rectangle added there is paid twenty times a second times sixty. Spend that budget on *pose* rather than on ornament: at the zooms the game is actually played at, a stoop under a load reads across the whole map and a belt buckle does not.

### Building surfaces

A flat two-tone fill is a box, not a building. Every wall names a `texture` — `plank`, `log`, `stone` or `plaster` — and `wallTexture` draws its courses, joints, eaves shadow and foot line. A `frame` colour lays timber framing over the top.

Everything drawn on a wall runs *with* the face, off `wallFootY`, never along a screen row. A wall's foot climbs away from the near corner at one pixel in two; drawn flat, a course cuts across the building and reads as a crack.

All of it is derived from the face colour with `shade`, so a wall never needs a second palette kept in step with the first and a winter recolour carries its texture with it.

The gable is boarded vertically. It is the largest unbroken shape in the silhouette, and it is the one direction not already spoken for — the roof runs one way and the walls the other.

Copies of a building at the same level are identical on purpose. The silhouette carries the *level* read across the map, and variation that touches it would trade a fact the player needs for decoration.

### What somebody is holding

`toolFor` decides by activity first and by trade second: anybody can be handed a hammer and sent to a site, and a miner at the rock face and a cook at the range are both "working". The tool is drawn at the hand — the same pixel the arm ends on, swinging with it — never at a fixed offset from the body. A tool nobody is holding reads as a bug rather than as work.

### Sea and haze

The sea continues the world’s water pattern beyond the island. Do not restore a separate flat ocean color.

Atmospheric haze is a distance cue:

- draw it after the world so island and surrounding water fade together;
- draw it before placement tools so placement remains readable;
- keep the lighting fade separate from the visual haze.

### Lighting

Lighting uses a separate buffer containing ambient tint and light sources, then multiplies that over the world.

Anything intended to glow at night must contribute to the light buffer. Merely drawing it brightly in the world buffer will still make it dark.

The sky is the light source and must not receive the ground’s night tint a second time.

Cast shadows are collected into one buffer and composited once. Do not darken overlaps repeatedly.

### Transient effects and marks

Fishing splashes are transient simulation state and are not saved. They participate in depth sorting.

Activity badges are drawn after lighting so they remain readable, while still being reduced slightly by darkness.

Attention marks identify:

- a workplace with nobody assigned;
- a newcomer who has not been viewed.

They disappear in clean viewing mode. An unfilled extra job slot is not enough to mark a functioning workplace.

### Building hover

Hovering either a building’s painted sprite or its footprint may fade it.

Sprite hover must use painted-pixel hit testing rather than a simple bounding box. Footprint hover remains necessary because selection is tile-based.

Several overlapping buildings may fade at once.

Indoor sleepers are rendered over the faded building at reduced opacity. They are laid out in tile space and remain subject to depth sorting.

---

## Time of day

`render/sky.ts` is the single visual authority for time of day.

Three presentations must agree:

- the sky above the island;
- the day strip at the top of the interface;
- the direction of cast shadows.

The day strip also shows the kingdom’s work and break periods. Those periods come from `SCHEDULE`; do not duplicate their timings in interface code.

The strip represents the whole day rather than a moving local window. Every position and color on it must use the same rotated time mapping.

The strip is informational, not interactive. It must not consume pointer events or block map dragging.

The layout height used by the strip and the CSS offset beneath it must agree.

At the widest world view, the real sky replaces the day strip. Hiding the strip must also reclaim its layout space.

Only one celestial body is visible at a time. The moon is never completely invisible, because it remains a time cue during the night.

Time-of-day visuals do not add mechanics. They represent systems that already exist.

---

## Input and camera

Zoom uses the fixed ladder:

```text
0.5×, 1×, 2×, 3×, 4×, 6×
```

Integer from 1× up. Do not add smooth fractional zoom. Smooth the input, not the resulting scale.

The half step is **Overview** and is a place to look from rather than a scale to play at:

- entering it frames the island, so it is a picture of a small kingdom in a large sea rather than of the corner of one;
- the interface stands down bar four things, and each is there for its own reason: the **view pad**, because a way back that exists only as a click nobody has mentioned is a way back somebody will not find; the **toasts**, because parking out here is a thing to do all afternoon and they are the only thing that says anything happened; the **clock chip**, because the sun gives the hour and nothing gives the season; and the **sun and moon tooltip**, because the sun is the largest thing on the screen. Labels, badges, marks, tools and panels go, and what was open is restored on the way back. Clean view still wins over all four;
- the sky keeps its own size. Sun, moon, arc, haze and stars are scaled by `Renderer.skyK` so the island shrinks under a sun that does not;
- panning and every zoom input work normally, and a click anywhere returns to 1× looking at that spot. There is no written hint: the zoom-in cursor over the map is the whole of what says so;
- a key that asks for a panel (`B`, `P`, `J`) brings the view down first and then opens it. Nothing opens behind the fade, and such a key never toggles a panel shut from out here;
- it is the one place the pixel pipeline goes below one screen pixel per art pixel. The blit is a downsample and smoothing is switched on for it; on a retina screen it is exactly 2:1.

`ZOOM_HOME` and `ZOOM_START` name the two steps anything else needs: where Overview hands back, and where a new kingdom opens.

Scrolling zooms. Dragging pans.

`handleWheel()` distinguishes mouse-wheel notches, trackpad motion and browser pinch gestures. Preserve gesture-level classification rather than reclassifying every event.

Touch uses pointer events:

- one pointer pans;
- two pointers pinch;
- the canvas uses its own touch handling;
- `setPointerCapture` remains guarded because unsupported captures can throw.

The view pad provides zoom in, zoom out and recenter, as a vertical column at the right edge directly above the action cluster — the same geometry on every screen. It must never be covered by another panel; compact layouts may hide it while a sheet is open. It is positioned off the measured `--dock-h`, so it rides up when the dock grows a placement bar.

Disabled zoom controls still need usable explanatory labels, so their tooltips cannot depend on the disabled button receiving pointer events.

---

## Placement and removal

The founding placement arms itself and cannot be permanently canceled. Its marker shows the complete 3×3 camp footprint.

Ordinary building tools remain armed only while another copy may legally be placed.

Relocation is initiated from the specific building’s panel, never from a generic build-list mode.

On coarse-pointer devices, placement is preview-and-confirm:

1. A tap sets the candidate.
2. The ghost shows the proposed placement.
3. `placeProblem()` explains any problem in plain language.
4. Confirm performs the action.

Mouse placement remains click-to-build because the cursor has already provided a continuous preview.

Removal always asks for confirmation.

A building containing resources cannot be demolished. Do not destroy the stock or teleport it elsewhere. Relocation remains allowed because the building and its contents move together.

Every armed tool must show persistent instructions and a clear way to exit.

---

## Interface rules

`UIEnv` separates three independent conditions:

- `compact`: insufficient space for desktop rails;
- `short`: limited viewport height;
- `touch`: coarse pointer behavior.

Do not infer touch from width alone or desktop layout from width alone.

On compact screens, only one major sheet is open at a time. Selecting something on the map closes anything covering the map.

On desktop:

- kingdom-wide views may use modals;
- a selected building uses the side rail without a scrim;
- the map and build rail may remain usable beside the building card.

On compact screens, the same building content becomes a bottom sheet.

A modal normally closes the build rail because the scrim makes that rail unusable. A desktop building card is the exception because it has no scrim.

### The action cluster

There is one set of destinations and it is the same on every screen: **Kingdom**, **People**, **Build**, in the bottom-right corner, with Build nearest the corner.

Build is the only verb the game has. It is the largest control on screen, the only filled one, and being filled must go on meaning that — do not fill anything else.

The other two are places to look. Kingdom holds everything that is a matter of record rather than a matter of doing: the journal, the wildlife, what to do next, and the settings, as tabs of one panel. Four buttons for four things opened once an hour is furniture, not navigation.

`KTAB` in `nav.ts` names the tabs, so an entry point that wants a particular one asks for it by name rather than by number. Settings is three sections stacked in one scroll rather than three more tabs; tabs inside tabs is the shape of an interface that has stopped deciding what matters.

Do not add a fourth destination without removing one. If something new belongs to the kingdom's record, it is a tab.

Everything attached to the bottom edge belongs in the shared `.dock` layout. Position interface elements using measured layout variables rather than hard-coded offsets. The tool hint stays centred over the map because it is about the map; the cluster goes to the right-hand end because that is where the hand is.

Resource chips may wrap to their own row on narrow screens. This decision is based on width, not merely compact mode.

### The resource strip

Thirteen resources, four chips. Thirteen numbers are not thirteen questions.

`STRIP` in `hud.ts` is the authority for what the strip shows and in what order. Two shapes:

- a **single** is one resource with its own number — wood and stone, because they are what everything costs and they matter from the first minute to the last;
- a **group** is one question with several resources behind it. Food carries prepared meals; Goods carries the metal chain. The chip’s number answers the question, and the members open on hover or a tap.

A group’s headline counts its `headline` members if it has them and all of them otherwise. Food’s headline is prepared food only: wheat in a barn is not supper, and a chip counting it would say the kingdom was fed when it was not.

A chip carries one number and no capacity, no ratio, no meter. Room is a state rather than an arithmetic problem at this level, so it is shown as two marks:

- nearly full at 90% of capacity, subtle;
- full, stronger.

They are worth telling apart. One is a nudge with time to act on it; the other means production of that resource has stopped. Folding them together makes every warning read as an emergency. A group wears the worst mark of anything behind it, including resources outside its headline — a full ore compartment means the mine has stopped, whatever the meal count says.

A resource appears once the kingdom can produce it and stays once shown; a group with nothing behind it yet is not drawn at all. Wood and stone are always drawn, because a kingdom with none of either is a kingdom in trouble and hiding the chip would hide the trouble.

Exact capacity, the per-building breakdown, and the stored/bench/carried/owned split belong in the hover, the storage sheet and the building’s own panel — the places with room to be precise. The storage sheet is sectioned by the same groups in the same order, and a chip opens it at its own section.

The strip must fit one row at every width and every point in the game. If a new resource does not fit, it joins a group; it does not get a chip.

### The People panel

Two tabs, because the panel answers two questions that pull against each other.

**Roster** is person-first: a star, a likeness, what they are doing, their nature, their post and how fast they work it. **Jobs** is place-first: every finished workplace, the empty ones sorted to the top, with the spare hands as a card of their own at the foot.

`paceOf()` in `sim/state.ts` is the authority for how fast somebody works a trade — practice and nature multiplied together. The simulation multiplies a stint of work by it and the panel prints it, so the figure beside a name is the figure being used in the field. Never compute a second version of it for display. Condition — hunger, exhaustion — is deliberately *not* in it: what a person is worth at a trade does not change because they skipped lunch.

`traitJobMul()` in `defs.ts` is the authority for what a nature is worth at a trade, and `TRAIT_META.perk` is the sentence that says so. Both must agree. A trait whose effect is economic says its number; one whose effect is ecological or a matter of leisure — Animal Friend, Curious — stays observational, because ecology is mysterious and the economy is not.

The board shows what is standing empty and how many people are spare, and stops there. It puts no name forward, ranks nobody for you, and has no button that staffs the kingdom. Who works where is the player's judgement — a roster you press once and stop looking at is not a terrarium.

Favourites pin to the top of every ordering. The filter bar appears only once there are enough people for a shortlist to mean anything.

`workerOptions()` is shared with the building's own panel, which is the other place a job is filled from.

#### The nature chip and its hover

The roster's Nature column is a chip and nothing more; the sentence behind it lives in the hover, because two lines of prose per row turned twenty people into a wall of text. Only the part that changes — whether the nature is paying off in the job they currently hold — sits on the chip itself.

`#ui .tip` is the interface's one tooltip. Most are hung off the control they describe and shown on `:hover` by the stylesheet. A tip that cannot be — one belonging to a row inside a panel that scrolls, or to something in the sky — takes the `.skytip`/`.hovertip` form instead: `position: fixed`, one long-lived node, placed by the shell. `data-tip` on an element names what it is about, and the shell's delegated hover builds it; delegation matters because the panel rewrites its own markup several times a second.

Every tip is hidden on compact screens, because touch has no hover. Anything a tip says must therefore also be reachable without one — inline on the phone's card, or as `.sr-only` text beside the chip. A tooltip is never the sole home of a fact.

#### Renaming from the roster

One row at a time: the pencil beside a name swaps that row for a field. Not twenty always-editable inputs, which is a form rather than a roster, and which would take away the name as the way into somebody's card.

Every exit — return, clicking away, or the panel redrawing the field out from under the cursor — arrives at `focusout`, so that is the single place an edit ends. `change` only commits the name.

That redraw is deferred by a microtask, and it must stay deferred: replacing the panel's markup is itself what blurs the field, so rendering again from inside that assignment writes markup the outer render is about to overwrite. This is a general hazard with any handler that redraws in response to an event a redraw can cause.

### Live panels

Building panels, the population sheet and the People panel update several times per second.

- Do not redraw while a focused `<select>` is open.
- Update existing panel content without restarting modal transitions.
- Preserve scroll positions across genuine redraws.
- Use `setHtml()` rather than comparing serialized `innerHTML`.
- Portrait and building art are painted into existing canvas nodes.
- Keep portrait poses still; frequent panel refreshes make animation look broken.
- “Here now” has a stable height so people entering and leaving do not move the rest of the panel.

“Here now” means within one tile of the building footprint. It is not the same as belonging to the building or sleeping there.

### Accessibility

Accessibility behavior lives in `ui/a11y.ts`.

- Move focus into opened panels.
- Trap focus only inside true modals.
- Restore focus when a panel closes.
- Preserve focus through live redraws.
- Release or restore focus after the redraw, not onto a node about to be replaced.
- Keep interactive targets at touch-safe sizes.
- Use `touch-action: manipulation` on controls, not the entire interface.
- Do not disable browser text scaling globally.

---

## Recurring gotchas

- Hidden full-height interface containers must use `pointer-events: none`, with pointer events restored only on their interactive children.
- Scope pointer-event overrides strongly enough to beat `#ui > *`.
- Use `setHtml()` for redraw guards. Serialized `innerHTML` is not stable enough for equality checks.
- Never redraw a panel from inside a handler for an event that redrawing the panel fires. Replacing markup dispatches `focusout` on whatever was focused, synchronously, part-way through the `innerHTML` assignment; a nested render there is silently overwritten. Defer it a task.
- Preserve the explicit `z-index` ladder in `style.css`; do not rely on document order.
- The dock intentionally remains above compact modals because bottom navigation switches sheets.
- Vite serves `index.html` for unknown paths. Do not use a fake same-origin route to seed `localStorage`; the app will boot and may autosave over it.
- A new game must begin during work hours so the founder performs the opening.
- `noUnusedLocals` and `noUnusedParameters` are enabled.
- The interface draws its own icons. `ui/icons.ts` bakes every one of them into a stylesheet at boot, and nothing in `src/ui/` should contain an emoji. Art icons keep their own colours and are a `background-image`; glyph icons are a silhouette used as a `mask-image` over `currentColor`, so a button going gold takes its icon with it. Sizes are 12px and 24px and nothing between, or the art resamples.
- The simulation still writes a small character on journal entries and toasts, and that is its own voice, not the interface's. `iconFor()` recognises the ones it knows and falls back to drawing the character, so a new one added in `sim/` shows something rather than nothing.
- A native `<option>` is text and cannot hold an icon. Job dropdowns carry names alone.
- Emoji are unreliable in headless screenshots, which is one of the reasons the icons are drawn rather than borrowed. Important controls still require text labels.
- Hashing uses `Math.imul`. Plain multiplication can lose the coordinate terms above JavaScript’s safe integer precision.
- Required world-generation counts need deterministic fallback placement after random scatter.
- The rules used to count valid generation candidates must match the rules used to place them.
- Lake lobes grow along the shore, not outward through it. Validate lake changes with `worldcheck`.
- Increasing `SAVE_VERSION` makes older kingdoms unavailable unless an explicit migration exists. Do not bump it casually.
- Save incompatibility messages must be generic rather than naming one particular update.

---

## Conventions

- Comments explain **why**, not what.
- Player-facing copy says **storage**, not **store**.
- Use British-ish spelling in player-facing text: “favourite”, “colour”.
- Prefer data in `defs.ts` over branches in logic.
- User-facing copy is part of the design and must remain mechanically accurate.
- New actions should be visible on the map whenever possible.
- A shortage should cause waiting, not punishment or irreversible loss.
- Do not introduce tools, durability, personal inventories or invisible resource transfer without reopening the design explicitly.

---

## Deferred scope

The following original-brief systems are not currently built:

- expeditions;
- research and the Knowledge tree;
- merchants and visitors;
- domestic animals;
- aging and retirement;
- land expansion;
- daily and weekly goals;
- achievements and wider collections;
- villager requests.

There is currently no Carpenter, Scholar, Merchant or Animal Keeper profession.

Iron and steel bars currently have no consumer beyond their production chain.

Mithril definitions exist as a future horizon but are unreachable. The simulation should fail if mithril appears in a normal kingdom.

Deferred does not mean automatically approved. Any of these systems still needs to fit the terrarium principles and current implementation.

---

## Deliberately removed

These are resolved design decisions, not missing work.

| Removed mechanic | Current rule |
|---|---|
| Shared kingdom storage | Every resource lives in the building responsible for it |
| Coins and goal payouts | No currency or invisible material rewards |
| Deadfall | The founder cuts an ordinary renewable tree |
| Hand-mining | Stone and ores require the mine |
| Renewable boulders | Surface boulders are finite scenery; the mine’s seam is endless |
| Separate mining professions | One Miner works every mine level |
| Tools and durability | Difficulty belongs in building numbers, not equipment upkeep |
| Duplicate production buildings | Principal production buildings are unique and relocatable |
| Unlimited decorations | Comfort limits define the 60 decoration Vibes |
| Arrival chance rolls | A free bed guarantees an arrival within a window |
| Player-built roads and paths | Natural terrain affects movement; players cannot buy faster routes |
| Reachable Kingdom Commons and Mithril Mine | Their final levels remain visible but deliberately unreachable |

Do not reintroduce one of these as a tidy-up or convenience. Reopening one is a product decision.

In particular:

- Never make a resource appear as a reward when nobody carried it.
- Never make arrivals randomly fail after the player has provided a bed.
- Never make surface stone renewable or allow General Workers to mine it.
- Never make duplicate principal production buildings the optimal strategy.
- Never restore roads without explicitly revisiting the product direction.

---

## Stable scale reference

Exact tuning belongs in `defs.ts`. These figures describe the current shape of the game and should remain synchronized with the code.

| System | Current scale |
|---|---|
| Map | 44×44 tiles |
| Day | 30 real minutes at 1× |
| Season | 6 game-days |
| Year | 24 game-days |
| Workday | Morning work, midday break, afternoon work, evening leisure |
| Population cap | Beds only |
| Commons beds | 2 at every level |
| Cabin beds | 2, 4 or 6 by level |
| Cabins allowed | One per Commons level |
| Arrival pacing | Guaranteed within a population-based window when a bed is free |
| Vibes | 60 decoration + 30 food + 10 wellbeing |
| Base Camp storage | 100 wood, retired once a Lodge opens |
| Produced-resource storage | Separate compartment per resource |
| Workshop inputs | Small working buffers, separate from permanent storage |
| Production buildings | One of each principal building |
| Mastery | Roughly 10–15 real hours in one trade |
| Founding | Roughly a minute and a half at 1× |

The Base Camp’s 100 wood is the important early constraint: no reachable pre-Lodge cost may exceed it.

Storage capacity is intentionally generous after production buildings exist. Do not add generic overflow storage unless playtesting demonstrates a real need.

A healthy long simulation may finish with several raw-material compartments full. Full storage is not automatically a problem when nothing is waiting for those materials.