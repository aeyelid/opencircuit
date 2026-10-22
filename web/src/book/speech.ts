/** 문장 음성. 브라우저 음성이 바로 끝나면 같은 길이만큼 읽기 위치만 움직인다. */

export function cueDurationMs(text: string, rate: number): number {
  const safe = Number.isFinite(rate) && rate > 0 ? Math.min(2, Math.max(0.5, rate)) : 1;
  const chars = Math.max(1, Array.from(text).length);
  return Math.max(700, Math.min(20_000, Math.round((chars * 160) / safe)));
}

export function speechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export type PlaybackOptions = {
  text: string;
  audioDataUrl: string | null;
  rate: number;
  voiceURI: string;
  broken: { current: boolean };
  onFallback?: () => void;
};

export function startPlayback(options: PlaybackOptions): {
  finished: Promise<"end" | "cancel">;
  stop: () => void;
} {
  let stopped = false;
  const wake: Array<() => void> = [];
  let audio: HTMLAudioElement | null = null;

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (stopped) {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => {
        const index = wake.indexOf(finish);
        if (index >= 0) wake.splice(index, 1);
        resolve();
      }, ms);
      function finish() {
        window.clearTimeout(timer);
        resolve();
      }
      wake.push(finish);
    });
  }

  function stop() {
    stopped = true;
    const pending = wake.splice(0);
    for (const finish of pending) finish();
    audio?.pause();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* 음성이 이미 없다 */
    }
  }

  function markFallback() {
    if (options.broken.current) return;
    options.broken.current = true;
    options.onFallback?.();
  }

  async function speak(): Promise<"end" | "cancel" | "fast" | "error"> {
    if (!speechAvailable()) return "error";
    await delay(30);
    if (stopped) return "cancel";
    return new Promise((resolve) => {
      let settled = false;
      let forced = false;
      const finish = (status: "end" | "cancel" | "fast" | "error") => {
        if (settled) return;
        settled = true;
        resolve(status);
      };
      try {
        const utterance = new SpeechSynthesisUtterance(options.text);
        const voices = window.speechSynthesis.getVoices();
        const chosen =
          voices.find((voice) => options.voiceURI && voice.voiceURI === options.voiceURI) ??
          voices.find((voice) => voice.lang.toLowerCase().startsWith("ko")) ??
          null;
        utterance.lang = chosen?.lang || "ko-KR";
        if (chosen) utterance.voice = chosen;
        utterance.rate = Math.min(2, Math.max(0.5, options.rate));
        const started = performance.now();
        const watchdog = window.setTimeout(() => {
          forced = true;
          try {
            window.speechSynthesis.cancel();
          } catch {
            /* 무시 */
          }
          finish("end");
        }, cueDurationMs(options.text, options.rate) * 2 + 1200);
        const clearWatch = () => window.clearTimeout(watchdog);
        utterance.onend = () => {
          clearWatch();
          if (stopped) finish("cancel");
          else if (performance.now() - started < 80 && Array.from(options.text).length > 2) finish("fast");
          else finish("end");
        };
        utterance.onerror = (event) => {
          clearWatch();
          if (forced) finish("end");
          else if (event.error === "canceled" || event.error === "interrupted") finish("cancel");
          else finish("error");
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.resume();
        wake.push(() => {
          clearWatch();
          try {
            window.speechSynthesis.cancel();
          } catch {
            /* 무시 */
          }
          finish("cancel");
        });
      } catch {
        finish("error");
      }
    });
  }

  function playAudio(url: string): Promise<"end" | "cancel" | "error"> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status: "end" | "cancel" | "error") => {
        if (settled) return;
        settled = true;
        resolve(status);
      };
      const element = new Audio(url);
      audio = element;
      element.playbackRate = Math.min(2, Math.max(0.5, options.rate));
      element.onended = () => finish(stopped ? "cancel" : "end");
      element.onerror = () => finish("error");
      wake.push(() => {
        element.pause();
        finish("cancel");
      });
      void element.play().then(
        () => undefined,
        () => finish("error"),
      );
    });
  }

  async function run(): Promise<"end" | "cancel"> {
    if (options.audioDataUrl) {
      const audioResult = await playAudio(options.audioDataUrl);
      if (audioResult === "cancel" || stopped) return "cancel";
      if (audioResult === "end") return "end";
    }
    if (stopped) return "cancel";
    if (options.broken.current || !speechAvailable()) {
      if (!speechAvailable()) markFallback();
      await delay(cueDurationMs(options.text, options.rate));
      return stopped ? "cancel" : "end";
    }
    const started = performance.now();
    const spoken = await speak();
    if (stopped || spoken === "cancel") return "cancel";
    if (spoken === "fast" || spoken === "error") {
      markFallback();
      const rest = cueDurationMs(options.text, options.rate) - (performance.now() - started);
      if (rest > 0) await delay(rest);
      return stopped ? "cancel" : "end";
    }
    return "end";
  }

  return { finished: run(), stop };
}

export function watchVoices(onChange: (voices: SpeechSynthesisVoice[]) => void): () => void {
  if (!speechAvailable()) {
    onChange([]);
    return () => undefined;
  }
  const emit = () => {
    const voices = window.speechSynthesis.getVoices();
    const korean = voices.filter((voice) => voice.lang.toLowerCase().startsWith("ko"));
    const rest = voices.filter((voice) => !voice.lang.toLowerCase().startsWith("ko"));
    onChange([...korean, ...rest]);
  };
  emit();
  window.speechSynthesis.addEventListener("voiceschanged", emit);
  const timer = window.setTimeout(emit, 400);
  return () => {
    window.speechSynthesis.removeEventListener("voiceschanged", emit);
    window.clearTimeout(timer);
  };
}
