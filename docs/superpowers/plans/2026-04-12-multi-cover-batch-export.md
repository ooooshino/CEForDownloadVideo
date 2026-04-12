# Multi-Cover Batch Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable frozen selection workflow that supports multiple cover images, automatic and manual range assignment, task expansion with overlapping cover ranges, and bounded-concurrency batch export through the local server.

**Architecture:** The extension remains split between real-time discovery in the side panel and durable task orchestration in the `selection` page. The `selection` page expands cover ranges into explicit export tasks, while `local-server` accepts a batch payload and executes tasks through a worker pool capped at concurrency `3`. State-critical logic stays in small pure helpers with direct tests before UI wiring.

**Tech Stack:** Chrome Manifest V3 extension, TypeScript, esbuild, `chrome.storage.local`, Node.js, Express, Multer, ffmpeg/ffprobe, Node test runner (`node:test`)

---

## Implementation Status (2026-04-13)

- Done: Task 1 (shared types)
- Done: Task 2 (cover range planning helpers + tests)
- Done: Task 3 (frozen selection draft persistence + tests)
- Done: Task 4 (selection editor page, frozen queue, cover cards, auto/manual range, preview)
- Done: Task 5 (batch export worker pool, `/export/batch` parsing/validation, batch tests)
- Done: Task 6 (collision-safe output naming with `video-{n}-cover-{n}`, isolated temp paths)
- Done: Task 7 (selection page batch submit + result rendering + validation guards)
- Done: Task 8 step 1-3 (extension tests/build + local-server test/build)
- Pending manual confirmation: Task 8 step 4 (Chrome manual regression checklist on your machine)

---

## File Structure

### Extension files

- Modify: `extension/src/types.ts`
  Adds types for multi-cover drafts, cover assignments, expanded export tasks, and batch results.

- Modify: `extension/src/selection-storage.ts`
  Persists the frozen snapshot plus selection-page draft state for covers, ranges, and execution metadata.

- Create: `extension/src/selection-cover-plan.ts`
  Pure functions for automatic range distribution, validation, and task expansion.

- Create: `extension/src/selection-cover-plan.test.ts`
  Unit tests for distribution, overlap, uncovered ranges, and task count calculation.

- Modify: `extension/src/selection.ts`
  Orchestrates the multi-cover editor, task preview, batch submission, and result rendering.

- Modify: `extension/src/selection.html`
  Adds the cover-group editor, auto-distribute action, task preview, and batch execution UI.

- Modify: `extension/src/selection.css`
  Styles the new layout for cover cards, validation, task summary, and execution state.

- Modify: `extension/src/sidepanel.ts`
  Ensures freezing writes the stable data shape expected by the new selection workflow.

- Modify: `extension/src/sidepanel.html`
  Keeps the `锁定已选` entry consistent with the upgraded workflow copy if needed.

- Modify: `extension/build.mjs`
  Keeps the `selection` bundle and related assets included in the build.

- Modify: `extension/package.json`
  Extends the test script to run the new pure-logic test bundle.

### Local server files

- Modify: `local-server/src/types.ts`
  Adds batch request, batch task, and batch result types.

- Modify: `local-server/package.json`
  Adds an explicit batch-test command so the server-side queue and route parsing tests have a concrete runner.

- Create: `local-server/src/services/batch-export.ts`
  Owns worker-pool execution, task scheduling, and per-task result aggregation.

- Create: `local-server/src/services/batch-export.test.ts`
  Unit tests for concurrency cap, queue draining, and failure isolation.

- Modify: `local-server/src/routes/export.ts`
  Adds `POST /export/batch`, parses multipart cover uploads plus JSON task payload, and forwards to the batch service.

- Modify: `local-server/src/services/ffmpeg.ts`
  Accepts `coverIndex` and `videoIndex` for collision-safe output naming.

- Modify: `local-server/src/utils/files.ts`
  Adds helpers for task-specific temp/output names with `cover-{n}`.

- Modify: `local-server/src/services/downloader.ts`
  Keeps download helper reusable for repeated concurrent tasks.

## Task 1: Define Shared Data Models

**Files:**
- Modify: `extension/src/types.ts`
- Modify: `local-server/src/types.ts`
- Test: N/A

- [ ] **Step 1: Add extension-side data types**

