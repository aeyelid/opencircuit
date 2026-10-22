/** 듣는 책 원고·목차·파일 이름. 브라우저 DOM에 의존하지 않는다. */

export const BOOK_FORMAT = "opencircuit.listening-book" as const;
export const BOOK_VERSION = 1;

export type Sentence = {
  id: string;
  text: string;
  easyText: string;
  audioName: string | null;
  audioDataUrl: string | null;
};

export type ParagraphBlock = {
  id: string;
  kind: "paragraph";
  sentences: Sentence[];
};

export type ImageBlock = {
  id: string;
  kind: "image";
  fileName: string;
  alt: string;
  easyAlt: string;
  dataUrl: string;
};

export type Block = ParagraphBlock | ImageBlock;

export type Chapter = {
  id: string;
  title: string;
  blocks: Block[];
};

export type Book = {
  id: string;
  title: string;
  sourceFileName: string | null;
  chapters: Chapter[];
  updatedAt: string;
};

export type BookFile = {
  format: typeof BOOK_FORMAT;
  version: number;
  book: Book;
};

export type BookResult = Book | { error: string };

export type ListenPrefs = {
  bookId: string;
  cueId: string | null;
  rate: number;
  easy: boolean;
  images: boolean;
  voiceURI: string;
};

export type Cue = {
  id: string;
  chapterId: string;
  chapterTitle: string;
  chapterIndex: number;
  kind: "sentence" | "image";
  spoken: string;
  audioDataUrl: string | null;
};

export const RATES = [0.8, 1, 1.25, 1.5] as const;

const MAX_MANUSCRIPT = 400_000;
const MAX_CHAPTERS = 200;
const MAX_SENTENCES = 2_000;
const MAX_AUDIO_URL = 6_000_000;
const MAX_IMAGE_URL = 4_000_000;

export function isBook(result: BookResult): result is Book {
  return !("error" in result);
}

export function newId(): string {
  return crypto.randomUUID();
}

/** 화면·저장·내려받기에 쓰는 이름. 맥(NFD)과 윈도우(NFC)를 NFC로 맞춘다. */
export function normalizeFileName(name: string): string {
  const trimmed = name.trim();
  const base = trimmed.split(/[/\\]/).pop() ?? trimmed;
  return base.normalize("NFC");
}

