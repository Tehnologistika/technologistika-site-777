import { useEffect, type ReactNode } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

/**
 * Рендер юридических текстов. Фрагменты в квадратных скобках, которые не являются
 * ссылкой Markdown, подсвечиваются как незаполненные плейсхолдеры.
 */
export default function LegalDocument({ source }: { source: string }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [source]);

  const body = source.replace(/<!--[\s\S]*?-->/g, "").trim();

  return (
    <div style={{ backgroundColor: "#0F1115", minHeight: "100vh" }}>
      <Header />
      <main style={{ paddingTop: "120px", paddingBottom: "5rem" }}>
        <article className="container legal-doc">{renderBlocks(body)}</article>
      </main>
      <Footer />
    </div>
  );
}

function renderBlocks(source: string): ReactNode[] {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const nextKey = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const Tag = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
      blocks.push(<Tag key={nextKey()}>{inline(heading[2], nextKey())}</Tag>);
      i += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(<blockquote key={nextKey()}>{inline(quote.join(" "), nextKey())}</blockquote>);
      continue;
    }

    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|\s*-+/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
        }
        i += 1;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={nextKey()} className="legal-table-wrap">
          <table>
            {head && (
              <thead>
                <tr>
                  {head.map((cell, index) => (
                    <th key={index}>{inline(cell, `${nextKey()}-${index}`)}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index}>{inline(cell, `${nextKey()}-${rowIndex}-${index}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={nextKey()}>
          {items.map((item, index) => (
            <li key={index}>{inline(item, `${nextKey()}-li${index}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\||[-*]\s)/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={nextKey()}>{inline(para.join(" "), nextKey())}</p>);
  }

  return blocks;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const re = /(\*\*[^*]+\*\*)|(\[[^\]\n]+\]\([^)\n]+\))|(\[[^\]\n]+\])/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let n = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const index = match.index;
    if (index > last) nodes.push(text.slice(last, index));
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{inline(token.slice(2, -2), key)}</strong>);
    } else if (token.endsWith(")") && token.includes("](")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a key={key} href={link[2]}>
            {link[1]}
          </a>,
        );
      }
    } else {
      nodes.push(
        <mark key={key} className="legal-ph">
          {token}
        </mark>,
      );
    }
    last = index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
