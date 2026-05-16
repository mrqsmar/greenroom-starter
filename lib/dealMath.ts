/**
 * Deal calculation logic for the in-app settlement tool.
 *
 * Extension model:
 *   Adding a V2 deal type (walkout pot, tier ratchet, vs-gross) means
 *   implementing a DealTypeHandler and adding it to DEAL_TYPE_HANDLERS.
 *   calculateSettlement() is a thin dispatcher — it never needs to change.
 *
 * Supported deal types (V1):
 *   1. flat                 — $X guaranteed, optional bonuses
 *   2. percentage_of_gross  — X% of gross, no expense deductions, optional bonuses
 *   3. vs                   — MAX(guarantee, % of net after capped expenses) + bonuses
 *                             This is the most common deal type at The Crescent (~70%).
 *
 * V2 backlog (register a handler; no core changes required):
 *   - percentage_of_net (without a guarantee floor)
 *   - door deals
 *   - walkout pots
 *   - vs-gross variants
 *   - tier ratchets (already detected in applyBonuses, just need the percentage logic)
 *   - comps that count toward gross
 */

import type { Deal, Expense, TicketSale, Bonus, Recoup } from "@/db/schema";

export type SettlementCalculation =
  | {
      supported: true;
      grossBoxOffice: number;
      netBoxOffice: number;
      totalExpenses: number;
      totalToArtist: number;
      steps: { label: string; value: number; note?: string; isDeduction?: boolean }[];
      finalFormula: string;
      bonusesApplied: { label: string; amount: number; reason: string }[];
      bonusesNotTriggered: { label: string; amount: number; reason: string }[];
      // Present only for vs deals. Drives the guarantee-vs-percentage comparison UI.
      vsDetails?: {
        guarantee: number;
        percentagePayout: number;
        netAfterDeductions: number;
        winner: "guarantee" | "percentage";
      };
      // Gross-threshold bonus progress bars — useful even when not triggered.
      bonusThresholdProgress?: Array<{
        label: string;
        amount: number;
        threshold: number;
        currentGross: number;
        away: number;
        triggered: boolean;
      }>;
    }
  | {
      supported: false;
      reason: string;
      dealType: Deal["dealType"];
    };

export interface CalcInput {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  // Capacity is needed to evaluate sellout bonuses. Optional — if omitted,
  // sellout bonuses are reported as "can't determine".
  venueCapacity?: number;
  ticketsSold?: number;
  // Required for vs deals to place recoups correctly in the calculation.
  // Recoup placement is governed by the `application` field (Feature 1.2).
  // Recoups without an application field default to 'pre_net' for V1.
  recoups?: Recoup[];
}

// Pre-computed values passed to every handler so they don't repeat
// the same reductions. Private to this module.
interface EnrichedCalcInput extends CalcInput {
  readonly grossBoxOffice: number;
  readonly totalFees: number;
  readonly netBoxOffice: number;
  // Sum of all non-absorbed expenses. Handlers may apply a cap on top.
  readonly passedThroughExpenses: number;
  readonly tickets: number;
}

// Handler signature — every deal type implements this.
type DealTypeHandler = (input: EnrichedCalcInput) => SettlementCalculation;

// ─── V1 Handlers ─────────────────────────────────────────────────────────────

