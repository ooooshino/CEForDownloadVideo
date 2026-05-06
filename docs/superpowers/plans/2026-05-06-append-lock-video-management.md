# Append Lock And Video Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `锁定已选` append new videos without replacing the locked queue, and add single/batch removal on the frozen selection page.

**Architecture:** Keep queue mutation rules in `extension/src/selection-storage.ts` as pure helpers with unit tests. Use those helpers from `extension/src/sidepanel.ts` for append locking and from `extension/src/selection.ts` for video removal, then update selection page markup and styles for management controls.

**Tech Stack:** Chrome Manifest V3 extension, TypeScript, DOM APIs, `chrome.storage.local`, Node test runner bundled through `esbuild`.

---

## Scope Check

This plan covers one connected feature: locked video queue management. It touches two UI surfaces, but both share the same stored frozen queue. It does not change the local server, export endpoint, video discovery, cover upload format, or ffmpeg processing.

Current working tree note: there are unrelated untracked scan JSON files in the repository. Do not stage or modify them.

## File Structure

- Modify `extension/src/selection-storage.ts`
  - Owns pure frozen queue creation, append merging, removal, and cover draft normalization.
- Modify `extension/src/selection-storage.test.ts`
  - Owns tests for append and removal behavior.
- Modify `extension/src/sidepanel.ts`
  - Uses storage helpers to append selected videos and keep status messages accurate.
- Modify `extension/src/selection.ts`
  - Owns selection page management checkbox state, single removal, batch removal, persistence, and auto redistribution after removal.
- Modify `extension/src/selection.html`
  - Adds management action buttons to the locked video queue section.
- Modify `extension/src/selection.css`
  - Adds styles for locked video management controls.

---

### Task 1: Storage Helper Tests

**Files:**
- Modify: `extension/src/selection-storage.test.ts`

- [ ] **Step 1: Import the new helper names in the test file**

Replace the existing import from `./selection-storage` with:

```ts
import {
  appendFrozenSelectionSnapshot,
  createFrozenSelectionSnapshot,
  createInitialCoverDrafts,
  mergeFrozenSelectionDraft,
  removeFrozenSelectionVideos
} from "./selection-storage";
```

- [ ] **Step 2: Add append helper tests**

Append these tests after `returns null when nothing exportable is selected`:

```ts
test("appends new videos to an existing frozen snapshot without replacing old videos", () => {
  const existing = createFrozenSelectionSnapshot(makeState(), ["a", "c"]);
  const incoming = createFrozenSelectionSnapshot(makeState(), ["c", "d"]);

  assert.ok(existing);
  assert.ok(incoming);

  const result = appendFrozenSelectionSnapshot(existing, incoming);

  assert.deepEqual(result.snapshot.videos.map((video) => video.id), ["a", "c", "d"]);
  assert.equal(result.addedCount, 1);
  assert.equal(result.changed, true);
  assert.equal(result.snapshot.pageUrl, incoming.pageUrl);
  assert.equal(result.snapshot.pageTitle, incoming.pageTitle);
  assert.equal(result.snapshot.createdAt, incoming.createdAt);
});

test("keeps existing frozen snapshot when selected videos are already locked", () => {
  const existing = createFrozenSelectionSnapshot(makeState(), ["a", "c"]);
  const incoming = createFrozenSelectionSnapshot(makeState(), ["c", "a"]);

  assert.ok(existing);
  assert.ok(incoming);

  const result = appendFrozenSelectionSnapshot(existing, incoming);

  assert.deepEqual(result.snapshot.videos.map((video) => video.id), ["a", "c"]);
  assert.equal(result.addedCount, 0);
  assert.equal(result.changed, false);
  assert.equal(result.snapshot, existing);
});

test("uses the incoming snapshot when there is no existing frozen queue", () => {
  const incoming = createFrozenSelectionSnapshot(makeState(), ["a", "d"]);

  assert.ok(incoming);

  const result = appendFrozenSelectionSnapshot(null, incoming);

  assert.deepEqual(result.snapshot.videos.map((video) => video.id), ["a", "d"]);
  assert.equal(result.addedCount, 2);
  assert.equal(result.changed, true);
});
```

