import { Check, TrendingUp, Ticket, AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import type { PayoutEstimate, BonusProgress } from "@/lib/payoutEstimate";

export function LivePayoutWidget({ estimate }: { estimate: PayoutEstimate }) {
  if (!estimate.estimable) return null;

  const {
    displayPayout,
    confidence,
    pendingExpenseCategories,
    vsComparison,
    bonusThresholdProgress,
    ticketProjection,
  } = estimate;

  const confidenceBadgeVariant = confidence === "high" ? "brand" : "amber";
  const confidenceLabel =
    confidence === "high"
      ? "High confidence"
      : `Medium confidence — ${pendingExpenseCategories.length} expense categor${pendingExpenseCategories.length === 1 ? "y" : "ies"} pending`;

  return (
    <Card accent="brand">
      <CardHeader>
        <div>
          <CardTitle>Live payout estimate</CardTitle>
          <CardDescription>
            Based on current ticket sales and entered expenses. This is a
            projection — not the signed settlement.
          </CardDescription>
        </div>
        <PlainBadge variant={confidenceBadgeVariant}>{confidenceLabel}</PlainBadge>
      </CardHeader>

      <CardContent>
        {/* Hero number */}
        <div className="mb-6">
          <div className="eyebrow text-[10px] text-ink-400 mb-2">
            Current projected payout
            {confidence === "medium" && (
              <span className="ml-1.5 text-amber-600">
                · rounded to nearest $10
              </span>
            )}
          </div>
          <div
            className="text-[56px] font-mono tabular font-bold text-ink-900 leading-none"
            style={{ letterSpacing: "-0.03em" }}
          >
            {formatMoney(displayPayout)}
          </div>

          {/* vs deal: which track wins */}
          {vsComparison && (
            <div className="mt-3 text-[13px] text-ink-600">
              {vsComparison.winner === "percentage" ? (
                <>
                  <span className="text-brand-700 font-medium">
                    Percentage track winning
                  </span>{" "}
                  · {formatMoney(vsComparison.margin)} above the{" "}
                  {formatMoney(vsComparison.guarantee)} guarantee
                </>
              ) : (
                <>
                  <span className="text-ink-700 font-medium">
                    Guarantee holds
                  </span>{" "}
                  · percentage track{" "}
                  <span className="font-mono tabular">
                    {formatMoney(vsComparison.percentagePayout)}
                  </span>{" "}
                  is {formatMoney(vsComparison.margin)} below the floor
                </>
              )}
            </div>
          )}
        </div>

        {/* vs comparison: guarantee | percentage side-by-side */}
        {vsComparison && (
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div
              className={`rounded-lg p-3 ring-1 ${
                vsComparison.winner === "guarantee"
                  ? "bg-brand-50/60 ring-brand-200"
                  : "bg-canvas-soft ring-ink-200/60"
              }`}
            >
              <div className="eyebrow text-[10px] text-ink-400 mb-1">
                Guarantee (floor)
              </div>
              <div
                className={`text-[20px] font-mono tabular font-semibold leading-none ${
                  vsComparison.winner === "guarantee"
                    ? "text-brand-800"
                    : "text-ink-500"
                }`}
              >
                {formatMoney(vsComparison.guarantee)}
              </div>
            </div>
            <div
              className={`rounded-lg p-3 ring-1 ${
                vsComparison.winner === "percentage"
                  ? "bg-brand-50/60 ring-brand-200"
                  : "bg-canvas-soft ring-ink-200/60"
              }`}
            >
              <div className="eyebrow text-[10px] text-ink-400 mb-1">
                Percentage track
              </div>
              <div
                className={`text-[20px] font-mono tabular font-semibold leading-none ${
                  vsComparison.winner === "percentage"
                    ? "text-brand-800"
                    : "text-ink-500"
                }`}
              >
                {formatMoney(vsComparison.percentagePayout)}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Bonus threshold progress */}
          {bonusThresholdProgress.length > 0 && (
            <div className="rounded-lg bg-canvas-soft ring-1 ring-ink-200/60 p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <TrendingUp className="h-3.5 w-3.5 text-brand-700" />
                <div className="eyebrow text-[10px] text-brand-800">
                  Bonus threshold progress
                </div>
              </div>
              <div className="space-y-2.5">
                {bonusThresholdProgress.map((b, i) => (
                  <BonusProgressRow key={i} bonus={b} />
                ))}
              </div>
            </div>
          )}

          {/* Ticket projection */}
          {ticketProjection && (
            <div className="rounded-lg bg-canvas-soft ring-1 ring-ink-200/60 p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Ticket className="h-3.5 w-3.5 text-ink-500" />
                <div className="eyebrow text-[10px] text-ink-500">
                  If remaining tickets sell
                </div>
              </div>
              <div className="text-[13px] text-ink-600 leading-relaxed">
                <span className="font-mono tabular font-semibold text-ink-900">
                  {ticketProjection.unsold}
                </span>{" "}
                unsold at{" "}
                <span className="font-mono tabular">
                  {formatMoney(ticketProjection.avgTicketPrice)}
                </span>{" "}
                avg — projected payout moves to{" "}
                <span className="font-mono tabular font-semibold text-brand-700">
                  {formatMoney(ticketProjection.projectedDisplayPayout)}
                </span>
              </div>
              <div className="text-[11.5px] text-ink-400 mt-1">
                {ticketProjection.sold} of {ticketProjection.capacity} sold ·
                projected gross{" "}
                {formatMoney(ticketProjection.projectedGross)}
              </div>
            </div>
          )}

          {/* Confidence detail */}
          {confidence === "medium" && pendingExpenseCategories.length > 0 && (
            <div className="flex items-start gap-2.5 pt-1">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-ink-600 leading-relaxed">
                <span className="font-medium text-amber-800">
                  {pendingExpenseCategories.join(", ")}
                </span>{" "}
                not yet entered. The estimate uses $0 for these categories —
                enter them to move confidence to High and see the exact number.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BonusProgressRow({ bonus: b }: { bonus: BonusProgress }) {
  if (b.triggered) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-[12px] text-brand-700 font-medium">
          <Check className="h-3 w-3" />
          {b.label} triggered
        </div>
        <div className="text-[11.5px] text-brand-700 font-mono tabular font-medium shrink-0">
          +{formatMoney(b.amount)}
        </div>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((b.currentGross / b.threshold) * 100));

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-1.5">
        <div className="text-[12px] text-ink-600">
          {b.label} ·{" "}
          <span className="font-mono tabular text-ink-400">
            {formatMoney(b.away)}
          </span>{" "}
          away from{" "}
          <span className="text-brand-700 font-medium">
            +{formatMoney(b.amount)}
          </span>
        </div>
        <div className="text-[11px] text-ink-400 font-mono tabular shrink-0">
          {formatMoney(b.currentGross)} / {formatMoney(b.threshold)}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-ink-100/80 overflow-hidden">
        <div
          className="h-full rounded-full bg-brand-400/70 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
