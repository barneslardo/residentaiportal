import type { ReactNode } from "react";

/**
 * Small, dependency-free renderer for the subset of Markdown the assistant
 * actually produces: paragraphs, headings, bullet / numbered lists, bold,
 * italics, inline code, links and horizontal rules. Anything it does not
 * understand is shown as plain text, so an odd reply never breaks the thread.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md">{renderBlocks(text.replace(/\r\n?/g, "\n"))}</div>;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; items: string[][] }
  | { kind: "ol"; items: string[][]; start: number }
  | { kind: "hr" };

const BULLET = /^\s*([-*•])\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    const listMatch = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (listMatch) {
      const ordered = NUMBERED.test(line);
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i];
        const m = ordered ? NUMBERED.exec(current) : BULLET.exec(current);
        if (m) {
          items.push([m[2]]);
          i += 1;
          continue;
        }
        // Indented or non-empty follow-on lines belong to the previous item.
        if (current.trim() && items.length && /^\s+/.test(current)) {
          items[items.length - 1].push(current.trim());
          i += 1;
          continue;
        }
        if (!current.trim() && items.length && lines[i + 1] !== undefined) {
          const next = lines[i + 1];
          const nextIsItem = ordered ? NUMBERED.test(next) : BULLET.test(next);
          if (nextIsItem) {
            i += 1;
            continue;
          }
        }
        break;
      }
      const start = ordered ? Number(NUMBERED.exec(line)?.[1] ?? 1) : 1;
      blocks.push(ordered ? { kind: "ol", items, start } : { kind: "ul", items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i];
      if (!current.trim() || HEADING.test(current) || BULLET.test(current) || NUMBERED.test(current) || RULE.test(current)) break;
      para.push(current.trim());
      i += 1;
    }
    blocks.push({ kind: "p", lines: para });
  }
  return blocks;
}

function renderBlocks(text: string): ReactNode[] {
  return parseBlocks(text).map((block, i) => {
    switch (block.kind) {
      case "h": {
        const level = Math.min(Math.max(block.level, 1), 4);
        const Tag = `h${level + 1}` as "h2" | "h3" | "h4" | "h5";
        return <Tag key={i}>{renderInline(block.text)}</Tag>;
      }
      case "hr":
        return <hr key={i} />;
      case "ul":
        return (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{renderItem(item)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={i} start={block.start}>
            {block.items.map((item, j) => (
              <li key={j}>{renderItem(item)}</li>
            ))}
          </ol>
        );
      default:
        return <p key={i}>{joinLines(block.lines)}</p>;
    }
  });
}

/** The first line of a list item is the item; further lines are shown beneath it. */
function renderItem(lines: string[]): ReactNode {
  if (lines.length === 1) return renderInline(lines[0]);
  return (
    <>
      <div>{renderInline(lines[0])}</div>
      {lines.slice(1).map((l, k) => (
        <div className="md-item-detail" key={k}>
          {renderInline(l)}
        </div>
      ))}
    </>
  );
}

function joinLines(lines: string[]): ReactNode[] {
  const out: ReactNode[] = [];
  lines.forEach((l, k) => {
    if (k > 0) out.push(<br key={`br${k}`} />);
    out.push(...renderInline(l, `l${k}`));
  });
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>)]+)/g;

function renderInline(text: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyPrefix}i${n++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (tok.startsWith("`")) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    } else if (tok.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      out.push(
        <a key={key} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      );
    } else {
      out.push(
        <a key={key} href={tok} target="_blank" rel="noreferrer">
          {tok}
        </a>
      );
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