Add types for:

```ts
export interface FrozenCoverDraft {
  id: string;
  index: number;
  name: string;
  storageKey: string;
  from: number;
  to: number;
}

export interface FrozenExportTask {
  taskId: string;
  videoIndex: number;
  videoSrc: string;
  coverIndex: number;
  coverStorageKey: string;
}
```

- [ ] **Step 2: Add local-server batch types**

Add types for:

```ts
export interface BatchExportTask {
  taskId: string;
  videoIndex: number;
  videoSrc: string;
  coverIndex: number;
  coverUploadField: string;
}

export interface BatchExportResult {
  taskId: string;
  videoIndex: number;
  coverIndex: number;
  src: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}
```

- [ ] **Step 3: Run type check via build entry points**

Run: `npm run build` in `extension`, then `npm run build` in `local-server`  
Expected: both succeed with no TypeScript errors caused by new types

- [ ] **Step 4: Commit**

```bash
git add extension/src/types.ts local-server/src/types.ts
git commit -m "feat: add batch export data types"
```

## Task 2: Add Cover Distribution and Task Expansion Logic

**Files:**
- Create: `extension/src/selection-cover-plan.ts`
- Create: `extension/src/selection-cover-plan.test.ts`
- Modify: `extension/package.json`
- Test: `extension/src/selection-cover-plan.test.ts`

- [ ] **Step 1: Write the failing test for even automatic distribution**

```ts
test("auto distributes videos evenly across covers", () => {
  const ranges = buildAutomaticRanges({ videoCount: 10, coverCount: 3 });
  assert.deepEqual(ranges.map(({ from, to }) => [from, to]), [
    [1, 4],
    [5, 7],
    [8, 10]
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test` in `extension`  
Expected: FAIL because `selection-cover-plan.ts` does not exist yet

- [ ] **Step 3: Implement minimal range generation**

Create `buildAutomaticRanges()` in `extension/src/selection-cover-plan.ts`.

- [ ] **Step 4: Add failing tests for overlap and uncovered behavior**

Add tests for:

```ts
test("expands overlapping cover ranges into duplicate tasks", () => { /* #8 matches cover 1 and 2 */ });
test("reports uncovered videos when no cover matches them", () => { /* uncovered indices returned */ });
test("rejects invalid from/to ranges", () => { /* from > to, to > videoCount */ });
```

- [ ] **Step 5: Run the tests to verify they fail for the new scenarios**

Run: `npm test` in `extension`  
Expected: FAIL on overlap, uncovered, or validation assertions

- [ ] **Step 6: Implement minimal expansion and validation**

Implement:

```ts
export function validateCoverRanges(...)
export function expandFrozenTasks(...)
```

Ensure:

- overlaps create multiple tasks
- uncovered indices are returned
- invalid ranges block submission

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test` in `extension`  
Expected: PASS for all selection-plan tests plus existing tests

- [ ] **Step 8: Commit**

```bash
git add extension/src/selection-cover-plan.ts extension/src/selection-cover-plan.test.ts extension/package.json
git commit -m "feat: add cover range planning helpers"
```

## Task 3: Persist Multi-Cover Draft State

**Files:**
- Modify: `extension/src/selection-storage.ts`
- Modify: `extension/src/selection-storage.test.ts`
- Test: `extension/src/selection-storage.test.ts`

- [ ] **Step 1: Write the failing test for storing cover drafts**

Add a test that a frozen snapshot can be extended with draft covers and later read back without mutating frozen video order.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test` in `extension`  
Expected: FAIL because draft cover persistence helpers do not exist

- [ ] **Step 3: Implement minimal draft helpers**

Add helpers such as:

```ts
export function createInitialCoverDrafts(...)
export function mergeFrozenSelectionDraft(...)
```

Keep the frozen snapshot immutable and the cover draft mutable.

- [ ] **Step 4: Add failing tests for stable ordering and cover identity**

Cases:

