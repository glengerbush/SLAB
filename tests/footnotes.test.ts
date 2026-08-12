import { Editor, type JSONContent } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, test } from "vitest";

import { FootnoteDefinition, FootnoteReference } from "../src/cms/footnotes";
import { renderMarkdown } from "../src/lib/markdown";

function editorFor(markdown: string) {
  return new Editor({
    extensions: [StarterKit, FootnoteReference, FootnoteDefinition, Markdown],
    content: markdown,
    contentType: "markdown",
  });
}

describe("footnotes", () => {
  test("renders linked references and accessible return links", async () => {
    const html = await renderMarkdown(
      "A claim[^1] with another reference.[^1]\n\n[^1]: Supporting detail.",
    );

    expect(html).toContain('href="#user-content-fn-1"');
    expect(html).toContain('id="user-content-fnref-1"');
    expect(html).toContain('id="user-content-fnref-1-2"');
    expect(html).toContain('href="#user-content-fnref-1"');
    expect(html).toContain('href="#user-content-fnref-1-2"');
    expect(html).toContain('aria-label="Back to reference 1-2"');
  });

  test("round-trips standard Markdown through the visual editor", () => {
    const source =
      "A claim[^1].\n\n[^1]: Supporting **detail**.\n\n    A second paragraph.";
    const editor = editorFor(source);
    const json = editor.getJSON();
    const inlineNodes = json.content?.flatMap(
      (node) => node.content ?? [],
    ) as JSONContent[];

    expect(
      inlineNodes.find((node) => node.type === "footnoteReference")?.attrs,
    ).toEqual({ label: "1" });
    expect(
      json.content?.find((node) => node.type === "footnoteDefinition")?.attrs,
    ).toEqual({ label: "1" });
    expect(editor.getMarkdown()).toBe(source);
    editor.destroy();
  });
});
