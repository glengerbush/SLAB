import { codeToHtml } from "shiki";
import type { Element, Root } from "hast";
import type { Code, Root as MdastRoot } from "mdast";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export interface RenderMarkdownOptions {
  localCmsLinks?: boolean;
  baseUrl?: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function remarkHighlight() {
  return async (tree: MdastRoot) => {
    const blocks: Array<{
      node: Code;
      parent: MdastRoot["children"][number] & {
        children?: MdastRoot["children"];
      };
      index: number;
    }> = [];
    visit(tree, "code", (node, index, parent) => {
      if (typeof index === "number" && parent) {
        blocks.push({ node, parent: parent as never, index });
      }
    });

    await Promise.all(
      blocks.map(async ({ node, parent, index }) => {
        let html: string;
        try {
          html = await codeToHtml(node.value, {
            lang: node.lang || "text",
            themes: { light: "github-light", dark: "github-dark" },
          });
        } catch {
          const language = node.lang
            ? ` class="language-${escapeHtml(node.lang)}"`
            : "";
          html = `<pre><code${language}>${escapeHtml(node.value)}</code></pre>`;
        }
        parent.children![index] = { type: "html", value: html } as never;
      }),
    );
  };
}

function isAllowedModuleScript(node: Element) {
  const type = String(node.properties?.type ?? "").toLowerCase();
  const src = String(node.properties?.src ?? "");
  if (
    type !== "module" ||
    !src.startsWith("/") ||
    src.startsWith("//") ||
    src.includes("\\")
  )
    return false;
  const base = new URL("https://published-site.invalid/");
  return new URL(src, base).origin === base.origin;
}

function rehypeTrustedMarkup() {
  return (tree: Root) => {
    const violations = new Set<string>();
    visit(tree, "element", (node) => {
      if (node.tagName === "script" && !isAllowedModuleScript(node)) {
        violations.add("inline or remote scripts");
      }

      const propertyNames = Object.keys(node.properties ?? {});
      if (
        node.tagName === "iframe" &&
        propertyNames.some((key) => key.toLowerCase() === "srcdoc")
      ) {
        violations.add("iframe srcdoc");
      }

      for (const key of propertyNames) {
        if (/^on/i.test(key)) violations.add("event-handler attributes");
      }

      for (const key of ["href", "src", "xLinkHref", "formAction"]) {
        const value = node.properties?.[key];
        if (
          typeof value === "string" &&
          /^\s*(?:javascript|data\s*:\s*text\/html)/i.test(value)
        ) {
          violations.add("executable URLs");
        }
      }
    });
    if (violations.size) {
      throw new Error(
        `Forbidden executable markup: ${[...violations].join(", ")}`,
      );
    }
  };
}

function rehypeLocalCmsLinks(options: RenderMarkdownOptions) {
  return (tree: Root) => {
    if (options.localCmsLinks) return;
    visit(tree, "element", (node) => {
      if (node.tagName !== "a" || node.properties?.href !== "/cms/") return;
      node.tagName = "span";
      node.properties = {};
    });
  };
}

function absoluteUrl(value: string, baseUrl: string) {
  if (!value.trim()) return value;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

function absoluteSrcset(value: string, baseUrl: string) {
  if (value.trimStart().startsWith("data:")) return value;
  return value
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      const url = parts.shift();
      return url ? [absoluteUrl(url, baseUrl), ...parts].join(" ") : candidate;
    })
    .join(", ");
}

function rehypeAbsoluteUrls(options: RenderMarkdownOptions) {
  return (tree: Root) => {
    const baseUrl = options.baseUrl;
    if (!baseUrl) return;
    visit(tree, "element", (node) => {
      for (const key of [
        "href",
        "src",
        "poster",
        "cite",
        "action",
        "formAction",
        "xLinkHref",
      ]) {
        const value = node.properties?.[key];
        if (typeof value === "string")
          node.properties![key] = absoluteUrl(value, baseUrl);
      }
      for (const key of ["srcSet", "srcset"]) {
        const value = node.properties?.[key];
        if (typeof value === "string")
          node.properties![key] = absoluteSrcset(value, baseUrl);
      }
    });
  };
}

export async function renderMarkdown(
  source: string,
  options: RenderMarkdownOptions = {},
) {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkHighlight)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeLocalCmsLinks, options)
    .use(rehypeTrustedMarkup)
    .use(rehypeAbsoluteUrls, options)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(source);

  return String(file);
}
