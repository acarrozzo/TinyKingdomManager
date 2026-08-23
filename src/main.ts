/** Entry point: wire the canvas, the game and the interface together. */

import './ui/style.css';
import { Game } from './game';
import { UI } from './ui/ui';
import { iconSheet, installIcons } from './ui/icons';
import { audio } from './audio/audio';
import { listSlots, loadFromSlot, loadSettings, newSlotId } from './save/save';

// The interface draws its own icons; they have to exist before anything asks
// for one, and baking them is a few milliseconds once.
installIcons();

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

// Resume the most recent kingdom, if there is one.
const settings = loadSettings();
const slots = listSlots();
const preferred = settings.lastSlot && slots.some((s) => s.id === settings.lastSlot) ? settings.lastSlot : slots[0]?.id;
const resumed = preferred ? loadFromSlot(preferred) : null;
const slotInfo = slots.find((s) => s.id === preferred);

const game = resumed
  ? new Game(canvas, resumed, preferred!, slotInfo?.name ?? 'Tiny Kingdom')
  : new Game(canvas, undefined, newSlotId(), 'Tiny Kingdom');

audio.setVolume(game.settings.volume);
audio.setMuted(game.settings.muted);

const ui = new UI(uiRoot, game);
game.start();

// The interface updates on its own clock so it never competes with the render loop.
function uiLoop(now: number): void {
  ui.tick(now);
  requestAnimationFrame(uiLoop);
}
requestAnimationFrame(uiLoop);

window.addEventListener('resize', () => game.renderer.resize(game.camera.zoom));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.save();
});

// Handy for poking at a kingdom from the console.
(window as unknown as { tkm: unknown }).tkm = { game, ui, iconSheet };
