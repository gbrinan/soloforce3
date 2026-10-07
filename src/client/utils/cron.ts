// cron expression(5필드: 분 시 일 월 요일) → 한국어 친화 표현.
// 일반 케이스만 처리, fallback은 raw expression.

const WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

function parseHHMM(min: string, hour: string): string | null {
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
  const h = parseInt(hour, 10);
  const m = parseInt(min, 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function weekdayLabel(field: string): string | null {
  // 단일 숫자
  if (/^\d+$/.test(field)) {
    const n = parseInt(field, 10) % 7;
    return WEEKDAY_KR[n] + '요일';
  }
  // 범위 1-5 → 평일
  if (field === '1-5') return '평일';
  // 0,6 → 주말
  if (field === '0,6' || field === '6,0') return '주말';
  // 콤마 구분 1,3,5 → "월/수/금요일"
  if (/^\d+(,\d+)+$/.test(field)) {
    const days = field.split(',').map(d => WEEKDAY_KR[parseInt(d, 10) % 7]);
    return days.join('/') + '요일';
  }
  return null;
}

export function cronToKorean(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  // "*/N * * * *" → "N분마다"
  if (/^\*\/(\d+)$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `${RegExp.$1}분마다`;
  }
  // "0 */N * * *" → "N시간마다"
  if (min === '0' && /^\*\/(\d+)$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    return `${RegExp.$1}시간마다`;
  }
  // "M H * * *" → "매일 HH:MM"
  if (dom === '*' && mon === '*' && dow === '*') {
    const t = parseHHMM(min, hour);
    if (t) return `매일 ${t}`;
  }
  // "M H * * DOW" → "{요일} HH:MM"
  if (dom === '*' && mon === '*' && dow !== '*') {
    const t = parseHHMM(min, hour);
    const day = weekdayLabel(dow);
    if (t && day) return `${day} ${t}`;
  }
  // "M H DOM * *" → "매월 DOM일 HH:MM"
  if (mon === '*' && dow === '*' && /^\d+$/.test(dom)) {
    const t = parseHHMM(min, hour);
    if (t) return `매월 ${dom}일 ${t}`;
  }
  return expr;
}