export function stemOf(name: string): string {
  const base = normalizeFileName(name);
  const stripped = base.replace(/\.[^.]+$/u, "");
  return stripped || base;
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 한글·띄어쓰기·괄호는 남기고, 윈도우에서 파일 이름이 될 수 없는 문자만 뺀다. */
export function downloadFileName(name: string, fallback: string): string {
  let s = normalizeFileName(name);
  s = s.replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ");
  s = s.replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  if (!s || s === "." || s === ".." || RESERVED.test(s)) s = fallback;
  const chars = Array.from(s);
  if (chars.length > 80) s = chars.slice(0, 80).join("").trim().replace(/[. ]+$/g, "");
  return s || fallback;
}

export function bookTitle(book: Book): string {
  const title = book.title.normalize("NFC").trim();
  return title || "제목 없는 책";
}

export function projectFileName(book: Book): string {
  const raw = book.sourceFileName ? stemOf(book.sourceFileName) : bookTitle(book);
  return `${downloadFileName(raw, "듣는책")}.듣는책.json`;
}

export function playerFileName(book: Book): string {
  const raw = book.sourceFileName ? stemOf(book.sourceFileName) : bookTitle(book);
  return `${downloadFileName(raw, "듣는책")}.html`;
}

function touch(book: Book): Book {
  return { ...book, updatedAt: new Date().toISOString() };
}

function emptySentence(): Sentence {
  return {
    id: newId(),
    text: "",
    easyText: "",
    audioName: null,
    audioDataUrl: null,
  };
}

function paragraph(sentences: Sentence[]): ParagraphBlock {
  return { id: newId(), kind: "paragraph", sentences };
}

export function splitSentences(paragraphText: string): string[] {
  const text = paragraphText.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const chars = Array.from(text);
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? "";
    buf += ch;
    const end = ".!?。？！…".includes(ch);
    if (!end) continue;
    const next = chars[i + 1];
    const prev = chars[i - 1];
    if (ch === "." && prev && /\d/u.test(prev) && next && /\d/u.test(next)) continue;
    if (
      next !== undefined &&
      !/\s/u.test(next) &&
      !/[가-힣A-Za-z「『"'(]/u.test(next)
    ) {
      continue;
    }
    const sentence = buf.trim();
    if (sentence) out.push(sentence);
    buf = "";
    if (next && /\s/u.test(next)) i += 1;
  }
  const rest = buf.trim();
  if (rest) out.push(rest);
  return out;
}

function sentencesFromParagraph(text: string): Sentence[] {
  return splitSentences(text).map((line) => ({
    id: newId(),
    text: line,
    easyText: "",
    audioName: null,
    audioDataUrl: null,
  }));
}

function imageFileName(raw: string): string {
  const cleaned = raw.trim().replace(/^<|>$/g, "");
  const noQuery = cleaned.split("?")[0] ?? cleaned;
  let decoded = noQuery;
  try {
    decoded = decodeURIComponent(noQuery);
  } catch {
    decoded = noQuery;
  }
  return normalizeFileName(decoded) || "그림";
}

export function bookFromManuscript(text: string, fileName: string | null): BookResult {
  const clean = text.replace(/^\uFEFF/u, "").normalize("NFC");
  if (!clean.trim()) return { error: "원고가 비어 있습니다." };
  if (clean.length > MAX_MANUSCRIPT) {
    return { error: "원고가 너무 깁니다. 짧은 원고로 먼저 만들어 보세요." };
  }

  const lines = clean.split(/\r\n|\n|\r/u);
  let h1 = 0;
  let h2 = 0;
  for (const line of lines) {
    if (/^##\s+\S/u.test(line)) h2 += 1;
    else if (/^#\s+\S/u.test(line)) h1 += 1;
  }
  const leadingH1IsTitle = h2 > 0 || h1 === 1;

  const sourceFileName = fileName ? normalizeFileName(fileName) : null;
  let title = sourceFileName ? stemOf(sourceFileName) : "제목 없는 책";
  let usedTitleHeading = false;
  const chapters: Chapter[] = [];
  let current: Chapter | null = null;
  let linesBuf: string[] = [];
  let sentenceCount = 0;

  function failIfHuge(): { error: string } | null {
    if (chapters.length >= MAX_CHAPTERS || sentenceCount > MAX_SENTENCES) {
      return { error: "원고가 너무 길어 나누지 못했습니다. 장 수를 줄여 주세요." };
    }
    return null;
  }

  function startChapter(chapterTitle: string): Chapter | { error: string } {
    const huge = failIfHuge();
    if (huge) return huge;
    const chapter: Chapter = {
      id: newId(),
      title: chapterTitle.normalize("NFC").trim() || "제목 없는 장",
      blocks: [],
    };
    chapters.push(chapter);
    current = chapter;
    return chapter;
  }

  function flushParagraph(): BookResult | null {
    const joined = linesBuf.join(" ").replace(/\s+/g, " ").trim();
    linesBuf = [];
    if (!joined || !current) return null;
    const sentences = sentencesFromParagraph(joined);
    sentenceCount += sentences.length;
    const huge = failIfHuge();
    if (huge) return huge;
    if (sentences.length) current.blocks.push(paragraph(sentences));
    return null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "---" || line === "***") {
      const flushed = flushParagraph();
      if (flushed) return flushed;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading) {
      const flushed = flushParagraph();
      if (flushed) return flushed;
      const level = heading[1]?.length ?? 1;
      const headingTitle = heading[2]?.trim() ?? "";
      if (level === 1 && leadingH1IsTitle && !usedTitleHeading) {
        usedTitleHeading = true;
        title = headingTitle.normalize("NFC").trim() || title;
        continue;
      }
      const started = startChapter(headingTitle);
      if ("error" in started) return started;
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/u.exec(line);
    if (image && linesBuf.length === 0) {
      if (!current) {
        const started = startChapter("본문");
        if ("error" in started) return started;
        current = started;
      }
      current.blocks.push({
        id: newId(),
        kind: "image",
        fileName: imageFileName(image[2] ?? ""),
        alt: (image[1] ?? "").trim().normalize("NFC"),
        easyAlt: "",
        dataUrl: "",
      });
      continue;
    }
    if (!current) {
      const started = startChapter("본문");
      if ("error" in started) return started;
      current = started;
    }
    linesBuf.push(line);
  }
  const tail = flushParagraph();
  if (tail) return tail;
  if (!chapters.length) {
    const started = startChapter("본문");
    if ("error" in started) return started;
  }

  return {
    id: newId(),
    title,
    sourceFileName,
    chapters,
    updatedAt: new Date().toISOString(),
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isAudioData(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:audio/") && value.length < MAX_AUDIO_URL;
}

function isImageData(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/") && value.length < MAX_IMAGE_URL;
}

function coerceSentence(raw: unknown): Sentence | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!isString(row.id) || !isString(row.text)) return null;
  return {
    id: row.id,
    text: row.text.normalize("NFC"),
    easyText: isString(row.easyText) ? row.easyText.normalize("NFC") : "",
    audioName: isString(row.audioName) && row.audioName.trim() ? normalizeFileName(row.audioName) : null,
    audioDataUrl: isAudioData(row.audioDataUrl) ? row.audioDataUrl : null,
  };
}

function coerceBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.kind === "image") {
    if (!isString(row.id)) return null;
    return {
      id: row.id,
      kind: "image",
      fileName: isString(row.fileName) ? normalizeFileName(row.fileName) || "그림" : "그림",
      alt: isString(row.alt) ? row.alt.normalize("NFC") : "",
      easyAlt: isString(row.easyAlt) ? row.easyAlt.normalize("NFC") : "",
      dataUrl: isImageData(row.dataUrl) ? row.dataUrl : "",
    };
  }
  if (row.kind !== "paragraph" || !isString(row.id) || !Array.isArray(row.sentences)) return null;
  const sentences = row.sentences.map(coerceSentence).filter((s): s is Sentence => s !== null);
  return { id: row.id, kind: "paragraph", sentences };
}

export function normalizeBook(book: Book): Book {
  return {
    ...book,
    title: book.title.normalize("NFC"),
    sourceFileName: book.sourceFileName ? normalizeFileName(book.sourceFileName) : null,
    chapters: book.chapters.map((chapter) => ({
      ...chapter,
      title: chapter.title.normalize("NFC"),
      blocks: chapter.blocks.map((block) => {
        if (block.kind === "image") {
          return {
            ...block,
            fileName: normalizeFileName(block.fileName) || "그림",
            alt: block.alt.normalize("NFC"),
            easyAlt: block.easyAlt.normalize("NFC"),
          };
        }
        return {
          ...block,
          sentences: block.sentences.map((sentence) => ({
            ...sentence,
            text: sentence.text.normalize("NFC"),
            easyText: sentence.easyText.normalize("NFC"),
            audioName: sentence.audioName ? normalizeFileName(sentence.audioName) : null,
          })),
        };
      }),
    })),
  };
}

function coerceBook(raw: unknown): Book | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!isString(row.id) || !isString(row.title) || !Array.isArray(row.chapters)) return null;
  const chapters: Chapter[] = [];
  for (const chapterRaw of row.chapters) {
    if (!chapterRaw || typeof chapterRaw !== "object") return null;
    const chapter = chapterRaw as Record<string, unknown>;
    if (!isString(chapter.id) || !isString(chapter.title) || !Array.isArray(chapter.blocks)) return null;
    const blocks = chapter.blocks.map(coerceBlock).filter((block): block is Block => block !== null);
    chapters.push({
      id: chapter.id,
      title: chapter.title.normalize("NFC"),
      blocks,
    });
  }
  if (!chapters.length) return null;
  return normalizeBook({
    id: row.id,
    title: row.title,
    sourceFileName: isString(row.sourceFileName) ? row.sourceFileName : null,
    chapters,
    updatedAt: isString(row.updatedAt) ? row.updatedAt : new Date().toISOString(),
  });
}

