/** The types of `openInDesktop.js`; the reasons are written there. */

export const OPEN_APP: string;
export const OPENED: string;
export function pathOf(href: string): string | null;
export function openInDesktop(app: string, href: string, win?: Window): void;
