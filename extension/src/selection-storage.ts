import type { FrozenCoverDraft, FrozenSelectionSnapshot, TabVideoState } from "./types";

export const FROZEN_SELECTION_STORAGE_KEY = "frozenSelectionSnapshot";
export const FROZEN_SELECTION_DRAFT_STORAGE_KEY = "frozenSelectionDraft";

export function createFrozenSelectionSnapshot(
  state: TabVideoState | null,
  selectedIds: Iterable<string>
): FrozenSelectionSnapshot | null {
  if (!state) {
    return null;
  }

  const selected = new Set(selectedIds);
  const videos = state.videos.filter((item) => selected.has(item.id) && item.exportable);
  if (videos.length === 0) {
    return null;
  }

  return Object.freeze({
    pageUrl: state.pageUrl,
    pageTitle: state.pageTitle,
    createdAt: Date.now(),
    videos: freezeVideoList(videos)
  });
}

export function createInitialCoverDrafts(snapshot: FrozenSelectionSnapshot): FrozenCoverDraft[] {
  return snapshot.videos.map((_, index) => createCoverDraft(snapshot, index + 1));
}

export function mergeFrozenSelectionDraft(
  snapshot: FrozenSelectionSnapshot | null,
  coverDrafts: readonly FrozenCoverDraft[] | null | undefined
): FrozenCoverDraft[] {
  if (!snapshot) {
    return [];
  }

  const sourceDrafts = coverDrafts == null ? createInitialCoverDrafts(snapshot) : coverDrafts;
  return sourceDrafts.map((draft, index) => normalizeCoverDraft(draft, index + 1));
}

function createCoverDraft(snapshot: FrozenSelectionSnapshot, index: number): FrozenCoverDraft {
  const key = createCoverKey(snapshot, index);
  return {
    id: key,
    index,
    name: `Cover ${index}`,
    storageKey: key,
    from: index,
    to: index
  };
}

function normalizeCoverDraft(draft: FrozenCoverDraft, index: number): FrozenCoverDraft {
  const previousDefaultName = `Cover ${draft.index}`;
  const nextDefaultName = `Cover ${index}`;
  const name = !draft.name || draft.name === previousDefaultName ? nextDefaultName : draft.name;

  return {
    ...draft,
    index,
    name,
    storageKey: draft.storageKey || draft.id
  };
}

function createCoverKey(snapshot: FrozenSelectionSnapshot, index: number): string {
  return `cover-${snapshot.createdAt}-${index}`;
}

function freezeVideoList(videos: readonly FrozenSelectionSnapshot["videos"]): FrozenSelectionSnapshot["videos"] {
  const frozenVideos = videos.map((item) => Object.freeze({ ...item }));
  return Object.freeze(frozenVideos);
}
