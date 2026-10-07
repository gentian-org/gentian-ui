// store-markdown-1, as the store API's definition gives it: what is rendered,
// and what is shown as the characters it was written with.
//
//   node --test test/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LENGTH, httpsDestination, parseStoreMarkdown } from "../src/lib/storeMarkdown.js";

const text = (value) => ({ type: "text", value });
const p = (...children) => ({ type: "paragraph", children });
const one = (source) => {
  const blocks = parseStoreMarkdown(source);
  assert.equal(blocks.length, 1, JSON.stringify(blocks));
  return blocks[0];
};

/** Every node of a tree, blocks and inlines alike. */
function* walk(nodes) {
  for (const node of nodes) {
    yield node;
    if (node.children) yield* walk(node.children);
    if (node.items) for (const item of node.items) yield* walk(item);
  }
}
/** The characters a tree shows, in order. */
const shown = (nodes) =>
  [...walk(nodes)].map((n) => (n.type === "text" || n.type === "code" || n.type === "codeBlock" ? n.value : "")).join("");

// ── rendered ────────────────────────────────────────────────────────────────

test("paragraphs are separated by a blank line", () => {
  assert.deepEqual(parseStoreMarkdown("One.\n\nTwo."), [p(text("One.")), p(text("Two."))]);
});

test("a line end inside a paragraph is a space", () => {
  assert.deepEqual(one("one\ntwo"), p(text("one two")));
});

test("two spaces before a line end, or a backslash, are a hard line break", () => {
  assert.deepEqual(one("one  \ntwo"), p(text("one"), { type: "break" }, text("two")));
  assert.deepEqual(one("one\\\ntwo"), p(text("one"), { type: "break" }, text("two")));
});

test("emphasis and strong emphasis", () => {
  assert.deepEqual(one("an *emphasised* word"), p(text("an "), { type: "emphasis", children: [text("emphasised")] }, text(" word")));
  assert.deepEqual(one("a _second_ way"), p(text("a "), { type: "emphasis", children: [text("second")] }, text(" way")));
  assert.deepEqual(one("**Enterprise** support"), p({ type: "strong", children: [text("Enterprise")] }, text(" support")));
  assert.deepEqual(one("__also__ strong"), p({ type: "strong", children: [text("also")] }, text(" strong")));
});

test("emphasis nests", () => {
  assert.deepEqual(
    one("***both***"),
    p({ type: "emphasis", children: [{ type: "strong", children: [text("both")] }] }),
  );
  assert.deepEqual(
    one("**strong with *emphasis* inside**"),
    p({
      type: "strong",
      children: [text("strong with "), { type: "emphasis", children: [text("emphasis")] }, text(" inside")],
    }),
  );
});

test("a star or an underscore that opens nothing is a character", () => {
  assert.deepEqual(one("2 * 3 * 4"), p(text("2 * 3 * 4")));
  assert.deepEqual(one("snake_case_name"), p(text("snake_case_name")));
  assert.deepEqual(one("an unclosed *star"), p(text("an unclosed *star")));
  assert.deepEqual(one("\\*escaped\\*"), p(text("*escaped*")));
});

test("inline code keeps what is inside as written", () => {
  assert.deepEqual(one("run `kubectl get *pods*` now"), p(text("run "), { type: "code", value: "kubectl get *pods*" }, text(" now")));
  assert.deepEqual(one("``a ` b``"), p({ type: "code", value: "a ` b" }));
  assert.deepEqual(one("an unclosed ` tick"), p(text("an unclosed ` tick")));
});

test("a fenced code block is preformatted, and its language is dropped", () => {
  assert.deepEqual(parseStoreMarkdown("```yaml\nkey: *value*\n  <b>indent</b>\n```\nafter"), [
    { type: "codeBlock", value: "key: *value*\n  <b>indent</b>" },
    p(text("after")),
  ]);
  assert.deepEqual(one("~~~\na\n\nb\n~~~"), { type: "codeBlock", value: "a\n\nb" });
  // No node carries the info string: nothing can be highlighted "as" it.
  assert.ok(!JSON.stringify(parseStoreMarkdown("```javascript\nx\n```")).includes("javascript"));
});

test("a fence that is never closed runs to the end", () => {
  assert.deepEqual(one("```\nopen"), { type: "codeBlock", value: "open" });
});

test("bullet and ordered lists", () => {
  assert.deepEqual(one("- one\n- two\n* three"), {
    type: "list",
    ordered: false,
    start: 1,
    items: [[p(text("one"))], [p(text("two"))], [p(text("three"))]],
  });
  assert.deepEqual(one("3. three\n4. four"), {
    type: "list",
    ordered: true,
    start: 3,
    items: [[p(text("three"))], [p(text("four"))]],
  });
});

