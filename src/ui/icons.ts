/**
 * The interface's own pixel art.
 *
 * Everything in here used to be an emoji. That was always a compromise and it
 * showed in three separate ways: the glyphs are drawn by the operating system,
 * so a kingdom rendered in hand-placed pixels was labelled in Apple's rounded
 * gradients on one machine and Microsoft's flat vectors on the next; they carry
 * their own colour, so a button could never tint its own icon to say it was
 * active; and half of them do not exist at all in a headless browser, which is
 * how the project takes its screenshots. Drawing them ourselves fixes all three
 * and — the actual point — makes the interface look like it belongs to the
 * game it is wrapped around.
 *
 * Two kinds, and the difference matters:
 *
 * - **Art** icons are objects — a log, a loaf, a rock. They are drawn in their
 *   own colours and used as a `background-image`, because a piece of wood is
 *   brown regardless of what the button around it is doing.
 * - **Glyph** icons are symbols — a hammer, a chevron, a tick. They are drawn
 *   as a silhouette and used as a `mask-image` over `currentColor`, so they
 *   take the colour of whatever they sit in and go gold when their button does.
 *
 * Both are baked once at boot into a single stylesheet of `background-image`
 * and `mask-image` rules, rather than inlined into markup. Panels here rewrite
 * their own HTML several times a second and compare the result against what
 * they last wrote; a data URL of several hundred characters repeated across
 * every row of a roster would make that comparison — and the markup — many
 * times bigger for no gain.
 *
 * Grids are twelve by twelve. That is small enough to have to mean something
 * with every pixel and large enough for a fish to read as a fish. They are
 * baked at 2× so a 12px icon is a clean halving on an ordinary display and a
 * clean 1:1 on a retina one, and a 24px icon is the reverse.
 */

/** Art pixels per side. Every grid below must be exactly this square. */
const GRID = 12;

/**
 * Backing pixels per art pixel in the baked image. Two, so that both sizes the
 * interface uses land on whole pixels: a 12px box halves it, a 24px box shows
 * it as it was drawn, and neither has to interpolate.
 */
const SCALE = 2;

/**
 * The colours the art icons are drawn from — the same warm, slightly dusty
 * range the map uses, so a log in the top bar and a log on the ground are
 * recognisably the same material. Capitals are lighter than their lowercase
 * partner where a pair exists.
 */
const PALETTE: Record<string, string> = {
  K: '#20180f', // outline, everywhere
  D: '#453425', // deep shade
  W: '#a86f3c', // wood
  V: '#d3a069', // wood, lit
  N: '#7a4d24', // wood, deep — also brown ore
  S: '#9aa2ab', // stone
  T: '#c9d0d8', // stone, lit
  G: '#69707a', // stone, shaded
  Y: '#dfb85b', // wheat, gold
  Z: '#f4e0a6', // gold, lit
  C: '#e6dac2', // flour, cream
  B: '#c78a4b', // bread
  F: '#7cadc6', // fish
  L: '#bcdff0', // pale blue, lit
  O: '#e5904a', // ember, orange
  R: '#cf5f4e', // red
  E: '#f5d067', // ember, lit
  M: '#9ea5ad', // metal
  P: '#d6dde6', // metal, lit
  X: '#37373b', // coal
  g: '#7cab58', // leaf
  h: '#a6d27a', // leaf, lit
  p: '#c98ecb', // petal
  t: '#5c98b3', // water
};

/**
 * Objects, drawn in their own colours. A dot is nothing; every other character
 * indexes the palette above.
 */
