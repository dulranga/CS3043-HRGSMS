// Display-only formatting for hotel dates (YYYY-MM-DD) and instants (Asia/Colombo).
const dayFormat = (value: string, withYear: boolean) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
});

export function formatStayRange(first: string, last: string): string {
  return `${dayFormat(first, first.slice(0, 4) !== last.slice(0, 4))} – ${dayFormat(last, true)}`;
}

export function formatHotelDateTime(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'Asia/Colombo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function formatStayDate(value: string): string {
  return dayFormat(value, true);
}
