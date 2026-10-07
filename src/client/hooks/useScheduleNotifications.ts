import { useEffect, useRef } from 'react';
import { notifications } from '@mantine/notifications';
import { fetchSchedules } from '../utils/api';

const POLL_MS = 30_000;

// notification.toast가 켜진 내 일정에 대해, 시작 minutesBefore분 전 구간에
// 진입하면 우측 상단 토스트를 1회 표시한다. (대화창 알림(chat)은 서버 scheduler가 별도 처리)
export function useScheduleNotifications(): void {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      let list;
      try {
        list = await fetchSchedules({ owner: 'me' });
      } catch {
        return;
      }
      if (!alive) return;
      const now = Date.now();
      for (const s of list) {
        const n = s.notification;
        if (!n || !n.toast || s.owner !== 'me') continue;
        const startMs = new Date(s.start).getTime();
        if (isNaN(startMs)) continue;
        const mins = typeof n.minutesBefore === 'number' ? n.minutesBefore : 10;
        const fireAt = startMs - mins * 60_000;
        const key = `${s.id}:${s.start}:${mins}`;
        if (now >= fireAt && now < startMs && !firedRef.current.has(key)) {
          firedRef.current.add(key);
          notifications.show({
            message: `📅 ${s.title} ${mins}분 후 시작`,
            color: 'indigo',
            autoClose: 10_000,
          });
        }
      }
    };

    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);
}
