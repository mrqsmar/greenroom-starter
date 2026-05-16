/**
 * Feature 1.3 — Deal Completeness Indicator
 *
 * Evaluates a deal's structured fields against its recoups, expenses, and
 * free-text notes and returns a list of specific items that need resolution
 * before settlement night. The goal is to surface the "Wednesday conversation
 * with the agent" rather than the "2am argument with the tour manager."
 *
 * Marcus Holland (GM): "I wish she could see, before a show even happens,
 * whether the deal we agreed to is going to be a clean one or a messy one."
 */

import type { Deal, Expense, Recoup } from "@/db/schema";

export type CompletenessWarning = {
  type:
    | "missing_guarantee"
    | "missing_percentage"
    | "no_expense_cap"
    | "recoup_no_application"
    | "recoup_in_notes_not_structured"
    | "bonus_in_notes_not_structured"
    | "bonus_notes_may_have_extra_conditions"
    | "hospitality_overage"
    | "hospitality_overage_risk";
  message: string;
  severity: "high" | "medium";
};

function fmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function parsedBonusCount(deal: Deal): number {
  if (!deal.bonusesJson) return 0;
  try {
    const parsed = JSON.parse(deal.bonusesJson);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

const RECOUP_KEYWORDS = /recoup|mktg\s+fee|marketing\s+(cost|fee)|hospitality\s+overage/i;
const BONUS_KEYWORDS =
  /bonus|escalat|incentive|threshold|\$[\d,]+\s+if\s+gross|if\s+gross\s+exceeds/i;

export function checkDealCompleteness(
  deal: Deal,
  recoups: Recoup[],
  expenses: Expense[],
): CompletenessWarning[] {
  const warnings: CompletenessWarning[] = [];
  const freetext = deal.dealNotesFreetext ?? "";

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
    const passedThroughExpenses = expenses.filter((e) => !e.absorbedByVenue);
    if (passedThroughExpenses.length > 0) {
      warnings.push({
        type: "no_expense_cap",
        message:
          "No expense cap is set — all passed-through expenses will reduce the artist's net. Confirm this matches the deal terms before settlement.",
        severity: "medium",
      });
    }
  }

  // --- Recoups without a confirmed application type (the Coastal Spell scenario) ---
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
      message: `${count === 1 ? "One recoup" : `${count} recoups`} (${labels}) ${count === 1 ? "has" : "have"} no confirmed placement — the deal is ambiguous about whether ${count === 1 ? "it sits" : "they sit"} inside or outside the expense cap. This is how the Coastal Spell dispute started.`,
      severity: "high",
    });
  }

  // --- Recoup mentioned in deal notes but no structured recoup captured ---
  // The deal notes say there's a recoup but nothing has been entered with a
  // confirmed placement. The calculator can't account for it.
  const activeRecoups = recoups.filter((r) => r.status !== "withdrawn");
  if (freetext && RECOUP_KEYWORDS.test(freetext) && activeRecoups.length === 0) {
    warnings.push({
      type: "recoup_in_notes_not_structured",
      message:
        "The deal notes mention a recoup, but none has been entered with a confirmed placement. Without a structured recoup, the settlement calculator won't account for it — and the ambiguity over where it sits (inside or outside the expense cap) could cause a dispute.",
      severity: "high",
    });
  }

  // --- Bonus conditions in notes but not captured in structured fields ---
  // PRD: "Bonus tier threshold is defined but the deal notes mention additional
  // conditions not captured in structured fields."
  const bonusCount = parsedBonusCount(deal);
  const freetextMentionsBonus = freetext && BONUS_KEYWORDS.test(freetext);

  if (freetextMentionsBonus && bonusCount === 0) {
    // Notes mention bonuses but nothing is structured — calculator is blind to them.
    warnings.push({
      type: "bonus_in_notes_not_structured",
      message:
        "The deal notes mention bonus conditions, but no bonuses have been captured in the structured fields. The settlement calculator can only apply structured bonuses — anything described only in prose will be invisible to it at settlement.",
      severity: "medium",
    });
  } else if (freetextMentionsBonus && bonusCount > 0) {
    // Structured bonuses exist but the notes describe additional conditions —
    // the structured fields may not capture everything Mariana agreed to.
    warnings.push({
      type: "bonus_notes_may_have_extra_conditions",
      message: `${bonusCount} bonus${bonusCount === 1 ? " is" : "es are"} captured in structured fields, but the deal notes mention additional conditions. Confirm the structured bonuses reflect everything — any conditions that only exist in prose won't be applied at settlement.`,
      severity: "medium",
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
