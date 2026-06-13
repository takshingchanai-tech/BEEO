// Parser for the EMSD EAF register pages (/beeo/en/register/search_eaf.php and /tc/).
// The register server-renders every row in one page; each <tr> carries the data we
// need as data-* attributes:
//   data-name, data-addr, data-expiry_date (DD/MM/YYYY), data-eui, data-eui2,
//   data-prev_expiry_date, data-prev_eui, data-prev_eui2, data-comparison, data-rea
// Fixtures: test/fixtures/eaf_en_sample.html / eaf_tc_sample.html (snapshotted 2026-06-12).

export interface RegisterRow {
  name: string;
  address: string;
  expiryDate: string | null; // DD/MM/YYYY as published, null if '-'
  euiMj: number | null;
  euiKwh: number | null;
  prevExpiryDate: string | null;
  prevEuiMj: number | null;
  reaNo: string | null;
  isDemolished: boolean;
}

const DEMOLISHED_RE = /^\s*\((?:已拆卸|demolished)\)\s*/i;

function attr(tr: string, name: string): string | null {
  const m = tr.match(new RegExp(`data-${name}="([^"]*)"`));
  if (!m) return null;
  return decodeEntities(m[1]).trim() || null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function num(s: string | null): number | null {
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(s: string | null): string | null {
  return s && s !== "-" ? s : null;
}

/** Parse one register page (EN or TC) into rows. Throws if the page shape is unrecognizable. */
export function parseRegisterPage(html: string): RegisterRow[] {
  const tbodyMatch = html.match(/<tbody[\s\S]*?<\/tbody>/);
  if (!tbodyMatch) throw new Error("parser: no <tbody> found — register page layout changed");
  const trs = tbodyMatch[0].match(/<tr[^>]*data-expiry_date[^>]*>[\s\S]*?<\/tr>/g);
  if (!trs || trs.length === 0) {
    throw new Error("parser: no data rows found — register page layout changed");
  }
  return trs.map((tr) => {
    const rawName = attr(tr, "name") ?? "";
    const demolished = DEMOLISHED_RE.test(rawName);
    return {
      name: rawName.replace(DEMOLISHED_RE, "").trim(),
      address: attr(tr, "addr") ?? "",
      expiryDate: dateOrNull(attr(tr, "expiry_date")),
      euiMj: num(attr(tr, "eui")),
      euiKwh: num(attr(tr, "eui2")),
      prevExpiryDate: dateOrNull(attr(tr, "prev_expiry_date")),
      prevEuiMj: num(attr(tr, "prev_eui")),
      reaNo: attr(tr, "rea"),
      isDemolished: demolished,
    };
  });
}

/**
 * Join EN and TC rows for the same register snapshot.
 * Row *order differs* between language versions (each sorts by its own collation), so we
 * join on a composite key of language-independent fields. Duplicate keys (rare) are
 * matched in encounter order within the key group.
 */
export function joinBilingual(
  en: RegisterRow[],
  tc: RegisterRow[],
): Array<{ en: RegisterRow; tc: RegisterRow | null }> {
  const key = (r: RegisterRow) =>
    [r.reaNo ?? "", r.expiryDate ?? "", r.euiMj ?? "", r.prevExpiryDate ?? "", r.prevEuiMj ?? ""].join("|");
  const tcBuckets = new Map<string, RegisterRow[]>();
  for (const r of tc) {
    const k = key(r);
    const b = tcBuckets.get(k);
    if (b) b.push(r);
    else tcBuckets.set(k, [r]);
  }
  return en.map((r) => {
    const bucket = tcBuckets.get(key(r));
    return { en: r, tc: bucket && bucket.length > 0 ? bucket.shift()! : null };
  });
}

/** Normalize an EN address for stable building identity hashing. */
export function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
