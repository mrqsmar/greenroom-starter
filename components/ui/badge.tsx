import { cn } from "@/lib/utils";

type Status = "booked" | "advanced" | "day_of" | "settled" | "closed";

const statusStyles: Record<
  Status,
  { bg: string; fg: string; ring: string; dot: string }
> = {
  booked: {
    bg: "bg-ink-100",
    fg: "text-ink-700",
    ring: "ring-ink-200/80",
    dot: "bg-ink-400",
  },
  advanced: {
    bg: "bg-sky-50",
    fg: "text-sky-800",
    ring: "ring-sky-200/80",
    dot: "bg-sky-700",
  },
  day_of: {
    bg: "bg-amber-50",
    fg: "text-amber-800",
    ring: "ring-amber-200/80",
    dot: "bg-amber-700",
  },
  settled: {
    bg: "bg-brand-50",
    fg: "text-brand-800",
    ring: "ring-brand-200/80",
    dot: "bg-brand-700",
  },
  closed: {
    bg: "bg-ink-50",
    fg: "text-ink-500",
    ring: "ring-ink-200/80",
    dot: "bg-ink-400",
  },
};

const statusLabels: Record<Status, string> = {
  booked: "Booked",
  advanced: "Advanced",
  day_of: "Day of",
  settled: "Settled",
  closed: "Closed",
};

export function StatusBadge({
  status,
  className,
  showDot = true,
}: {
  status: Status;
  className?: string;
  showDot?: boolean;
}) {
  const s = statusStyles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md",
        "text-[10.5px] font-medium ring-1 ring-inset",
        s.bg,
        s.fg,
        s.ring,
        className,
      )}
    >
      {showDot && <span className={cn("w-1.5 h-1.5 rounded-full", s.dot)} />}
      {statusLabels[status]}
    </span>
  );
}

const dealStyles: Record<string, { bg: string; fg: string; ring: string }> = {
  flat: {
    bg: "bg-ink-50",
    fg: "text-ink-700",
    ring: "ring-ink-200/80",
  },
  percentage_of_gross: {
    bg: "bg-ink-50",
    fg: "text-ink-700",
    ring: "ring-ink-200/80",
  },
  percentage_of_net: {
    bg: "bg-amber-50",
    fg: "text-amber-800",
    ring: "ring-amber-200/80",
  },
  vs: {
    bg: "bg-amber-50",
    fg: "text-amber-800",
    ring: "ring-amber-200/80",
  },
  door: {
    bg: "bg-rose-50",
    fg: "text-rose-800",
    ring: "ring-rose-200/80",
  },
  walkout_pot: {
    bg: "bg-purple-50",
    fg: "text-purple-800",
    ring: "ring-purple-200/80",
  },
};

const dealLabels: Record<string, string> = {
  flat: "Flat",
  percentage_of_gross: "% of gross",
  percentage_of_net: "% of net",
  vs: "Vs deal",
  door: "Door deal",
  walkout_pot: "Walkout pot",
};

export function DealTypeBadge({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const s = dealStyles[type] ?? dealStyles.flat;
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md",
        "text-[10.5px] font-medium ring-1 ring-inset",
        s.bg,
        s.fg,
        s.ring,
        className,
      )}
    >
      {dealLabels[type] ?? type}
    </span>
  );
}

export function PlainBadge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: "default" | "amber" | "brand" | "rose" | "sky";
  className?: string;
}) {
  const variants = {
    default: "bg-ink-100 text-ink-700 ring-ink-200/80",
    amber: "bg-amber-50 text-amber-800 ring-amber-200/80",
    brand: "bg-brand-50 text-brand-800 ring-brand-200/80",
    rose: "bg-rose-50 text-rose-800 ring-rose-200/80",
    sky: "bg-sky-50 text-sky-800 ring-sky-200/80",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md",
        "text-[10.5px] font-medium ring-1 ring-inset",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
