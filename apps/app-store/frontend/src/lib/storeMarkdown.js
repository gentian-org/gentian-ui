// @ts-check
/**
 * store-markdown-1: the Markdown a store may send, read into a tree.
 *
 * A store is a service outside the cluster, and what it sends is data. Two
 * fields of its answers -- an app's description and a version's release
 * notes -- are Markdown, restricted by the store API's definition to a
 * subset named store-markdown-1:
 *
 *   rendered                                    shown as the characters written
 *   ------------------------------------------  --------------------------------
 *   paragraphs, hard line breaks                raw HTML
 *   emphasis, strong emphasis                   images
 *   inline code; fenced code blocks             tables, block quotes, thematic breaks
 *   bullet and ordered lists, two levels        reference-style links, autolinks, footnotes
 *   headings of level 2 and 3                   headings of any other level
 *   inline links to an absolute https URL       links with any other scheme
 *
 * This module is an allow-list, not a filter. It does not take HTML and
 * remove what is dangerous; it produces a tree that can only hold the node
 * types below, and everything the subset does not name stays text. The tree
 * is turned into elements by `StoreMarkdown.tsx`, which has one case per
 * node type and no way to emit anything else. No HTML string is built
 * anywhere, so there is none to inject into.
 *
 * It is plain JavaScript with no imports, so it runs under `node --test`
 * (test/storeMarkdown.test.js) with no build step and no test tooling.
 *
 * @typedef {{type: "text", value: string}
 *   | {type: "break"}
 *   | {type: "code", value: string}
 *   | {type: "emphasis", children: Inline[]}
 *   | {type: "strong", children: Inline[]}
 *   | {type: "link", href: string, children: Inline[]}} Inline
 * @typedef {{type: "paragraph", children: Inline[]}
 *   | {type: "heading", level: 2 | 3, children: Inline[]}
 *   | {type: "codeBlock", value: string}
 *   | {type: "list", ordered: boolean, start: number, items: Block[][]}} Block
 */

