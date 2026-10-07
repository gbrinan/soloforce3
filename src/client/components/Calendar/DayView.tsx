import React, { useMemo } from 'react';
import WeekView from './WeekView';
import type { Schedule } from '../../utils/api';

interface Props {
  anchor: Date;
  schedules: Schedule[];
  onCellClick: (day: Date, hour: number) => void;
  onScheduleClick: (s: Schedule) => void;
  onScheduleUpdate?: (id: string, patch: { start: string; end: string }) => Promise<void> | void;
  friendNames?: Record<string, string>;
}

export default function DayView(props: Props) {
  const days = useMemo(() => {
    const c = props.anchor;
    const center = new Date(c.getFullYear(), c.getMonth(), c.getDate());
    return [-1, 0, 1].map((off) => new Date(center.getFullYear(), center.getMonth(), center.getDate() + off));
  }, [props.anchor]);
  return <WeekView {...props} days={days} />;
}