export function coerceStored(raw: unknown): Book | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.format === BOOK_FORMAT && row.book) return coerceBook(row.book);
  return coerceBook(raw);
}

export function serializeBook(book: Book): string {
  const file: BookFile = {
    format: BOOK_FORMAT,
    version: BOOK_VERSION,
    book: normalizeBook(book),
  };
  return JSON.stringify(file, null, 2);
}

export function parseStoredText(text: string, fileName: string): BookResult {
  const clean = text.replace(/^\uFEFF/u, "");
  if (clean.trim().startsWith("{")) {
    try {
      const book = coerceStored(JSON.parse(clean) as unknown);
      if (!book) {
        return {
          error: "듣는 책 파일이 아닙니다. 이 제작기에서 저장한 프로젝트이거나, 원고 텍스트여야 합니다.",
        };
      }
      return book;
    } catch {
      return { error: "파일을 읽지 못했습니다. 글자가 깨지지 않았는지 확인해 주세요." };
    }
  }
  return bookFromManuscript(clean, fileName);
}

export function clampRate(rate: number): number {
  let nearest: number = RATES[1];
  let gap = Infinity;
  for (const item of RATES) {
    const next = Math.abs(item - rate);
    if (next < gap) {
      gap = next;
      nearest = item;
    }
  }
  return nearest;
}

