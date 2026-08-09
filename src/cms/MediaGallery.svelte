<script lang="ts">
  import type { MediaAsset } from "./types";

  let {
    assets,
    selectedIds,
    maxSelections = 1,
    defaultChoice,
    onselect,
    ondefaultselect,
    candelete = () => false,
    ondelete,
  }: {
    assets: MediaAsset[];
    selectedIds: string[];
    maxSelections?: number;
    defaultChoice?: { label: string; src?: string | null; selected: boolean };
    onselect?: (asset: MediaAsset) => void;
    ondefaultselect?: () => void;
    candelete?: (asset: MediaAsset) => boolean;
    ondelete?: (asset: MediaAsset) => void;
  } = $props();
</script>

<div class="media-gallery">
  {#if defaultChoice && ondefaultselect}
    <article class="media-card">
      <button
        type="button"
        class="media-select"
        aria-pressed={defaultChoice.selected}
        onclick={ondefaultselect}
      >
        {#if defaultChoice.src}
          <img src={defaultChoice.src} sizes="10rem" alt="" />
        {:else}
          <span class="media-placeholder" aria-hidden="true"
            >No default image</span
          >
        {/if}
        <span title={defaultChoice.label}>{defaultChoice.label}</span>
        {#if defaultChoice.selected}<strong>Selected</strong>{/if}
      </button>
    </article>
  {/if}
  {#each assets as asset (asset.id)}
    {@const selection = selectedIds.indexOf(asset.id)}
    <article class="media-card">
      {#if onselect}
        <button
          type="button"
          class="media-select"
          aria-pressed={selection !== -1}
          disabled={selection === -1 && selectedIds.length >= maxSelections}
          onclick={() => onselect(asset)}
        >
          <img src={asset.src} srcset={asset.srcset} sizes="10rem" alt="" />
          <span title={asset.name}>{asset.name}</span>
          {#if selection !== -1}
            <strong
              >{maxSelections > 1
                ? `Image ${selection + 1}`
                : "Selected"}</strong
            >
          {/if}
        </button>
      {:else}
        <div class="media-select media-static">
          <img src={asset.src} srcset={asset.srcset} sizes="10rem" alt="" />
          <span title={asset.name}>{asset.name}</span>
        </div>
      {/if}
      {#if ondelete && candelete(asset)}
        <button
          type="button"
          class="media-delete"
          aria-label={`Delete ${asset.name}`}
          onclick={() => ondelete(asset)}>Delete</button
        >
      {/if}
    </article>
  {/each}
</div>

<style>
  .media-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(8rem, 100%), 1fr));
    gap: 0.65rem;
    min-width: 0;
  }
  .media-card {
    display: grid;
    min-width: 0;
    max-width: 100%;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    overflow: hidden;
    background: var(--bg);
  }
  .media-select {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    padding: 0.45rem;
    border: 0;
    color: var(--text);
    background: transparent;
    text-align: left;
  }
  .media-select[aria-pressed="true"] {
    box-shadow: inset 0 0 0 3px var(--accent);
  }
  .media-static {
    cursor: default;
  }
  img,
  .media-placeholder {
    display: block;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    aspect-ratio: 4 / 3;
    object-fit: contain;
    background: var(--panel);
  }
  .media-placeholder {
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: 0.8rem;
    text-align: center;
    white-space: normal;
  }
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  strong {
    color: var(--accent);
    font-size: 0.8rem;
  }
  .media-delete {
    border: 0;
    border-top: 1px solid var(--border);
    padding: 0.4rem;
    color: var(--danger);
    background: transparent;
  }
</style>