- [ ] **Step 3: Add removal helper tests**

Append these tests before `creates initial cover drafts in frozen snapshot order`:

```ts
test("removes frozen videos by id and keeps remaining order", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["a", "c", "d"]);

  assert.ok(snapshot);

  const result = removeFrozenSelectionVideos(snapshot, ["c"]);

  assert.deepEqual(result.snapshot?.videos.map((video) => video.id), ["a", "d"]);
  assert.equal(result.removedCount, 1);
});

test("returns original snapshot when removing ids that are not locked", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["a", "c"]);

  assert.ok(snapshot);

  const result = removeFrozenSelectionVideos(snapshot, ["x"]);

  assert.equal(result.snapshot, snapshot);
  assert.equal(result.removedCount, 0);
});

test("removing every frozen video returns an empty snapshot", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["a", "c"]);

  assert.ok(snapshot);

  const result = removeFrozenSelectionVideos(snapshot, ["a", "c"]);

  assert.deepEqual(result.snapshot?.videos, []);
  assert.equal(result.removedCount, 2);
});
```

- [ ] **Step 4: Run tests and verify they fail for missing helpers**

Run:

```bash
cd extension && npm test
```

Expected: FAIL with errors saying `appendFrozenSelectionSnapshot` and `removeFrozenSelectionVideos` are not exported.

- [ ] **Step 5: Commit the failing tests**

```bash
git add extension/src/selection-storage.test.ts
git commit -m "test(队列): 覆盖追加和移除规则"
```

---

### Task 2: Storage Helper Implementation

**Files:**
- Modify: `extension/src/selection-storage.ts`
- Test: `extension/src/selection-storage.test.ts`

- [ ] **Step 1: Add result interfaces after the storage key exports**

Add below `FROZEN_SELECTION_DRAFT_STORAGE_KEY`:

```ts
export interface AppendFrozenSelectionResult {
  snapshot: FrozenSelectionSnapshot;
  addedCount: number;
  changed: boolean;
}

export interface RemoveFrozenSelectionResult {
  snapshot: FrozenSelectionSnapshot | null;
  removedCount: number;
}
```

- [ ] **Step 2: Add append and removal helpers after `createFrozenSelectionSnapshot`**

```ts
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
```

- [ ] **Step 3: Run storage tests**

Run:

```bash
cd extension && npm test
```

Expected: PASS for all extension tests.

- [ ] **Step 4: Build the extension**

Run:

```bash
cd extension && npm run build
```

Expected: build completes without TypeScript or bundling errors.

- [ ] **Step 5: Commit implementation**

```bash
git add extension/src/selection-storage.ts extension/src/selection-storage.test.ts
git commit -m "feat(队列): 新增追加和移除规则"
```

---

### Task 3: Side Panel Append Locking

**Files:**
- Modify: `extension/src/sidepanel.ts`
- Test: covered by `extension/src/selection-storage.test.ts`

- [ ] **Step 1: Add append helper import**

Find the import from `./selection-storage` and include `appendFrozenSelectionSnapshot`:

```ts
import {
  appendFrozenSelectionSnapshot,
  createFrozenSelectionSnapshot,
  FROZEN_SELECTION_DRAFT_STORAGE_KEY,
  FROZEN_SELECTION_STORAGE_KEY
} from "./selection-storage";
```

- [ ] **Step 2: Replace previous snapshot comparison in `handleFreezeSelection`**

Replace the block from `const stored = await chrome.storage.local.get...` through the `if (shouldResetDraft)` block with:

```ts
  const stored = await chrome.storage.local.get(FROZEN_SELECTION_STORAGE_KEY);
  const previousSnapshot =
    (stored[FROZEN_SELECTION_STORAGE_KEY] as FrozenSelectionSnapshot | undefined) ?? null;
  const appendResult = appendFrozenSelectionSnapshot(previousSnapshot, snapshot);

  await chrome.storage.local.set({
    [FROZEN_SELECTION_STORAGE_KEY]: appendResult.snapshot
  });
  if (appendResult.changed) {
    await chrome.storage.local.remove(FROZEN_SELECTION_DRAFT_STORAGE_KEY);
  }
```

