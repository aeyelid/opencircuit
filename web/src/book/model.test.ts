import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { renderPlayerHtml } from "./export-html.ts";
import {
  bookFromManuscript,
  coerceStored,
  downloadFileName,
  flattenCues,
  isBook,
  locate,
  moveBlock,
  playerFileName,
  projectFileName,
  sampleBook,
  serializeBook,
  splitSentences,
  updateImage,
  updateSentence,
  type Book,
} from "./model.ts";

function asBook(result: Book | { error: string }): Book {
  assert.equal(isBook(result), true);
  if (!isBook(result)) throw new Error(result.error);
  return result;
}

test("NFD 파일 이름은 NFC 내려받기 이름이 된다", () => {
  const composed = "짧은 전시.md";
  const decomposed = composed.normalize("NFD");
  assert.notEqual(decomposed, composed);
  assert.equal(downloadFileName("검은 원.svg".normalize("NFD"), "듣는책"), "검은 원.svg");
  const book = asBook(bookFromManuscript("# 제목\n\n한 문장입니다.", decomposed));
  assert.equal(book.sourceFileName, composed);
  assert.notEqual(book.id, book.sourceFileName);
  assert.equal(projectFileName(book), "짧은 전시.듣는책.json");
  assert.equal(playerFileName(book), "짧은 전시.html");
  const stored = JSON.parse(serializeBook(book)) as { book: { sourceFileName: string } };
  stored.book.sourceFileName = "검은 원.md".normalize("NFD");
  const again = coerceStored(stored);
  assert.equal(again?.sourceFileName, "검은 원.md");
});

test("윈도우에서 쓸 수 없는 문자만 빠진다", () => {
  assert.equal(downloadFileName('안내<>:"|?*문', "듣는책"), "안내 문");
  assert.equal(downloadFileName("안내.\u0000", "듣는책"), "안내");
});

test("예약된 장치 이름은 내려받기 이름으로 쓰지 않는다", () => {
  assert.equal(downloadFileName("CON", "듣는책"), "듣는책");
  assert.equal(downloadFileName("lpt1", "듣는책"), "듣는책");
  const book = asBook(bookFromManuscript("# 제목\n\n한 문장입니다.", "NUL.md"));
  assert.equal(projectFileName(book), "듣는책.듣는책.json");
});

test("문장 나누기는 소수를 문장 끝으로 보지 않는다", () => {
  assert.deepEqual(splitSentences("버전 1.25 입니다. 다음 문장입니다."), [
    "버전 1.25 입니다.",
    "다음 문장입니다.",
  ]);
  assert.deepEqual(splitSentences("값은 3.14입니다."), ["값은 3.14입니다."]);
});

test("제목과 장 표시를 구분한다", () => {
  const onlyTitle = asBook(bookFromManuscript("# 짧은 전시 안내\n\n첫 문장입니다.", null));
  assert.equal(onlyTitle.title, "짧은 전시 안내");
  assert.deepEqual(onlyTitle.chapters.map((chapter) => chapter.title), ["본문"]);

  const chapters = asBook(bookFromManuscript("# 첫째 장\n\n하나 입니다.\n\n# 둘째 장\n\n둘 입니다.\n", null));
  assert.equal(chapters.title, "제목 없는 책");
  assert.deepEqual(chapters.chapters.map((chapter) => chapter.title), ["첫째 장", "둘째 장"]);

  const nested = asBook(
    bookFromManuscript("# 전시\n\n## 들어가는 말\n\n문장입니다.\n\n## 검은 원\n\n또 문장입니다.\n", "원고.md"),
  );
  assert.equal(nested.title, "전시");
  assert.deepEqual(nested.chapters.map((chapter) => chapter.title), ["들어가는 말", "검은 원"]);
});

test("그림 마크다운의 파일 이름을 NFC로 보관한다", () => {
  const encoded = asBook(
    bookFromManuscript("# 제목\n\n## 작품\n\n![동그라미](%EA%B2%80%EC%9D%80%20%EC%9B%90.svg)\n", null),
  );
  const fromEncoded = encoded.chapters[0]?.blocks[0];
  assert.equal(fromEncoded?.kind, "image");
  if (fromEncoded?.kind === "image") {
    assert.equal(fromEncoded.fileName, "검은 원.svg");
    assert.equal(fromEncoded.alt, "동그라미");
    assert.notEqual(fromEncoded.id, fromEncoded.fileName);
  }

  const decomposed = "검은 원.svg".normalize("NFD");
  const book = asBook(bookFromManuscript(`# 제목\n\n## 작품\n\n![동그라미](${decomposed})\n`, null));
  const image = book.chapters[0]?.blocks[0];
  assert.equal(image?.kind, "image");
  if (image?.kind === "image") assert.equal(image.fileName, "검은 원.svg");
});