export function coercePrefs(raw: unknown): ListenPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!isString(row.bookId)) return null;
  const rate = typeof row.rate === "number" ? clampRate(row.rate) : 1;
  return {
    bookId: row.bookId,
    cueId: isString(row.cueId) ? row.cueId : null,
    rate,
    easy: row.easy === true,
    images: row.images !== false,
    voiceURI: isString(row.voiceURI) ? row.voiceURI : "",
  };
}

export function spokenSentence(sentence: Sentence, easy: boolean): string {
  if (easy && sentence.easyText.trim()) return sentence.easyText.trim();
  return sentence.text.trim();
}

export function spokenImage(image: ImageBlock, easy: boolean): string {
  if (easy && image.easyAlt.trim()) return image.easyAlt.trim();
  return image.alt.trim();
}

export function flattenCues(book: Book, mode: { easy: boolean; images: boolean }): Cue[] {
  const cues: Cue[] = [];
  book.chapters.forEach((chapter, index) => {
    for (const block of chapter.blocks) {
      if (block.kind === "image") {
        if (!mode.images) continue;
        const spoken = spokenImage(block, mode.easy);
        if (!spoken) continue;
        cues.push({
          id: block.id,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterIndex: index + 1,
          kind: "image",
          spoken,
          audioDataUrl: null,
        });
        continue;
      }
      for (const sentence of block.sentences) {
        const spoken = spokenSentence(sentence, mode.easy);
        if (!spoken) continue;
        const easyReplacesAudio = mode.easy && sentence.easyText.trim().length > 0;
        cues.push({
          id: sentence.id,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterIndex: index + 1,
          kind: "sentence",
          spoken,
          audioDataUrl: easyReplacesAudio ? null : sentence.audioDataUrl,
        });
      }
    }
  });
  return cues;
}

export type Location =
  | { kind: "sentence"; chapter: Chapter; block: ParagraphBlock; sentence: Sentence }
  | { kind: "image"; chapter: Chapter; block: ImageBlock }
  | { kind: "chapter"; chapter: Chapter };

export function locate(book: Book, id: string): Location | null {
  for (const chapter of book.chapters) {
    if (chapter.id === id) return { kind: "chapter", chapter };
    for (const block of chapter.blocks) {
      if (block.kind === "image") {
        if (block.id === id) return { kind: "image", chapter, block };
        continue;
      }
      if (block.id === id) continue;
      for (const sentence of block.sentences) {
        if (sentence.id === id) return { kind: "sentence", chapter, block, sentence };
      }
    }
  }
  return null;
}

export function renameBook(book: Book, title: string): Book {
  return touch({ ...book, title });
}

export function renameChapter(book: Book, chapterId: string, title: string): Book {
  return touch({
    ...book,
    chapters: book.chapters.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, title } : chapter,
    ),
  });
}

export function updateSentence(
  book: Book,
  sentenceId: string,
  patch: Partial<Pick<Sentence, "text" | "easyText" | "audioName" | "audioDataUrl">>,
): Book {
  let hit = false;
  const chapters = book.chapters.map((chapter) => ({
    ...chapter,
    blocks: chapter.blocks.map((block) => {
      if (block.kind !== "paragraph") return block;
      return {
        ...block,
        sentences: block.sentences.map((sentence) => {
          if (sentence.id !== sentenceId) return sentence;
          hit = true;
          return { ...sentence, ...patch };
        }),
      };
    }),
  }));
  return hit ? touch({ ...book, chapters }) : book;
}

