import { install } from './detectors/navguard';
import { detectOverlay } from './detectors/overlay';

const DEBUG = true;

if (DEBUG) {
  console.log("[PopGuard] Content script loaded");
}

install();

function scanForOverlays() {
  if (DEBUG) {
    console.log("[PopGuard] DOM scan started");
  }
  
  // Consider typical overlay containers as candidates
  const candidates = document.querySelectorAll('div, dialog, iframe, section, a');
  
  if (DEBUG) {
    console.log(`[PopGuard] Found ${candidates.length} candidate elements`);
  }
  
  let flaggedCount = 0;
  
  candidates.forEach(candidate => {
    const el = candidate as HTMLElement;
    const result = detectOverlay(el);
    
    if (DEBUG) {
      console.log(`[PopGuard] Candidate:`, el.tagName, el.id ? `#${el.id}` : '', el.className ? `.${el.className}` : '');
      console.log(`[PopGuard] Signals:`, result.reasons);
      console.log(`[PopGuard] Final result: flagged=${result.flagged} | reasons=${result.reasons.join('; ')}`);
    }
    
    if (result.flagged) {
      flaggedCount++;
    }
  });
  
  if (DEBUG) {
    console.log(`[PopGuard] Scan complete. Found ${flaggedCount} flagged overlays.`);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scanForOverlays);
} else {
  // Add a small delay if already loaded to ensure styles are applied
  setTimeout(scanForOverlays, 100);
}
