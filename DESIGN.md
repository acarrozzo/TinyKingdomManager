# Tiny Kingdom Manager

**Working title / repo name:** Tiny Kingdom Manager (`TKM`)

> This is the original design brief, kept verbatim as the statement of intent for
> the project. It describes the full intended shape of the game, most of which is
> deliberately not built yet. See `CLAUDE.md` for what actually exists today and
> `README.md` for how to run it.
>
> Where this document and the code disagree, this document describes the goal and
> the code describes the current state. Neither is automatically wrong.

Build a browser-based, peaceful, isometric kingdom simulation. The core fantasy is not conquest, survival, or winning. It is creating, managing, observing, and slowly growing a tiny living kingdom that feels pleasant enough to leave running on a side monitor.

The game should feel partly like a management game and partly like a digital terrarium. The player creates the conditions for life to unfold, but many of the most charming moments should happen naturally through the behaviors and interactions of villagers, animals, buildings, resources, time, and the environment.

Do not overcomplicate the initial version. Prioritize a strong, understandable core loop that can be expanded later.

Do not interpret this document as prescribing technical architecture or implementation details. Choose appropriate technical solutions yourself.

---

# Core Experience

The player should be able to actively manage the kingdom when they want to, but they should never feel pressured to constantly interact.

A player might spend ten minutes carefully reorganizing jobs, building roads, optimizing production, and planning an upgrade.

Then they might spend the next twenty minutes doing nothing except watching villagers work, animals wander through town, night arrive, lights come on, and the settlement quietly operate.

Both should feel like valid ways to play.

The kingdom should feel like a living place rather than a dashboard with numbers attached to it.

Important qualities:

- peaceful
- wholesome
- sincere
- lightly humorous
- slow-growing
- visually pleasant
- satisfying to observe
- understandable without being simplistic
- deep enough to optimize
- forgiving
- never stressful
- highly personal over time

There is no traditional win condition.

The player is building a place they live with.

Eventually they may unlock most or all of the game's systems, but the settlement can continue existing, changing, improving, and accumulating history.

---

# Starting Experience

The player begins with:

- one villager
- no buildings
- no established settlement
- essentially nothing beyond the natural environment

The first villager must begin gathering basic resources manually.

The early progression should feel tangible.

For example, the player might first gather enough wood to construct a primitive shelter, then storage, then establish the beginnings of a functioning settlement.

This first villager should remain memorable because they are literally the founder of the kingdom.

The game should not immediately overwhelm the player with menus, systems, resources, or dozens of building choices.

Introduce mechanics gradually through natural progression and onboarding goals.

---

# The World

The kingdom exists as a compact isometric world.

It should remain relatively small compared with traditional city builders.

Even a mature kingdom should feel like one cohesive place rather than a sprawling metropolis.

The camera should support:

- panning
- zooming in closely to observe individuals
- zooming out enough to view the entire kingdom
- a fixed isometric viewing angle

The map can expand over time by unlocking neighboring pieces of land.

Expansion should happen in meaningful chunks rather than endlessly extending a giant rectangle.

New areas can introduce things such as:

- forests
- meadows
- rivers
- lakes
- rocky terrain
- new resources
- new wildlife
- additional building opportunities

The kingdom should never become absurdly large.

---

# Building Placement

The player chooses where buildings are constructed.

Roads and paths are also placed by the player.

Placement should matter, but this should not become a hardcore logistics puzzle.

Roads should provide a meaningful movement benefit.

For example, villagers might move significantly faster on roads than across undeveloped terrain.

Exact balance can be adjusted during development.

The player should be encouraged to care about both:

- efficiency
- appearance

A beautiful village that is slightly inefficient should still be perfectly viable.

---

# Construction

Buildings should not instantly appear when purchased.

Construction requires resources and actual villager labor.

Villagers should visibly participate in building.

Construction itself should therefore become something enjoyable to observe.

Watching the settlement physically change is part of the reward.

---

# Buildings

Buildings have specific purposes and may create job slots.

Examples of eventual building categories include:

- shelters and homes
- storage
- farms
- mills
- bakeries
- lumber-related buildings
- stone-related buildings
- workshops
- markets
- schools
- libraries
- animal buildings
- decorative/community structures

Do not introduce all of these immediately.

Buildings can be upgraded manually by the player.

Upgrades should be limited, meaningful, and preferably visually noticeable.

Avoid an infinite incremental system such as "Bakery Level 87."