const ART: Record<string, string[]> = {
  // ---------------------------------------------------------------- resources
  // Seen end-on, because the rings are the part nobody mistakes for a rock.
  wood: [
    '............',
    '............',
    '..KKKKKKKK..',
    '.KVVVVVVVVK.',
    '.KVWWWWWWVK.',
    '.KVWNNNNWVK.',
    '.KVWNVVNWVK.',
    '.KVWNNNNWVK.',
    '.KVWWWWWWVK.',
    '.KVVVVVVVVK.',
    '..KKKKKKKK..',
    '............',
  ],
  stone: [
    '............',
    '............',
    '....KKKK....',
    '..KKTTTTKK..',
    '..KTTSSSTK..',
    '.KTSSSSSSTK.',
    '.KSSSSSSSGK.',
    '.KSSSGSSGGK.',
    '.KGSSGGGGGK.',
    '..KGGGGGGK..',
    '...KKKKKK...',
    '............',
  ],
  wheat: [
    '............',
    '.....Y......',
    '....ZYZ.....',
    '....YYY.....',
    '...ZYZYZ....',
    '...YYYYY....',
    '....ZYZ.....',
    '....YYY.....',
    '.....Y......',
    '....gYg.....',
    '.....g......',
    '............',
  ],
  // A sack rather than a bowl: flour is a thing that gets carried about.
  flour: [
    '............',
    '....KKK.....',
    '...KCCK.....',
    '...KCCCK....',
    '..KCCCCCK...',
    '..KCCCCCK...',
    '.KCCCCCCCK..',
    '.KCCCCCCCK..',
    '.KCDDDDDCK..',
    '.KCCCCCCCK..',
    '..KKKKKKK...',
    '............',
  ],
  bread: [
    '............',
    '............',
    '...KKKKKK...',
    '..KBBBBBBK..',
    '.KBNNBNNBBK.',
    '.KBBBBBBBBK.',
    '.KBBBBBBBBK.',
    '.KNBBBBBBNK.',
    '..KBBBBBBK..',
    '...KKKKKK...',
    '............',
    '............',
  ],
  fish: [
    '............',
    '............',
    '...KKKK.....',
    '..KFFFFKK.K.',
    '.KFKFFFFFKKK',
    '.KFFFFFFFFFK',
    '.KLFFFFFFFFK',
    '.KLFFFFFFKKK',
    '..KLFFFKK.K.',
    '...KKKK.....',
    '............',
    '............',
  ],
  // On a plate, because the difference between this and a fish is the kitchen.
  cookedFish: [
    '............',
    '............',
    '....KKKK....',
    '...KOOOOK...',
    '..KOOEEOOK..',
    '.KKOOOOOOKK.',
    'KTTTTTTTTTTK',
    'KTTTTTTTTTTK',
    '.KKKKKKKKKK.',
    '............',
    '............',
    '............',
  ],
  ironOre: [
    '............',
    '............',
    '....KKKK....',
    '..KKGGGGKK..',
    '..KGNNGGGK..',
    '.KGGNNGGNGK.',
    '.KGGGGGNNGK.',
    '.KGNNGGGGGK.',
    '.KGGGGGNGGK.',
    '..KGGGGGGK..',
    '...KKKKKK...',
    '............',
  ],
  coal: [
    '............',
    '............',
    '....KKKK....',
    '..KKXXXXKK..',
    '..KXXXXXXK..',
    '.KXXXGXXXXK.',
    '.KXXXXXXGXK.',
    '.KXGXXXXXXK.',
    '.KXXXXXGXXK.',
    '..KXXXXXXK..',
    '...KKKKKK...',
    '............',
  ],
  ironBar: [
    '............',
    '............',
    '............',
    '....KKKKK...',
    '...KPPPPPK..',
    '..KMMMMMMMK.',
    '.KMMMMMMMMMK',
    '.KMMMMMMMMMK',
    '..KKKKKKKKK.',
    '............',
    '............',
    '............',
  ],
  steelBar: [
    '............',
    '............',
    '.....KKKKK..',
    '....KPPPPPK.',
    '...KPPPPPPPK',
    '...KKKKKKKKK',
    '..KKKKKKK...',
    '.KPPPPPPPK..',
    'KPPPPPPPPPK.',
    'KKKKKKKKKKK.',
    '............',
    '............',
  ],
  mithrilOre: [
    '............',
    '.....K......',
    '....KLK.....',
    '...KLLLK....',
    '..KLLLLLK...',
    '.KLLtLLLLK..',
    '.KLLtLLLLK..',
    '..KLLtLLK...',
    '...KLLLK....',
    '....KLK.....',
    '.....K......',
    '............',
  ],
  mithrilBar: [
    '............',
    '.....L......',
    '....LKL.....',
    '.....L......',
    '....KKKKK...',
    '...KLLLLLK..',
    '..KLLLLLLLK.',
    '.KLLLLLLLLLK',
    '.KKKKKKKKKKK',
    '............',
    '............',
    '............',
  ],

  // -------------------------------------------------------- resource families
  // What the food group's chip carries: a plate with something on it. The
  // cooked fish keeps the orange fillet, so the two do not read as each other.
  meals: [
    '............',
    '.....K......',
    '....KEK.....',
    '...KEK......',
    '............',
    'KKKKKKKKKKKK',
    'KCCCCCCCCCCK',
    '.KCCCCCCCCK.',
    '..KCCCCCCK..',
    '...KKKKKK...',
    '............',
    '............',
  ],
  // And what the metal group's carries. An anvil is the end of that chain.
  goods: [
    '............',
    '............',
    '...KKKKKKK..',
    '.KKMMMMMMMK.',
    'KMMMMMMMMMK.',
    '.KMMMMMMKK..',
    '...KMMMK....',
    '...KMMMK....',
    '...KMMMK....',
    '..KMMMMMK...',
    '.KMMMMMMMK..',
    '.KKKKKKKKK..',
  ],

  // ------------------------------------------------------- building categories
  housing: [
    '............',
    '.....K......',
    '....KRK.....',
    '...KRRRK....',
    '..KRRRRRK...',
    '.KRRRRRRRK..',
    'KKKKKKKKKKK.',
    '.KCCCCCCCK..',
    '.KCCKNNKCK..',
    '.KCCKNNKCK..',
    '.KKKKKKKKK..',
    '............',
  ],
  storage: [
    '............',
    '.KKKKKKKKKK.',
    '.KVVVVVVVVK.',
    '.KVWWWWWWVK.',
    '.KVWWWWWWVK.',
    '.KKKKKKKKKK.',
    '.KVWWWWWWVK.',
    '.KVWWWWWWVK.',
    '.KVWWWWWWVK.',
    '.KKKKKKKKKK.',
    '............',
    '............',
  ],
  production: [
    '............',
    '...G....G...',
    '...GMMMMG...',
    '.GMMMMMMMMG.',
    '.GMM....MMG.',
    '.GM......MG.',
    '.GM......MG.',
    '.GMM....MMG.',
    '.GMMMMMMMMG.',
    '...GMMMMG...',
    '...G....G...',
    '............',
  ],
  comfort: [
    '............',
    '...p.pp.p...',
    '..pppppppp..',
    '..pppppppp..',
    '...pppppp...',
    '....pppp....',
    '.....gg.....',
    '.....gg.....',
    '..hhhgg.....',
    '.....gghhh..',
    '.....gg.....',
    '............',
  ],

  // ---------------------------------------------------------------- the world
  spring: [
    '............',
    '...pp..pp...',
    '..pppppppp..',
    '..pppppppp..',
    '...pYYYYp...',
    '..pYYYYYYp..',
    '...pYYYYp...',
    '..pppppppp..',
    '..pppppppp..',
    '...pp..pp...',
    '............',
    '............',
  ],
  summer: [
    '............',
    '.....EE.....',
    '.E...EE...E.',
    '..E.EEEE.E..',
    '....EEEE....',
    '.EEEEEEEEEE.',
    '.EEEEEEEEEE.',
    '....EEEE....',
    '..E.EEEE.E..',
    '.E...EE...E.',
    '.....EE.....',
    '............',
  ],
  autumn: [
    '............',
    '......O.....',
    '.....OOO....',
    '..O.OOOOO.O.',
    '..OOOOOOOOO.',
    '.OOOOOOOOOO.',
    '..OOOOOOOOO.',
    '...OOOOOOO..',
    '....OOOOO...',
    '.....RRR....',
    '......R.....',
    '............',
  ],
  winter: [
    '............',
    '.....L......',
    '.L...L...L..',
    '..L..L..L...',
    '...L.L.L....',
    '.LLLLLLLLLL.',
    '...L.L.L....',
    '..L..L..L...',
    '.L...L...L..',
    '.....L......',
    '............',
    '............',
  ],
  fire: [
    '............',
    '.....O......',
    '....OO......',
    '....OOO.....',
    '...OOOOO....',
    '...OOEOO....',
    '..OOEEEOO...',
    '..OOEEEOO...',
    '..OOOEOOO...',
    '...OOOOO....',
    '....OOO.....',
    '............',
  ],
  pin: [
    '............',
    '....KKKK....',
    '...KRRRRK...',
    '..KRRRRRRK..',
    '..KRRCCRRK..',
    '..KRRCCRRK..',
    '..KRRRRRRK..',
    '...KRRRRK...',
    '....KRRK....',
    '.....KK.....',
    '.....KK.....',
    '............',
  ],
};

