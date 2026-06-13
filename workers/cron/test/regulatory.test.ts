import { describe, it, expect } from "vitest";
import {
  computeDeadlines,
  parseRegisterDate,
  addYears,
  addMonths,
  urgencyBand,
  DEFAULT_CONFIG,
} from "../src/regulatory";

describe("date helpers", () => {
  it("adds years plainly", () => {
    expect(addYears("2028-11-13", -10)).toBe("2018-11-13");
    expect(addYears("2020-06-15", 5)).toBe("2025-06-15");
  });
  it("clamps 29 Feb to 28 Feb on non-leap targets", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
  });
  it("adds months with month-end clamping", () => {
    expect(addMonths("2026-09-20", 12)).toBe("2027-09-20");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("parses register DD/MM/YYYY dates", () => {
    expect(parseRegisterDate("13/11/2028")).toBe("2028-11-13");
    expect(parseRegisterDate("1/2/2030")).toBe("2030-02-01");
    expect(parseRegisterDate("-")).toBeNull();
    expect(parseRegisterDate("")).toBeNull();
    expect(parseRegisterDate(undefined)).toBeNull();
  });
});

// Schedule 5 Part 2 (Ord. No. 24 of 2025) + EMSD guidance:
// Audit conducted BEFORE 20 Sep 2026 → 10-year interval → published expiry unchanged.
describe("computeDeadlines — pre-commencement audits (10-year interval retained)", () => {
  // expiry 2028-11-13 -> issue 2018-11-13 (< commencement) -> deadline = 2028-11-13
  it("keeps published 10-year expiry when audit was before commencement", () => {
    const r = computeDeadlines("2028-11-13");
    expect(r.issueDate).toBe("2018-11-13");
    expect(r.legacyExpiry).toBe("2028-11-13");
    expect(r.newRegimeDeadline).toBe("2028-11-13");
    expect(r.codeEdition).toBe("BEC2024/EAC2024");
  });

  // expiry 2033-03-01 -> issue 2023-03-01 (< commencement) -> deadline = 2033-03-01
  // (the 5y mark 2028-03-01 is irrelevant — dividing line is the audit date, not the 5y mark)
  it("keeps published expiry regardless of where the 5-year mark falls", () => {
    const r = computeDeadlines("2033-03-01");
    expect(r.issueDate).toBe("2023-03-01");
    expect(r.newRegimeDeadline).toBe("2033-03-01");
  });

  // expiry 2026-10-01 -> issue 2016-10-01 (< commencement) -> deadline = 2026-10-01
  it("pre-commencement audit: deadline equals published expiry even if expiry is imminent", () => {
    const r = computeDeadlines("2026-10-01");
    expect(r.newRegimeDeadline).toBe("2026-10-01");
  });
});

describe("computeDeadlines — post-commencement audits (5-year interval)", () => {
  it("uses the 5-year interval when audit was on/after commencement", () => {
    // expiry published as issue+10y by old register logic: issue 2027-01-15
    const r = computeDeadlines("2037-01-15");
    expect(r.issueDate).toBe("2027-01-15");
    expect(r.newRegimeDeadline).toBe("2032-01-15");
    expect(r.codeEdition).toBe("BEC2024/EAC2024");
  });
});

describe("computeDeadlines — boundary dates", () => {
  it("audit exactly on commencement day gets 5-year interval", () => {
    const r = computeDeadlines(addYears(DEFAULT_CONFIG.commencement, 10)); // issue = commencement
    expect(r.issueDate).toBe("2026-09-20");
    expect(r.newRegimeDeadline).toBe("2031-09-20");
  });
  it("audit the day before commencement keeps 10-year interval", () => {
    // issue 2026-09-19 (< commencement) -> deadline = 2036-09-19 (legacy expiry)
    const r = computeDeadlines("2036-09-19");
    expect(r.issueDate).toBe("2026-09-19");
    expect(r.newRegimeDeadline).toBe("2036-09-19");
  });
  it("pre-commencement audit keeps 10-year interval even when 5y mark falls on commencement", () => {
    // issue 2021-09-20 -> 5y mark = 2026-09-20 == commencement, but audit < commencement
    const r = computeDeadlines("2031-09-20");
    expect(r.issueDate).toBe("2021-09-20");
    expect(r.newRegimeDeadline).toBe("2031-09-20");
  });
  it("deadline before code2024Effective keeps 2015 editions", () => {
    const r = computeDeadlines("2025-06-01"); // issue 2015-06-01 < commencement -> deadline = 2025-06-01
    expect(r.newRegimeDeadline).toBe("2025-06-01");
    expect(r.codeEdition).toBe("BEC2015/EAC2015");
  });
});

describe("config override", () => {
  it("a commencement slip is a config change", () => {
    // new commencement 2027-03-01; issue 2023-03-01 < new commencement -> 10-year interval
    const cfg = { ...DEFAULT_CONFIG, commencement: "2027-03-01" };
    const r = computeDeadlines("2033-03-01", cfg);
    expect(r.newRegimeDeadline).toBe("2033-03-01");
  });
  it("post-commencement audit under slipped commencement gets 5-year interval", () => {
    // commencement 2027-03-01; issue 2027-06-01 >= new commencement -> 5-year interval
    const cfg = { ...DEFAULT_CONFIG, commencement: "2027-03-01" };
    const r = computeDeadlines("2037-06-01", cfg);
    expect(r.issueDate).toBe("2027-06-01");
    expect(r.newRegimeDeadline).toBe("2032-06-01");
  });
});

describe("urgencyBand", () => {
  const today = "2026-06-12";
  it("classifies bands", () => {
    expect(urgencyBand("2026-06-11", today)).toBe("overdue");
    expect(urgencyBand("2026-06-12", today)).toBe("due_6m");
    expect(urgencyBand("2026-12-12", today)).toBe("due_6m");
    expect(urgencyBand("2026-12-13", today)).toBe("due_18m");
    expect(urgencyBand("2027-12-12", today)).toBe("due_18m");
    expect(urgencyBand("2027-12-13", today)).toBe("later");
  });
});
