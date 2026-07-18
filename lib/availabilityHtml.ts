export interface AvailabilitySheetPerson {
  /** Row number in the fixed manual order (1-based). */
  index: number;
  name: string;
  role: string;
  /** Day-of-month (1-based) -> code shown in that box. */
  marks: Record<number, string>;
  /** Ordered per-code totals for the month, e.g. [{code:"L", count:3}]. */
  totals: { code: string; count: number }[];
}

export interface AvailabilitySheetData {
  title: string; // squadron name (or app title fallback)
  subtitle: string; // month label, e.g. "July 2026"
  isRTL: boolean;
  daysInMonth: number;
  /** Day-of-month numbers that fall on a weekend (Thu/Fri/Sat). */
  weekendDays: number[];
  labels: {
    number: string;
    name: string;
    totals: string;
    codes: string;
    generatedOn: string;
  };
  /** Legend rows: code + meaning. */
  legend: { code: string; label: string }[];
  generatedOn: string;
  people: AvailabilitySheetPerson[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build the printable monthly availability sheet (pure — no React/Expo deps). */
export function buildAvailabilityHtml(data: AvailabilitySheetData): string {
  const dir = data.isRTL ? "rtl" : "ltr";
  const lang = data.isRTL ? "ar" : "en";
  const L = data.labels;
  const weekend = new Set(data.weekendDays);
  const days = Array.from({ length: data.daysInMonth }, (_, i) => i + 1);

  const headDays = days
    .map(
      (d) =>
        `<th class="d${weekend.has(d) ? " wk" : ""}">${d}</th>`,
    )
    .join("");

  const rows = data.people
    .map((p) => {
      const cells = days
        .map((d) => {
          const code = p.marks[d];
          return `<td class="c${weekend.has(d) ? " wk" : ""}">${code ? esc(code) : ""}</td>`;
        })
        .join("");
      const totals = p.totals.length
        ? p.totals
            .map((t) => `<span class="tot"><b>${esc(t.code)}</b>&nbsp;${t.count}</span>`)
            .join(" ")
        : "—";
      return `
      <tr>
        <td class="num">${p.index}</td>
        <td class="nm"><div class="pname">${esc(p.name)}</div><div class="prole">${esc(p.role)}</div></td>
        ${cells}
        <td class="tots">${totals}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(data.title)}</title>
<style>
  :root { --ink: #1a1d21; --muted: #6b7280; --line: #c9ced6; --shade: #f1f3f6; --accent: #e8eef7; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue",
      "Noto Naskh Arabic", "Geeza Pro", Arial, sans-serif;
    color: var(--ink);
    background: #fff;
    direction: ${dir};
    padding: 22px 16px 30px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  header { text-align: center; margin-bottom: 14px; }
  h1 { font-size: 22px; margin: 0 0 3px; letter-spacing: .2px; }
  .subtitle { font-size: 13px; color: var(--muted); margin: 0; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid var(--line); }
  thead th {
    background: var(--accent);
    padding: 5px 2px;
    font-size: 10px;
    font-weight: 700;
    text-align: center;
  }
  thead th.head-num { width: 22px; }
  thead th.head-name { width: 110px; font-size: 11px; }
  thead th.head-tot { width: 90px; font-size: 11px; }
  thead th.d.wk { background: #dbe6f5; }
  tbody td { padding: 4px 2px; font-size: 10px; text-align: center; vertical-align: middle; }
  td.num { font-weight: 700; background: var(--shade); }
  td.nm { text-align: ${data.isRTL ? "right" : "left"}; padding: 4px 6px; }
  td.nm .pname { font-weight: 700; font-size: 11px; }
  td.nm .prole { font-size: 9px; color: var(--muted); margin-top: 1px; }
  td.c { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.c.wk { background: var(--shade); }
  td.tots { font-size: 9.5px; text-align: ${data.isRTL ? "right" : "left"}; padding: 4px 5px; }
  td.tots .tot { display: inline-block; margin: 1px 2px; padding: 1px 4px; background: var(--shade); border-radius: 3px; white-space: nowrap; }
  .legend {
    margin-top: 14px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 9px 12px;
    background: var(--shade);
  }
  .legend .legend-title {
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .4px;
    margin-bottom: 5px;
  }
  .legend span.item { display: inline-block; font-size: 11px; margin: 2px 8px 2px 0; }
  .legend span.item b { font-weight: 700; }
  footer { margin-top: 14px; text-align: center; font-size: 10.5px; color: var(--muted); }
  @media print {
    body { padding: 0; }
    @page { size: landscape; margin: 10mm; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>
  <header>
    <h1>${esc(data.title)}</h1>
    <p class="subtitle">${esc(data.subtitle)}</p>
  </header>
  <table>
    <thead>
      <tr>
        <th class="head-num">${esc(L.number)}</th>
        <th class="head-name">${esc(L.name)}</th>
        ${headDays}
        <th class="head-tot">${esc(L.totals)}</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  ${
    data.legend.length
      ? `<section class="legend">
    <div class="legend-title">${esc(L.codes)}</div>
    ${data.legend
      .map((l) => `<span class="item"><b>${esc(l.code)}</b> = ${esc(l.label)}</span>`)
      .join("")}
  </section>`
      : ""
  }
  <footer>${esc(L.generatedOn)} ${esc(data.generatedOn)}</footer>
</body>
</html>`;
}
