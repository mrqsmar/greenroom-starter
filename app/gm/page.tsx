import Link from "next/link";
import {
  Check,
  AlertTriangle,
  Info,
  ChevronRight,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { getAllShows } from "@/lib/queries";
import { getShowById } from "@/lib/queries";
import { computeSettlementSignal } from "@/lib/settlementSignal";
import { formatMoney, formatShowDateFull } from "@/lib/format";
import { DealTypeBadge, PlainBadge } from "@/components/ui/badge";
import { approveSettlement } from "./actions";
import type { GmFlag, SettlementSignal } from "@/lib/settlementSignal";

// Settlements Marcus should see: need his sign-off or have active disputes.
const QUEUE_STATUSES = new Set(["submitted", "in_review", "disputed"]);

type QueueItem = {
  showId: string;
  artistName: string;
  showDate: string;
  dealType: string;
  settlementId: string;
  settlementStatus: string;
  signal: SettlementSignal;
};

export default async function GmPage() {
  const allShows = await getAllShows();

  const pendingRows = allShows.filter(
    (r) => r.settlement && QUEUE_STATUSES.has(r.settlement.status),
  );

  // Hydrate each pending show with expense / recoup data needed for signal computation
  const queueItems: QueueItem[] = await Promise.all(
    pendingRows.map(async (row) => {
      const data = await getShowById(row.show.id);
      const signal = computeSettlementSignal({
        deal: data?.deal ?? null,
        expenses: data?.expenses ?? [],
        recoups: data?.recoups ?? [],
        ticketSales: data?.ticketSales ?? [],
        venueCapacity: data?.venue?.capacity ?? undefined,
      });
      return {
        showId: row.show.id,
        artistName: row.artist?.name ?? "Unknown artist",
        showDate: row.show.date,
        dealType: row.deal?.dealType ?? "unknown",
        settlementId: row.settlement!.id,
        settlementStatus: row.settlement!.status,
        signal,
      };
    }),
  );

  const cleanItems = queueItems.filter((i) => i.signal.isClean);
  const flaggedItems = queueItems.filter((i) => !i.signal.isClean);

  return (
    <div className="px-12 py-10 max-w-5xl">
      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="h-5 w-5 text-brand-700" />
          <div className="eyebrow text-[10px] text-ink-400 uppercase tracking-[0.08em]">
            GM approval queue
          </div>
        </div>
        <h1
          className="font-display text-[44px] font-medium text-ink-900 leading-[1.05]"
          style={{ letterSpacing: "-0.025em", fontOpticalSizing: "auto" }}
        >
          Settlement review
        </h1>
        <p className="text-[14px] text-ink-500 mt-3 max-w-xl leading-relaxed">
          {queueItems.length === 0
            ? "Nothing in the queue. All settlements are signed, paid, or voided."
            : `${queueItems.length} settlement${queueItems.length === 1 ? "" : "s"} waiting — ${cleanItems.length} clean, ${flaggedItems.length} need${flaggedItems.length === 1 ? "s" : ""} a closer look.`}
        </p>
      </div>

      {queueItems.length === 0 && (
        <div className="rounded-xl border border-ink-200/60 bg-canvas-soft p-10 text-center">
          <ShieldCheck className="h-8 w-8 text-ink-200 mx-auto mb-3" />
          <div className="text-[14px] text-ink-400">Queue is clear.</div>
        </div>
      )}

      {/* Clean settlements — one-tap approve */}
      {cleanItems.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-2 w-2 rounded-full bg-brand-600" />
            <h2 className="text-[13px] font-semibold text-ink-900">
              Ready to approve
            </h2>
            <span className="text-[12px] text-ink-400">
              · {cleanItems.length} settlement{cleanItems.length === 1 ? "" : "s"} — no flags
            </span>
          </div>
          <div className="space-y-3">
            {cleanItems.map((item) => (
              <SettlementCard key={item.settlementId} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Flagged settlements — need review */}
      {flaggedItems.length > 0 && (
        <section>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-2 w-2 rounded-full bg-amber-500" />
            <h2 className="text-[13px] font-semibold text-ink-900">
              Needs a closer look
            </h2>
            <span className="text-[12px] text-ink-400">
              · {flaggedItems.length} settlement{flaggedItems.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-3">
            {flaggedItems.map((item) => (
              <SettlementCard key={item.settlementId} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SettlementCard({ item }: { item: QueueItem }) {
  const { signal, settlementId, showId, artistName, showDate, dealType, settlementStatus } = item;
  const highFlags = signal.flags.filter((f) => f.severity === "high");
  const mediumFlags = signal.flags.filter((f) => f.severity === "medium");

  return (
    <div
      className={`rounded-xl border bg-white overflow-hidden transition-shadow hover:shadow-sm ${
        signal.isClean
          ? "border-ink-200/60"
          : highFlags.length > 0
            ? "border-amber-200/80"
            : "border-ink-200/60"
      }`}
    >
      <div className="px-5 py-4">
        <div className="flex items-start gap-4">
          {/* Left: artist + show info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <DealTypeBadge type={dealType} />
              <StatusPip status={settlementStatus} />
            </div>
            <div className="text-[18px] font-semibold text-ink-900 leading-tight">
              {artistName}
            </div>
            <div className="text-[12.5px] text-ink-400 mt-1">
              {formatShowDateFull(showDate)}
            </div>
          </div>

          {/* Right: payout */}
          <div className="shrink-0 text-right">
            <div className="eyebrow text-[9px] text-ink-400 mb-1">Projected payout</div>
            <div
              className="text-[26px] font-mono tabular font-bold text-ink-900 leading-none"
              style={{ letterSpacing: "-0.02em" }}
            >
              {signal.payout != null ? formatMoney(signal.payout) : "—"}
            </div>
            <PayoutNoteLabel note={signal.payoutNote} />
          </div>
        </div>

        {/* Flags */}
        {signal.flags.length === 0 ? (
          <div className="mt-3 flex items-center gap-1.5 text-[12px] text-brand-700">
            <Check className="h-3.5 w-3.5" />
            <span>No flags — clean to approve</span>
          </div>
        ) : (
          <div className="mt-3 space-y-1.5">
            {highFlags.map((f, i) => (
              <FlagRow key={i} flag={f} />
            ))}
            {mediumFlags.map((f, i) => (
              <FlagRow key={i} flag={f} />
            ))}
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="px-5 py-3 bg-canvas-soft/60 border-t border-ink-100/80 flex items-center justify-between gap-3">
        <Link
          href={`/shows/${showId}/settle`}
          className="text-[12.5px] text-ink-500 hover:text-ink-900 transition-colors inline-flex items-center gap-1"
        >
          Full breakdown
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>

        {signal.isClean ? (
          <form action={approveSettlement}>
            <input type="hidden" name="settlementId" value={settlementId} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12.5px] font-semibold bg-brand-700 text-white hover:bg-brand-800 transition-colors shadow-sm shadow-brand-700/15"
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </button>
          </form>
        ) : (
          <Link
            href={`/shows/${showId}/settle`}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12.5px] font-semibold bg-amber-600 text-white hover:bg-amber-700 transition-colors shadow-sm shadow-amber-600/15"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Review first
          </Link>
        )}
      </div>
    </div>
  );
}

function FlagRow({ flag }: { flag: GmFlag }) {
  return (
    <div className="flex items-start gap-2">
      {flag.severity === "high" ? (
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
      ) : (
        <Info className="h-3.5 w-3.5 text-ink-400 shrink-0 mt-0.5" />
      )}
      <div>
        <span className="text-[12.5px] font-medium text-ink-800">{flag.label}</span>
        <span className="text-[12px] text-ink-500"> · {flag.detail}</span>
      </div>
    </div>
  );
}

function StatusPip({ status }: { status: string }) {
  const labels: Record<string, { label: string; variant: "default" | "amber" | "rose" | "brand" }> = {
    submitted: { label: "Submitted", variant: "default" },
    in_review: { label: "In review", variant: "amber" },
    disputed: { label: "Disputed", variant: "rose" },
  };
  const config = labels[status] ?? { label: status, variant: "default" };
  return <PlainBadge variant={config.variant}>{config.label}</PlainBadge>;
}

function PayoutNoteLabel({ note }: { note: SettlementSignal["payoutNote"] }) {
  if (note.kind === "unsupported") {
    return (
      <div className="text-[10.5px] text-ink-400 mt-1 max-w-[140px] text-right leading-tight">
        {note.reason}
      </div>
    );
  }
  if (note.kind === "percentage_wins") {
    return (
      <div className="text-[10.5px] text-brand-700 font-medium mt-1 text-right">
        % track · {formatMoney(note.margin)} above guarantee
      </div>
    );
  }
  if (note.kind === "guarantee_holds") {
    return (
      <div className="text-[10.5px] text-ink-400 mt-1 text-right">
        Guarantee holds · % at {formatMoney(note.percentagePayout)}
      </div>
    );
  }
  return null;
}
