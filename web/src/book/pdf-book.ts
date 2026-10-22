/** PDF에서 읽은 글·그림 위치를 장과 문장으로 나눈다. 쉬운 글은 비워 둔다. */

import {
  newId,
  normalizeFileName,
  splitSentences,
  stemOf,
  type Book,
  type BookResult,
  type Chapter,
  type ImageBlock,
  type ParagraphBlock,
  type Sentence,
} from "./model.ts";

export type PdfGlyph = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
};

export type PdfFigure = {
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
};

/** y는 페이지 맨 위부터의 거리다. */
export type PdfPage = {
  width: number;
  height: number;
  glyphs: PdfGlyph[];
  figures: PdfFigure[];
};

type Line = {
  text: string;
  x: number;
  y: number;
  x2: number;
  fontSize: number;
};

type Piece =
  | { kind: "line"; line: Line }
  | { kind: "figure"; figure: PdfFigure }
  | { kind: "break" };

const MAX_CHAPTERS = 200;
const MAX_SENTENCES = 2_000;
const MAX_IMAGE_URL = 4_000_000;

function sentence(text: string): Sentence {
  return {
    id: newId(),
    text: text.normalize("NFC"),
    easyText: "",
    confirmed: false,
    audioName: null,
    audioDataUrl: null,
  };
}

function linesFromGlyphs(glyphs: PdfGlyph[]): Line[] {
  const sorted = glyphs
    .filter((glyph) => glyph.text.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: PdfGlyph[][] = [];
  for (const glyph of sorted) {
    const group = groups[groups.length - 1];
    const head = group?.[0];
    const tail = group?.[group.length - 1];
    const tolerance = Math.max(2, (head?.fontSize || glyph.fontSize || 12) * 0.4);
    const tailEnd = tail ? tail.x + Math.max(tail.width, 0) : 0;
    const near =
      tail !== undefined && glyph.x - tailEnd < Math.max(36, (tail.fontSize || 12) * 2.5);
    if (group && head && tail && Math.abs(glyph.y - head.y) <= tolerance && near) group.push(glyph);
    else groups.push([glyph]);
  }
  const lines: Line[] = [];
  for (const group of groups) {
    const glyphsInLine = group.sort((a, b) => a.x - b.x);
    let text = "";
    let cursor = -Infinity;
    let x2 = 0;
    for (const glyph of glyphsInLine) {
      const width = glyph.width > 0 ? glyph.width : Math.max(glyph.fontSize, glyph.text.length * glyph.fontSize * 0.5);
      const gap = glyph.x - cursor;
      if (text && gap > Math.max(1.5, glyph.fontSize * 0.2)) text += " ";
      text += glyph.text;
      cursor = glyph.x + width;
      x2 = Math.max(x2, glyph.x + width);
    }
    const cleaned = text.replace(/\s+/g, " ").trim().normalize("NFC");
    if (!cleaned) continue;
    const first = glyphsInLine[0];
    if (!first) continue;
    lines.push({
      text: cleaned,
      x: first.x,
      y: first.y,
      x2,
      fontSize: Math.max(...glyphsInLine.map((glyph) => glyph.fontSize || 12)),
    });
  }
  return lines;
}

function columnSplit(lines: Line[]): { left: Line[]; right: Line[]; cut: number } | null {
  if (lines.length < 4) return null;
  const sorted = [...lines].sort((a, b) => a.x - b.x);
  let best: { gap: number; cut: number } | null = null;
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (!current || !next) continue;
    const gap = next.x - current.x2;
    if (gap < 36) continue;
    const cut = current.x2 + gap / 2;
    const left = lines.filter((line) => (line.x + line.x2) / 2 < cut);
    const right = lines.filter((line) => (line.x + line.x2) / 2 >= cut);
    if (left.length < 2 || right.length < 2) continue;
    if (left.length >= lines.length || right.length >= lines.length) continue;
    if (!best || gap > best.gap) best = { gap, cut };
  }
  if (!best) return null;
  return {
    cut: best.cut,
    left: lines.filter((line) => (line.x + line.x2) / 2 < best.cut),
    right: lines.filter((line) => (line.x + line.x2) / 2 >= best.cut),
  };
}

function orderPieces(lines: Line[], figures: PdfFigure[]): Piece[] {
  const split = columnSplit(lines);
  if (split) {
    const leftFigures = figures.filter((figure) => figure.x + figure.width / 2 < split.cut);
    const rightFigures = figures.filter((figure) => figure.x + figure.width / 2 >= split.cut);
    return [...orderPieces(split.left, leftFigures), ...orderPieces(split.right, rightFigures)];
  }
  const pieces: Array<{ kind: "line"; line: Line; y: number; x: number } | { kind: "figure"; figure: PdfFigure; y: number; x: number }> = [
    ...lines.map((line) => ({ kind: "line" as const, line, y: line.y, x: line.x })),
    ...figures.map((figure) => ({ kind: "figure" as const, figure, y: figure.y, x: figure.x })),
  ];
  pieces.sort((a, b) => a.y - b.y || a.x - b.x);
  return pieces.map((piece) =>
    piece.kind === "line" ? { kind: "line", line: piece.line } : { kind: "figure", figure: piece.figure },
  );
}

function keepFigure(figure: PdfFigure): boolean {
  if (Math.max(figure.width, figure.height) < 48) return false;
  if (!figure.dataUrl.startsWith("data:image/") || figure.dataUrl.length >= MAX_IMAGE_URL) return false;
  return true;
}

