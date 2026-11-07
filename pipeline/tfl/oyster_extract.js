// Runs inside a signed-in oyster.tfl.gov.uk journey history page. Requests the full eight-week
// window and returns the table as "cell | cell" lines for parseRows(). The site is server-rendered
// Struts with no JSON API: the first POST returns a holding page whose form makes the real query.
export async function extractRows() {
  const post = async (path, body) => {
    const res = await fetch(path, {
      method: "POST", credentials: "include", body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return new DOMParser().parseFromString(await res.text(), "text/html");
  };
  const select = document.querySelector('select[name="dateRange"]');
  const starts = [...select.options]
    .map((o) => o.text.match(/^(\d\d)\/(\d\d)\/(\d{4})-/))
    .filter(Boolean)
    .sort((a, b) => `${a[3]}${a[2]}${a[1]}`.localeCompare(`${b[3]}${b[2]}${b[1]}`));
  const from = starts[0][0].slice(0, -1);
  const now = new Date();
  const to = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  const custom = [...select.options].find((o) => /custom/i.test(o.text)).value;
  const holding = await post("/oyster/journeyHistoryThrottle.do?method=display",
    new URLSearchParams({ dateRange: custom, csDateFrom: from, csDateTo: to }));
  const form = [...holding.forms].find((f) => f.getAttribute("action") === "/oyster/journeyHistory.do");
  if (!form) throw new Error("Journey history holding page changed");
  const fields = new URLSearchParams();
  for (const el of form.elements) fields.set(el.name, el.value);
  const page = await post("/oyster/journeyHistory.do", fields);
  const table = page.querySelector("table.journeyhistory");
  if (!table) return { from, to, rows: "" };
  const rows = [...table.rows].slice(1)
    .map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, " ").trim()).join(" | "));
  return { from, to, rows: rows.join("\n") };
}
