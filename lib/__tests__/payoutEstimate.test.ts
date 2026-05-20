/**
 * Unit tests for lib/payoutEstimate.ts — Feature 2.1: Live Payout Estimate
 *
 * Covers the three technical constraints:
 *   1. Graceful degradation — estimable: false with a clear reason when fields missing
 *   2. Confidence modeling — confirmed / pending_approval / not_entered per category
 *   3. Ticket projection — unsold seats × avg price re-runs the full calculation
 */

import { describe, it, expect } from "vitest";
import { computePayoutEstimate } from "../payoutEstimate";
import type { Deal, Expense, Recoup, TicketSale } from "../../db/schema";

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

function makeSale(gross: number, fees: number, qty: number): TicketSale {
  return {
    id: `sale-${Math.random()}`,
    showId: "show-1",
    qty,
    gross,
    fees,
    capturedAt: new Date(),
  };
}

function makeExpense(
  amount: number,
  category: Expense["category"] = "production",
  approved = true,
  absorbedByVenue = false,
): Expense {
  return {
    id: `exp-${Math.random()}`,
    showId: "show-1",
    category,
    amount,
    description: null,
    approved,
    absorbedByVenue,
    enteredByUserId: null,
    enteredAt: new Date(),
  };
}

function makeRecoup(amount: number, application?: Recoup["application"]): Recoup {
  return {
    id: `recoup-${Math.random()}`,
    category: "marketing",
    label: "Marketing recoup",
    amount,
    status: "agreed",
    application,
  };
}

// ---- Tests ----

