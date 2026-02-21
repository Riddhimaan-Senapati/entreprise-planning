'use client';

import { useSearchParams } from 'next/navigation';
import TaskList from '@/components/dashboard/TaskList';
import SuggestionPanel from '@/components/dashboard/SuggestionPanel';

export default function TaskCommandClient() {
  const searchParams = useSearchParams();
  const taskId = searchParams.get('taskId') ?? undefined;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-6 flex-1 min-h-0">
      {/* Left panel: Task list */}
      <div className="flex flex-col min-h-[400px] md:min-h-0 md:overflow-hidden">
        <TaskList initialTaskId={taskId} />
      </div>

      {/* Right panel: Suggestion panel */}
      <div className="overflow-y-auto">
        <SuggestionPanel />
      </div>
    </div>
  );
}