An upgraded building might gain:

- increased capacity
- more worker slots
- improved production
- greater storage
- additional capabilities
- visible improvements

Residential buildings can have different capacities and purposes.

Multiple villagers may share a residence.

There are no family or romantic relationship systems.

Villagers are individuals who happen to live together.

Some later housing types may provide different capacity, functionality, profession support, or other gentle strategic advantages.

---

# Core Resources

Keep the initial resource economy intentionally small.

Foundational materials should include things such as:

- Wood
- Stone

Then introduce basic production resources gradually.

A simple early food production chain might be:

Wheat → Flour → Bread

Additional goods can later come from:

- farming
- animals
- workshops
- natural resources
- more advanced production chains

Production chains are encouraged, but avoid turning the game into an overwhelming industrial spreadsheet.

Resources are not primarily survival meters.

Runniut of something should usually cause a system to slow down or stop rather than create a catastrophe.

Examples:

- No flour → bakery waits.
- No wood → construction pauses.
- No available housing → population growth stalls.
- Full storage → producers wait.

The kingdom can stall.

It should not collapse.

---

# Storage and Physical Logistics

Resources should exist as more than abstract numbers whenever practical.

Villagers should visibly transport goods through the world.

For example:

- wheat is harvested
- a villager carries it toward storage or processing
- flour moves to the bakery
- bread eventually enters storage or another destination

Storage capacity should matter, but limits should be generous enough that inventory management does not become tedious.

Storage buildings can become part of settlement optimization.

Their location should matter because villagers physically travel between locations.

This makes the economy visible.

A player should often be able to understand what is happeply by watching the settlement.

---

# Jobs

Villagers can be assigned professions.

New villagers should begin in a general-purpose role such as **Helper**.

Helpers can perform basic communal tasks such as:

- gathering
- transporting goods
- helping with construction
- handling simple unspecialized work

Buildings create specialized job opportunities.

Examples might eventually include:

- Farmer
- Miller
- Baker
- Carpenter
- Stoneworker
- Scholar
- Animal Keeper
- Merchant
- Explorer

The player chooses job assignments.

Reassigning workers should create gentle strategic tradeoffs.

For example, moving a skilled farmer into a newly built mill might improve flour production but temporarily reduce wheat production.

Nothing disastrous happens.

The player is simply balancing the organism.

---

# Villager Experience

Villagers gain experience by actually performing professions.

Experience should accumulate independently across professions.

A villager's long history therefore creates meaningful specialization.

A founding villager who spent years farming might become extremely skilled at farming.

If later reassigned to another profession, their previous farming experience remains part of their history.

Use these experience ranks:

- **Novice:** 0–24
- **Adept:** 25–49
- **Journeyman:** 50–74
- **Expert:** 75–99
- **Master:** 100

The exact rate of progression can be tuned later.

The important idea is that expertise is earned through time and experience rather than primarily generated from random starting stats.

This makes long-term villagers valuable and memorable.

---

# Villager Identity

Villagers are actual individual entities.

A mature kingdom may eventually support roughly **50–100 villagers**, with around 100 serving as an approximate upper limit.

Growth should be slow enough that the player has a chance to know many of them.

Villagers should have:

- a generated name
- the ability for the player to rename them
- a residence
- a current job
- work experience/history
- possibly onght trait
- a record of meaningful history
- the ability to be favorited

Clicking a villager should reveal a compact biography or profile.

Avoid excessive RPG statistics.

Most individuality should come from:

- what they have done
- how long they have lived in the settlement
- professions they have mastered
- expeditions they joined
- notable events they experienced
- places they frequent
- visual appearance
- their name

---

# Villager Traits

Villagers may have one subtle trait that adds individuality.

Traits should be gentle and should not turn villagers into min-maxable RPG units.

Possible examples:

- Green Thumb
- Animal Friend
- Crafty
- Curious
- Early Riser
- Night Owl
- Outdoorsy

Traits may influence small behaviors, work tendencies, skill growth, or preferred activities.

The player's accumulated history with a villager should matter more than their trait.

---

# Villager Population Growth

New villagers should arrive rarely enough to feel meaningful.

Do not rapidly spawn new people simply because housing exists.

There should be a natural buffer or delay between arrivals.

A new resident should feel like an event.

For example:

"A traveler has decided to settle here."

Then that person becomes a real individual in the world.

Population growth should depend on appropriate settlement conditions such as available housing and general progression, but it should not become a survival/happiness equation.

