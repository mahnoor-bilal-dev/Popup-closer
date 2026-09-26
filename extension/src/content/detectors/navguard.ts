/**
 * D2 – Navigation / Popup Guard
 *
 * Responsibilities:
 *  1. Wrap window.open at the content-script level to log popup calls with
 *     the triggering element and event type.
 *  2. Add a capturing click listener on document that records:
 *       - the target element
 *       - whether it is a real <a> or has role="link"
 *       - whether a new-tab / navigation happens within 300 ms of the click
 *  3. Flag as a click-hijack when a navigation occurs AND the clicked element
 *     is NOT a link/button with a visible, matching href/label.
 *  4. On flag: prevent the default action once, log the event locally (no
 *     network calls), and show a small non-blocking Shadow-DOM toast:
 *     "Blocked a hidden redirect. Undo".
 *
 * The module exports pure helpers so unit tests can exercise them without a
 * real browser environment, plus an `install()` function that attaches all
 * side-effects to a given window/document pair.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ClickRecord {
  target: Element;
  isLinkLike: boolean;
  timestamp: number;
  eventType: string;
}

export interface NavEvent {
  url: string;
  method: 'window.open' | 'location' | 'anchor';
  triggerElement: Element | null;
  eventType: string | null;
  timestamp: number;
}

export interface HijackResult {
  flagged: boolean;
  reason: string;
  clickRecord: ClickRecord | null;
  navEvent: NavEvent;
}

// ---------------------------------------------------------------------------
// Internal log (no network calls)
// ---------------------------------------------------------------------------

export const _localLog: HijackResult[] = [];

// ---------------------------------------------------------------------------
// Pure helpers (testable without a real browser)
// ---------------------------------------------------------------------------

/**
 * Returns true when an element should be considered a legitimate navigation
 * initiator (real anchor, button, or element with role="link"/"button").
 */
export function isLinkLike(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' || tag === 'button') return true;

  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role === 'link' || role === 'button') return true;

  // Walk up at most 3 levels to find a wrapping anchor (e.g. <a><span> click)
  let current: Element | null = el.parentElement;
  let steps = 0;
  while (current && steps < 3) {
    const ptag = current.tagName.toLowerCase();
    const prole = (current.getAttribute('role') || '').toLowerCase();
    if (ptag === 'a' || ptag === 'button' || prole === 'link' || prole === 'button') {
      return true;
    }
    current = current.parentElement;
    steps++;
  }

  return false;
}

/**
 * Returns true when an anchor element has a visible, meaningful href that
 * is consistent with user expectation (non-empty, not just '#').
 */
export function hasVisibleHref(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const anchor: Element | null =
    tag === 'a' ? el : el.closest('a');
  if (!anchor) return false;

  const href = (anchor.getAttribute('href') || '').trim();
  return href.length > 0 && href !== '#' && href !== 'javascript:void(0)' && href !== 'javascript:;';
}

/**
 * Core classification: given a ClickRecord and a NavEvent that happened
 * within NAVIGATION_WINDOW_MS of the click, decide whether this is a hijack.
 *
 * A hijack is flagged when:
 *   - navigation occurred
 *   - the clicked element is NOT link-like, OR it is link-like but has no
 *     visible href and is not a <button>
 */
export const NAVIGATION_WINDOW_MS = 300;

export function classifyHijack(
  clickRecord: ClickRecord,
  navEvent: NavEvent
): HijackResult {
  const timeDelta = navEvent.timestamp - clickRecord.timestamp;
  if (timeDelta < 0 || timeDelta > NAVIGATION_WINDOW_MS) {
    return {
      flagged: false,
      reason: `Navigation occurred ${timeDelta}ms after click (outside window)`,
      clickRecord,
      navEvent,
    };
  }

  const { target } = clickRecord;
  const linkLike = isLinkLike(target);
  const visHref = hasVisibleHref(target);
  const isBtn = target.tagName.toLowerCase() === 'button';

  // Legitimate if element is a proper link-like element with a visible href OR
  // it is a plain button (buttons may navigate via JS intentionally).
  if (linkLike && (visHref || isBtn)) {
    return {
      flagged: false,
      reason: 'Click on legitimate link/button element',
      clickRecord,
      navEvent,
    };
  }

  const reason = linkLike
    ? 'Element appears link-like but has no visible/matching href'
    : 'Navigation triggered by non-link, non-button element (click-hijack)';

  return {
    flagged: true,
    reason,
    clickRecord,
    navEvent,
  };
}

// ---------------------------------------------------------------------------
// Toast via Shadow DOM
// ---------------------------------------------------------------------------

const TOAST_DURATION_MS = 5000;
const TOAST_HOST_ID = '__popguard_toast_host__';