- cover removal keeps remaining draft ids stable
- reloading draft preserves the frozen video order

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test` in `extension`  
Expected: FAIL on new draft-state expectations

- [ ] **Step 6: Implement minimal fixes**

Update storage helpers until draft persistence is stable.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test` in `extension`  
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add extension/src/selection-storage.ts extension/src/selection-storage.test.ts
git commit -m "feat: persist multi-cover selection drafts"
```

## Task 4: Build the Selection Page Editor and Task Preview

**Files:**
- Modify: `extension/src/selection.ts`
- Modify: `extension/src/selection.html`
- Modify: `extension/src/selection.css`
- Modify: `extension/src/sidepanel.ts`
- Test: `extension/src/selection-cover-plan.test.ts`

- [ ] **Step 1: Add HTML placeholders for the new editor**

Add sections for:

- frozen video queue with stable ordinal numbering (`#1..N`)
- cover upload list
- add-cover action/button that appends a new cover card
- auto-distribute button
- per-cover card UI with:
  - cover preview image
  - `Cover {n}` label
  - `from/to` inputs
  - remove button
- task summary
- expanded task preview list

- [ ] **Step 2: Wire `selection.ts` to the planning helpers**

On load:

- read frozen snapshot
- create initial covers if none exist
- compute preview state

On change:

- recompute validation
- recompute task expansion
- rerender summary and preview

- [ ] **Step 3: Update `sidepanel.ts` freeze path only as needed**

Keep freeze behavior compatible with the richer selection page data model without breaking current selection.

- [ ] **Step 4: Run build to verify the page bundles**

Run: `npm run build` in `extension`  
Expected: PASS and `dist/selection.js` is rebuilt

- [ ] **Step 5: Manual verification in Chrome**

Verify:

- freeze selected videos
- open `selection.html`
- upload multiple covers
- click auto-distribute
- edit one range
- see task count and preview update immediately

- [ ] **Step 6: Commit**

```bash
git add extension/src/selection.ts extension/src/selection.html extension/src/selection.css extension/src/sidepanel.ts
git commit -m "feat: add multi-cover selection page editor"
```

## Task 5: Add Batch Export API Contract

**Files:**
- Modify: `local-server/src/types.ts`
- Modify: `local-server/package.json`
- Modify: `local-server/src/routes/export.ts`
- Test: `local-server/src/services/batch-export.test.ts`

- [ ] **Step 1: Write the failing test for batch queue behavior**

Create a test that provides 5 tasks and asserts that no more than 3 tasks run concurrently.

Example test sketch:

```ts
test("caps active batch work at 3", async () => {
  const stats = await runBatchWithFakeWorker(5, 3);
  assert.equal(stats.maxConcurrent, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Add this script in `local-server/package.json`:

```json
"test:batch": "mkdir -p ../.tmp-local-server-tests && npx esbuild src/services/batch-export.test.ts --bundle --platform=node --format=esm --outfile=../.tmp-local-server-tests/batch-export.test.js && node ../.tmp-local-server-tests/batch-export.test.js"
```

Then run: `npm run test:batch` in `local-server`  
Expected: FAIL because `batch-export.ts` does not exist

- [ ] **Step 3: Implement minimal worker-pool service**

Create `local-server/src/services/batch-export.ts` with:

```ts
export async function processBatchExport(tasks, worker, concurrency = 3) { ... }
```

The service should:

- start up to `3` tasks
- start the next queued task when one finishes
- collect ordered results

- [ ] **Step 4: Add failing tests for failure isolation**

Cases:

- one task rejects, others continue
- same video with two covers returns two distinct result entries

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm run test:batch` in `local-server`  
Expected: FAIL on failure-isolation assertions

- [ ] **Step 6: Implement minimal fixes**

Ensure result collection never aborts the full batch when one task fails.

- [ ] **Step 7: Add route parsing support**

Extend `POST /export/batch` in `local-server/src/routes/export.ts` to:

- accept uploaded cover files
- parse JSON task payload
- map `coverUploadField` to concrete file paths
- call `processBatchExport()`

- [ ] **Step 8: Add malformed payload tests for the route boundary**

Add tests that reject:

- malformed JSON in `tasks`
- missing referenced cover upload fields
- empty task arrays

The route test may use a small pure parsing helper extracted from `export.ts` if that makes the boundary testable.

- [ ] **Step 9: Add one happy-path route parsing test**

Add a success-case test that proves `/export/batch` can accept:

- one or more uploaded cover files
- a valid JSON `tasks` payload
- a matching `coverUploadField`

and forwards the normalized input to `processBatchExport()` with the expected task and cover path mapping.