function handleFlatDeal(input: EnrichedCalcInput): SettlementCalculation {
  const { deal, grossBoxOffice, netBoxOffice, passedThroughExpenses, tickets, venueCapacity } = input;

  if (deal.guaranteeAmount == null) {
    return {
      supported: false,
      reason: "Flat deal is missing a guarantee amount.",
      dealType: deal.dealType,
    };
  }

  const bonusResult = applyBonuses(parseBonuses(deal), {
    gross: grossBoxOffice,
    tickets,
    capacity: venueCapacity,
  });

  return {
    supported: true,
    grossBoxOffice,
    netBoxOffice,
    totalExpenses: passedThroughExpenses,
    totalToArtist: deal.guaranteeAmount + bonusResult.totalApplied,
    steps: [
      {
        label: "Flat guarantee",
        value: deal.guaranteeAmount,
        note: "No expense deductions. The guarantee is the floor.",
      },
      ...bonusResult.applied.map((b) => ({
        label: b.label,
        value: b.amount,
        note: b.reason,
      })),
    ],
    finalFormula: bonusResult.applied.length
      ? `flat ${deal.guaranteeAmount} + bonuses ${bonusResult.totalApplied} = ${(deal.guaranteeAmount + bonusResult.totalApplied).toFixed(2)}`
      : `flat guarantee = ${deal.guaranteeAmount}`,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: bonusResult.notTriggered,
  };
}

function handlePercentageOfGrossDeal(input: EnrichedCalcInput): SettlementCalculation {
  const { deal, grossBoxOffice, netBoxOffice, passedThroughExpenses, tickets, venueCapacity } = input;

  if (deal.percentage == null) {
    return {
      supported: false,
      reason: "Percentage-of-gross deal is missing a percentage.",
      dealType: deal.dealType,
    };
  }

  const payout = grossBoxOffice * deal.percentage;
  const bonusResult = applyBonuses(parseBonuses(deal), {
    gross: grossBoxOffice,
    tickets,
    capacity: venueCapacity,
  });

  return {
    supported: true,
    grossBoxOffice,
    netBoxOffice,
    totalExpenses: passedThroughExpenses,
    totalToArtist: payout + bonusResult.totalApplied,
    steps: [
      { label: "Gross box office", value: grossBoxOffice },
      {
        label: `× ${(deal.percentage * 100).toFixed(0)}%`,
        value: payout,
        note: "Percentage of gross — no expense deductions.",
      },
      ...bonusResult.applied.map((b) => ({
        label: b.label,
        value: b.amount,
        note: b.reason,
      })),
    ],
    finalFormula: bonusResult.applied.length
      ? `gross × ${deal.percentage} + bonuses = ${(payout + bonusResult.totalApplied).toFixed(2)}`
      : `gross × ${deal.percentage} = ${payout.toFixed(2)}`,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: bonusResult.notTriggered,
  };
}

