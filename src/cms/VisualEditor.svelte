<script lang="ts">
  import {
    Editor,
    Node,
    isNodeSelection,
    type JSONContent,
  } from "@tiptap/core";
  import Image from "@tiptap/extension-image";
  import { Markdown } from "@tiptap/markdown";
  import { TextSelection } from "@tiptap/pm/state";
  import StarterKit from "@tiptap/starter-kit";
  import { onMount } from "svelte";
  import { CustomContent, CustomHtmlBlocks } from "./custom-content";
  import { Footnotes } from "./footnotes";

  export interface VisualInsertion {
    id: number;
    markdown: string;
  }

  let {
    value,
    onchange,
    oninserted,
    insertion = null,
  }: {
    value: string;
    onchange: (value: string) => void;
    oninserted?: (id: number) => void;
    insertion?: VisualInsertion | null;
  } = $props();

  let mount: HTMLDivElement;
  let footnoteDialog: HTMLDialogElement;
  let footnoteInput: HTMLTextAreaElement;
  let editor = $state.raw<Editor>();
  let footnoteText = $state("");
  let transaction = $state(0);
  let handledInsertion = 0;
  let lastValue = "";
  let footnotePosition = 1;
  let canUndo = $derived.by(() => {
    void transaction;
    return editor?.can().undo() ?? false;
  });
  let canRedo = $derived.by(() => {
    void transaction;
    return editor?.can().redo() ?? false;
  });

  function escapeAttribute(value: unknown) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");
  }

  function imageMarkdown(node: JSONContent) {
    if (!node.attrs?.src) return "";
    const attributes = [
      ["src", node.attrs?.src],
      ["srcset", node.attrs?.srcset],
      ["sizes", node.attrs?.sizes],
      ["width", node.attrs?.width],
      ["height", node.attrs?.height],
      ["alt", node.attrs?.alt ?? ""],
      ["title", node.attrs?.title],
      ["role", node.attrs?.role],
    ]
      .filter(([, attribute]) => attribute !== null && attribute !== undefined)
      .map(([name, attribute]) => `${name}="${escapeAttribute(attribute)}"`)
      .join(" ");
    return `<img ${attributes}>`;
  }

  const ResponsiveImage = Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        srcset: { default: null },
        sizes: { default: null },
        role: { default: null },
      };
    },
    renderMarkdown: imageMarkdown,
    addKeyboardShortcuts() {
      const removeImageStructure = () => {
        const { selection, tr } = this.editor.state;
        if (!isNodeSelection(selection) || selection.node.type.name !== "image")
          return false;
        const resolved = selection.$from;
        const parentDepth = resolved.depth;
        const parent = resolved.parent;

        if (parent.type.name === "postFigure") {
          const grandparent =
            parentDepth > 0 ? resolved.node(parentDepth - 1) : null;
          if (grandparent?.type.name === "imagePair") {
            const pairDepth = parentDepth - 1;
            const selectedIndex = resolved.index(pairDepth);
            const remaining = grandparent.child(selectedIndex === 0 ? 1 : 0);
            const start = resolved.before(pairDepth);
            this.editor.view.dispatch(
              tr
                .replaceWith(start, start + grandparent.nodeSize, remaining)
                .scrollIntoView(),
            );
            return true;
          }
          const start = resolved.before(parentDepth);
          this.editor.view.dispatch(
            tr.delete(start, start + parent.nodeSize).scrollIntoView(),
          );
          return true;
        }

        if (parent.type.name === "imagePair") {
          const selectedIndex = resolved.index(parentDepth);
          const remaining = parent.child(selectedIndex === 0 ? 1 : 0);
          const grandparent =
            parentDepth > 0 ? resolved.node(parentDepth - 1) : null;
          if (grandparent?.type.name === "postFigure") {
            const content = [remaining];
            for (let index = 1; index < grandparent.childCount; index += 1)
              content.push(grandparent.child(index));
            const replacement = grandparent.type.create(
              grandparent.attrs,
              content,
            );
            const start = resolved.before(parentDepth - 1);
            this.editor.view.dispatch(
              tr
                .replaceWith(start, start + grandparent.nodeSize, replacement)
                .scrollIntoView(),
            );
            return true;
          }
          const start = resolved.before(parentDepth);
          this.editor.view.dispatch(
            tr
              .replaceWith(start, start + parent.nodeSize, remaining)
              .scrollIntoView(),
          );
          return true;
        }
        return false;
      };
      return {
        Backspace: removeImageStructure,
        Delete: removeImageStructure,
      };
    },
  });

  const ImagePair = Node.create({
    name: "imagePair",
    group: "block",
    content: "(image image) | (postFigure postFigure)",
    isolating: true,
    addAttributes() {
      return {
        individual: {
          default: false,
          parseHTML: (element) =>
            element.classList.contains("image-pair-individual"),
        },
      };
    },
    parseHTML() {
      return [{ tag: "div.image-pair" }];
    },
    renderHTML({ node }) {
      const classes = node.attrs.individual
        ? "image-pair image-pair-individual"
        : "image-pair";
      return ["div", { class: classes }, 0];
    },
    renderMarkdown(node, helpers) {
      const classes = node.attrs?.individual
        ? "image-pair image-pair-individual"
        : "image-pair";
      return `<div class="${classes}">\n${helpers.renderChildren(node.content ?? [], "\n")}\n</div>`;
    },
  });

  const FigureCaption = Node.create({
    name: "figureCaption",
    content: "inline*",
    parseHTML() {
      return [{ tag: "figcaption" }];
    },
    renderHTML() {
      return ["figcaption", 0];
    },
    renderMarkdown(node, helpers) {
      return `<figcaption>${helpers.renderChildren(node.content ?? [], "")}</figcaption>`;
    },
  });

  const PostFigure = Node.create({
    name: "postFigure",
    group: "block",
    content: "(image | imagePair) figureCaption?",
    isolating: true,
    parseHTML() {
      return [{ tag: "figure.post-figure" }];
    },
    renderHTML() {
      return ["figure", { class: "post-figure" }, 0];
    },
    renderMarkdown(node, helpers) {
      return `<figure class="post-figure">\n${helpers.renderChildren(node.content ?? [], "\n")}\n</figure>`;
    },
  });

  function active(name: string, attributes?: Record<string, unknown>) {
    void transaction;
    return editor?.isActive(name, attributes) ?? false;
  }

  function link() {
    if (!editor) return;
    const current = String(editor.getAttributes("link").href ?? "");
    const href = window.prompt("Link URL", current || "https://");
    if (href === null) return;
    if (!href.trim())
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: href.trim() })
        .run();
  }

  function nextFootnoteLabel() {
    const labels = new Set<number>();
    editor?.state.doc.descendants((node) => {
      if (node.type.name !== "footnoteDefinition") return;
      const label = Number(node.attrs.label);
      if (Number.isSafeInteger(label) && label > 0) labels.add(label);
    });
    let label = 1;
    while (labels.has(label)) label += 1;
    return String(label);
  }

  function openFootnoteDialog() {
    if (!editor) return;
    footnotePosition = editor.state.selection.to;
    footnoteText = "";
    footnoteDialog.showModal();
    queueMicrotask(() => footnoteInput.focus());
  }

  function insertFootnote(event: SubmitEvent) {
    event.preventDefault();
    if (!editor) return;
    const text = footnoteText.trim();
    if (!text) {
      footnoteInput.setCustomValidity("Enter footnote text.");
      footnoteInput.reportValidity();
      return;
    }

    const label = nextFootnoteLabel();
    const { schema } = editor.state;
    const reference = schema.nodes.footnoteReference.create({ label });
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((paragraph) =>
        schema.nodes.paragraph.create(
          null,
          schema.text(paragraph.replace(/\s*\n\s*/g, " ")),
        ),
      );
    const definition = schema.nodes.footnoteDefinition.create(
      { label },
      paragraphs,
    );
    const position = Math.min(footnotePosition, editor.state.doc.content.size);
    const transaction = editor.state.tr.insert(position, reference);
    transaction.insert(transaction.doc.content.size, definition);
    transaction.setSelection(
      TextSelection.near(
        transaction.doc.resolve(position + reference.nodeSize),
      ),
    );
    editor.view.dispatch(transaction.scrollIntoView());
    footnoteDialog.close();
    editor.commands.focus();
  }

  onMount(() => {
    lastValue = value;
    editor = new Editor({
      element: mount,
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] } }),
        ResponsiveImage.configure({
          resize: { enabled: true, minWidth: 80 },
        }),
        ImagePair,
        FigureCaption,
        PostFigure,
        ...Footnotes,
        CustomContent,
        CustomHtmlBlocks,
        Markdown.configure({ markedOptions: { gfm: true } }),
      ],
      content: value,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class: "tiptap",
          "aria-label": "Post body",
          spellcheck: "true",
        },
      },
      onUpdate: ({ editor: current }) => {
        lastValue = current.getMarkdown();
        onchange(lastValue);
      },
      onTransaction: () => (transaction += 1),
    });
    return () => editor?.destroy();
  });

  $effect(() => {
    if (!editor || value === lastValue) return;
    lastValue = value;
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
  });

  $effect(() => {
    if (!editor || !insertion || insertion.id === handledInsertion) return;
    const id = insertion.id;
    handledInsertion = id;
    editor
      .chain()
      .focus()
      .insertContent(insertion.markdown, { contentType: "markdown" })
      .run();
    oninserted?.(id);
  });