- [ ] **Step 10: Run tests and local-server build**

Run:

- `npm run test:batch` in `local-server`
- `npm run build` in `local-server`

Expected: both PASS

- [ ] **Step 11: Commit**

```bash
git add local-server/package.json local-server/src/types.ts local-server/src/services/batch-export.ts local-server/src/services/batch-export.test.ts local-server/src/routes/export.ts
git commit -m "feat: add batch export worker pool"
```

## Task 6: Make ffmpeg Output and Temp Paths Collision-Safe

**Files:**
- Modify: `local-server/src/services/ffmpeg.ts`
- Modify: `local-server/src/utils/files.ts`
- Modify: `local-server/src/services/downloader.ts`
- Test: `local-server/src/services/batch-export.test.ts`

- [ ] **Step 1: Write the failing test for duplicate video multi-cover output naming**

Add a test that two tasks for the same video with different covers produce different output paths.

- [ ] **Step 2: Run the test to verify it fails**

Run: local batch test command  
Expected: FAIL because file naming does not include `coverIndex`

- [ ] **Step 3: Implement minimal file naming update**

Update helpers so output names include:

```ts
buildOutputFileName(pageUrl, videoIndex, coverIndex)
```

with `cover-${coverIndex}` in the output.

- [ ] **Step 4: Isolate temp directories per task**

Ensure each task gets its own temp dir and per-task download path so concurrent processing of the same source video cannot collide.

- [ ] **Step 5: Run the tests to verify they pass**

Run: local batch test command  
Expected: PASS

- [ ] **Step 6: Run local-server build**

Run: `npm run build` in `local-server`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add local-server/src/services/ffmpeg.ts local-server/src/utils/files.ts local-server/src/services/downloader.ts local-server/src/services/batch-export.test.ts
git commit -m "fix: isolate batch export outputs per cover"
```

## Task 7: Wire Selection Page Batch Submission and Result Rendering

**Files:**
- Modify: `extension/src/selection.ts`
- Modify: `extension/src/selection.html`
- Modify: `extension/src/selection.css`
- Test: `extension/src/selection-cover-plan.test.ts`

- [ ] **Step 1: Build batch payload assembly in `selection.ts`**

Submit:

- `startTime`
- `endTime`
- `pageUrl`
- cover files under stable form field names like `cover-1`
- JSON stringified expanded tasks

- [ ] **Step 2: Add execution state handling**

Track:

- queued task count
- submitted state
- success count
- failure count

Render a progress summary and final result list.

- [ ] **Step 3: Add manual validation guards**

Prevent submission when:

- zero covers
- zero tasks
- invalid ranges
- no frozen videos
- `endTime <= startTime`
- any selected task whose source video has `startTime >= duration`

- [ ] **Step 4: Run extension build**

Run: `npm run build` in `extension`  
Expected: PASS

- [ ] **Step 5: Manual integration check**

Verify:

- freeze videos
- upload 2+ covers
- create overlap
- submit batch
- observe result list entries include multiple `cover-{n}` results for one video

- [ ] **Step 6: Commit**

```bash
git add extension/src/selection.ts extension/src/selection.html extension/src/selection.css
git commit -m "feat: submit multi-cover batch exports"
```

## Task 8: End-to-End Regression Pass

**Files:**
- Modify: `extension/src/service-worker.ts` if integration regressions appear
- Modify: `extension/src/sidepanel-state.ts` if freeze/refresh regressions appear
- Test: existing extension tests, new local-server batch tests, manual flow

- [ ] **Step 1: Run extension tests**

Run: `npm test` in `extension`  
Expected: PASS

- [ ] **Step 2: Run extension build**

Run: `npm run build` in `extension`  
Expected: PASS

- [ ] **Step 3: Run local-server build**

Run: `npm run build` in `local-server`  
Expected: PASS

- [ ] **Step 4: Manual regression check**

Verify all of the following:

- side panel discovery still works
- `锁定已选` still opens the selection page
- selection page remains stable while side panel refreshes
- auto-distribute creates default ranges
- manual overlap creates duplicate tasks
- batch export finishes with concurrency `3`
- one failed task does not abort other tasks

- [ ] **Step 5: Commit**

```bash
git add extension local-server
git commit -m "test: verify multi-cover batch export flow"
```