- [ ] **Step 3: Update status message after opening selection page**

Replace:

```ts
  setStatus(`已锁定 ${snapshot.videos.length} 个视频，可在新页面继续导出。`);
```

with:

```ts
  setStatus(
    appendResult.addedCount > 0
      ? `已追加 ${appendResult.addedCount} 个新视频，当前锁定 ${appendResult.snapshot.videos.length} 个。`
      : "所选视频已全部锁定，没有新增。"
  );
```

- [ ] **Step 4: Add the missing type import if TypeScript needs it**

If `FrozenSelectionSnapshot` is not already imported in `sidepanel.ts`, update the type import at the top to:

```ts
import type { ExportResultItem, FrozenSelectionSnapshot, TabVideoState, VideoCandidate } from "./types";
```

- [ ] **Step 5: Run extension tests and build**

Run:

```bash
cd extension && npm test && npm run build
```

Expected: all tests pass and build succeeds.

- [ ] **Step 6: Commit side panel behavior**

```bash
git add extension/src/sidepanel.ts
git commit -m "feat(锁定): 累加已选视频"
```

---

### Task 4: Selection Page Management Controls

**Files:**
- Modify: `extension/src/selection.html`
- Modify: `extension/src/selection.ts`
- Modify: `extension/src/selection.css`

- [ ] **Step 1: Add management buttons to the locked queue header**

In `extension/src/selection.html`, replace the locked items count span:

```html
          <span id="selection-count" class="badge pending">0 ITEMS</span>
```

with:

```html
          <div class="locked-actions">
            <button id="select-locked-all-btn" class="button secondary small" type="button">全选</button>
            <button id="invert-locked-selection-btn" class="button secondary small" type="button">反选</button>
            <button id="remove-locked-selected-btn" class="button danger small" type="button">移除已选</button>
            <span id="selection-count" class="badge pending">0 ITEMS</span>
          </div>
```

- [ ] **Step 2: Add DOM references in `selection.ts`**

Add after `const selectionList = must<HTMLDivElement>("#selection-list");`:

```ts
const selectLockedAllButton = must<HTMLButtonElement>("#select-locked-all-btn");
const invertLockedSelectionButton = must<HTMLButtonElement>("#invert-locked-selection-btn");
const removeLockedSelectedButton = must<HTMLButtonElement>("#remove-locked-selected-btn");
```

- [ ] **Step 3: Import removal helper**

Update the import from `./selection-storage` to include `removeFrozenSelectionVideos`:

```ts
import {
  FROZEN_SELECTION_DRAFT_STORAGE_KEY,
  FROZEN_SELECTION_STORAGE_KEY,
  mergeFrozenSelectionDraft,
  removeFrozenSelectionVideos
} from "./selection-storage";
```

- [ ] **Step 4: Add local management state**

Add after `let covers: CoverUiState[] = [];`:

```ts
let managedVideoIds = new Set<string>();
```

- [ ] **Step 5: Register management button handlers in `bootstrap`**

Add after `backButton.addEventListener("click", () => void closeCurrentTab());`:

```ts
  selectLockedAllButton.addEventListener("click", handleSelectAllLockedVideos);
  invertLockedSelectionButton.addEventListener("click", handleInvertLockedVideoSelection);
  removeLockedSelectedButton.addEventListener("click", () => void handleRemoveSelectedLockedVideos());
```

- [ ] **Step 6: Update empty snapshot rendering to disable management controls**

Inside `renderSnapshotSection`, in the `if (!snapshot)` branch, add before `return;`:

```ts
    syncLockedManagementControls();
```

- [ ] **Step 7: Add checkbox and single remove button to each locked item**

Inside `snapshot.videos.forEach`, add these constants before `card.innerHTML`:

