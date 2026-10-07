/** The types of `storeMarkdown.js`; the reasons are written there. */

export type Inline =
  | { type: "text"; value: string }
  | { type: "break" }
  | { type: "code"; value: string }
  | { type: "emphasis"; children: Inline[] }
  | { type: "strong"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 2 | 3; children: Inline[] }
  | { type: "codeBlock"; value: string }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] };

export const MAX_LENGTH: number;
export function parseStoreMarkdown(source: unknown): Block[];
export function httpsDestination(destination: string): string | null;
