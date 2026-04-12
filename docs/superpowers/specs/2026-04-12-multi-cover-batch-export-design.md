# Multi-Cover Batch Export Design

**Date:** 2026-04-12  
**Status:** Draft approved in conversation, awaiting user review  
**Scope:** Chrome extension `selection` page + local batch export service

## Goal

Allow users to:

- freeze a selected set of videos from the side panel into a stable, independent page
- upload multiple cover images on the frozen page
- auto-distribute videos across covers, then manually adjust ranges
- allow overlapping ranges so one video can generate multiple outputs with different covers
- submit the expanded task list to the local server for concurrent download, clip, and render processing

The system should preserve frozen data even if the side panel refreshes, and only clear the frozen queue when the user explicitly asks to clear it.

## Current Context

The project already has:

- a Manifest V3 Chrome extension with a side panel for discovery and export
- a frozen `selection` page that keeps a stable snapshot in `chrome.storage.local`
- a local Node service that downloads source videos and processes them with `ffmpeg`

The current export flow is still single-cover and fundamentally single-request oriented. The next step is to turn the frozen page into a task orchestration page and turn the local service into a bounded-concurrency batch executor.

## Product Direction

### Side Panel

The side panel remains the discovery surface:

- detect videos from supported sites
- let the user preview and select items
- freeze selected items into the independent `selection` page

The side panel is not responsible for batch orchestration.

### Selection Page

The selection page becomes the orchestration surface:

- display the frozen video queue with stable ordinal numbering
- upload and manage multiple cover images
- auto-distribute videos across covers
- allow manual adjustment of per-cover ranges
- allow overlapping ranges
- preview the final expanded task list
- launch batch export
- display execution progress and final results

### Local Server

The local server becomes the execution surface:

- accept a batch payload containing already-expanded tasks
- process tasks with a fixed concurrency pool of `3`
- isolate temporary files per task
- return per-task success or failure

## User Experience

### Frozen Queue Model

When the user clicks `锁定已选` in the side panel:

- the extension saves a snapshot containing the selected exportable videos, page title, page URL, and creation time
- the extension opens the independent `selection.html` page
- the frozen queue is stable and unaffected by future side panel refreshes

The frozen queue persists until the user manually clears it.

### Multi-Cover Workflow

On the selection page:

1. The user sees frozen videos numbered from `1..N`
2. The user uploads one or more cover images
3. The user clicks `自动平均分配`
4. The system fills a default `from/to` range for each cover
5. The user can manually edit those ranges
6. Overlap is allowed
7. The page shows how many tasks will be generated
8. The user starts export

### Range Semantics

- Ranges are inclusive
- Video numbering is based on frozen order, not later side panel order
- A video may belong to zero, one, or multiple cover ranges
- If a video belongs to multiple cover ranges, multiple export tasks are created

### Output Naming

When a video maps to multiple covers, outputs must remain distinct.

Baseline naming rule:

`{source-host}-{video-index}-cover-{coverIndex}-{timestamp}.mp4`

Example:

- `redgifs-com-12-cover-1-2026-04-12T11-20-30-000Z.mp4`
- `redgifs-com-12-cover-2-2026-04-12T11-20-30-000Z.mp4`

## Architecture

## Extension Responsibilities

### `sidepanel.ts`

- keep real-time discovery behavior
- retain `锁定已选`
- write a frozen snapshot to storage
- open `selection.html`

### `selection.ts`

New or expanded responsibilities:

- read frozen snapshot from storage
- assign stable display indices to frozen videos
- manage uploaded cover list
- compute automatic cover ranges
- allow manual edits to ranges
- validate ranges and batch readiness
- build a preview of expanded execution tasks
- submit a batch payload to the local server
- display task progress and results

### `selection-storage.ts`

Likely expanded responsibilities:

- frozen queue persistence
- cover list persistence
- optional draft range persistence while the selection page remains open

## Local Server Responsibilities

### New Batch Endpoint

Recommended addition:

- `POST /export/batch`

Request payload shape should be explicit and already-expanded:

```json
{
  "startTime": 0,
  "endTime": 8,
  "pageUrl": "https://www.redgifs.com/explore/gifs/demo",
  "tasks": [
    {
      "taskId": "task-001",
      "videoIndex": 12,
      "videoSrc": "https://cdn.example.com/demo.mp4",
      "coverIndex": 1,
      "coverUploadField": "cover-1"
    }
  ]
}
```

Each task is independent and can be processed in any order.

### Execution Pool

The server must:

- create a bounded worker pool with concurrency `3`
- dequeue tasks until all are complete
- isolate temp directories per task
- avoid output collisions
- collect per-task result objects

Recommended result shape:

```json
{
  "ok": true,
  "results": [
    {
      "taskId": "task-001",
      "videoIndex": 12,
      "coverIndex": 1,
      "src": "https://cdn.example.com/demo.mp4",
      "success": true,
      "outputPath": "/Users/.../redgifs-com-12-cover-1-2026-04-12....mp4"
    }
  ]
}
```

## Task Generation Rules