export function updateImage(
  book: Book,
  imageId: string,
  patch: Partial<Pick<ImageBlock, "fileName" | "alt" | "easyAlt" | "dataUrl">>,
): Book {
  let hit = false;
  const chapters = book.chapters.map((chapter) => ({
    ...chapter,
    blocks: chapter.blocks.map((block) => {
      if (block.kind !== "image" || block.id !== imageId) return block;
      hit = true;
      return { ...block, ...patch };
    }),
  }));
  return hit ? touch({ ...book, chapters }) : book;
}

function swap<T>(items: T[], index: number, dir: -1 | 1): T[] | null {
  const next = index + dir;
  if (index < 0 || next < 0 || next >= items.length) return null;
  const copy = items.slice();
  const item = copy[index];
  copy[index] = copy[next] as T;
  copy[next] = item as T;
  return copy;
}

export function moveChapter(book: Book, chapterId: string, dir: -1 | 1): Book {
  const index = book.chapters.findIndex((chapter) => chapter.id === chapterId);
  const chapters = swap(book.chapters, index, dir);
  return chapters ? touch({ ...book, chapters }) : book;
}

export function moveBlock(book: Book, blockId: string, dir: -1 | 1): Book {
  let hit = false;
  const chapters = book.chapters.map((chapter) => {
    const index = chapter.blocks.findIndex((block) => block.id === blockId);
    const blocks = swap(chapter.blocks, index, dir);
    if (!blocks) return chapter;
    hit = true;
    return { ...chapter, blocks };
  });
  return hit ? touch({ ...book, chapters }) : book;
}

export function moveSentence(book: Book, sentenceId: string, dir: -1 | 1): Book {
  let hit = false;
  const chapters = book.chapters.map((chapter) => ({
    ...chapter,
    blocks: chapter.blocks.map((block) => {
      if (block.kind !== "paragraph") return block;
      const index = block.sentences.findIndex((sentence) => sentence.id === sentenceId);
      const sentences = swap(block.sentences, index, dir);
      if (!sentences) return block;
      hit = true;
      return { ...block, sentences };
    }),
  }));
  return hit ? touch({ ...book, chapters }) : book;
}

export function removeSentence(book: Book, sentenceId: string): Book {
  let hit = false;
  const chapters = book.chapters.map((chapter) => ({
    ...chapter,
    blocks: chapter.blocks.flatMap((block): Block[] => {
      if (block.kind !== "paragraph") return [block];
      const sentences = block.sentences.filter((sentence) => {
        if (sentence.id !== sentenceId) return true;
        hit = true;
        return false;
      });
      if (!sentences.length) return [];
      const next: ParagraphBlock = { ...block, sentences };
      return [next];
    }),
  }));
  return hit ? touch({ ...book, chapters }) : book;
}

export function removeImage(book: Book, imageId: string): Book {
  let hit = false;
  const chapters = book.chapters.map((chapter) => ({
    ...chapter,
    blocks: chapter.blocks.filter((block) => {
      if (block.kind === "image" && block.id === imageId) {
        hit = true;
        return false;
      }
      return true;
    }),
  }));
  return hit ? touch({ ...book, chapters }) : book;
}

export function removeChapter(book: Book, chapterId: string): Book {
  if (book.chapters.length < 2) return book;
  const chapters = book.chapters.filter((chapter) => chapter.id !== chapterId);
  if (chapters.length === book.chapters.length) return book;
  return touch({ ...book, chapters });
}

export function addChapter(book: Book, afterChapterId: string | null): { book: Book; id: string } {
  const chapter: Chapter = {
    id: newId(),
    title: "새 장",
    blocks: [paragraph([emptySentence()])],
  };
  const index = book.chapters.findIndex((item) => item.id === afterChapterId);
  const chapters = book.chapters.slice();
  chapters.splice(index >= 0 ? index + 1 : chapters.length, 0, chapter);
  return { book: touch({ ...book, chapters }), id: chapter.id };
}

export function addSentence(book: Book, chapterId: string, afterSentenceId: string | null): Book {
  const sentence = emptySentence();
  const chapters = book.chapters.map((chapter) => {
    if (chapter.id !== chapterId) return chapter;
    if (afterSentenceId) {
      let inserted = false;
      const blocks = chapter.blocks.map((block) => {
        if (block.kind !== "paragraph" || inserted) return block;
        const index = block.sentences.findIndex((item) => item.id === afterSentenceId);
        if (index < 0) return block;
        inserted = true;
        const sentences = block.sentences.slice();
        sentences.splice(index + 1, 0, sentence);
        return { ...block, sentences };
      });
      if (inserted) return { ...chapter, blocks };
    }
    const blocks = chapter.blocks.slice();
    const last = blocks[blocks.length - 1];
    if (last && last.kind === "paragraph") {
      blocks[blocks.length - 1] = { ...last, sentences: [...last.sentences, sentence] };
    } else {
      blocks.push(paragraph([sentence]));
    }
    return { ...chapter, blocks };
  });
  return touch({ ...book, chapters });
}

