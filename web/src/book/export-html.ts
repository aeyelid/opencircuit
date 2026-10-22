/** 듣는 책 HTML 플레이어. 앱 없이 브라우저에서 열리는 파일이다. */

import { linkParts } from "./links.ts";
import { bookTitle, normalizeBook, spokenSentence, type Book } from "./model.ts";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const PLAYER_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #fff;
  color: #111;
  font-family: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif;
  line-height: 1.55;
}
.skip {
  position: absolute;
  left: 12px;
  top: -40px;
  background: #111;
  color: #fff;
  padding: 8px 12px;
  border-radius: 8px;
  z-index: 2;
}
.skip:focus { top: 12px; }
.wrap { width: min(960px, calc(100% - 28px)); margin: 0 auto; padding: 18px 0 48px; }
.mark { margin: 0; color: #8a8a8a; font-size: 0.78rem; letter-spacing: 0.04em; }
h1 { margin: 4px 0 8px; font-size: 1.6rem; line-height: 1.3; }
.source { margin: 0 0 12px; color: #5c5c5c; }
.sentence a, .image a { color: #111; }
.ok {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e7f6e7;
  font-size: 0.78rem;
}
.honest { margin: 0 0 16px; color: #5c5c5c; font-size: 0.9rem; }
.layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; align-items: start; }
.toc, .chapter, .image, .controls {
  border: 1px solid #ebebeb;
  border-radius: 12px;
  background: #fff;
}
.toc { padding: 12px; }
.toc h2, .chapter h3 { margin: 0 0 8px; font-size: 0.95rem; }
.toc ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.toc button, .controls button, .sentence {
  font: inherit;
}
.toc button {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  color: #111;
}
.toc button[aria-current="true"] { background: #fff6e8; box-shadow: inset 3px 0 0 #111; }
.toc button:hover { background: #f7f7f7; }
.main { min-width: 0; display: grid; gap: 12px; }
.controls {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px;
}
.controls button, .check, .rate {
  min-height: 38px;
  border-radius: 8px;
  border: 1px solid #d6d6d6;
  background: #fff;
  color: #111;
  padding: 8px 12px;
  cursor: pointer;
}
.controls button { background: #111; color: #fff; border-color: transparent; }
#play { background: #111; color: #fff; }
.controls button:disabled { opacity: 0.38; cursor: not-allowed; }
.check, .rate { display: inline-flex; align-items: center; gap: 6px; }
.rate select { font: inherit; border: 0; background: transparent; }
#now { margin: 0; min-height: 1.4em; color: #5c5c5c; }
.chapter { padding: 12px 14px; }
.sentence, .image { display: block; margin: 8px 0; padding: 8px 10px; border-radius: 8px; }
.sentence { border: 1px solid transparent; cursor: pointer; }
.sentence.current, .image.current { background: #fff6e8; box-shadow: inset 4px 0 0 #111; }
.image.off { opacity: 0.55; }
.image img { display: block; width: 100%; max-height: 280px; object-fit: contain; background: #f6f6f6; border-radius: 8px; }
.file { display: block; color: #5c5c5c; font-size: 0.85rem; margin-bottom: 4px; }
.image p, .chapter p { margin: 0; }
button:focus-visible, select:focus-visible, input:focus-visible, .sentence:focus-visible {
  outline: 2px solid #111;
  outline-offset: 2px;
}
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .controls { position: static; }
}
`;

const PLAYER_JS = `
(function () {
  var book = __BOOK_JSON__;
  var rates = [0.8, 1, 1.25, 1.5];
  var audioEl = null;
  var wakes = [];
  var state = {
    easy: false,
    images: true,
    rate: 1,
    index: 0,
    playing: false,
    broken: false,
    token: 0,
    resumed: false
  };

  function byId(id) { return document.getElementById(id); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function appendLinked(parent, text) {
    var raw = String(text || "");
    var cursor = 0;
    var stop = " \\t\\n\\r<>" + String.fromCharCode(34) + "'";
    while (cursor < raw.length) {
      var start = raw.indexOf("https://", cursor);
      if (start < 0) {
        parent.appendChild(document.createTextNode(raw.slice(cursor)));
        return;
      }
      if (start > cursor) parent.appendChild(document.createTextNode(raw.slice(cursor, start)));
      var end = start + "https://".length;
      while (end < raw.length && stop.indexOf(raw.charAt(end)) < 0) end += 1;
      var href = raw.slice(start, end);
      while (href.length && ".,);:]}>".indexOf(href.charAt(href.length - 1)) >= 0) href = href.slice(0, -1);
      if (href.length <= "https://".length) {
        parent.appendChild(document.createTextNode("https://"));
        cursor = start + "https://".length;
        continue;
      }
      var anchor = document.createElement("a");
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = href;
      parent.appendChild(anchor);
      cursor = start + href.length;
    }
  }
  function storageKey() { return "opencircuit-listen:" + book.id; }
  function speechAvailable() {
    return "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
  }
  function durationMs(text, rate) {
    var safe = isFinite(rate) && rate > 0 ? Math.min(2, Math.max(0.5, rate)) : 1;
    var chars = Math.max(1, Array.from(String(text)).length);
    return Math.max(700, Math.min(20000, Math.round((chars * 160) / safe)));
  }
  function nearestRate(rate) {
    var best = 1;
    var gap = Infinity;
    var i;
    for (i = 0; i < rates.length; i++) {
      var next = Math.abs(rates[i] - rate);
      if (next < gap) { gap = next; best = rates[i]; }
    }
    return best;
  }
  function spokenSentence(sentence) {
    if (state.easy && sentence.easyText && String(sentence.easyText).trim()) return String(sentence.easyText).trim();
    return String(sentence.text || "").trim();
  }
  function spokenImage(image) {
    if (state.easy && image.easyAlt && String(image.easyAlt).trim()) return String(image.easyAlt).trim();
    return String(image.alt || "").trim();
  }
  function collect() {
    var list = [];
    var ci, bi, si, chapter, block, sentence, spoken;
    for (ci = 0; ci < book.chapters.length; ci++) {
      chapter = book.chapters[ci];
      for (bi = 0; bi < chapter.blocks.length; bi++) {
        block = chapter.blocks[bi];
        if (block.kind === "image") {
          if (!state.images) continue;
          spoken = spokenImage(block);
          if (!spoken) continue;
          list.push({ id: block.id, chapterId: chapter.id, kind: "image", spoken: spoken, audio: null });
          continue;
        }
        for (si = 0; si < block.sentences.length; si++) {
          sentence = block.sentences[si];
          spoken = spokenSentence(sentence);
          if (!spoken) continue;
          list.push({
            id: sentence.id,
            chapterId: chapter.id,
            kind: "sentence",
            spoken: spoken,
            audio: state.easy && sentence.easyText && String(sentence.easyText).trim() ? null : (sentence.audioDataUrl || null)
          });
        }
      }
    }
    return list;
  }
  function currentCue() {
    var cues = collect();
    if (!cues.length) return null;
    if (state.index < 0 || state.index >= cues.length) return cues[0];
    return cues[state.index];
  }
  function save() {
    var cue = currentCue();
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
        cueId: cue ? cue.id : null,
        rate: state.rate,
        easy: state.easy,
        images: state.images
      }));
    } catch (err) {}
  }
  function loadPrefs() {
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return;
      var prefs = JSON.parse(raw);
      if (!prefs || typeof prefs !== "object") return;
      if (typeof prefs.rate === "number") state.rate = nearestRate(prefs.rate);
      state.easy = prefs.easy === true;
      state.images = prefs.images !== false;
      if (typeof prefs.cueId === "string" && prefs.cueId) {
        var cues = collect();
        var i;
        for (i = 0; i < cues.length; i++) {
          if (cues[i].id === prefs.cueId) {
            state.index = i;
            state.resumed = true;
            break;
          }
        }
      }
    } catch (err) {}
  }
  function stopMedia() {
    var pending = wakes.splice(0, wakes.length);
    var i;
    for (i = 0; i < pending.length; i++) pending[i]();
    if (audioEl) {
      audioEl.pause();
      audioEl = null;
    }
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (err) {}
  }
  function later(ms, token) {
    return new Promise(function (resolve) {
      var done = false;
      var id = 0;
      function finish() {
        if (done) return;
        done = true;
        var at = wakes.indexOf(cancel);
        if (at >= 0) wakes.splice(at, 1);
        resolve(token === state.token);
      }
      function cancel() {
        clearTimeout(id);
        finish();
      }
      id = setTimeout(finish, ms);
      wakes.push(cancel);
    });
  }
  function speak(text, token) {
    return new Promise(function (resolve) {
      var settled = false;
      var forced = false;
      var watchdog = 0;
      function finish(status) {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        var at = wakes.indexOf(cancel);
        if (at >= 0) wakes.splice(at, 1);
        resolve(status);
      }
      function cancel() {
        clearTimeout(watchdog);
        try { window.speechSynthesis.cancel(); } catch (err) {}
        finish("cancel");
      }
      try {
        var utterance = new SpeechSynthesisUtterance(text);
        var voices = window.speechSynthesis.getVoices();
        var chosen = null;
        var i;
        for (i = 0; i < voices.length; i++) {
          if (String(voices[i].lang || "").toLowerCase().indexOf("ko") === 0) {
            chosen = voices[i];
            break;
          }
        }
        utterance.lang = chosen && chosen.lang ? chosen.lang : "ko-KR";
        if (chosen) utterance.voice = chosen;
        utterance.rate = Math.min(2, Math.max(0.5, state.rate));
        var started = performance.now();
        watchdog = setTimeout(function () {
          forced = true;
          try { window.speechSynthesis.cancel(); } catch (err) {}
          finish("end");
        }, durationMs(text, state.rate) * 2 + 1200);
        utterance.onend = function () {
          if (token !== state.token) finish("cancel");
          else if (performance.now() - started < 80 && Array.from(text).length > 2) finish("fast");
          else finish("end");
        };
        utterance.onerror = function (event) {
          if (forced) finish("end");
          else if (token !== state.token || (event && (event.error === "canceled" || event.error === "interrupted"))) finish("cancel");
          else finish("error");
        };
        wakes.push(cancel);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        try { window.speechSynthesis.resume(); } catch (err) {}
      } catch (err) {
        finish("error");
      }
    });
  }
  function playAudio(url, token) {
    return new Promise(function (resolve) {
      var settled = false;
      var element = new Audio(url);
      audioEl = element;
      function finish(status) {
        if (settled) return;
        settled = true;
        var at = wakes.indexOf(cancel);
        if (at >= 0) wakes.splice(at, 1);
        resolve(status);
      }
      function cancel() {
        element.pause();
        finish("cancel");
      }
      element.playbackRate = Math.min(2, Math.max(0.5, state.rate));
      element.onended = function () { finish(token === state.token ? "end" : "cancel"); };
      element.onerror = function () { finish("error"); };
      wakes.push(cancel);
      var started = element.play();
      if (started && started.then) started.then(function () {}, function () { finish("error"); });
    });
  }
  function playCue(cue, token) {
    var audioTask = cue.audio ? playAudio(cue.audio, token) : Promise.resolve("skip");
    return audioTask.then(function (audioStatus) {
      if (token !== state.token) return "cancel";
      if (audioStatus === "end") return "end";
      if (state.broken || !speechAvailable()) {
        if (!speechAvailable()) state.broken = true;
        return later(durationMs(cue.spoken, state.rate), token).then(function (ok) {
          return ok ? "end" : "cancel";
        });
      }
      var started = performance.now();
      return speak(cue.spoken, token).then(function (spoken) {
        if (token !== state.token || spoken === "cancel") return "cancel";
        if (spoken === "fast" || spoken === "error") {
          state.broken = true;
          var rest = durationMs(cue.spoken, state.rate) - (performance.now() - started);
          if (rest > 0) {
            return later(rest, token).then(function (ok) { return ok ? "end" : "cancel"; });
          }
        }
        return "end";
      });
    });
  }
  function render() {
    var cues = collect();
    if (state.index >= cues.length) state.index = Math.max(0, cues.length - 1);
    var current = cues[state.index] || null;
    var toc = byId("toc");
    toc.replaceChildren();
    var ci;
    for (ci = 0; ci < book.chapters.length; ci++) {
      (function (chapter) {
        var li = el("li");
        var button = el("button", "", chapter.title || "제목 없는 장");
        button.type = "button";
        if (current && current.chapterId === chapter.id) button.setAttribute("aria-current", "true");
        button.addEventListener("click", function () { jumpChapter(chapter.id); });
        li.appendChild(button);
        toc.appendChild(li);
      })(book.chapters[ci]);
    }
    var reader = byId("reader");
    reader.replaceChildren();
    for (ci = 0; ci < book.chapters.length; ci++) {
      var chapter = book.chapters[ci];
      var section = el("section", "chapter");
      section.appendChild(el("h3", "", chapter.title || "제목 없는 장"));
      var bi;
      for (bi = 0; bi < chapter.blocks.length; bi++) {
        var block = chapter.blocks[bi];
        if (block.kind === "image") {
          var fig = el("figure", state.images ? "image" : "image off");
          fig.id = "cue-" + block.id;
          if (current && current.id === block.id) fig.classList.add("current");
          if (block.dataUrl) {
            var img = document.createElement("img");
            img.src = block.dataUrl;
            img.alt = spokenImage(block);
            fig.appendChild(img);
          }
          var cap = el("figcaption");
          cap.appendChild(el("span", "file", block.fileName || "그림"));
          if (state.images) {
            var alt = spokenImage(block);
            if (alt) {
              var caption = el("p", "");
              appendLinked(caption, alt);
              cap.appendChild(caption);
            }
          } else {
            cap.appendChild(el("p", "", "그림 설명을 듣기에서 빼 두었습니다."));
          }
          fig.appendChild(cap);
          section.appendChild(fig);
          continue;
        }
        var si;
        for (si = 0; si < block.sentences.length; si++) {
          (function (sentence) {
            var spoken = spokenSentence(sentence);
            if (!spoken) return;
            var span = el("span", "sentence");
            appendLinked(span, spoken);
            if (sentence.confirmed) {
              span.appendChild(document.createTextNode(" "));
              span.appendChild(el("span", "ok", "확인함"));
            }
            span.id = "cue-" + sentence.id;
            span.tabIndex = 0;
            if (current && current.id === sentence.id) {
              span.classList.add("current");
              span.setAttribute("aria-current", "true");
            }
            span.addEventListener("click", function () { jumpId(sentence.id); });
            section.appendChild(span);
          })(block.sentences[si]);
        }
      }
      reader.appendChild(section);
    }
    var play = byId("play");
    if (!cues.length) play.textContent = "재생";
    else if (state.playing) play.textContent = "일시정지";
    else if (state.resumed) play.textContent = "이어 듣기";
    else play.textContent = "재생";
    play.setAttribute("aria-pressed", state.playing ? "true" : "false");
    play.disabled = cues.length === 0;
    byId("prev").disabled = cues.length === 0 || state.index <= 0;
    byId("next").disabled = cues.length === 0 || state.index >= cues.length - 1;
    byId("rate").value = String(state.rate);
    byId("easy").checked = state.easy;
    byId("images").checked = state.images;
    var note = byId("now");
    if (!cues.length) note.textContent = "들을 문장이 없습니다.";
    else if (state.broken) note.textContent = "이 브라우저는 음성을 바로 끝내 읽는 시간만 맞춥니다.";
    else if (state.resumed && !state.playing) note.textContent = "마지막으로 듣던 문장입니다. 이어 듣기를 누르면 여기서 읽습니다.";
    else note.textContent = current ? current.spoken : "";
    var node = current ? document.getElementById("cue-" + current.id) : null;
    if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
  }
  function keepId(id) {
    var cues = collect();
    state.index = 0;
    var i;
    for (i = 0; i < cues.length; i++) {
      if (cues[i].id === id) { state.index = i; return; }
    }
  }
  function sequence(token) {
    if (token !== state.token) return;
    var cues = collect();
    if (!cues.length || state.index < 0 || state.index >= cues.length) {
      state.playing = false;
      if (cues.length) state.index = Math.max(0, Math.min(state.index, cues.length - 1));
      render();
      save();
      return;
    }
    render();
    save();
    playCue(cues[state.index], token).then(function (result) {
      if (token !== state.token) return;
      if (result !== "end") {
        state.playing = false;
        render();
        save();
        return;
      }
      state.index += 1;
      sequence(token);
    });
  }
  function run(index) {
    state.token += 1;
    var token = state.token;
    stopMedia();
    state.playing = true;
    state.resumed = false;
    state.index = index < 0 ? 0 : index;
    sequence(token);
  }
  function jumpId(id) {
    keepId(id);
    if (state.playing) run(state.index);
    else { render(); save(); }
  }
  function jumpChapter(chapterId) {
    var cues = collect();
    var i;
    for (i = 0; i < cues.length; i++) {
      if (cues[i].chapterId === chapterId) {
        jumpId(cues[i].id);
        return;
      }
    }
  }
  function step(dir) {
    var cues = collect();
    if (!cues.length) return;
    var next = Math.max(0, Math.min(cues.length - 1, state.index + dir));
    if (state.playing) run(next);
    else {
      state.index = next;
      render();
      save();
    }
  }
  function toggle() {
    if (state.playing) {
      state.playing = false;
      state.token += 1;
      stopMedia();
      render();
      save();
      return;
    }
    run(state.index);
  }
  byId("play").addEventListener("click", toggle);
  byId("prev").addEventListener("click", function () { step(-1); });
  byId("next").addEventListener("click", function () { step(1); });
  byId("rate").addEventListener("change", function (event) {
    state.rate = nearestRate(Number(event.target.value));
    if (state.playing) run(state.index);
    else { render(); save(); }
  });
  byId("easy").addEventListener("change", function (event) {
    var cue = currentCue();
    state.easy = event.target.checked;
    keepId(cue ? cue.id : "");
    if (state.playing) run(state.index);
    else { render(); save(); }
  });
  byId("images").addEventListener("change", function (event) {
    var cue = currentCue();
    state.images = event.target.checked;
    keepId(cue ? cue.id : "");
    if (state.playing) run(state.index);
    else { render(); save(); }
  });
  loadPrefs();
  render();
})();
`;

function linkedHtml(text: string): string {
  return linkParts(text)
    .map((part) =>
      part.kind === "link"
        ? `<a href="${escapeHtml(part.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(part.text)}</a>`
        : escapeHtml(part.text),
    )
    .join("");
}

function staticReader(book: Book): string {
  return book.chapters
    .map((chapter) => {
      const body = chapter.blocks
        .map((block) => {
          if (block.kind === "image") {
            const alt = block.alt.trim();
            const caption = alt ? `<p>${linkedHtml(alt)}</p>` : "";
            return `<figure class="image"><figcaption><span class="file">${escapeHtml(block.fileName || "그림")}</span>${caption}</figcaption></figure>`;
          }
          return block.sentences
            .map((sentence) => {
              const spoken = spokenSentence(sentence, false).trim();
              if (!spoken) return "";
              const mark = sentence.confirmed ? ` <span class="ok">확인함</span>` : "";
              return `<p class="sentence">${linkedHtml(spoken)}${mark}</p>`;
            })
            .join("");
        })
        .join("");
      return `<section class="chapter"><h3>${escapeHtml(chapter.title || "제목 없는 장")}</h3>${body}</section>`;
    })
    .join("");
}

export function renderPlayerHtml(book: Book): string {
  const clean = normalizeBook(book);
  const title = escapeHtml(bookTitle(clean));
  const source = clean.sourceFileName ? `<p class="source">파일 ${escapeHtml(clean.sourceFileName)}</p>` : "";
  const data = embedJson(clean);
  const script = PLAYER_JS.replace("__BOOK_JSON__", () => data);
  return [
    "<!DOCTYPE html>",
    '<html lang="ko">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title} — 듣는 책</title>`,
    "<style>",
    PLAYER_CSS,
    "</style>",
    "</head>",
    "<body>",
    '<a class="skip" href="#reader">본문으로</a>',
    '<div class="wrap">',
    "<header>",
    '<p class="mark">듣는 책</p>',
    `<h1>${title}</h1>`,
    source,
    '<p class="honest">이 파일은 브라우저에서 듣는 플레이어입니다. 같은 파일을 Windows와 Mac에서 엽니다. DAISY나 EPUB으로 내보낸 파일이 아닙니다.</p>',
    "</header>",
    '<div class="layout">',
    '<nav class="toc" aria-label="목차">',
    "<h2>목차</h2>",
    '<ol id="toc"></ol>',
    "</nav>",
    '<main class="main">',
    '<div class="controls" role="group" aria-label="듣기 조절">',
    '<button type="button" id="play">재생</button>',
    '<button type="button" id="prev">이전</button>',
    '<button type="button" id="next">다음</button>',
    '<label class="rate">속도 <select id="rate" aria-label="속도"><option value="0.8">0.8</option><option value="1" selected>1</option><option value="1.25">1.25</option><option value="1.5">1.5</option></select></label>',
    '<label class="check"><input id="easy" type="checkbox"> 쉬운 글</label>',
    '<label class="check"><input id="images" type="checkbox" checked> 그림 설명</label>',
    "</div>",
    '<p id="now" role="status"></p>',
    `<article id="reader">${staticReader(clean)}</article>`,
    "</main>",
    "</div>",
    "</div>",
    "<noscript><p>이 플레이어는 스크립트가 필요합니다. 브라우저에서 스크립트를 켠 뒤 다시 여세요.</p></noscript>",
    "<script>",
    script,
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");
}
