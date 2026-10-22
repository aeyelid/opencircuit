/** 듣는 책 제작 화면. 입력 중에는 한글 조합을 깨지 않도록 NFC로 바꾸지 않는다. */

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { renderPlayerHtml } from "./export-html.ts";
import {
  addChapter,
  addImage,
  addSentence,
  bookTitle,
  clampRate,
  flattenCues,
  isBook,
  moveBlock,
  moveChapter,
  moveSentence,
  normalizeBook,
  normalizeFileName,
  parseStoredText,
  playerFileName,
  projectFileName,
  RATES,
  serializeBook,
  removeChapter,
  removeImage,
  removeSentence,
  renameBook,
  renameChapter,
  sampleBook,
  spokenImage,
  spokenSentence,
  updateImage,
  updateSentence,
  type Book,
  type ImageBlock,
  type ParagraphBlock,
  type Sentence,
} from "./model.ts";
import { brochureBook } from "./brochure.ts";
import { startPlayback, watchVoices } from "./speech.ts";
import { loadStoredBook, loadStoredPrefs, saveStoredBook, saveStoredPrefs } from "./store.ts";
import "./book.css";

const MAX_AUDIO_URL = 6_000_000;
const MAX_IMAGE_URL = 4_000_000;

type Notice = { kind: "ok" | "err" | "idle"; text: string };

function nfc(value: string): string {
  return value.normalize("NFC");
}

