import test from "node:test";
import assert from "node:assert/strict";
import { parseBatchRequest } from "./export.js";

const uploadedFiles = [
  { fieldname: "cover-1", path: "tmp/uploads/cover-1.png" },
  { fieldname: "cover-2", path: "tmp/uploads/cover-2.png" }
];

test("rejects malformed JSON in tasks", () => {
  const result = parseBatchRequest(
    {
      pageUrl: "https://example.com",
      startTime: "0",
      endTime: "10",
      tasks: "{bad-json"
    },
    uploadedFiles
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /tasks 不能为空/);
  }
});

test("rejects empty task arrays", () => {
  const result = parseBatchRequest(
    {
      pageUrl: "https://example.com",
      startTime: "0",
      endTime: "10",
      tasks: "[]"
    },
    uploadedFiles
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /tasks 不能为空/);
  }
});

test("rejects missing cover upload field", () => {
  const result = parseBatchRequest(
    {
      pageUrl: "https://example.com",
      startTime: "0",
      endTime: "10",
      tasks: JSON.stringify([
        {
          taskId: "t1",
          videoIndex: 0,
          videoSrc: "https://example.com/v1.mp4",
          coverIndex: 0,
          coverUploadField: "cover-missing"
        }
      ])
    },
    uploadedFiles
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /cover-missing/);
  }
});

test("accepts valid tasks and maps cover fields", () => {
  const result = parseBatchRequest(
    {
      pageUrl: "https://example.com",
      startTime: "1",
      endTime: "9",
      tasks: JSON.stringify([
        {
          taskId: "t1",
          videoIndex: 0,
          videoSrc: "https://example.com/v1.mp4",
          coverIndex: 0,
          coverUploadField: "cover-1"
        },
        {
          taskId: "t2",
          videoIndex: 0,
          videoSrc: "https://example.com/v1.mp4",
          coverIndex: 1,
          coverUploadField: "cover-2"
        }
      ])
    },
    uploadedFiles
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.startTime, 1);
    assert.equal(result.value.endTime, 9);
    assert.equal(result.value.tasks.length, 2);
    assert.equal(result.value.coverPathByField.get("cover-1"), "tmp/uploads/cover-1.png");
    assert.equal(result.value.coverPathByField.get("cover-2"), "tmp/uploads/cover-2.png");
  }
});
