/**
 * Feature 2.1 — Live Payout Estimate
 *
 * Computes a projected artist payout from current ticket sales and expenses.
 * Designed to be called on the show detail page so Mariana (and the GM) can
 * see a live number during the show — not at 2am during settlement.
 *
 * Reuses calculateSettlement internally so the math is identical to what the
 * settlement worksheet will show. The only additions are:
 *   - Confidence level (based on expense category completeness)
 *   - Ticket projection (if venue capacity is known and tickets remain)
 *   - Rounding ($10 increments when confidence is medium — prevents a false-
 *     precise number being treated as the final settlement)
 */

import type { Deal, Expense, TicketSale, Recoup } from "@/db/schema";
import { calculateSettlement } from "@/lib/dealMath";

export type ConfidenceLevel = "high" | "medium";

// Categories we expect to see entered by show day for any live event.
// If any are absent, the estimate is labeled Medium confidence.
const EXPECTED_CATEGORIES: Expense["category"][] = [
  "production",
  "sound",
  "lights",
];

const EXPENSE_CATEGORY_LABELS: Partial<Record<Expense["category"], string>> = {
  production: "Production",
  sound: "Sound",
  lights: "Lights",
  hospitality: "Hospitality",
};

function roundToNearest10(n: number): number {
  return Math.round(n / 10) * 10;
}

export type TicketProjection = {
  sold: number;
  capacity: number;
  unsold: number;
  avgTicketPrice: number;
  projectedGross: number;
  projectedPayout: number;
  projectedDisplayPayout: number;
};

export type VsComparison = {
  guarantee: number;
  percentagePayout: number;
  winner: "guarantee" | "percentage";
  margin: number;
};

export type BonusProgress = {
  label: string;
  amount: number;
  threshold: number;
  currentGross: number;
  away: number;
  triggered: boolean;
};

export type PayoutEstimate =
  | { estimable: false; reason: string }
  | {
      estimable: true;
      currentPayout: number;
      displayPayout: number;
      currentGross: number;
      confidence: ConfidenceLevel;
      pendingExpenseCategories: string[];
      vsComparison?: VsComparison;
      bonusThresholdProgress: BonusProgress[];
      ticketProjection?: TicketProjection;
    };

export function computePayoutEstimate({
  deal,
  ticketSales,
  expenses,
  recoups,
  venueCapacity,
}: {
  deal: Deal | null | undefined;
  ticketSales: TicketSale[];
  expenses: Expense[];
  recoups: Recoup[];
  venueCapacity?: number;
}): PayoutEstimate {
  if (!deal) {
    return { estimable: false, reason: "No deal entered for this show." };
  }

  const calc = calculateSettlement({
    deal,
    ticketSales,
    expenses,
    recoups,
    venueCapacity,
  });

  if (!calc.supported) {
    return { estimable: false, reason: calc.reason };
  }

  // --- Confidence: which expected expense categories are missing? ---
  const enteredCategories = new Set(
    expenses.filter((e) => !e.absorbedByVenue).map((e) => e.category),
  );

  const expectedCategories: Expense["category"][] = [...EXPECTED_CATEGORIES];
  if (deal.hospitalityCap != null) {
    expectedCategories.push("hospitality");
  }

  const pendingCategories = expectedCategories.filter(
    (c) => !enteredCategories.has(c),
  );
  const confidence: ConfidenceLevel =
    pendingCategories.length === 0 ? "high" : "medium";
  const pendingExpenseCategories = pendingCategories.map(
    (c) => EXPENSE_CATEGORY_LABELS[c] ?? c,
  );

  const currentPayout = calc.totalToArtist;
  const displayPayout =
    confidence === "high" ? currentPayout : roundToNearest10(currentPayout);

  // --- Vs deal comparison ---
  let vsComparison: VsComparison | undefined;
  if (calc.vsDetails) {
    const { guarantee, percentagePayout, winner } = calc.vsDetails;
    vsComparison = {
      guarantee,
      percentagePayout,
      winner,
      margin: Math.abs(percentagePayout - guarantee),
    };
  }

  // --- Ticket projection: if capacity is known and seats remain ---
  let ticketProjection: TicketProjection | undefined;
  const sold = ticketSales.reduce((s, t) => s + (t.qty ?? 0), 0);
  const currentGross = ticketSales.reduce((s, t) => s + t.gross, 0);

  if (venueCapacity != null && sold > 0) {
    const unsold = venueCapacity - sold;

    if (unsold > 0) {
      const avgTicketPrice = currentGross / sold;
      const additionalGross = unsold * avgTicketPrice;
      const projectedGross = currentGross + additionalGross;

      // Carry the same fee rate into the projected tickets
      const currentFees = ticketSales.reduce((s, t) => s + t.fees, 0);
      const feeRate = currentFees / currentGross;
      const additionalFees = additionalGross * feeRate;

      const projectedTicketSales: TicketSale[] = [
        ...ticketSales,
        {
          id: "_projected",
          showId: deal.showId,
          qty: unsold,
          gross: additionalGross,
          fees: additionalFees,
          capturedAt: new Date(),
        },
      ];

      const projCalc = calculateSettlement({
        deal,
        ticketSales: projectedTicketSales,
        expenses,
        recoups,
        venueCapacity,
      });

      if (projCalc.supported) {
        const projectedPayout = projCalc.totalToArtist;
        ticketProjection = {
          sold,
          capacity: venueCapacity,
          unsold,
          avgTicketPrice,
          projectedGross,
          projectedPayout,
          projectedDisplayPayout:
            confidence === "high"
              ? projectedPayout
              : roundToNearest10(projectedPayout),
        };
      }
    }
  }

  return {
    estimable: true,
    currentPayout,
    displayPayout,
    currentGross,
    confidence,
    pendingExpenseCategories,
    vsComparison,
    bonusThresholdProgress: calc.bonusThresholdProgress ?? [],
    ticketProjection,
  };
}
