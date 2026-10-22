import assert from "node:assert/strict";
import test from "node:test";
import { brochureBook, BROCHURE_SOURCE_FILE_NAME } from "./brochure.ts";

const SOURCE = "위케이션 브로슈어(한글)-압축됨.pdf";

test("위케이션 브로슈어가 듣는 책의 첫 원고다", () => {
  const book = brochureBook();
  assert.ok(book.title.trim().length > 0);
  assert.ok(book.chapters.length >= 2);
  assert.equal(book.sourceFileName, SOURCE);
  assert.equal(book.sourceFileName, SOURCE.normalize("NFC"));
  assert.equal(book.sourceFileName, BROCHURE_SOURCE_FILE_NAME);
  assert.notEqual(book.sourceFileName, SOURCE.normalize("NFD"));

  const sentences = book.chapters.flatMap((chapter) =>
    chapter.blocks.flatMap((block) => (block.kind === "paragraph" ? block.sentences : [])),
  );
  assert.ok(sentences.length >= 2);
  for (const sentence of sentences) {
    assert.ok(sentence.text.trim().length > 0);
    assert.equal(sentence.text, sentence.text.normalize("NFC"));
    assert.match(sentence.text, /[가-힣]/u);
    assert.equal(sentence.text.includes("\uFFFD"), false);
    assert.doesNotMatch(sentence.text, /(?:Ã.|ì.|ê.|ë.)/u);
    assert.equal(sentence.easyText, "");
  }
});
