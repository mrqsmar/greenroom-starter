/**
 * Unit tests for lib/dealMath.ts — Feature 1.1: Vs Deal Calculator
 *
 * Acceptance criteria source: the PRD's Coastal Spell example.
 * $19,840 gross − $1,984 fees − $900 recoup − $2,500 expenses = $14,456 net
 * 80% × $14,456 = $11,565. MAX($5,000, $11,565) = $11,565.
 */

import { describe, it, expect } from "vitest";
import { calculateSettlement, parseBonuses } from "../dealMath";
import type { Deal, TicketSale, Expense, Recoup } from "../../db/schema";

// ---- Fixture factories ----

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    showId: "show-1",
    dealType: "vs",
    guaranteeAmount: 5000,
    percentage: 0.8,
    percentageBasis: "net",
    expenseCap: 2500,
    hospitalityCap: null,
    bonusesJson: null,
    dealNotesFreetext: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSale(gross: number, fees: number, qty = 100): TicketSale {
  return {
    id: "ts-1",
    showId: "show-1",
    qty,
    gross,
    fees,
    capturedAt: new Date(),
  };
}

function makeExpense(amount: number, category: Expense["category"] = "production", absorbedByVenue = false): Expense {
  return {
    id: `exp-${Math.random()}`,
    showId: "show-1",
    category,
    amount,
    description: null,
    approved: true,
    absorbedByVenue,
    enteredByUserId: null,
    enteredAt: new Date(),
  };
}

function makeRecoup(amount: number, application?: Recoup["application"], status: Recoup["status"] = "agreed"): Recoup {
  return {
    id: `recoup-${Math.random()}`,
    category: "marketing",
    label: "Marketing recoup",
    amount,
    status,
    application,
  };
}

// ---- Coastal Spell fixture (PRD acceptance criteria) ----

const coastalSpellSales = [makeSale(19840, 1984, 600)];
const coastalSpellExpenses = [makeExpense(2500)]; // at cap
const coastalSpellRecoups = [makeRecoup(900)];    // no application → defaults to pre_net
const coastalSpellDeal = makeDeal();              // guarantee: $5,000, 80%, cap: $2,500

// ---- Tests ----

