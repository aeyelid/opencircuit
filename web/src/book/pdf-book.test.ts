import assert from "node:assert/strict";
import test from "node:test";
import { brochureBook } from "./brochure.ts";
import { renderPlayerHtml } from "./export-html.ts";
import { linkParts } from "./links.ts";
import {
  coerceStored,
  locate,
  playerFileName,
  serializeBook,
  updateSentence,
} from "./model.ts";
import { bookFromPdfBytes } from "./pdf-read.ts";
import { bookFromPdfPages, type PdfPage } from "./pdf-book.ts";

const SOURCE = "위케이션 브로슈어(한글)-압축됨.pdf";

test("문장 안의 https 주소만 링크가 된다", () => {
  assert.deepEqual(linkParts("주소는 https://m.site.naver.com/2ipzz 입니다."), [
    { kind: "text", text: "주소는 " },
    { kind: "link", text: "https://m.site.naver.com/2ipzz", href: "https://m.site.naver.com/2ipzz" },
    { kind: "text", text: " 입니다." },
  ]);
  assert.deepEqual(linkParts("코드의 주소는 https://m.site.naver.com/28B0C 입니다."), [
    { kind: "text", text: "코드의 주소는 " },
    { kind: "link", text: "https://m.site.naver.com/28B0C", href: "https://m.site.naver.com/28B0C" },
    { kind: "text", text: " 입니다." },
  ]);
  assert.deepEqual(linkParts("홈페이지는 wecation.kr입니다."), [
    { kind: "text", text: "홈페이지는 wecation.kr입니다." },
  ]);
});

test("확인함은 저장되고 쉬운 글은 비어 있다", () => {
  const marked = updateSentence(brochureBook(), "wec-s-name", { confirmed: true });
  const again = coerceStored(JSON.parse(serializeBook(marked)) as unknown);
  assert.ok(again);
  if (!again) return;
  const hit = locate(again, "wec-s-name");
  assert.equal(hit?.kind, "sentence");
  if (hit?.kind === "sentence") {
    assert.equal(hit.sentence.confirmed, true);
    assert.equal(hit.sentence.easyText, "");
    assert.equal(hit.sentence.text, "위케이션 WECATION.");
  }
  const other = locate(again, "wec-s-co");
  if (other?.kind === "sentence") assert.equal(other.sentence.confirmed, false);

  const raw = JSON.parse(serializeBook(brochureBook())) as { book: { chapters: Array<{ blocks: Array<{ sentences?: Array<Record<string, unknown>> }> }> } };
  const first = raw.book.chapters[0]?.blocks.find((block) => block.sentences)?.sentences?.[0];
  assert.ok(first);
  if (!first) return;
  delete first.confirmed;
  const restored = coerceStored(raw);
  const sentence = restored ? locate(restored, "wec-s-name") : null;
  if (sentence?.kind === "sentence") {
    assert.equal(sentence.sentence.confirmed, false);
    assert.equal(sentence.sentence.easyText, "");
  }
});

test("플레이어 HTML은 제목, 파일 이름, 장, 확인한 문장을 담는다", () => {
  const book = updateSentence(brochureBook(), "wec-s-name", { confirmed: true });
  const html = renderPlayerHtml(book);
  assert.match(html, /위케이션 WECATION/);
  assert.match(html, /파일 위케이션 브로슈어\(한글\)-압축됨\.pdf/);
  for (const chapter of book.chapters) assert.ok(html.includes(chapter.title));
  assert.match(html, /위케이션 WECATION\./);
  assert.match(html, /확인함/);
  assert.match(html, /href="https:\/\/m\.site\.naver\.com\/2ipzz"/);
  assert.match(html, /href="https:\/\/m\.site\.naver\.com\/28B0C"/);
  assert.equal(playerFileName(book), `${SOURCE.replace(/\.pdf$/u, "")}.html`);
  assert.equal(html.includes("DAISY나 EPUB으로 내보낸 파일이 아닙니다."), true);
});

function glyph(text: string, x: number, y: number, fontSize = 12, width = text.length * fontSize * 0.5) {
  return { text, x, y, width, fontSize };
}

test("PDF 배치는 파일 이름을 NFC로 두고 장과 그림을 나눈다", () => {
  const page: PdfPage = {
    width: 600,
    height: 800,
    glyphs: [
      glyph("왼쪽 첫 문장입니다.", 20, 40, 12, 140),
      glyph("오른쪽 첫 문장입니다.", 320, 40, 12, 150),
      glyph("왼쪽 둘째 문장입니다.", 20, 70, 12, 150),
      glyph("오른쪽 둘째 문장입니다.", 320, 70, 12, 160),
      glyph("01 현장", 20, 120, 12, 70),
      glyph("조사 장면입니다.", 20, 146, 12, 120),
    ],
    figures: [
      { x: 20, y: 180, width: 120, height: 80, dataUrl: "data:image/jpeg;base64,QQ==" },
      { x: 20, y: 190, width: 12, height: 12, dataUrl: "data:image/png;base64,QQ==" },
    ],
  };
  const result = bookFromPdfPages([page], SOURCE.normalize("NFD"));
  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.equal(result.sourceFileName, SOURCE);
  assert.equal(result.title, "위케이션 브로슈어(한글)-압축됨");
  assert.ok(result.chapters.some((chapter) => chapter.title.includes("현장")));
  const texts = result.chapters.flatMap((chapter) =>
    chapter.blocks.flatMap((block) => (block.kind === "paragraph" ? block.sentences.map((sentence) => sentence.text) : [])),
  );
  const left = texts.indexOf("왼쪽 첫 문장입니다.");
  const leftNext = texts.indexOf("왼쪽 둘째 문장입니다.");
  const right = texts.indexOf("오른쪽 첫 문장입니다.");
  assert.ok(left >= 0 && leftNext > left && right > leftNext);
  const images = result.chapters.flatMap((chapter) => chapter.blocks.filter((block) => block.kind === "image"));
  assert.equal(images.length, 1);
  for (const chapter of result.chapters) {
    for (const block of chapter.blocks) {
      if (block.kind !== "paragraph") continue;
      for (const sentence of block.sentences) {
        assert.equal(sentence.easyText, "");
        assert.equal(sentence.confirmed, false);
      }
    }
  }
});

function pdfBytes(stream: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 520] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(body).length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = new TextEncoder().encode(body).length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index++) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}

test("PDF 바이트에서 장과 문장을 읽는다", async () => {
  const bytes = pdfBytes(
    [
      "BT /F1 12 Tf 40 470 Td (01 Hall) Tj ET",
      "BT /F1 12 Tf 40 440 Td (First sentence.) Tj ET",
      "BT /F1 12 Tf 40 390 Td (02 Yard) Tj ET",
      "BT /F1 12 Tf 40 360 Td (Second sentence.) Tj ET",
    ].join("\n"),
  );
  const result = await bookFromPdfBytes(bytes, "notes.pdf");
  assert.equal("error" in result, false);
  if ("error" in result) return;
  assert.equal(result.sourceFileName, "notes.pdf");
  assert.equal(result.title, "notes");
  assert.ok(result.chapters.length >= 2);
  const texts = result.chapters.flatMap((chapter) =>
    chapter.blocks.flatMap((block) => (block.kind === "paragraph" ? block.sentences.map((sentence) => sentence.text) : [])),
  );
  assert.ok(texts.some((text) => text.includes("First sentence")));
  assert.ok(texts.some((text) => text.includes("Second sentence")));
  assert.ok(result.chapters.some((chapter) => chapter.title.includes("Hall")));
  assert.ok(result.chapters.some((chapter) => chapter.title.includes("Yard")));
});
