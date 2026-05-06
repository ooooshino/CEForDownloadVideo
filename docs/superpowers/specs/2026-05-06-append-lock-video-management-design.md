# Append Lock And Video Management Design

**Date:** 2026-05-06
**Status:** User-approved design, self-reviewed, awaiting user review
**Scope:** Chrome extension side panel lock behavior and frozen selection page video management

## Goal

Fix the current `锁定已选` behavior so repeated locking adds newly selected videos instead of replacing the existing locked queue. Add video management on the frozen selection page so the user can remove locked videos without clearing everything and starting over.

## Current Context

The side panel currently creates a new frozen snapshot from the current checked items and writes it to `chrome.storage.local`. This overwrites the previous frozen queue.

The selection page reads the frozen snapshot and displays a stable numbered video queue. It supports cover management and automatic cover range distribution, but it does not currently let the user remove individual videos or selected batches of videos from the locked queue.

## Approved Product Behavior

### Append Locking

When the user clicks `锁定已选` in the side panel:

- read the existing frozen queue, if one exists
- create a snapshot from the currently checked exportable videos
- append only videos that are not already present in the existing queue
- treat video identity as the existing `VideoCandidate.id`
- keep existing videos first and append new videos after them
- update the frozen snapshot metadata to the latest lock action
- preserve the existing queue if all selected videos were already locked

Status messages:

- when new videos are added: `已追加 5 个新视频，当前锁定 18 个。`
- when nothing new is added: `所选视频已全部锁定，没有新增。`
- when no exportable video is selected: keep the existing empty-selection message

### Draft Reset Behavior

If the queue changes because new videos were appended, reset the cover draft state by automatically generating fresh even distribution on the selection page.

If the queue does not change because there were no new videos, do not reset the cover draft state.

If the page URL changes but the user still appends videos, keep the existing queue and append new videos. The latest page title and URL become the snapshot metadata. This matches the user's batch-building workflow.

### Selection Page Video Management

The locked video list gains an independent management selection state:

- each locked video card has a checkbox for video management
- the section header has `全选`, `反选`, and `移除已选`
- each video card also has a single-video `移除` action
- management checkboxes are only for removing videos from the locked queue
- they do not affect cover assignment directly and do not affect export task selection

Removal behavior:

- batch removal removes all checked locked videos immediately
- single removal removes that one locked video immediately
- no confirmation dialog is shown
- after removal, the list is re-numbered from `1`
- after removal, cover ranges are automatically re-distributed across the remaining videos
- uploaded cover files stay in the page state
- cover cards stay in place
- if no videos remain, the page shows the existing empty state and disables export

Status messages:

- batch removal: `已移除 3 个视频，并重新分配封面范围。`
- single removal: `已移除 1 个视频，并重新分配封面范围。`
- no management checkbox selected: `请先勾选要移除的视频。`

### Export Safety

While export is running:

- disable video management checkboxes
- disable `全选`, `反选`, `移除已选`
- disable single-video `移除`
- keep the locked queue unchanged until export finishes

The existing `手动清空` button remains the full reset action. It clears the locked queue and cover draft state.

## Data Flow

### Side Panel

1. User checks videos.
2. User clicks `锁定已选`.
3. Side panel builds the current selected snapshot.
4. Side panel reads the previous frozen snapshot.
5. Side panel merges old videos plus newly selected videos, deduped by video id.
6. Side panel writes the merged snapshot.
7. Side panel removes the cover draft only when the merged video id list changed.
8. Side panel opens the selection page.

### Selection Page

1. Page loads frozen snapshot and cover drafts.
2. Page renders locked videos with management checkboxes.
3. User removes one or more videos.
4. Page writes the updated frozen snapshot to storage.
5. Page automatically applies even distribution to current covers.
6. Page writes updated cover drafts to storage.
7. Page re-renders the list, cover editor, task summary, and task preview.

## Component Boundaries

### `selection-storage.ts`

Add small pure helpers for:

- merging a previous frozen snapshot with a newly selected snapshot
- removing locked videos by id
- keeping the frozen video list immutable after creation

These helpers should be unit-tested because they define the core queue behavior.

### `sidepanel.ts`

Use the merge helper in `handleFreezeSelection`. Keep the side panel responsible only for discovery, selection, append locking, and opening the selection page.

### `selection.ts`

Add local management selection state and removal handlers. Keep removal behavior local to the selection page, but persist the updated snapshot and redistributed cover drafts.

## Error Handling

- If no snapshot exists on the selection page, management controls are hidden or disabled.
- If removal leaves zero videos, export stays disabled.
- If automatic redistribution cannot assign ranges because there are no videos, cover drafts remain valid empty-state UI and no export tasks are generated.
- If storage write fails, show a status message and keep the current in-memory UI state until the next successful render or reload.

## Testing

Add focused tests for storage helpers:

- append new videos without replacing existing videos
- dedupe videos by id
- keep old order and append new order
- do not reset drafts when append adds nothing
- remove selected videos by id
- removal reindexes remaining frozen videos through the rendered order
- removing all videos produces an empty snapshot state

Run the extension test suite and build after implementation.

## Acceptance Criteria

- Locking batch A, then locking batch B, produces A plus B.
- Locking overlapping batches does not duplicate already locked videos.
- The selection page can remove one locked video.
- The selection page can remove multiple checked locked videos.
- Removing videos automatically re-runs even cover distribution.
- Export is disabled when no locked videos remain.
- Video management is disabled while export is running.
- Existing full clear behavior still clears the entire queue and cover draft state.