test("a list nests one level", () => {
  assert.deepEqual(one("- fruit\n  - apple\n  - pear\n- bread"), {
    type: "list",
    ordered: false,
    start: 1,
    items: [
      [
        p(text("fruit")),
        { type: "list", ordered: false, start: 1, items: [[p(text("apple"))], [p(text("pear"))]] },
      ],
      [p(text("bread"))],
    ],
  });
});

test("a third level of list is shown as it was written", () => {
  const [list] = parseStoreMarkdown("- one\n  - two\n    - three\n    - four");
  const second = list.items[0][1];
  assert.equal(second.type, "list");
  // The second level's item holds a paragraph with the third level's lines
  // in it, markers and all -- and no third list.
  assert.deepEqual(second.items, [[p(text("two - three - four"))]]);
  const lists = [...walk([list])].filter((n) => n.type === "list");
  assert.equal(lists.length, 2);
});

test("a list item may hold more than one paragraph", () => {
  const list = one("1. first\n\n   more of the first\n2. second");
  assert.deepEqual(list.items, [[p(text("first")), p(text("more of the first"))], [p(text("second"))]]);
});

test("headings of level 2 and 3", () => {
  assert.deepEqual(parseStoreMarkdown("## What is *included*\n\n### Detail ##"), [
    { type: "heading", level: 2, children: [text("What is "), { type: "emphasis", children: [text("included")] }] },
    { type: "heading", level: 3, children: [text("Detail")] },
  ]);
});

test("an inline link to an absolute https address", () => {
  assert.deepEqual(
    one("See the [administration manual](https://publisher.example/docs)."),
    p(text("See the "), { type: "link", href: "https://publisher.example/docs", children: [text("administration manual")] }, text(".")),
  );
  assert.deepEqual(
    one('[**bold** label](https://a.example/x?y=1&z=2#frag "a title")'),
    p({
      type: "link",
      href: "https://a.example/x?y=1&z=2#frag",
      children: [{ type: "strong", children: [text("bold")] }, text(" label")],
    }),
  );
  assert.deepEqual(one("[a](<https://a.example/b>)"), p({ type: "link", href: "https://a.example/b", children: [text("a")] }));
  assert.deepEqual(one("[wiki](https://a.example/Foo_(bar))"), p({ type: "link", href: "https://a.example/Foo_(bar)", children: [text("wiki")] }));
});

// ── shown as the characters written ─────────────────────────────────────────

const AS_WRITTEN = [
  ["raw HTML", '<b>bold</b> and <script>alert(1)</script> and <img src=x onerror="alert(1)">'],
  ["an HTML block", '<div onclick="steal()">\ntext\n</div>'],
  ["a comment", "<!-- hidden -->"],
  ["an image", "![a picture](https://media.example/a.png)"],
  ["an image with a title", '![alt](https://media.example/a.png "title") after'],
  ["an autolink", "<https://example.org> and <mailto:a@example.org>"],
  ["a reference-style link", "[label][ref] and [ref] and [collapsed][]"],
  ["a link definition", "[ref]: https://example.org"],
  ["a footnote", "text[^1]"],
  ["a block quote", "> quoted"],
  ["a thematic break", "---"],
  ["a thematic break with spaces", "* * *"],
  ["a table", "| a | b |\n|---|---|\n| 1 | 2 |"],
  ["a heading of level 1", "# Title"],
  ["a heading of level 4", "#### Deep"],
  ["a setext heading", "Title\n====="],
  ["an http link", "[plain](http://example.org)"],
  ["a javascript link", "[click](javascript:alert(1))"],
  ["a javascript link in capitals", "[click](JaVaScRiPt:alert(1))"],
  ["a data link", "[x](data:text/html;base64,PHNjcmlwdD4=)"],
  ["a mailto link", "[mail](mailto:a@example.org)"],
  ["a relative link", "[rel](/oauth/callback?code=x)"],
  ["a protocol-relative link", "[rel](//evil.example/x)"],
  ["a link with credentials", "[x](https://user:pass@example.org/)"],
  ["a link with a space in it", "[x](https://example.org/a b)"],
  ["a link with a control character", "[x](https://example.org/\u0001)"],
  ["a vbscript link", "[x](vbscript:msgbox)"],
  ["a file link", "[x](file:///etc/passwd)"],
];

for (const [name, source] of AS_WRITTEN) {
  test(`${name} is shown as the characters it is written with`, () => {
    const blocks = parseStoreMarkdown(source);
    for (const node of walk(blocks)) {
      assert.ok(["paragraph", "text"].includes(node.type), `${node.type} from ${JSON.stringify(source)}`);
    }
    // Every character that was written is shown; only a line end became a space.
    assert.equal(shown(blocks).replace(/\s+/g, " "), source.replace(/\s+/g, " "));
  });
}

