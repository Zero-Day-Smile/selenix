// workspace_components/ChartCard.tsx
//
// Shared wrapper for the remaining 4 Nivo charts: a transparent white
// glass panel matching every other card in this app (not a bespoke
// solid-dark block), a restrained framer-motion mount animation (fade +
// slight rise, well within the 800ms budget), and this app's real,
// already-established panel-header title style.
import React from 'react';
import { motion } from 'framer-motion';
import { chartCardClassName, CHART_TITLE_CLASS } from './nivoTheme';

export default function ChartCard({
  title,
  subtitle,
  children,
  height = 260,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`rounded-sm p-4 ${chartCardClassName()}`}
    >
      <h4 className={CHART_TITLE_CLASS}>{title}</h4>
      {subtitle && <p className="text-[10px] text-gray-500 -mt-2 mb-3">{subtitle}</p>}
      <div style={{ height }}>{children}</div>
    </motion.div>
  );
}
