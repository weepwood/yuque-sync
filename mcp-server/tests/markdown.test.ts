import assert from "node:assert/strict";
import test from "node:test";
import { buildImageDocument } from "../src/utils/markdown.js";

test("buildImageDocument includes image, prompts, tags and metadata", () => {
  const markdown = buildImageDocument({
    title: "Pink Guava",
    imageUrl: "https://cdn.example.com/guava.png",
    prompt: "original prompt",
    generatedPrompt: "generated prompt",
    tags: ["水果", "图标"],
    metadata: { width: 1024, transparent: false },
    timezone: "Asia/Tokyo",
  });

  assert.match(markdown, /!\[Pink Guava\]\(https:\/\/cdn\.example\.com\/guava\.png\)/);
  assert.match(markdown, /original prompt/);
  assert.match(markdown, /generated prompt/);
  assert.match(markdown, /水果、图标/);
  assert.match(markdown, /width：1024/);
});