/**
 * Symbols, drawn as a silhouette. `#` is the shape and `+` is a softer part of
 * it — used for the inside of a thing where a solid fill would close it up.
 * Colour is whatever the element's `color` is, which is the entire reason these
 * are separate from the art above.
 */
const GLYPH: Record<string, string[]> = {
  // ------------------------------------------------------------- getting about
  build: [
    '............',
    '.....######.',
    '.....######.',
    '.....######.',
    '.....######.',
    '....###.....',
    '...###......',
    '..###.......',
    '.###........',
    '.##.........',
    '............',
    '............',
  ],
  people: [
    '............',
    '..##....##..',
    '.####..####.',
    '.####..####.',
    '..##....##..',
    '............',
    '.####..####.',
    '#####..#####',
    '#####..#####',
    '#####..#####',
    '#####..#####',
    '............',
  ],
  kingdom: [
    '............',
    '............',
    '.....##.....',
    '.#...##...#.',
    '.#..####..#.',
    '.##.####.##.',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '............',
    '............',
  ],
  journal: [
    '............',
    '.####.#####.',
    '######.####.',
    '######.####.',
    '######.####.',
    '######.####.',
    '######.####.',
    '######.####.',
    '######.####.',
    '.####..####.',
    '............',
    '............',
  ],
  wildlife: [
    '............',
    '..##....##..',
    '.####..####.',
    '.####..####.',
    '.####..####.',
    '.##########.',
    '.##########.',
    '.####..####.',
    '.####..####.',
    '..##....##..',
    '............',
    '............',
  ],
  settings: [
    '............',
    '...#....#...',
    '...######...',
    '.##########.',
    '.###....###.',
    '.##......##.',
    '.##......##.',
    '.###....###.',
    '.##########.',
    '...######...',
    '...#....#...',
    '............',
  ],
  eye: [
    '............',
    '............',
    '...######...',
    '.##......##.',
    '.#..####..#.',
    '.#..####..#.',
    '.#..####..#.',
    '.##......##.',
    '...######...',
    '............',
    '............',
    '............',
  ],

  // ------------------------------------------------------------------- marking
  // Four points rather than five: Vibes are not a rating.
  vibes: [
    '............',
    '.....##.....',
    '.....##.....',
    '....####....',
    '.##########.',
    '.##########.',
    '....####....',
    '.....##.....',
    '.....##.....',
    '............',
    '............',
    '............',
  ],
  star: [
    '............',
    '.....##.....',
    '....####....',
    '....####....',
    '############',
    '.##########.',
    '..########..',
    '..###..###..',
    '..##....##..',
    '............',
    '............',
    '............',
  ],
  starOff: [
    '............',
    '.....##.....',
    '....#..#....',
    '....#..#....',
    '####....####',
    '.#........#.',
    '..#..##..#..',
    '..#.#..#.#..',
    '..##....##..',
    '............',
    '............',
    '............',
  ],
  pencil: [
    '............',
    '.......###..',
    '......#####.',
    '.....######.',
    '....#####...',
    '...#####....',
    '..#####.....',
    '.#####......',
    '.####.......',
    '.###........',
    '.#..........',
    '............',
  ],
  check: [
    '............',
    '..........##',
    '.........##.',
    '........##..',
    '.......##...',
    '.##...##....',
    '.###.##.....',
    '..#####.....',
    '...###......',
    '............',
    '............',
    '............',
  ],
  close: [
    '............',
    '.##......##.',
    '.###....###.',
    '..###..###..',
    '...######...',
    '....####....',
    '...######...',
    '..###..###..',
    '.###....###.',
    '.##......##.',
    '............',
    '............',
  ],
  lock: [
    '............',
    '....####....',
    '...##..##...',
    '...##..##...',
    '.##########.',
    '.##########.',
    '.###.##.###.',
    '.###.##.###.',
    '.##########.',
    '.##########.',
    '............',
    '............',
  ],
  unlock: [
    '............',
    '....####....',
    '...##..##...',
    '...##.......',
    '.##########.',
    '.##########.',
    '.###.##.###.',
    '.###.##.###.',
    '.##########.',
    '.##########.',
    '............',
    '............',
  ],
  warn: [
    '............',
    '.....##.....',
    '....####....',
    '....#..#....',
    '...##..##...',
    '...##..##...',
    '..##.##.##..',
    '..##.##.##..',
    '.##......##.',
    '.##########.',
    '.##########.',
    '............',
  ],
  heart: [
    '............',
    '..##....##..',
    '.####..####.',
    '.##########.',
    '.##########.',
    '.##########.',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
    '............',
  ],
  box: [
    '............',
    '.##########.',
    '.##########.',
    '.###....###.',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '.##########.',
    '............',
    '............',
  ],

  // --------------------------------------------------------------- directions
  chevron: [
    '............',
    '...##.......',
    '...###......',
    '....###.....',
    '.....###....',
    '......###...',
    '.....###....',
    '....###.....',
    '...###......',
    '...##.......',
    '............',
    '............',
  ],
  caret: [
    '............',
    '............',
    '............',
    '.##########.',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....',
    '............',
    '............',
    '............',
    '............',
  ],
  plus: [
    '............',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.##########.',
    '.##########.',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '............',
    '............',
    '............',
  ],
  minus: [
    '............',
    '............',
    '............',
    '............',
    '.##########.',
    '.##########.',
    '............',
    '............',
    '............',
    '............',
    '............',
    '............',
  ],
  recentre: [
    '............',
    '.....##.....',
    '....####....',
    '...######...',
    '..########..',
    '.##########.',
    '..########..',
    '..##....##..',
    '..##.##.##..',
    '..##.##.##..',
    '............',
    '............',
  ],
  pause: [
    '............',
    '..##....##..',
    '..##....##..',
    '..##....##..',
    '..##....##..',
    '..##....##..',
    '..##....##..',
    '..##....##..',
    '..##....##..',
    '............',
    '............',
    '............',
  ],
  more: [
    '............',
    '............',
    '............',
    '............',
    '............',
    '.##..##..##.',
    '.##..##..##.',
    '............',
    '............',
    '............',
    '............',
    '............',
  ],
  up: [
    '............',
    '.....##.....',
    '....####....',
    '...######...',
    '..########..',
    '.##########.',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '............',
    '............',
  ],
  walk: [
    '............',
    '.....##.....',
    '.....##.....',
    '............',
    '...######...',
    '..##.##.##..',
    '..#..##..#..',
    '.....##.....',
    '....####....',
    '...##..##...',
    '..##....##..',
    '............',
  ],
  site: [
    '............',
    '.#########..',
    '.#.......#..',
    '.#..###..#..',
    '.#.......#..',
    '.#########..',
    '.#.......#..',
    '.#..###..#..',
    '.#.......#..',
    '.#########..',
    '............',
    '............',
  ],
  // A needle across a ring, not a dot in one: with a plain blob in the middle
  // it was the eye icon at a glance, and the two sit two rows apart in a
  // building's own panel.
  compass: [
    '............',
    '............',
    '...######...',
    '..##....##..',
    '.##....###..',
    '.##...###.#.',
    '.##.###...#.',
    '..###...##..',
    '...######...',
    '............',
    '............',
    '............',
  ],

  // -------------------------------------------------------------------- trades
  general: [
    '............',
    '............',
    '.##########.',
    '.##########.',
    '.##.##.##.#.',
    '.##########.',
    '.##.##.##.#.',
    '..########..',
    '...######...',
    '............',
    '............',
    '............',
  ],
  woodcutter: [
    '............',
    '....##.###..',
    '....##.####.',
    '....########',
    '....##.####.',
    '....##.###..',
    '....##......',
    '....##......',
    '....##......',
    '....##......',
    '....##......',
    '............',
  ],
  miner: [
    '............',
    '.##......##.',
    '.###....###.',
    '..##########',
    '....######..',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '............',
  ],
  farmer: [
    '............',
    '.###....###.',
    '.####..####.',
    '.####..####.',
    '..##.##.##..',
    '....####....',
    '.....##.....',
    '.....##.....',
    '.....##.....',
    '############',
    '############',
    '............',
  ],
  miller: [
    '............',
    '.###....###.',
    '.###....###.',
    '..###..###..',
    '...##..##...',
    '....####....',
    '...##..##...',
    '..###..###..',
    '.###....###.',
    '.###....###.',
    '............',
    '............',
  ],
  cook: [
    '............',
    '............',
    '.....##.....',
    '....##......',
    '............',
    '############',
    '.##########.',
    '.##########.',
    '.##########.',
    '..########..',
    '............',
    '............',
  ],
  fisher: [
    '............',
    '.........##.',
    '........##..',
    '.......##...',
    '......##....',
    '.....##.#...',
    '....##..#...',
    '...##...#...',
    '..##....#...',
    '........##..',
    '.......###..',
    '............',
  ],
  smith: [
    '............',
    '.....##.....',
    '....###.....',
    '....####....',
    '...#####....',
    '...######...',
    '..###.###...',
    '.###...###..',
    '.###...###..',
    '..#######...',
    '...#####....',
    '............',
  ],

  // -------------------------------------------------------------------- traits
  leaf: [
    '............',
    '.......####.',
    '......#####.',
    '.....######.',
    '....#######.',
    '...###.####.',
    '..###..###..',
    '.###...##...',
    '.##...##....',
    '.#...##.....',
    '.#..##......',
    '............',
  ],
  rabbit: [
    '............',
    '..##..##....',
    '..##..##....',
    '..##..##....',
    '..######....',
    '.########...',
    '.###..###...',
    '.########...',
    '.########...',
    '..######....',
    '............',
    '............',
  ],
  search: [
    '............',
    '...#####....',
    '..##...##...',
    '.##.....##..',
    '.##.....##..',
    '.##.....##..',
    '..##...##...',
    '...#####.##.',
    '........###.',
    '.........###',
    '..........##',
    '............',
  ],
  sunrise: [
    '............',
    '............',
    '.....##.....',
    '....####....',
    '...######...',
    '..########..',
    '.##########.',
    '............',
    '.##########.',
    '............',
    '.##########.',
    '............',
  ],
  moon: [
    '............',
    '....#####...',
    '...###..##..',
    '..###....##.',
    '..###.......',
    '..###.......',
    '..###.......',
    '..###....##.',
    '...###..##..',
    '....#####...',
    '............',
    '............',
  ],
  boot: [
    '............',
    '...####.....',
    '...####.....',
    '...####.....',
    '...####.....',
    '...####.....',
    '...#####....',
    '...########.',
    '..#########.',
    '.##########.',
    '............',
    '............',
  ],
  steady: [
    '............',
    '............',
    '...######...',
    '..##....##..',
    '.##..##..##.',
    '.##.####.##.',
    '.##..##..##.',
    '..##....##..',
    '...######...',
    '............',
    '............',
    '............',
  ],
};

