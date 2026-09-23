const retailDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Formats an API date (`YYYY-MM-DD`) without shifting it to the viewer's timezone. */
export function formatRetailDate(isoDate: string): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? isoDate
    : retailDateFormatter.format(date);
}

/** Formats an API timestamp using the retail UI's consistent AM/PM convention. */
export function formatRetailDateTime(isoDateTime: string): string {
  const date = new Date(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoDateTime)
      ? isoDateTime
      : `${isoDateTime}Z`,
  );
  return Number.isNaN(date.getTime())
    ? isoDateTime
    : `${retailDateFormatter.format(date)} · ${formatRetailClock(
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
      )}`;
}

function formatRetailClock(hours: number, minutes: number, seconds: number): string {
  const period = hours >= 12 ? "PM" : "AM";
  const hour = hours % 12 || 12;
  return `${hour}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} ${period}`;
}

/** Normalizes source times such as `9:05`, `09:05:22`, and `9:05 PM` to AM/PM,
 * always with seconds (defaulting to `:00` when the source doesn't have any). */
export function formatRetailTime(time: string | null): string {
  if (!time) return "—";

  const match = time
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return time;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] !== undefined ? Number(match[3]) : 0;
  const period = match[4]?.toUpperCase();
  if (hours > 23 || minutes > 59 || seconds > 59) return time;
  if (period) {
    if (hours < 1 || hours > 12) return time;
    hours = (hours % 12) + (period === "PM" ? 12 : 0);
  }
  return formatRetailClock(hours, minutes, seconds);
}
