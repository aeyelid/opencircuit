import assert from "node:assert/strict";
import test from "node:test";
import { cueDurationMs } from "./speech.ts";

test("읽기 시간은 글이 길면 늘고 빠르면 줄어든다", () => {
  const text = "문장을 읽는 시간입니다";
  assert.equal(cueDurationMs("", 1), 700);
  assert.ok(cueDurationMs(text, 1.5) < cueDurationMs(text, 1));
  assert.ok(cueDurationMs(text, 1) < cueDurationMs(text, 0.8));
  assert.equal(cueDurationMs(text, Number.NaN), cueDurationMs(text, 1));
  assert.ok(cueDurationMs("가".repeat(500), 0.5) <= 20_000);
});
