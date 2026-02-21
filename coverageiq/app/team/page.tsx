import { Users } from 'lucide-react';

export default function TeamPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-6">
      <div className="w-16 h-16 rounded-2xl bg-bg-surface border border-border flex items-center justify-center mb-4">
        <Users className="w-8 h-8 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-heading font-bold text-foreground mb-2">Team Directory</h1>
      <p className="text-sm text-muted-foreground max-w-xs">
        Full team directory coming soon. Use the Overview page to see team availability.
      </p>
    </div>
  );
}