/**
 * The bridge from what the simulation writes to what the interface draws.
 *
 * Journal entries and toasts are created deep in `sim/`, and they carry a small
 * character to say what kind of thing happened. That is a piece of the game's
 * own voice and it does not belong to the interface, so rather than teaching
 * the simulation about icon names, the interface recognises the characters it
 * knows and quietly falls back to drawing the rest as text.
 */
const FROM_GLYPH: Record<string, string> = {
  '🪵': 'wood',
  '🪨': 'stone',
  '🌾': 'wheat',
  '🥣': 'flour',
  '🍞': 'bread',
  '🐟': 'fish',
  '🍽️': 'cookedFish',
  '🍽': 'cookedFish',
  '🟤': 'ironOre',
  '⚫': 'coal',
  '🔩': 'ironBar',
  '🔗': 'steelBar',
  '🔷': 'mithrilOre',
  '💠': 'mithrilBar',
  '🏠': 'housing',
  '📦': 'storage',
  '⚙️': 'production',
  '⚙': 'production',
  '🌷': 'comfort',
  '☀️': 'summer',
  '☀': 'summer',
  '🌸': 'spring',
  '🍂': 'autumn',
  '❄️': 'winter',
  '❄': 'winter',
  '🔥': 'fire',
  '📍': 'pin',
  '🔨': 'build',
  '👥': 'people',
  '📖': 'journal',
  '🔭': 'wildlife',
  '👁': 'eye',
  '🍃': 'leaf',
  '✦': 'vibes',
  '★': 'star',
  '☆': 'starOff',
  '✓': 'check',
  '✕': 'close',
  '🔒': 'lock',
  '🔓': 'unlock',
  '⚠️': 'warn',
  '⚠': 'warn',
  '❤️': 'heart',
  '❤': 'heart',
  '›': 'chevron',
  '⌂': 'recentre',
  '⋯': 'more',
  '⬆️': 'up',
  '⬆': 'up',
  '🚶': 'walk',
  '🏗️': 'site',
  '🏗': 'site',
  '🧭': 'compass',
  '🧺': 'general',
  '🪓': 'woodcutter',
  '⛏️': 'miner',
  '⛏': 'miner',
  '🌱': 'farmer',
  '🌬️': 'miller',
  '🌬': 'miller',
  '👩‍🍳': 'cook',
  '🍳': 'cook',
  '🎣': 'fisher',
  '🌿': 'leaf',
  '🐇': 'rabbit',
  '🔍': 'search',
  '🌅': 'sunrise',
  '🌙': 'moon',
  '🥾': 'boot',
  '💾': 'storage',
  '🔊': 'settings',
  '🐾': 'rabbit',
  '❚': 'pause',
};