---

# Aging and Retirement

Do not make aging, death, or retirement a major requirement for the first version.

However, leave conceptual room for it as a future system.

There is interest in eventually having villagers age through long periods of active gameplay and perhaps retire from the workforce.

This could create generational change and make the player's oldest villagers emotionally meaningful.

The final form of this system is deliberately unresolved.

Do not make death a central mechanic at this stage.

---

# Villager Daily Behavior

Villagers should feel alive outside of work.

A major portion of the simulation should consist of behaviors that provide no numerical bonus at all.

Examples:

- walking home
- sitting on a bench
- wandering through a garden
- visiting a shop
- talking with another villager
- fishing
- standing near a pond
- watching animals
- visiting a tavern
- gathering in public spaces
- relaxing near their home
- petting an animal
- attending a seasonal gathering

Do not attach a statistic to every charming interaction.

Sometimes someone should sit under a tree simply because that is what a person might do.

Occasional short speech or thought bubbles are welcome.

Examples:

"Nice weather."

"Long day."

"Look at that rabbit."

Keep these sparse enough that they remain charming.

---

# Following Individuals

The player should be able to select a villager or animal and comfortably observe them.

A follow-camera behavior would be useful so a player can simply watch a favorite individual go about their day.

This reinforces the terrarium aspect of the game.

---

# Wildlife

Wildlife should be present before domestic animals.

Possible early wildlife includes things such as:

- rabbits
- squirrels
- birds
- deer
- ducks
- frogs
- foxes
- butterflies
- bees

Wildlife is not merely decoration.

Animals should react to the environment and to one another through simple simulation rules.

Examples:

- rabbits prefer certain open spaces
- squirrels favor trees
- ducks gather near water
- frogs appear around ponds
- butterflies become more common around flowers
- deer visit certain natural areas
- birds gather near farms

These interactions should create emergent little stories the player did not directly trigger.

---

# Environmental Ecology

The environment should influence which animals appear.

Players can therefore indirectly shape wildlife by changing the kingdom.

For example:

- plant more trees → different woodland animals become more likely
- create a pond → ducks and frogs may appear
- create flower-rich spaces → butterflies or bees may become common
- estabarms → new animal interactions emerge

This should feel like cultivating an ecosystem rather than clicking a button labeled "Spawn Rabbit."

Do not expose exact spawn percentages or formulas to the player.

Let players discover the relationships.

A wildlife journal or collection can gradually reveal observational hints such as:

"Rabbits seem to prefer open meadows and gardens."

The economic systems should generally be understandable and transparent.

The ecology can remain partly mysterious.

---

# Animal Identity

Wild animals begin with generic labels such as:

- Rabbit
- Squirrel
- Duck

The player may eventually choose to name particular animals.

Favoriting animals is encouraged.

A random squirrel can become meaningful simply because the player has watched it for a long time.

Domestic animals can arrive later through unlocked buildings and progression.

---

# Domestic Animals

Domestic animals are a later-stage mechanic.

They might eventually include:

- chickens
- sheep
- cows
- dogs
- cats
omestic animals should be connected to appropriate buildings or spaces.

For example:

- chickens require a coop
- sheep need an appropriate enclosure or pasture
- cattle require suitable space

These animals may later contribute goods to production chains.

Do not make them required in the earliest game.

---

# Decorations and Beauty

Decoration is an important part of the game.

Possible decorative elements include:

- trees
- flowers
- benches
- fences
- lanterns
- gardens
- ponds
- statues
- paths
- shrubs
- community spaces

Not everything must provide a mechanical benefit.

Making the kingdom beautiful is itself a valid player goal.

Players should be able to create inefficient but lovely settlements without being punished.

---

# Time

Game time advances only while the game is actively loaded.

When the player closes the game, the kingdom pauses.

There is no meaningful offline simulation in the initial version.

When the player returns, the kingdom resumes where it left off.

A complete kingdom day should last approximately **30 minutes of active play**.

A rough rhythm:

- approximately 20 minutes of daytime/activity
- approximately 10 minutes of nighttime/rest

Villagers do not all need to perform actions at identical moments.

Their schedules should feel organic.

They can wake gradually, travel to work, finish tasks, wander, return home, and eventually sleep.

Most villagers sleep at night, although a very small number may occasionally remain active depending on behavior or traits.

---

# Night

Night should be peaceful and visually appealing.

It is not a danger phase.

Possible changes include:

