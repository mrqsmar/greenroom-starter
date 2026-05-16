/**
 * Unit tests for lib/dealCompleteness.ts — Feature 1.3: Deal Completeness Indicator
 *
 * Each warning type maps to a real scenario from the PRD. The Coastal Spell
 * dispute (recoup_no_application) is the canonical high-priority case.
 */

import { describe, it, expect } from "vitest";
import { checkDealCompleteness } from "../dealCompleteness";
import type { Deal, Expense, Recoup } from "../../db/schema";

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

function makeExpense(
  amount: number,
  category: Expense["category"] = "production",
  absorbedByVenue = false,
): Expense {
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

function makeRecoup(
  amount: number,
  application?: Recoup["application"],
  status: Recoup["status"] = "agreed",
): Recoup {
  return {
    id: `recoup-${Math.random()}`,
    category: "marketing",
    label: "Marketing recoup",
    amount,
    status,
    application,
  };
}

// ---- Tests ----

describe("Feature 1.3 — Deal Completeness Indicator", () => {

  describe("No warnings on a fully-specified vs deal", () => {
    it("returns no warnings when all fields are present and recoups have application types", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ guaranteeAmount: 5000, percentage: 0.8, expenseCap: 2500 }),
        [makeRecoup(900, "pre_net")],
        [makeExpense(1000)],
      );
      expect(warnings).toHaveLength(0);
    });

    it("returns no warnings when there are no recoups", () => {
      const warnings = checkDealCompleteness(
        makeDeal(),
        [],
        [makeExpense(1000)],
      );
      expect(warnings).toHaveLength(0);
    });
  });

  // ---- missing_guarantee ----

  describe("missing_guarantee warning", () => {
    it("fires on a vs deal with no guarantee amount", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ guaranteeAmount: null }),
        [],
        [],
      );
      const w = warnings.find(w => w.type === "missing_guarantee");
      expect(w).toBeDefined();
      expect(w!.severity).toBe("high");
    });

    it("fires on percentage_of_net with no guarantee", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ dealType: "percentage_of_net", guaranteeAmount: null }),
        [],
        [],
      );
      expect(warnings.some(w => w.type === "missing_guarantee")).toBe(true);
    });

    it("does NOT fire on a flat deal (flat has no percentage track)", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ dealType: "flat", guaranteeAmount: null }),
        [],
        [],
      );
      expect(warnings.some(w => w.type === "missing_guarantee")).toBe(false);
    });

    it("does NOT fire when guarantee is present", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ guaranteeAmount: 5000 }),
        [],
        [],
      );
      expect(warnings.some(w => w.type === "missing_guarantee")).toBe(false);
    });
  });

  // ---- missing_percentage ----

  describe("missing_percentage warning", () => {
    it("fires on a vs deal with no percentage", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ percentage: null }),
        [],
        [],
      );
      const w = warnings.find(w => w.type === "missing_percentage");
      expect(w).toBeDefined();
      expect(w!.severity).toBe("high");
    });

    it("fires on percentage_of_gross with no percentage", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ dealType: "percentage_of_gross", percentage: null }),
        [],
        [],
      );
      expect(warnings.some(w => w.type === "missing_percentage")).toBe(true);
    });

    it("fires on percentage_of_net with no percentage", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ dealType: "percentage_of_net", percentage: null }),
        [],
        [],
      );
      expect(warnings.some(w => w.type === "missing_percentage")).toBe(true);
    });

    it("does NOT fire on a flat deal (flat has no percentage)", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ dealType: "flat", percentage: null }),
        [],
        [],
      );
      expect(warnings.some(w => w.type === "missing_percentage")).toBe(false);
    });

    it("does NOT fire when percentage is present", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ percentage: 0.8 }),
        [],
        [],
      );
      expect(warnings.some(w => w.type === "missing_percentage")).toBe(false);
    });
  });

  // ---- no_expense_cap ----

  describe("no_expense_cap warning", () => {
    it("fires on a vs deal with no expense cap and passed-through expenses", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ expenseCap: null }),
        [],
        [makeExpense(1000)],
      );
      const w = warnings.find(w => w.type === "no_expense_cap");
      expect(w).toBeDefined();
      expect(w!.severity).toBe("medium");
    });

    it("does NOT fire when there are no passed-through expenses (absorbed counts don't matter)", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ expenseCap: null }),
        [],
        [makeExpense(1000, "production", true)], // absorbed by venue
      );
      expect(warnings.some(w => w.type === "no_expense_cap")).toBe(false);
    });

    it("does NOT fire when there are no expenses at all", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ expenseCap: null }),
        [],
        [],
      );
      expect(warnings.some(w => w.type === "no_expense_cap")).toBe(false);
    });

    it("does NOT fire when an expense cap is set", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ expenseCap: 2500 }),
        [],
        [makeExpense(3000)],
      );
      expect(warnings.some(w => w.type === "no_expense_cap")).toBe(false);
    });

    it("does NOT fire for flat deals (flat has no net calculation)", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ dealType: "flat", expenseCap: null }),
        [],
        [makeExpense(1000)],
      );
      expect(warnings.some(w => w.type === "no_expense_cap")).toBe(false);
    });
  });

  // ---- recoup_no_application (the Coastal Spell scenario) ----

  describe("recoup_no_application warning — the Coastal Spell scenario", () => {
    it("fires when an agreed recoup has no application field", () => {
      const warnings = checkDealCompleteness(
        makeDeal(),
        [makeRecoup(900)], // no application
        [],
      );
      const w = warnings.find(w => w.type === "recoup_no_application");
      expect(w).toBeDefined();
      expect(w!.severity).toBe("high");
    });

    it("message references the recoup label", () => {
      const warnings = checkDealCompleteness(
        makeDeal(),
        [makeRecoup(900)],
        [],
      );
      const w = warnings.find(w => w.type === "recoup_no_application");
      expect(w!.message).toContain("Marketing recoup");
    });

    it("does NOT fire when all recoups have an application field", () => {
      const warnings = checkDealCompleteness(
        makeDeal(),
        [makeRecoup(900, "pre_net"), makeRecoup(200, "inside_cap")],
        [],
      );
      expect(warnings.some(w => w.type === "recoup_no_application")).toBe(false);
    });

    it("does NOT fire for withdrawn recoups without application (withdrawn = resolved)", () => {
      const warnings = checkDealCompleteness(
        makeDeal(),
        [makeRecoup(900, undefined, "withdrawn")],
        [],
      );
      expect(warnings.some(w => w.type === "recoup_no_application")).toBe(false);
    });

    it("fires for a disputed recoup with no application — dispute doesn't resolve ambiguity", () => {
      const warnings = checkDealCompleteness(
        makeDeal(),
        [makeRecoup(900, undefined, "disputed")],
        [],
      );
      expect(warnings.some(w => w.type === "recoup_no_application")).toBe(true);
    });

    it("counts correctly with multiple unconfirmed recoups", () => {
      const warnings = checkDealCompleteness(
        makeDeal(),
        [makeRecoup(900), makeRecoup(300)], // both missing application
        [],
      );
      const w = warnings.find(w => w.type === "recoup_no_application");
      expect(w).toBeDefined();
      expect(w!.message).toContain("2 recoups");
    });

    it("only flags recoups missing application, not those that have it", () => {
      // 1 confirmed, 1 unconfirmed
      const warnings = checkDealCompleteness(
        makeDeal(),
        [makeRecoup(900, "pre_net"), makeRecoup(300)],
        [],
      );
      const w = warnings.find(w => w.type === "recoup_no_application");
      expect(w).toBeDefined();
      // Should mention 1 recoup, not 2
      expect(w!.message).toMatch(/one recoup/i);
    });
  });

  // ---- hospitality warnings ----

  describe("hospitality_overage warning", () => {
    it("fires high-severity when hospitality spend exceeds the cap", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ hospitalityCap: 1000 }),
        [],
        [makeExpense(1200, "hospitality")],
      );
      const w = warnings.find(w => w.type === "hospitality_overage");
      expect(w).toBeDefined();
      expect(w!.severity).toBe("high");
      expect(w!.message).toContain("200"); // $1,200 − $1,000 = $200 over
    });

    it("does not double-count absorbed hospitality expenses", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ hospitalityCap: 1000 }),
        [],
        [
          makeExpense(800, "hospitality"),
          makeExpense(600, "hospitality", true), // absorbed — shouldn't count
        ],
      );
      // Only 800 passes through, under 1000 cap
      expect(warnings.some(w => w.type === "hospitality_overage")).toBe(false);
      expect(warnings.some(w => w.type === "hospitality_overage_risk")).toBe(false);
    });
  });

  describe("hospitality_overage_risk warning (approaching cap)", () => {
    it("fires medium-severity when hospitality spend is above 80% of cap", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ hospitalityCap: 1000 }),
        [],
        [makeExpense(850, "hospitality")], // 85% of cap
      );
      const w = warnings.find(w => w.type === "hospitality_overage_risk");
      expect(w).toBeDefined();
      expect(w!.severity).toBe("medium");
      expect(w!.message).toContain("85%");
    });

    it("does NOT fire when hospitality spend is below 80% of cap", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ hospitalityCap: 1000 }),
        [],
        [makeExpense(700, "hospitality")], // 70% of cap
      );
      expect(warnings.some(w =>
        w.type === "hospitality_overage" || w.type === "hospitality_overage_risk"
      )).toBe(false);
    });

    it("does NOT fire when no hospitality cap is set", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ hospitalityCap: null }),
        [],
        [makeExpense(5000, "hospitality")],
      );
      expect(warnings.some(w =>
        w.type === "hospitality_overage" || w.type === "hospitality_overage_risk"
      )).toBe(false);
    });

    it("prefers overage over risk when spend actually exceeds cap", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ hospitalityCap: 1000 }),
        [],
        [makeExpense(1100, "hospitality")],
      );
      expect(warnings.some(w => w.type === "hospitality_overage")).toBe(true);
      // Should not also fire the risk warning (overage is more severe/specific)
      expect(warnings.some(w => w.type === "hospitality_overage_risk")).toBe(false);
    });
  });

  // ---- Multiple warnings ----

  describe("Multiple warnings can fire simultaneously", () => {
    it("fires missing_guarantee + recoup_no_application together", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ guaranteeAmount: null }),
        [makeRecoup(900)],
        [],
      );
      expect(warnings.some(w => w.type === "missing_guarantee")).toBe(true);
      expect(warnings.some(w => w.type === "recoup_no_application")).toBe(true);
    });

    it("fires no_expense_cap + recoup_no_application for a deal missing both", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ expenseCap: null }),
        [makeRecoup(900)],
        [makeExpense(1000)],
      );
      expect(warnings.some(w => w.type === "no_expense_cap")).toBe(true);
      expect(warnings.some(w => w.type === "recoup_no_application")).toBe(true);
    });

    it("returns empty array for a fully clean flat deal", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ dealType: "flat", guaranteeAmount: 3000, percentage: null, expenseCap: null }),
        [],
        [],
      );
      expect(warnings).toHaveLength(0);
    });
  });

  // ---- Severity distribution ----

  describe("Warning severity levels", () => {
    it("high-severity warnings include recoup_no_application and missing fields", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ guaranteeAmount: null }),
        [makeRecoup(900)],
        [],
      );
      const highSeverity = warnings.filter(w => w.severity === "high");
      expect(highSeverity.length).toBeGreaterThanOrEqual(2);
    });

    it("no_expense_cap is medium severity", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ expenseCap: null }),
        [],
        [makeExpense(1000)],
      );
      const w = warnings.find(w => w.type === "no_expense_cap");
      expect(w!.severity).toBe("medium");
    });

    it("hospitality risk approaching cap is medium severity", () => {
      const warnings = checkDealCompleteness(
        makeDeal({ hospitalityCap: 1000 }),
        [],
        [makeExpense(900, "hospitality")],
      );
      const w = warnings.find(w => w.type === "hospitality_overage_risk");
      expect(w!.severity).toBe("medium");
    });
  });
});