function median(values: number[]): number {
  if (!values.length) return 12;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 12;
}

function isHeading(line: Line, body: number): boolean {
  const length = Array.from(line.text).length;
  if (/^\d{1,2}\s+\S/u.test(line.text) && length <= 48) return true;
  return line.fontSize >= body * 1.35 && length <= 48;
}

function imageFileName(dataUrl: string, index: number): string {
  if (dataUrl.startsWith("data:image/png")) return `그림-${index}.png`;
  if (dataUrl.startsWith("data:image/webp")) return `그림-${index}.webp`;
  if (dataUrl.startsWith("data:image/gif")) return `그림-${index}.gif`;
  return `그림-${index}.jpg`;
}

export function bookFromPdfPages(pages: PdfPage[], fileName: string): BookResult {
  const pieces: Piece[] = [];
  for (const page of pages) {
    const lines = linesFromGlyphs(page.glyphs);
    const figures = page.figures.filter(keepFigure);
    pieces.push(...orderPieces(lines, figures));
    pieces.push({ kind: "break" });
  }
  const bodySize = median(
    pieces.flatMap((piece) => (piece.kind === "line" ? [piece.line.fontSize] : [])),
  );
  const sourceFileName = normalizeFileName(fileName);
  const title = stemOf(sourceFileName || "제목 없는 책");
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  let buffer: Line[] = [];
  let sentenceCount = 0;
  let imageCount = 0;

  function failIfHuge(): BookResult | null {
    if (chapters.length >= MAX_CHAPTERS || sentenceCount > MAX_SENTENCES) {
      return { error: "원고가 너무 길어 나누지 못했습니다. 장 수를 줄여 주세요." };
    }
    return null;
  }

  function ensureChapter(chapterTitle: string): Chapter | null {
    if (current) return current;
    const huge = failIfHuge();
    if (huge) return null;
    const chapter: Chapter = {
      id: newId(),
      title: chapterTitle.normalize("NFC").trim() || "본문",
      blocks: [],
    };
    chapters.push(chapter);
    current = chapter;
    return chapter;
  }

  function flushParagraph(): BookResult | null {
    const lines = buffer;
    buffer = [];
    if (!lines.length) return null;
    const chapter = ensureChapter("본문");
    if (!chapter) return { error: "원고가 너무 길어 나누지 못했습니다. 장 수를 줄여 주세요." };
    const joined = lines
      .map((line) => line.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const sentences = splitSentences(joined).map(sentence);
    sentenceCount += sentences.length;
    const huge = failIfHuge();
    if (huge) return huge;
    if (sentences.length) {
      const block: ParagraphBlock = { id: newId(), kind: "paragraph", sentences };
      chapter.blocks.push(block);
    }
    return null;
  }

  function startChapter(chapterTitle: string): BookResult | null {
    const flushed = flushParagraph();
    if (flushed) return flushed;
    const huge = failIfHuge();
    if (huge) return huge;
    const chapter: Chapter = {
      id: newId(),
      title: chapterTitle.normalize("NFC").trim() || "제목 없는 장",
      blocks: [],
    };
    chapters.push(chapter);
    current = chapter;
    return null;
  }

  let index = 0;
  while (index < pieces.length) {
    const piece = pieces[index];
    if (!piece || piece.kind === "break") {
      const flushed = flushParagraph();
      if (flushed) return flushed;
      index += 1;
      continue;
    }
    if (piece.kind === "figure") {
      const flushed = flushParagraph();
      if (flushed) return flushed;
      const chapter = ensureChapter("본문");
      if (!chapter) return { error: "원고가 너무 길어 나누지 못했습니다. 장 수를 줄여 주세요." };
      imageCount += 1;
      const block: ImageBlock = {
        id: newId(),
        kind: "image",
        fileName: imageFileName(piece.figure.dataUrl, imageCount),
        alt: "",
        easyAlt: "",
        dataUrl: piece.figure.dataUrl,
      };
      chapter.blocks.push(block);
      index += 1;
      continue;
    }
    if (isHeading(piece.line, bodySize)) {
      let heading = piece.line.text;
      let last = piece.line;
      index += 1;
      while (index < pieces.length) {
        const next = pieces[index];
        if (!next || next.kind !== "line" || !isHeading(next.line, bodySize)) break;
        if (next.line.y - last.y > last.fontSize * 1.8) break;
        if (next.line.x > last.x2 + 24) break;
        if (Math.abs(next.line.fontSize - last.fontSize) > 3) break;
        heading = `${heading} ${next.line.text}`;
        last = next.line;
        index += 1;
      }
      const started = startChapter(heading);
      if (started) return started;
      continue;
    }
    const previous = buffer[buffer.length - 1];
    const stacked = previous
      ? piece.line.y - previous.y > Math.max(previous.fontSize, piece.line.fontSize) * 2.2 ||
        piece.line.x > previous.x2 + 36
      : false;
    if (stacked) {
      const flushed = flushParagraph();
      if (flushed) return flushed;
    }
    buffer.push(piece.line);
    index += 1;
  }
  const tail = flushParagraph();
  if (tail) return tail;
  const hasBlock = chapters.some((chapter) => chapter.blocks.length > 0);
  if (!hasBlock) return { error: "PDF에서 글을 찾지 못했습니다." };

  const book: Book = {
    id: newId(),
    title,
    sourceFileName,
    chapters,
    updatedAt: new Date().toISOString(),
  };
  return book;
}
