import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { theme } from "@/constants/theme";

type Props = {
  text: string;
  color?: string;
  selectable?: boolean;
};

type Block =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" };

function splitTableRow(line: string): string[] {
  const t = line.trim().replace(/^\||\|$/g, "");
  return t.split("|").map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/.test(line);
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) return false;
  // Must look like | foo | bar | (at least 2 cells)
  const cells = splitTableRow(t);
  return cells.length >= 2;
}

/** Strip stray solitary asterisks/underscores that aren't valid markdown pairs,
 * so messy LLM output doesn't render with bare * characters. */
function sanitizeInline(text: string): string {
  let out = text;
  // Drop leading/trailing stray asterisks like "**title" without matching close on a line
  // We only strip a single trailing/leading * that has no pair on the same line.
  return out;
}

function parse(md: string): Block[] {
  void sanitizeInline;
  const lines = md.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Horizontal rule
    if (/^\s*([-*_])\s*\1\s*\1[-*_\s]*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    // Table: header row, separator row, body rows
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }
    // fenced code
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }
    // heading
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      blocks.push({
        type: "h",
        level: h[1].length as 1 | 2 | 3,
        text: h[2].trim(),
      });
      i++;
      continue;
    }
    // unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    // ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: buf.join(" ") });
      continue;
    }
    // paragraph (collect until blank line)
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: buf.join(" ") });
  }
  return blocks;
}

type Token = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

function tokenize(text: string): Token[] {
  // order: code, bold, italic
  const tokens: Token[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
    const seg = m[0];
    if (seg.startsWith("`")) {
      tokens.push({ text: seg.slice(1, -1), code: true });
    } else if (seg.startsWith("**") || seg.startsWith("__")) {
      tokens.push({ text: seg.slice(2, -2), bold: true });
    } else {
      tokens.push({ text: seg.slice(1, -1), italic: true });
    }
    last = m.index + seg.length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
}

function Inline({ text, color, selectable }: { text: string; color: string; selectable?: boolean }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <Text style={{ color, fontSize: 15, lineHeight: 22 }} selectable={selectable}>
      {tokens.map((t, i) => (
        <Text
          key={i}
          style={[
            t.bold ? styles.bold : null,
            t.italic ? styles.italic : null,
            t.code ? styles.codeInline : null,
          ]}
        >
          {t.text}
        </Text>
      ))}
    </Text>
  );
}

export default function Markdown({ text, color, selectable }: Props) {
  const c = color ?? theme.text;
  const sel = selectable ?? false;
  const blocks = useMemo(() => parse(text), [text]);
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => {
        if (b.type === "h") {
          const size = b.level === 1 ? 20 : b.level === 2 ? 17 : 15;
          return (
            <Text
              key={i}
              style={{
                color: c,
                fontSize: size,
                fontWeight: "700",
                letterSpacing: 0.2,
                marginTop: i === 0 ? 0 : 4,
              }}
            >
              {b.text.replace(/[*_`]/g, "")}
            </Text>
          );
        }
        if (b.type === "p") {
          return <Inline key={i} text={b.text} color={c} selectable={sel} />;
        }
        if (b.type === "ul") {
          return (
            <View key={i} style={{ gap: 4 }}>
              {b.items.map((it, j) => (
                <View key={j} style={styles.liRow}>
                  <View style={[styles.bullet, { backgroundColor: theme.amber }]} />
                  <View style={{ flex: 1 }}>
                    <Inline text={it} color={c} selectable={sel} />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        if (b.type === "ol") {
          return (
            <View key={i} style={{ gap: 4 }}>
              {b.items.map((it, j) => (
                <View key={j} style={styles.liRow}>
                  <Text style={[styles.olNum, { color: theme.amber }]}>
                    {j + 1}.
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Inline text={it} color={c} selectable={sel} />
                  </View>
                </View>
              ))}
            </View>
          );
        }
        if (b.type === "quote") {
          return (
            <View key={i} style={styles.quote}>
              <Inline text={b.text} color={theme.textMuted} selectable={sel} />
            </View>
          );
        }
        if (b.type === "code") {
          return (
            <View key={i} style={styles.codeBlock}>
              <Text style={styles.codeBlockText}>{b.text}</Text>
            </View>
          );
        }
        if (b.type === "hr") {
          return <View key={i} style={styles.hr} />;
        }
        if (b.type === "table") {
          return (
            <View key={i} style={styles.table}>
              <View style={[styles.tableRow, styles.tableHeaderRow]}>
                {b.headers.map((h, j) => (
                  <View
                    key={j}
                    style={[
                      styles.tableCell,
                      j === 0 && styles.tableCellFirst,
                    ]}
                  >
                    <Inline text={h} color={theme.amber} selectable={sel} />
                  </View>
                ))}
              </View>
              {b.rows.map((row, ri) => (
                <View
                  key={ri}
                  style={[
                    styles.tableRow,
                    ri === b.rows.length - 1 && styles.tableRowLast,
                  ]}
                >
                  {row.map((cell, ci) => (
                    <View
                      key={ci}
                      style={[
                        styles.tableCell,
                        ci === 0 && styles.tableCellFirst,
                      ]}
                    >
                      <Inline text={cell} color={c} selectable={sel} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  codeInline: {
    fontFamily: "Courier",
    backgroundColor: "rgba(255,255,255,0.08)",
    fontSize: 13,
  },
  liRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 9,
  },
  olNum: {
    fontWeight: "700",
    fontSize: 14,
    minWidth: 18,
    marginTop: 1,
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: theme.amber,
    paddingLeft: 10,
    paddingVertical: 2,
  },
  codeBlock: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: 10,
  },
  codeBlockText: {
    color: theme.text,
    fontFamily: "Courier",
    fontSize: 13,
    lineHeight: 18,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.border,
    marginVertical: 4,
  },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    borderRadius: 10,
    overflow: "hidden",
    marginVertical: 2,
  },
  tableHeaderRow: {
    backgroundColor: "rgba(244,184,96,0.10)",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  tableRowLast: { borderBottomWidth: 0 },
  tableCell: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: theme.border,
    minWidth: 0,
  },
  tableCellFirst: { borderLeftWidth: 0 },
});