</script>

<div class="visual-editor">
  <div class="toolbar" aria-label="Visual formatting">
    <button
      type="button"
      aria-label="Paragraph"
      aria-pressed={active("paragraph")}
      onclick={() => editor?.chain().focus().setParagraph().run()}>P</button
    >
    <button
      type="button"
      aria-label="Heading 2"
      aria-pressed={active("heading", { level: 2 })}
      onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >H2</button
    >
    <button
      type="button"
      aria-label="Heading 3"
      aria-pressed={active("heading", { level: 3 })}
      onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      >H3</button
    >
    <button
      type="button"
      aria-label="Bold"
      aria-pressed={active("bold")}
      onclick={() => editor?.chain().focus().toggleBold().run()}
      ><strong>B</strong></button
    >
    <button
      type="button"
      aria-label="Italic"
      aria-pressed={active("italic")}
      onclick={() => editor?.chain().focus().toggleItalic().run()}
      ><em>I</em></button
    >
    <button
      type="button"
      aria-label="Strike"
      aria-pressed={active("strike")}
      onclick={() => editor?.chain().focus().toggleStrike().run()}
      ><s>S</s></button
    >
    <button
      type="button"
      aria-label="Link"
      aria-pressed={active("link")}
      onclick={link}>Link</button
    >
    <button
      type="button"
      aria-label="Bullet list"
      aria-pressed={active("bulletList")}
      onclick={() => editor?.chain().focus().toggleBulletList().run()}
      >• List</button
    >
    <button
      type="button"
      aria-label="Numbered list"
      aria-pressed={active("orderedList")}
      onclick={() => editor?.chain().focus().toggleOrderedList().run()}
      >1. List</button
    >
    <button
      type="button"
      aria-label="Quote"
      aria-pressed={active("blockquote")}
      onclick={() => editor?.chain().focus().toggleBlockquote().run()}
      >Quote</button
    >
    <button
      type="button"
      aria-label="Code block"
      aria-pressed={active("codeBlock")}
      onclick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >Code</button
    >
    <button
      type="button"
      aria-label="Horizontal rule"
      onclick={() => editor?.chain().focus().setHorizontalRule().run()}
      >Rule</button
    >
    <button type="button" aria-label="Footnote" onclick={openFootnoteDialog}
      ><sup>1</sup> Footnote</button
    >
    <span class="spacer"></span>
    <button
      type="button"
      aria-label="Undo"
      disabled={!canUndo}
      onclick={() => editor?.chain().focus().undo().run()}>Undo</button
    >
    <button
      type="button"
      aria-label="Redo"
      disabled={!canRedo}
      onclick={() => editor?.chain().focus().redo().run()}>Redo</button
    >
  </div>
  <div class="surface" bind:this={mount}></div>
  <dialog
    class="footnote-dialog"
    bind:this={footnoteDialog}
    aria-labelledby="footnote-dialog-title"
    onclose={() => footnoteInput?.setCustomValidity("")}
  >
    <form onsubmit={insertFootnote}>
      <h2 id="footnote-dialog-title">Add footnote</h2>
      <label for="footnote-text">Footnote text</label>
      <textarea
        id="footnote-text"
        bind:this={footnoteInput}
        bind:value={footnoteText}
        rows="4"
        required
        oninput={() => footnoteInput.setCustomValidity("")}></textarea>
      <p>
        A numbered reference will be inserted here; the note will appear at the
        end.
      </p>
      <div class="dialog-actions">
        <button type="button" onclick={() => footnoteDialog.close()}
          >Cancel</button
        >
        <button type="submit">Add footnote</button>
      </div>
    </form>
  </dialog>