function handleVsDeal(input: EnrichedCalcInput): SettlementCalculation {
  const { deal, expenses, recoups, grossBoxOffice, totalFees, passedThroughExpenses, tickets, venueCapacity } = input;

  if (deal.guaranteeAmount == null) {
    return {
      supported: false,
      reason: "Vs deal is missing a guarantee amount — can't find the floor without it.",
      dealType: deal.dealType,
    };
  }
  if (deal.percentage == null) {
    return {
      supported: false,
      reason: "Vs deal is missing a percentage — can't calculate the percentage track without it.",
      dealType: deal.dealType,
    };
  }

  // --- Recoup placement (Feature 1.2) ---
  // application field governs where the recoup sits in the calculation.
  // V1 default when application is absent: treat as 'pre_net'.
  const agreedRecoups = (recoups ?? []).filter((r) => r.status === "agreed");

  const insideCapTotal = agreedRecoups
    .filter((r) => r.application === "inside_cap")
    .reduce((s, r) => s + r.amount, 0);

  const preNetTotal = agreedRecoups
    .filter(
      (r) =>
        !r.application ||
        r.application === "pre_net" ||
        r.application === "additional_to_cap",
    )
    .reduce((s, r) => s + r.amount, 0);

  const postNetTotal = agreedRecoups
    .filter((r) => r.application === "post_net")
    .reduce((s, r) => s + r.amount, 0);

  // --- Capped expenses ---
  const rawExpenses = passedThroughExpenses;

  let cappedExpenses: number;
  if (deal.expenseCap != null) {
    const capRemaining = Math.max(0, deal.expenseCap - insideCapTotal);
    cappedExpenses = Math.min(rawExpenses, capRemaining);
  } else {
    cappedExpenses = rawExpenses;
  }

  // Net = gross − fees − pre-net recoups − inside-cap recoups − capped expenses − post-net recoups
  const netAfterDeductions =
    grossBoxOffice -
    totalFees -
    preNetTotal -
    insideCapTotal -
    cappedExpenses -
    postNetTotal;

  const percentagePayout = Math.max(0, netAfterDeductions) * deal.percentage;
  const winner: "guarantee" | "percentage" =
    percentagePayout >= deal.guaranteeAmount ? "percentage" : "guarantee";
  const basePayout = Math.max(deal.guaranteeAmount, percentagePayout);

  const bonuses = parseBonuses(deal);
  const bonusResult = applyBonuses(bonuses, { gross: grossBoxOffice, tickets, capacity: venueCapacity });

  const totalToArtist = basePayout + bonusResult.totalApplied;
  const totalRecoupDeducted = preNetTotal + insideCapTotal + postNetTotal;

  const steps: { label: string; value: number; note?: string; isDeduction?: boolean }[] = [
    { label: "Gross box office", value: grossBoxOffice, note: "Total ticket revenue from POS" },
    { label: "Less platform & CC fees", value: -totalFees, isDeduction: true },
  ];

  if (totalRecoupDeducted > 0) {
    const recoupCount = agreedRecoups.length;
    steps.push({
      label: `Less recoups (${recoupCount} agreed)`,
      value: -totalRecoupDeducted,
      isDeduction: true,
      note: "Agreed recoups deducted before net is calculated",
    });
  }

  const expenseNote =
    deal.expenseCap != null
      ? rawExpenses > deal.expenseCap
        ? `Capped at deal limit — actual $${Math.round(rawExpenses).toLocaleString("en-US")}, saving $${Math.round(rawExpenses - cappedExpenses).toLocaleString("en-US")}`
        : `Within cap of $${Math.round(deal.expenseCap).toLocaleString("en-US")}`
      : undefined;

  steps.push({
    label: deal.expenseCap != null
      ? `Less expenses (capped at $${Math.round(deal.expenseCap).toLocaleString("en-US")})`
      : "Less expenses",
    value: -cappedExpenses,
    isDeduction: true,
    note: expenseNote,
  });

  steps.push({ label: "Net", value: netAfterDeductions, note: "Basis for percentage calculation" });
  steps.push({ label: `× ${(deal.percentage * 100).toFixed(0)}% (percentage track)`, value: percentagePayout });

  for (const b of bonusResult.applied) {
    steps.push({ label: b.label, value: b.amount, note: b.reason });
  }

  const bonusThresholdProgress = bonuses
    .filter((b): b is Extract<Bonus, { type: "gross_threshold" }> => b.type === "gross_threshold")
    .map((b) => ({
      label: b.label,
      amount: b.amount,
      threshold: b.threshold,
      currentGross: grossBoxOffice,
      away: Math.max(0, b.threshold - grossBoxOffice),
      triggered: grossBoxOffice >= b.threshold,
    }));

  return {
    supported: true,
    grossBoxOffice,
    netBoxOffice: grossBoxOffice - totalFees,
    totalExpenses: cappedExpenses,
    totalToArtist,
    steps,
    finalFormula: `MAX($${Math.round(deal.guaranteeAmount).toLocaleString("en-US")} guarantee, ${(deal.percentage * 100).toFixed(0)}% × $${Math.round(netAfterDeductions).toLocaleString("en-US")} net) → ${winner} wins`,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: bonusResult.notTriggered,
    vsDetails: { guarantee: deal.guaranteeAmount, percentagePayout, netAfterDeductions, winner },
    bonusThresholdProgress: bonusThresholdProgress.length > 0 ? bonusThresholdProgress : undefined,
  };
}

// ─── Handler Registry ─────────────────────────────────────────────────────────
//
// To add a V2 deal type: implement a DealTypeHandler and add it here.
// calculateSettlement() does not need to change.

