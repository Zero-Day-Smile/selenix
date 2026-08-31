// workspace_components/WorkspaceHeader.tsx
import React from 'react';

interface WorkspaceHeaderProps {
  stage: string;
  title: string;
  description: string;
}

export default function WorkspaceHeader({ stage, title, description }: WorkspaceHeaderProps) {
  return (
    <div className="mb-12">
      <span className="font-mono text-[10px] tracking-widest text-cyan-600 dark:text-cyan-400/80 uppercase">
        Stage {stage}
      </span>
      <h1 className="text-3xl sm:text-4xl font-medium tracking-tight mt-2 text-black dark:text-white">{title}</h1>
      <p className="text-gray-600 dark:text-gray-400 text-sm mt-3 max-w-2xl leading-relaxed">{description}</p>
    </div>
  );
}