const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export const money = (amount: number) => naira.format(amount);

export const signedMoney = (amount: number) => `${amount > 0 ? "+" : ""}${naira.format(amount)}`;

export const pct = (value: number | null, digits = 1) => (value === null ? "–" : `${(value * 100).toFixed(digits)}%`);

export const usd = (amount: number) => `$${amount.toFixed(amount < 1 ? 3 : 2)}`;

export const lagosDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const bayseEventUrl = (eventId: string) => `https://app.bayse.markets/market/${encodeURIComponent(eventId)}`;