- villagers returning home
- lights appearing in buildings
- quieter environmental audio
- nocturnal wildlife
- insects
- moonlight
- different idle behaviors

The player should sometimes enjoy simply watching night pass.

---

# Seasons

Seasonal change is desirable.

A useful initial pacing assumption is:

- approximately 3 active real-world hours per season
- approximately 12 active real-world hours per full in-game year

This can be tuned later.

Seasons should primarily create variety rather than punishment.

Examples:

**Spring**
- flowers
- rain
- new wildlife
- planting activity

**Summer**
- bright vegetation
- strong crop production
- outdoor activity

**Autumn**
- leaf color changes
- harvesting atmosphere
- different wildlife behavior

**Winter**
- snow
- altered production
- winter activities
- different visitors or wildlife
- warmer lighting around buildings

Do not turn winter into a survival challenge.

---

# Economy

The economy is about balance, growth, optimization, and surplus.

There should not be a single objectively correct strategy.

Players can make settlements that emphasize different things while still succeeding.

Surplus resources should have value.

Extra goods might eventually be:

- sold
- traded
- contributed toward goals
- used for expeditions
- exchanged for rare materials
- required for upgrades

Coins can become one economic resource, but avoid making taxation the emotional center of the kingdom.

Traveling merchants and trading surplus are good sources of currency.

---

# Visitors

Traveling visitors can occasionally enter the kingdom.

Examples:

- merchants
- wandering craftspeople
- travelers
- scholars
- unusual visitors

Visitors may remain temporarily.

A visible indication of how long they intend to stay can create interesting small opportunities.

Some may offer:

- trade
- unusual items
- resources
- temporary services
- new opportunities
- eventual settlement

Keep this system light and friendly.

---

# Expeditions

Expeditions are an advanced system, not an early-game requirement.

They should become useful once the player has established surplus resources and a functioning settlement.

The player manually prepares an expedition.

They may commit things such as:

- villagers
- food
- tools
- resources
- coins

The selected villagers physically leave the kingdom and are temporarily unavailable for normal work.

Different destinations can offer different possible outcomes.

Possible destinations include:

- forests
- mountains
- coastlines
- ruins
- distant settlements
- unexplored regions

Expeditions can return with:

- resources
- rare materials
- collectibles
- artifacts
- seeds
- wildlife discoveries
- new opportunities
- visitors
- knowledge

Repeated exploration may reveal more about a destination over time.

The expedition system should primarily provide an interesting sink for excess resources and a source of discoveries.

It should not become a second tactical combat game.

---

# Research and Knowledge

There should be a visible technology or research progression.

Knowledge can eventually be generated through buildings and professions such as:

- school
- library
- scholar

Players spend accumulated Knowledge on new capabilities.

Research should unlock meaningful systems rather than tiny percentage boosts whenever possible.

Examples:

- new building types
- production methods
- new upgrades
- improved logistics
- new farming capabilities
- animal systems
- expeditions
- advanced crafting
- new land opportunities

Some unlocks can also happen naturally through kingdom milestones.

Use both:

- deliberate research
- organic progression milestones

---

# Progression

There are several overlapping forms of progression.

## Kingdom Progression

- population
- buildings
- upgraded buildings
- production capacity
- land expansion
- infrastructure
- increasingly sophisticated goods

## Villager Progression

- profession experience
- accumulated history
- meaningful careers
- expedition experience
- individual stories

## Knowledge Progression

- technology
- research
- system unlocks

## Discovery Progression

- wildlife
- plants
- resources
- visitors
- locations
- expedition findings
- rare events

## Collection Progression

Possible collections include:

- discovered wildlife
- named/favorited animals
- plants
- crafted goods
- foods
- visitors
- expedition discoveries
- artifacts
- buildings
- achievements

Rare discoveries are welcome.

For example:

"A snowy owl has visited the kingdom for the first time."

These moments should be small but satisfying.

---

# Goals

The game can contain several types of goals.

## Onboarding Goals

Teach the early game naturally.

Examples:

- gather your first wood
- build a shelter
- create storage
- establish a basic production chain
- assign a specialized job

## Long-Term Milestones

Examples:

- reach a certain population
- construct important buildings
- unlock new land
- produce a specific good
- complete a research branch

## Villager Requests

Small optional requests can appear occasionally.

Avoid binary moral-choice events.

Prefer concrete requests tied to the simulation.

## Daily Goals

Provide optional short-term direction.

## Weekly Goals