export function addImage(
  book: Book,
  chapterId: string,
  image: Omit<ImageBlock, "id" | "kind">,
  afterBlockId: string | null,
): Book {
  const block: ImageBlock = { ...image, id: newId(), kind: "image" };
  const chapters = book.chapters.map((chapter) => {
    if (chapter.id !== chapterId) return chapter;
    const blocks = chapter.blocks.slice();
    const index = afterBlockId ? blocks.findIndex((item) => item.id === afterBlockId) : -1;
    blocks.splice(index >= 0 ? index + 1 : blocks.length, 0, block);
    return { ...chapter, blocks };
  });
  return touch({ ...book, chapters });
}

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#f6f6f6"/>
  <circle cx="320" cy="150" r="68" fill="none" stroke="#111111" stroke-width="8"/>
  <line x1="230" y1="268" x2="410" y2="268" stroke="#111111" stroke-width="8" stroke-linecap="round"/>
</svg>`;

export function sampleImageUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SAMPLE_SVG)}`;
}

export function sampleBook(): Book {
  const sentence = (
    id: string,
    text: string,
    easyText: string,
  ): Sentence => ({
    id,
    text,
    easyText,
    audioName: null,
    audioDataUrl: null,
  });
  return {
    id: "sample-book",
    title: "짧은 전시 안내",
    sourceFileName: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    chapters: [
      {
        id: "sample-ch-1",
        title: "들어가는 말",
        blocks: [
          paragraph([
            sentence(
              "sample-s-1",
              "이 글은 전시장에서 작품 설명을 찾아 듣기 위한 짧은 예시입니다.",
              "이것은 전시 설명을 듣는 짧은 예시입니다.",
            ),
            sentence(
              "sample-s-2",
              "목차에서 작품 이름을 고르면, 그 설명으로 바로 이동합니다.",
              "왼쪽 목록에서 고르면 그 부분으로 갑니다.",
            ),
            sentence(
              "sample-s-3",
              "문장이 읽히는 동안 그 문장이 표시됩니다.",
              "읽는 문장이 색으로 표시됩니다.",
            ),
          ]),
        ],
      },
      {
        id: "sample-ch-2",
        title: "검은 원",
        blocks: [
          {
            id: "sample-img-1",
            kind: "image",
            fileName: "검은 원.svg",
            alt: "흰 바탕 가운데에 검은 선으로 그린 원이 있고, 그 아래 짧은 가로선이 있습니다. 원은 작품이 놓인 자리이고, 선은 관람 동선입니다.",
            easyAlt: "하얀 바탕에 검은 동그라미와 짧은 줄이 있습니다.",
            dataUrl: sampleImageUrl(),
          },
          paragraph([
            sentence(
              "sample-s-4",
              "관람객은 원 앞에서 멈추고 이 설명을 듣습니다.",
              "동그라미 앞에서 멈추고 설명을 듣습니다.",
            ),
            sentence(
              "sample-s-5",
              "그림 설명은 그림 자리에서 함께 읽히며, 듣기에서 뺄 수도 있습니다.",
              "그림 설명은 들을 수도 있고, 빼 놓을 수도 있습니다.",
            ),
          ]),
        ],
      },
      {
        id: "sample-ch-3",
        title: "다시 듣기",
        blocks: [
          paragraph([
            sentence(
              "sample-s-6",
              "끝까지 듣지 않아도 됩니다. 필요한 작품만 고르면 됩니다.",
              "전부 듣지 않아도 됩니다. 필요한 것만 고르세요.",
            ),
            sentence(
              "sample-s-7",
              "창을 닫았다가 다시 열면, 마지막으로 듣던 문장부터 이어 듣습니다.",
              "나중에 다시 열면, 듣던 곳부터 이어집니다.",
            ),
          ]),
        ],
      },
    ],
  };
}