describe("Feature 1.1 — Vs Deal Calculator", () => {

  describe("Coastal Spell acceptance criteria", () => {
    it("returns supported: true", () => {
      const result = calculateSettlement({
        deal: coastalSpellDeal,
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      expect(result.supported).toBe(true);
    });

    it("calculates net correctly: gross − fees − recoup − expenses = $14,456", () => {
      const result = calculateSettlement({
        deal: coastalSpellDeal,
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      // netBoxOffice = gross - fees only; actual net-after-deductions is in vsDetails
      expect(result.vsDetails!.netAfterDeductions).toBe(14456);
    });

    it("percentage payout = 80% × $14,456 = $11,564.80", () => {
      const result = calculateSettlement({
        deal: coastalSpellDeal,
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.vsDetails!.percentagePayout).toBeCloseTo(11564.8, 1);
    });

    it("percentage track wins over $5,000 guarantee", () => {
      const result = calculateSettlement({
        deal: coastalSpellDeal,
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.vsDetails!.winner).toBe("percentage");
    });

    it("total to artist = $11,564.80 (percentage track, no bonuses)", () => {
      const result = calculateSettlement({
        deal: coastalSpellDeal,
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.totalToArtist).toBeCloseTo(11564.8, 1);
    });
  });

  // ---- Step-by-step worksheet ----

  describe("Step 1 — Gross box office", () => {
    it("sums all ticket sale gross amounts", () => {
      const sales = [makeSale(10000, 500), makeSale(5000, 250)];
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: sales,
        expenses: [],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.grossBoxOffice).toBe(15000);
    });
  });

  describe("Step 2 — Less platform/CC fees", () => {
    it("deducts fees from gross to get netBoxOffice", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.netBoxOffice).toBe(18000);
    });

    it("includes a 'Less platform & CC fees' step in the worksheet", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      const feesStep = result.steps.find(s => s.label.includes("fees"));
      expect(feesStep).toBeDefined();
      expect(feesStep!.value).toBe(-2000);
      expect(feesStep!.isDeduction).toBe(true);
    });
  });

  describe("Step 3 — Less applicable recoups", () => {
    it("deducts agreed recoups with no application field (default: pre_net)", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: null }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(1000)],
        recoups: [makeRecoup(900)], // no application → pre_net
      });
      if (!result.supported) throw new Error("Expected supported result");
      // net = 20000 - 2000 - 900 - 1000 = 16100
      expect(result.vsDetails!.netAfterDeductions).toBe(16100);
    });

    it("deducts agreed recoups with explicit pre_net application", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: null }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(1000)],
        recoups: [makeRecoup(900, "pre_net")],
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.vsDetails!.netAfterDeductions).toBe(16100);
    });

    it("deducts additional_to_cap recoups (treated as pre_net in calculation)", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: 2500 }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(2000)],
        recoups: [makeRecoup(900, "additional_to_cap")],
      });
      if (!result.supported) throw new Error("Expected supported result");
      // net = 20000 - 2000 - 900 - 2000 = 15100 (expenses 2000 < cap 2500)
      expect(result.vsDetails!.netAfterDeductions).toBe(15100);
    });

    it("inside_cap recoups eat into the expense cap ceiling", () => {
      // Cap: $2,500 | inside_cap recoup: $900 → only $1,600 of expenses can pass through
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: 2500 }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(2500)], // would use full cap without recoup
        recoups: [makeRecoup(900, "inside_cap")],
      });
      if (!result.supported) throw new Error("Expected supported result");
      // capRemaining = 2500 - 900 = 1600 → cappedExpenses = min(2500, 1600) = 1600
      // net = 20000 - 2000 - 900 - 1600 = 15500
      expect(result.vsDetails!.netAfterDeductions).toBe(15500);
    });

    it("post_net recoups are deducted after the expense calculation", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: null }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(1000)],
        recoups: [makeRecoup(500, "post_net")],
      });
      if (!result.supported) throw new Error("Expected supported result");
      // net = 20000 - 2000 - 1000 - 500 = 16500
      expect(result.vsDetails!.netAfterDeductions).toBe(16500);
    });

    it("skips disputed recoups — they don't reduce the net", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: null }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(1000)],
        recoups: [makeRecoup(900, undefined, "disputed")],
      });
      if (!result.supported) throw new Error("Expected supported result");
      // disputed recoup not deducted: net = 20000 - 2000 - 1000 = 17000
      expect(result.vsDetails!.netAfterDeductions).toBe(17000);
    });

    it("skips withdrawn recoups", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: null }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(1000)],
        recoups: [makeRecoup(900, undefined, "withdrawn")],
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.vsDetails!.netAfterDeductions).toBe(17000);
    });

    it("handles multiple recoups with different placements", () => {
      // pre_net: 500 (deducted before cap), inside_cap: 400 (eats cap)
      // cap: 2000, expenses: 2000 → capped at 2000 - 400 = 1600
      // net = 20000 - 2000 - 500 - 400 - 1600 = 15500
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: 2000 }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(2000)],
        recoups: [
          makeRecoup(500, "pre_net"),
          makeRecoup(400, "inside_cap"),
        ],
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.vsDetails!.netAfterDeductions).toBe(15500);
    });

    it("no recoups → recoup step absent from worksheet", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      const recoupStep = result.steps.find(s => s.label.includes("recoup"));
      expect(recoupStep).toBeUndefined();
    });
  });

  describe("Step 4 — Less capped venue expenses", () => {
    it("applies expense cap when actual expenses exceed it", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: 2500 }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(3500)], // over cap
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      // cappedExpenses = min(3500, 2500) = 2500
      expect(result.totalExpenses).toBe(2500);
    });

    it("does not cap when actual expenses are below the cap", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: 2500 }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(1800)],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.totalExpenses).toBe(1800);
    });

    it("passes all expenses through when no expense cap is set", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: null }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(4000)],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.totalExpenses).toBe(4000);
    });

    it("excludes absorbed-by-venue expenses from the calculation", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: null }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(1000), makeExpense(500, "production", true)], // 500 absorbed
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      // net = 20000 - 2000 - 1000 (only non-absorbed) = 17000
      expect(result.vsDetails!.netAfterDeductions).toBe(17000);
    });

    it("expense step in worksheet notes when capped vs. within cap", () => {
      const result = calculateSettlement({
        deal: makeDeal({ expenseCap: 2500 }),
        ticketSales: [makeSale(20000, 2000)],
        expenses: [makeExpense(3200)], // over cap
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      const expStep = result.steps.find(s => s.label.includes("expenses"));
      expect(expStep).toBeDefined();
      expect(expStep!.note).toMatch(/Capped at/i);
    });
  });

  describe("Steps 5–6 — Net and percentage track", () => {
    it("net step appears in the worksheet", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      const netStep = result.steps.find(s => s.label === "Net");
      expect(netStep).toBeDefined();
      expect(netStep!.value).toBe(14456);
    });

    it("percentage track step appears in the worksheet", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      const pctStep = result.steps.find(s => s.label.includes("80%"));
      expect(pctStep).toBeDefined();
      expect(pctStep!.value).toBeCloseTo(11564.8, 1);
    });

    it("percentage payout floors at 0 when net is negative", () => {
      // Pathological case: massive fees + expenses drive net negative
      const result = calculateSettlement({
        deal: makeDeal({ guaranteeAmount: 5000, expenseCap: null }),
        ticketSales: [makeSale(1000, 800)],
        expenses: [makeExpense(5000)],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.vsDetails!.percentagePayout).toBe(0);
      // guarantee wins because percentage is 0
      expect(result.vsDetails!.winner).toBe("guarantee");
      expect(result.totalToArtist).toBe(5000);
    });
  });

  describe("Step 7 — MAX(guarantee, percentage payout)", () => {
    it("guarantee wins when it exceeds the percentage track", () => {
      // Low-selling show: percentage track < guarantee
      const result = calculateSettlement({
        deal: makeDeal({ guaranteeAmount: 5000, expenseCap: null }),
        ticketSales: [makeSale(5000, 500)],
        expenses: [makeExpense(1000)],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      // net = 5000 - 500 - 1000 = 3500 | 80% = 2800 < 5000 guarantee
      expect(result.vsDetails!.winner).toBe("guarantee");
      expect(result.totalToArtist).toBe(5000);
    });

    it("percentage wins when it exceeds the guarantee", () => {
      // High-selling show: percentage track > guarantee
      const result = calculateSettlement({
        deal: makeDeal({ guaranteeAmount: 5000, expenseCap: null }),
        ticketSales: [makeSale(30000, 3000)],
        expenses: [makeExpense(2000)],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      // net = 30000 - 3000 - 2000 = 25000 | 80% = 20000 > 5000
      expect(result.vsDetails!.winner).toBe("percentage");
      expect(result.totalToArtist).toBe(20000);
    });

    it("guarantee wins on exact tie (guarantee === percentage payout)", () => {
      // Net = 6250, 80% = 5000, guarantee = 5000 → percentage wins (>= comparison)
      // Change guarantee to 5001 to force guarantee win on near-tie
      const result = calculateSettlement({
        deal: makeDeal({ guaranteeAmount: 5001, expenseCap: null }),
        ticketSales: [makeSale(6250, 0)],
        expenses: [],
        recoups: [],
      });
      if (!result.supported) throw new Error("Expected supported result");
      // 80% × 6250 = 5000 < 5001 guarantee
      expect(result.vsDetails!.winner).toBe("guarantee");
      expect(result.totalToArtist).toBe(5001);
    });

    it("vsDetails exposes both values for explicit UI comparison", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.vsDetails).toMatchObject({
        guarantee: 5000,
        winner: "percentage",
      });
      expect(result.vsDetails!.percentagePayout).toBeCloseTo(11564.8, 1);
    });
  });

  describe("Step 8 — Bonus tiers", () => {
    it("applies a gross_threshold bonus when gross meets the threshold", () => {
      const deal = makeDeal({
        bonusesJson: JSON.stringify([
          { type: "gross_threshold", label: "Sellout bonus", threshold: 15000, amount: 1000 },
        ]),
      });
      const result = calculateSettlement({
        deal,
        ticketSales: coastalSpellSales, // gross = 19840 > 15000
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.bonusesApplied).toHaveLength(1);
      expect(result.bonusesApplied[0].amount).toBe(1000);
      expect(result.totalToArtist).toBeCloseTo(11564.8 + 1000, 1);
    });

    it("does NOT apply a gross_threshold bonus when gross falls short", () => {
      const deal = makeDeal({
        bonusesJson: JSON.stringify([
          { type: "gross_threshold", label: "Big bonus", threshold: 25000, amount: 1000 },
        ]),
      });
      const result = calculateSettlement({
        deal,
        ticketSales: coastalSpellSales, // gross = 19840 < 25000
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.bonusesApplied).toHaveLength(0);
      expect(result.bonusesNotTriggered).toHaveLength(1);
    });

    it("bonus threshold progress shows distance to trigger", () => {
      const deal = makeDeal({
        bonusesJson: JSON.stringify([
          { type: "gross_threshold", label: "Gross bonus", threshold: 25000, amount: 1000 },
        ]),
      });
      const result = calculateSettlement({
        deal,
        ticketSales: coastalSpellSales, // gross = 19840
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.bonusThresholdProgress).toHaveLength(1);
      expect(result.bonusThresholdProgress![0]).toMatchObject({
        threshold: 25000,
        currentGross: 19840,
        away: 5160,    // $25,000 − $19,840 = $5,160 (PRD example)
        triggered: false,
      });
    });

    it("bonus threshold progress shows triggered state when gross exceeds threshold", () => {
      const deal = makeDeal({
        bonusesJson: JSON.stringify([
          { type: "gross_threshold", label: "Gross bonus", threshold: 15000, amount: 1000 },
        ]),
      });
      const result = calculateSettlement({
        deal,
        ticketSales: coastalSpellSales, // gross = 19840 > 15000
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.bonusThresholdProgress![0]).toMatchObject({
        away: 0,
        triggered: true,
      });
    });

    it("returns no bonusThresholdProgress when deal has no gross_threshold bonuses", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.bonusThresholdProgress).toBeUndefined();
    });
  });

  // ---- Worksheet structure ----

  describe("Worksheet step structure", () => {
    it("gross box office is the first step", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.steps[0].label).toMatch(/gross box office/i);
      expect(result.steps[0].value).toBe(19840);
    });

    it("deduction steps carry isDeduction: true", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      const deductions = result.steps.filter(s => s.isDeduction);
      expect(deductions.length).toBeGreaterThan(0);
      deductions.forEach(s => {
        expect(s.value).toBeLessThan(0);
      });
    });

    it("finalFormula string is populated", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: coastalSpellRecoups,
      });
      if (!result.supported) throw new Error("Expected supported result");
      expect(result.finalFormula).toContain("guarantee");
      expect(result.finalFormula).toContain("80%");
    });
  });

  // ---- Validation / graceful degradation ----

  describe("Graceful degradation — missing structured fields", () => {
    it("returns supported: false when guarantee is missing", () => {
      const result = calculateSettlement({
        deal: makeDeal({ guaranteeAmount: null }),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: [],
      });
      expect(result.supported).toBe(false);
      if (result.supported) throw new Error("Expected unsupported");
      expect(result.reason).toMatch(/guarantee/i);
      expect(result.dealType).toBe("vs");
    });

    it("returns supported: false when percentage is missing", () => {
      const result = calculateSettlement({
        deal: makeDeal({ percentage: null }),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        recoups: [],
      });
      expect(result.supported).toBe(false);
      if (result.supported) throw new Error("Expected unsupported");
      expect(result.reason).toMatch(/percentage/i);
    });

    it("still runs without recoups param (undefined)", () => {
      const result = calculateSettlement({
        deal: makeDeal(),
        ticketSales: coastalSpellSales,
        expenses: coastalSpellExpenses,
        // recoups intentionally omitted
      });
      expect(result.supported).toBe(true);
    });
  });

  // ---- Other deal types still work ----

  describe("Flat and percentage_of_gross deals unaffected", () => {
    it("flat deal still returns the guarantee", () => {
      const result = calculateSettlement({
        deal: makeDeal({ dealType: "flat", guaranteeAmount: 3000 }),
        ticketSales: [makeSale(10000, 1000)],
        expenses: [makeExpense(500)],
        recoups: [],
      });
      expect(result.supported).toBe(true);
      if (!result.supported) throw new Error("Expected supported");
      expect(result.totalToArtist).toBe(3000);
    });

    it("percentage_of_gross deal still returns gross × percentage", () => {
      const result = calculateSettlement({
        deal: makeDeal({ dealType: "percentage_of_gross", percentage: 0.85 }),
        ticketSales: [makeSale(10000, 1000)],
        expenses: [makeExpense(500)],
        recoups: [],
      });
      expect(result.supported).toBe(true);
      if (!result.supported) throw new Error("Expected supported");
      expect(result.totalToArtist).toBe(10000 * 0.85);
    });

    it("door deal still returns supported: false (out of V1 scope)", () => {
      const result = calculateSettlement({
        deal: makeDeal({ dealType: "door" }),
        ticketSales: [makeSale(10000, 1000)],
        expenses: [],
        recoups: [],
      });
      expect(result.supported).toBe(false);
    });
  });

  // ---- parseBonuses helper ----

  describe("parseBonuses", () => {
    it("returns empty array when bonusesJson is null", () => {
      expect(parseBonuses(makeDeal({ bonusesJson: null }))).toEqual([]);
    });

    it("returns empty array on malformed JSON", () => {
      expect(parseBonuses(makeDeal({ bonusesJson: "not json" }))).toEqual([]);
    });

    it("returns parsed bonuses", () => {
      const bonuses = [{ type: "gross_threshold", label: "Test", threshold: 10000, amount: 500 }];
      expect(parseBonuses(makeDeal({ bonusesJson: JSON.stringify(bonuses) }))).toEqual(bonuses);
    });
  });
});
