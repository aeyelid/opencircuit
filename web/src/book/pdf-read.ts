/** 브라우저에서 PDF 글과 그림을 읽어 듣는 책으로 만든다. */

import { getDocument, GlobalWorkerOptions, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { bookFromPdfPages, type PdfFigure, type PdfGlyph, type PdfPage } from "./pdf-book.ts";
import type { BookResult } from "./model.ts";

function configureWorker(): void {
  if (typeof document === "undefined") return;
  const src = new URL("/pdfjs/pdf.worker.min.mjs", window.location.origin).href;
  if (GlobalWorkerOptions.workerSrc !== src) GlobalWorkerOptions.workerSrc = src;
}

const MAX_BYTES = 20_000_000;
const MAX_PAGES = 40;
const MAX_EDGE = 1280;

type Raster = {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8ClampedArray | Uint8Array;
  bitmap?: ImageBitmap;
};

type Transform = [number, number, number, number, number, number];

function multiply(a: Transform, b: number[]): Transform {
  const m = b.length >= 6 ? b : [1, 0, 0, 1, 0, 0];
  return [
    a[0] * m[0] + a[2] * m[1],
    a[1] * m[0] + a[3] * m[1],
    a[0] * m[2] + a[2] * m[3],
    a[1] * m[2] + a[3] * m[3],
    a[0] * m[4] + a[2] * m[5] + a[4],
    a[1] * m[4] + a[3] * m[5] + a[5],
  ];
}

function loadObject(page: { objs: { get: (name: string, cb: (value: Raster | null) => void) => void }; commonObjs: { get: (name: string, cb: (value: Raster | null) => void) => void } }, name: string): Promise<Raster | null> {
  const read = (store: { get: (key: string, cb: (value: Raster | null) => void) => void }) =>
    new Promise<Raster | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      try {
        store.get(name, (value) => {
          clearTimeout(timer);
          resolve(value ?? null);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  return read(page.objs).then((value) => (value?.data || value?.bitmap ? value : read(page.commonObjs)));
}

function encodeCanvas(source: CanvasImageSource, width: number, height: number): string | null {
  if (!width || !height) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.82);
  if (!url.startsWith("data:image/") || url.length >= 4_000_000) return null;
  return url;
}

function rasterToDataUrl(image: Raster): string | null {
  if (typeof document === "undefined") return null;
  const width = image.width ?? image.bitmap?.width ?? 0;
  const height = image.height ?? image.bitmap?.height ?? 0;
  if (image.bitmap) return encodeCanvas(image.bitmap, image.bitmap.width || width, image.bitmap.height || height);
  const data = image.data;
  if (!width || !height || !data) return null;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return null;
  const pixels = sourceCtx.createImageData(width, height);
  const dest = pixels.data;
  if (image.kind === 3 && data.length >= width * height * 4) {
    dest.set(data.subarray(0, dest.length));
  } else if (image.kind === 2 && data.length >= width * height * 3) {
    for (let i = 0, j = 0; j < dest.length; i += 3, j += 4) {
      dest[j] = data[i] ?? 0;
      dest[j + 1] = data[i + 1] ?? 0;
      dest[j + 2] = data[i + 2] ?? 0;
      dest[j + 3] = 255;
    }
  } else if (image.kind === 1 && data.length >= width * height) {
    for (let i = 0, j = 0; i < width * height && j < dest.length; i += 1, j += 4) {
      const value = data[i] ?? 0;
      dest[j] = value;
      dest[j + 1] = value;
      dest[j + 2] = value;
      dest[j + 3] = 255;
    }
  } else {
    return null;
  }
  sourceCtx.putImageData(pixels, 0, 0);
  return encodeCanvas(source, width, height);
}

async function readPage(page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>["promise"]>["getPage"]>>): Promise<PdfPage> {
  const viewport = page.getViewport({ scale: 1 });
  const glyphs: PdfGlyph[] = [];
  const content = await page.getTextContent();
  for (const item of content.items) {
    if (!("str" in item) || !item.str) continue;
    const transform = item.transform;
    const fontSize = Math.hypot(transform[2] ?? 0, transform[3] ?? 0) || Math.hypot(transform[0] ?? 0, transform[1] ?? 0) || 12;
    glyphs.push({
      text: item.str,
      x: transform[4] ?? 0,
      y: viewport.height - (transform[5] ?? 0),
      width: item.width,
      fontSize,
    });
  }

  const figures: PdfFigure[] = [];
  const operators = await page.getOperatorList();
  const stack: Transform[] = [[1, 0, 0, 1, 0, 0]];
  const seen = new Set<string>();
  for (let i = 0; i < operators.fnArray.length; i++) {
    const fn = operators.fnArray[i];
    const args = operators.argsArray[i] as unknown[] | undefined;
    const top = stack[stack.length - 1] ?? [1, 0, 0, 1, 0, 0];
    if (fn === OPS.save) stack.push([...top]);
    else if (fn === OPS.restore) stack.pop();
    else if (fn === OPS.transform && Array.isArray(args)) stack[stack.length - 1] = multiply(top, args as number[]);
    else if (
      (fn === OPS.paintImageXObject || fn === (OPS as { paintJpegXObject?: number }).paintJpegXObject) &&
      Array.isArray(args)
    ) {
      const name = typeof args[0] === "string" ? args[0] : "";
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const ctm = stack[stack.length - 1] ?? top;
      const width = Math.hypot(ctm[0], ctm[1]);
      const height = Math.hypot(ctm[2], ctm[3]);
      if (Math.max(width, height) < 48) continue;
      const raster = await loadObject(page, name);
      const dataUrl = raster ? rasterToDataUrl(raster) : null;
      if (!dataUrl) continue;
      figures.push({
        x: ctm[4],
        y: viewport.height - ctm[5] - height,
        width,
        height,
        dataUrl,
      });
    }
  }
  return { width: viewport.width, height: viewport.height, glyphs, figures };
}

export async function bookFromPdfBytes(data: Uint8Array, fileName: string): Promise<BookResult> {
  if (data.byteLength > MAX_BYTES) {
    return { error: "PDF가 너무 큽니다. 20MB보다 작은 파일로 열어 주세요." };
  }
  configureWorker();
  const task = getDocument({
    data: data.slice(),
    isEvalSupported: false,
    disableWorker: typeof document === "undefined",
    verbosity: 0,
  } as unknown as Parameters<typeof getDocument>[0]);
  const doc = await task.promise;
  try {
    if (doc.numPages > MAX_PAGES) {
      return { error: "PDF가 너무 깁니다. 40쪽 이하로 열어 주세요." };
    }
    const pages: PdfPage[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      pages.push(await readPage(await doc.getPage(number)));
    }
    return bookFromPdfPages(pages, fileName);
  } finally {
    await doc.destroy();
  }
}