</div>

<style>
  .visual-editor {
    border: 1px solid var(--border);
    border-radius: 0.3rem;
    background: var(--panel);
  }
  .toolbar {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding: 0.55rem;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .toolbar button {
    min-width: 2.35rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.2rem;
    color: var(--text);
    background: var(--bg);
  }
  .toolbar button[aria-pressed="true"] {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, var(--panel));
  }
  .spacer {
    flex: 1;
  }
  :global(.visual-editor .tiptap) {
    min-height: 36rem;
    max-width: 76ch;
    margin: auto;
    padding: clamp(1.25rem, 4vw, 3.5rem);
    line-height: 1.65;
    outline: 0;
  }
  :global(.visual-editor .tiptap > :first-child) {
    margin-top: 0;
  }
  :global(.visual-editor .tiptap img) {
    display: block;
    max-width: 100%;
    height: auto !important;
    margin-block: 1.25rem;
  }
  :global(.visual-editor .tiptap img.ProseMirror-selectednode) {
    outline: 3px solid var(--accent);
  }
  :global(.visual-editor .tiptap .image-pair) {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    align-items: center;
    margin-block: 1.25rem;
  }
  :global(.visual-editor .tiptap .image-pair img) {
    width: 100% !important;
    margin: 0;
  }
  :global(.visual-editor .tiptap .image-pair-individual) {
    align-items: stretch;
    grid-template-rows: auto auto;
  }
  :global(.visual-editor .tiptap .image-pair > .post-figure) {
    margin: 0;
  }
  :global(.visual-editor .tiptap .image-pair-individual > .post-figure) {
    display: grid;
    grid-row: span 2;
    grid-template-rows: subgrid;
  }
  :global(.visual-editor .tiptap .image-pair-individual > .post-figure > img) {
    align-self: center;
  }
  :global(.visual-editor .tiptap .post-figure) {
    margin: 1.25rem 0;
  }
  :global(.visual-editor .tiptap .post-figure > img),
  :global(.visual-editor .tiptap .post-figure > .image-pair) {
    margin-block: 0;
  }
  :global(.visual-editor .tiptap figcaption) {
    margin-top: 0.55rem;
    color: var(--muted);
    font-size: 0.9rem;
    text-align: center;
  }
  :global(
    .visual-editor .tiptap .image-pair-individual > .post-figure > figcaption
  ) {
    margin-top: 0;
  }
  :global(.visual-editor .tiptap pre) {
    overflow: auto;
    padding: 1rem;
    border-radius: 0.25rem;
    background: var(--bg);
  }
  :global(.visual-editor .tiptap blockquote) {
    margin-left: 0;
    padding-left: 1rem;
    border-left: 3px solid var(--border);
  }
  :global(.visual-editor .tiptap .footnote-reference) {
    padding-inline: 0.12rem;
    color: var(--link);
    cursor: default;
    font-weight: 700;
  }
  :global(.visual-editor .tiptap .footnote-definition) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.5rem;
    padding-block-start: 0.75rem;
    border-top: 1px solid var(--border);
  }
  :global(.visual-editor .tiptap .footnote-definition-label) {
    color: var(--muted);
    font-weight: 700;
  }
  :global(.visual-editor .tiptap .footnote-definition-content > :last-child) {
    margin-bottom: 0;
  }
  .footnote-dialog {
    width: min(32rem, calc(100% - 2rem));
    padding: 1.25rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--surface);
    color: var(--text);
  }
  .footnote-dialog::backdrop {
    background: rgb(0 0 0 / 45%);
  }
  .footnote-dialog form {
    display: grid;
    gap: 0.75rem;
  }
  .footnote-dialog h2,
  .footnote-dialog p {
    margin: 0;
  }
  .footnote-dialog p {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .footnote-dialog textarea {
    width: 100%;
    min-height: 6rem;
    resize: vertical;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  :global(.visual-editor .tiptap .custom-content-placeholder) {
    display: grid;
    gap: 0.25rem;
    margin-block: 1.25rem;
    padding: 1rem;
    border: 1px dashed var(--border);
    border-radius: 0.25rem;
    color: var(--muted);
    background: var(--bg);
    cursor: default;
    user-select: none;
  }
  :global(.visual-editor .tiptap .custom-content-placeholder strong) {
    color: var(--text);
  }
  @media (max-width: 38rem) {
    :global(.visual-editor .tiptap .image-pair) {
      grid-template-columns: 1fr;
    }
    :global(.visual-editor .tiptap .image-pair-individual) {
      grid-template-rows: none;
    }
    :global(.visual-editor .tiptap .image-pair-individual > .post-figure) {
      display: block;
      grid-row: auto;
      grid-template-rows: none;
    }
    :global(
      .visual-editor .tiptap .image-pair-individual > .post-figure > img
    ) {
      align-self: auto;
    }
    :global(
      .visual-editor .tiptap .image-pair-individual > .post-figure > figcaption
    ) {
      margin-top: 0.55rem;
    }
  }
</style>