```ts
    const checked = managedVideoIds.has(item.id) ? "checked" : "";
    const disabled = isExporting ? "disabled" : "";
```

Replace the start of `card.innerHTML` with this full card markup:

```ts
    card.innerHTML = `
      <div class="locked-card-actions">
        <label class="locked-check">
          <input type="checkbox" data-locked-check-id="${escapeHtml(item.id)}" ${checked} ${disabled} />
          <span>选择</span>
        </label>
        <button class="button danger small" type="button" data-remove-video-id="${escapeHtml(item.id)}" ${disabled}>移除</button>
      </div>
      <div class="preview-shell">
        <div class="ordinal-chip">#${index + 1}</div>
        <div class="duration-chip">${durationText}</div>
        <img class="preview-image" ${item.poster ? `src="${escapeHtml(item.poster)}"` : ""} alt="" loading="lazy" />
      </div>
      <div class="locked-meta">
        <strong class="locked-title">${escapeHtml(item.title || `视频 #${index + 1}`)}</strong>
        <div class="locked-url">${escapeHtml(item.src)}</div>
      </div>
    `;
```

- [ ] **Step 8: Add per-card event listeners after `card.innerHTML`**

Add before `selectionList.appendChild(card);`:

```ts
    const checkbox = card.querySelector(`[data-locked-check-id="${CSS.escape(item.id)}"]`) as HTMLInputElement;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        managedVideoIds.add(item.id);
      } else {
        managedVideoIds.delete(item.id);
      }
      syncLockedManagementControls();
    });

    const removeButton = card.querySelector(`[data-remove-video-id="${CSS.escape(item.id)}"]`) as HTMLButtonElement;
    removeButton.addEventListener("click", () => {
      void removeLockedVideos([item.id]);
    });
```

- [ ] **Step 9: Sync controls after rendering snapshot videos**

Add after the `snapshot.videos.forEach(...)` loop:

```ts
  syncLockedManagementControls();
```

- [ ] **Step 10: Add management handlers before `handleAddCover`**

```ts
function handleSelectAllLockedVideos(): void {
  if (!snapshot || isExporting) {
    return;
  }
  managedVideoIds = new Set(snapshot.videos.map((item) => item.id));
  renderSnapshotSection();
}

function handleInvertLockedVideoSelection(): void {
  if (!snapshot || isExporting) {
    return;
  }
  const next = new Set<string>();
  for (const item of snapshot.videos) {
    if (!managedVideoIds.has(item.id)) {
      next.add(item.id);
    }
  }
  managedVideoIds = next;
  renderSnapshotSection();
}

async function handleRemoveSelectedLockedVideos(): Promise<void> {
  if (managedVideoIds.size === 0) {
    setStatus("请先勾选要移除的视频。");
    return;
  }
  await removeLockedVideos(managedVideoIds);
}
```

- [ ] **Step 11: Add removal persistence and redistribution helpers after the management handlers**

```ts
async function removeLockedVideos(videoIds: Iterable<string>): Promise<void> {
  if (!snapshot || isExporting) {
    return;
  }

  const result = removeFrozenSelectionVideos(snapshot, videoIds);
  if (result.removedCount === 0) {
    setStatus("请先勾选要移除的视频。");
    return;
  }

  snapshot = result.snapshot;
  managedVideoIds = new Set();
  redistributeCoversAfterVideoChange();

  await chrome.storage.local.set({
    [FROZEN_SELECTION_STORAGE_KEY]: snapshot
  });
  await persistDrafts();

  setStatus(`已移除 ${result.removedCount} 个视频，并重新分配封面范围。`);
  renderAll();
}

function redistributeCoversAfterVideoChange(): void {
  if (!snapshot || snapshot.videos.length === 0 || covers.length === 0) {
    return;
  }

  const ranges = buildAutomaticRanges({
    videoCount: snapshot.videos.length,
    coverCount: covers.length
  });
  const activeCoverCount = ranges.length;
  covers = covers.map((cover, index) => {
    if (index >= activeCoverCount) {
      const fallback = Math.max(1, snapshot?.videos.length ?? 1);
      return {
        ...cover,
        draft: {
          ...cover.draft,
          index: index + 1,
          name: `Cover ${index + 1}`,
          from: fallback,
          to: fallback
        }
      };
    }

    return {
      ...cover,
      draft: {
        ...cover.draft,
        index: index + 1,
        name: `Cover ${index + 1}`,
        from: ranges[index]!.from,
        to: ranges[index]!.to
      }
    };
  });
}

function syncLockedManagementControls(): void {
  const hasSnapshot = Boolean(snapshot);
  const hasVideos = (snapshot?.videos.length ?? 0) > 0;
  const disabled = isExporting || !hasSnapshot || !hasVideos;
  selectLockedAllButton.disabled = disabled;
  invertLockedSelectionButton.disabled = disabled;
  removeLockedSelectedButton.disabled = disabled || managedVideoIds.size === 0;
}
```

