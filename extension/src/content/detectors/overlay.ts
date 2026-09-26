export interface AllowlistConfig {
  cookieSelectors: string[];
  videoSelectors: string[];
  minDialogTextLength: number;
}

export const LEGITIMATE_ALLOWLIST: AllowlistConfig = {
  cookieSelectors: [
    '[id*="cookie" i]',
    '[class*="cookie" i]',
    '[id*="consent" i]',
    '[class*="consent" i]',
    '[id*="onetrust" i]',
    '[class*="onetrust" i]',
    '.cc-window',
    '.notice-cookie',
    '[aria-label*="cookie" i]',
    '[aria-label*="consent" i]',
    '#gdpr-banner',
    '.gdpr-banner'
  ],
  videoSelectors: [
    'video',
    '.html5-video-player',
    '.vjs-control-bar',
    '[class*="video"]',
    '[class*="player"]'
  ],
  minDialogTextLength: 50
};

export interface DetectionResult {
  flagged: boolean;
  reasons: string[];
}

export function detectOverlay(
  el: HTMLElement,
  allowlist: AllowlistConfig = LEGITIMATE_ALLOWLIST,
  zIndexThreshold: number = 10
): DetectionResult {
  if (!el || el.nodeType !== 1) {
    return { flagged: false, reasons: [] };
  }

  const win = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  const HTMLElementClass = win?.HTMLElement || (typeof HTMLElement !== 'undefined' ? HTMLElement : null);
  if (HTMLElementClass && !(el instanceof HTMLElementClass)) {
    return { flagged: false, reasons: [] };
  }

  // 1. Check Allowlist Exclusions
  // A. Dialog role with sufficient text
  const role = (el.getAttribute('role') || '').toLowerCase();
  const tagName = el.tagName.toLowerCase();
  if (role === 'dialog' || role === 'alertdialog' || tagName === 'dialog') {
    const textLength = (el.textContent || '').trim().length;
    if (textLength > allowlist.minDialogTextLength) {
      return { flagged: false, reasons: ['Excluded: Legitimate dialog with sufficient text'] };
    }
  }

  // B. Video player or controls
  for (const selector of allowlist.videoSelectors) {
    try {
      if (el.matches(selector) || el.closest(selector)) {
        return { flagged: false, reasons: ['Excluded: Video player element or controls'] };
      }
    } catch {
      // Ignore invalid selectors
    }
  }

  // C. Cookie banner
  for (const selector of allowlist.cookieSelectors) {
    try {
      if (el.matches(selector) || el.closest(selector)) {
        return { flagged: false, reasons: ['Excluded: Cookie/consent banner'] };
      }
    } catch {
      // Ignore invalid selectors
    }
  }

  // 2. Style and Layout Analysis
  const targetWin = win || (typeof window !== 'undefined' ? window : null);
  if (!targetWin) {
    return { flagged: false, reasons: [] };
  }
  const style = targetWin.getComputedStyle(el);

  // Check Position
  const position = style.position || el.style.position;
  if (position !== 'fixed' && position !== 'absolute') {
    return { flagged: false, reasons: [] };
  }

  // Check Pointer Events
  const pointerEvents = style.pointerEvents || el.style.pointerEvents;
  if (pointerEvents === 'none') {
    return { flagged: false, reasons: [] };
  }

  // Check Viewport Coverage
  const viewWidth = targetWin.innerWidth || document.documentElement.clientWidth || 1024;
  const viewHeight = targetWin.innerHeight || document.documentElement.clientHeight || 768;
  const viewportArea = viewWidth * viewHeight;

  let elWidth = 0;
  let elHeight = 0;

  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    elWidth = rect.width;
    elHeight = rect.height;
  } else {
    // Fallback for unit testing environments (e.g. jsdom without full layout engine)
    const parseDim = (val: string, ref: number) => {
      if (!val) return 0;
      if (val.endsWith('vw') || val.endsWith('%')) return (parseFloat(val) / 100) * ref;
      if (val.endsWith('vh')) return (parseFloat(val) / 100) * ref;
      if (val.endsWith('px')) return parseFloat(val);
      return parseFloat(val) || 0;
    };
    elWidth = parseDim(style.width || el.style.width, viewWidth);
    elHeight = parseDim(style.height || el.style.height, viewHeight);
  }

  const elArea = elWidth * elHeight;
  const areaRatio = viewportArea > 0 ? elArea / viewportArea : 0;

  if (areaRatio <= 0.6) {
    return { flagged: false, reasons: [] };
  }

  // Check z-index
  const rawZIndex = style.zIndex || el.style.zIndex;
  const zIndexVal = parseInt(rawZIndex, 10);
  const isHighZIndex = !isNaN(zIndexVal) && zIndexVal >= zIndexThreshold;

  // Check Opacity and Background Transparency
  const opacityVal = parseFloat(style.opacity || el.style.opacity || '1');
  const bgColor = (style.backgroundColor || el.style.backgroundColor || '').toLowerCase();
  const isTransparentBg =
    bgColor === '' ||
    bgColor === 'transparent' ||
    bgColor === 'rgba(0, 0, 0, 0)' ||
    bgColor.endsWith(', 0)');

  const isLowOpacity = opacityVal < 0.1;

  if (!(isLowOpacity || isTransparentBg)) {
    return { flagged: false, reasons: [] };
  }

  const reasons: string[] = [
    `Position is ${position}`,
    `Covers ${(areaRatio * 100).toFixed(1)}% of viewport area (>60%)`
  ];

  if (isHighZIndex) {
    reasons.push(`High z-index: ${zIndexVal} (>=${zIndexThreshold})`);
  }
  if (isLowOpacity) {
    reasons.push(`Nearly transparent opacity: ${opacityVal}`);
  }
  if (isTransparentBg) {
    reasons.push(`Transparent background: ${bgColor || 'default'}`);
  }

  return {
    flagged: true,
    reasons
  };
}
