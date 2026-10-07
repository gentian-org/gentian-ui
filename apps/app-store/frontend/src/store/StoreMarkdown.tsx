import { Fragment, useMemo, type ReactNode } from "react";
import { parseStoreMarkdown, type Block, type Inline } from "@/lib/storeMarkdown";

/**
 * A store's Markdown field, rendered.
 *
 * `parseStoreMarkdown` reads the text into a tree that can only hold the
 * node types of store-markdown-1, and this turns each into one element. It
 * is the whole of the rendering: there is a case per node type and no other
 * way out, so nothing a store writes becomes an element this file does not
 * name. No HTML string exists at any point -- React is handed elements and
 * text, and escapes the text.
 *
 * A link is opened in a separate window with no opener and no referrer. Its
 * address was checked to be absolute https when the tree was built.
 */
function inlines(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.value}</Fragment>;
      case "break":
        return <br key={index} />;
      case "code":
        return <code key={index}>{node.value}</code>;
      case "emphasis":
        return <em key={index}>{inlines(node.children)}</em>;
      case "strong":
        return <strong key={index}>{inlines(node.children)}</strong>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
            {inlines(node.children)}
          </a>
        );
    }
  });
}

function blocks(nodes: Block[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "paragraph":
        return <p key={index}>{inlines(node.children)}</p>;
      case "heading":
        return node.level === 2 ? (
          <h3 key={index}>{inlines(node.children)}</h3>
        ) : (
          <h4 key={index}>{inlines(node.children)}</h4>
        );
      case "codeBlock":
        return (
          <pre key={index}>
            <code>{node.value}</code>
          </pre>
        );
      case "list": {
        const items = node.items.map((item, i) => <li key={i}>{blocks(item)}</li>);
        return node.ordered ? (
          <ol key={index} start={node.start}>
            {items}
          </ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      }
    }
  });
}

export function StoreMarkdown({ source }: { source: string }) {
  const tree = useMemo(() => parseStoreMarkdown(source), [source]);
  if (tree.length === 0) return null;
  return <div className="store-markdown">{blocks(tree)}</div>;
}
