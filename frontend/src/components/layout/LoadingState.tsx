export default function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="w-7 h-7 border-2 border-border border-t-accent rounded-full animate-spin" />
      <span className="text-sm text-text-muted">Loading…</span>
    </div>
  );
}