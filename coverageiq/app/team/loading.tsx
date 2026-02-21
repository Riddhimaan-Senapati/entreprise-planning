export default function TeamLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Header skeleton */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <div className="h-7 w-44 bg-bg-surface2 rounded-lg animate-pulse" />
          <div className="h-4 w-20 bg-bg-surface2 rounded animate-pulse" />
        </div>
        <div className="h-9 w-64 bg-bg-surface2 rounded-lg animate-pulse" />
      </div>

      {/* Tab skeleton */}
      <div className="flex gap-2">
        {[80, 100, 80, 80].map((w, i) => (
          <div key={i} className="h-8 bg-bg-surface2 rounded-lg animate-pulse" style={{ width: w }} />
        ))}
      </div>

      {/* Card grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="p-4 rounded-xl bg-bg-surface border border-border space-y-3">
            {/* Top row */}
            <div className="flex items-start gap-3">
              <div className="w-[52px] h-[52px] rounded-full bg-bg-surface2 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1.5 mt-1">
                <div className="h-4 bg-bg-surface2 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-bg-surface2 rounded animate-pulse w-1/2" />
                <div className="flex gap-1.5 mt-2">
                  <div className="h-4 w-20 bg-bg-surface2 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-bg-surface2 rounded animate-pulse" />
                </div>
              </div>
            </div>
            {/* Stats */}
            <div className="flex gap-4">
              <div className="h-3 w-14 bg-bg-surface2 rounded animate-pulse" />
              <div className="h-3 w-14 bg-bg-surface2 rounded animate-pulse" />
              <div className="h-3 w-8 bg-bg-surface2 rounded animate-pulse ml-auto" />
            </div>
            {/* Skills */}
            <div className="flex gap-1 flex-wrap">
              {[48, 60, 52].map((w, j) => (
                <div key={j} className="h-4 bg-bg-surface2 rounded animate-pulse" style={{ width: w }} />
              ))}
            </div>
            {/* Notes */}
            <div className="pt-3 border-t border-border space-y-1.5">
              <div className="h-3 w-24 bg-bg-surface2 rounded animate-pulse" />
              <div className="h-14 bg-bg-surface2 rounded-lg animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
