interface StatCardProps {
  label: string;
  value: string;
  color: "blue" | "green" | "amber" | "purple";
}

const topColors = {
  blue: "bg-accent",
  green: "bg-green",
  amber: "bg-amber",
  purple: "bg-purple",
};

export default function StatCard({ label, value, color }: StatCardProps) {
  return (
    <div className="relative bg-bg-card border border-border rounded-xl p-5 max-md:p-4">
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${topColors[color]} rounded-t-xl`} />
      <div className="text-[12px] font-medium uppercase tracking-wider text-text-muted mb-2">
        {label}
      </div>
      <div className="font-mono text-[28px] max-md:text-[22px] font-semibold tracking-tight">
        {value}
      </div>
    </div>
  );
}