test("what follows an image's bang is not read as a link", () => {
  const links = [...walk(parseStoreMarkdown("![alt](https://media.example/a.png)"))].filter((n) => n.type === "link");
  assert.deepEqual(links, []);
});

test("a link does not nest in a link", () => {
  const blocks = parseStoreMarkdown("[outer [inner](https://b.example) text](https://a.example)");
  const links = [...walk(blocks)].filter((n) => n.type === "link");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://a.example/");
});

test("only an absolute https address is a destination", () => {
  assert.equal(httpsDestination("https://example.org/a?b=c"), "https://example.org/a?b=c");
  assert.equal(httpsDestination("HTTPS://EXAMPLE.org/"), "https://example.org/");
  for (const refused of [
    "http://example.org",
    "javascript:alert(1)",
    " https://example.org",
    "https://",
    "https:///path",
    "https://user@example.org",
    "https:example.org",
    "//example.org",
    "/relative",
    "",
    "https://example.org/\nx",
    'https://example.org/"onmouseover="x',
  ]) {
    assert.equal(httpsDestination(refused), null, JSON.stringify(refused));
  }
});

// ── the whole ───────────────────────────────────────────────────────────────

test("the definition's example description", () => {
  const description =
    "Nextcloud keeps a team's files, calendars and contacts in one place.\n\n" +
    "## What is included\n\n" +
    "- File sync and sharing\n- Calendar and contacts\n- **Enterprise** support by the publisher\n\n" +
    "See the [administration manual](https://publisher.example/docs).\n";
  assert.deepEqual(parseStoreMarkdown(description), [
    p(text("Nextcloud keeps a team's files, calendars and contacts in one place.")),
    { type: "heading", level: 2, children: [text("What is included")] },
    {
      type: "list",
      ordered: false,
      start: 1,
      items: [
        [p(text("File sync and sharing"))],
        [p(text("Calendar and contacts"))],
        [p({ type: "strong", children: [text("Enterprise")] }, text(" support by the publisher"))],
      ],
    },
    p(text("See the "), { type: "link", href: "https://publisher.example/docs", children: [text("administration manual")] }, text(".")),
  ]);
});

test("nothing, and what is not a string, is nothing", () => {
  for (const empty of ["", "   \n\n", null, undefined, 42, {}, ["# a"]]) {
    assert.deepEqual(parseStoreMarkdown(empty), []);
  }
});

test("a field longer than the definition allows is shown as text", () => {
  const long = "**a** ".repeat(MAX_LENGTH);
  assert.deepEqual(parseStoreMarkdown(long), [p(text(long))]);
});

const NODE_TYPES = new Set(["paragraph", "heading", "codeBlock", "list", "text", "break", "code", "emphasis", "strong", "link"]);

test("whatever is written, the tree holds only the subset's nodes and https links", () => {
  // Not a proof, a net: pieces of Markdown and of attacks, joined at random.
  const pieces = [
    "*", "**", "_", "__", "`", "```", "~~~", "[", "]", "(", ")", "<", ">", "!", "#", "## ", "### ", "- ", "1. ",
    "  ", "    ", "\n", "\n\n", "\\", "|", "> ", "---", "https://a.example/x", "javascript:alert(1)", "http://b.example",
    "<script>", "</script>", "<img src=x onerror=alert(1)>", "text", "ünïcödé", "\u0000", "\t", '"', "'", "&lt;", "[x](", "![",
  ];
  let seed = 20261007;
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 3000; round++) {
    let source = "";
    const length = 1 + Math.floor(random() * 30);
    for (let i = 0; i < length; i++) source += pieces[Math.floor(random() * pieces.length)];
    const blocks = parseStoreMarkdown(source);
    let depth = 0;
    const measure = (nodes, level) => {
      for (const node of nodes) {
        assert.ok(NODE_TYPES.has(node.type), `${node.type} from ${JSON.stringify(source)}`);
        if (node.type === "link") assert.match(node.href, /^https:\/\/[^\s"<>]+$/, JSON.stringify(source));
        if (node.type === "heading") assert.ok(node.level === 2 || node.level === 3);
        if (node.type === "list") {
          depth = Math.max(depth, level + 1);
          for (const item of node.items) measure(item, level + 1);
        } else if (node.children) {
          measure(node.children, level);
        }
      }
    };
    measure(blocks, 0);
    assert.ok(depth <= 2, `a list ${depth} levels deep from ${JSON.stringify(source)}`);
  }
});
