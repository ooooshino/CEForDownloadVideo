import assert from "node:assert/strict";
import test from "node:test";
import { makeCandidate, mergeCandidates } from "./utils";

test("mergeCandidates puts newly discovered videos before existing videos", () => {
  const existing = [
    makeCandidate({ src: "https://cdn.example.com/1.mp4", sourceType: "network" }),
    makeCandidate({ src: "https://cdn.example.com/2.mp4", sourceType: "network" }),
    makeCandidate({ src: "https://cdn.example.com/3.mp4", sourceType: "network" })
  ];
  const incoming = [
    makeCandidate({ src: "https://cdn.example.com/4.mp4", sourceType: "network" }),
    makeCandidate({ src: "https://cdn.example.com/5.mp4", sourceType: "network" }),
    makeCandidate({ src: "https://cdn.example.com/6.mp4", sourceType: "network" })
  ];

  const merged = mergeCandidates(existing, incoming);

  assert.deepEqual(
    merged.map((item) => item.src),
    [
      "https://cdn.example.com/4.mp4",
      "https://cdn.example.com/5.mp4",
      "https://cdn.example.com/6.mp4",
      "https://cdn.example.com/1.mp4",
      "https://cdn.example.com/2.mp4",
      "https://cdn.example.com/3.mp4"
    ]
  );
});

test("mergeCandidates keeps one item when incoming video already exists", () => {
  const existing = [
    makeCandidate({ src: "https://cdn.example.com/1.mp4", sourceType: "network" }),
    makeCandidate({ src: "https://cdn.example.com/2.mp4", sourceType: "network" })
  ];
  const incoming = [
    makeCandidate({ src: "https://cdn.example.com/2.mp4", title: "Updated", sourceType: "network" }),
    makeCandidate({ src: "https://cdn.example.com/3.mp4", sourceType: "network" })
  ];

  const merged = mergeCandidates(existing, incoming);

  assert.deepEqual(
    merged.map((item) => item.src),
    [
      "https://cdn.example.com/3.mp4",
      "https://cdn.example.com/1.mp4",
      "https://cdn.example.com/2.mp4"
    ]
  );
  assert.equal(merged.find((item) => item.src.endsWith("/2.mp4"))?.title, "Updated");
});
