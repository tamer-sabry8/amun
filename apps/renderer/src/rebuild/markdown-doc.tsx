import type { ReactNode } from "react";
import type { Block, Inline } from "./markdown-view.ts";
import { parseMarkdown } from "./markdown-view.ts";

const inline = (nodes: Inline[]): ReactNode[] =>
  nodes.map((node, index) =>
    node.kind === "text" ? (
      node.text
    ) : node.kind === "code" ? (
      <code key={index}>{node.text}</code>
    ) : (
      <strong key={index}>{inline(node.children)}</strong>
    ),
  );

function BlockView({
  block,
  disabled,
  onToggle,
}: {
  block: Block;
  disabled: boolean;
  onToggle(line: number): void;
}) {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3";
      return <Tag>{inline(block.content)}</Tag>;
    }
    case "rule":
      return <hr />;
    case "table":
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={index}>{inline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, at) => (
                  <td key={at}>{inline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag>
          {block.items.map((item, index) =>
            item.task ? (
              <li key={index} className="task">
                <label>
                  <input
                    type="checkbox"
                    checked={item.task.checked}
                    disabled={disabled}
                    aria-label={item.task.label}
                    onChange={() => onToggle(item.task!.line)}
                  />
                  <span>{inline(item.content)}</span>
                </label>
              </li>
            ) : (
              <li key={index}>{inline(item.content)}</li>
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
              {inline(line)}
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
}: {
  body: string;
  disabled: boolean;
  onToggle(line: number): void;
}) {
  return (
    <div className="rb-doc-view" role="document">
      {parseMarkdown(body).map((block, index) => (
        <BlockView
          key={index}
          block={block}
          disabled={disabled}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
