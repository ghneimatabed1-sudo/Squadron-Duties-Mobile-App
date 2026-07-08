export interface RosterDay {
  weekday: string;
  dateLabel: string;
  isWeekend: boolean;
  dutyCaptain: string;
  dutyCopilot: string;
  standbyCaptain: string;
  standbyCopilot: string;
  /** Extra duty crews (crewIndex 1..n) added to this day, in order. */
  extraDuty?: { captain: string; copilot: string }[];
  solo?: string;
  specials?: { name: string; person: string }[];
  /** Location duties active on this day: location name + the crew on it. */
  locations?: { location: string; people: string }[];
}

export interface RosterLocation {
  location: string;
  detail: string;
}

export interface RosterSheetData {
  title: string;
  subtitle: string;
  isRTL: boolean;
  labels: {
    day: string;
    dutyCrew: string;
    standbyCrew: string;
    captain: string;
    copilot: string;
    weekend: string;
    solo: string;
    /** Label prefix for extra duty crews, e.g. "Crew" -> "Crew 2". */
    crew: string;
    generatedOn: string;
    locationDuty: string;
  };
  generatedOn: string;
  days: RosterDay[];
  locations: RosterLocation[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a clean, printable HTML roster sheet (pure — no React/Expo deps). */
export function buildRosterHtml(data: RosterSheetData): string {
  const dir = data.isRTL ? "rtl" : "ltr";
  const lang = data.isRTL ? "ar" : "en";
  const L = data.labels;

  const rows = data.days
    .map((d) => {
      const specialsTags = (d.specials ?? [])
        .map(
          (s) =>
            `<div class="special-tag"><span class="ev">${esc(s.name)}</span> · ${esc(s.person)}</div>`,
        )
        .join("");
      const locationTags = (d.locations ?? [])
        .map(
          (l) =>
            `<div class="loc-tag"><span class="ev">${esc(l.location)}</span> · ${esc(l.people)}</div>`,
        )
        .join("");
      const dayCell = `
        <td class="day${d.isWeekend ? " weekend" : ""}">
          <div class="dow">${esc(d.weekday)}</div>
          <div class="date">${esc(d.dateLabel)}</div>
          ${d.isWeekend ? `<div class="wknd-tag">${esc(L.weekend)}</div>` : ""}
          ${specialsTags}
          ${locationTags}
        </td>`;
      const soloRow = d.solo
        ? `<div class="solo"><strong>${esc(d.solo)}</strong></div>`
        : "";
      const extraCell = (pick: (c: { captain: string; copilot: string }) => string) =>
        (d.extraDuty ?? [])
          .map(
            (c, i) =>
              `<div class="extra"><span class="extra-label">${esc(L.crew)} ${i + 2}</span>${esc(pick(c))}</div>`,
          )
          .join("");
      return `
      <tr class="${d.isWeekend ? "weekend-row" : ""}">
        ${dayCell}
        <td class="name">${esc(d.dutyCaptain)}${extraCell((c) => c.captain)}</td>
        <td class="name">${esc(d.dutyCopilot)}${extraCell((c) => c.copilot)}</td>
        <td class="name standby">${esc(d.standbyCaptain)}</td>
        <td class="name standby">${esc(d.standbyCopilot)}${soloRow}</td>
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
    padding: 28px 24px 36px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  header { text-align: center; margin-bottom: 18px; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: .2px; }
  .subtitle { font-size: 13px; color: var(--muted); margin: 0; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th {
    background: var(--accent);
    border: 1px solid var(--line);
    padding: 9px 8px;
    font-size: 12.5px;
    font-weight: 700;
    text-align: center;
  }
  thead .group { font-size: 13px; }
  tbody td { border: 1px solid var(--line); padding: 9px 8px; vertical-align: middle; }
  td.day { width: 18%; text-align: center; }
  td.day .dow { font-weight: 700; font-size: 14px; }
  td.day .date { font-size: 12px; color: var(--muted); margin-top: 2px; }
  td.day .wknd-tag { font-size: 10px; color: var(--muted); margin-top: 3px; text-transform: uppercase; letter-spacing: .4px; }
  td.name { font-size: 14px; text-align: center; }
  td.name.standby { color: #374151; }
  tr.weekend-row td { background: var(--shade); }
  td.day.weekend { background: var(--accent); }
  .solo { margin-top: 5px; font-size: 11px; color: var(--muted); }
  td.name .extra {
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px dashed var(--line);
    font-size: 13px;
  }
  td.name .extra .extra-label {
    display: block;
    font-size: 9.5px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .4px;
    margin-bottom: 1px;
  }
  td.day .special-tag {
    margin-top: 4px;
    font-size: 10.5px;
    line-height: 1.3;
    color: var(--ink);
    background: var(--accent);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 2px 5px;
    display: inline-block;
  }
  td.day .special-tag .ev { font-weight: 700; }
  td.day .loc-tag {
    margin-top: 4px;
    font-size: 10.5px;
    line-height: 1.3;
    color: #143b6b;
    background: #e3edfb;
    border: 1px solid #b9cdec;
    border-radius: 4px;
    padding: 2px 5px;
    display: inline-block;
  }
  td.day .loc-tag .ev { font-weight: 700; }
  .legend {
    margin-top: 16px;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 10px 14px;
    background: var(--shade);
  }
  .legend .legend-title {
    font-size: 12.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .4px;
    margin-bottom: 6px;
  }
  .legend ul { margin: 0; padding-${data.isRTL ? "right" : "left"}: 18px; }
  .legend li { font-size: 12.5px; margin: 3px 0; }
  .legend li strong { font-weight: 700; }
  footer { margin-top: 16px; text-align: center; font-size: 11px; color: var(--muted); }
  @media print {
    body { padding: 0; }
    @page { margin: 14mm; }
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
        <th rowspan="2">${esc(L.day)}</th>
        <th colspan="2" class="group">${esc(L.dutyCrew)}</th>
        <th colspan="2" class="group">${esc(L.standbyCrew)}</th>
      </tr>
      <tr>
        <th>${esc(L.captain)}</th>
        <th>${esc(L.copilot)}</th>
        <th>${esc(L.captain)}</th>
        <th>${esc(L.copilot)}</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  ${
    data.locations.length
      ? `<section class="legend">
    <div class="legend-title">${esc(L.locationDuty)}</div>
    <ul>${data.locations
      .map(
        (l) =>
          `<li><strong>${esc(l.location)}</strong> — ${esc(l.detail)}</li>`,
      )
      .join("")}</ul>
  </section>`
      : ""
  }
  <footer>${esc(L.generatedOn)} ${esc(data.generatedOn)}</footer>
</body>
</html>`;
}
