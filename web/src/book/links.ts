/** 문장 안에 이미 적힌 https 주소만 링크로 나눈다. 주소를 만들지 않는다. */

export type TextPart =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

const URL_RE = /https:\/\/[^\s<>"']+/gu;
const TRAILING = /[.,);:\]}>]+$/u;

export function linkParts(value: string): TextPart[] {
  const text = value.normalize("NFC");
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0] ?? "";
    const index = match.index ?? 0;
    const href = raw.replace(TRAILING, "");
    if (!href.startsWith("https://") || href.length <= "https://".length) continue;
    if (index > last) parts.push({ kind: "text", text: text.slice(last, index) });
    parts.push({ kind: "link", text: href, href });
    last = index + href.length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  if (!parts.length) parts.push({ kind: "text", text });
  return parts;
}
