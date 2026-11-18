import type { ReactNode } from "react";
import type { Block, Inline } from "./markdown-view.ts";
import { parseMarkdown } from "./markdown-view.ts";
import {
  splitCitations,
  type Cite,
  type CitationContext,
} from "./citations.ts";

type OpenLink = (url: string) => void;

/** Where cited sources open; without a handler citations stay plain text. */
export type Citations = {
  context: CitationContext;
  onOpen(cite: Cite): void;
};

const inline = (
  nodes: Inline[],
  onLink?: OpenLink,
  citations?: Citations,
): ReactNode[] =>
  nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        if (!citations) return node.text;
        return splitCitations(node.text, citations.context).map((piece, at) =>
          typeof piece === "string" ? (
            piece
          ) : (
            <button
              key={`${index}-${at}`}
              type="button"
              className="link"
              title={piece.hint}
              onClick={() => citations.onOpen(piece.cite)}
            >
              {piece.label}
            </button>
          ),
        );
      case "code":
        return <code key={index}>{node.text}</code>;
      case "bold":
        return (
          <strong key={index}>
            {inline(node.children, onLink, citations)}
          </strong>
        );
      case "italic":
        return <em key={index}>{inline(node.children, onLink, citations)}</em>;
      case "link":
        // Links open only through the app's own handler; without one the
        // label is shown as plain text.
        return onLink ? (
          <button
            key={index}
            type="button"
            className="link"
            title={node.url}
            onClick={() => onLink(node.url)}
          >
            {inline(node.children)}
          </button>
        ) : (
          <span key={index}>{inline(node.children)}</span>
        );
    }
  });

function BlockView({
  block,
  disabled,
  onToggle,
  onLink,
  citations,
}: {
  block: Block;
  disabled: boolean;
  onToggle?(line: number): void;
  onLink?: OpenLink | undefined;
  citations?: Citations | undefined;
}) {
  const text = (nodes: Inline[]) => inline(nodes, onLink, citations);
  switch (block.kind) {
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag>{text(block.content)}</Tag>;
    }
    case "code":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr />;
    case "table":
      return (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index}>{text(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, at) => (
                    <td key={at}>{text(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag>
          {block.items.map((item, index) =>
            item.task && !onToggle ? (
              <li key={index} className="task">
                <span
                  role="img"
                  aria-label={item.task.checked ? "Done" : "Not done"}
                  className={"box" + (item.task.checked ? " on" : "")}
                />
                <span>{text(item.content)}</span>
              </li>
            ) : item.task ? (
              <li key={index} className="task">
                <label>
                  <input
                    type="checkbox"
                    checked={item.task.checked}
                    disabled={disabled}
                    aria-label={item.task.label}
                    onChange={() => onToggle?.(item.task!.line)}
                  />
                  <span>{text(item.content)}</span>
                </label>
              </li>
            ) : (
              <li key={index}>{text(item.content)}</li>
            ),
          )}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          {block.lines.map((line, index) => (
            <span key={index}>
              {index > 0 && <br />}
              {text(line)}
            </span>
          ))}
        </p>
      );
  }
}

/** Formatted view of a Markdown body. Built from elements, never raw HTML. */
export function MarkdownDoc({
  body,
  disabled,
  onToggle,
  onLink,
  citations,
}: {
  body: string;
  disabled: boolean;
  onToggle(line: number): void;
  onLink?: OpenLink;
  citations?: Citations;
}) {
  return (
    <div className="rb-doc-view" role="document">
      {parseMarkdown(body).map((block, index) => (
        <BlockView
          key={index}
          block={block}
          disabled={disabled}
          onToggle={onToggle}
          onLink={onLink}
          citations={citations}
        />
      ))}
    </div>
  );
}

/** A Firstmate reply: the same Markdown, read-only, in chat typography. */
export function MarkdownMessage({
  text,
  onLink,
  citations,
}: {
  text: string;
  onLink?: OpenLink;
  citations?: Citations;
}) {
  return (
    <div className="rb-doc-view chat">
      {parseMarkdown(text).map((block, index) => (
        <BlockView
          key={index}
          block={block}
          disabled
          onLink={onLink}
          citations={citations}
        />
      ))}
    </div>
  );
}
