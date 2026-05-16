/**
 * Feature 1.3 — Deal Completeness Indicator
 *
 * Evaluates a deal's structured fields against its recoups and expenses and
 * returns a list of specific items that need resolution before settlement night.
 * The goal is to surface the "Wednesday conversation with the agent" rather than
 * the "2am argument with the tour manager."
 */

import type { Deal, Expense, Recoup } from "@/db/schema";

export type CompletenessWarning = {
  type:
    | "missing_guarantee"
    | "missing_percentage"
    | "no_expense_cap"
    | "recoup_no_application"
    | "hospitality_overage"
    | "hospitality_overage_risk";
  message: string;
  severity: "high" | "medium";
};

function fmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function checkDealCompleteness(
  deal: Deal,
  recoups: Recoup[],
  expenses: Expense[],
): CompletenessWarning[] {
  const warnings: CompletenessWarning[] = [];

  // --- Missing structured fields ---

  if (
    (deal.dealType === "vs" || deal.dealType === "percentage_of_net") &&
    deal.guaranteeAmount == null
  ) {
    warnings.push({
      type: "missing_guarantee",
      message:
        "This deal is missing a guarantee amount. The settlement calculator needs it to find the floor — without it, a vs deal can't run.",
      severity: "high",
    });
  }

  if (
    (deal.dealType === "vs" ||
      deal.dealType === "percentage_of_net" ||
      deal.dealType === "percentage_of_gross") &&
    deal.percentage == null
  ) {
    warnings.push({
      type: "missing_percentage",
      message:
        "This deal is missing a percentage. The calculator can't run the percentage track without it.",
      severity: "high",
    });
  }

  // --- Vs deal: no expense cap means all expenses pass through uncapped ---
  if (deal.dealType === "vs" && deal.expenseCap == null) {
    const passedThroughExpenses = expenses.filter(
      (e) => !e.absorbedByVenue,
    );
    if (passedThroughExpenses.length > 0) {
      warnings.push({
        type: "no_expense_cap",
        message:
          "No expense cap is set — all passed-through expenses will reduce the artist's net. Confirm this matches the deal terms before settlement.",
        severity: "medium",
      });
    }
  }

  // --- Recoups without an application type (the Coastal Spell scenario) ---
  const recoupsWithoutApplication = recoups.filter(
    (r) => r.status !== "withdrawn" && !r.application,
  );
  if (recoupsWithoutApplication.length > 0) {
    const count = recoupsWithoutApplication.length;
    const labels = recoupsWithoutApplication
      .map((r) => `"${r.label}"`)
      .join(", ");
    warnings.push({
      type: "recoup_no_application",
      message:
        `${count === 1 ? "One recoup" : `${count} recoups`} (${labels}) ${count === 1 ? "has" : "have"} no confirmed placement — the deal is ambiguous about whether ${count === 1 ? "it sits" : "they sit"} inside or outside the expense cap. This is how the Coastal Spell dispute started.`,
      severity: "high",
    });
  }

  // --- Hospitality tracking toward overage ---
  if (deal.hospitalityCap != null) {
    const hospitalitySpend = expenses
      .filter((e) => e.category === "hospitality" && !e.absorbedByVenue)
      .reduce((s, e) => s + e.amount, 0);

    if (hospitalitySpend > deal.hospitalityCap) {
      warnings.push({
        type: "hospitality_overage",
        message: `Hospitality is ${fmt(hospitalitySpend - deal.hospitalityCap)} over the ${fmt(deal.hospitalityCap)} rider (${fmt(hospitalitySpend)} spent). Flag this to the agent now or absorb it before settlement night.`,
        severity: "high",
      });
    } else if (hospitalitySpend > deal.hospitalityCap * 0.8) {
      warnings.push({
        type: "hospitality_overage_risk",
        message: `Hospitality is at ${Math.round((hospitalitySpend / deal.hospitalityCap) * 100)}% of the ${fmt(deal.hospitalityCap)} rider (${fmt(hospitalitySpend)} of ${fmt(deal.hospitalityCap)}). Getting close — worth flagging before the show.`,
        severity: "medium",
      });
    }
  }

  return warnings;
}
