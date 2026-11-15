import { evidenceSummary, type Evidence } from './idea-model';

const calendar = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' });
export const activityToday = () => calendar.format(new Date());
export function activityDays(today = activityToday()) {
  const end = Date.parse(`${today}T12:00:00Z`);
  return Array.from({ length: 14 }, (_, index) =>
    new Date(end - (13 - index) * 86400000).toISOString().slice(0, 10),
  );
}
export function dailyMentions(evidence: Evidence[], dates: string[]) {
  const unique = [...new Map(evidence.map((item) => [`${item.source}:${item.id}`, item])).values()];
  const counts = new Map(dates.map((date) => [date, 0]));
  let undated = 0;
  const inPeriod: Evidence[] = [];
  for (const item of unique) {
    if (!item.publishedAt || !Number.isFinite(Date.parse(item.publishedAt))) {
      undated++;
      continue;
    }
    const day = calendar.format(new Date(item.publishedAt));
    if (counts.has(day)) {
      counts.set(day, counts.get(day)! + 1);
      inPeriod.push(item);
    }
  }
  const days = [...counts].map(([date, count]) => ({ date, count }));
  return {
    days,
    total: days.reduce((sum, day) => sum + day.count, 0),
    undated,
    hasDates: unique.length > undated,
    publications: evidenceSummary(inPeriod).publications,
  };
}
export function activityScale(evidence: Evidence[][], dates: string[]) {
  return Math.max(
    2,
    ...evidence.flatMap((items) => dailyMentions(items, dates).days.map((day) => day.count)),
  );
}
