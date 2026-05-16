import { Check, TrendingUp, Ticket, AlertCircle, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/format";
import type { PayoutEstimate, BonusProgress, ExpenseCategoryState } from "@/lib/payoutEstimate";

// When the estimate can't run — surfaces the specific missing field so
// Mariana can confirm the value rather than wondering why the widget is gone.
export function EstimateBlockedCard({ reason }: { reason: string }) {
  return (
    <Card>
      <CardContent className="py-5 flex items-start gap-3">
        <Info className="h-4 w-4 text-ink-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-[13px] font-medium text-ink-700 mb-0.5">
            Estimate unavailable
          </div>
          <p className="text-[12.5px] text-ink-500 leading-relaxed">{reason}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function LivePayoutWidget({ estimate }: { estimate: PayoutEstimate }) {
  if (!estimate.estimable) {
    return <EstimateBlockedCard reason={estimate.reason} />;
  }

  const {
    displayPayout,
    confidence,
    expenseCategoryStates,
    pendingExpenseCategories,
    vsComparison,
    bonusThresholdProgress,
    ticketProjection,
  } = estimate;

  const confidenceBadgeVariant = confidence === "high" ? "brand" : "amber";
  const confidenceLabel =
    confidence === "high"
      ? "High confidence"
      : `Medium confidence — ${pendingExpenseCategories.length} categor${pendingExpenseCategories.length === 1 ? "y" : "ies"} pending`;

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
                  <span className="text-ink-700 font-medium">Guarantee holds</span>{" "}
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

        {/* Vs comparison: guarantee | percentage side-by-side */}
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
                  vsComparison.winner === "guarantee" ? "text-brand-800" : "text-ink-500"
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
                  vsComparison.winner === "percentage" ? "text-brand-800" : "text-ink-500"
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
                projected gross {formatMoney(ticketProjection.projectedGross)}
              </div>
            </div>
          )}

          {/* Confidence detail — named per-category with specific state */}
          {confidence === "medium" && expenseCategoryStates.length > 0 && (
            <ConfidenceBreakdown states={expenseCategoryStates} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfidenceBreakdown({ states }: { states: ExpenseCategoryState[] }) {
  const notEntered = states.filter((s) => s.state === "not_entered");
  const pendingApproval = states.filter((s) => s.state === "pending_approval");

  return (
    <div className="flex items-start gap-2.5 pt-1">
      <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
      <div className="space-y-1">
        {pendingApproval.length > 0 && (
          <p className="text-[12.5px] text-ink-600 leading-relaxed">
            <span className="font-medium text-amber-800">
              {pendingApproval.map((s) => s.label).join(", ")}
            </span>{" "}
            {pendingApproval.length === 1 ? "has" : "have"} unapproved entries —
            approve them to confirm these figures.
          </p>
        )}
        {notEntered.length > 0 && (
          <p className="text-[12.5px] text-ink-600 leading-relaxed">
            <span className="font-medium text-amber-800">
              {notEntered.map((s) => s.label).join(", ")}
            </span>{" "}
            {notEntered.length === 1 ? "hasn't" : "haven't"} been entered yet —
            the estimate uses $0 for{" "}
            {notEntered.length === 1 ? "this category" : "these categories"}.
            Enter them to move confidence to High.
          </p>
        )}
      </div>
    </div>
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
          <span className="text-brand-700 font-medium">+{formatMoney(b.amount)}</span>
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