describe("computePayoutEstimate", () => {

  // ── Graceful degradation ──────────────────────────────────────────────────

  describe("Graceful degradation — estimable: false with explicit reason", () => {
    it("returns estimable: false with reason when no deal is provided", () => {
      const result = computePayoutEstimate({
        deal: null,
        ticketSales: [],
        expenses: [],
        recoups: [],
      });
      expect(result.estimable).toBe(false);
      if (!result.estimable) {
        expect(result.reason).toMatch(/no deal/i);
      }
    });

    it("returns estimable: false with reason when vs deal is missing guarantee", () => {
      const result = computePayoutEstimate({
        deal: makeDeal({ guaranteeAmount: null }),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [],
        recoups: [],
      });
      expect(result.estimable).toBe(false);
      if (!result.estimable) {
        expect(result.reason).toMatch(/guarantee/i);
      }
    });

    it("returns estimable: false with reason when vs deal is missing percentage", () => {
      const result = computePayoutEstimate({
        deal: makeDeal({ percentage: null }),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [],
        recoups: [],
      });
      expect(result.estimable).toBe(false);
      if (!result.estimable) {
        expect(result.reason).toMatch(/percentage/i);
      }
    });

    it("returns estimable: false with reason for flat deal missing guarantee", () => {
      const result = computePayoutEstimate({
        deal: makeDeal({ dealType: "flat", guaranteeAmount: null }),
        ticketSales: [makeSale(10000, 800, 200)],
        expenses: [],
        recoups: [],
      });
      expect(result.estimable).toBe(false);
      if (!result.estimable) {
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });

    it("returns estimable: false when a vs deal is missing its guarantee", () => {
      // calculateSettlement returns supported: false → estimate should be blocked
      const result = computePayoutEstimate({
        deal: makeDeal({ dealType: "vs", guaranteeAmount: null }),
        ticketSales: [makeSale(10000, 800, 200)],
        expenses: [],
        recoups: [],
      });
      expect(result.estimable).toBe(false);
      if (!result.estimable) {
        expect(result.reason).toMatch(/guarantee/i);
      }
    });
  });

  // ── Confidence model ──────────────────────────────────────────────────────

  describe("Confidence model — confirmed / pending_approval / not_entered", () => {
    const sales = [makeSale(20000, 1984, 500)];

    it("returns high confidence when all expected categories are confirmed", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: sales,
        expenses: [
          makeExpense(800, "production", true),  // approved
          makeExpense(600, "sound", true),        // approved
          makeExpense(400, "lights", true),       // approved
        ],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.confidence).toBe("high");
        expect(result.pendingExpenseCategories).toHaveLength(0);
      }
    });

    it("returns medium confidence when expected categories are not entered", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: sales,
        expenses: [], // nothing entered
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.confidence).toBe("medium");
        expect(result.pendingExpenseCategories.length).toBeGreaterThan(0);
      }
    });

    it("marks not_entered categories with state 'not_entered'", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: sales,
        expenses: [makeExpense(800, "production", true)], // only production entered
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        const sound = result.expenseCategoryStates.find((s) => s.label === "Sound");
        const lights = result.expenseCategoryStates.find((s) => s.label === "Lights");
        expect(sound?.state).toBe("not_entered");
        expect(lights?.state).toBe("not_entered");
      }
    });

    it("marks a category 'pending_approval' when expenses exist but are not approved", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: sales,
        expenses: [
          makeExpense(800, "production", false), // entered but NOT approved
          makeExpense(600, "sound", true),
          makeExpense(400, "lights", true),
        ],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.confidence).toBe("medium");
        const production = result.expenseCategoryStates.find((s) => s.label === "Production");
        expect(production?.state).toBe("pending_approval");
        expect(result.pendingExpenseCategories).toContain("Production");
      }
    });

    it("marks a category 'confirmed' when all its expenses are approved", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: sales,
        expenses: [
          makeExpense(800, "production", true),
          makeExpense(600, "sound", true),
          makeExpense(400, "lights", true),
        ],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        for (const state of result.expenseCategoryStates) {
          expect(state.state).toBe("confirmed");
        }
      }
    });

    it("includes hospitality in expected categories when hospitalityCap is set", () => {
      const result = computePayoutEstimate({
        deal: makeDeal({ hospitalityCap: 1000 }),
        ticketSales: sales,
        expenses: [
          makeExpense(800, "production", true),
          makeExpense(600, "sound", true),
          makeExpense(400, "lights", true),
          // hospitality NOT entered
        ],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.confidence).toBe("medium");
        const hospitality = result.expenseCategoryStates.find((s) => s.label === "Hospitality");
        expect(hospitality?.state).toBe("not_entered");
      }
    });

    it("does NOT include hospitality in expected categories when hospitalityCap is null", () => {
      const result = computePayoutEstimate({
        deal: makeDeal({ hospitalityCap: null }),
        ticketSales: sales,
        expenses: [
          makeExpense(800, "production", true),
          makeExpense(600, "sound", true),
          makeExpense(400, "lights", true),
        ],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.confidence).toBe("high");
        const hospitality = result.expenseCategoryStates.find((s) => s.label === "Hospitality");
        expect(hospitality).toBeUndefined();
      }
    });

    it("rounds displayPayout to nearest $10 when confidence is medium", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [], // nothing entered → medium confidence
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.confidence).toBe("medium");
        expect(result.displayPayout % 10).toBe(0);
      }
    });

    it("does NOT round when confidence is high", () => {
      const result = computePayoutEstimate({
        deal: makeDeal({ guaranteeAmount: 5000, percentage: 0.8, expenseCap: 2500 }),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [
          makeExpense(800, "production", true),
          makeExpense(600, "sound", true),
          makeExpense(400, "lights", true),
        ],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.confidence).toBe("high");
        expect(result.displayPayout).toBe(result.currentPayout);
      }
    });

    it("absorbed expenses do not count toward confidence categories", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: sales,
        expenses: [
          makeExpense(800, "production", true, true), // absorbed — shouldn't count
          makeExpense(600, "sound", true),
          makeExpense(400, "lights", true),
        ],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        // Production is absorbed → still "not_entered" for confidence purposes
        const production = result.expenseCategoryStates.find((s) => s.label === "Production");
        expect(production?.state).toBe("not_entered");
        expect(result.confidence).toBe("medium");
      }
    });
  });

  // ── Ticket projection ─────────────────────────────────────────────────────

  describe("Ticket projection", () => {
    it("computes projection when venue capacity is known and tickets remain", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: [makeSale(10000, 992, 250)], // 250 sold of 500 capacity
        expenses: [],
        recoups: [],
        venueCapacity: 500,
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.ticketProjection).toBeDefined();
        expect(result.ticketProjection!.unsold).toBe(250);
        expect(result.ticketProjection!.sold).toBe(250);
        expect(result.ticketProjection!.avgTicketPrice).toBeCloseTo(40, 1); // 10000 / 250
        expect(result.ticketProjection!.projectedGross).toBeCloseTo(20000, 0);
      }
    });

    it("omits projection when all tickets are sold", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [],
        recoups: [],
        venueCapacity: 500, // 500 sold = 500 capacity → 0 unsold
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.ticketProjection).toBeUndefined();
      }
    });

    it("omits projection when venue capacity is not known", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: [makeSale(10000, 992, 250)],
        expenses: [],
        recoups: [],
        // venueCapacity not provided
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.ticketProjection).toBeUndefined();
      }
    });

    it("omits projection when no tickets have been sold yet (no avg to project from)", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: [],
        expenses: [],
        recoups: [],
        venueCapacity: 500,
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.ticketProjection).toBeUndefined();
      }
    });

    it("projected payout runs the full settlement calculation (not just an extrapolation)", () => {
      // vs deal: guarantee $5k, 80% of net, expenseCap $2500
      // At 250 tickets ($10k gross), percentage track doesn't beat guarantee.
      // At 500 tickets ($20k gross), it should — verifying projection uses full calc.
      const result = computePayoutEstimate({
        deal: makeDeal({ guaranteeAmount: 5000, percentage: 0.8, expenseCap: 2500 }),
        ticketSales: [makeSale(10000, 992, 250)],
        expenses: [makeExpense(2000, "production", true)],
        recoups: [],
        venueCapacity: 500,
      });
      expect(result.estimable).toBe(true);
      if (result.estimable && result.ticketProjection) {
        // Projected payout should be greater than current (more tickets → higher gross → % may win)
        expect(result.ticketProjection.projectedPayout).toBeGreaterThan(result.currentPayout);
      }
    });
  });

  // ── Vs deal comparison ────────────────────────────────────────────────────

  describe("Vs deal comparison", () => {
    it("returns vsComparison when deal type is vs", () => {
      const result = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [makeExpense(2000, "production", true)],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.vsComparison).toBeDefined();
      }
    });

    it("does NOT return vsComparison for flat deals", () => {
      const result = computePayoutEstimate({
        deal: makeDeal({ dealType: "flat", guaranteeAmount: 5000, percentage: null }),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.vsComparison).toBeUndefined();
      }
    });

    it("vsComparison.winner is 'percentage' when % track exceeds guarantee", () => {
      // High gross → percentage should win
      const result = computePayoutEstimate({
        deal: makeDeal({ guaranteeAmount: 5000, percentage: 0.8, expenseCap: 2500 }),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [makeExpense(2000, "production", true)],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.vsComparison?.winner).toBe("percentage");
        expect(result.vsComparison?.margin).toBeGreaterThan(0);
      }
    });

    it("vsComparison.winner is 'guarantee' when gross is too low for % to win", () => {
      const result = computePayoutEstimate({
        deal: makeDeal({ guaranteeAmount: 5000, percentage: 0.8, expenseCap: 2500 }),
        ticketSales: [makeSale(5000, 400, 100)], // low gross
        expenses: [makeExpense(2000, "production", true)],
        recoups: [],
      });
      expect(result.estimable).toBe(true);
      if (result.estimable) {
        expect(result.vsComparison?.winner).toBe("guarantee");
      }
    });
  });

  // ── Recoups in projection ─────────────────────────────────────────────────

  describe("Recoups factor into estimate", () => {
    it("pre_net recoups reduce the net and lower the estimate", () => {
      const base = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [makeExpense(2000, "production", true)],
        recoups: [],
      });
      const withRecoup = computePayoutEstimate({
        deal: makeDeal(),
        ticketSales: [makeSale(20000, 1984, 500)],
        expenses: [makeExpense(2000, "production", true)],
        recoups: [makeRecoup(1000, "pre_net")],
      });
      expect(base.estimable).toBe(true);
      expect(withRecoup.estimable).toBe(true);
      if (base.estimable && withRecoup.estimable) {
        expect(withRecoup.currentPayout).toBeLessThan(base.currentPayout);
      }
    });
  });
});
