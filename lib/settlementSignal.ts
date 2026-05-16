/**
 * Feature 2.3 — GM Approval View: settlement signal computation.
 *
 * Answers Marcus's core question: "Do I need to read this, or can I approve it?"
 *
 * isClean → one-tap approval. No disputes, no overages, no ambiguous placements.
 * flags   → specific issues that need his eyes before sign-off.
 */

import type { Deal, Expense, Recoup } from "@/db/schema";
import { calculateSettlement } from "@/lib/dealMath";
import type { SettlementCalculation } from "@/lib/dealMath";

export type GmFlagType =
  | "disputed_recoup"
  | "hospitality_overage"
  | "expense_over_cap"
  | "recoup_placement_ambiguous"
  | "bonus_near_threshold"
  | "deal_not_calculable";

export type GmFlag = {
  type: GmFlagType;
  label: string;
  detail: string;
  severity: "high" | "medium";
};

export type GmPayoutNote =
  | { kind: "percentage_wins"; guarantee: number; percentagePayout: number; margin: number }
  | { kind: "guarantee_holds"; guarantee: number; percentagePayout: number }
  | { kind: "flat"; amount: number }
  | { kind: "unsupported"; reason: string };

export type SettlementSignal = {
  isClean: boolean;
  flags: GmFlag[];
  payout: number | null;
  payoutNote: GmPayoutNote;
  calc: SettlementCalculation;
};

export function computeSettlementSignal({
  deal,
  expenses,
  recoups,
  ticketSales,
  venueCapacity,
}: {
  deal: Deal | null | undefined;
  expenses: Expense[];
  recoups: Recoup[];
  ticketSales: import("@/db/schema").TicketSale[];
  venueCapacity?: number;
}): SettlementSignal {
  const flags: GmFlag[] = [];

  if (!deal) {
    return {
      isClean: false,
      flags: [
        {
          type: "deal_not_calculable",
          label: "No deal entered",
          detail: "Mariana hasn't entered deal terms for this show.",
          severity: "high",
        },
      ],
      payout: null,
      payoutNote: { kind: "unsupported", reason: "No deal entered" },
      calc: { supported: false, reason: "No deal entered", dealType: "flat" },
    };
  }

  const calc = calculateSettlement({ deal, ticketSales, expenses, recoups, venueCapacity });

  // --- Deal not calculable ---
  if (!calc.supported) {
    return {
      isClean: false,
      flags: [
        {
          type: "deal_not_calculable",
          label: "Can't calculate",
          detail: calc.reason,
          severity: "high",
        },
      ],
      payout: null,
      payoutNote: { kind: "unsupported", reason: calc.reason },
      calc,
    };
  }

  // --- Disputed recoups ---
  const disputedRecoups = recoups.filter((r) => r.status === "disputed");
  if (disputedRecoups.length > 0) {
    const total = disputedRecoups.reduce((s, r) => s + r.amount, 0);
    flags.push({
      type: "disputed_recoup",
      label: `${disputedRecoups.length} recoup${disputedRecoups.length === 1 ? "" : "s"} in dispute`,
      detail: `$${Math.round(total).toLocaleString("en-US")} contested — settlement can't finalize until resolved.`,
      severity: "high",
    });
  }

  // --- Recoup placement ambiguous ---
  const unconfirmedRecoups = recoups.filter(
    (r) => r.status !== "withdrawn" && !r.application,
  );
  if (unconfirmedRecoups.length > 0) {
    flags.push({
      type: "recoup_placement_ambiguous",
      label: `${unconfirmedRecoups.length === 1 ? "Recoup" : `${unconfirmedRecoups.length} recoups`} without confirmed placement`,
      detail: "Inside or outside the expense cap — ambiguity could cause a dispute. Confirm before signing.",
      severity: "high",
    });
  }

  // --- Hospitality overage ---
  if (deal.hospitalityCap != null) {
    const hospitalitySpend = expenses
      .filter((e) => e.category === "hospitality" && !e.absorbedByVenue)
      .reduce((s, e) => s + e.amount, 0);
    if (hospitalitySpend > deal.hospitalityCap) {
      const over = hospitalitySpend - deal.hospitalityCap;
      flags.push({
        type: "hospitality_overage",
        label: "Hospitality over rider",
        detail: `$${Math.round(over).toLocaleString("en-US")} over the $${Math.round(deal.hospitalityCap).toLocaleString("en-US")} cap — confirm whether the venue is absorbing this.`,
        severity: "high",
      });
    }
  }

  // --- Expenses over cap ---
  if (deal.expenseCap != null) {
    const rawExpenses = expenses
      .filter((e) => !e.absorbedByVenue)
      .reduce((s, e) => s + e.amount, 0);
    if (rawExpenses > deal.expenseCap) {
      flags.push({
        type: "expense_over_cap",
        label: "Expenses exceed cap",
        detail: `$${Math.round(rawExpenses).toLocaleString("en-US")} total vs $${Math.round(deal.expenseCap).toLocaleString("en-US")} cap — calculator applies the cap, but worth confirming the artist's team has been informed.`,
        severity: "medium",
      });
    }
  }

  // --- Bonus threshold proximity (within 5% of triggering) ---
  if (calc.bonusThresholdProgress) {
    for (const b of calc.bonusThresholdProgress) {
      if (!b.triggered && b.away > 0) {
        const proximityPct = b.away / b.threshold;
        if (proximityPct < 0.05) {
          flags.push({
            type: "bonus_near_threshold",
            label: `Near bonus threshold`,
            detail: `$${Math.round(b.away).toLocaleString("en-US")} from +$${Math.round(b.amount).toLocaleString("en-US")} bonus — worth discussing with the artist team.`,
            severity: "medium",
          });
        }
      }
    }
  }

  // --- Payout note ---
  let payoutNote: GmPayoutNote;
  if (calc.vsDetails) {
    if (calc.vsDetails.winner === "percentage") {
      payoutNote = {
        kind: "percentage_wins",
        guarantee: calc.vsDetails.guarantee,
        percentagePayout: calc.vsDetails.percentagePayout,
        margin: calc.vsDetails.percentagePayout - calc.vsDetails.guarantee,
      };
    } else {
      payoutNote = {
        kind: "guarantee_holds",
        guarantee: calc.vsDetails.guarantee,
        percentagePayout: calc.vsDetails.percentagePayout,
      };
    }
  } else if (deal.dealType === "flat") {
    payoutNote = { kind: "flat", amount: calc.totalToArtist };
  } else {
    payoutNote = { kind: "flat", amount: calc.totalToArtist };
  }

  const highFlags = flags.filter((f) => f.severity === "high");
  const isClean = highFlags.length === 0;

  return {
    isClean,
    flags,
    payout: calc.totalToArtist,
    payoutNote,
    calc,
  };
}
