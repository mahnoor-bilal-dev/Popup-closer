import { test, expect } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { detectOverlay } from '../src/content/detectors/overlay';

test.describe('Overlay / Click-Shield Detector (D1)', () => {
  let dom: JSDOM;
  let document: Document;

  test.beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://example.com'
    });
    document = dom.window.document;
    Object.defineProperty(dom.window, 'innerWidth', { value: 1024, writable: true });
    Object.defineProperty(dom.window, 'innerHeight', { value: 768, writable: true });
  });

  // True Positive 1: Full-page transparent click-catcher
  test('flags full-page transparent click-catcher overlay', () => {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = '100vw';
    el.style.height = '100vh';
    el.style.zIndex = '9999';
    el.style.opacity = '0';
    el.style.pointerEvents = 'auto';
    document.body.appendChild(el);

    const result = detectOverlay(el);
    expect(result.flagged).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  // True Positive 2: Big fixed z-index ad overlay
  test('flags big fixed high z-index ad overlay with transparent background', () => {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.zIndex = '500';
    el.style.backgroundColor = 'transparent';
    el.style.pointerEvents = 'all';
    document.body.appendChild(el);

    const result = detectOverlay(el);
    expect(result.flagged).toBe(true);
    expect(result.reasons.some(r => r.includes('Position is absolute'))).toBe(true);
  });

  // True Negative 1: A real login modal
  test('does not flag a real login modal with role="dialog" and sufficient text', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'dialog');
    el.style.position = 'fixed';
    el.style.top = '20%';
    el.style.left = '20%';
    el.style.width = '60%';
    el.style.height = '60%';
    el.style.zIndex = '1000';
    el.style.backgroundColor = '#ffffff';
    el.textContent =
      'Please enter your credentials to log in to your account securely. We protect your security with encryption.';
    document.body.appendChild(el);

    const result = detectOverlay(el);
    expect(result.flagged).toBe(false);
  });

  // True Negative 2: A cookie banner
  test('does not flag a cookie banner matching cookie selectors', () => {
    const el = document.createElement('div');
    el.className = 'cookie-consent-banner';
    el.id = 'cookie-notice';
    el.style.position = 'fixed';
    el.style.bottom = '0';
    el.style.width = '100%';
    el.style.height = '100px';
    el.style.zIndex = '99999';
    el.style.backgroundColor = '#333333';
    el.textContent = 'We use cookies to improve your user experience. Accept or decline.';
    document.body.appendChild(el);

    const result = detectOverlay(el);
    expect(result.flagged).toBe(false);
  });
});