/** Every art icon's name, for anything that needs to know what exists. */
export type ArtName = keyof typeof ART;

/** Paints one grid onto a fresh canvas and returns it as a data URL. */
function bake(rows: string[], colour: (ch: string) => string | null): string {
  const canvas = document.createElement('canvas');
  canvas.width = GRID * SCALE;
  canvas.height = GRID * SCALE;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < GRID; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < GRID; x++) {
      const fill = colour(row[x] ?? '.');
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
    }
  }
  return canvas.toDataURL('image/png');
}

let installed = false;

/**
 * Bakes the whole set into one stylesheet, once.
 *
 * Everything is drawn up front rather than on first use: there are sixty-odd of
 * them, the whole lot takes a few milliseconds, and doing it lazily would mean
 * an icon appearing a frame after the panel it belongs to — which on a panel
 * that redraws several times a second is a flicker rather than a load.
 */
export function installIcons(): void {
  if (installed) return;
  installed = true;

  const rules: string[] = [];
  for (const [name, rows] of Object.entries(ART)) {
    const url = bake(rows, (ch) => PALETTE[ch] ?? null);
    rules.push(`.pxi-${name}{background-image:url(${url})}`);
  }
  for (const [name, rows] of Object.entries(GLYPH)) {
    // Drawn in flat white: only the alpha survives being used as a mask, and
    // the colour comes from whatever the icon is sitting in.
    const url = bake(rows, (ch) => (ch === '#' ? '#fff' : ch === '+' ? 'rgba(255,255,255,0.55)' : null));
    rules.push(`.pxg-${name}{-webkit-mask-image:url(${url});mask-image:url(${url})}`);
  }

  const style = document.createElement('style');
  style.id = 'tkm-icons';
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
}

