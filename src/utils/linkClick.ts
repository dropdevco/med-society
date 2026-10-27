import type { MouseEvent } from 'react';

/**
 * True for a plain primary-button click with no modifier — the only click a
 * link should hijack for in-app behaviour (open the modal, etc.). Anything
 * else (Ctrl/Cmd/Shift/Alt-click, middle-click, an already-handled event) is
 * left to the browser so "open in new tab" and friends keep working on
 * anchors that also have an onClick handler.
 */
export function isPlainClick(e: MouseEvent): boolean {
    return !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}