Provide larger optional objectives.

## Achievements and Collections

Reward discovery, experimentation, and long-term play.

Daily and weekly systems should never create punishment or severe FOMO.

Missing a goal should not damage the kingdom.

---

# Events

Avoid disaster-heavy events.

No major emphasis on:

- fires
- plagues
- violent raids
- catastrophic winters
- starvation
- death spirals

Gentle setbacks are welcome.

Examples:

- rain temporarily reduces a type of work
- a production building lacks materials
- an area needs maintenance
- a traveler creates an unusual opportunity
- a seasonal condition changes production
- a supply chain becomes bottlenecked

Problems should generally create something to solve rather than something to fear.

---

# Kingdom Journal

The kingdom should gradually accumulate history.

A journal can record notable moments such as:

- settlement founded
- first building completed
- first newcomer arrived
- first Master profession achieved
- new animal discovered
- new land unlocked
- expedition completed
- rare visitor arrived
- major building upgraded
- new season/year began

Example tone:

**Year 3, Spring**

The first bakery opened.

This should become a quiet record of the player's specific kingdom.

---

# Clean Viewing Mode

This is an important feature.

The player should be able to hide nearly all management UI.

In this mode, the screen should primarily show:

- the isometric kingdom
- villagers
- animals
- weather
- lighting
- environmental animation

Only very subtle essential information should remain, such as perhaps:

- current time of day
- season
- a minimal way to restore the interface

The result should almost stop looking like a conventional game.

It should feel like a tiny living world sitting on the player's screen.

This viewing mode is not an afterthought.

It is part of the core fantasy.

---

# Visual Direction

Use a **pixel-art-ish** visual direction.

The world should feel:

- miniature
- charming
- readable
- warm
- lively
- visually clean
- pleasant when viewed for long periods

Do not make the environment visually noisy.

Villagers and animals should be distinct enough that players can recognize favorites, especially when zoomed in.

Buildings should visibly improve as they are upgraded.

Day/night and seasonal changes should strongly affect atmosphere.

---

# Audio Direction

Audio should be pleasant enough to leave running.

Prioritize ambient environmental sound.

Examples:

- birds
- wind
- water
- footsteps
- subtle construction sounds
- farming
- animals
- distant work activity
- rain
- nighttime insects
- crackling fire
- occasional bells or environmental moments

Music should not feel constantly busy or demanding.

Silence and environmental ambience are valuable.

The world should sound alive without exhausting the player.

---

# Player Identity

Do not strongly define the player as:

- king
- queen
- mayor
- god
- governor

The player is simply the person tending and managing this place.

The relationship should feel closer to caretaker/observer/manager than authoritarian ruler.

---

# Tone and Humor

Keep the tone light, wholesome, sincere, and friendly.

Small understated jokes are welcome.

Avoid excessive whimsy, meme humor, or constant jokes.

Characters and events should occasionally be funny because mundane life is funny.

The world should ultimately feel earnest.

---

# Important Design Boundary

The game should contain enough management depth that:

- supply chains can be optimized
- jobs can be balanced
- roads matter
- storage placement matters
- villagers become specialized
- buildings can be upgraded
- resources can bottleneck
- expeditions require planning

But none of those systems should turn the experience stressful.

If the player ignores the kingdom, systems can eventually stall.

That is fine.

The settlement should not punish the player for looking away.

---

# Initial Scope

For the first genuinely playable version, concentrate on proving the core experience rather than implementing every future mechanic.

The most important early loop is:

1. Begin with one villager.
2. Gather basic natural resources.
3. Construct the first shelter.
4. Establish storage.
5. Place additional buildings.
6. Assign jobs.
7. Produce basic resources and goods.
8. Physically move those goods through the settlement.
9. Grow slowly.
10. Unlock additional capabilities.
11. Observe villagers and wildlife behaving naturally between player actions.

A modest but polished simulation is preferable to many shallow systems.

Features such as domestic animals, deep expeditions, retirement, large research trees, and extensive collections can expand from the working foundation.

---

# Final Vision

The emotional endpoint is not:

"I beat the game."

It is closer to:

"I remember when there was only one person here."

The player should eventually zoom out and see roads, homes, farms, workshops, gardens, wildlife, lights, villagers they recognize, skilled workers they have known for hours, and systems they personally arranged.

Then they should be able to hide the interface and simply watch it all live.

That journey—from one person gathering their first piece of wood to a small, beautiful, functioning kingdom—is the game.
