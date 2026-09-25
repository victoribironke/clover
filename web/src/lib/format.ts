// Formatting by hand, not with Intl/toLocaleString: pages render on the server and again in the
// browser, and locale data differs between Node and browsers ("Sept" vs "Sep", separators), which
// breaks hydration. These produce identical text everywhere.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Lagos is UTC+1 all year
const LAGOS_OFFSET_MS = 3_600_000;

const group = (whole: number) => String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const money = (amount: number) => `${amount < 0 ? "-" : ""}₦${group(Math.round(Math.abs(amount)))}`;

export const signedMoney = (amount: number) => `${amount > 0 ? "+" : ""}${money(amount)}`;

export const pct = (value: number | null, digits = 1) => (value === null ? "–" : `${(value * 100).toFixed(digits)}%`);

export const usd = (amount: number) => `$${amount.toFixed(amount < 1 ? 3 : 2)}`;

const lagos = (iso: string) => new Date(Date.parse(iso) + LAGOS_OFFSET_MS);
const two = (value: number) => String(value).padStart(2, "0");

// "25 Sep, 14:05"
export const lagosDateTime = (iso: string) => {
  const date = lagos(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}, ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
};

// "25 Sep"
export const lagosDate = (iso: string) => {
  const date = lagos(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
};

// "14:05"
export const lagosTime = (iso: string) => {
  const date = lagos(iso);
  return `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
};

export const bayseEventUrl = (eventId: string) => `https://app.bayse.markets/market/${encodeURIComponent(eventId)}`;