const DEAL_TYPE_HANDLERS: Partial<Record<Deal["dealType"], DealTypeHandler>> = {
  flat: handleFlatDeal,
  percentage_of_gross: handlePercentageOfGrossDeal,
  vs: handleVsDeal,
  // V2: percentage_of_net, door, walkout_pot, vs_gross — register handlers here
};

const DEAL_TYPE_FRIENDLY: Record<Deal["dealType"], string> = {
  flat: "Flat guarantee",
  percentage_of_gross: "Percentage of gross",
  percentage_of_net: "Percentage of net",
  vs: "Vs deal (guarantee vs %)",
  door: "Door deal",
};

// ─── Public dispatcher ────────────────────────────────────────────────────────

export function calculateSettlement(input: CalcInput): SettlementCalculation {
  const { deal, ticketSales, expenses, ticketsSold } = input;

  // Pre-compute values shared by all handlers.
  const grossBoxOffice = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const netBoxOffice = grossBoxOffice - totalFees;
  const passedThroughExpenses = expenses
    .filter((e) => !e.absorbedByVenue)
    .reduce((sum, e) => sum + e.amount, 0);
  const tickets = ticketsSold ?? ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);

  const enriched: EnrichedCalcInput = {
    ...input,
    grossBoxOffice,
    totalFees,
    netBoxOffice,
    passedThroughExpenses,
    tickets,
  };

  const handler = DEAL_TYPE_HANDLERS[deal.dealType];
  if (!handler) {
    return {
      supported: false,
      dealType: deal.dealType,
      reason:
        `${DEAL_TYPE_FRIENDLY[deal.dealType] ?? deal.dealType} deals aren't supported in the in-app tool yet. ` +
        `Power users at venues like The Crescent default to spreadsheets for these.`,
    };
  }

  return handler(enriched);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseBonuses(deal: Deal): Bonus[] {
  if (!deal.bonusesJson) return [];
  try {
    const parsed = JSON.parse(deal.bonusesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Evaluate a list of bonuses against the show's actual numbers. */
function applyBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number },
) {
  const applied: { label: string; amount: number; reason: string }[] = [];
  const notTriggered: { label: string; amount: number; reason: string }[] = [];

  for (const b of bonuses) {
    if (b.type === "gross_threshold") {
      if (ctx.gross >= b.threshold) {
        applied.push({ label: b.label, amount: b.amount, reason: `Gross ${ctx.gross.toLocaleString()} ≥ ${b.threshold.toLocaleString()}` });
      } else {
        notTriggered.push({ label: b.label, amount: b.amount, reason: `Gross ${ctx.gross.toLocaleString()} < ${b.threshold.toLocaleString()}` });
      }
    } else if (b.type === "sellout") {
      if (ctx.capacity != null && ctx.tickets >= ctx.capacity * 0.95) {
        applied.push({ label: b.label, amount: b.amount, reason: `${ctx.tickets} of ${ctx.capacity} sold` });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: ctx.capacity != null
            ? `${ctx.tickets} of ${ctx.capacity} sold (sellout = ≥95%)`
            : `Capacity unknown — can't evaluate`,
        });
      }
    } else if (b.type === "attendance_threshold") {
      if (ctx.tickets >= b.threshold) {
        applied.push({ label: b.label, amount: b.amount, reason: `${ctx.tickets} ≥ ${b.threshold}` });
      } else {
        notTriggered.push({ label: b.label, amount: b.amount, reason: `${ctx.tickets} < ${b.threshold}` });
      }
    } else if (b.type === "tier_ratchet") {
      // V2 feature — handler architecture makes this easy to add without
      // touching calculateSettlement().
      notTriggered.push({ label: b.label, amount: 0, reason: "Tier ratchets are a V2 feature — not yet handled" });
    }
  }

  return {
    applied,
    notTriggered,
    totalApplied: applied.reduce((s, b) => s + b.amount, 0),
  };
}
