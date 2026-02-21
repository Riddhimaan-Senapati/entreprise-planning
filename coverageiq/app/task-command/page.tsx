import { Suspense } from 'react';
import TaskCommandClient from './TaskCommandClient';

export default function TaskCommandPage() {
  return (
    <div className="p-6 pb-20 md:pb-6 h-full flex flex-col">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold text-foreground">Task Command</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Triage at-risk tasks and reassign coverage
        </p>
      </div>

      <Suspense fallback={<div className="text-muted-foreground text-sm">Loading...</div>}>
        <TaskCommandClient />
      </Suspense>
    </div>
  );
}
