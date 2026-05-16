import { notFound } from "next/navigation";
import {
  Check,
  Clock,
  AlertCircle,
  TrendingUp,
  Ticket,
  Info,
  ChevronRight,
} from "lucide-react";
import { getShowById } from "@/lib/queries";
import { computePayoutEstimate } from "@/lib/payoutEstimate";
import { calculateSettlement } from "@/lib/dealMath";
import { formatMoney, formatShowDateFull } from "@/lib/format";
import { Logomark } from "@/components/brand/logo";
import type { Expense, Recoup } from "@/db/schema";
import { CopyLinkButton } from "./copy-link-button";

export default async function TmPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getShowById(id);
  if (!data) notFound();

  const { show, artist, deal, ticketSales, expenses, settlement, recoups, venue } = data;

  const estimate = computePayoutEstimate({
    deal,
    ticketSales,
    expenses,
    recoups,
    venueCapacity: venue?.capacity ?? undefined,
  });

  const calc = deal
    ? calculateSettlement({
        deal,
        ticketSales,
        expenses,
        recoups,
        venueCapacity: venue?.capacity ?? undefined,
      })
    : null;

  // Expense status inference
  const enteredCategories = new Set(expenses.map((e) => e.category));
  const EXPECTED_CATEGORIES: Expense["category"][] = ["production", "sound", "lights"];
  if (deal?.hospitalityCap != null) EXPECTED_CATEGORIES.push("hospitality");
  const missingCategories = EXPECTED_CATEGORIES.filter((c) => !enteredCategories.has(c));

  const passedThroughExpenses = expenses.filter((e) => !e.absorbedByVenue);
  const absorbedExpenses = expenses.filter((e) => e.absorbedByVenue);

  const hasAnnotations = !!(settlement?.notes);
  const hasRecoups = recoups.length > 0;

  return (
    <div className="min-h-full bg-canvas">
      {/* Top banner — clear framing for the TM */}
      <div className="sticky top-0 z-10 bg-ink-900 text-white px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <Logomark size={20} className="shrink-0 opacity-80" />
          <div className="min-w-0">
            <div className="text-[12px] font-medium leading-tight truncate">
              Settlement preview · {artist?.name}
            </div>
            <div className="text-[10.5px] text-white/50 leading-tight mt-0.5">
              Shared by Mariana Reyes · The Crescent · Not the signed settlement
            </div>
          </div>
        </div>
        <CopyLinkButton />
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* Show header */}
        <div>
          <div className="text-[11px] text-ink-400 uppercase tracking-[0.08em] mb-1">
            Preview
          </div>
          <h1
            className="font-display text-[40px] font-medium text-ink-900 leading-[1.05]"
            style={{ letterSpacing: "-0.025em", fontOpticalSizing: "auto" }}
          >
            {artist?.name}
          </h1>
          <div className="text-[14px] text-ink-500 mt-2 flex items-center gap-2">
            <span>{formatShowDateFull(show.date)}</span>
            {show.doorsTime && (
              <>
                <span className="text-ink-200">·</span>
                <span className="flex items-center gap-1 text-ink-400">
                  <Clock className="h-3 w-3" />
                  doors {show.doorsTime}
                  {show.setTime && ` · set ${show.setTime}`}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Payout hero */}
        {estimate.estimable ? (
          <PayoutSection estimate={estimate} />
        ) : (
          <div className="rounded-xl border border-ink-200/60 bg-canvas-soft p-6">
            <div className="text-[13px] text-ink-500">{estimate.reason}</div>
          </div>
        )}

        {/* Line-by-line worksheet */}
        {calc?.supported && (
          <Section title="Settlement worksheet" subtitle={calc.finalFormula}>
            <div className="divide-y divide-ink-100/80">
              {calc.steps.map((step, i) => (
                <WorksheetRow
                  key={i}
                  label={step.label}
                  value={step.value}
                  note={step.note}
                  isDeduction={step.isDeduction}
                />
              ))}
              <div className="flex items-baseline justify-between py-3 font-semibold">
                <span className="text-[14px] text-ink-900">Total to artist</span>
                <span className="text-[20px] font-mono tabular text-ink-900">
                  {formatMoney(calc.totalToArtist)}
                </span>
              </div>
            </div>
          </Section>
        )}

        {/* Deal terms */}
        {deal && (
          <Section title="Deal terms" subtitle="As entered by Mariana from the agent email thread">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {deal.guaranteeAmount != null && (
                  <TermField label="Guarantee" value={formatMoney(deal.guaranteeAmount)} />
                )}
                {deal.percentage != null && (
                  <TermField
                    label="Percentage"
                    value={`${(deal.percentage * 100).toFixed(0)}% of ${deal.percentageBasis ?? "net"}`}
                  />
                )}
                {deal.expenseCap != null && (
                  <TermField label="Expense cap" value={formatMoney(deal.expenseCap)} />
                )}
                {deal.hospitalityCap != null && (
                  <TermField label="Hospitality rider" value={formatMoney(deal.hospitalityCap)} />
                )}
              </div>

              {deal.dealNotesFreetext && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.08em] text-ink-400 mb-2">
                    Original deal language
                  </div>
                  <div
                    className="text-[13px] text-ink-700 bg-canvas-soft rounded-lg p-4 ring-1 ring-ink-200/60 leading-relaxed"
                    style={{ fontStyle: "italic" }}
                  >
                    {deal.dealNotesFreetext}
                  </div>
                  <div className="text-[11px] text-ink-400 mt-1.5">
                    Verbatim from Mariana&apos;s deal notes.
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Expenses with confirmation status */}
        <Section
          title="Expenses"
          subtitle="Passed-through expenses reduce the net the percentage is calculated against"
        >
          <div className="space-y-2">
            {passedThroughExpenses.length === 0 && missingCategories.length === 0 ? (
              <div className="text-[13px] text-ink-400">No expenses entered.</div>
            ) : (
              <>
                {/* Entered expenses grouped by approval status */}
                {passedThroughExpenses.map((e) => (
                  <ExpenseRow key={e.id} expense={e} />
                ))}

                {/* Absorbed by venue — good news for the TM */}
                {absorbedExpenses.map((e) => (
                  <ExpenseRow key={e.id} expense={e} absorbed />
                ))}

                {/* Expected but not entered */}
                {missingCategories.map((cat) => (
                  <div
                    key={cat}
                    className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg bg-amber-50/50 ring-1 ring-amber-200/40"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      <span className="text-[13px] text-ink-700 capitalize">{cat}</span>
                    </div>
                    <span className="text-[11px] text-amber-700 shrink-0">Not yet entered</span>
                  </div>
                ))}

                {/* Total */}
                {passedThroughExpenses.length > 0 && (
                  <div className="flex items-baseline justify-between pt-3 mt-1 border-t border-ink-100/80">
                    <span className="text-[13px] font-medium text-ink-900">
                      Total passed through
                    </span>
                    <span className="text-[14px] font-mono tabular font-semibold text-ink-900">
                      {formatMoney(
                        passedThroughExpenses.reduce((s, e) => s + e.amount, 0),
                      )}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </Section>

        {/* Recoups */}
        {hasRecoups && (
          <Section
            title="Recoups"
            subtitle="Venue costs taken off the top before artist payment"
          >
            <div className="space-y-2">
              {recoups.map((r) => (
                <RecoupRow key={r.id} recoup={r} />
              ))}
              <div className="flex items-baseline justify-between pt-3 border-t border-ink-100/80">
                <span className="text-[13px] font-medium text-ink-900">Total recoups</span>
                <span className="text-[14px] font-mono tabular font-semibold text-ink-900">
                  {formatMoney(recoups.reduce((s, r) => s + r.amount, 0))}
                </span>
              </div>
            </div>
          </Section>
        )}

        {/* Mariana's pre-annotations */}
        {hasAnnotations && (
          <Section title="From Mariana" subtitle="Notes for this preview">
            <div className="space-y-3">
              {settlement?.notes && (
                <div className="rounded-lg bg-brand-50/40 ring-1 ring-brand-200/50 p-4">
                  <p className="text-[13px] text-ink-800 leading-relaxed">
                    {settlement.notes}
                  </p>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Confidence notice */}
        {estimate.estimable && estimate.confidence === "medium" && (
          <div className="flex items-start gap-3 rounded-lg bg-amber-50/60 ring-1 ring-amber-200/60 p-4">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <div className="text-[12.5px] font-semibold text-amber-900 mb-1">
                Estimate is partial
              </div>
              <p className="text-[12.5px] text-ink-700 leading-relaxed">
                {estimate.pendingExpenseCategories.join(", ")}{" "}
                {estimate.pendingExpenseCategories.length === 1 ? "hasn't" : "haven't"}{" "}
                been entered yet. The payout number is rounded to the nearest $10 until those
                are in.
              </p>
            </div>
          </div>
        )}

        {/* Footer — signature framing */}
        <div className="border-t border-ink-200/40 pt-6 pb-8">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-ink-300 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-[12.5px] text-ink-500 leading-relaxed">
                This is a preview, not the signed settlement. The numbers here are based
                on current ticket sales and expenses as entered — they may shift before
                Mariana finalizes. Signature happens in the room.
              </p>
              <p className="text-[12px] text-ink-400">
                Questions? Bring them to the settlement conversation.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-6">
            <Logomark size={18} />
            <span className="text-[11px] text-ink-400">Greenroom · The Crescent</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-200/60 bg-white overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-ink-100/80">
        <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
        {subtitle && (
          <p className="text-[12px] text-ink-400 mt-0.5 font-mono">{subtitle}</p>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function WorksheetRow({
  label,
  value,
  note,
  isDeduction,
}: {
  label: string;
  value: number;
  note?: string;
  isDeduction?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-2.5 gap-4">
      <div className="min-w-0">
        <div className={`text-[13px] ${isDeduction ? "text-ink-400" : "text-ink-700"}`}>
          {label}
        </div>
        {note && (
          <div className="text-[11px] text-ink-400 mt-0.5 leading-snug">{note}</div>
        )}
      </div>
      <div className={`text-[13.5px] font-mono tabular shrink-0 ${isDeduction ? "text-ink-400" : "text-ink-900"}`}>
        {formatMoney(value)}
      </div>
    </div>
  );
}

function TermField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-ink-400 mb-1">{label}</div>
      <div className="text-[14px] font-mono tabular text-ink-900">{value}</div>
    </div>
  );
}

function ExpenseRow({
  expense: e,
  absorbed = false,
}: {
  expense: Expense;
  absorbed?: boolean;
}) {
  const isApproved = e.approved;

  return (
    <div
      className={`flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg ring-1 ${
        absorbed
          ? "bg-canvas-soft ring-ink-100/80"
          : isApproved
            ? "bg-white ring-ink-200/60"
            : "bg-amber-50/50 ring-amber-200/40"
      }`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {absorbed ? (
          <Check className="h-3.5 w-3.5 text-ink-300 shrink-0 mt-0.5" />
        ) : isApproved ? (
          <Check className="h-3.5 w-3.5 text-brand-600 shrink-0 mt-0.5" />
        ) : (
          <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        )}
        <div className="min-w-0">
          <div className="text-[13px] text-ink-800 capitalize leading-tight">
            {e.category}
            {e.description && (
              <span className="text-ink-400 ml-1.5 font-normal">
                · {e.description}
              </span>
            )}
          </div>
          {absorbed && (
            <div className="text-[11px] text-ink-400 mt-0.5">Absorbed by venue</div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`text-[10.5px] px-1.5 py-px rounded font-medium ${
            absorbed
              ? "bg-ink-100/60 text-ink-400"
              : isApproved
                ? "bg-brand-50 text-brand-700"
                : "bg-amber-100 text-amber-800"
          }`}
        >
          {absorbed ? "Absorbed" : isApproved ? "Confirmed" : "Pending"}
        </span>
        <span className={`text-[13.5px] font-mono tabular ${absorbed ? "text-ink-400 line-through" : "text-ink-900"}`}>
          {formatMoney(e.amount)}
        </span>
      </div>
    </div>
  );
}

const RECOUP_CATEGORY_LABELS: Record<Recoup["category"], string> = {
  marketing: "Marketing",
  hospitality_overage: "Hospitality overage",
  production_overage: "Production overage",
  prior_advance: "Prior advance",
  damages: "Damages",
  other: "Other",
};

const RECOUP_STATUS_DISPLAY = {
  agreed: { label: "Agreed", class: "bg-brand-50 text-brand-700" },
  disputed: { label: "Disputed", class: "bg-rose-50 text-rose-700" },
  withdrawn: { label: "Withdrawn", class: "bg-ink-100/60 text-ink-400" },
};

function RecoupRow({ recoup: r }: { recoup: Recoup }) {
  const status = RECOUP_STATUS_DISPLAY[r.status];
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg bg-white ring-1 ring-ink-200/60">
      <div className="min-w-0">
        <div className="text-[13px] text-ink-800 leading-tight">{r.label}</div>
        <div className="text-[11px] text-ink-400 mt-0.5">
          {RECOUP_CATEGORY_LABELS[r.category]}
          {r.application && (
            <span className="ml-1.5 text-ink-300">
              ·{" "}
              {r.application === "inside_cap"
                ? "inside expense cap"
                : r.application === "additional_to_cap"
                  ? "additional to cap"
                  : r.application === "pre_net"
                    ? "deducted before net"
                    : "deducted after net"}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[10.5px] px-1.5 py-px rounded font-medium ${status.class}`}>
          {status.label}
        </span>
        <span
          className={`text-[13.5px] font-mono tabular ${
            r.status === "withdrawn" ? "text-ink-300 line-through" : "text-ink-900"
          }`}
        >
          {formatMoney(r.amount)}
        </span>
      </div>
    </div>
  );
}

function PayoutSection({
  estimate,
}: {
  estimate: Extract<ReturnType<typeof computePayoutEstimate>, { estimable: true }>;
}) {
  const { displayPayout, confidence, vsComparison, bonusThresholdProgress, ticketProjection } =
    estimate;

  return (
    <div className="rounded-xl border border-ink-200/60 bg-white overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-ink-100/80 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink-900">Projected payout</h2>
          <p className="text-[12px] text-ink-400 mt-0.5">
            Based on current ticket sales and expenses
          </p>
        </div>
        <span
          className={`shrink-0 text-[10.5px] px-2 py-1 rounded-md font-medium ${
            confidence === "high"
              ? "bg-brand-50 text-brand-700"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {confidence === "high" ? "High confidence" : "Medium confidence"}
        </span>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* Hero number */}
        <div>
          <div
            className="text-[52px] font-mono tabular font-bold text-ink-900 leading-none"
            style={{ letterSpacing: "-0.03em" }}
          >
            {formatMoney(displayPayout)}
          </div>
          {confidence === "medium" && (
            <div className="text-[11.5px] text-ink-400 mt-1.5">
              Rounded to nearest $10 — expenses not fully entered yet
            </div>
          )}
        </div>

        {/* Vs deal comparison */}
        {vsComparison && (
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-400 mb-2">
              Guarantee vs. percentage
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div
                className={`rounded-lg p-3 ring-1 ${
                  vsComparison.winner === "guarantee"
                    ? "bg-brand-50/60 ring-brand-200"
                    : "bg-canvas-soft ring-ink-200/40"
                }`}
              >
                <div className="text-[10px] text-ink-400 mb-1">Guarantee</div>
                <div
                  className={`text-[18px] font-mono tabular font-semibold ${
                    vsComparison.winner === "guarantee" ? "text-brand-800" : "text-ink-400"
                  }`}
                >
                  {formatMoney(vsComparison.guarantee)}
                </div>
                {vsComparison.winner === "guarantee" && (
                  <div className="text-[10.5px] text-brand-600 font-medium mt-1 flex items-center gap-1">
                    <Check className="h-2.5 w-2.5" /> Floor holds
                  </div>
                )}
              </div>
              <div
                className={`rounded-lg p-3 ring-1 ${
                  vsComparison.winner === "percentage"
                    ? "bg-brand-50/60 ring-brand-200"
                    : "bg-canvas-soft ring-ink-200/40"
                }`}
              >
                <div className="text-[10px] text-ink-400 mb-1">Percentage</div>
                <div
                  className={`text-[18px] font-mono tabular font-semibold ${
                    vsComparison.winner === "percentage" ? "text-brand-800" : "text-ink-400"
                  }`}
                >
                  {formatMoney(vsComparison.percentagePayout)}
                </div>
                {vsComparison.winner === "percentage" && (
                  <div className="text-[10.5px] text-brand-600 font-medium mt-1 flex items-center gap-1">
                    <TrendingUp className="h-2.5 w-2.5" /> Wins by {formatMoney(vsComparison.margin)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Bonus threshold progress */}
        {bonusThresholdProgress.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-400 mb-2.5">
              Bonus thresholds
            </div>
            <div className="space-y-3">
              {bonusThresholdProgress.map((b, i) => {
                const pct = Math.min(100, Math.round((b.currentGross / b.threshold) * 100));
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="text-[12.5px] text-ink-700">
                        {b.triggered ? (
                          <span className="flex items-center gap-1.5 text-brand-700 font-medium">
                            <Check className="h-3 w-3" />
                            {b.label} triggered · +{formatMoney(b.amount)}
                          </span>
                        ) : (
                          <>
                            {b.label} ·{" "}
                            <span className="font-mono tabular text-ink-400">
                              {formatMoney(b.away)}
                            </span>{" "}
                            away from{" "}
                            <span className="text-brand-700 font-medium">
                              +{formatMoney(b.amount)}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-400 font-mono tabular shrink-0">
                        {formatMoney(b.currentGross)} / {formatMoney(b.threshold)}
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-ink-100/80 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-400/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Ticket projection */}
        {ticketProjection && (
          <div className="rounded-lg bg-canvas-soft ring-1 ring-ink-200/60 p-3.5">
            <div className="flex items-center gap-1.5 mb-2">
              <Ticket className="h-3.5 w-3.5 text-ink-400" />
              <div className="text-[11px] uppercase tracking-[0.08em] text-ink-400">
                If remaining tickets sell
              </div>
            </div>
            <div className="text-[13px] text-ink-700 leading-relaxed">
              <span className="font-mono tabular font-semibold text-ink-900">
                {ticketProjection.unsold}
              </span>{" "}
              unsold at{" "}
              <span className="font-mono tabular">{formatMoney(ticketProjection.avgTicketPrice)}</span>{" "}
              avg — payout would move to{" "}
              <span className="font-mono tabular font-semibold text-brand-700">
                {formatMoney(ticketProjection.projectedDisplayPayout)}
              </span>
            </div>
            <div className="text-[11px] text-ink-400 mt-1">
              {ticketProjection.sold} of {ticketProjection.capacity} sold now
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