test("쉬운 글이고 그림 설명이 꺼지면 그 순서로 읽는다", () => {
  const book = updateSentence(sampleBook(), "sample-s-1", {
    audioDataUrl: "data:audio/mpeg;base64,QQQ=",
    audioName: "첫.mp3",
  });
  const cues = flattenCues(book, { easy: true, images: false });
  assert.deepEqual(cues.map((cue) => cue.id), [
    "sample-s-1",
    "sample-s-2",
    "sample-s-3",
    "sample-s-4",
    "sample-s-5",
    "sample-s-6",
    "sample-s-7",
  ]);
  assert.ok(cues.every((cue) => cue.kind === "sentence"));
  assert.equal(cues[0]?.spoken, "이것은 전시 설명을 듣는 짧은 예시입니다.");
  assert.equal(cues[0]?.audioDataUrl, null);
  const withImage = flattenCues(sampleBook(), { easy: false, images: true });
  assert.equal(withImage[3]?.id, "sample-img-1");
  assert.equal(withImage[3]?.kind, "image");
});

test("블록을 옮기면 읽는 순서가 바뀐다", () => {
  const book = sampleBook();
  const moved = moveBlock(book, "sample-img-1", 1);
  assert.deepEqual(
    flattenCues(book, { easy: false, images: true }).map((cue) => cue.id),
    ["sample-s-1", "sample-s-2", "sample-s-3", "sample-img-1", "sample-s-4", "sample-s-5", "sample-s-6", "sample-s-7"],
  );
  assert.deepEqual(
    flattenCues(moved, { easy: false, images: true }).map((cue) => cue.id),
    ["sample-s-1", "sample-s-2", "sample-s-3", "sample-s-4", "sample-s-5", "sample-img-1", "sample-s-6", "sample-s-7"],
  );
});

test("저장했다가 열면 안전하지 않은 데이터 주소는 빠진다", () => {
  const dirty = updateImage(
    updateSentence(sampleBook(), "sample-s-1", {
      audioName: "안내.mp3".normalize("NFD"),
      audioDataUrl: "data:text/html,<script>alert(1)</script>",
    }),
    "sample-img-1",
    { dataUrl: `data:image/png,${"A".repeat(4_000_000)}` },
  );
  const again = coerceStored(JSON.parse(serializeBook(dirty)) as unknown);
  assert.ok(again);
  if (!again) return;
  const sentence = locate(again, "sample-s-1");
  assert.equal(sentence?.kind, "sentence");
  if (sentence?.kind === "sentence") {
    assert.equal(sentence.sentence.audioDataUrl, null);
    assert.equal(sentence.sentence.audioName, "안내.mp3");
  }
  const image = locate(again, "sample-img-1");
  assert.equal(image?.kind, "image");
  if (image?.kind === "image") assert.equal(image.block.dataUrl, "");

  const kept = coerceStored(
    JSON.parse(
      serializeBook(
        updateSentence(sampleBook(), "sample-s-2", { audioDataUrl: "data:audio/mpeg;base64,QQQ=" }),
      ),
    ) as unknown,
  );
  assert.ok(kept);
  if (!kept) return;
  const audio = locate(kept, "sample-s-2");
  assert.equal(audio?.kind, "sentence");
  if (audio?.kind === "sentence") assert.equal(audio.sentence.audioDataUrl, "data:audio/mpeg;base64,QQQ=");
  const picture = locate(kept, "sample-img-1");
  if (picture?.kind === "image") assert.equal(picture.block.dataUrl.startsWith("data:image/svg+xml"), true);
});

test("플레이어 HTML은 스크립트를 끊는 본문을 이스케이프한다", () => {
  const book = asBook(
    bookFromManuscript("# 제목 </script>\n\n본문 </script><script>alert(1) 입니다.", "a.md"),
  );
  const html = renderPlayerHtml(book);
  assert.equal(html.match(/<\/script>/gi)?.length, 1);
  assert.equal(html.includes("</script><script>"), false);
  assert.equal(html.includes("<script src"), false);
  assert.match(html, /목차/);
  assert.match(html, /쉬운 글/);
  assert.match(html, /그림 설명/);
  const script = html.slice(html.indexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
  assert.equal(script.includes("</script>"), false);
  new vm.Script(script);
});

test("빈 원고는 다시 열라는 오류를 낸다", () => {
  const result = bookFromManuscript(" \n\t", null);
  assert.equal(isBook(result), false);
  if (!isBook(result)) assert.equal(result.error, "원고가 비어 있습니다.");
});
