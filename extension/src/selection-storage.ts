import type { FrozenCoverDraft, FrozenSelectionSnapshot, TabVideoState } from "./types";

export const FROZEN_SELECTION_STORAGE_KEY = "frozenSelectionSnapshot";
export const FROZEN_SELECTION_DRAFT_STORAGE_KEY = "frozenSelectionDraft";

export interface AppendFrozenSelectionResult {
  snapshot: FrozenSelectionSnapshot;
  addedCount: number;
  changed: boolean;
}

export interface RemoveFrozenSelectionResult {
  snapshot: FrozenSelectionSnapshot;
  removedCount: number;
}

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

export function appendFrozenSelectionSnapshot(
  previous: FrozenSelectionSnapshot | null | undefined,
  incoming: FrozenSelectionSnapshot
): AppendFrozenSelectionResult {
  if (!previous) {
    return {
      snapshot: incoming,
      addedCount: incoming.videos.length,
      changed: true
    };
  }

  const previousIds = new Set(previous.videos.map((item) => item.id));
  const appendedVideos = incoming.videos.filter((item) => !previousIds.has(item.id));
  if (appendedVideos.length === 0) {
    return {
      snapshot: previous,
      addedCount: 0,
      changed: false
    };
  }

  return {
    snapshot: Object.freeze({
      pageUrl: incoming.pageUrl,
      pageTitle: incoming.pageTitle,
      createdAt: incoming.createdAt,
      videos: freezeVideoList([...previous.videos, ...appendedVideos])
    }),
    addedCount: appendedVideos.length,
    changed: true
  };
}

export function removeFrozenSelectionVideos(
  current: FrozenSelectionSnapshot,
  removeIds: Iterable<string>
): RemoveFrozenSelectionResult {
  const ids = new Set(removeIds);
  if (ids.size === 0) {
    return {
      snapshot: current,
      removedCount: 0
    };
  }

  const remainingVideos = current.videos.filter((item) => !ids.has(item.id));
  const removedCount = current.videos.length - remainingVideos.length;
  if (removedCount === 0) {
    return {
      snapshot: current,
      removedCount: 0
    };
  }

  return {
    snapshot: Object.freeze({
      ...current,
      createdAt: Date.now(),
      videos: freezeVideoList(remainingVideos)
    }),
    removedCount
  };
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
