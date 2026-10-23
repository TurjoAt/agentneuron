export const totalCents = (items: { cents: number }[]): number => items.reduce((s, i) => s + i.cents, 0);
