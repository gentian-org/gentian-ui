/** The types of `pendingWindow.js`; the reasons are written there. */

export function openPending(win?: Window): Window | null;
export function sendPending(pending: Window | null, url: string): boolean;
export function closePending(pending: Window | null): void;
