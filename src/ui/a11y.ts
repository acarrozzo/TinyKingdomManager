/**
 * Keyboard and assistive-technology plumbing.
 *
 * None of this changes what the interface looks like, which is exactly why it
 * has to live somewhere deliberate: a focus ring that vanishes behind a sheet,
 * or a dialog you can tab straight out of into a map you cannot see, are the
 * kind of thing nobody notices until the mouse is unavailable.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (n) => n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement,
  );
}

export class Focus {
  /** Where focus came from, so closing a dialog puts it back. */
  private returnTo: HTMLElement | null = null;
  /**
   * …and how to find that control again. Opening a panel re-renders the bar it
   * was opened from — the button now reads as pressed — so by the time the
   * panel closes the original node is long detached.
   */
  private returnKey = '';
  private root: HTMLElement;
  /** The dialog currently holding focus, if any. */
  private trapped: HTMLElement | null = null;
  private live: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.live = document.createElement('div');
    this.live.className = 'sr-only';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    root.appendChild(this.live);

    // Capture, so it runs before anything in the dialog can swallow the key.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  /** Remembers the control that is about to open something. */
  remember(node?: HTMLElement | null): void {
    const from = node ?? (document.activeElement as HTMLElement | null);
    if (!from || from === document.body) return;
    this.returnTo = from;
    this.returnKey = focusKey(from);
  }

  /**
   * Moves focus into a newly opened panel. Prefers the first real control; if
   * there is none the container takes focus itself, so a screen reader still
   * lands inside rather than staying wherever it was.
   */
  enter(root: HTMLElement, trap: boolean): void {
    this.trapped = trap ? root : null;
    const first = focusableIn(root)[0];
    if (first) first.focus();
    else {
      root.tabIndex = -1;
      root.focus();
    }
  }

  /** Closes out: stops trapping and hands focus back where it came from. */
  release(): void {
    this.trapped = null;
    const back = this.returnTo;
    const key = this.returnKey;
    this.returnTo = null;
    this.returnKey = '';
    if (back && back.isConnected) {
      back.focus();
      return;
    }
    // Redrawn since: find the same control in the markup that replaced it.
    const again = key ? this.root.querySelector<HTMLElement>(key) : null;
    if (again) again.focus();
  }

  /** Says something out loud without showing it. Used for confirmations. */
  announce(message: string): void {
    if (!message || this.live.textContent === message) return;
    this.live.textContent = message;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.trapped || !this.trapped.isConnected) return;
    const items = focusableIn(this.trapped);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    // Tabbing off either end wraps rather than escaping into the map behind.
    if (!active || !this.trapped.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/**
 * Live panels rewrite their own contents several times a second, which throws
 * away whatever the keyboard was on. Every control the interface renders is
 * identified by its `data-` attributes rather than by node identity, so the
 * same control can be found again in the replacement markup.
 */
export function keepFocus(root: HTMLElement, redraw: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const inside = active && root.contains(active);
  const key = inside ? focusKey(active) : '';
  redraw();
  if (!inside || !key) return;
  if (document.activeElement && root.contains(document.activeElement)) return;
  const again = root.querySelector<HTMLElement>(key);
  // Without `preventScroll` this drags the panel back to wherever the keyboard
  // happens to be: the build list opens with its first row focused, so every
  // redraw scrolled a player who had read halfway down it back to the top.
  if (again) again.focus({ preventScroll: true });
}

function focusKey(node: HTMLElement): string {
  const act = node.dataset.act;
  if (!act) return '';
  const parts = [`[data-act="${act}"]`];
  if (node.dataset.id) parts.push(`[data-id="${node.dataset.id}"]`);
  if (node.dataset.i) parts.push(`[data-i="${node.dataset.i}"]`);
  if (node.dataset.def) parts.push(`[data-def="${node.dataset.def}"]`);
  return parts.join('');
}
