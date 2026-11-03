export type Period = 'all' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'absolute';

export function logbookRange(period: Period, from: string, to: string, now = new Date()): string {
  if (period === 'all') return '';
  let start: Date;
  let end: Date;
  if (period === 'absolute') {
    start = new Date(`${from}T00:00:00`);
    end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
  } else if (period === 'thisWeek' || period === 'lastWeek') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (period === 'lastWeek' ? 7 : 0));
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - (period === 'lastMonth' ? 1 : 0), 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  }
  return new URLSearchParams({ from: String(start.getTime()), to: String(end.getTime()) }).toString();
}
