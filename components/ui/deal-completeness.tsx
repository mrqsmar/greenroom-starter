import { AlertTriangle, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import type { CompletenessWarning } from "@/lib/dealCompleteness";

export function DealCompletenessIndicator({
  warnings,
}: {
  warnings: CompletenessWarning[];
}) {
  const highCount = warnings.filter((w) => w.severity === "high").length;

  return (
    <Card accent="amber">
      <CardHeader>
        <div>
          <CardTitle>Before settlement night</CardTitle>
          <CardDescription>
            {highCount > 0
              ? `${highCount} item${highCount === 1 ? "" : "s"} that could cause a dispute at settlement — resolve ${highCount === 1 ? "it" : "them"} with the agent now.`
              : "A few things worth reviewing before the show."}
          </CardDescription>
        </div>
        <PlainBadge variant="amber">
          {warnings.length} flag{warnings.length === 1 ? "" : "s"}
        </PlainBadge>
      </CardHeader>
      <CardContent className="divide-y divide-ink-100/80">
        {warnings.map((w, i) => (
          <div key={i} className="py-3 flex gap-3">
            {w.severity === "high" ? (
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <Info className="h-4 w-4 text-ink-400 shrink-0 mt-0.5" />
            )}
            <p className="text-[13px] text-ink-700 leading-relaxed">{w.message}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
