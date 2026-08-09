import { Extension, Node } from "@tiptap/core";

const imageAttributes = new Set([
  "alt",
  "height",
  "role",
  "sizes",
  "src",
  "srcset",
  "title",
  "width",
]);

function openingTag(source: string) {
  return source.slice(0, source.indexOf(">") + 1);
}

function onlyAttributes(source: string, allowed: Set<string>) {
  const opening = openingTag(source);
  const names = [
    ...opening.matchAll(/\s+([a-z_:][\w:.-]*)\s*(?==|\/?\s*>)/gi),
  ].map((match) => match[1].toLowerCase());
  return names.every((name) => allowed.has(name));
}

export function isStandardVisualMarkup(value: string) {
  const source = value.trimStart();
  if (/^<img\b/i.test(source)) return onlyAttributes(source, imageAttributes);
  if (
    /^<figure\s+class=(?:"[^"]*\bpost-figure\b[^"]*"|'[^']*\bpost-figure\b[^']*')\s*>/i.test(
      source,
    )
  )
    return true;
  if (
    /^<div\s+class=(?:"[^"]*\bimage-pair(?:-individual)?\b[^"]*"|'[^']*\bimage-pair(?:-individual)?\b[^']*')\s*>/i.test(
      source,
    )
  )
    return true;
  return false;
}

function customLabel(source: string) {
  const tag = source.trimStart().match(/^<([a-z][\w-]*)/i)?.[1];
  return tag ? `${tag.toUpperCase()} Custom Content` : "Custom Content";
}

export const CustomContent = Node.create({
  name: "customContent",
  group: "block",
  atom: true,
  isolating: true,
  selectable: false,
  draggable: false,
  addAttributes() {
    return { source: { default: "" } };
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        class: "custom-content-placeholder",
        contenteditable: "false",
        role: "note",
        "aria-label": `${customLabel(node.attrs.source)}. Edit in the Source tab.`,
      },
      ["strong", {}, customLabel(node.attrs.source)],
      ["span", {}, "Locked in Visual · Edit in Source"],
    ];
  },
  markdownTokenName: "customContent",
  markdownTokenizer: {
    name: "customContent",
    level: "block",
    start(source) {
      return source.match(/^ {0,3}<svg\b/im)?.index ?? -1;
    },
    tokenize(source) {
      const match = source.match(
        /^ {0,3}(<svg\b[\s\S]*?<\/svg>|<svg\b[^>]*\/>)\s*(?:\r?\n|$)/i,
      );
      if (!match) return undefined;
      return {
        type: "customContent",
        raw: match[0],
        source: match[1],
      };
    },
  },
  parseMarkdown(token, helpers) {
    const source = String(
      (token as typeof token & { source?: string }).source ?? "",
    );
    return helpers.createNode("customContent", { source });
  },
  renderMarkdown(node) {
    return String(node.attrs?.source ?? "");
  },
});

export const CustomHtmlBlocks = Extension.create({
  name: "customHtmlBlocks",
  markdownTokenName: "html",
  parseMarkdown(token, helpers) {
    const source = String(token.raw ?? token.text ?? "").replace(/\r?\n$/, "");
    if (!token.block || isStandardVisualMarkup(source)) return [];
    return helpers.createNode("customContent", { source });
  },
});
