/** The calendar month (UTC) that usage is counted in, like "2026-11". */
export const currentMonth = (now = new Date()) => now.toISOString().slice(0, 7);