export function showToast(
  doc: Document,
  message: string = 'Blocked a hidden redirect. Undo',
  onUndo?: () => void
): void {
  // Remove any existing toast first.
  const existing = doc.getElementById(TOAST_HOST_ID);
  if (existing) existing.remove();

  const host = doc.createElement('div');
  host.id = TOAST_HOST_ID;

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = doc.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .pg-toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      background: #1a1a2e;
      color: #e0e0e0;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      padding: 10px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      gap: 10px;
      animation: pgSlideIn 0.25s ease-out;
      max-width: 320px;
    }
    @keyframes pgSlideIn {
      from { transform: translateY(20px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    .pg-undo {
      background: none;
      border: 1px solid #7b68ee;
      color: #7b68ee;
      border-radius: 4px;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 12px;
    }
    .pg-undo:hover { background: #7b68ee22; }
    .pg-close {
      margin-left: auto;
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      font-size: 16px;
      padding: 0;
      line-height: 1;
    }
  `;
  shadow.appendChild(style);

  const toast = doc.createElement('div');
  toast.className = 'pg-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const text = doc.createElement('span');
  text.textContent = message;
  toast.appendChild(text);

  if (onUndo) {
    const undoBtn = doc.createElement('button');
    undoBtn.className = 'pg-undo';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => {
      onUndo();
      host.remove();
    });
    toast.appendChild(undoBtn);
  }

  const closeBtn = doc.createElement('button');
  closeBtn.className = 'pg-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.addEventListener('click', () => host.remove());
  toast.appendChild(closeBtn);

  shadow.appendChild(toast);
  doc.body.appendChild(host);

  setTimeout(() => {
    if (host.parentNode) host.remove();
  }, TOAST_DURATION_MS);
}

// ---------------------------------------------------------------------------
// install() – attaches all side-effects to a window/document
// ---------------------------------------------------------------------------

export interface GuardHandles {
  /** Call to remove all listeners and restore window.open. */
  uninstall: () => void;
}

export function install(
  targetWindow: Window & typeof globalThis = window,
  targetDocument: Document = document
): GuardHandles {
  // Track the most recent click.
  let lastClick: ClickRecord | null = null;

  // ------------------------------------------------------------------
  // 1. Capturing click listener
  // ------------------------------------------------------------------
  const handleClick = (e: MouseEvent): void => {
    const target = e.target as Element | null;
    if (!target) return;

    lastClick = {
      target,
      isLinkLike: isLinkLike(target),
      timestamp: Date.now(),
      eventType: e.type,
    };
  };

  targetDocument.addEventListener('click', handleClick, { capture: true });

  // ------------------------------------------------------------------
  // 2. Wrap window.open
  // ------------------------------------------------------------------
  const originalOpen = targetWindow.open.bind(targetWindow);

  const wrappedOpen: typeof targetWindow.open = (
    url?: string | URL,
    target?: string,
    features?: string
  ) => {
    const navEvent: NavEvent = {
      url: url != null ? String(url) : '',
      method: 'window.open',
      triggerElement: lastClick?.target ?? null,
      eventType: lastClick?.eventType ?? null,
      timestamp: Date.now(),
    };

    // Log regardless of classification.
    console.debug('[PopGuard D2] window.open intercepted', navEvent);

    if (lastClick) {
      const result = classifyHijack(lastClick, navEvent);
      if (result.flagged) {
        _localLog.push(result);
        console.warn('[PopGuard D2] Click-hijack blocked (window.open)', result);
        showToast(targetDocument);
        // Do not call originalOpen — popup is suppressed.
        return null;
      }
    }

    return originalOpen(url as string, target, features);
  };

  targetWindow.open = wrappedOpen;

  // ------------------------------------------------------------------
  // 3. Detect anchor / location navigations within NAVIGATION_WINDOW_MS
  // ------------------------------------------------------------------
  // We observe when an anchor is actually followed by watching for
  // beforeunload. For new-tab links (target="_blank") the page doesn't
  // unload, so we also intercept anchor clicks directly.
  const handleAnchorClick = (e: MouseEvent): void => {
    const anchor = (e.target as Element)?.closest('a');
    if (!anchor) return;

    const href = (anchor.getAttribute('href') || '').trim();
    const newTab =
      anchor.getAttribute('target') === '_blank' ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey;

    if (!href || href === '#') return;

    const navEvent: NavEvent = {
      url: href,
      method: 'anchor',
      triggerElement: e.target as Element,
      eventType: e.type,
      timestamp: Date.now(),
    };

    if (lastClick) {
      const result = classifyHijack(lastClick, navEvent);
      if (result.flagged && newTab) {
        e.preventDefault();
        _localLog.push(result);
        console.warn('[PopGuard D2] Click-hijack blocked (anchor)', result);
        showToast(targetDocument);
      }
    }
  };

  targetDocument.addEventListener('click', handleAnchorClick, { capture: true });

  // ------------------------------------------------------------------
  // Uninstall helper
  // ------------------------------------------------------------------
  const uninstall = (): void => {
    targetDocument.removeEventListener('click', handleClick, { capture: true });
    targetDocument.removeEventListener('click', handleAnchorClick, { capture: true });
    targetWindow.open = originalOpen;
  };

  return { uninstall };
}
