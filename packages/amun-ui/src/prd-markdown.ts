import { MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { type JSONContent, getSchema } from "@tiptap/core";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";

export const prdExtensions = [
  StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit,
];
const manager = new MarkdownManager({ extensions: prdExtensions });
const schema = getSchema(prdExtensions);
const remark = unified().use(remarkParse).use(remarkGfm).use(remarkStringify, {
  bullet: "-",
  emphasis: "*",
  strong: "*",
  fences: true,
});
export const remarkDocument = (markdown: string) =>
  remark.stringify(remark.parse(markdown));
export function writePrd(doc: JSONContent) {
  schema.nodeFromJSON(doc).check();
  return remarkDocument(manager.serialize(doc));
}
export function parsePrd(markdown: string) {
  const warnings: string[] = [];
  const tree = remark.parse(markdown);
  function inspect(node: {
    type: string;
    url?: string;
    children?: { type: string }[];
  }) {
    if (
      [
        "html",
        "image",
        "definition",
        "footnoteDefinition",
        "footnoteReference",
        "linkReference",
        "imageReference",
      ].includes(node.type) ||
      (node.type === "link" &&
        !/^(https?:\/\/|mailto:|#)/i.test(node.url ?? ""))
    )
      warnings.push("This formatting requires Markdown mode.");
    node.children?.forEach(inspect);
  }
  inspect(tree);
  if (warnings.length)
    return {
      doc: { type: "doc", content: [{ type: "paragraph" }] },
      warnings: [warnings[0]!],
    };
  const doc = manager.parse(remark.stringify(tree));
  if (writePrd(doc).trim() !== remark.stringify(tree).trim())
    warnings.push(
      "Visual conversion would change this Markdown. Continue editing it in Markdown mode.",
    );
  return { doc, warnings };
}