/** Whether a name is one of ours, so callers can decide before they commit. */
export function hasIcon(name: string): boolean {
  return name in ART || name in GLYPH;
}

/**
 * One icon, as markup.
 *
 * Always `aria-hidden`: every icon in this interface sits beside a label or
 * inside a control that already has an accessible name, and an icon that
 * announces itself as well makes a screen reader say everything twice.
 *
 * `size` is a class rather than a pixel value on purpose — the two sizes the
 * interface uses are the two the art was baked for, and anything in between
 * would be the one thing pixel art must not do.
 */
export function icon(name: string, extra = '', size: '' | 'lg' | 'xl' = ''): string {
  const kind = name in ART ? 'pxi' : 'pxg';
  if (!hasIcon(name)) return '';
  return `<span class="px ${kind} ${kind}-${name}${size ? ` px-${size}` : ''}${extra ? ` ${extra}` : ''}" aria-hidden="true"></span>`;
}

/**
 * The same, from whatever character the simulation wrote. Anything unrecognised
 * comes back as itself, so a new toast icon added in `sim/` shows something
 * rather than nothing while it waits for a drawing.
 */
export function iconFor(glyph: string, extra = '', size: '' | 'lg' | 'xl' = ''): string {
  const name = FROM_GLYPH[glyph];
  if (name && hasIcon(name)) return icon(name, extra, size);
  return `<span class="px-fallback" aria-hidden="true">${glyph}</span>`;
}

/**
 * Every icon there is, as a contact sheet. Not reachable from the interface —
 * it exists so the set can be looked at all at once from the console or a
 * screenshot script, which is the only honest way to review pixel art.
 */
export function iconSheet(): string {
  const cell = (name: string, kind: string) =>
    `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:74px">
      <span class="px ${kind} ${kind}-${name} px-xl"></span>
      <span style="font-size:9px;color:#bcb09b;text-align:center;line-height:1.2">${name}</span></div>`;
  return `<div style="position:fixed;inset:0;z-index:9999;overflow:auto;background:#1a1611;padding:20px;
      display:flex;flex-wrap:wrap;gap:14px;align-content:flex-start;color:#f4e9d6">
      ${Object.keys(ART).map((n) => cell(n, 'pxi')).join('')}
      ${Object.keys(GLYPH).map((n) => cell(n, 'pxg')).join('')}
    </div>`;
}
