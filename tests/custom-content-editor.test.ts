import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, test } from "vitest";

import {
  CustomContent,
  CustomHtmlBlocks,
  isStandardVisualMarkup,
} from "../src/cms/custom-content";

function editorFor(markdown: string) {
  return new Editor({
    extensions: [StarterKit, CustomContent, CustomHtmlBlocks, Markdown],
    content: markdown,
    contentType: "markdown",
  });
}

describe("visual editor Custom Content", () => {
  test("keeps unsupported HTML, SVG, and iframe blocks opaque and exact", () => {
    const custom = [
      '<iframe src="/demo" title="Demo"></iframe>',
      '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>',
      '<section data-effect="sparkle"><p>Fallback text.</p></section>',
    ];
    const editor = editorFor(`Before\n\n${custom.join("\n\n")}\n\nAfter`);

    expect(
      editor.getJSON().content?.filter((node) => node.type === "customContent"),
    ).toHaveLength(3);

    editor.commands.command(({ tr }) => {
      tr.insertText("Edited ", 1);
      return true;
    });
    const saved = editor.getMarkdown();
    for (const source of custom) expect(saved).toContain(source);
    editor.destroy();
  });

  test("leaves CMS image structures editable", () => {
    expect(isStandardVisualMarkup('<img src="/image.avif" alt="Text">')).toBe(
      true,
    );
    expect(
      isStandardVisualMarkup(
        '<figure class="post-figure"><img src="/image.avif" alt="Text"></figure>',
      ),
    ).toBe(true);
    expect(
      isStandardVisualMarkup(
        '<div class="image-pair"><img src="/a.avif" alt="A"><img src="/b.avif" alt="B"></div>',
      ),
    ).toBe(true);
    expect(isStandardVisualMarkup('<div class="effect">Custom</div>')).toBe(
      false,
    );
  });
});
