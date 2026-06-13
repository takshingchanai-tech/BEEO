// Regulatory deadline engine — Buildings Energy Efficiency Ordinance (Cap. 610)
// and the Buildings Energy Efficiency (Amendment) Ordinance 2025 (Ord. No. 24 of 2025).
//
// The EMSD register publishes the EAF *expiry* date (issue date + legacy interval).
// Everything else is computed here. All statutory constants are configurable so a
// commencement-date slip is a config change, not a code change.
//
// CONFIRMED RULE — Schedule 5, Part 2 (Ord. No. 24 of 2025) + EMSD official guidance:
//   For Type 1 & 2 buildings (commercial / mixed-use commercial — the existing EMSD register):
//   - Preceding audit conducted BEFORE 20 Sep 2026  → next interval 10 years (published expiry stands)
//   - Preceding audit conducted ON/AFTER 20 Sep 2026 → next interval 5 years from that audit date
//   The "preceding audit date" (審核日期) = the STARTING DATE of the audit = issueDate here.
//   Example: audited 2022 (expiry 2032) → deadline remains 2032 (10-year interval, unchanged).
//   Example: audited 2027 (published expiry 2037) → deadline 2032 (5-year interval applies).
//
// NEW-SCOPE BUILDINGS (Types 3–11, Section 53):
//   Buildings entering the regime for the first time under the Amendment have their first-audit
//   deadlines set by Schedule 6 (by occupation-permit date or COCR date). If they had a voluntary
//   audit before the relevant date it is deemed conducted ON the relevant date (5-year clock
//   then starts from 20 Sep 2026 → deadline 20 Sep 2031). These buildings are NOT yet in the
//   EMSD EAF register and are out of scope for computeDeadlines().

export interface RegulatoryConfig {
  /** Amendment commencement date (ISO). */
  commencement: string;
  /** Legacy audit interval in years (pre-amendment). */
  legacyIntervalYears: number;
  /** New audit interval in years (post-amendment). */
  newIntervalYears: number;
  /** Date the 2024 code editions took effect. */
  code2024Effective: string;
}

export const DEFAULT_CONFIG: RegulatoryConfig = {
  commencement: "2026-09-20",
  legacyIntervalYears: 10,
  newIntervalYears: 5,
  code2024Effective: "2025-08-23",
};

/** Add calendar years to an ISO date, clamping 29 Feb to 28 Feb. */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const ny = y + years;
  if (m === 2 && d === 29 && !isLeap(ny)) return `${ny}-02-28`;
  return `${ny}-${pad(m)}-${pad(d)}`;
}

/** Add calendar months to an ISO date, clamping to month end. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const maxD = daysInMonth(ny, nm);
  return `${ny}-${pad(nm)}-${pad(Math.min(d, maxD))}`;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse register date format DD/MM/YYYY -> ISO, or null for '-' / blanks. */
export function parseRegisterDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
}

export interface DeadlineResult {
  /** EAF issue date derived from the published expiry. */
  issueDate: string;
  /** Published expiry under the legacy 10-year regime (echo of register). */
  legacyExpiry: string;
  /** Effective next-audit deadline once the amendment is in force. */
  newRegimeDeadline: string;
  /** Which code edition governs the *next* audit. */
  codeEdition: "BEC2015/EAC2015" | "BEC2024/EAC2024";
}

/**
 * Compute deadlines from a published EAF expiry date.
 *
 * Schedule 5, Part 2 (Ord. No. 24 of 2025): the dividing line is the date
 * the audit was CONDUCTED (issueDate = expiry − legacyInterval = audit start date).
 * - Audit conducted before commencement → 10-year interval → deadline = legacyExpiry.
 * - Audit conducted on/after commencement → 5-year interval → deadline = issue + 5y.
 */
export function computeDeadlines(
  expiryPublished: string,
  cfg: RegulatoryConfig = DEFAULT_CONFIG,
): DeadlineResult {
  const issueDate = addYears(expiryPublished, -cfg.legacyIntervalYears);
  const legacyExpiry = expiryPublished;

  const deadline = issueDate < cfg.commencement
    ? legacyExpiry
    : addYears(issueDate, cfg.newIntervalYears);

  const codeEdition = deadline >= cfg.code2024Effective ? "BEC2024/EAC2024" : "BEC2015/EAC2015";
  return { issueDate, legacyExpiry, newRegimeDeadline: deadline, codeEdition };
}

/** Urgency band used by digests. `today` ISO. */
export function urgencyBand(
  deadline: string,
  today: string,
): "overdue" | "due_6m" | "due_18m" | "later" {
  if (deadline < today) return "overdue";
  if (deadline <= addMonths(today, 6)) return "due_6m";
  if (deadline <= addMonths(today, 18)) return "due_18m";
  return "later";
}
