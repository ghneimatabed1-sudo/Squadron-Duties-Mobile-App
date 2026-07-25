export interface ReportRow {
  name: string;
  duty: number;
  weekendDuty: number;
  standby: number;
  special: number;
  location: number;
  total: number;
  balance: number;
}

export interface ReportSection {
  title: string;
  rows: ReportRow[];
}

export interface ReportSheetData {
  title: string;
  subtitle: string;
  isRTL: boolean;
  labels: {
    person: string;
    duties: string;
    weekend: string;
    standbys: string;
    specials: string;
    locations: string;
    total: string;
    balance: string;
    owed: string;
    ahead: string;
    balanced: string;
  };
  sections: ReportSection[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a printable per-person duty report (pure — no React/Expo deps). */
export function buildReportHtml(data: ReportSheetData): string {
  const dir = data.isRTL ? "rtl" : "ltr";
  const lang = data.isRTL ? "ar" : "en";
  const L = data.labels;

  const balanceCell = (b: number) => {
    if (Math.abs(b) < 0.25)
      return `<td class="bal ok">${esc(L.balanced)}</td>`;
    const label = b < 0 ? L.owed : L.ahead;
    const cls = b < 0 ? "owed" : "ahead";
    return `<td class="bal ${cls}">${Math.abs(b).toFixed(1)} ${esc(label)}</td>`;
  };

  const sections = data.sections
    .filter((s) => s.rows.length > 0)
    .map((s) => {
      const rows = s.rows
        .map(
          (r) => `
      <tr>
        <td class="name">${esc(r.name)}</td>
        <td>${r.duty}</td>
        <td>${r.weekendDuty}</td>
        <td>${r.standby}</td>
        <td>${r.special}</td>
        <td>${r.location}</td>
        <td class="total">${r.total}</td>
        ${balanceCell(r.balance)}
      </tr>`,
        )
        .join("");
      return `
  <h2>${esc(s.title)}</h2>
  <table>
    <thead>
      <tr>
        <th class="name-col">${esc(L.person)}</th>
        <th>${esc(L.duties)}</th>
        <th>${esc(L.weekend)}</th>
        <th>${esc(L.standbys)}</th>
        <th>${esc(L.specials)}</th>
        <th>${esc(L.locations)}</th>
        <th>${esc(L.total)}</th>
        <th class="bal-col">${esc(L.balance)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
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
    padding: 28px 24px 36px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  header { text-align: center; margin-bottom: 18px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: .2px; }
  .subtitle { font-size: 13px; color: var(--muted); margin: 0; }
  h2 { font-size: 15px; margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td {
    border: 1px solid var(--line);
    padding: 7px 6px;
    font-size: 12px;
    text-align: center;
  }
  thead th { background: var(--accent); font-weight: 700; }
  .name-col { width: 22%; }
  .bal-col { width: 16%; }
  td.name { font-weight: 700; text-align: start; padding-inline-start: 9px; }
  td.total { font-weight: 700; background: var(--shade); }
  td.bal.ok { color: #6b7280; }
  td.bal.owed { color: #166534; font-weight: 700; }
  td.bal.ahead { color: #92400e; font-weight: 700; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  tbody tr:nth-child(even) td.total { background: var(--shade); }
  @page { size: A4 portrait; margin: 10mm; }
</style>
</head>
<body>
  <header>
    <h1>${esc(data.title)}</h1>
    <p class="subtitle">${esc(data.subtitle)}</p>
  </header>
  ${sections}
</body>
</html>`;
}