/** The definition's own limit on a Markdown field. Longer is shown as text. */
export const MAX_LENGTH = 20000;
/** Lists nest at most two levels; a third is shown as written. */
const MAX_LIST_DEPTH = 2;

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const BULLET = /^( {0,3})([-*+])( {1,4})(\S.*)$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])( {1,4})(\S.*)$/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const PUNCTUATION = /[!-/:-@[-`{-~\p{P}\p{S}]/u;
const ESCAPABLE = /[!-/:-@[-`{-~]/;

/**
 * Read a store-markdown-1 field into blocks.
 * @param {unknown} source
 * @returns {Block[]}
 */
export function parseStoreMarkdown(source) {
  if (typeof source !== "string" || source.trim() === "") return [];
  if (source.length > MAX_LENGTH) {
    return [{ type: "paragraph", children: [{ type: "text", value: source }] }];
  }
  const lines = source.replace(/\r\n?/g, "\n").replace(/\u0000/g, "\uFFFD").split("\n");
  return blocks(lines, 0);
}

/**
 * Whether a link's destination is one this subset follows: an absolute https
 * URL, with a host and no credentials in it.
 * @param {string} destination
 * @returns {string | null} the address to link to, or null
 */
export function httpsDestination(destination) {
  // A host must follow the two slashes, and nothing in the address is a
  // space, a control character, a quote, an angle bracket or a backslash.
  if (!/^https:\/\/[^\s\u0000-\u001f\u007f<>"\\/?#][^\s\u0000-\u001f\u007f<>"\\]*$/i.test(destination)) {
    return null;
  }
  let url;
  try {
    url = new URL(destination);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  return url.href;
}

/**
 * @param {string} line
 * @returns {{ordered: boolean, start: number, indent: number, content: number, rest: string} | null}
 */
function listItem(line) {
  if (THEMATIC.test(line)) return null;
  let m = BULLET.exec(line);
  if (m) {
    const content = m[1].length + 1 + m[3].length;
    return { ordered: false, start: 1, indent: m[1].length, content, rest: m[4] };
  }
  m = ORDERED.exec(line);
  if (m) {
    const content = m[1].length + m[2].length + 1 + m[4].length;
    return { ordered: true, start: Number(m[2]), indent: m[1].length, content, rest: m[5] };
  }
  return null;
}

/** @param {string} line */
const blank = (line) => line.trim() === "";
/** @param {string} line */
const indentOf = (line) => /^ */.exec(line)?.[0].length ?? 0;

/**
 * Whether a line starts a block of its own, and so ends a paragraph.
 * @param {string} line
 * @param {number} depth
 */
function startsBlock(line, depth) {
  if (FENCE.test(line) && fenceOf(line)) return true;
  const heading = HEADING.exec(line);
  if (heading && (heading[1].length === 2 || heading[1].length === 3)) return true;
  if (depth < MAX_LIST_DEPTH) {
    const item = listItem(line);
    // As in CommonMark: an ordered list interrupts a paragraph only when it
    // starts at 1, so "…ended in\n1986. A year…" stays a sentence.
    if (item && (!item.ordered || item.start === 1)) return true;
  }
  return false;
}

/**
 * @param {string} line
 * @returns {{char: string, length: number} | null}
 */
function fenceOf(line) {
  const m = FENCE.exec(line);
  if (!m) return null;
  // A backtick fence's info string holds no backtick; otherwise it is
  // inline code, written at the start of a line.
  if (m[1][0] === "`" && m[2].includes("`")) return null;
  return { char: m[1][0], length: m[1].length };
}

/**
 * @param {string[]} lines
 * @param {number} depth how many lists this text is already inside
 * @returns {Block[]}
 */
function blocks(lines, depth) {
  /** @type {Block[]} */
  const out = [];
  /** @type {string[]} */
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) {
      out.push({ type: "paragraph", children: inline(paragraph.join("\n")) });
      paragraph = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      flush();
      i++;
      continue;
    }

    const fence = fenceOf(line);
    if (fence) {
      flush();
      const closing = new RegExp(`^ {0,3}${fence.char}{${fence.length},}[ \\t]*$`);
      /** @type {string[]} */
      const body = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence, or the end of the text
      // The info string is dropped: a block is shown preformatted and is
      // never highlighted by a language a store names.
      out.push({ type: "codeBlock", value: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading && (heading[1].length === 2 || heading[1].length === 3)) {
      flush();
      out.push({
        type: "heading",
        level: heading[1].length === 2 ? 2 : 3,
        children: inline(heading[2]),
      });
      i++;
      continue;
    }

    const first = depth < MAX_LIST_DEPTH ? listItem(line) : null;
    if (first && (paragraph.length === 0 || !first.ordered || first.start === 1)) {
      flush();
      /** @type {Block[][]} */
      const items = [];
      while (i < lines.length) {
        const item = listItem(lines[i]);
        if (!item || item.ordered !== first.ordered || item.indent > first.indent + 1) break;
        /** @type {string[]} */
        const body = [item.rest];
        i++;
        while (i < lines.length) {
          const next = lines[i];
          if (blank(next)) {
            // A blank line stays in the item only when what follows it is
            // still indented under the item.
            let j = i;
            while (j < lines.length && blank(lines[j])) j++;
            if (j < lines.length && indentOf(lines[j]) >= item.content) {
              body.push("");
              i++;
              continue;
            }
            break;
          }
          if (indentOf(next) >= item.content) {
            body.push(next.slice(item.content));
            i++;
            continue;
          }
          // A line that is not indented and starts nothing continues the
          // item's paragraph, as it would in CommonMark.
          if (listItem(next) || startsBlock(next, depth)) break;
          body.push(next.trimStart());
          i++;
        }
        items.push(blocks(body, depth + 1));
        // Blank lines between two items of one list.
        let j = i;
        while (j < lines.length && blank(lines[j])) j++;
        const following = j < lines.length ? listItem(lines[j]) : null;
        if (j > i && following && following.ordered === first.ordered) i = j;
      }
      out.push({ type: "list", ordered: first.ordered, start: first.start, items });
      continue;
    }

    // Everything else is a paragraph's line, as it was written: a heading of
    // another level, a block quote, a table row, a thematic break, HTML, a
    // third level of list. Leading indentation is not kept; it carries no
    // meaning the subset has.
    if (paragraph.length && startsBlock(line, depth)) flush();
    paragraph.push(depth >= MAX_LIST_DEPTH ? line : line.replace(/^ {0,3}(?! )/, ""));
    i++;
  }
  flush();
  return out;
}

/**
 * @typedef {{kind: "delimiter", char: string, count: number, original: number,
 *   canOpen: boolean, canClose: boolean, active: boolean}} Delimiter
 * @typedef {Inline | Delimiter} Piece
 */

/**
 * Read a paragraph's text into inline nodes.
 * @param {string} text
 * @param {boolean} [insideLink] links do not nest
 * @returns {Inline[]}
 */
function inline(text, insideLink = false) {
  /** @type {Piece[]} */
  const pieces = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      pieces.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    if (c === "\\") {
      const next = text[i + 1];
      if (next === "\n") {
        flush();
        pieces.push({ type: "break" });
        i += 2;
        continue;
      }
      if (next !== undefined && ESCAPABLE.test(next)) {
        buffer += next;
        i += 2;
        continue;
      }
      buffer += c;
      i++;
      continue;
    }

    if (c === "\n") {
      // Two or more spaces before the end of a line are a hard break; a
      // plain end of line is a space.
      const spaces = /( *)$/.exec(buffer)?.[1].length ?? 0;
      buffer = buffer.slice(0, buffer.length - spaces);
      flush();
      pieces.push(spaces >= 2 ? { type: "break" } : { type: "text", value: " " });
      i++;
      while (text[i] === " ") i++;
      continue;
    }

    if (c === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      const close = closingBackticks(text, i + run, run);
      if (close === -1) {
        buffer += text.slice(i, i + run);
        i += run;
        continue;
      }
      let value = text.slice(i + run, close).replace(/\n/g, " ");
      if (value.length > 1 && value.startsWith(" ") && value.endsWith(" ") && value.trim()) {
        value = value.slice(1, -1);
      }
      flush();
      pieces.push({ type: "code", value });
      i = close + run;
      continue;
    }

    if (c === "!" && text[i + 1] === "[") {
      // An image. Not in the subset: the whole construct stays as written,
      // so that what follows the "!" is not read as a link either.
      const end = linkEnd(text, i + 1);
      const length = end ? end.end - i : 1;
      buffer += text.slice(i, i + length);
      i += length;
      continue;
    }

    if (c === "[") {
      const link = insideLink ? null : linkEnd(text, i);
      if (link) {
        const href = httpsDestination(link.destination);
        if (href !== null) {
          flush();
          pieces.push({ type: "link", href, children: inline(link.label, true) });
        } else {
          // A link with another scheme, or a relative one: as written.
          buffer += text.slice(i, link.end);
        }
        i = link.end;
        continue;
      }
      buffer += c;
      i++;
      continue;
    }

    if (c === "*" || c === "_") {
      let run = 1;
      while (text[i + run] === c) run++;
      const before = i === 0 ? " " : text[i - 1];
      const after = i + run >= text.length ? " " : text[i + run];
      const spaceBefore = /\s/.test(before);
      const spaceAfter = /\s/.test(after);
      const punctBefore = PUNCTUATION.test(before);
      const punctAfter = PUNCTUATION.test(after);
      const left = !spaceAfter && (!punctAfter || spaceBefore || punctBefore);
      const right = !spaceBefore && (!punctBefore || spaceAfter || punctAfter);
      flush();
      pieces.push({
        kind: "delimiter",
        char: c,
        count: run,
        original: run,
        canOpen: c === "*" ? left : left && (!right || punctBefore),
        canClose: c === "*" ? right : right && (!left || punctAfter),
        active: true,
      });
      i += run;
      continue;
    }

    buffer += c;
    i++;
  }
  flush();
  return merge(emphasis(pieces));
}

/**
 * The index of a run of exactly `length` backticks at or after `from`.
 * @param {string} text
 * @param {number} from
 * @param {number} length
 */
function closingBackticks(text, from, length) {
  let i = from;
  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let run = 1;
    while (text[i + run] === "`") run++;
    if (run === length) return i;
    i += run;
  }
  return -1;
}

/**
 * An inline link starting at the "[" at `start`: `[label](destination)` or
 * `[label](destination "title")`. Reference-style links -- `[a][b]`, `[a]` --
 * are not inline links and are not found here.
 * @param {string} text
 * @param {number} start
 * @returns {{label: string, destination: string, end: number} | null}
 */
function linkEnd(text, start) {
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
    } else if (c === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      const close = closingBackticks(text, i + run, run);
      i = close === -1 ? i + run - 1 : close + run - 1;
    } else if (c === "[") {
      depth++;
    } else if (c === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (i >= text.length || text[i + 1] !== "(") return null;
  const label = text.slice(start + 1, i);
  let j = i + 2;
  while (text[j] === " " || text[j] === "\n") j++;
  let destination = "";
  if (text[j] === "<") {
    const close = text.indexOf(">", j);
    if (close === -1 || text.slice(j, close).includes("\n")) return null;
    destination = text.slice(j + 1, close);
    j = close + 1;
  } else {
    let parens = 0;
    const from = j;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "\\" && j + 1 < text.length) {
        j++;
      } else if (c === "(") {
        parens++;
      } else if (c === ")") {
        if (parens === 0) break;
        parens--;
      } else if (c === " " || c === "\n") {
        break;
      }
    }
    destination = text.slice(from, j).replace(/\\([!-/:-@[-`{-~])/g, "$1");
  }
  while (text[j] === " " || text[j] === "\n") j++;
  const quote = text[j];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, j + 1);
    if (close === -1) return null;
    j = close + 1;
    while (text[j] === " " || text[j] === "\n") j++;
  }
  if (text[j] !== ")") return null;
  return { label, destination, end: j + 1 };
}

/**
 * Pair the emphasis delimiters, as CommonMark's algorithm does, and turn
 * what is left unpaired back into the characters it was written with.
 * @param {Piece[]} pieces
 * @returns {Inline[]}
 */
function emphasis(pieces) {
  /** @param {Piece} p @returns {p is Delimiter} */
  const isDelimiter = (p) => "kind" in p;

  for (let closer = 0; closer < pieces.length; closer++) {
    const c = pieces[closer];
    if (!isDelimiter(c) || !c.canClose || !c.active) continue;
    let opener = closer - 1;
    for (; opener >= 0; opener--) {
      const o = pieces[opener];
      if (!isDelimiter(o) || !o.active || !o.canOpen || o.char !== c.char) continue;
      // The "multiple of three" rule, which is what makes *a**b*c** nest the
      // way a reader expects.
      const both = (o.canOpen && o.canClose) || (c.canOpen && c.canClose);
      if (both && (o.original + c.original) % 3 === 0 && (o.original % 3 || c.original % 3)) {
        continue;
      }
      break;
    }
    if (opener < 0) {
      if (!c.canOpen) c.active = false;
      continue;
    }
    const o = /** @type {Delimiter} */ (pieces[opener]);
    const strong = o.count >= 2 && c.count >= 2;
    const used = strong ? 2 : 1;
    const inner = /** @type {Inline[]} */ (
      pieces.slice(opener + 1, closer).map((p) => (isDelimiter(p) ? literal(p) : p))
    );
    /** @type {Inline} */
    const node = strong
      ? { type: "strong", children: merge(inner) }
      : { type: "emphasis", children: merge(inner) };
    o.count -= used;
    c.count -= used;
    /** @type {Piece[]} */
    const replacement = [];
    if (o.count > 0) replacement.push(o);
    replacement.push(node);
    if (c.count > 0) replacement.push(c);
    pieces.splice(opener, closer - opener + 1, ...replacement);
    // Go on from the node. A closer with characters left comes right after
    // it and is looked at again: it may close an earlier opener.
    closer = opener + (o.count > 0 ? 1 : 0);
  }
  return pieces.map((p) => (isDelimiter(p) ? literal(p) : p));
}

/** @param {Delimiter} delimiter @returns {Inline} */
function literal(delimiter) {
  return { type: "text", value: delimiter.char.repeat(delimiter.count) };
}

/**
 * Join neighbouring text nodes.
 * @param {Inline[]} nodes
 * @returns {Inline[]}
 */
function merge(nodes) {
  /** @type {Inline[]} */
  const out = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === "text" && last && last.type === "text") {
      last.value += node.value;
    } else if (node.type !== "text" || node.value !== "") {
      out.push(node.type === "text" ? { ...node } : node);
    }
  }
  return out;
}
