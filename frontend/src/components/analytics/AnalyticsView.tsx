import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import LoadingState from "../layout/LoadingState";
import CostChanges from "./CostChanges";
import YearOverYear from "./YearOverYear";
import type { CostChanges as CostData, YearOverYear as YoyData } from "../../types";

/** Longer-view reads of your activity: what costs more, and this year against the last two */
export default function AnalyticsView() {
  const [loading, setLoading] = useState(true);
  const [costs, setCosts] = useState<CostData | null>(null);
  const [yoy, setYoy] = useState<YoyData | null>(null);

  useEffect(() => {
    Promise.all([
      api.transactions.costChanges().then(setCosts).catch(() => setCosts(null)),
      api.transactions.yearOverYear().then(setYoy).catch(() => setYoy(null)),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;

  return (
    <div>
      <h2 className="text-[22px] font-semibold mb-5">Analytics</h2>
      {!costs && !yoy && (
        <div className="text-center py-12 text-sm text-text-dim">Import some bank activity to see trends here.</div>
      )}
      {costs && <CostChanges data={costs} />}
      {yoy && <YearOverYear data={yoy} />}
    </div>
  );
}
