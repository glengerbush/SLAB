import { Node, type MarkdownToken } from "@tiptap/core";

function labelFrom(token: MarkdownToken) {
  return String(token.label ?? "").trim();
}

export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { label: { default: "1" } };
  },
  parseHTML() {
    return [
      {
        tag: "sup[data-footnote-reference]",
        getAttrs: (element) => ({
          label: (element as HTMLElement).dataset.footnoteReference ?? "1",
        }),
      },
    ];
  },
  renderHTML({ node }) {
    const label = String(node.attrs.label);
    return [
      "sup",
      {
        class: "footnote-reference",
        "data-footnote-reference": label,
        title: `Footnote ${label}`,
      },
      label,
    ];
  },
  markdownTokenName: "footnoteReference",
  markdownTokenizer: {
    name: "footnoteReference",
    level: "inline",
    start(source) {
      return source.search(/\[\^[^\]\n]+\](?!:)/);
    },
    tokenize(source) {
      const match = source.match(/^\[\^([^\]\n]+)\](?!:)/);
      if (!match) return undefined;
      return {
        type: "footnoteReference",
        raw: match[0],
        label: match[1],
      };
    },
  },
  parseMarkdown(token, helpers) {
    return helpers.createNode("footnoteReference", {
      label: labelFrom(token),
    });
  },
  renderMarkdown(node) {
    return `[^${String(node.attrs?.label ?? "1")}]`;
  },
});

export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { label: { default: "1" } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-footnote-definition]",
        contentElement: ".footnote-definition-content",
        getAttrs: (element) => ({
          label: (element as HTMLElement).dataset.footnoteDefinition ?? "1",
        }),
      },
    ];
  },
  renderHTML({ node }) {
    const label = String(node.attrs.label);
    return [
      "div",
      {
        class: "footnote-definition",
        "data-footnote-definition": label,
      },
      [
        "span",
        { class: "footnote-definition-label", contenteditable: "false" },
        `[${label}]`,
      ],
      ["div", { class: "footnote-definition-content" }, 0],
    ];
  },
  markdownTokenName: "footnoteDefinition",
  markdownTokenizer: {
    name: "footnoteDefinition",
    level: "block",
    start(source) {
      return source.search(/^ {0,3}\[\^[^\]\n]+\]:/m);
    },
    tokenize(source, _tokens, lexer) {
      const first = source.match(
        /^ {0,3}\[\^([^\]\n]+)\]:[ \t]*(.*?)(?:\r?\n|$)/,
      );
      if (!first) return undefined;

      let raw = first[0];
      let content = first[2];
      let rest = source.slice(raw.length);
      let pendingBlank = "";

      while (rest) {
        const continuation = rest.match(/^(?: {4}|\t)(.*?)(?:\r?\n|$)/);
        if (continuation) {
          raw += pendingBlank + continuation[0];
          content += `\n${pendingBlank ? "\n" : ""}${continuation[1]}`;
          rest = rest.slice(pendingBlank.length + continuation[0].length);
          pendingBlank = "";
          continue;
        }

        const blank = rest.match(/^[ \t]*\r?\n/);
        if (blank) {
          const afterBlank = rest.slice(blank[0].length);
          if (/^(?: {4}|\t)/.test(afterBlank)) {
            pendingBlank += blank[0];
            rest = afterBlank;
            continue;
          }
        }
        break;
      }

      return {
        type: "footnoteDefinition",
        raw,
        label: first[1],
        tokens: lexer.blockTokens(content),
      };
    },
  },
  parseMarkdown(token, helpers) {
    const content = helpers.parseChildren(token.tokens ?? []);
    return helpers.createNode(
      "footnoteDefinition",
      { label: labelFrom(token) },
      content.length ? content : [helpers.createNode("paragraph")],
    );
  },
  renderMarkdown(node, helpers) {
    const label = String(node.attrs?.label ?? "1");
    const content = helpers
      .renderChildren(node.content ?? [], "\n\n")
      .trimEnd();
    const [first = "", ...rest] = content.split("\n");
    const continuation = rest
      .map((line) => (line ? `    ${line}` : ""))
      .join("\n");
    return `[^${label}]: ${first}${continuation ? `\n${continuation}` : ""}`;
  },
});

export const Footnotes = [FootnoteReference, FootnoteDefinition];