function explain(error: string): string {
  if (error === "원고가 비어 있습니다.") {
    return "원고가 비어 있습니다. 글을 붙여 넣거나 다른 파일을 열어 주세요.";
  }
  return error;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("data"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.readAsDataURL(file);
  });
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function useBookSession() {
  const [book, setBook] = useState<Book | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<Notice>({ kind: "idle", text: "" });
  const [pending, setPending] = useState<Book | null>(null);
  const [cueId, setCueId] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [easy, setEasy] = useState(false);
  const [images, setImages] = useState(true);
  const [voiceURI, setVoiceURI] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [playing, setPlaying] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [canResume, setCanResume] = useState(false);

  const bookRef = useRef(book);
  const rateRef = useRef(rate);
  const easyRef = useRef(easy);
  const imagesRef = useRef(images);
  const voiceRef = useRef(voiceURI);
  const cueRef = useRef(cueId);
  const playingRef = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);
  const tokenRef = useRef(0);
  const brokenRef = useRef({ current: false });
  bookRef.current = book;
  rateRef.current = rate;
  easyRef.current = easy;
  imagesRef.current = images;
  voiceRef.current = voiceURI;
  cueRef.current = cueId;

  useEffect(() => watchVoices(setVoices), []);

  useEffect(() => {
    return () => {
      tokenRef.current += 1;
      stopRef.current?.();
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        const [stored, prefs] = await Promise.all([loadStoredBook(), loadStoredPrefs()]);
        if (cancel) return;
        setBook(stored ?? brochureBook());
        if (stored && prefs && prefs.bookId === stored.id) {
          rateRef.current = prefs.rate;
          setRate(prefs.rate);
          easyRef.current = prefs.easy;
          setEasy(prefs.easy);
          imagesRef.current = prefs.images;
          setImages(prefs.images);
          voiceRef.current = prefs.voiceURI;
          setVoiceURI(prefs.voiceURI);
          cueRef.current = prefs.cueId;
          setCueId(prefs.cueId);
          setCanResume(Boolean(prefs.cueId));
        }
      } catch {
        if (!cancel) {
          setNotice({
            kind: "err",
            text: "저장된 책을 열지 못했습니다. 원고를 다시 열거나 예시로 시작해 주세요.",
          });
        }
      } finally {
        if (!cancel) setReady(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !book) return;
    const timer = window.setTimeout(() => {
      void saveStoredBook(book).catch(() => {
        setNotice({
          kind: "err",
          text: "이 브라우저에 저장하지 못했습니다. 프로젝트 내려받기로 파일을 받아 두세요.",
        });
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [ready, book]);

  useEffect(() => {
    if (!ready || !book) return;
    const prefs = { bookId: book.id, cueId, rate, easy, images, voiceURI };
    const timer = window.setTimeout(() => {
      void saveStoredPrefs(prefs).catch(() => undefined);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [ready, book, cueId, rate, easy, images, voiceURI]);

  useEffect(() => {
    if (!cueId) return;
    document.getElementById(`cue-${cueId}`)?.scrollIntoView({ block: "nearest" });
  }, [cueId]);

  useEffect(() => {
    if (!book || !cueId) return;
    const cues = flattenCues(book, { easy, images });
    if (cues.some((cue) => cue.id === cueId)) return;
    const next = cues[0]?.id ?? null;
    cueRef.current = next;
    setCueId(next);
  }, [book, cueId, easy, images]);

  function cuesNow() {
    const current = bookRef.current;
    if (!current) return [];
    return flattenCues(current, { easy: easyRef.current, images: imagesRef.current });
  }

  function remember(id: string | null) {
    cueRef.current = id;
    setCueId(id);
  }

  function halt() {
    tokenRef.current += 1;
    stopRef.current?.();
    stopRef.current = null;
    playingRef.current = false;
    setPlaying(false);
  }

  async function run(fromId: string | null) {
    const token = ++tokenRef.current;
    stopRef.current?.();
    stopRef.current = null;
    playingRef.current = true;
    setPlaying(true);
    let id = fromId;
    while (token === tokenRef.current) {
      const cues = cuesNow();
      if (!cues.length) break;
      const found = id ? cues.findIndex((cue) => cue.id === id) : 0;
      const cue = found >= 0 ? cues[found] : cues[0];
      if (!cue) break;
      remember(cue.id);
      const handle = startPlayback({
        text: cue.spoken,
        audioDataUrl: cue.audioDataUrl,
        rate: rateRef.current,
        voiceURI: voiceRef.current,
        broken: brokenRef.current,
        onFallback: () => setFallback(true),
      });
      stopRef.current = handle.stop;
      const result = await handle.finished;
      if (token !== tokenRef.current) return;
      if (result !== "end") break;
      const fresh = cuesNow();
      const at = fresh.findIndex((item) => item.id === cue.id);
      const next = at >= 0 ? fresh[at + 1] : undefined;
      if (!next) break;
      id = next.id;
    }
    if (token === tokenRef.current) {
      playingRef.current = false;
      setPlaying(false);
    }
  }

  function playToggle() {
    if (playingRef.current) {
      halt();
      return;
    }
    void run(cueRef.current);
  }

  function step(dir: -1 | 1) {
    const cues = cuesNow();
    if (!cues.length) return;
    const found = cueRef.current ? cues.findIndex((cue) => cue.id === cueRef.current) : 0;
    const index = found >= 0 ? found : 0;
    const next = cues[Math.max(0, Math.min(cues.length - 1, index + dir))];
    if (!next || next.id === cueRef.current) return;
    remember(next.id);
    if (playingRef.current) void run(next.id);
  }

  function jumpChapter(chapterId: string) {
    const cue = cuesNow().find((item) => item.chapterId === chapterId);
    if (!cue) return;
    remember(cue.id);
    if (playingRef.current) void run(cue.id);
  }

  function applyMode(patch: { rate?: number; easy?: boolean; images?: boolean; voiceURI?: string }) {
    if (patch.rate !== undefined) {
      const next = clampRate(patch.rate);
      rateRef.current = next;
      setRate(next);
    }
    if (patch.easy !== undefined) {
      easyRef.current = patch.easy;
      setEasy(patch.easy);
    }
    if (patch.images !== undefined) {
      imagesRef.current = patch.images;
      setImages(patch.images);
    }
    if (patch.voiceURI !== undefined) {
      voiceRef.current = patch.voiceURI;
      setVoiceURI(patch.voiceURI);
    }
    const cues = cuesNow();
    if (cueRef.current && !cues.some((cue) => cue.id === cueRef.current)) {
      remember(cues[0]?.id ?? null);
    }
    if (playingRef.current) void run(cueRef.current);
  }

  function resetCursor() {
    halt();
    remember(null);
    setCanResume(false);
    brokenRef.current.current = false;
    setFallback(false);
  }

  function changeBook(change: (current: Book) => Book) {
    setBook((current) => (current ? change(current) : current));
  }

  function commitBook(next: Book, text: string) {
    resetCursor();
    setBook(next);
    setPending(null);
    setNotice({ kind: "ok", text });
    void saveStoredBook(next).catch(() => {
      setNotice({
        kind: "err",
        text: "이 브라우저에 저장하지 못했습니다. 프로젝트 내려받기로 파일을 받아 두세요.",
      });
    });
  }

  function stageText(text: string, fileName: string) {
    const result = parseStoredText(text, fileName);
    if (!isBook(result)) {
      setNotice({ kind: "err", text: explain(result.error) });
      return;
    }
    if (book) {
      setPending(result);
      return;
    }
    commitBook(result, "책을 열었습니다. 재생을 누르면 첫 문장부터 듣습니다.");
  }

  function requestSample() {
    const next = sampleBook();
    if (book) {
      setPending(next);
      return;
    }
    commitBook(next, "예시 「짧은 전시 안내」를 열었습니다. 재생을 누르면 듣습니다.");
  }

  function confirmPending() {
    if (!pending) return;
    commitBook(pending, "책을 바꿨습니다. 재생을 누르면 첫 문장부터 듣습니다.");
  }

  const cues = book ? flattenCues(book, { easy, images }) : [];
  const active = cues.find((cue) => cue.id === cueId) ?? null;
  const shown = active ?? cues[0] ?? null;
  const position = shown ? Math.max(0, cues.findIndex((cue) => cue.id === shown.id)) : 0;
  const hasKorean = voices.some((voice) => voice.lang.toLowerCase().startsWith("ko"));

  return {
    book,
    ready,
    notice,
    setNotice,
    pending,
    setPending,
    cueId,
    rate,
    easy,
    images,
    voiceURI,
    voices,
    playing,
    fallback,
    canResume,
    cues,
    active,
    shown,
    position,
    hasKorean,
    playToggle,
    step,
    jumpChapter,
    applyMode,
    changeBook,
    stageText,
    requestSample,
    confirmPending,
  };
}

function SentenceEditor({
  sentence,
  easy,
  current,
  canUp,
  canDown,
  onText,
  onEasyText,
  onMove,
  onRemove,
  onAudio,
  onClearAudio,
}: {
  sentence: Sentence;
  easy: boolean;
  current: boolean;
  canUp: boolean;
  canDown: boolean;
  onText: (value: string, commit: boolean) => void;
  onEasyText: (value: string, commit: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAudio: (file: File | undefined) => void;
  onClearAudio: () => void;
}) {
  const spoken = spokenSentence(sentence, easy);
  return (
    <div id={`cue-${sentence.id}`} className={current ? "book-card is-current" : "book-card"}>
      <p className="book-spoken">{spoken || "빈 문장입니다. 문장을 입력하세요."}</p>
      <label className="book-field">
        문장
        <textarea
          rows={2}
          value={sentence.text}
          onChange={(event) => onText(event.target.value, false)}
          onBlur={(event) => onText(event.target.value, true)}
        />
      </label>
      <label className="book-field">
        쉬운 글
        <textarea
          rows={2}
          value={sentence.easyText}
          onChange={(event) => onEasyText(event.target.value, false)}
          onBlur={(event) => onEasyText(event.target.value, true)}
        />
      </label>
      {sentence.audioName ? <p className="book-file">음성 파일 {sentence.audioName}</p> : null}
      <div className="book-card-actions">
        <button type="button" className="btn ghost" disabled={!canUp} onClick={() => onMove(-1)}>
          문장 위로
        </button>
        <button type="button" className="btn ghost" disabled={!canDown} onClick={() => onMove(1)}>
          문장 아래로
        </button>
        <label className="btn ghost book-file-btn">
          음성 넣기
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              onAudio(file);
            }}
          />
        </label>
        {sentence.audioName ? (
          <button type="button" className="btn ghost" onClick={onClearAudio}>
            음성 빼기
          </button>
        ) : null}
        <button type="button" className="btn ghost" onClick={onRemove}>
          문장 삭제
        </button>
      </div>
    </div>
  );
}

function ImageEditor({
  block,
  easy,
  current,
  canUp,
  canDown,
  onAlt,
  onEasyAlt,
  onName,
  onMove,
  onRemove,
  onFile,
}: {
  block: ImageBlock;
  easy: boolean;
  current: boolean;
  canUp: boolean;
  canDown: boolean;
  onAlt: (value: string, commit: boolean) => void;
  onEasyAlt: (value: string, commit: boolean) => void;
  onName: (value: string, commit: boolean) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onFile: (file: File | undefined) => void;
}) {
  const spoken = spokenImage(block, easy);
  return (
    <figure id={`cue-${block.id}`} className={current ? "book-card is-current" : "book-card"}>
      {block.dataUrl ? <img className="book-picture" src={block.dataUrl} alt={spoken || block.alt} /> : null}
      <p className="book-file">파일 이름 {block.fileName}</p>
      {spoken ? <p className="book-spoken">{spoken}</p> : <p className="book-spoken">그림 설명을 입력하세요.</p>}
      <label className="book-field">
        파일 이름
        <input
          type="text"
          value={block.fileName}
          onChange={(event) => onName(event.target.value, false)}
          onBlur={(event) => onName(event.target.value, true)}
        />
      </label>
      <label className="book-field">
        그림 설명
        <textarea
          rows={3}
          value={block.alt}
          onChange={(event) => onAlt(event.target.value, false)}
          onBlur={(event) => onAlt(event.target.value, true)}
        />
      </label>
      <label className="book-field">
        쉬운 그림 설명
        <textarea
          rows={2}
          value={block.easyAlt}
          onChange={(event) => onEasyAlt(event.target.value, false)}
          onBlur={(event) => onEasyAlt(event.target.value, true)}
        />
      </label>
      <div className="book-card-actions">
        <button type="button" className="btn ghost" disabled={!canUp} onClick={() => onMove(-1)}>
          블록 위로
        </button>
        <button type="button" className="btn ghost" disabled={!canDown} onClick={() => onMove(1)}>
          블록 아래로
        </button>
        <label className="btn ghost book-file-btn">
          그림 넣기
          <input
            type="file"
            accept="image/*,.png,.jpg,.jpeg,.svg,.webp,.gif"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              onFile(file);
            }}
          />
        </label>
        <button type="button" className="btn ghost" onClick={onRemove}>
          그림 삭제
        </button>
      </div>
    </figure>
  );
}

export function BookStudio() {
  const session = useBookSession();
  const [draft, setDraft] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    book,
    ready,
    notice,
    setNotice,
    pending,
    setPending,
    cueId,
    rate,
    easy,
    images,
    voiceURI,
    voices,
    playing,
    fallback,
    canResume,
    cues,
    shown,
    position,
    hasKorean,
    playToggle,
    step,
    jumpChapter,
    applyMode,
    changeBook,
    stageText,
    requestSample,
    confirmPending,
  } = session;

  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    document.title = book ? `${bookTitle(book)} — 듣는 책` : "듣는 책";
  }, [book]);

  async function onOpenFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      stageText(text, normalizeFileName(file.name));
    } catch {
      setNotice({
        kind: "err",
        text: "파일을 읽지 못했습니다. 텍스트 원고나 저장한 프로젝트인지 확인해 주세요.",
      });
    }
  }

  async function onAudio(sentenceId: string, file: File | undefined) {
    if (!file) return;
    const named = normalizeFileName(file.name);
    const looksAudio = file.type.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|aac|flac)$/iu.test(named);
    if (!looksAudio) {
      setNotice({ kind: "err", text: "음성 파일이 아닙니다. mp3, wav, m4a 파일을 넣어 주세요." });
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      if (!dataUrl.startsWith("data:audio/") || dataUrl.length >= MAX_AUDIO_URL) {
        setNotice({ kind: "err", text: "음성 파일이 너무 큽니다. 더 짧은 mp3나 wav를 넣어 주세요." });
        return;
      }
      changeBook((current) => updateSentence(current, sentenceId, { audioName: named, audioDataUrl: dataUrl }));
      setNotice({ kind: "ok", text: `이 문장에 ${named} 음성을 넣었습니다.` });
    } catch {
      setNotice({ kind: "err", text: "음성 파일을 읽지 못했습니다. 다른 파일로 다시 넣어 주세요." });
    }
  }

  async function onImageFile(imageId: string, file: File | undefined) {
    if (!file) return;
    const named = normalizeFileName(file.name) || "그림";
    const looksImage = file.type.startsWith("image/") || /\.(png|jpe?g|svg|webp|gif)$/iu.test(named);
    if (!looksImage) {
      setNotice({ kind: "err", text: "그림 파일이 아닙니다. png, jpg, svg, webp 파일을 넣어 주세요." });
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      if (!dataUrl.startsWith("data:image/") || dataUrl.length >= MAX_IMAGE_URL) {
        setNotice({ kind: "err", text: "그림이 너무 큽니다. 더 작은 파일을 넣어 주세요." });
        return;
      }
      changeBook((current) => updateImage(current, imageId, { dataUrl, fileName: named }));
      setNotice({ kind: "ok", text: `그림 파일을 ${named} 로 넣었습니다.` });
    } catch {
      setNotice({ kind: "err", text: "그림 파일을 읽지 못했습니다. 다른 파일로 다시 넣어 주세요." });
    }
  }

  function exportJson() {
    if (!book) return;
    const clean = normalizeBook(book);
    downloadText(projectFileName(clean), serializeBook(clean), "application/json");
  }

  function exportHtml() {
    if (!book) return;
    const clean = normalizeBook(book);
    downloadText(playerFileName(clean), renderPlayerHtml(clean), "text/html");
  }

  const playLabel = playing ? "일시정지" : canResume && cueId ? "이어 듣기" : "재생";
  const showPaste = pasteOpen || !book;

  if (!ready) {
    return (
      <main className="book-studio">
        <Link className="book-back" to="/">
          장면으로
        </Link>
        <p className="status" role="status">
          저장된 책을 불러오는 중입니다.
        </p>
      </main>
    );
  }

  return (
    <main className="book-studio">
      <header className="book-top">
        <div className="book-heading">
          <h1>듣는 책</h1>
          <Link className="book-back" to="/">
            장면으로
          </Link>
        </div>
        <p className="book-honest">
          이 화면은 브라우저에서 만들고 듣는 제작기입니다. 같은 프로젝트 파일을 Windows와 Mac에서 엽니다. 한글 파일
          이름은 화면과 내려받기에서 맞춰 보여 줍니다. DAISY나 EPUB 파일은 만들지 않습니다.
        </p>
        {book ? (
          <label className="book-field">
            책 제목
            <input
              type="text"
              value={book.title}
              onChange={(event) => changeBook((current) => renameBook(current, event.target.value))}
              onBlur={(event) => changeBook((current) => renameBook(current, nfc(event.target.value)))}
            />
          </label>
        ) : null}
        {book?.sourceFileName ? <p className="book-source">파일 {book.sourceFileName}</p> : null}
        <div className="book-toolbar">
          <button type="button" className="btn" onClick={requestSample}>
            예시 열기
          </button>
          <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>
            원고 열기
          </button>
          <button type="button" className="btn ghost" onClick={() => setPasteOpen((open) => !open)}>
            원고 붙여넣기
          </button>
          <button type="button" className="btn ghost" disabled={!book} onClick={exportJson}>
            프로젝트 내려받기
          </button>
          <button type="button" className="btn ghost" disabled={!book} onClick={exportHtml}>
            HTML 플레이어 내려받기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.json,text/plain,text/markdown,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void onOpenFile(file);
            }}
          />
        </div>
      </header>
      {notice.text ? (
        <p className={`status${notice.kind === "ok" ? " ok" : notice.kind === "err" ? " err" : ""}`} role="status">
          {notice.text}
        </p>
      ) : null}
      {pending ? (
        <div className="book-confirm" role="alert">
          <p>지금 연 책을 바꿉니다. 저장하지 않은 편집은 사라집니다. 필요하면 먼저 프로젝트를 내려받으세요.</p>
          <button type="button" className="btn" onClick={confirmPending}>
            바꾸기
          </button>
          <button type="button" className="btn ghost" onClick={() => setPending(null)}>
            취소
          </button>
        </div>
      ) : null}
      {showPaste ? (
        <div className="book-paste">
          <label className="book-field">
            원고
            <textarea
              rows={6}
              value={draft}
              placeholder="# 은 책 제목, ## 은 장입니다. 그림은 ![설명](파일 이름) 으로 적습니다."
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <div className="book-inline">
            <button type="button" className="btn" onClick={() => stageText(draft, "")}>
              이 원고로 만들기
            </button>
          </div>
        </div>
      ) : null}
      {!book ? (
        <p className="book-empty">원고를 붙여 넣거나 파일을 열면 장과 문장으로 나눕니다. 예시로 먼저 들어 볼 수도 있습니다.</p>
      ) : (
        <div className="book-columns">
          <nav className="book-col" aria-label="목차">
            <h2>목차</h2>
            <ol className="book-toc">
              {book.chapters.map((chapter) => (
                <li key={chapter.id}>
                  <button
                    type="button"
                    aria-current={shown?.chapterId === chapter.id ? "true" : undefined}
                    onClick={() => {
                      jumpChapter(chapter.id);
                      document.getElementById(`chap-${chapter.id}`)?.scrollIntoView({ block: "start" });
                    }}
                  >
                    {chapter.title || "제목 없는 장"}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <section className="book-col" aria-label="본문">
            <h2>본문</h2>
            {book.chapters.map((chapter, chapterIndex) => (
              <section className="book-chapter" id={`chap-${chapter.id}`} key={chapter.id}>
                <label className="book-field">
                  장 제목
                  <input
                    type="text"
                    value={chapter.title}
                    onChange={(event) =>
                      changeBook((current) => renameChapter(current, chapter.id, event.target.value))
                    }
                    onBlur={(event) =>
                      changeBook((current) => renameChapter(current, chapter.id, nfc(event.target.value)))
                    }
                  />
                </label>
                <div className="book-card-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={chapterIndex === 0}
                    onClick={() => changeBook((current) => moveChapter(current, chapter.id, -1))}
                  >
                    장 위로
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={chapterIndex === book.chapters.length - 1}
                    onClick={() => changeBook((current) => moveChapter(current, chapter.id, 1))}
                  >
                    장 아래로
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={book.chapters.length < 2}
                    onClick={() => changeBook((current) => removeChapter(current, chapter.id))}
                  >
                    장 삭제
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => changeBook((current) => addSentence(current, chapter.id, null))}
                  >
                    문장 추가
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() =>
                      changeBook((current) =>
                        addImage(
                          current,
                          chapter.id,
                          { fileName: "그림", alt: "", easyAlt: "", dataUrl: "" },
                          null,
                        ),
                      )
                    }
                  >
                    그림 칸 추가
                  </button>
                </div>
                {chapter.blocks.map((block, blockIndex) => {
                  if (block.kind === "image") {
                    return (
                      <ImageEditor
                        key={block.id}
                        block={block}
                        easy={easy}
                        current={cueId === block.id}
                        canUp={blockIndex > 0}
                        canDown={blockIndex < chapter.blocks.length - 1}
                        onAlt={(value, commit) =>
                          changeBook((current) =>
                            updateImage(current, block.id, { alt: commit ? nfc(value) : value }),
                          )
                        }
                        onEasyAlt={(value, commit) =>
                          changeBook((current) =>
                            updateImage(current, block.id, { easyAlt: commit ? nfc(value) : value }),
                          )
                        }
                        onName={(value, commit) =>
                          changeBook((current) =>
                            updateImage(current, block.id, {
                              fileName: commit ? nfc(value) || "그림" : value,
                            }),
                          )
                        }
                        onMove={(dir) => changeBook((current) => moveBlock(current, block.id, dir))}
                        onRemove={() => changeBook((current) => removeImage(current, block.id))}
                        onFile={(file) => void onImageFile(block.id, file)}
                      />
                    );
                  }
                  return (
                    <ParagraphEditor
                      key={block.id}
                      block={block}
                      easy={easy}
                      cueId={cueId}
                      canUp={blockIndex > 0}
                      canDown={blockIndex < chapter.blocks.length - 1}
                      onMoveBlock={(dir) => changeBook((current) => moveBlock(current, block.id, dir))}
                      onText={(sentenceId, value, commit) =>
                        changeBook((current) =>
                          updateSentence(current, sentenceId, { text: commit ? nfc(value) : value }),
                        )
                      }
                      onEasyText={(sentenceId, value, commit) =>
                        changeBook((current) =>
                          updateSentence(current, sentenceId, { easyText: commit ? nfc(value) : value }),
                        )
                      }
                      onMoveSentence={(sentenceId, dir) =>
                        changeBook((current) => moveSentence(current, sentenceId, dir))
                      }
                      onRemove={(sentenceId) => changeBook((current) => removeSentence(current, sentenceId))}
                      onAudio={(sentenceId, file) => void onAudio(sentenceId, file)}
                      onClearAudio={(sentenceId) =>
                        changeBook((current) =>
                          updateSentence(current, sentenceId, { audioName: null, audioDataUrl: null }),
                        )
                      }
                    />
                  );
                })}
              </section>
            ))}
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                changeBook((current) => addChapter(current, current.chapters.at(-1)?.id ?? null).book)
              }
            >
              장 추가
            </button>
          </section>
          <aside className="book-col book-listen" aria-label="듣기">
            <h2>듣기</h2>
            <div className="book-controls">
              <button type="button" className="btn" disabled={cues.length === 0} onClick={playToggle} aria-pressed={playing}>
                {playLabel}
              </button>
              <button type="button" className="btn ghost" disabled={cues.length === 0 || position <= 0} onClick={() => step(-1)}>
                이전
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={cues.length === 0 || position >= cues.length - 1}
                onClick={() => step(1)}
              >
                다음
              </button>
              <label className="book-rate">
                속도
                <select
                  aria-label="속도"
                  value={String(rate)}
                  onChange={(event) => applyMode({ rate: Number(event.target.value) })}
                >
                  {RATES.map((item) => (
                    <option key={item} value={String(item)}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="book-check">
                <input type="checkbox" checked={easy} onChange={(event) => applyMode({ easy: event.target.checked })} />
                쉬운 글
              </label>
              <label className="book-check">
                <input
                  type="checkbox"
                  checked={images}
                  onChange={(event) => applyMode({ images: event.target.checked })}
                />
                그림 설명
              </label>
            </div>
            {voices.length > 0 ? (
              <label className="book-field">
                목소리
                <select
                  aria-label="목소리"
                  value={voiceURI}
                  onChange={(event) => applyMode({ voiceURI: event.target.value })}
                >
                  <option value="">한국어 기본</option>
                  {voiceURI && !voices.some((voice) => voice.voiceURI === voiceURI) ? (
                    <option value={voiceURI}>저장된 목소리</option>
                  ) : null}
                  {voices.map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <p className="book-file">지금 읽는 문장</p>
            {shown ? (
              <p className="book-now" id="now-reading">
                {shown.spoken}
              </p>
            ) : (
              <p className="book-now">읽을 문장이 없습니다. 문장을 입력하거나 그림 설명을 켜 주세요.</p>
            )}
            {cues.length > 0 ? (
              <p className="book-file">
                {position + 1} / {cues.length}
                {shown ? ` · ${shown.chapterTitle}` : ""}
              </p>
            ) : null}
            {canResume && !playing && cueId ? (
              <p className="book-resume">마지막으로 듣던 문장입니다. 이어 듣기를 누르면 여기서 읽습니다.</p>
            ) : null}
            {fallback ? (
              <p className="book-fallback">이 브라우저는 음성을 바로 끝내 읽는 시간만 맞춥니다. 한국어 음성이 있는 브라우저에서 들립니다.</p>
            ) : null}
            {voices.length > 0 && !hasKorean ? (
              <p className="book-fallback">이 브라우저에 한국어 음성이 없으면 읽는 시간만 맞추고 다음 문장으로 넘어갑니다.</p>
            ) : null}
          </aside>
        </div>
      )}
    </main>
  );
}

function ParagraphEditor({
  block,
  easy,
  cueId,
  canUp,
  canDown,
  onMoveBlock,
  onText,
  onEasyText,
  onMoveSentence,
  onRemove,
  onAudio,
  onClearAudio,
}: {
  block: ParagraphBlock;
  easy: boolean;
  cueId: string | null;
  canUp: boolean;
  canDown: boolean;
  onMoveBlock: (dir: -1 | 1) => void;
  onText: (sentenceId: string, value: string, commit: boolean) => void;
  onEasyText: (sentenceId: string, value: string, commit: boolean) => void;
  onMoveSentence: (sentenceId: string, dir: -1 | 1) => void;
  onRemove: (sentenceId: string) => void;
  onAudio: (sentenceId: string, file: File | undefined) => void;
  onClearAudio: (sentenceId: string) => void;
}) {
  return (
    <div className="book-card">
      <div className="book-card-actions">
        <button type="button" className="btn ghost" disabled={!canUp} onClick={() => onMoveBlock(-1)}>
          블록 위로
        </button>
        <button type="button" className="btn ghost" disabled={!canDown} onClick={() => onMoveBlock(1)}>
          블록 아래로
        </button>
      </div>
      {block.sentences.map((sentence, index) => (
        <SentenceEditor
          key={sentence.id}
          sentence={sentence}
          easy={easy}
          current={cueId === sentence.id}
          canUp={index > 0}
          canDown={index < block.sentences.length - 1}
          onText={(value, commit) => onText(sentence.id, value, commit)}
          onEasyText={(value, commit) => onEasyText(sentence.id, value, commit)}
          onMove={(dir) => onMoveSentence(sentence.id, dir)}
          onRemove={() => onRemove(sentence.id)}
          onAudio={(file) => onAudio(sentence.id, file)}
          onClearAudio={() => onClearAudio(sentence.id)}
        />
      ))}
    </div>
  );
}