- [ ] **Step 12: Clear management state in `handleClear`**

Add after `snapshot = null;`:

```ts
  managedVideoIds = new Set();
```

- [ ] **Step 13: Ensure export disables management controls**

After each existing `renderTaskSection();` call inside `handleExport`, add:

```ts
  renderSnapshotSection();
```

There are two relevant places: immediately after `isExporting = true` and in the `finally` block after `isExporting = false`.

- [ ] **Step 14: Add management CSS**

Append before the existing `@media` block in `extension/src/selection.css`:

```css
.locked-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.locked-card-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.locked-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1;
}

.locked-check input {
  width: 14px;
  height: 14px;
  accent-color: var(--accent);
}
```

Inside the existing `@media (max-width: 820px)` block, add:

```css
  .locked-actions {
    width: 100%;
    justify-content: flex-start;
  }
```

- [ ] **Step 15: Run extension tests and build**

Run:

```bash
cd extension && npm test && npm run build
```

Expected: all tests pass and build succeeds.

- [ ] **Step 16: Commit selection page management**

```bash
git add extension/src/selection.html extension/src/selection.ts extension/src/selection.css
git commit -m "feat(视频): 新增锁定队列管理"
```

---

### Task 5: Manual Browser Verification

**Files:**
- Verify built extension output under `extension/dist`
- No code changes unless a defect is found

- [ ] **Step 1: Build the extension**

Run:

```bash
cd extension && npm run build
```

Expected: build completes and `extension/dist/selection.html`, `extension/dist/selection.js`, and `extension/dist/selection.css` exist.

- [ ] **Step 2: Inspect built files for required labels**

Run:

```bash
rg -n "移除已选|全选|反选|已追加|所选视频已全部锁定|重新分配封面范围" extension/dist extension/src
```

Expected: output includes matches in source files and built files.

- [ ] **Step 3: Run complete extension test suite**

Run:

```bash
cd extension && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run repository status check**

Run:

```bash
git status --short
```

Expected: only intentional implementation files are modified, plus the existing unrelated untracked scan JSON files.

- [ ] **Step 5: Commit verification fixes if needed**

If Step 1, Step 2, or Step 3 exposed a defect and the fix was made, commit only those files:

```bash
git add extension/src/selection-storage.ts extension/src/selection-storage.test.ts extension/src/sidepanel.ts extension/src/selection.ts extension/src/selection.html extension/src/selection.css
git commit -m "fix(视频): 修复锁定队列管理"
```

If no defect was found, do not create an empty commit.

---

## Final Verification Checklist

- [ ] `cd extension && npm test`
- [ ] `cd extension && npm run build`
- [ ] `rg -n "移除已选|全选|反选|已追加|所选视频已全部锁定|重新分配封面范围" extension/dist extension/src`
- [ ] `git status --short` shows no accidental staged or modified unrelated files

## Expected User-Visible Result

- Locking A, then locking B, shows A plus B.
- Locking already locked videos reports that nothing new was added.
- The frozen page shows video management checkboxes and remove buttons.
- Removing videos immediately updates the locked list.
- Cover ranges are automatically re-balanced after removal.
- Export remains unavailable when the locked queue is empty.
