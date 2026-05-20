/**
 * Deal calculation logic for the in-app settlement tool.
 *
 * Extension model:
 *   Adding a new deal type means implementing a DealTypeHandler and adding it
 *   to DEAL_TYPE_HANDLERS. calculateSettlement() is a thin dispatcher.
 *
 * Supported deal types (V1 + V2):
 *   1. flat                 — $X guaranteed, optional bonuses
 *   2. percentage_of_gross  — X% of gross, no expense deductions, optional bonuses
 *   3. vs                   — MAX(guarantee, % of net after capped expenses) + bonuses
 *                             Supports tier ratchets in bonusesJson.
 *   4. percentage_of_net    — X% of net after capped expenses, no guarantee floor
 *   5. door                 — Artist takes net door (gross − fees − expenses),
 *                             optionally with a % split and/or guarantee floor
 *   6. walkout_pot          — Artist takes what's left after all costs; optional %
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
      // When true, `steps` contains the complete worksheet from gross to total.
      // The UI renders only steps (no separate summary header rows).
      // Set by vs, percentage_of_net, door, and walkout_pot handlers.
      stepsAreComplete?: boolean;
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
  venueCapacity?: number;
  ticketsSold?: number;
  recoups?: Recoup[];
}

// Pre-computed values passed to every handler. Private to this module.
interface EnrichedCalcInput extends CalcInput {
  readonly grossBoxOffice: number;
  readonly totalFees: number;
  readonly netBoxOffice: number;
  readonly passedThroughExpenses: number;
  readonly tickets: number;
}

type DealTypeHandler = (input: EnrichedCalcInput) => SettlementCalculation;

// ─── Shared recoup helpers ────────────────────────────────────────────────────
// Used by vs, percentage_of_net, and walkout_pot handlers.

interface RecoupTotals {
  insideCapTotal: number;
  preNetTotal: number;
  postNetTotal: number;
  totalDeducted: number;
  agreedCount: number;
}

function computeRecoupTotals(recoups: Recoup[] | undefined): RecoupTotals {
  const agreed = (recoups ?? []).filter((r) => r.status === "agreed");
  const insideCapTotal = agreed
    .filter((r) => r.application === "inside_cap")
    .reduce((s, r) => s + r.amount, 0);
  const preNetTotal = agreed
    .filter(
      (r) =>
        !r.application ||
        r.application === "pre_net" ||
        r.application === "additional_to_cap",
    )
    .reduce((s, r) => s + r.amount, 0);
  const postNetTotal = agreed
    .filter((r) => r.application === "post_net")
    .reduce((s, r) => s + r.amount, 0);
  return {
    insideCapTotal,
    preNetTotal,
    postNetTotal,
    totalDeducted: preNetTotal + insideCapTotal + postNetTotal,
    agreedCount: agreed.length,
  };
}

function computeCappedExpenses(
  rawExpenses: number,
  expenseCap: number | null,
  insideCapTotal: number,
): { capped: number; note?: string } {
  if (expenseCap == null) {
    return { capped: rawExpenses };
  }
  const capRemaining = Math.max(0, expenseCap - insideCapTotal);
  const capped = Math.min(rawExpenses, capRemaining);
  const note =
    rawExpenses > expenseCap
      ? `Capped at deal limit — actual $${Math.round(rawExpenses).toLocaleString("en-US")}, saving $${Math.round(rawExpenses - capped).toLocaleString("en-US")}`
      : `Within cap of $${Math.round(expenseCap).toLocaleString("en-US")}`;
  return { capped, note };
}

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
  const { deal, recoups, grossBoxOffice, totalFees, passedThroughExpenses, tickets, venueCapacity } = input;

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

  // --- Recoup placement ---
  const rt = computeRecoupTotals(recoups);
  const { capped: cappedExpenses, note: expenseNote } = computeCappedExpenses(
    passedThroughExpenses,
    deal.expenseCap,
    rt.insideCapTotal,
  );

  const netAfterDeductions =
    grossBoxOffice - totalFees - rt.preNetTotal - rt.insideCapTotal - cappedExpenses - rt.postNetTotal;

  // --- Tier ratchets: if present, replace the flat percentage calculation ---
  const allBonuses = parseBonuses(deal);
  const tierRatchets = allBonuses.filter(
    (b): b is Extract<Bonus, { type: "tier_ratchet" }> => b.type === "tier_ratchet",
  );
  const regularBonuses = allBonuses.filter((b) => b.type !== "tier_ratchet");

  let percentagePayout: number;
  const tierSteps: { label: string; value: number }[] = [];
  const tierNotTriggered: { label: string; amount: number; reason: string }[] = [];

  if (tierRatchets.length > 0) {
    if (netAfterDeductions > 0) {
      const ratchet = tierRatchets[0];
      let tieredTotal = 0;
      for (const tier of ratchet.tiers) {
        if (netAfterDeductions <= tier.from) continue;
        const ceil = tier.to != null ? Math.min(netAfterDeductions, tier.to) : netAfterDeductions;
        const netInTier = Math.max(0, ceil - tier.from);
        const tierPayout = netInTier * tier.percentage;
        tieredTotal += tierPayout;
        const rangeLabel =
          tier.to != null
            ? `$${tier.from.toLocaleString("en-US")}–$${tier.to.toLocaleString("en-US")}`
            : `above $${tier.from.toLocaleString("en-US")}`;
        tierSteps.push({
          label: `  ${rangeLabel} × ${(tier.percentage * 100).toFixed(0)}%`,
          value: tierPayout,
        });
      }
      percentagePayout = Math.max(0, tieredTotal);
    } else {
      percentagePayout = 0;
      tierNotTriggered.push(
        ...tierRatchets.map((r) => ({
          label: r.label,
          amount: 0,
          reason: "Net is zero or negative — tier ratchet doesn't activate",
        })),
      );
    }
  } else {
    percentagePayout = Math.max(0, netAfterDeductions) * deal.percentage;
  }

  const winner: "guarantee" | "percentage" =
    percentagePayout >= deal.guaranteeAmount ? "percentage" : "guarantee";
  const basePayout = Math.max(deal.guaranteeAmount, percentagePayout);

  const bonusResult = applyBonuses(regularBonuses, {
    gross: grossBoxOffice,
    tickets,
    capacity: venueCapacity,
  });

  const totalToArtist = basePayout + bonusResult.totalApplied;

  // --- Build worksheet steps ---
  const steps: { label: string; value: number; note?: string; isDeduction?: boolean }[] = [
    { label: "Gross box office", value: grossBoxOffice, note: "Total ticket revenue from POS" },
    { label: "Less platform & CC fees", value: -totalFees, isDeduction: true },
  ];

  if (rt.totalDeducted > 0) {
    steps.push({
      label: `Less recoups (${rt.agreedCount} agreed)`,
      value: -rt.totalDeducted,
      isDeduction: true,
      note: "Agreed recoups deducted before net is calculated",
    });
  }

  steps.push({
    label:
      deal.expenseCap != null
        ? `Less expenses (capped at $${Math.round(deal.expenseCap).toLocaleString("en-US")})`
        : "Less expenses",
    value: -cappedExpenses,
    isDeduction: true,
    note: expenseNote,
  });

  steps.push({ label: "Net", value: netAfterDeductions, note: "Basis for percentage calculation" });

  if (tierRatchets.length > 0 && tierSteps.length > 0) {
    steps.push({ label: `${tierRatchets[0].label} (tier ratchet)`, value: percentagePayout });
    for (const ts of tierSteps) {
      steps.push({ label: ts.label, value: ts.value });
    }
  } else {
    steps.push({
      label: `× ${(deal.percentage * 100).toFixed(0)}% (percentage track)`,
      value: percentagePayout,
    });
  }

  for (const b of bonusResult.applied) {
    steps.push({ label: b.label, value: b.amount, note: b.reason });
  }

  // Bonus threshold progress (gross_threshold only, from regular bonuses)
  const bonusThresholdProgress = regularBonuses
    .filter((b): b is Extract<Bonus, { type: "gross_threshold" }> => b.type === "gross_threshold")
    .map((b) => ({
      label: b.label,
      amount: b.amount,
      threshold: b.threshold,
      currentGross: grossBoxOffice,
      away: Math.max(0, b.threshold - grossBoxOffice),
      triggered: grossBoxOffice >= b.threshold,
    }));

  const formulaPercentagePart =
    tierRatchets.length > 0
      ? `tiered ratchet $${Math.round(percentagePayout).toLocaleString("en-US")}`
      : `${(deal.percentage * 100).toFixed(0)}% × $${Math.round(netAfterDeductions).toLocaleString("en-US")} net`;

  return {
    supported: true,
    grossBoxOffice,
    netBoxOffice: grossBoxOffice - totalFees,
    totalExpenses: cappedExpenses,
    totalToArtist,
    steps,
    stepsAreComplete: true,
    finalFormula: `MAX($${Math.round(deal.guaranteeAmount).toLocaleString("en-US")} guarantee, ${formulaPercentagePart}) → ${winner} wins`,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: [...bonusResult.notTriggered, ...tierNotTriggered],
    vsDetails: { guarantee: deal.guaranteeAmount, percentagePayout, netAfterDeductions, winner },
    bonusThresholdProgress: bonusThresholdProgress.length > 0 ? bonusThresholdProgress : undefined,
  };
}

// ─── V2 Handlers ─────────────────────────────────────────────────────────────

function handlePercentageOfNetDeal(input: EnrichedCalcInput): SettlementCalculation {
  const { deal, recoups, grossBoxOffice, totalFees, passedThroughExpenses, tickets, venueCapacity } = input;

  if (deal.percentage == null) {
    return {
      supported: false,
      reason: "Percentage-of-net deal is missing a percentage.",
      dealType: deal.dealType,
    };
  }

  const rt = computeRecoupTotals(recoups);
  const { capped: cappedExpenses, note: expenseNote } = computeCappedExpenses(
    passedThroughExpenses,
    deal.expenseCap,
    rt.insideCapTotal,
  );

  const netAfterDeductions =
    grossBoxOffice - totalFees - rt.preNetTotal - rt.insideCapTotal - cappedExpenses - rt.postNetTotal;

  const payout = Math.max(0, netAfterDeductions) * deal.percentage;

  const bonuses = parseBonuses(deal);
  const bonusResult = applyBonuses(bonuses, { gross: grossBoxOffice, tickets, capacity: venueCapacity });

  const totalToArtist = payout + bonusResult.totalApplied;

  const steps: { label: string; value: number; note?: string; isDeduction?: boolean }[] = [
    { label: "Gross box office", value: grossBoxOffice, note: "Total ticket revenue from POS" },
    { label: "Less platform & CC fees", value: -totalFees, isDeduction: true },
  ];

  if (rt.totalDeducted > 0) {
    steps.push({
      label: `Less recoups (${rt.agreedCount} agreed)`,
      value: -rt.totalDeducted,
      isDeduction: true,
      note: "Agreed recoups deducted before net is calculated",
    });
  }

  steps.push({
    label:
      deal.expenseCap != null
        ? `Less expenses (capped at $${Math.round(deal.expenseCap).toLocaleString("en-US")})`
        : "Less expenses",
    value: -cappedExpenses,
    isDeduction: true,
    note: expenseNote,
  });

  steps.push({ label: "Net", value: netAfterDeductions, note: "Basis for percentage calculation" });
  steps.push({
    label: `× ${(deal.percentage * 100).toFixed(0)}% of net`,
    value: payout,
  });

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
    stepsAreComplete: true,
    finalFormula: `${(deal.percentage * 100).toFixed(0)}% × $${Math.round(netAfterDeductions).toLocaleString("en-US")} net = $${Math.round(payout).toLocaleString("en-US")}`,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: bonusResult.notTriggered,
    bonusThresholdProgress: bonusThresholdProgress.length > 0 ? bonusThresholdProgress : undefined,
  };
}

function handleDoorDeal(input: EnrichedCalcInput): SettlementCalculation {
  const { deal, grossBoxOffice, totalFees, passedThroughExpenses, tickets, venueCapacity } = input;

  // Net door = gross ticket revenue after fees and any passed-through expenses.
  // The venue keeps bar; absorbed expenses stay with the house.
  const netDoor = grossBoxOffice - totalFees - passedThroughExpenses;

  // Apply the artist's percentage split if specified; otherwise 100% of door.
  const doorPayout =
    deal.percentage != null ? Math.max(0, netDoor) * deal.percentage : Math.max(0, netDoor);

  // Optional guarantee floor.
  const basePayout =
    deal.guaranteeAmount != null ? Math.max(deal.guaranteeAmount, doorPayout) : doorPayout;

  const bonusResult = applyBonuses(parseBonuses(deal), {
    gross: grossBoxOffice,
    tickets,
    capacity: venueCapacity,
  });

  const totalToArtist = basePayout + bonusResult.totalApplied;

  const steps: { label: string; value: number; note?: string; isDeduction?: boolean }[] = [
    {
      label: "Gross box office",
      value: grossBoxOffice,
      note: "Venue keeps bar revenue; artist takes the door",
    },
    { label: "Less platform & CC fees", value: -totalFees, isDeduction: true },
  ];

  if (passedThroughExpenses > 0) {
    steps.push({
      label: "Less passed-through expenses",
      value: -passedThroughExpenses,
      isDeduction: true,
    });
  }

  steps.push({ label: "Net door", value: netDoor });

  if (deal.percentage != null) {
    steps.push({
      label: `× ${(deal.percentage * 100).toFixed(0)}% artist split`,
      value: doorPayout,
    });
  }

  if (deal.guaranteeAmount != null) {
    const winner = doorPayout >= deal.guaranteeAmount ? "door" : "guarantee";
    steps.push({
      label: winner === "guarantee" ? "Guarantee floor applies" : "Door exceeds guarantee",
      value: basePayout,
      note: `MAX($${Math.round(deal.guaranteeAmount).toLocaleString("en-US")} guarantee, $${Math.round(doorPayout).toLocaleString("en-US")} door)`,
    });
  }

  for (const b of bonusResult.applied) {
    steps.push({ label: b.label, value: b.amount, note: b.reason });
  }

  let formula: string;
  if (deal.guaranteeAmount != null) {
    const winner = doorPayout >= deal.guaranteeAmount ? "door" : "guarantee";
    formula = `MAX($${Math.round(deal.guaranteeAmount).toLocaleString("en-US")} guarantee, $${Math.round(doorPayout).toLocaleString("en-US")} door) → ${winner} wins`;
  } else if (deal.percentage != null) {
    formula = `${(deal.percentage * 100).toFixed(0)}% × $${Math.round(netDoor).toLocaleString("en-US")} net door = $${Math.round(doorPayout).toLocaleString("en-US")}`;
  } else {
    formula = `net door = $${Math.round(netDoor).toLocaleString("en-US")}`;
  }

  return {
    supported: true,
    grossBoxOffice,
    netBoxOffice: grossBoxOffice - totalFees,
    totalExpenses: passedThroughExpenses,
    totalToArtist,
    steps,
    stepsAreComplete: true,
    finalFormula: formula,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: bonusResult.notTriggered,
  };
}

function handleWalkoutPotDeal(input: EnrichedCalcInput): SettlementCalculation {
  const { deal, recoups, grossBoxOffice, totalFees, passedThroughExpenses, tickets, venueCapacity } = input;

  // The "pot" is what's left after all costs are paid. Recoups come out too.
  const agreedRecoups = (recoups ?? []).filter((r) => r.status === "agreed");
  const totalRecoups = agreedRecoups.reduce((s, r) => s + r.amount, 0);

  const pot = grossBoxOffice - totalFees - passedThroughExpenses - totalRecoups;

  // Artist takes deal.percentage of the pot, or 100% if no split is specified.
  const splitPct = deal.percentage ?? 1.0;
  const artistTake = Math.max(0, pot) * splitPct;

  const bonusResult = applyBonuses(parseBonuses(deal), {
    gross: grossBoxOffice,
    tickets,
    capacity: venueCapacity,
  });

  const totalToArtist = artistTake + bonusResult.totalApplied;

  const steps: { label: string; value: number; note?: string; isDeduction?: boolean }[] = [
    { label: "Gross box office", value: grossBoxOffice },
    { label: "Less platform & CC fees", value: -totalFees, isDeduction: true },
    {
      label: "Less expenses (all categories)",
      value: -passedThroughExpenses,
      isDeduction: true,
      note: "All non-absorbed expenses deducted before the pot is split",
    },
  ];

  if (totalRecoups > 0) {
    steps.push({
      label: `Less recoups (${agreedRecoups.length} agreed)`,
      value: -totalRecoups,
      isDeduction: true,
    });
  }

  steps.push({ label: "Walkout pot", value: pot, note: "What's left after all venue costs" });

  if (splitPct < 1.0) {
    steps.push({ label: `× ${(splitPct * 100).toFixed(0)}% artist share`, value: artistTake });
  }

  for (const b of bonusResult.applied) {
    steps.push({ label: b.label, value: b.amount, note: b.reason });
  }

  const formula =
    splitPct < 1.0
      ? `${(splitPct * 100).toFixed(0)}% × $${Math.round(pot).toLocaleString("en-US")} pot = $${Math.round(artistTake).toLocaleString("en-US")}`
      : `walkout pot = $${Math.round(pot).toLocaleString("en-US")}`;

  return {
    supported: true,
    grossBoxOffice,
    netBoxOffice: grossBoxOffice - totalFees,
    totalExpenses: passedThroughExpenses,
    totalToArtist,
    steps,
    stepsAreComplete: true,
    finalFormula: formula,
    bonusesApplied: bonusResult.applied,
    bonusesNotTriggered: bonusResult.notTriggered,
  };
}

// ─── Handler Registry ─────────────────────────────────────────────────────────

const DEAL_TYPE_HANDLERS: Partial<Record<Deal["dealType"], DealTypeHandler>> = {
  flat: handleFlatDeal,
  percentage_of_gross: handlePercentageOfGrossDeal,
  vs: handleVsDeal,
  percentage_of_net: handlePercentageOfNetDeal,
  door: handleDoorDeal,
  walkout_pot: handleWalkoutPotDeal,
};

const DEAL_TYPE_FRIENDLY: Record<Deal["dealType"], string> = {
  flat: "Flat guarantee",
  percentage_of_gross: "Percentage of gross",
  percentage_of_net: "Percentage of net",
  vs: "Vs deal (guarantee vs %)",
  door: "Door deal",
  walkout_pot: "Walkout pot",
};

// ─── Public dispatcher ────────────────────────────────────────────────────────

export function calculateSettlement(input: CalcInput): SettlementCalculation {
  const { deal, ticketSales, expenses, ticketsSold } = input;

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

function applyBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number },
) {
  const applied: { label: string; amount: number; reason: string }[] = [];
  const notTriggered: { label: string; amount: number; reason: string }[] = [];

  for (const b of bonuses) {
    if (b.type === "gross_threshold") {
      if (ctx.gross >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} ≥ ${b.threshold.toLocaleString()}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} < ${b.threshold.toLocaleString()}`,
        });
      }
    } else if (b.type === "sellout") {
      if (ctx.capacity != null && ctx.tickets >= ctx.capacity * 0.95) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} of ${ctx.capacity} sold`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason:
            ctx.capacity != null
              ? `${ctx.tickets} of ${ctx.capacity} sold (sellout = ≥95%)`
              : `Capacity unknown — can't evaluate`,
        });
      }
    } else if (b.type === "attendance_threshold") {
      if (ctx.tickets >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} ≥ ${b.threshold}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} < ${b.threshold}`,
        });
      }
    } else if (b.type === "tier_ratchet") {
      // Tier ratchets are handled at the deal handler level for vs and
      // percentage_of_net deals. For other deal types (flat, door, walkout_pot)
      // we don't have the net context they require.
      notTriggered.push({
        label: b.label,
        amount: 0,
        reason: "Tier ratchets apply to net-based deal types — not computed for this deal structure",
      });
    }
  }

  return {
    applied,
    notTriggered,
    totalApplied: applied.reduce((s, b) => s + b.amount, 0),
  };
}