### Automatic Distribution

Given:

- `N` frozen videos
- `M` covers

The system computes a default partition covering `1..N`.

For example:

- `50` videos
- `5` covers

Default ranges become:

- cover 1: `1-10`
- cover 2: `11-20`
- cover 3: `21-30`
- cover 4: `31-40`
- cover 5: `41-50`

If division is uneven, earlier covers receive one additional item until the remainder is exhausted.

### Manual Adjustment

After auto-fill, the user may edit each cover's `from` and `to`.

Rules:

- `from` and `to` are required integers
- `from >= 1`
- `to <= frozenVideoCount`
- `from <= to`
- overlap is allowed
- uncovered videos are allowed, but the UI should show that some frozen items will not produce tasks

### Expansion

The selection page expands tasks by:

1. iterating frozen videos in order
2. testing each video index against each cover range
3. creating one task per match

This means:

- no match => no task
- one match => one task
- multiple matches => multiple tasks

## UI Design For Selection Page

The page should have four sections.

### 1. Frozen Video Queue

- grid of frozen videos
- each card shows stable ordinal number
- thumbnail, duration, and source title

### 2. Cover Group Editor

Each cover card shows:

- cover preview
- `Cover {n}` label
- `from`
- `to`
- remove button

Controls:

- add cover
- auto-distribute

### 3. Task Preview

Display summary:

- frozen video count
- cover count
- generated task count
- concurrency `3`

Display preview examples:

- `#12 + cover-1`
- `#12 + cover-2`
- `#13 + cover-2`

### 4. Batch Export

Display:

- start time
- end time
- export button
- progress summary
- per-task results

## Validation Rules

The page must block export when:

- no frozen videos exist
- no covers exist
- any cover range is invalid
- generated task count is `0`
- `endTime <= startTime`
- some selected export tasks have `startTime >= duration`

The page should warn, but not block, when:

- some frozen videos are uncovered by all ranges
- some videos are covered by multiple ranges

## Failure Handling

### Client Side

- frozen data must remain stable even if side panel refreshes
- selection page should not be invalidated by side panel refresh failures
- batch task preview should recompute immediately after any range edit

### Server Side

- one failed task must not abort the whole batch
- every task returns its own success or failure result
- temp files must be isolated per task
- failures should include enough detail to diagnose download, ffprobe, or ffmpeg issues

## Testing Strategy

Tests should be split into three layers.

### 1. Frontend Unit Tests

#### Frozen Snapshot

- creates a snapshot from selected exportable videos
- ignores unsupported items
- preserves frozen order

#### Cover Distribution

- auto-distributes evenly when division is exact
- auto-distributes evenly when division has a remainder
- recomputes ranges when cover count changes

#### Range Validation

- rejects `from > to`
- rejects `from < 1`
- rejects `to > videoCount`
- accepts overlap
- identifies uncovered items

#### Task Expansion

- one cover over full range creates one task per video
- overlapping ranges create duplicate tasks for overlapped videos
- uncovered videos create zero tasks
- task count updates after manual edits

#### Refresh Isolation

- side panel refresh cannot wipe frozen selection data
- missing content-script receiver should preserve previous side panel state

### 2. Local Server Unit/Integration Tests

#### Batch Parsing

- parses multipart cover uploads and task payload correctly
- rejects malformed task payload

#### Pool Execution

- runs fewer than `3` tasks correctly
- caps active execution at `3`
- schedules the next task after one completes

#### Output Isolation

- two tasks for the same video use different output names
- temp file paths do not collide

#### Error Isolation

- one task failure does not stop remaining tasks
- multiple failures still produce a full result array

### 3. End-to-End Tests

#### Happy Path

- freeze multiple videos
- upload multiple covers
- auto-distribute
- manually edit one range
- export
- confirm output count matches generated task count

#### Overlap Path

- set overlapping cover ranges
- verify one video produces multiple outputs
- verify names include `cover-{n}`

#### Resilience Path

- open selection page
- let side panel refresh or lose its receiver
- confirm selection page data remains intact

## Bug Checklist

The following are high-risk issues that implementation must explicitly guard against:

- task preview not updating after range edits
- overlap creating too few or too many tasks
- output name collisions for repeated video-cover combinations
- temp path collisions when the same video is processed more than once concurrently
- one failed task blocking the whole batch
- a later side panel freeze overwriting an in-progress selection page unexpectedly
- export state being lost when the selection page refreshes

## Open Implementation Questions

These are implementation questions, not product blockers:

- whether task progress should stream incrementally or return only at batch end
- whether selection drafts should persist after browser restart
- whether completed batch history should remain on the selection page after clear

Recommended answer for the first implementation pass:

- return results at batch end first
- do not persist drafts beyond the active frozen snapshot
- keep result history on the page until the user manually clears or reloads

## Recommendation

Implement this feature as:

- stable frozen selection in the extension
- task expansion in the `selection` page
- bounded concurrency batch execution in `local-server`

This keeps UI state and execution concerns separated, preserves user trust, and matches the current architecture of extension for orchestration plus local service for heavy processing.
