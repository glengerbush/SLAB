<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    accentContrast,
    readableAccent,
    robotsText,
  } from "../lib/presentation";
  import { siteSettingsSchema } from "../lib/schema";
  import { socialIconNames } from "../lib/social-icon-names";
  import { api, type GiscusCategory, type ImageImportProgress } from "./api";
  import MediaGallery from "./MediaGallery.svelte";
  import type { MediaAsset, PostDocument, SiteSettings } from "./types";
  import VisualEditor, { type VisualInsertion } from "./VisualEditor.svelte";

  type View = "posts" | "media" | "settings";
  type CmsRoute = { view: View; post: string | null };
  type Theme = "light" | "dark" | "system";
  type EditorMode = "visual" | "source";
  type ImageLayout = "single" | "pair";
  type ImageSource = "upload" | "library";
  type Notice = { id: number; message: string };
  type ImageImportPhase =
    "idle" | "reading" | "uploading" | "converting" | "preparing";
  type GalleryMediaAsset = MediaAsset & {
    folder: string;
    sourceId: string;
  };

  let view: View = $state("posts");
  let themeChoice: Theme = $state("system");
  let postBrowserOpen = $state(true);
  let loading = $state(true);
  let busy = $state(false);
  let savingPost = $state(false);
  let deletingPost = $state(false);
  let savingSettings = $state(false);
  let error = $state("");
  let notices = $state<Notice[]>([]);
  let posts = $state<PostDocument[]>([]);
  let sharedMedia = $state<MediaAsset[]>([]);
  let settings = $state<SiteSettings | null>(null);
  let savedSettings = $state.raw<SiteSettings | null>(null);
  let settingsRevision = $state("");
  let settingsConflict = $state(false);
  let settingsValidationAttempted = $state(false);
  let changed = $state<string[]>([]);
  let selected = $state<PostDocument | null>(null);
  let savedSignature = $state("");
  let remote = $state<PostDocument | null>(null);
  let recovery = $state<PostDocument | null>(null);
  let editor = $state<HTMLTextAreaElement>();
  let editorMode: EditorMode = $state("visual");
  let visualInsertion = $state<VisualInsertion | null>(null);
  let insertionId = 0;
  let creatingPost = $state(false);
  let postValidationAttempted = $state(false);
  let imageAlt = $state("");
  let imageFile: File | null = $state(null);
  let imageLayout = $state<ImageLayout>("single");
  let imageSource = $state<ImageSource>("upload");
  let mediaSelection = $state<string[]>([]);
  let secondImageAlt = $state("");
  let secondImageFile: File | null = $state(null);
  let imageCaption = $state("");
  let secondImageCaption = $state("");
  let individualCaptions = $state(false);
  let imageImportPhase: ImageImportPhase = $state("idle");
  let imageImportPercent = $state(0);
  let imageValidationAttempted = $state(false);
  let mediaError = $state("");
  let imageImporter = $state<HTMLDivElement>();
  let imageFileInput = $state<HTMLInputElement>();
  let secondImageFileInput = $state<HTMLInputElement>();
  let imageDragTarget = $state<1 | 2 | null>(null);
  let socialImageDialog = $state<HTMLDialogElement>();
  let defaultSocialImageDialog = $state<HTMLDialogElement>();
  let discardPostDialog = $state<HTMLDialogElement>();
  let discardSettingsDialog = $state<HTMLDialogElement>();
  let deletePostDialog = $state<HTMLDialogElement>();
  let removeCommentsDialog = $state<HTMLDialogElement>();
  let commentsSetupOpen = $state(false);
  let commentRepository = $state("");
  let commentCategories = $state<GiscusCategory[]>([]);
  let commentCategoryId = $state("");
  let commentRepositoryId = $state("");
  let commentSetupError = $state("");
  let commentScript = $state("");
  let discoveringComments = $state(false);
  let parsingComments = $state(false);
  let missingCommentKeys = $state<number | null>(null);
  let removeCommentsConfirmation = $state("");
  let removingComments = $state(false);
  let openingDiscussion = $state(false);
  let testingComments = $state(false);
  let commentConnectionStatus = $state("");
  let libraryFile: File | null = $state(null);
  let libraryFileInput = $state<HTMLInputElement>();
  let libraryImportPhase: ImageImportPhase = $state("idle");
  let libraryImportPercent = $state(0);
  let libraryDragActive = $state(false);
  let recoveryStorageWarningShown = false;
  let externalSyncInFlight = false;
  let historyIndex = 0;
  let historyReady = false;
  let restoringHistory = false;
  let nextNoticeId = 0;
  const noticeTimers: Record<number, number> = {};

  const signature = (post: PostDocument) =>
    JSON.stringify({
      title: post.title,
      description: post.description,
      slug: post.slug,
      draft: post.draft,
      published: post.published,
      updated: post.updated,
      tags: post.tags,
      aliases: post.aliases,
      socialImage: post.socialImage,
      body: post.body,
    });
  const clonePost = (post: PostDocument) =>
    structuredClone($state.snapshot(post));
  const cloneSettings = (value: SiteSettings) =>
    structuredClone($state.snapshot(value));
  const settingsSignature = (value: SiteSettings) => JSON.stringify(value);
  let dirty = $derived(
    selected ? signature(selected) !== savedSignature : false,
  );
  let settingsDirty = $derived(
    Boolean(
      settings &&
      savedSettings &&
      settingsSignature(settings) !== settingsSignature(savedSettings),
    ),
  );
  let cmsBrandName = $derived(savedSettings?.title.trim() || "Site");
  let hasUnsavedChanges = $derived(dirty || settingsDirty);
  let postFieldsReady = $derived(
    Boolean(selected?.title.trim()) &&
      Boolean(selected?.description.trim()) &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selected?.slug ?? ""),
  );
  let savedPost = $derived(
    selected && !creatingPost
      ? posts.find((post) => post.folder === selected?.folder)
      : undefined,
  );
  let viewPostHref = $derived(
    savedPost && !savedPost.draft ? `/posts/${savedPost.slug}/` : null,
  );
  let mediaLibrary = $derived.by(() =>
    [
      ...(selected?.media ?? []).map(
        (asset) =>
          ({
            ...asset,
            id: `post/${asset.id}`,
            sourceId: asset.id,
            folder: selected?.folder ?? "",
          }) satisfies GalleryMediaAsset,
      ),
      ...sharedMedia.map(
        (asset) =>
          ({
            ...asset,
            id: `shared/${asset.id}`,
            sourceId: asset.id,
            folder: "shared",
          }) satisfies GalleryMediaAsset,
      ),
    ].sort(
      (left, right) =>
        right.importedAt.localeCompare(left.importedAt) ||
        left.name.localeCompare(right.name),
    ),
  );
  let selectedMedia = $derived(
    mediaSelection
      .map((id) => mediaLibrary.find((asset) => asset.id === id))
      .filter((asset): asset is GalleryMediaAsset => Boolean(asset)),
  );
  let selectedSocialMedia = $derived(
    mediaLibrary.find((asset) => selected?.socialImage === asset.src),
  );
  let globalMedia = $derived.by(() => {
    const publicPosts = posts.filter((post) => !post.draft);
    return [
      ...sharedMedia.map(
        (asset) =>
          ({
            ...asset,
            id: `shared/${asset.id}`,
            sourceId: asset.id,
            folder: "shared",
            name: `Shared / ${asset.name}`,
          }) satisfies GalleryMediaAsset,
      ),
      ...publicPosts.flatMap((post) =>
        post.media.map(
          (asset) =>
            ({
              ...asset,
              id: `${post.folder}/${asset.id}`,
              sourceId: asset.id,
              folder: post.folder,
              name: `${post.title} / ${asset.name}`,
            }) satisfies GalleryMediaAsset,
        ),
      ),
    ].sort(
      (left, right) =>
        right.importedAt.localeCompare(left.importedAt) ||
        left.name.localeCompare(right.name),
    );
  });
  let selectedDefaultSocialMedia = $derived(
    globalMedia.find((asset) => settings?.defaultSocialImage === asset.src),
  );
  let settingsValidation = $derived(
    settings ? siteSettingsSchema.safeParse(settings) : null,
  );
  let commentsCanonicalOrigin = $derived.by(() => {
    try {
      const url = new URL(settings?.domain ?? "");
      return url.protocol === "https:" ? url.origin : null;
    } catch {
      return null;
    }
  });
  let settingsErrors = $derived.by(() => {
    const errors: Record<string, string> = {};
    if (
      !settingsValidationAttempted ||
      !settingsValidation ||
      settingsValidation.success
    )
      return errors;
    for (const issue of settingsValidation.error.issues) {
      const path = issue.path.join(".");
      if (!errors[path]) errors[path] = settingsErrorMessage(path, issue.code);
    }
    return errors;
  });
  let recoveryDiverged = $derived(
    Boolean(recovery && selected && recovery.revision !== selected.revision),
  );
  let imageMissing = $derived({
    firstSource: imageSource === "upload" ? !imageFile : !selectedMedia.at(0),
    firstAlt: !(imageAlt ?? "").trim(),
    secondSource:
      imageLayout === "pair" &&
      (imageSource === "upload" ? !secondImageFile : !selectedMedia.at(1)),
    secondAlt: imageLayout === "pair" && !(secondImageAlt ?? "").trim(),
  });
  let imageReady = $derived(!Object.values(imageMissing).some(Boolean));

  function resetImageImport() {
    if (imageFileInput) imageFileInput.value = "";
    if (secondImageFileInput) secondImageFileInput.value = "";
    imageFile = null;
    imageAlt = "";
    imageLayout = "single";
    imageSource = "upload";
    mediaSelection = [];
    secondImageFile = null;
    secondImageAlt = "";
    imageCaption = "";
    secondImageCaption = "";
    individualCaptions = false;
    imageDragTarget = null;
    imageValidationAttempted = false;
    mediaError = "";
  }

  function replacePost(post: PostDocument) {
    const index = posts.findIndex((item) => item.folder === post.folder);
    if (index === -1) posts.push(post);
    else posts[index] = post;
    posts.sort((a, b) => b.folder.localeCompare(a.folder));
  }

  function readCmsRoute(): CmsRoute {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    const nextView: View =
      requestedView === "media" || requestedView === "settings"
        ? requestedView
        : "posts";
    return {
      view: nextView,
      post: nextView === "posts" ? params.get("post") : null,
    };
  }

  function selectedPostKey() {
    if (!selected) return null;
    return creatingPost ? "__new__" : selected.folder;
  }

  function updateCmsTitle() {
    const label =
      view === "media"
        ? "Media"
        : view === "settings"
          ? "Settings"
          : selected?.title.trim() || (creatingPost ? "New Post" : "Posts");
    document.title = `${label} — ${cmsBrandName} Editor`;
  }

  function routePostKey(route: CmsRoute) {
    if (route.view !== "posts" || !route.post) return null;
    return route.post === "new" ? "__new__" : route.post;
  }

  function cmsUrl() {
    const url = new URL("/cms/", window.location.origin);
    url.searchParams.set("view", view);
    if (view === "posts") {
      const post = selectedPostKey();
      if (post) url.searchParams.set("post", post === "__new__" ? "new" : post);
    }
    return `${url.pathname}${url.search}`;
  }

  function historyState(index: number) {
    const current =
      history.state && typeof history.state === "object" ? history.state : {};
    return { ...current, cmsIndex: index };
  }

  function replaceCmsHistory() {
    if (!historyReady) return;
    history.replaceState(historyState(historyIndex), "", cmsUrl());
  }

  function pushCmsHistory() {
    if (!historyReady) return;
    const url = cmsUrl();
    if (`${location.pathname}${location.search}` === url && !location.hash)
      return;
    historyIndex += 1;
    history.pushState(historyState(historyIndex), "", url);
  }

  function initializeCmsHistory() {
    const existing = Number(history.state?.cmsIndex);
    historyIndex = Number.isInteger(existing) ? existing : 0;
    history.replaceState(historyState(historyIndex), "", location.href);
    historyReady = true;
  }

  async function load() {
    try {
      const data = await api.bootstrap();
      posts = data.posts.sort((a, b) => b.folder.localeCompare(a.folder));
      sharedMedia = data.media;
      const loadedSettings = data.settings as SiteSettings & {
        accentColor?: string;
      };
      const initialSettings: SiteSettings = {
        ...loadedSettings,
        accentColor: loadedSettings.accentColor ?? "#BC5215",
      };
      settings = initialSettings;
      savedSettings = cloneSettings(initialSettings);
      settingsRevision = data.settingsRevision;
      changed = data.changed;
      if (!applyCmsRoute(readCmsRoute())) replaceCmsHistory();
    } catch (caught) {
      error = message(caught);
    } finally {
      loading = false;
    }
  }

  function message(caught: unknown) {
    return caught instanceof Error ? caught.message : "Unexpected error";
  }

  function settingsErrorMessage(path: string, code: string) {
    const tooBig = code === "too_big";
    if (path === "title")
      return tooBig ? "Use 100 characters or fewer." : "Enter a Blog title.";
    if (path === "description")
      return tooBig
        ? "Use 320 characters or fewer."
        : "Enter a Site description.";
    if (path === "author")
      return tooBig ? "Use 100 characters or fewer." : "Enter the Author name.";
    if (path === "domain")
      return "Enter the canonical HTTPS URL, such as https://example.com.";
    if (path === "locale") return "Enter a valid locale, such as en-US.";
    if (path === "accentColor") return "Choose a six-digit color.";
    if (path === "navigation") return "Use no more than 12 navigation links.";
    if (/^navigation\.\d+\.label$/.test(path))
      return tooBig ? "Use 40 characters or fewer." : "Enter a label.";
    if (/^navigation\.\d+\.href$/.test(path))
      return "Enter a root-relative path, HTTPS URL, anchor, or email link.";
    if (path === "socialLinks") return "Use no more than 20 social links.";
    if (/^socialLinks\.\d+\.label$/.test(path))
      return tooBig ? "Use 40 characters or fewer." : "Enter a link name.";
    if (/^socialLinks\.\d+\.href$/.test(path))
      return "Enter a complete URL, including https://.";
    if (path === "robots.advancedRules")
      return tooBig
        ? "Use 5,000 characters or fewer."
        : "Remove unsupported control characters.";
    if (path === "frames") return "Use no more than 30 iframe origins.";
    if (/^frames\.\d+$/.test(path))
      return "Enter one HTTPS origin per line, such as https://www.youtube.com.";
    if (path === "defaultSocialImage")
      return "Choose an imported web image or no default image.";
    return "Enter a valid value.";
  }

  function settingsError(path: string) {
    return settingsErrors[path];
  }

  function settingsErrorWithin(path: string) {
    return (
      settingsErrors[path] ??
      Object.entries(settingsErrors).find(([key]) =>
        key.startsWith(`${path}.`),
      )?.[1]
    );
  }

  function statusDescription(status: PostDocument["status"]) {
    if (status === "Draft") return "Excluded from the published site.";
    if (status === "Ready")
      return "Selected for publishing but absent from the current Git commit.";
    if (status === "Unreleased")
      return "Published in Git with local changes not yet committed.";
    return "Committed and unchanged locally; deployment is not checked.";
  }

  function statusLabel(status: PostDocument["status"]) {
    if (status === "Ready") return "Publish ready";
    if (status === "Unreleased") return "Update ready";
    return status;
  }

  function recoveryCandidate(
    value: unknown,
    post: PostDocument,
  ): value is PostDocument {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<PostDocument>;
    return (
      candidate.folder === post.folder &&
      typeof candidate.revision === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.description === "string" &&
      typeof candidate.slug === "string" &&
      typeof candidate.body === "string" &&
      Array.isArray(candidate.tags) &&
      Array.isArray(candidate.aliases)
    );
  }

  async function copyRecovery(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) {
        error = `Could not copy ${label.toLowerCase()}.`;
        return;
      }
    }
    showNotice(`${label} copied.`);
  }

  function showNotice(message: string) {
    const id = ++nextNoticeId;
    notices.push({ id, message });
    noticeTimers[id] = window.setTimeout(() => dismissNotice(id), 5000);
  }

  function dismissNotice(id: number) {
    const timeout = noticeTimers[id];
    if (timeout !== undefined) window.clearTimeout(timeout);
    delete noticeTimers[id];
    notices = notices.filter((notice) => notice.id !== id);
  }

  onDestroy(() => {
    for (const timeout of Object.values(noticeTimers))
      window.clearTimeout(timeout);
  });

  function warnRecoveryStorage() {
    if (recoveryStorageWarningShown) return;
    recoveryStorageWarningShown = true;
    error =
      "Browser recovery could not be saved. Editing still works; save the Post to preserve these changes.";
  }

  function readRecovery(folder: string) {
    try {
      return localStorage.getItem(`local-cms:${folder}`);
    } catch {
      warnRecoveryStorage();
      return null;
    }
  }

  function removeRecovery(folder: string) {
    try {
      localStorage.removeItem(`local-cms:${folder}`);
    } catch {
      warnRecoveryStorage();
    }
  }

  function chooseTheme(theme: Theme) {
    themeChoice = theme;
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("blog-theme", theme);
    } catch {
      // The selected theme still applies for this CMS session.
    }
  }

  function confirmDiscardUnsavedChanges() {
    if (!dirty) return true;
    if (!window.confirm("Discard the unsaved changes in the current post?"))
      return false;
    if (selected && !creatingPost) removeRecovery(selected.folder);
    return true;
  }

  function collapsePostBrowserOnMobile() {
    if (window.matchMedia("(max-width: 48rem)").matches)
      postBrowserOpen = false;
  }

  function clearPostSelection() {
    resetImageImport();
    creatingPost = false;
    postValidationAttempted = false;
    selected = null;
    savedSignature = "";
    remote = null;
    recovery = null;
    visualInsertion = null;
    postBrowserOpen = true;
    updateCmsTitle();
  }

  function openPostEditor(post: PostDocument) {
    resetImageImport();
    creatingPost = false;
    postValidationAttempted = false;
    selected = clonePost(post);
    editorMode = "visual";
    visualInsertion = null;
    savedSignature = signature(post);
    remote = null;
    recovery = null;
    recoveryStorageWarningShown = false;
    const stored = readRecovery(post.folder);
    if (stored) {
      try {
        const candidate = JSON.parse(stored) as unknown;
        if (
          recoveryCandidate(candidate, post) &&
          signature(candidate) !== signature(post)
        )
          recovery = candidate;
      } catch {
        removeRecovery(post.folder);
      }
    }
    collapsePostBrowserOnMobile();
    updateCmsTitle();
  }

  function openNewPostEditor() {
    resetImageImport();
    const post: PostDocument = {
      title: "",
      description: "",
      slug: "",
      draft: true,
      published: undefined,
      updated: undefined,
      tags: [],
      aliases: [],
      socialImage: null,
      folder: "__new__",
      body: "",
      images: [],
      media: [],
      revision: "",
      status: "Draft",
    };
    creatingPost = true;
    postValidationAttempted = false;
    selected = post;
    editorMode = "visual";
    visualInsertion = null;
    savedSignature = signature(post);
    remote = null;
    recovery = null;
    collapsePostBrowserOnMobile();
    updateCmsTitle();
  }

  function applyCmsRoute(route: CmsRoute) {
    view = route.view;
    if (route.view !== "posts") {
      updateCmsTitle();
      return true;
    }
    const target = routePostKey(route);
    if (target === selectedPostKey()) {
      updateCmsTitle();
      return true;
    }
    if (target === "__new__") {
      openNewPostEditor();
      return true;
    }
    if (target) {
      const post = posts.find((candidate) => candidate.folder === target);
      if (!post) {
        clearPostSelection();
        return false;
      }
      openPostEditor(post);
      return true;
    }
    clearPostSelection();
    return true;
  }

  function navigateView(nextView: View) {
    if (busy || nextView === view) return;
    view = nextView;
    updateCmsTitle();
    pushCmsHistory();
  }

  function handlePopState(event: PopStateEvent) {
    const targetIndex = Number(event.state?.cmsIndex);
    const nextIndex = Number.isInteger(targetIndex)
      ? targetIndex
      : historyIndex;
    if (restoringHistory) {
      restoringHistory = false;
      historyIndex = nextIndex;
      return;
    }
    const route = readCmsRoute();
    const changesPost =
      route.view === "posts" && routePostKey(route) !== selectedPostKey();
    if (changesPost && !confirmDiscardUnsavedChanges()) {
      const delta = historyIndex - nextIndex;
      if (delta) {
        restoringHistory = true;
        history.go(delta);
      } else replaceCmsHistory();
      return;
    }
    historyIndex = nextIndex;
    if (!applyCmsRoute(route)) replaceCmsHistory();
    queueMicrotask(() => document.getElementById("cms-content")?.focus());
  }

  function choose(post: PostDocument) {
    if (busy) return;
    if (!creatingPost && selected?.folder === post.folder) {
      collapsePostBrowserOnMobile();
      return;
    }
    if (!confirmDiscardUnsavedChanges()) return;
    openPostEditor(post);
    pushCmsHistory();
  }

  function startNewPost() {
    if (busy) return;
    if (!confirmDiscardUnsavedChanges()) return;
    openNewPostEditor();
    pushCmsHistory();
  }

  function openDiscardPostDialog() {
    if (!selected || !dirty || busy || remote || recovery) return;
    discardPostDialog?.showModal();
    queueMicrotask(() =>
      discardPostDialog
        ?.querySelector<HTMLButtonElement>("[data-cancel]")
        ?.focus(),
    );
  }

  function discardPostChanges() {
    if (!selected || !dirty || busy || remote || recovery) return;
    discardPostDialog?.close();
    if (creatingPost) {
      clearPostSelection();
      replaceCmsHistory();
      showNotice("New Post discarded.");
      return;
    }
    const saved = posts.find((post) => post.folder === selected?.folder);
    if (!saved) {
      error = "The saved Post is no longer available. Reload the CMS.";
      return;
    }
    removeRecovery(saved.folder);
    resetImageImport();
    postValidationAttempted = false;
    selected = clonePost(saved);
    savedSignature = signature(saved);
    visualInsertion = null;
    updateCmsTitle();
    showNotice("Post changes discarded.");
  }

  function openDeletePostDialog() {
    deletePostDialog?.showModal();
    queueMicrotask(() =>
      deletePostDialog
        ?.querySelector<HTMLButtonElement>("[data-cancel]")
        ?.focus(),
    );
  }

  async function deleteSavedPost() {
    if (!selected || creatingPost || busy) return;
    const folder = selected.folder;
    const title = selected.title;
    deletingPost = true;
    busy = true;
    error = "";
    try {
      await api.deletePost(folder, selected.revision);
      deletePostDialog?.close();
      posts = posts.filter((post) => post.folder !== folder);
      removeRecovery(folder);
      clearPostSelection();
      replaceCmsHistory();
      showNotice(`Deleted “${title}”.`);
      changed = (await api.changed()).changed;
    } catch (caught) {
      error = message(caught);
    } finally {
      deletingPost = false;
      busy = false;
    }
  }

  function discardRecovery() {
    if (!recovery) return;
    removeRecovery(recovery.folder);
    recovery = null;
    showNotice("Recovery discarded. The current editor is unchanged.");
  }

  async function save() {
    if (!selected || !dirty || recovery || busy) return;
    if (!postFieldsReady) {
      postValidationAttempted = true;
      if (creatingPost) selected.draft = true;
      queueMicrotask(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    const submitted = clonePost(selected);
    const wasCreating = creatingPost;
    const folder = submitted.folder;
    const original = posts.find((post) => post.folder === folder);
    let confirmed = false;
    if (
      (original?.status === "Published" || original?.status === "Unreleased") &&
      original.slug !== submitted.slug
    ) {
      confirmed = window.confirm(
        `Change the published URL and redirect “${original.slug}” to “${submitted.slug}”?`,
      );
      if (!confirmed) return;
    }
    savingPost = true;
    busy = true;
    error = "";
    try {
      const saved = creatingPost
        ? await api.createPost(submitted)
        : await api.savePost(submitted, submitted.revision, confirmed);
      replacePost(saved);
      if (selected?.folder !== folder) return;
      creatingPost = false;
      postValidationAttempted = false;
      selected = clonePost(saved);
      savedSignature = signature(saved);
      remote = null;
      removeRecovery(saved.folder);
      updateCmsTitle();
      if (wasCreating) replaceCmsHistory();
      showNotice("Saved.");
      changed = (await api.changed()).changed;
    } catch (caught) {
      error = message(caught);
    } finally {
      savingPost = false;
      busy = false;
    }
  }

  function insertSource(before: string, after = "") {
    if (!selected || !editor) return;
    const textarea = editor;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    selected.body = `${selected.body.slice(0, start)}${before}${selected.body.slice(start, end)}${after}${selected.body.slice(end)}`;
    queueMicrotask(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  }

  function suggestDescription() {
    if (!selected) return;
    const paragraph = selected.body
      .split(/\n\s*\n/)
      .map((value) =>
        value
          .replace(/^#{1,6}\s+/gm, "")
          .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
          .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
          .replace(/[*_`>~-]/g, "")
          .replace(/<[^>]+>/g, "")
          .trim(),
      )
      .find(Boolean);
    if (paragraph) selected.description = paragraph.slice(0, 320);
  }

  function keydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  }

  function fileToBase64(file: File, onProgress: (loaded: number) => void) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onprogress = (event) => onProgress(event.loaded);
      reader.onload = () => {
        onProgress(Math.max(file.size, 1));
        resolve(String(reader.result).split(",", 2)[1] ?? "");
      };
      reader.readAsDataURL(file);
    });
  }

  function reportImageProgress(progress: ImageImportProgress) {
    imageImportPhase = progress.phase;
    imageImportPercent = progress.percent;
  }

  function imagePhaseLabel(long = false) {
    const label =
      imageImportPhase === "reading"
        ? "Reading"
        : imageImportPhase === "uploading"
          ? "Uploading"
          : imageImportPhase === "preparing"
            ? "Preparing"
            : "Converting";
    return long ? `${label} images` : label;
  }

  function libraryPhaseLabel(long = false) {
    const label =
      libraryImportPhase === "reading"
        ? "Reading"
        : libraryImportPhase === "uploading"
          ? "Uploading"
          : "Converting";
    return long ? `${label} image` : label;
  }

  function imageCaptionInput() {
    const first = imageCaption.trim();
    if (imageLayout === "single" || !individualCaptions)
      return first ? { type: "shared" as const, text: first } : undefined;
    const second = secondImageCaption.trim();
    return first || second
      ? {
          type: "individual" as const,
          texts: [first, second] as [string, string],
        }
      : undefined;
  }

  function placeImageMarkup(markup: string) {
    const markdown = `\n${markup}\n`;
    if (editorMode === "visual")
      visualInsertion = { id: ++insertionId, markdown };
    else insertSource(markdown);
  }

  function selectEditorTab(mode: EditorMode, focus = false) {
    editorMode = mode;
    if (focus)
      queueMicrotask(() =>
        document.getElementById(`editor-tab-${mode}`)?.focus(),
      );
  }

  function editorTabKeydown(event: KeyboardEvent) {
    let mode: EditorMode | null = null;
    if (event.key === "Home") mode = "visual";
    else if (event.key === "End") mode = "source";
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight")
      mode = editorMode === "visual" ? "source" : "visual";
    if (!mode) return;
    event.preventDefault();
    selectEditorTab(mode, true);
  }

  function finishVisualInsertion(id: number) {
    if (visualInsertion?.id === id) visualInsertion = null;
  }

  function toggleMedia(asset: MediaAsset) {
    const index = mediaSelection.indexOf(asset.id);
    if (index !== -1) {
      mediaSelection = mediaSelection.filter((id) => id !== asset.id);
      return;
    }
    const limit = imageLayout === "pair" ? 2 : 1;
    if (mediaSelection.length >= limit) return;
    mediaSelection = [...mediaSelection, asset.id];
  }

  function canDeleteMedia(asset: MediaAsset) {
    if (!selected || busy) return false;
    const media = asset as GalleryMediaAsset;
    if (media.scope !== "post") return false;
    const paths = globalMediaPaths(media);
    return !paths.some(
      (path) =>
        selected!.body.includes(path) || settings?.defaultSocialImage === path,
    );
  }

  function chooseSocialImage(asset: MediaAsset | null) {
    if (!selected) return;
    selected.socialImage = asset?.src ?? null;
    socialImageDialog?.close();
  }

  function globalMediaPaths(asset: GalleryMediaAsset) {
    const prefix = asset.src.slice(0, asset.src.lastIndexOf("/") + 1);
    return asset.files.map((file) => `${prefix}${file}`);
  }

  function canDeleteGlobalMedia(media: MediaAsset) {
    const asset = media as GalleryMediaAsset;
    if (busy) return false;
    const paths = globalMediaPaths(asset);
    const effectivePosts = posts.map((post) =>
      selected?.folder === post.folder ? selected : post,
    );
    return !paths.some(
      (path) =>
        settings?.defaultSocialImage === path ||
        effectivePosts.some(
          (post) => post.body.includes(path) || post.socialImage === path,
        ),
    );
  }

  function chooseDefaultSocialImage(asset: MediaAsset | null) {
    if (!settings) return;
    settings.defaultSocialImage = asset?.src ?? null;
    defaultSocialImageDialog?.close();
  }

  async function deleteGlobalMedia(media: MediaAsset) {
    const asset = media as GalleryMediaAsset;
    if (!canDeleteGlobalMedia(asset)) return;
    if (
      !window.confirm(
        `Delete “${asset.name}” and its ${asset.files.length} responsive file${asset.files.length === 1 ? "" : "s"}?`,
      )
    )
      return;
    if (asset.scope === "shared") {
      busy = true;
      error = "";
      try {
        const result = await api.deleteLibraryMedia(asset.sourceId);
        sharedMedia = result.media;
        showNotice(`Deleted ${result.deleted.join(", ")}`);
        changed = (await api.changed()).changed;
      } catch (caught) {
        error = message(caught);
      } finally {
        busy = false;
      }
      return;
    }
    const owner =
      selected?.folder === asset.folder
        ? selected
        : posts.find((post) => post.folder === asset.folder);
    if (!owner) return;
    busy = true;
    error = "";
    try {
      const result = await api.deleteMedia(asset.folder, asset.sourceId);
      const stored = posts.find((post) => post.folder === asset.folder);
      if (stored) {
        stored.media = result.media;
        stored.images = result.media.flatMap((item) => item.files).sort();
      }
      if (selected?.folder === asset.folder) {
        selected.media = result.media;
        selected.images = result.media.flatMap((item) => item.files).sort();
      }
      showNotice(`Deleted ${result.deleted.join(", ")}`);
      changed = (await api.changed()).changed;
    } catch (caught) {
      error = message(caught);
    } finally {
      busy = false;
    }
  }

  async function deleteMedia(asset: MediaAsset) {
    if (!selected) return;
    const folder = selected.folder;
    const media = asset as GalleryMediaAsset;
    if (media.scope !== "post") return;
    if (
      !window.confirm(
        `Delete “${asset.name}” and its ${asset.files.length} responsive file${asset.files.length === 1 ? "" : "s"} from this post?`,
      )
    )
      return;
    busy = true;
    error = "";
    mediaError = "";
    try {
      const result = await api.deleteMedia(folder, media.sourceId);
      const stored = posts.find((post) => post.folder === folder);
      if (stored) {
        stored.media = result.media;
        stored.images = result.media.flatMap((item) => item.files).sort();
      }
      if (selected?.folder !== folder) return;
      selected.media = result.media;
      selected.images = result.media.flatMap((item) => item.files).sort();
      mediaSelection = mediaSelection.filter((id) => id !== media.id);
      showNotice(`Deleted ${result.deleted.join(", ")}`);
      changed = (await api.changed()).changed;
    } catch (caught) {
      mediaError = message(caught);
      error = mediaError;
    } finally {
      busy = false;
    }
  }

  async function importImage() {
    if (!selected) return;
    const folder = selected.folder;
    imageValidationAttempted = true;
    if (!imageReady) {
      queueMicrotask(() =>
        imageImporter
          ?.querySelector<HTMLInputElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    if (imageSource === "library") {
      busy = true;
      error = "";
      imageImportPhase = "preparing";
      imageImportPercent = 100;
      try {
        const count = imageLayout === "pair" ? 2 : 1;
        const result = await api.insertMedia(folder, {
          layout: imageLayout,
          assets: selectedMedia.slice(0, count).map((asset) => ({
            id: asset.sourceId,
            scope: asset.scope,
          })),
          alts: [imageAlt, ...(imageLayout === "pair" ? [secondImageAlt] : [])],
          caption: imageCaptionInput(),
        });
        if (selected?.folder !== folder) return;
        placeImageMarkup(result.markup);
        resetImageImport();
        showNotice("Inserted existing media.");
      } catch (caught) {
        error = message(caught);
      } finally {
        imageImportPhase = "idle";
        imageImportPercent = 0;
        busy = false;
      }
      return;
    }
    if (!imageFile) return;
    busy = true;
    error = "";
    imageImportPhase = "reading";
    imageImportPercent = 0;
    try {
      const files = [
        imageFile,
        ...(imageLayout === "pair" && secondImageFile ? [secondImageFile] : []),
      ];
      const weights = files.map((file) => Math.max(file.size, 1));
      const loaded = files.map(() => 0);
      const total = weights.reduce((sum, size) => sum + size, 0);
      const base64 = await Promise.all(
        files.map((file, index) =>
          fileToBase64(file, (bytes) => {
            loaded[index] = Math.min(bytes, weights[index]);
            imageImportPercent = Math.round(
              (loaded.reduce((sum, value) => sum + value, 0) / total) * 100,
            );
          }),
        ),
      );
      const result = await api.image(
        {
          folder,
          layout: imageLayout,
          caption: imageCaptionInput(),
          images: [
            {
              filename: imageFile.name,
              mimeType: imageFile.type,
              base64: base64[0],
              alt: imageAlt ?? "",
            },
            ...(imageLayout === "pair" && secondImageFile
              ? [
                  {
                    filename: secondImageFile.name,
                    mimeType: secondImageFile.type,
                    base64: base64[1],
                    alt: secondImageAlt ?? "",
                  },
                ]
              : []),
          ],
        },
        reportImageProgress,
      );
      const media = await api.media(folder);
      const stored = posts.find((post) => post.folder === folder);
      if (stored) {
        stored.media = media;
        stored.images = media.flatMap((item) => item.files).sort();
      }
      if (selected?.folder !== folder) return;
      selected.images = [
        ...new Set([...selected.images, ...result.files]),
      ].sort();
      selected.media = media;
      placeImageMarkup(result.markup);
      resetImageImport();
      showNotice(`Imported ${result.files.join(", ")}`);
      changed = (await api.changed()).changed;
    } catch (caught) {
      error = message(caught);
    } finally {
      imageImportPhase = "idle";
      imageImportPercent = 0;
      busy = false;
    }
  }

  async function importLibraryImage() {
    if (!libraryFile || busy) return;
    busy = true;
    error = "";
    libraryImportPhase = "reading";
    libraryImportPercent = 0;
    try {
      const file = libraryFile;
      const base64 = await fileToBase64(file, (loaded) => {
        libraryImportPercent = Math.round(
          (Math.min(loaded, Math.max(file.size, 1)) / Math.max(file.size, 1)) *
            100,
        );
      });
      const result = await api.libraryImage(
        {
          images: [
            {
              filename: file.name,
              mimeType: file.type,
              base64,
              alt: file.name,
            },
          ],
        },
        (progress) => {
          libraryImportPhase = progress.phase;
          libraryImportPercent = progress.percent;
        },
      );
      sharedMedia = result.media;
      libraryFile = null;
      if (libraryFileInput) libraryFileInput.value = "";
      showNotice(`Imported ${result.files.join(", ")}`);
      changed = (await api.changed()).changed;
    } catch (caught) {
      error = message(caught);
    } finally {
      libraryImportPhase = "idle";
      libraryImportPercent = 0;
      busy = false;
    }
  }

  function selectLibraryFile(file: File | null) {
    if (!file) return;
    if (!isImageFile(file)) {
      error = "Choose an image file.";
      return;
    }
    libraryFile = file;
    error = "";
  }

  function browseLibraryImage() {
    if (!libraryFileInput || libraryImportPhase !== "idle") return;
    libraryFileInput.value = "";
    libraryFileInput.click();
  }

  function droppedLibraryImage(event: DragEvent) {
    event.preventDefault();
    libraryDragActive = false;
    if (libraryImportPhase !== "idle") return;
    selectLibraryFile(event.dataTransfer?.files[0] ?? null);
  }

  function isImageFile(file: File) {
    return (
      file.type.startsWith("image/") ||
      /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(file.name)
    );
  }

  function selectPostImage(file: File | null, target: 1 | 2) {
    if (!file) return;
    if (!isImageFile(file)) {
      error = "Choose an image file.";
      return;
    }
    if (target === 1) imageFile = file;
    else secondImageFile = file;
    error = "";
  }

  function browsePostImage(target: 1 | 2) {
    if (busy || imageImportPhase !== "idle") return;
    const input = target === 1 ? imageFileInput : secondImageFileInput;
    if (!input) return;
    input.value = "";
    input.click();
  }

  function droppedPostImage(event: DragEvent, target: 1 | 2) {
    event.preventDefault();
    imageDragTarget = null;
    if (busy || imageImportPhase !== "idle") return;
    imageSource = "upload";
    selectPostImage(event.dataTransfer?.files[0] ?? null, target);
  }

  function leftPostImage(event: DragEvent, target: 1 | 2) {
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    )
      return;
    if (imageDragTarget === target) imageDragTarget = null;
  }

  function confirmPageLeave(event: BeforeUnloadEvent) {
    event.preventDefault();
    event.returnValue = "";
  }

  function discardRecoveryAfterPageLeave() {
    if (selected && !creatingPost) removeRecovery(selected.folder);
  }

  async function saveSettings() {
    if (!settings || busy) return;
    settingsValidationAttempted = true;
    const validation = siteSettingsSchema.safeParse($state.snapshot(settings));
    if (!validation.success) {
      queueMicrotask(() =>
        document
          .querySelector<HTMLElement>('.settings [aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    savingSettings = true;
    busy = true;
    error = "";
    try {
      const result = await api.saveSettings(validation.data, settingsRevision);
      settings = result.settings;
      savedSettings = cloneSettings(result.settings);
      settingsRevision = result.settingsRevision;
      settingsConflict = false;
      settingsValidationAttempted = false;
      updateCmsTitle();
      showNotice("Settings saved.");
      changed = (await api.changed()).changed;
    } catch (caught) {
      error = message(caught);
      if (/Site Settings changed outside the CMS/i.test(error)) {
        settingsConflict = true;
      }
    } finally {
      savingSettings = false;
      busy = false;
    }
  }

  async function reloadSettingsFromFile() {
    busy = true;
    error = "";
    try {
      const result = await api.settings();
      settings = result.settings;
      savedSettings = cloneSettings(result.settings);
      settingsRevision = result.settingsRevision;
      settingsConflict = false;
      settingsValidationAttempted = false;
      updateCmsTitle();
      showNotice("Settings reloaded from file.");
    } catch (caught) {
      error = message(caught);
    } finally {
      busy = false;
    }
  }

  async function countMissingCommentKeys() {
    try {
      missingCommentKeys = (await api.missingCommentKeys()).count;
    } catch {
      missingCommentKeys = null;
    }
  }

  function beginCommentsSetup() {
    commentsSetupOpen = true;
    commentRepository = settings?.comments?.repository ?? "";
    commentCategories = [];
    commentCategoryId = "";
    commentRepositoryId = "";
    commentSetupError = "";
    commentConnectionStatus = "";
    void countMissingCommentKeys();
  }

  function useCommentsCategory(categoryId = commentCategoryId) {
    if (!settings) return;
    const category = commentCategories.find((item) => item.id === categoryId);
    if (!category) {
      commentSetupError = "Choose a Discussion category.";
      return;
    }
    settings.comments = {
      provider: "giscus",
      enabled: settings.comments?.enabled ?? true,
      repository: commentRepository.trim(),
      repositoryId: commentRepositoryId,
      category: category.name,
      categoryId: category.id,
      requireConsent: settings.comments?.requireConsent ?? true,
      lazy: settings.comments?.lazy ?? true,
      reactions: settings.comments?.reactions ?? true,
      inputPosition: settings.comments?.inputPosition ?? "bottom",
    };
    commentsSetupOpen = false;
    commentSetupError = "";
    commentConnectionStatus = "";
  }

  async function discoverComments() {
    if (!commentRepository.trim() || discoveringComments) return;
    discoveringComments = true;
    commentSetupError = "";
    try {
      const result = await api.discoverComments(commentRepository.trim());
      commentRepository = result.repository;
      commentRepositoryId = result.repositoryId;
      commentCategories = result.categories;
      commentCategoryId = result.selectedCategory?.id ?? "";
      if (result.selectedCategory)
        useCommentsCategory(result.selectedCategory.id);
    } catch (caught) {
      commentSetupError = message(caught);
    } finally {
      discoveringComments = false;
    }
  }

  async function parseCommentsScript() {
    if (!commentScript.trim() || parsingComments || !settings) return;
    parsingComments = true;
    commentSetupError = "";
    try {
      const parsed = await api.parseCommentsScript(commentScript);
      settings.comments = {
        ...parsed,
        enabled: settings.comments?.enabled ?? true,
      };
      commentRepository = parsed.repository;
      commentsSetupOpen = false;
      commentScript = "";
      commentConnectionStatus = "";
      void countMissingCommentKeys();
    } catch (caught) {
      commentSetupError = message(caught);
    } finally {
      parsingComments = false;
    }
  }

  async function testCommentsConnection() {
    if (!settings?.comments || testingComments) return;
    testingComments = true;
    commentConnectionStatus = "";
    try {
      const result = await api.discoverComments(settings.comments.repository);
      const category = result.categories.find(
        (item) => item.id === settings?.comments?.categoryId,
      );
      if (result.repositoryId !== settings.comments.repositoryId || !category) {
        throw new Error("Saved repository or category IDs no longer match.");
      }
      commentConnectionStatus = "Connection successful.";
    } catch (caught) {
      commentConnectionStatus = `Connection failed: ${message(caught)}`;
    } finally {
      testingComments = false;
    }
  }

  function setCommentsEnabled(enabled: boolean) {
    if (!settings?.comments) {
      if (enabled) beginCommentsSetup();
      return;
    }
    settings.comments.enabled = enabled;
    if (enabled) void countMissingCommentKeys();
  }

  function openRemoveCommentsDialog() {
    if (settingsDirty || busy) return;
    removeCommentsConfirmation = "";
    removeCommentsDialog?.showModal();
    queueMicrotask(() =>
      removeCommentsDialog
        ?.querySelector<HTMLButtonElement>("[data-cancel]")
        ?.focus(),
    );
  }

  async function removeCommentsSetup() {
    if (removeCommentsConfirmation !== "REMOVE COMMENTS" || removingComments)
      return;
    removingComments = true;
    error = "";
    try {
      const result = await api.removeCommentsSetup(
        settingsRevision,
        removeCommentsConfirmation,
      );
      settings = result.settings;
      savedSettings = cloneSettings(result.settings);
      settingsRevision = result.settingsRevision;
      commentsSetupOpen = false;
      removeCommentsDialog?.close();
      showNotice(
        `Comments setup removed. ${result.removedKeys} Comment ${result.removedKeys === 1 ? "Key" : "Keys"} deleted.`,
      );
      changed = (await api.changed()).changed;
    } catch (caught) {
      const failure = message(caught);
      error = failure;
      if (/Comments (?:were|are) disabled/.test(failure)) {
        try {
          const result = await api.settings();
          settings = result.settings;
          savedSettings = cloneSettings(result.settings);
          settingsRevision = result.settingsRevision;
          settingsConflict = false;
          settingsValidationAttempted = false;
        } catch {
          // Keep the recovery instruction from the original failure.
        }
      }
    } finally {
      removingComments = false;
    }
  }

  async function openCommentDiscussion() {
    if (!selected || openingDiscussion) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    openingDiscussion = true;
    error = "";
    try {
      const result = await api.commentDiscussion(selected.folder);
      const discussions = `https://github.com/${settings?.comments?.repository}/discussions`;
      if (popup) popup.location.href = result.url ?? discussions;
      if (!result.url)
        showNotice("No Discussion exists yet. Opened repository Discussions.");
    } catch (caught) {
      const fallback = `https://github.com/${settings?.comments?.repository}/discussions?discussions_q=${encodeURIComponent(selected.commentKey ?? selected.title)}`;
      if (popup) popup.location.href = fallback;
      error = `${message(caught)} Opened a Comment Key search instead.`;
    } finally {
      openingDiscussion = false;
    }
  }

  function openDiscardSettingsDialog() {
    if (!settingsDirty || busy || settingsConflict) return;
    discardSettingsDialog?.showModal();
    queueMicrotask(() =>
      discardSettingsDialog
        ?.querySelector<HTMLButtonElement>("[data-cancel]")
        ?.focus(),
    );
  }

  function discardSettingsChanges() {
    if (!savedSettings || !settingsDirty || busy || settingsConflict) return;
    discardSettingsDialog?.close();
    settings = cloneSettings(savedSettings);
    settingsValidationAttempted = false;
    error = "";
    showNotice("Settings changes discarded.");
  }

  $effect(() => {
    if (!selected || creatingPost) return;
    const folder = selected.folder;
    const snapshot = signature(selected);
    const isDirty = snapshot !== savedSignature;
    if (recovery) return;
    try {
      if (isDirty)
        localStorage.setItem(
          `local-cms:${folder}`,
          JSON.stringify($state.snapshot(selected)),
        );
      else localStorage.removeItem(`local-cms:${folder}`);
      recoveryStorageWarningShown = false;
    } catch {
      warnRecoveryStorage();
    }
  });

  async function syncExternalChanges() {
    if (loading || document.hidden || externalSyncInFlight) return;
    externalSyncInFlight = true;
    try {
      const folder =
        selected && !creatingPost && !busy ? selected.folder : undefined;
      const sync = await api.sync(folder);
      changed = sync.changed;
      if (
        !folder ||
        !sync.revision ||
        !selected ||
        selected.folder !== folder ||
        creatingPost ||
        busy ||
        sync.revision === selected.revision
      )
        return;
      const latest = await api.post(folder);
      if (selected?.folder !== folder || creatingPost || busy) return;
      if (dirty) remote = latest;
      else {
        selected = clonePost(latest);
        savedSignature = signature(latest);
        replacePost(latest);
        updateCmsTitle();
      }
    } catch {
      // A transient local rebuild should not interrupt writing.
    } finally {
      externalSyncInFlight = false;
    }
  }

  onMount(() => {
    const active = document.documentElement.dataset.theme;
    themeChoice = active === "light" || active === "dark" ? active : "system";
    initializeCmsHistory();
    const mobilePosts = window.matchMedia("(max-width: 48rem)");
    const keepDesktopPostBrowserOpen = () => {
      if (!mobilePosts.matches) postBrowserOpen = true;
    };
    mobilePosts.addEventListener("change", keepDesktopPostBrowserOpen);
    void load();
    const poll = window.setInterval(() => void syncExternalChanges(), 15_000);
    return () => {
      window.clearInterval(poll);
      mobilePosts.removeEventListener("change", keepDesktopPostBrowserOpen);
    };
  });
</script>

<svelte:window
  onkeydown={keydown}
  onfocus={syncExternalChanges}
  onpopstate={handlePopState}
  onbeforeunload={hasUnsavedChanges ? confirmPageLeave : undefined}
  onpagehide={dirty ? discardRecoveryAfterPageLeave : undefined}
/>
<svelte:document onvisibilitychange={syncExternalChanges} />

{#snippet helpTooltip(id: string, label: string, text: string)}
  <span class="tooltip-wrap">
    <button
      type="button"
      class="tooltip-trigger"
      aria-label={label}
      aria-describedby={id}>?</button
    >
    <span {id} class="tooltip-text" role="tooltip">{text}</span>
  </span>
{/snippet}

{#snippet removeRowButton(label: string, remove: () => void)}
  <button
    type="button"
    class="remove-row-button"
    aria-label={label}
    title={label}
    onclick={remove}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </svg>
  </button>
{/snippet}

{#snippet recoveryVersion(
  post: PostDocument,
  heading: string,
  copyLabel: string,
)}
  <article class="recovery-version">
    <header>
      <h3>{heading}</h3>
    </header>
    <dl>
      <div>
        <dt>Title</dt>
        <dd>{post.title}</dd>
      </div>
      <div>
        <dt>Slug</dt>
        <dd>{post.slug}</dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>{post.draft ? "Draft" : "Publish"}</dd>
      </div>
      <div>
        <dt>Published</dt>
        <dd>{post.published ?? "—"}</dd>
      </div>
      <div>
        <dt>Updated</dt>
        <dd>{post.updated ?? "—"}</dd>
      </div>
      <div>
        <dt>Tags</dt>
        <dd>{post.tags.join(", ") || "—"}</dd>
      </div>
      <div class="recovery-description">
        <dt>Description</dt>
        <dd>{post.description}</dd>
      </div>
    </dl>
    <div class="recovery-body">
      <div class="recovery-body-head">
        <strong>Body</strong>
        <button
          type="button"
          class="quiet"
          onclick={() => void copyRecovery(post.body, `${copyLabel} body`)}
          >Copy body</button
        >
      </div>
      <pre>{post.body || "(Empty body)"}</pre>
    </div>
  </article>
{/snippet}

{#if loading}
  <main class="loading"><p>Opening the site editor…</p></main>
{:else}
  <div
    class="app"
    style:--accent-base={settings?.accentColor ?? "#BC5215"}
    style:--accent-light={readableAccent(
      settings?.accentColor ?? "#BC5215",
      "light",
    )}
    style:--accent-dark={readableAccent(
      settings?.accentColor ?? "#BC5215",
      "dark",
    )}
    style:--accent-contrast={accentContrast(settings?.accentColor ?? "#BC5215")}
  >
    <a class="skip-link" href="#cms-content">Skip to CMS content</a>
    <header class="topbar">
      <div class="cms-brand">
        <strong title={cmsBrandName}>{cmsBrandName}</strong>
        <span aria-hidden="true">·</span>
        <span class="cms-brand-context">Editor</span>
      </div>
      <nav aria-label="CMS sections">
        <button
          class:active={view === "posts"}
          aria-current={view === "posts" ? "page" : undefined}
          disabled={busy}
          onclick={() => navigateView("posts")}>Posts</button
        >
        <button
          class:active={view === "media"}
          aria-current={view === "media" ? "page" : undefined}
          disabled={busy}
          onclick={() => navigateView("media")}>Media</button
        >
        <button
          class:active={view === "settings"}
          aria-current={view === "settings" ? "page" : undefined}
          disabled={busy}
          onclick={() => navigateView("settings")}>Settings</button
        >
      </nav>
      <a href="/" target="_blank">View site</a>
      <fieldset class="theme-selector">
        <legend class="visually-hidden">Theme</legend>
        <label>
          <input
            type="radio"
            name="theme"
            value="light"
            checked={themeChoice === "light"}
            onchange={() => chooseTheme("light")}
          />
          Light
        </label>
        <label>
          <input
            type="radio"
            name="theme"
            value="dark"
            checked={themeChoice === "dark"}
            onchange={() => chooseTheme("dark")}
          />
          Dark
        </label>
        <label>
          <input
            type="radio"
            name="theme"
            value="system"
            checked={themeChoice === "system"}
            onchange={() => chooseTheme("system")}
          />
          System
        </label>
      </fieldset>
    </header>

    <div class="notifications" aria-label="Notifications">
      {#if error}<div class="toast toast-error" role="alert">
          <span>{error}</span><button
            aria-label="Dismiss error"
            onclick={() => (error = "")}>×</button
          >
        </div>{/if}
      {#each notices as notice (notice.id)}
        <div class="toast toast-success" role="status">
          <span>{notice.message}</span><button
            aria-label="Dismiss notice"
            onclick={() => dismissNotice(notice.id)}>×</button
          >
        </div>
      {/each}
    </div>

    {#if view === "posts"}
      <div class="workspace">
        <aside class="sidebar">
          <details class="post-browser" bind:open={postBrowserOpen}>
            <summary>
              <span>{selected ? "Change post" : "Choose a post"}</span>
              {#if selected}<small
                  >{selected.title || "Untitled new post"}</small
                >{/if}
            </summary>
            <div class="post-browser-content">
              <button class="primary" disabled={busy} onclick={startNewPost}
                >New post</button
              >
              <ul class="post-menu">
                {#each posts as post (post.folder)}
                  <li>
                    <button
                      class:selected={selected?.folder === post.folder}
                      aria-current={selected?.folder === post.folder
                        ? "true"
                        : undefined}
                      disabled={busy}
                      onclick={() => choose(post)}
                      ><span>{post.title}</span><span class="post-menu-meta"
                        ><span
                          class="post-status"
                          data-status={post.status}
                          title={statusDescription(post.status)}
                          >{statusLabel(post.status)}</span
                        ><small>{post.folder}</small></span
                      ></button
                    >
                  </li>
                {/each}
              </ul>
              <details>
                <summary>Changed files ({changed.length})</summary>
                {#if changed.length}<pre>{changed.join("\n")}</pre>{:else}<p>
                    Worktree clean.
                  </p>{/if}
              </details>
            </div>
          </details>
        </aside>

        <main
          id="cms-content"
          class="editor-pane"
          tabindex="-1"
          inert={savingPost}
          aria-busy={savingPost}
        >
          {#if selected}
            {#if recovery}
              <section
                class="recovery-panel"
                aria-labelledby="recovery-title"
                data-testid="recovery-panel"
              >
                <header class="recovery-head">
                  <div>
                    <h2 id="recovery-title">Unsaved recovery found</h2>
                    <p>
                      {recoveryDiverged
                        ? "The file changed after this browser recovery was written. Nothing has been replaced."
                        : "This browser recovery differs from the saved file. Nothing has been replaced."}
                    </p>
                    <small
                      >Copy anything you need into the editor below, then
                      discard the recovery to enable Save.</small
                    >
                  </div>
                  <button type="button" class="quiet" onclick={discardRecovery}
                    >Discard recovery</button
                  >
                </header>
                <div class="recovery-compare">
                  {@render recoveryVersion(
                    selected,
                    "Current editor",
                    "Current",
                  )}
                  {@render recoveryVersion(
                    recovery,
                    "Recovered browser copy",
                    "Recovered",
                  )}
                </div>
              </section>
            {/if}
            {#if remote}
              <div class="conflict" role="alert">
                <strong>This file changed outside the CMS.</strong>
                <button
                  onclick={() => {
                    selected = clonePost(remote!);
                    savedSignature = signature(remote!);
                    remote = null;
                  }}>Reload external version</button
                >
                <details>
                  <summary>Compare body</summary>
                  <div class="compare">
                    <pre>{selected.body}</pre>
                    <pre>{remote.body}</pre>
                  </div>
                </details>
              </div>
            {/if}
            <div class="editor-head">
              <div>
                <h1
                  class="post-title"
                  aria-label={selected.title || "Untitled"}
                >
                  <textarea
                    id="post-title"
                    rows="1"
                    aria-label="Title"
                    placeholder="Untitled"
                    required
                    maxlength="180"
                    aria-invalid={postValidationAttempted &&
                      !selected.title.trim()}
                    aria-describedby={postValidationAttempted &&
                    !selected.title.trim()
                      ? "post-title-error"
                      : undefined}
                    bind:value={selected.title}
                    onkeydown={(event) => {
                      if (event.key === "Enter") event.preventDefault();
                    }}
                    oninput={(event) => {
                      event.currentTarget.value =
                        event.currentTarget.value.replace(/[\r\n]+/g, " ");
                      if (creatingPost && !event.currentTarget.value.trim())
                        selected!.draft = true;
                    }}></textarea>
                </h1>
                {#if postValidationAttempted && !selected.title.trim()}
                  <small id="post-title-error" class="field-error"
                    >Enter a Post title.</small
                  >
                {/if}
                <small
                  >{creatingPost
                    ? dirty
                      ? "Unsaved new Post"
                      : "Not saved"
                    : dirty
                      ? "Unsaved changes"
                      : "Saved"} · {creatingPost
                    ? selected.draft
                      ? "Draft"
                      : "Publish"
                    : statusLabel(selected.status)}</small
                >
              </div>
              <div class="editor-actions">
                {#if viewPostHref}
                  <a href={viewPostHref} target="_blank">View post</a>
                {/if}
                {#if !creatingPost && settings?.comments && selected.commentKey}
                  <button
                    type="button"
                    class="secondary-action"
                    disabled={openingDiscussion || busy}
                    onclick={openCommentDiscussion}
                    >{openingDiscussion
                      ? "Opening…"
                      : "Manage discussion"}</button
                  >
                {/if}
                <div class="publication-control">
                  <fieldset
                    class="publication-state"
                    aria-describedby="publication-save-note"
                  >
                    <legend>Publication status</legend>
                    <label data-active={selected.draft}>
                      <input
                        type="radio"
                        name="publication-status"
                        checked={selected.draft}
                        onchange={() => (selected!.draft = true)}
                      />
                      Draft
                    </label>
                    <label data-active={!selected.draft}>
                      <input
                        type="radio"
                        name="publication-status"
                        checked={!selected.draft}
                        disabled={creatingPost && !postFieldsReady}
                        onchange={() => (selected!.draft = false)}
                      />
                      Publish
                    </label>
                  </fieldset>
                </div>
                <span id="publication-save-note" class="visually-hidden"
                  >Changes apply after pressing the Save button.</span
                >
                <button
                  type="button"
                  class="secondary-action"
                  disabled={!dirty || busy || !!remote || !!recovery}
                  onclick={openDiscardPostDialog}
                  >{creatingPost
                    ? "Discard new Post"
                    : "Discard changes"}</button
                >
                <button
                  class="primary"
                  disabled={!dirty || busy || !!remote || !!recovery}
                  onclick={save}
                  >{#if savingPost}Saving…{:else}Save <kbd>Ctrl/⌘ S</kbd
                    >{/if}</button
                >
              </div>
            </div>
            <dialog
              class="confirm-dialog"
              aria-labelledby="discard-post-title"
              aria-describedby="discard-post-description"
              bind:this={discardPostDialog}
            >
              <h2 id="discard-post-title">
                {creatingPost
                  ? "Discard this new Post?"
                  : "Discard unsaved Post changes?"}
              </h2>
              <p id="discard-post-description">
                {creatingPost
                  ? "Everything entered in this new Post will be permanently lost. No file has been created yet."
                  : `The editor will return to the last saved version of “${selected.title}”. This cannot be undone.`}
              </p>
              <div class="confirm-actions">
                <button
                  type="button"
                  data-cancel
                  onclick={() => discardPostDialog?.close()}>Cancel</button
                >
                <button
                  type="button"
                  class="destructive"
                  onclick={discardPostChanges}
                  >{creatingPost
                    ? "Discard new Post"
                    : "Discard changes"}</button
                >
              </div>
            </dialog>
            {#if !creatingPost}
              <dialog
                class="confirm-dialog"
                aria-labelledby="delete-post-title"
                aria-describedby="delete-post-description"
                bind:this={deletePostDialog}
              >
                <h2 id="delete-post-title">
                  {selected.draft
                    ? "Delete this draft?"
                    : "Delete this published Post?"}
                </h2>
                <div id="delete-post-description">
                  <p>
                    “{selected.title}” and its entire folder, including imported
                    Post media, will be removed from this working copy.
                  </p>
                  {#if !selected.draft}
                    <p class="danger-note">
                      After deployment, <code>/posts/{selected.slug}/</code> will
                      return a 404 page.
                    </p>
                  {/if}
                  {#if selected.commentKey && settings?.comments}
                    <p class="danger-note">
                      Its GitHub Discussion is not deleted. Remove or lock it on
                      GitHub if needed.
                    </p>
                  {/if}
                  {#if dirty}
                    <p class="danger-note">
                      Unsaved editor changes will also be lost.
                    </p>
                  {/if}
                </div>
                <div class="confirm-actions">
                  <button
                    type="button"
                    data-cancel
                    disabled={deletingPost}
                    onclick={() => deletePostDialog?.close()}>Cancel</button
                  >
                  <button
                    type="button"
                    class="destructive"
                    disabled={deletingPost}
                    onclick={deleteSavedPost}
                    >{deletingPost
                      ? "Deleting…"
                      : selected.draft
                        ? "Delete draft"
                        : "Delete Post"}</button
                  >
                </div>
              </dialog>
            {/if}
            {#if postValidationAttempted && !postFieldsReady}
              <p class="publication-requirements" role="alert">
                Add a title, Post description, and valid slug before saving.
              </p>
            {/if}
            <div class="fields">
              <div class="field post-description">
                <div class="field-label-row">
                  <label for="post-description">Post description</label>
                  {@render helpTooltip(
                    "post-description-help",
                    "What is a Post description?",
                    "A short summary used in social previews, feeds, and search metadata. It does not appear in the Post body.",
                  )}
                </div>
                <textarea
                  id="post-description"
                  required
                  maxlength="320"
                  aria-invalid={postValidationAttempted &&
                    !selected.description.trim()}
                  aria-describedby={postValidationAttempted &&
                  !selected.description.trim()
                    ? "post-description-help post-description-error"
                    : "post-description-help"}
                  rows="5"
                  bind:value={selected.description}></textarea><button
                  class="quiet"
                  onclick={suggestDescription}
                  >Suggest from first paragraph</button
                >
                {#if postValidationAttempted && !selected.description.trim()}
                  <small id="post-description-error" class="field-error"
                    >Enter a short Post description.</small
                  >
                {/if}
              </div>
              <div class="field post-slug">
                <div class="field-label-row">
                  <label for="post-slug">Slug</label>
                  {@render helpTooltip(
                    "post-slug-help",
                    "What is a slug?",
                    "The URL-friendly part after /posts/, such as “my-first-post”.",
                  )}
                </div>
                <input
                  id="post-slug"
                  aria-label="Slug"
                  required
                  maxlength="100"
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  aria-invalid={postValidationAttempted &&
                    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selected.slug)}
                  aria-describedby={[
                    "post-slug-help",
                    postValidationAttempted &&
                    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selected.slug)
                      ? "post-slug-error"
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  bind:value={selected.slug}
                  oninput={() => {
                    if (
                      creatingPost &&
                      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selected!.slug)
                    )
                      selected!.draft = true;
                  }}
                />
                {#if postValidationAttempted && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selected.slug)}
                  <small id="post-slug-error" class="field-error"
                    >Use lowercase letters, numbers, and single hyphens.</small
                  >
                {/if}
              </div>
              <label class="post-tags"
                >Tags <input
                  value={selected.tags.join(", ")}
                  oninput={(event) =>
                    (selected!.tags = event.currentTarget.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean))}
                /></label
              >
              <label class="post-published"
                >Published <input
                  type="date"
                  bind:value={selected.published}
                /></label
              >
              <label class="post-updated"
                >Updated <input
                  type="date"
                  bind:value={selected.updated}
                /></label
              >
              <fieldset class="social-media">
                <legend>
                  <span class="field-label-row">
                    Social image
                    {@render helpTooltip(
                      "social-image-help",
                      "What is a social image?",
                      "The preview image shown when this post is shared. If none is chosen, the site default is used.",
                    )}
                  </span>
                </legend>
                <button
                  type="button"
                  class="social-image-trigger"
                  aria-haspopup="dialog"
                  aria-describedby="social-image-help"
                  onclick={() => socialImageDialog?.showModal()}
                >
                  {#if selectedSocialMedia}
                    <img
                      src={selectedSocialMedia.src}
                      srcset={selectedSocialMedia.srcset}
                      sizes="8rem"
                      alt=""
                    />
                    <span>
                      <strong>{selectedSocialMedia.name}</strong>
                      Change social image
                    </span>
                  {:else}
                    <span>
                      <strong>Use site default</strong>
                      Choose social image
                    </span>
                  {/if}
                </button>
              </fieldset>
              <div class="field post-aliases">
                <div class="field-label-row">
                  <label for="post-aliases">Aliases</label>
                  {@render helpTooltip(
                    "post-aliases-help",
                    "What are aliases?",
                    "Previous slugs that redirect to this post. Separate multiple aliases with commas.",
                  )}
                </div>
                <input
                  id="post-aliases"
                  aria-label="Aliases"
                  aria-describedby="post-aliases-help"
                  value={selected.aliases.join(", ")}
                  oninput={(event) =>
                    (selected!.aliases = event.currentTarget.value
                      .split(",")
                      .map((value) => value.trim())
                      .filter(Boolean))}
                />
              </div>
            </div>
            <dialog
              class="media-dialog"
              aria-labelledby="social-image-dialog-title"
              bind:this={socialImageDialog}
            >
              <div class="dialog-head">
                <div>
                  <h2 id="social-image-dialog-title">Choose social image</h2>
                  <small>Most recently imported first.</small>
                </div>
                <button
                  type="button"
                  aria-label="Close social image gallery"
                  onclick={() => socialImageDialog?.close()}>×</button
                >
              </div>
              {#if mediaError}
                <p class="field-error" role="alert">{mediaError}</p>
              {/if}
              <MediaGallery
                assets={mediaLibrary}
                selectedIds={selectedSocialMedia
                  ? [selectedSocialMedia.id]
                  : []}
                defaultChoice={{
                  label: "Use site default",
                  src: settings?.defaultSocialImage,
                  selected: !selected.socialImage,
                }}
                ondefaultselect={() => chooseSocialImage(null)}
                onselect={chooseSocialImage}
                candelete={canDeleteMedia}
                ondelete={deleteMedia}
              />
              {#if !mediaLibrary.length}<p>No imported media yet.</p>{/if}
            </dialog>
            <section class="body-editor">
              <div
                class="editor-lock-frame"
                aria-busy={imageImportPhase !== "idle"}
              >
                <div class="editor-lock" inert={imageImportPhase !== "idle"}>
                  <div
                    class="editor-tabs"
                    role="tablist"
                    aria-label="Post editor"
                  >
                    <button
                      id="editor-tab-visual"
                      role="tab"
                      aria-controls="editor-panel-visual"
                      aria-selected={editorMode === "visual"}
                      tabindex={editorMode === "visual" ? 0 : -1}
                      onkeydown={editorTabKeydown}
                      onclick={() => selectEditorTab("visual")}>Visual</button
                    >
                    <button
                      id="editor-tab-source"
                      role="tab"
                      aria-controls="editor-panel-source"
                      aria-selected={editorMode === "source"}
                      tabindex={editorMode === "source" ? 0 : -1}
                      onkeydown={editorTabKeydown}
                      onclick={() => selectEditorTab("source")}
                      >Markdown / HTML</button
                    >
                  </div>
                  <div
                    id="editor-panel-visual"
                    role="tabpanel"
                    aria-labelledby="editor-tab-visual"
                    hidden={editorMode !== "visual"}
                  >
                    {#if editorMode === "visual"}
                      {#key selected.folder}
                        <VisualEditor
                          value={selected.body}
                          insertion={visualInsertion}
                          oninserted={finishVisualInsertion}
                          onchange={(body) => {
                            if (selected) selected.body = body;
                          }}
                        />
                      {/key}
                    {/if}
                  </div>
                  <div
                    id="editor-panel-source"
                    role="tabpanel"
                    aria-labelledby="editor-tab-source"
                    hidden={editorMode !== "source"}
                  >
                    {#if editorMode === "source"}
                      <textarea
                        class="markdown"
                        aria-label="Markdown and HTML source"
                        bind:this={editor}
                        bind:value={selected.body}
                        spellcheck="true"></textarea>
                    {/if}
                  </div>
                </div>
                {#if imageImportPhase !== "idle"}
                  <div class="editor-lock-overlay" role="status">
                    <span>Editor locked until image import finishes.</span>
                  </div>
                {/if}
              </div>
              {#if creatingPost}
                <section
                  class="image-drop pending-media"
                  aria-labelledby="image-import-title"
                >
                  <div class="image-import-heading">
                    <h2 id="image-import-title">Import and insert image</h2>
                  </div>
                  <p>Save this Post before adding images.</p>
                </section>
              {:else}
                <div
                  class="image-drop"
                  bind:this={imageImporter}
                  role="group"
                  aria-labelledby="image-import-title"
                >
                  <div class="image-import-heading">
                    <h2 id="image-import-title">Import and insert image</h2>
                    {@render helpTooltip(
                      "image-conversion-help",
                      "How are images converted?",
                      "Raster images are converted to responsive, non-upscaled AVIF variants. SVG files remain SVG.",
                    )}
                  </div>
                  <fieldset class="image-layout">
                    <legend>Image layout</legend>
                    <label class="check"
                      ><input
                        type="radio"
                        value="single"
                        bind:group={imageLayout}
                      /> Single</label
                    >
                    <label class="check"
                      ><input
                        type="radio"
                        value="pair"
                        bind:group={imageLayout}
                      /> Pair</label
                    >
                  </fieldset>
                  <fieldset class="image-layout">
                    <legend>Image source</legend>
                    <label class="check"
                      ><input
                        type="radio"
                        value="upload"
                        bind:group={imageSource}
                      /> File manager</label
                    >
                    <label class="check"
                      ><input
                        type="radio"
                        value="library"
                        bind:group={imageSource}
                      /> Media library</label
                    >
                  </fieldset>
                  {#if imageSource === "library"}
                    <div
                      class="media-library"
                      role="group"
                      aria-label="Post media library"
                      data-invalid={imageValidationAttempted &&
                        (imageMissing.firstSource || imageMissing.secondSource)}
                    >
                      {#if mediaError}
                        <p class="field-error" role="alert">{mediaError}</p>
                      {/if}
                      {#if mediaLibrary.length}
                        <MediaGallery
                          assets={mediaLibrary}
                          selectedIds={mediaSelection}
                          maxSelections={imageLayout === "pair" ? 2 : 1}
                          onselect={toggleMedia}
                          candelete={canDeleteMedia}
                          ondelete={deleteMedia}
                        />
                      {:else}
                        <p>No imported media yet.</p>
                      {/if}
                    </div>
                  {/if}
                  <div
                    class={[
                      "image-item",
                      imageLayout === "single" && "image-item-single",
                    ]}
                  >
                    {#if imageSource === "upload"}
                      <div
                        class={[
                          "post-image-dropzone",
                          imageDragTarget === 1 && "drag-active",
                        ]}
                        role="group"
                        aria-label="Image 1 upload"
                        data-invalid={imageValidationAttempted &&
                          imageMissing.firstSource}
                        ondragenter={(event) => {
                          event.preventDefault();
                          imageDragTarget = 1;
                        }}
                        ondragover={(event) => {
                          event.preventDefault();
                          imageDragTarget = 1;
                        }}
                        ondragleave={(event) => leftPostImage(event, 1)}
                        ondrop={(event) => droppedPostImage(event, 1)}
                      >
                        <strong>Drop image 1 here or browse</strong>
                        <small>{imageFile?.name ?? "No file selected"}</small>
                        <button
                          type="button"
                          aria-label="Browse files for image 1"
                          disabled={busy || imageImportPhase !== "idle"}
                          onclick={() => browsePostImage(1)}
                          >Browse files</button
                        >
                        <input
                          class="visually-hidden"
                          bind:this={imageFileInput}
                          type="file"
                          accept="image/*,.svg"
                          aria-label="Image 1 (required)"
                          required
                          disabled={busy || imageImportPhase !== "idle"}
                          aria-invalid={imageValidationAttempted &&
                            imageMissing.firstSource}
                          aria-describedby={imageValidationAttempted &&
                          imageMissing.firstSource
                            ? "image-1-file-error"
                            : undefined}
                          onchange={(event) =>
                            selectPostImage(
                              event.currentTarget.files?.[0] ?? null,
                              1,
                            )}
                        />
                      </div>
                    {:else}
                      <div
                        class="chosen-media"
                        aria-invalid={imageValidationAttempted &&
                          imageMissing.firstSource}
                      >
                        <strong>Image 1</strong>
                        <span
                          >{selectedMedia[0]?.name ??
                            "Choose from the gallery"}</span
                        >
                      </div>
                    {/if}
                    {#if imageValidationAttempted && imageMissing.firstSource}
                      <small id="image-1-file-error" class="field-error"
                        >Choose the first image source.</small
                      >
                    {/if}
                    <label
                      >Alt text 1 (required) <input
                        bind:value={imageAlt}
                        required
                        aria-invalid={imageValidationAttempted &&
                          imageMissing.firstAlt}
                        aria-describedby={imageValidationAttempted &&
                        imageMissing.firstAlt
                          ? "image-1-alt-error"
                          : undefined}
                      /></label
                    >
                    {#if imageValidationAttempted && imageMissing.firstAlt}
                      <small id="image-1-alt-error" class="field-error"
                        >Enter alt text for the first image.</small
                      >
                    {/if}
                  </div>
                  {#if imageLayout === "pair"}
                    <div class="image-item">
                      {#if imageSource === "upload"}
                        <div
                          class={[
                            "post-image-dropzone",
                            imageDragTarget === 2 && "drag-active",
                          ]}
                          role="group"
                          aria-label="Image 2 upload"
                          data-invalid={imageValidationAttempted &&
                            imageMissing.secondSource}
                          ondragenter={(event) => {
                            event.preventDefault();
                            imageDragTarget = 2;
                          }}
                          ondragover={(event) => {
                            event.preventDefault();
                            imageDragTarget = 2;
                          }}
                          ondragleave={(event) => leftPostImage(event, 2)}
                          ondrop={(event) => droppedPostImage(event, 2)}
                        >
                          <strong>Drop image 2 here or browse</strong>
                          <small
                            >{secondImageFile?.name ??
                              "No file selected"}</small
                          >
                          <button
                            type="button"
                            aria-label="Browse files for image 2"
                            disabled={busy || imageImportPhase !== "idle"}
                            onclick={() => browsePostImage(2)}
                            >Browse files</button
                          >
                          <input
                            class="visually-hidden"
                            bind:this={secondImageFileInput}
                            type="file"
                            accept="image/*,.svg"
                            aria-label="Image 2 (required)"
                            required
                            disabled={busy || imageImportPhase !== "idle"}
                            aria-invalid={imageValidationAttempted &&
                              imageMissing.secondSource}
                            aria-describedby={imageValidationAttempted &&
                            imageMissing.secondSource
                              ? "image-2-file-error"
                              : undefined}
                            onchange={(event) =>
                              selectPostImage(
                                event.currentTarget.files?.[0] ?? null,
                                2,
                              )}
                          />
                        </div>
                      {:else}
                        <div
                          class="chosen-media"
                          aria-invalid={imageValidationAttempted &&
                            imageMissing.secondSource}
                        >
                          <strong>Image 2</strong>
                          <span
                            >{selectedMedia[1]?.name ??
                              "Choose from the gallery"}</span
                          >
                        </div>
                      {/if}
                      {#if imageValidationAttempted && imageMissing.secondSource}
                        <small id="image-2-file-error" class="field-error"
                          >Choose the second image source.</small
                        >
                      {/if}
                      <label
                        >Alt text 2 (required) <input
                          bind:value={secondImageAlt}
                          required
                          aria-invalid={imageValidationAttempted &&
                            imageMissing.secondAlt}
                          aria-describedby={imageValidationAttempted &&
                          imageMissing.secondAlt
                            ? "image-2-alt-error"
                            : undefined}
                        /></label
                      >
                      {#if imageValidationAttempted && imageMissing.secondAlt}
                        <small id="image-2-alt-error" class="field-error"
                          >Enter alt text for the second image.</small
                        >
                      {/if}
                    </div>
                  {/if}
                  <div class="image-caption">
                    {#if imageLayout === "pair" && individualCaptions}
                      <label
                        >Caption 1 (optional) <input
                          bind:value={imageCaption}
                        /></label
                      >
                      <label
                        >Caption 2 (optional) <input
                          bind:value={secondImageCaption}
                        /></label
                      >
                    {:else}
                      <label class="caption-full"
                        >{imageLayout === "pair"
                          ? "Pair caption (optional)"
                          : "Caption (optional)"}
                        <input bind:value={imageCaption} /></label
                      >
                    {/if}
                    {#if imageLayout === "pair"}
                      <label class="check caption-toggle"
                        ><input
                          type="checkbox"
                          role="switch"
                          bind:checked={individualCaptions}
                        /> Individual captions</label
                      >
                    {/if}
                  </div>
                  {#if imageValidationAttempted && !imageReady}
                    <small class="validation-summary" role="alert"
                      >Complete the red-outlined required fields.</small
                    >
                  {/if}
                  <div class="import-actions">
                    <button disabled={busy} onclick={importImage}>Insert</button
                    >
                    {#if imageImportPhase !== "idle"}
                      <div class="import-progress" aria-live="polite">
                        <span>{imagePhaseLabel()} — {imageImportPercent}%</span>
                        <progress
                          aria-label={imagePhaseLabel(true)}
                          max="100"
                          value={imageImportPercent}
                        ></progress>
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </section>
            {#if !creatingPost}
              <button
                type="button"
                class="delete-post-button"
                disabled={busy}
                onclick={openDeletePostDialog}>Delete Post</button
              >
            {/if}
          {:else}
            <div class="empty">
              <h1>Choose a post</h1>
              <p>Or start a new Post.</p>
            </div>
          {/if}
        </main>
      </div>
    {:else if view === "media"}
      <main id="cms-content" class="media-manager" tabindex="-1">
        <div class="editor-head">
          <div>
            <h1>Media</h1>
            <p>
              Upload images here to make them available to every Post and site
              setting. Images uploaded inside a Post belong only to that Post.
            </p>
          </div>
        </div>
        <section class="library-import" aria-labelledby="library-import-title">
          <div class="library-import-heading">
            <h2 id="library-import-title">Import media</h2>
            <small>Stored globally and reusable in any post or setting.</small>
          </div>
          <input
            id="global-media-file"
            class="visually-hidden"
            bind:this={libraryFileInput}
            type="file"
            accept="image/*,.svg"
            aria-label="Choose global image"
            disabled={libraryImportPhase !== "idle"}
            onchange={(event) =>
              selectLibraryFile(event.currentTarget.files?.[0] ?? null)}
          />
          {#if libraryFile}
            <div class="library-selected-file" aria-live="polite">
              <div>
                <small>Selected image</small>
                <strong>{libraryFile.name}</strong>
              </div>
              <div class="library-selected-actions">
                <button
                  type="button"
                  disabled={libraryImportPhase !== "idle"}
                  onclick={browseLibraryImage}>Choose another</button
                >
                <button
                  class="primary"
                  disabled={busy}
                  onclick={importLibraryImage}
                  >{libraryImportPhase === "idle"
                    ? "Import"
                    : "Importing…"}</button
                >
              </div>
              {#if libraryImportPhase !== "idle"}
                <div class="import-progress">
                  <span>{libraryPhaseLabel()} — {libraryImportPercent}%</span>
                  <progress
                    aria-label={libraryPhaseLabel(true)}
                    max="100"
                    value={libraryImportPercent}
                  ></progress>
                </div>
              {/if}
            </div>
          {:else}
            <div
              class="library-dropzone"
              class:drag-active={libraryDragActive}
              role="group"
              aria-label="Add global image"
              ondragenter={(event) => {
                event.preventDefault();
                libraryDragActive = true;
              }}
              ondragover={(event) => {
                event.preventDefault();
                libraryDragActive = true;
              }}
              ondragleave={() => (libraryDragActive = false)}
              ondrop={droppedLibraryImage}
            >
              <strong>Drop an image here or browse</strong>
              <small
                >Raster images become responsive AVIF; SVG remains SVG.</small
              >
              <button type="button" onclick={browseLibraryImage}
                >Browse files</button
              >
            </div>
          {/if}
        </section>
        {#if globalMedia.length}
          <MediaGallery
            assets={globalMedia}
            selectedIds={[]}
            candelete={canDeleteGlobalMedia}
            ondelete={deleteGlobalMedia}
          />
          <small
            >Delete is available only for media unused across the site.</small
          >
        {:else}
          <p>No imported media yet.</p>
        {/if}
      </main>
    {:else if settings}
      <main
        id="cms-content"
        class="settings"
        tabindex="-1"
        inert={savingSettings}
        aria-busy={savingSettings}
      >
        <div class="editor-head">
          <div>
            <h1>Site settings</h1>
            <p>
              Safe, schema-validated values stored in <code
                >site.config.yaml</code
              >.
            </p>
          </div>
          <div class="editor-actions">
            <button
              type="button"
              class="secondary-action"
              disabled={!settingsDirty || busy || settingsConflict}
              onclick={openDiscardSettingsDialog}>Discard changes</button
            >
            <button
              class="primary"
              disabled={!settingsDirty || busy || settingsConflict}
              onclick={saveSettings}
              >{savingSettings ? "Saving…" : "Save settings"}</button
            >
          </div>
        </div>
        <dialog
          class="confirm-dialog"
          aria-labelledby="discard-settings-title"
          aria-describedby="discard-settings-description"
          bind:this={discardSettingsDialog}
        >
          <h2 id="discard-settings-title">Discard settings changes?</h2>
          <p id="discard-settings-description">
            Every unsaved setting will return to its last saved value. This
            cannot be undone.
          </p>
          <div class="confirm-actions">
            <button
              type="button"
              data-cancel
              onclick={() => discardSettingsDialog?.close()}>Cancel</button
            >
            <button
              type="button"
              class="destructive"
              onclick={discardSettingsChanges}>Discard changes</button
            >
          </div>
        </dialog>
        {#if settingsConflict}
          <section class="conflict settings-conflict" role="alert">
            <div>
              <strong>Settings changed in the file.</strong>
              <p>
                Your current form is still here. Reloading will replace it with
                the values now in <code>site.config.yaml</code>.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onclick={reloadSettingsFromFile}>Reload settings from file</button
            >
          </section>
        {/if}
        {#if settingsValidationAttempted && !settingsValidation?.success}
          <p class="settings-validation-summary" role="alert">
            Review the highlighted fields, then save again.
          </p>
        {/if}
        <div class="settings-grid">
          <section>
            <h2>Identity</h2>
            <p class="settings-section-description">
              Names and metadata used across the Published Site, social
              previews, and RSS.
            </p>
            <label
              >Blog title
              <input
                bind:value={settings.title}
                aria-invalid={Boolean(settingsError("title"))}
                aria-describedby={settingsError("title")
                  ? "site-title-error"
                  : undefined}
              />
              {#if settingsError("title")}
                <small id="site-title-error" class="field-error" role="alert"
                  >{settingsError("title")}</small
                >
              {/if}</label
            >
            <div class="field">
              <div class="field-label-row">
                <label for="site-description">Site description</label>
                {@render helpTooltip(
                  "site-description-help",
                  "What is the Site description?",
                  "The default summary used in site metadata, social previews, and the RSS feed. Posts use their own descriptions.",
                )}
              </div>
              <textarea
                id="site-description"
                aria-invalid={Boolean(settingsError("description"))}
                aria-describedby={settingsError("description")
                  ? "site-description-help site-description-error"
                  : "site-description-help"}
                rows="2"
                bind:value={settings.description}></textarea>
              {#if settingsError("description")}
                <small
                  id="site-description-error"
                  class="field-error"
                  role="alert">{settingsError("description")}</small
                >
              {/if}
            </div>
            <label
              >Author
              <input
                bind:value={settings.author}
                aria-invalid={Boolean(settingsError("author"))}
                aria-describedby={settingsError("author")
                  ? "site-author-error"
                  : undefined}
              />
              {#if settingsError("author")}
                <small id="site-author-error" class="field-error" role="alert"
                  >{settingsError("author")}</small
                >
              {/if}</label
            >
            <label
              >Canonical domain <input
                type="url"
                bind:value={settings.domain}
                aria-invalid={Boolean(settingsError("domain"))}
                aria-describedby={settingsError("domain")
                  ? "site-domain-help site-domain-error"
                  : "site-domain-help"}
              />
              <small id="site-domain-help" class="field-help"
                >Public base URL used for canonical links and feeds.</small
              >
              {#if settingsError("domain")}
                <small id="site-domain-error" class="field-error" role="alert"
                  >{settingsError("domain")}</small
                >
              {/if}</label
            >
            <label
              >Locale
              <input
                bind:value={settings.locale}
                aria-invalid={Boolean(settingsError("locale"))}
                aria-describedby={settingsError("locale")
                  ? "site-locale-help site-locale-error"
                  : "site-locale-help"}
              />
              <small id="site-locale-help" class="field-help"
                >Used for dates and metadata; for example, en-US.</small
              >
              {#if settingsError("locale")}
                <small id="site-locale-error" class="field-error" role="alert"
                  >{settingsError("locale")}</small
                >
              {/if}</label
            >
            <h2>Appearance</h2>
            <p class="settings-section-description">
              Site-wide color, sharing image, and trusted embedded content.
            </p>
            <label class="accent-picker"
              >Accent color
              <span>
                <input
                  type="color"
                  aria-label="Accent color"
                  bind:value={settings.accentColor}
                />
                <code>{settings.accentColor.toUpperCase()}</code>
              </span></label
            >
            <div class="field">
              <span>Default social image</span>
              <small class="field-help"
                >Used when a Post has no Social Image of its own.</small
              >
              <button
                type="button"
                class="social-image-trigger"
                aria-haspopup="dialog"
                onclick={() => defaultSocialImageDialog?.showModal()}
              >
                {#if selectedDefaultSocialMedia}
                  <img
                    src={selectedDefaultSocialMedia.src}
                    srcset={selectedDefaultSocialMedia.srcset}
                    sizes="8rem"
                    alt=""
                  />
                  <span>
                    <strong>{selectedDefaultSocialMedia.name}</strong>
                    Choose default social image
                  </span>
                {:else}
                  <span>
                    <strong
                      >{settings.defaultSocialImage ??
                        "No default social image"}</strong
                    >
                    Choose default social image
                  </span>
                {/if}
              </button>
            </div>
            <label
              >Allowed iframe origins <textarea
                aria-invalid={Boolean(settingsErrorWithin("frames"))}
                aria-describedby={settingsErrorWithin("frames")
                  ? "site-frames-help site-frames-error"
                  : "site-frames-help"}
                rows="3"
                value={settings.frames.join("\n")}
                oninput={(event) =>
                  (settings!.frames = event.currentTarget.value
                    .split(/\n/)
                    .map((value) => value.trim())
                    .filter(Boolean))}></textarea>
              <small id="site-frames-help" class="field-help"
                >One HTTPS origin per line. These sites may be embedded in Post
                custom content.</small
              >
              {#if settingsErrorWithin("frames")}
                <small id="site-frames-error" class="field-error" role="alert"
                  >{settingsErrorWithin("frames")}</small
                >
              {/if}</label
            >
          </section>
          <section>
            <h2>Navigation</h2>
            <p class="settings-section-description">
              Links shown in the Published Site header.
            </p>
            {#each settings.navigation as item, index (index)}
              <div class="pair">
                <div class="pair-field">
                  <input
                    aria-label={`Navigation ${index + 1} label`}
                    placeholder="Label"
                    bind:value={item.label}
                    aria-invalid={Boolean(
                      settingsError(`navigation.${index}.label`),
                    )}
                    aria-describedby={settingsError(`navigation.${index}.label`)
                      ? `navigation-${index}-label-error`
                      : undefined}
                  />
                  {#if settingsError(`navigation.${index}.label`)}
                    <small
                      id={`navigation-${index}-label-error`}
                      class="field-error"
                      role="alert"
                      >{settingsError(`navigation.${index}.label`)}</small
                    >
                  {/if}
                </div>
                <div class="pair-field">
                  <input
                    aria-label={`Navigation ${index + 1} URL`}
                    placeholder="URL or path"
                    bind:value={item.href}
                    aria-invalid={Boolean(
                      settingsError(`navigation.${index}.href`),
                    )}
                    aria-describedby={settingsError(`navigation.${index}.href`)
                      ? `navigation-${index}-href-error`
                      : undefined}
                  />
                  {#if settingsError(`navigation.${index}.href`)}
                    <small
                      id={`navigation-${index}-href-error`}
                      class="field-error"
                      role="alert"
                      >{settingsError(`navigation.${index}.href`)}</small
                    >
                  {/if}
                </div>
                {@render removeRowButton(
                  `Remove navigation link ${index + 1}${item.label.trim() ? `: ${item.label}` : ""}`,
                  () => settings!.navigation.splice(index, 1),
                )}
              </div>
            {/each}
            <button
              disabled={settings.navigation.length >= 12}
              onclick={() =>
                settings!.navigation.push({ label: "", href: "/" })}
              >Add link</button
            >
            {#if settingsError("navigation")}
              <small class="field-error" role="alert"
                >{settingsError("navigation")}</small
              >
            {/if}
            <h2>Social links</h2>
            <p id="social-links-help" class="settings-section-description">
              These links appear as icons in the Published Site footer. Link
              name is the icon’s accessible name and hover text; it also helps
              Auto-detect choose an icon.
            </p>
            {#each settings.socialLinks as item, index (index)}
              <div class="pair social-pair">
                <div class="pair-field">
                  <input
                    aria-label={`Social ${index + 1} link name`}
                    placeholder="Link name"
                    bind:value={item.label}
                    aria-invalid={Boolean(
                      settingsError(`socialLinks.${index}.label`),
                    )}
                    aria-describedby={settingsError(
                      `socialLinks.${index}.label`,
                    )
                      ? `social-links-help social-${index}-label-error`
                      : "social-links-help"}
                  />
                  {#if settingsError(`socialLinks.${index}.label`)}
                    <small
                      id={`social-${index}-label-error`}
                      class="field-error"
                      role="alert"
                      >{settingsError(`socialLinks.${index}.label`)}</small
                    >
                  {/if}
                </div>
                <div class="pair-field">
                  <input
                    aria-label={`Social ${index + 1} URL`}
                    placeholder="https://…"
                    bind:value={item.href}
                    aria-invalid={Boolean(
                      settingsError(`socialLinks.${index}.href`),
                    )}
                    aria-describedby={settingsError(`socialLinks.${index}.href`)
                      ? `social-${index}-href-error`
                      : undefined}
                  />
                  {#if settingsError(`socialLinks.${index}.href`)}
                    <small
                      id={`social-${index}-href-error`}
                      class="field-error"
                      role="alert"
                      >{settingsError(`socialLinks.${index}.href`)}</small
                    >
                  {/if}
                </div>
                <select
                  aria-label={`Social ${index + 1} icon`}
                  bind:value={item.icon}
                >
                  {#each socialIconNames as icon (icon)}
                    <option value={icon}
                      >{icon === "auto"
                        ? "Auto-detect"
                        : icon === "link"
                          ? "Generic link"
                          : icon}</option
                    >
                  {/each}
                </select>
                {@render removeRowButton(
                  `Remove social link ${index + 1}${item.label.trim() ? `: ${item.label}` : ""}`,
                  () => settings!.socialLinks.splice(index, 1),
                )}
              </div>
            {/each}
            <button
              disabled={settings.socialLinks.length >= 20}
              onclick={() =>
                settings!.socialLinks.push({
                  label: "",
                  href: "https://",
                  icon: "auto",
                })}>Add social link</button
            >
            {#if settingsError("socialLinks")}
              <small class="field-error" role="alert"
                >{settingsError("socialLinks")}</small
              >
            {/if}
          </section>
          <section>
            <h2>Comments</h2>
            <p class="settings-section-description">
              Optional public comments powered by GitHub Discussions and
              <a href="https://giscus.app/" target="_blank" rel="noreferrer"
                >giscus</a
              >. Disabled sites publish no Comments code or requests.
            </p>
            <label class="check comments-toggle"
              ><input
                type="checkbox"
                checked={settings.comments?.enabled ?? false}
                onchange={(event) =>
                  setCommentsEnabled(event.currentTarget.checked)}
              /> Enable comments</label
            >
            {#if settings.comments}
              <div class="comments-summary">
                <strong>{settings.comments.repository}</strong>
                <span>{settings.comments.category} Discussions</span>
              </div>
              {#if !settings.comments.enabled}
                <small class="field-help">
                  Configuration and Comment Keys are preserved. Existing GitHub
                  Discussions are unchanged.
                </small>
              {/if}
              {#if settings.comments.enabled && missingCommentKeys}
                <p class="setup-note">
                  Saving will add immutable Comment Keys to
                  {missingCommentKeys} published
                  {missingCommentKeys === 1 ? " Post" : " Posts"}.
                </p>
              {/if}
              <label class="check"
                ><input
                  type="checkbox"
                  bind:checked={settings.comments.requireConsent}
                /> Ask readers before loading GitHub content</label
              >
              <small class="field-help">
                Recommended. Readers can also choose “Always load comments on
                this site.”
              </small>
              <label class="check"
                ><input type="checkbox" bind:checked={settings.comments.lazy} /> Lazy-load
                the comments frame</label
              >
              <label class="check"
                ><input
                  type="checkbox"
                  bind:checked={settings.comments.reactions}
                /> Show reactions above comments</label
              >
              <label
                >Comment box position
                <select bind:value={settings.comments.inputPosition}>
                  <option value="bottom">Below comments</option>
                  <option value="top">Above comments</option>
                </select></label
              >
              <div class="comments-actions">
                <button type="button" onclick={beginCommentsSetup}
                  >Change repository</button
                >
                <button
                  type="button"
                  disabled={testingComments}
                  onclick={testCommentsConnection}
                  >{testingComments ? "Testing…" : "Test connection"}</button
                >
                <a
                  href={`https://github.com/${settings.comments.repository}/discussions`}
                  target="_blank"
                  rel="noreferrer">Open Discussions</a
                >
              </div>
              {#if commentConnectionStatus}
                <p class="field-help" role="status">
                  {commentConnectionStatus}
                </p>
              {/if}
              {#if savedSettings && settings.domain !== savedSettings.domain}
                <p class="setup-note">
                  Canonical domain changed. Update <code>giscus.json</code> in the
                  Comments repository after saving.
                </p>
              {/if}
              <details>
                <summary>Optional giscus.json origin restriction</summary>
                <p class="field-help">
                  Add this file to the Comments repository root to restrict
                  which site may use it.
                </p>
                {#if commentsCanonicalOrigin}
                  <pre>{JSON.stringify(
                      {
                        origins: [commentsCanonicalOrigin],
                        originsRegex: [
                          "^http://localhost:[0-9]+$",
                          "^http://127\\.0\\.0\\.1:[0-9]+$",
                        ],
                        defaultCommentOrder: "oldest",
                      },
                      null,
                      2,
                    )}</pre>
                  <small class="field-help">
                    Localhost is included so the development preview can load
                    comments.
                  </small>
                {:else}
                  <small class="field-error" role="alert">
                    Enter a valid HTTPS Canonical domain to generate this file.
                  </small>
                {/if}
              </details>
              <button
                type="button"
                class="destructive-outline"
                disabled={settingsDirty || busy}
                onclick={openRemoveCommentsDialog}>Remove Comments setup</button
              >
              {#if settingsDirty}
                <small class="field-help">
                  Save or discard other Settings changes before full removal.
                </small>
              {/if}
            {/if}

            {#if commentsSetupOpen}
              <div class="comments-setup" aria-label="Comments setup">
                <h3>Connect a GitHub repository</h3>
                <p>
                  Use any public repository you own. Enable Discussions and
                  install the giscus app for that repository first.
                </p>
                {#if settings.comments}
                  <p class="setup-note">
                    Changing repository does not move existing Discussions.
                    Posts will look for their Comment Keys in the new
                    repository.
                  </p>
                {/if}
                <div class="setup-links">
                  <a
                    href="https://github.com/new"
                    target="_blank"
                    rel="noreferrer">Create a public repository</a
                  >
                  <a
                    href="https://github.com/apps/giscus/installations/new"
                    target="_blank"
                    rel="noreferrer">Install giscus</a
                  >
                  <a
                    href="https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository#enabling-or-disabling-github-discussions-for-a-repository"
                    target="_blank"
                    rel="noreferrer">Enable Discussions</a
                  >
                </div>
                <button
                  type="button"
                  class="quiet"
                  onclick={() => (commentsSetupOpen = false)}
                  >Cancel setup</button
                >
                <label
                  >Repository
                  <input
                    placeholder="owner/repository"
                    autocomplete="off"
                    value={commentRepository}
                    oninput={(event) => {
                      commentRepository = event.currentTarget.value;
                      commentCategories = [];
                      commentCategoryId = "";
                      commentRepositoryId = "";
                    }}
                  /></label
                >
                <button
                  type="button"
                  class="primary"
                  disabled={!commentRepository.trim() || discoveringComments}
                  onclick={discoverComments}
                  >{discoveringComments
                    ? "Checking…"
                    : "Connect repository"}</button
                >
                {#if commentCategories.length}
                  <label
                    >Discussion category
                    <select bind:value={commentCategoryId}>
                      <option value="">Choose a category</option>
                      {#each commentCategories as category (category.id)}
                        <option value={category.id}>{category.name}</option>
                      {/each}
                    </select></label
                  >
                  <button
                    type="button"
                    disabled={!commentCategoryId}
                    onclick={() => useCommentsCategory()}>Use category</button
                  >
                {/if}
                {#if commentSetupError}
                  <p class="field-error" role="alert">{commentSetupError}</p>
                {/if}
                <details>
                  <summary>Repository lookup not working?</summary>
                  <p class="field-help">
                    Configure giscus at giscus.app, then paste its generated
                    script here. Only official giscus.app scripts are accepted.
                  </p>
                  <textarea
                    rows="7"
                    spellcheck="false"
                    placeholder="Paste the generated giscus embed code"
                    bind:value={commentScript}></textarea>
                  <button
                    type="button"
                    disabled={!commentScript.trim() || parsingComments}
                    onclick={parseCommentsScript}
                    >{parsingComments ? "Reading…" : "Use pasted setup"}</button
                  >
                </details>
              </div>
            {:else if !settings.comments}
              <small class="field-help">
                Turning this on starts setup. Nothing changes on the Published
                Site until setup is saved.
              </small>
            {/if}
          </section>
          <section>
            <h2>Robots and discovery</h2>
            <p class="settings-section-description">
              Control search indexing, link following, and AI-training
              preferences. The preview updates immediately.
            </p>
            <label class="check"
              ><input type="checkbox" bind:checked={settings.robots.index} /> Allow
              search indexing</label
            >
            <label class="check"
              ><input type="checkbox" bind:checked={settings.robots.follow} /> Allow
              following links</label
            >
            <div class="check-help-row">
              <label class="check"
                ><input
                  type="checkbox"
                  aria-describedby="ai-training-help ai-training-limitations"
                  bind:checked={settings.robots.allowAiTraining}
                /> Allow AI training crawlers</label
              >
              {@render helpTooltip(
                "ai-training-limitations",
                "Why is AI training blocking best effort?",
                "Best effort only. No universal, enforced training-only block exists; crawler names change, and bots may ignore or disguise themselves. This blocks known training and dataset crawlers while leaving AI search and user-requested fetchers available for discovery.",
              )}
            </div>
            <small id="ai-training-help" class="field-help"
              >When off, publishes a general AI-training opt-out, blocks known
              training and dataset crawlers, and reserves text-and-data-mining
              rights.</small
            >
            <label
              >Advanced rules <textarea
                aria-invalid={Boolean(settingsError("robots.advancedRules"))}
                aria-describedby={settingsError("robots.advancedRules")
                  ? "advanced-rules-help advanced-rules-error"
                  : "advanced-rules-help"}
                rows="6"
                bind:value={settings.robots.advancedRules}></textarea>
              <small id="advanced-rules-help" class="field-help"
                >Optional robots.txt directives appended below the generated
                rules.</small
              >
              {#if settingsError("robots.advancedRules")}
                <small
                  id="advanced-rules-error"
                  class="field-error"
                  role="alert">{settingsError("robots.advancedRules")}</small
                >
              {/if}</label
            >
            <h3>robots.txt preview</h3>
            <pre>{robotsText(settings)}</pre>
          </section>
        </div>
        <dialog
          class="confirm-dialog"
          aria-labelledby="remove-comments-title"
          aria-describedby="remove-comments-description"
          bind:this={removeCommentsDialog}
        >
          <h2 id="remove-comments-title">Remove Comments setup?</h2>
          <div id="remove-comments-description">
            <p>
              This removes the giscus configuration and every immutable Comment
              Key from local Post files. Existing GitHub Discussions remain.
            </p>
            <p class="danger-note">
              Reconnecting later creates new Discussion mappings.
            </p>
          </div>
          <label
            >Type <code>REMOVE COMMENTS</code> to confirm
            <input autocomplete="off" bind:value={removeCommentsConfirmation} />
          </label>
          <div class="confirm-actions">
            <button
              type="button"
              data-cancel
              disabled={removingComments}
              onclick={() => removeCommentsDialog?.close()}>Cancel</button
            >
            <button
              type="button"
              class="destructive"
              disabled={removeCommentsConfirmation !== "REMOVE COMMENTS" ||
                removingComments}
              onclick={removeCommentsSetup}
              >{removingComments
                ? "Removing…"
                : "Remove Comments setup"}</button
            >
          </div>
        </dialog>
        <dialog
          class="media-dialog"
          aria-labelledby="default-social-dialog-title"
          bind:this={defaultSocialImageDialog}
        >
          <div class="dialog-head">
            <div>
              <h2 id="default-social-dialog-title">
                Choose default social image
              </h2>
              <small>All imported media, newest first.</small>
            </div>
            <button
              type="button"
              aria-label="Close default social image gallery"
              onclick={() => defaultSocialImageDialog?.close()}>×</button
            >
          </div>
          <MediaGallery
            assets={globalMedia}
            selectedIds={selectedDefaultSocialMedia
              ? [selectedDefaultSocialMedia.id]
              : []}
            defaultChoice={{
              label: "No default social image",
              selected: !settings.defaultSocialImage,
            }}
            ondefaultselect={() => chooseDefaultSocialImage(null)}
            onselect={chooseDefaultSocialImage}
          />
          {#if !globalMedia.length}<p>No imported media yet.</p>{/if}
        </dialog>
      </main>
    {/if}
  </div>
{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }
  :global(:root) {
    color-scheme: light;
    font-family: ui-sans-serif, system-ui, sans-serif;
    --bg: #f2f0e5;
    --panel: #fffcf0;
    --text: #100f0f;
    --muted: #676660;
    --border: #cecdc3;
    --accent-base: #bc5215;
    --accent: var(--accent-light, var(--accent-base));
    --accent-contrast: #fffcf0;
    --danger: #af3029;
    --success: #566b0b;
    --ready: #205ea6;
    --unreleased: #725f00;
    background: var(--bg);
    color: var(--text);
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme])) {
      color-scheme: dark;
      --bg: #100f0f;
      --panel: #1c1b1a;
      --text: #cecdc3;
      --muted: #878580;
      --border: #403e3c;
      --accent: var(
        --accent-dark,
        color-mix(in srgb, var(--accent-base) 78%, #fffcf0)
      );
      --danger: #e46b61;
      --success: #879a39;
      --ready: #4f91ca;
      --unreleased: #d0a215;
    }
  }
  :global(:root[data-theme="dark"]) {
    color-scheme: dark;
    --bg: #100f0f;
    --panel: #1c1b1a;
    --text: #cecdc3;
    --muted: #878580;
    --border: #403e3c;
    --accent: var(
      --accent-dark,
      color-mix(in srgb, var(--accent-base) 78%, #fffcf0)
    );
    --danger: #e46b61;
    --success: #879a39;
    --ready: #4f91ca;
    --unreleased: #d0a215;
  }
  :global(:root[data-theme="light"]) {
    color-scheme: light;
  }
  .app {
    --accent: var(--accent-light, var(--accent-base));
  }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme])) .app {
      --accent: var(
        --accent-dark,
        color-mix(in srgb, var(--accent-base) 78%, #fffcf0)
      );
    }
  }
  :global(:root[data-theme="dark"]) .app {
    --accent: var(
      --accent-dark,
      color-mix(in srgb, var(--accent-base) 78%, #fffcf0)
    );
  }
  @media (forced-colors: active) {
    :global(:root:not([data-theme])),
    :global(:root[data-theme]) {
      color-scheme: light dark;
      --bg: Canvas;
      --panel: Canvas;
      --text: CanvasText;
      --muted: GrayText;
      --border: ButtonBorder;
      --accent-base: AccentColor;
      --accent: AccentColor;
      --accent-contrast: AccentColorText;
      --danger: CanvasText;
      --success: CanvasText;
      --ready: CanvasText;
      --unreleased: CanvasText;
    }
    .app {
      --accent-base: AccentColor !important;
      --accent: AccentColor;
      --accent-contrast: AccentColorText !important;
    }
    .theme-selector {
      display: none !important;
    }
  }
  :global(body) {
    margin: 0;
    padding-inline: env(safe-area-inset-left) env(safe-area-inset-right);
  }
  :global(button),
  :global(input),
  :global(textarea),
  :global(select) {
    font: inherit;
  }
  :global(button),
  :global(input),
  :global(textarea),
  :global(select) {
    color: inherit;
  }
  :global(button) {
    cursor: pointer;
  }
  :global(:focus-visible) {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .skip-link {
    position: fixed;
    z-index: 50;
    inset-block-start: 0.6rem;
    inset-inline-start: -999rem;
    padding: 0.65rem 0.85rem;
    color: var(--text);
    background: var(--panel);
    border: 1px solid var(--border);
  }
  .skip-link:focus {
    inset-inline-start: 0.6rem;
  }
  .loading,
  .empty {
    padding: 3rem;
  }
  .topbar {
    position: sticky;
    z-index: 20;
    top: 0;
    height: 3.6rem;
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .cms-brand {
    min-width: 0;
    max-width: min(20rem, 32vw);
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    white-space: nowrap;
  }
  .cms-brand strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cms-brand-context {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 500;
  }
  .topbar nav {
    display: flex;
    gap: 0.15rem;
    padding: 0.15rem 0.3rem;
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    box-shadow: 0 0.2rem 0.65rem
      color-mix(in srgb, var(--text) 10%, transparent);
  }
  .topbar nav button {
    border: 0;
    border-radius: 8px;
    background: none;
    padding: 0.55rem 0.7rem;
  }
  .topbar nav button.active {
    box-shadow: inset 0 -3px var(--accent);
  }
  .topbar a {
    margin-left: auto;
    color: var(--accent);
  }
  .theme-selector {
    display: flex;
    gap: 0.15rem;
    margin: 0;
    padding: 0.15rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--bg);
  }
  .theme-selector label {
    position: relative;
    display: block;
    padding: 0.25rem 0.5rem;
    border-radius: 0.22rem;
    color: var(--muted);
    cursor: pointer;
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .theme-selector label:has(input:checked) {
    color: var(--text);
    background: color-mix(in srgb, var(--accent) 18%, var(--panel));
    box-shadow: inset 0 -3px var(--accent);
  }
  .theme-selector label:focus-within {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .theme-selector input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .recovery-panel {
    display: grid;
    gap: 1rem;
    padding: 1rem;
    margin-bottom: 1rem;
    border: 2px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, var(--panel));
  }
  .recovery-head,
  .recovery-body-head {
    display: flex;
    gap: 0.7rem;
    align-items: center;
  }
  .recovery-head {
    justify-content: space-between;
    align-items: start;
  }
  .recovery-head h2,
  .recovery-head p,
  .recovery-version h3 {
    margin: 0;
  }
  .recovery-head small {
    color: var(--muted);
  }
  .recovery-compare {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }
  .recovery-version {
    min-width: 0;
    padding: 1rem;
    border: 1px solid var(--border);
    background: var(--panel);
  }
  .recovery-version > header {
    margin-bottom: 0.8rem;
  }
  .recovery-body-head {
    justify-content: space-between;
  }
  .recovery-version dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem 1rem;
    margin: 0 0 0.8rem;
  }
  .recovery-version dl > div {
    min-width: 0;
  }
  .recovery-version dt {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .recovery-version dd {
    overflow-wrap: anywhere;
    margin: 0;
  }
  .recovery-description {
    grid-column: 1 / -1;
  }
  .recovery-body pre {
    overflow: auto;
    max-height: 18rem;
    margin: 0.35rem 0 0;
    padding: 0.8rem;
    white-space: pre-wrap;
    background: var(--bg);
  }
  .notifications {
    position: fixed;
    z-index: 30;
    top: 4.35rem;
    right: 1rem;
    display: grid;
    gap: 0.65rem;
    width: min(24rem, calc(100vw - 2rem));
    pointer-events: none;
  }
  .toast {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    display: flex;
    align-items: start;
    gap: 0.8rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--border);
    border-left-width: 0.35rem;
    border-radius: 0.35rem;
    color: var(--text);
    background: var(--panel);
    box-shadow: 0 0.6rem 1.8rem rgb(0 0 0 / 24%);
    pointer-events: auto;
  }
  .toast span {
    position: relative;
    z-index: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .toast button {
    position: relative;
    z-index: 1;
    margin-left: auto;
    padding: 0 0.2rem;
    border: 0;
    color: inherit;
    background: transparent;
    font-size: 1.2rem;
    line-height: 1;
    pointer-events: auto;
  }
  .toast-error {
    border-left-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, var(--panel));
    pointer-events: auto;
  }
  .toast-error span {
    cursor: text;
    user-select: text;
  }
  .toast-success {
    border-left-color: var(--success);
    background: color-mix(in srgb, var(--success) 6%, var(--panel));
  }
  .toast-success::before {
    content: "";
    position: absolute;
    z-index: 0;
    inset: 0;
    pointer-events: none;
    background: color-mix(in srgb, var(--success) 12%, transparent);
    transform: scaleX(0);
    transform-origin: left;
    will-change: transform;
    animation: toast-expiry 5s linear forwards;
  }
  @keyframes toast-expiry {
    to {
      transform: scaleX(1);
    }
  }
  .workspace {
    min-height: calc(100vh - 3.6rem);
    display: grid;
    grid-template-columns: 18rem minmax(0, 1fr);
  }
  .sidebar {
    position: sticky;
    top: 3.6rem;
    align-self: start;
    height: calc(100vh - 3.6rem);
    height: calc(100svh - 3.6rem);
    padding: 1rem;
    border-right: 1px solid var(--border);
    background: var(--panel);
    overflow: auto;
  }
  .post-browser > summary {
    display: none;
  }
  .primary {
    border: 0;
    border-radius: 0.25rem;
    padding: 0.65rem 1rem;
    color: var(--accent-contrast);
    background: var(--accent-base);
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  label {
    display: grid;
    gap: 0.3rem;
    color: var(--muted);
    font-size: 0.86rem;
  }
  .field {
    display: grid;
    align-content: start;
    gap: 0.3rem;
    color: var(--muted);
    font-size: 0.86rem;
  }
  .field-label-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .check-help-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .field-label-row > label {
    display: inline;
  }
  .tooltip-wrap {
    position: relative;
    display: inline-flex;
  }
  .tooltip-trigger {
    display: grid;
    width: 1.2rem;
    height: 1.2rem;
    place-items: center;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--muted);
    background: var(--panel);
    font-size: 0.75rem;
    line-height: 1;
  }
  .tooltip-text {
    position: absolute;
    z-index: 10;
    top: calc(100% + 0.4rem);
    left: 0;
    width: min(16rem, calc(100vw - 2rem));
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    visibility: hidden;
    opacity: 0;
    color: var(--text);
    background: var(--panel);
    box-shadow: 0 0.35rem 1.2rem rgb(0 0 0 / 18%);
    pointer-events: none;
  }
  .tooltip-trigger:hover + .tooltip-text,
  .tooltip-trigger:focus-visible + .tooltip-text {
    visibility: visible;
    opacity: 1;
  }
  .fields .tooltip-text {
    right: 0;
    left: auto;
  }
  input,
  textarea,
  select {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 0.2rem;
    background: var(--panel);
    padding: 0.55rem;
  }
  .check {
    display: flex;
    flex-direction: row;
    align-items: center;
  }
  .check input {
    width: auto;
  }
  .quiet {
    justify-self: start;
    border: 0;
    padding: 0;
    color: var(--accent);
    background: transparent;
    text-decoration: underline;
  }
  .post-menu {
    list-style: none;
    margin: 1rem 0;
    padding: 0;
  }
  .post-menu button {
    width: 100%;
    display: grid;
    gap: 0.2rem;
    text-align: left;
    padding: 0.7rem;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
  }
  .post-menu button:hover,
  .post-menu button.selected {
    background: var(--bg);
  }
  .post-menu-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .post-menu small {
    color: var(--muted);
  }
  .post-status {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    padding: 0.08rem 0.4rem;
    border: 1px solid currentColor;
    border-radius: 999px;
    font-size: 0.68rem;
    font-weight: 700;
    line-height: 1.45;
  }
  .post-status[data-status="Draft"] {
    color: var(--muted);
    background: color-mix(in srgb, var(--muted) 10%, var(--panel));
  }
  .post-status[data-status="Ready"] {
    color: var(--ready);
    background: color-mix(in srgb, var(--ready) 12%, var(--panel));
  }
  .post-status[data-status="Unreleased"] {
    color: var(--unreleased);
    background: color-mix(in srgb, var(--unreleased) 13%, var(--panel));
  }
  .post-status[data-status="Published"] {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 12%, var(--panel));
  }
  details pre {
    white-space: pre-wrap;
    font-size: 0.76rem;
  }
  .editor-pane {
    min-width: 0;
    padding: 1.2rem;
  }
  .editor-head {
    display: flex;
    flex-wrap: nowrap;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    margin-bottom: 1.2rem;
  }
  .editor-head > :first-child {
    min-width: 0;
    flex: 1 1 0;
  }
  h1,
  h2,
  h3,
  p {
    margin-top: 0;
  }
  .editor-head h1 {
    margin-bottom: 0.2rem;
    overflow-wrap: anywhere;
  }
  .editor-actions {
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .editor-actions a {
    color: var(--accent);
  }
  .secondary-action {
    padding: 0.65rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    color: var(--text);
    background: var(--panel);
  }
  .secondary-action:hover:not(:disabled) {
    background: var(--bg);
  }
  .delete-post-button {
    width: 100%;
    margin-top: 2rem;
    padding: 0.8rem 1rem;
    border: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border));
    border-radius: 0.3rem;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, var(--panel));
    text-align: center;
  }
  .delete-post-button:hover {
    background: color-mix(in srgb, var(--danger) 16%, var(--panel));
  }
  .publication-requirements {
    margin: -0.65rem 0 0.8rem;
    color: var(--muted);
    font-size: 0.85rem;
    text-align: right;
  }
  .fields [aria-invalid="true"],
  .post-title [aria-invalid="true"] {
    border-color: var(--danger);
    outline: 2px solid color-mix(in srgb, var(--danger) 35%, transparent);
    outline-offset: 1px;
  }
  .fields .field-error,
  .editor-head .field-error {
    color: var(--danger);
  }
  .publication-control {
    display: flex;
    align-items: center;
  }
  .publication-state {
    display: flex;
    margin: 0;
    padding: 0.2rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--bg);
  }
  .publication-state legend {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .publication-state label {
    position: relative;
    display: block;
    padding: 0.4rem 0.7rem;
    border-radius: 0.22rem;
    color: var(--muted);
    cursor: pointer;
  }
  .publication-state label[data-active="true"] {
    color: var(--accent-contrast);
    background: var(--accent-base);
  }
  .publication-state label:focus-within {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .publication-state input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-template-areas:
      "description description slug tags"
      "description description published updated"
      "description description social aliases";
    gap: 0.7rem;
    align-items: start;
    margin-bottom: 1rem;
  }
  .fields > label,
  .fields > .field {
    line-height: 1.2rem;
  }
  .post-title textarea {
    display: block;
    min-width: 0;
    min-height: 2.75rem;
    padding: 0;
    border-color: transparent;
    background: transparent;
    font: inherit;
    line-height: inherit;
    field-sizing: content;
    resize: vertical;
    overflow-wrap: anywhere;
  }
  .post-title textarea:hover,
  .post-title textarea:focus {
    border-color: var(--border);
  }
  .post-title textarea::placeholder {
    color: var(--muted);
    opacity: 1;
  }
  .editor-head .field-error {
    display: block;
  }
  .post-description {
    grid-area: description;
  }
  .post-slug {
    grid-area: slug;
  }
  .post-tags {
    grid-area: tags;
  }
  .post-published {
    grid-area: published;
  }
  .post-updated {
    grid-area: updated;
  }
  .post-aliases {
    grid-area: aliases;
  }
  .social-media {
    grid-area: social;
    min-width: 0;
    margin: 0;
    padding: 0.7rem;
    border: 1px solid var(--border);
  }
  .social-media legend {
    padding-inline: 0.25rem;
    color: var(--muted);
    font-size: 0.86rem;
  }
  .social-image-trigger {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    max-width: 22rem;
    padding: 0.45rem;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    color: var(--text);
    background: var(--panel);
    text-align: left;
  }
  .social-image-trigger img {
    display: block;
    width: 5rem;
    height: 3.75rem;
    max-width: 35%;
    object-fit: contain;
    background: var(--bg);
  }
  .social-image-trigger span {
    display: grid;
    min-width: 0;
    gap: 0.2rem;
  }
  .social-image-trigger strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .media-dialog {
    width: min(56rem, calc(100vw - 2rem));
    max-height: min(48rem, calc(100vh - 2rem));
    box-sizing: border-box;
    overflow: auto;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    color: var(--text);
    background: var(--panel);
    box-shadow: 0 1rem 4rem rgb(0 0 0 / 30%);
  }
  .media-dialog::backdrop {
    background: rgb(0 0 0 / 55%);
  }
  .confirm-dialog {
    width: min(30rem, calc(100vw - 2rem));
    box-sizing: border-box;
    padding: 1.25rem;
    border: 1px solid var(--danger);
    border-radius: 0.35rem;
    color: var(--text);
    background: var(--panel);
    box-shadow: 0 1rem 4rem rgb(0 0 0 / 30%);
  }
  .confirm-dialog::backdrop {
    background: rgb(0 0 0 / 65%);
  }
  .confirm-dialog h2 {
    color: var(--danger);
  }
  .danger-note {
    color: var(--danger);
    font-weight: 600;
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.7rem;
    margin-top: 1.25rem;
  }
  .destructive {
    border-color: var(--danger);
    color: white;
    background: var(--danger);
  }
  .destructive:hover {
    background: color-mix(in srgb, var(--danger) 85%, black);
  }
  .dialog-head {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 1rem;
    margin-bottom: 0.8rem;
  }
  .dialog-head h2 {
    margin-bottom: 0.2rem;
  }
  .dialog-head small {
    color: var(--muted);
  }
  .dialog-head > button {
    border: 0;
    padding: 0.25rem 0.55rem;
    background: transparent;
    font-size: 1.4rem;
  }
  .media-dialog .field-error {
    color: var(--danger);
  }
  .body-editor {
    min-width: 0;
  }
  .editor-lock-frame {
    position: relative;
  }
  .editor-lock[inert] {
    opacity: 0.55;
    cursor: wait;
  }
  .editor-lock-overlay {
    position: absolute;
    z-index: 4;
    inset: 0;
    display: grid;
    place-items: center;
    cursor: wait;
    background: color-mix(in srgb, var(--panel) 35%, transparent);
  }
  .editor-lock-overlay span {
    padding: 0.7rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    color: var(--text);
    background: var(--panel);
    box-shadow: 0 0.35rem 1.25rem rgb(0 0 0 / 18%);
    font-size: 0.9rem;
    font-weight: 600;
  }
  .editor-tabs {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.6rem;
  }
  .editor-tabs button {
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--border);
    background: var(--panel);
  }
  .editor-tabs button[aria-selected="true"] {
    border-color: var(--accent);
    box-shadow: inset 0 -3px var(--accent);
  }
  .markdown {
    min-height: 42rem;
    resize: vertical;
    font:
      0.92rem/1.55 ui-monospace,
      monospace;
  }
  .image-drop {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem;
    align-items: end;
    margin-top: 0.7rem;
    padding: 0.8rem;
    border: 1px dashed var(--border);
  }
  .image-import-heading {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .image-import-heading h2 {
    margin: 0;
    font-size: 1rem;
  }
  .image-layout {
    grid-column: 1 / -1;
    display: flex;
    gap: 1rem;
    margin: 0;
    padding: 0.6rem;
    border: 1px solid var(--border);
  }
  .media-library {
    grid-column: 1 / -1;
    min-width: 0;
    padding: 0.7rem;
    border: 1px solid var(--border);
    background: var(--panel);
  }
  .media-library[data-invalid="true"] {
    border-color: var(--danger);
  }
  .chosen-media {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.55rem;
    border: 1px solid var(--border);
    border-radius: 0.2rem;
    color: var(--muted);
    background: var(--panel);
  }
  .image-item {
    display: grid;
    gap: 0.55rem;
    padding: 0.7rem;
    border: 1px solid var(--border);
    background: var(--bg);
  }
  .image-item-single {
    grid-column: 1 / -1;
  }
  .post-image-dropzone {
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.35rem;
    min-width: 0;
    min-height: 8rem;
    padding: 0.8rem;
    border: 2px dashed var(--border);
    border-radius: 0.35rem;
    background: var(--panel);
    text-align: center;
  }
  .post-image-dropzone.drag-active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--panel));
  }
  .post-image-dropzone[data-invalid="true"] {
    border-color: var(--danger);
  }
  .post-image-dropzone small {
    overflow-wrap: anywhere;
  }
  .image-caption,
  .import-actions {
    grid-column: 1 / -1;
  }
  .image-caption {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
  }
  .caption-full,
  .caption-toggle {
    grid-column: 1 / -1;
  }
  .caption-toggle {
    justify-self: start;
  }
  .import-actions {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.75rem;
    align-items: center;
  }
  .import-progress {
    display: grid;
    grid-template-columns: auto minmax(4rem, 1fr);
    gap: 0.65rem;
    align-items: center;
    color: var(--muted);
  }
  .import-progress span {
    white-space: nowrap;
  }
  .import-progress progress {
    width: 100%;
  }
  .image-drop small {
    grid-column: 1 / -1;
    color: var(--muted);
  }
  .pending-media p {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--muted);
  }
  .image-drop [aria-invalid="true"] {
    border-color: var(--danger);
    outline: 2px solid color-mix(in srgb, var(--danger) 35%, transparent);
    outline-offset: 1px;
  }
  .image-drop .field-error,
  .image-drop .validation-summary {
    color: var(--danger);
  }
  .conflict {
    padding: 1rem;
    margin-bottom: 1rem;
    border: 2px solid var(--danger);
  }
  .compare {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.7rem;
  }
  .compare pre {
    overflow: auto;
    padding: 0.7rem;
    background: var(--bg);
  }
  .settings {
    padding: 1.5rem;
    max-width: 90rem;
    margin: auto;
  }
  .media-manager {
    width: 100%;
    min-width: 0;
    max-width: 90rem;
    margin: auto;
    padding: 1.5rem;
  }
  .library-import {
    margin-bottom: 1.2rem;
    padding: 1rem;
    border: 1px solid var(--border);
    background: var(--panel);
  }
  .library-import-heading {
    margin-bottom: 0.8rem;
  }
  .library-import h2 {
    margin-bottom: 0.2rem;
  }
  .library-dropzone {
    min-height: 10rem;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.55rem;
    padding: 1.2rem;
    border: 2px dashed var(--border);
    border-radius: 0.35rem;
    background: var(--bg);
    text-align: center;
  }
  .library-dropzone.drag-active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  }
  .library-dropzone small,
  .library-selected-file small {
    color: var(--muted);
  }
  .library-selected-file {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.8rem 1rem;
    align-items: end;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--bg);
  }
  .library-selected-file > div:first-child {
    min-width: 0;
    display: grid;
    gap: 0.2rem;
  }
  .library-selected-file strong {
    overflow-wrap: anywhere;
  }
  .library-selected-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
  }
  .library-selected-file .import-progress {
    grid-column: 1 / -1;
  }
  .media-manager > small {
    display: block;
    margin-top: 0.8rem;
    color: var(--muted);
  }
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.5rem;
  }
  .settings-conflict {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .settings-conflict p {
    margin: 0.25rem 0 0;
  }
  .settings section {
    display: grid;
    align-content: start;
    gap: 0.8rem;
    padding: 1rem;
    border: 1px solid var(--border);
    background: var(--panel);
  }
  .settings-section-description {
    margin: -0.45rem 0 0.2rem;
    color: var(--muted);
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .comments-toggle {
    padding: 0.75rem;
    border: 1px solid var(--border);
    background: var(--bg);
    font-weight: 650;
  }
  .comments-summary {
    display: grid;
    gap: 0.15rem;
    padding: 0.8rem;
    border: 1px solid var(--border);
    background: var(--bg);
  }
  .comments-summary span,
  .comments-setup p {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .comments-actions,
  .setup-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.7rem;
  }
  .comments-actions a,
  .setup-links a {
    color: var(--accent);
  }
  .comments-setup {
    display: grid;
    gap: 0.75rem;
    padding: 0.9rem;
    border: 1px solid var(--border);
    background: var(--bg);
  }
  .comments-setup h3,
  .comments-setup p {
    margin: 0;
  }
  .setup-note {
    margin: 0;
    padding: 0.7rem;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    background: color-mix(in srgb, var(--accent) 8%, var(--panel));
    font-size: 0.85rem;
  }
  .destructive-outline {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 55%, var(--border));
    background: transparent;
  }
  .settings-validation-summary {
    margin: 0 0 1rem;
    color: var(--danger);
  }
  .settings [aria-invalid="true"] {
    border-color: var(--danger);
    outline: 2px solid color-mix(in srgb, var(--danger) 35%, transparent);
    outline-offset: 1px;
  }
  .settings .field-error {
    color: var(--danger);
  }
  .field-help {
    color: var(--muted);
    font-size: 0.78rem;
    line-height: 1.4;
  }
  .accent-picker > span {
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }
  .accent-picker input[type="color"] {
    width: 4rem;
    height: 2.5rem;
    padding: 0.2rem;
    cursor: pointer;
  }
  .accent-picker code {
    color: var(--text);
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 2fr auto;
    gap: 0.4rem;
  }
  .pair-field {
    min-width: 0;
    display: grid;
    align-content: start;
    gap: 0.25rem;
  }
  .remove-row-button {
    width: 2.4rem;
    min-height: 2.4rem;
    display: grid;
    place-items: center;
    align-self: start;
    padding: 0.55rem;
    border: 1px solid color-mix(in srgb, var(--danger) 55%, var(--border));
    border-radius: 0.25rem;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, var(--panel));
  }
  .remove-row-button:hover {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 16%, var(--panel));
  }
  .remove-row-button svg {
    width: 1rem;
    height: 1rem;
  }
  .social-pair {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .social-pair + .social-pair {
    margin-top: 0.4rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--border);
  }
  .social-pair .pair-field {
    grid-column: 1 / -1;
  }
  .social-pair select {
    min-width: 8.5rem;
  }
  .settings pre {
    overflow: auto;
    white-space: pre-wrap;
    padding: 0.8rem;
    background: var(--bg);
  }
  kbd {
    font-size: 0.72rem;
  }
  @media (max-width: 70rem) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
    .fields {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-areas:
        "description description"
        "slug tags"
        "published updated"
        "social aliases";
    }
    .recovery-compare {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 48rem) {
    .topbar {
      height: auto;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      padding-block: 0.6rem;
    }
    .media-manager {
      padding: 1rem;
    }
    .library-selected-file,
    .library-selected-file .import-progress {
      grid-template-columns: 1fr;
    }
    .library-selected-file .import-progress span {
      white-space: normal;
    }
    .workspace {
      grid-template-columns: 1fr;
    }
    .sidebar {
      position: static;
      align-self: stretch;
      height: auto;
      padding: 0;
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
    .post-browser > summary {
      display: flex;
      min-height: 2.75rem;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.65rem 1rem;
      cursor: pointer;
      color: var(--accent);
      font-weight: 650;
    }
    .post-browser > summary small {
      overflow: hidden;
      color: var(--muted);
      font-weight: 400;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .post-browser:not([open]) > .post-browser-content {
      display: none;
    }
    .post-browser-content {
      max-height: min(65vh, 32rem);
      overflow: auto;
      padding: 0 1rem 1rem;
    }
    .editor-head {
      flex-direction: column;
      align-items: stretch;
    }
    .editor-head > :first-child {
      width: 100%;
      flex: none;
    }
    .editor-actions {
      width: 100%;
      justify-content: flex-start;
    }
    .publication-requirements {
      text-align: left;
    }
    .tooltip-text {
      right: 0;
      left: auto;
    }
    .fields {
      grid-template-columns: 1fr;
      grid-template-areas:
        "description"
        "slug"
        "tags"
        "published"
        "updated"
        "social"
        "aliases";
    }
    .image-drop {
      grid-template-columns: 1fr;
    }
    .image-caption {
      grid-template-columns: 1fr;
    }
    .editor-tabs {
      align-items: stretch;
      flex-wrap: wrap;
    }
    .recovery-head {
      align-items: stretch;
      flex-direction: column;
    }
  }
  @media (max-width: 32rem) {
    .topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "brand theme"
        "nav site";
      column-gap: 0.5rem;
    }
    .cms-brand {
      grid-area: brand;
      max-width: none;
    }
    .topbar nav {
      grid-area: nav;
    }
    .topbar > a {
      grid-area: site;
      justify-self: end;
      margin-left: 0;
    }
    .theme-selector {
      grid-area: theme;
    }
    .notifications {
      top: 6.8rem;
    }
  }
  @media (pointer: coarse) {
    :global(button),
    .topbar a,
    .theme-selector label,
    .quiet {
      min-height: 2.75rem;
    }
    .topbar a,
    .theme-selector label,
    .quiet {
      display: inline-flex;
      align-items: center;
    }
    .tooltip-trigger {
      width: 2.75rem;
      height: 2.75rem;
    }
    .remove-row-button {
      width: 2.75rem;
    }
  }
  @media (max-width: 32rem) and (pointer: coarse) {
    .notifications {
      top: 8.1rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(*) {
      scroll-behavior: auto !important;
      transition: none !important;
      animation: none !important;
    }
    .toast-success::before {
      transform: scaleX(1);
    }
  }
</style>
