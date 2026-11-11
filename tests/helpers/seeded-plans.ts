/**
 * The seeded membership plans (prisma/seed.ts), one per distinct
 * duration rule, with the validity each one's configured duration and
 * period give from a start date. Expiries use calendar arithmetic, as
 * the service does.
 */

export type PlanData = {
  type: "GROUP" | "PRIVATE";
  duration: string;
  period: string;
  classLimit: number | null;
};

export function addMonths(date: Date, months: number) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addYears(date: Date, years: number) {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + years);
  return result;
}

export const SEEDED_PLANS: {
  label: string;
  plan: PlanData;
  expiryFrom: (start: Date) => Date | null;
}[] = [
  {
    label: "Weekly (1 Week Unlimited - Intro Offer)",
    plan: { type: "GROUP", duration: "1 Week", period: "7 days", classLimit: null },
    expiryFrom: (start) => addDays(start, 7),
  },
  {
    label: "Monthly (10 Classes/Month)",
    plan: { type: "GROUP", duration: "Monthly", period: "/month", classLimit: 10 },
    expiryFrom: (start) => addMonths(start, 1),
  },
  {
    label: "Quarterly (20 Classes - Quarterly)",
    plan: { type: "GROUP", duration: "Quarterly", period: "3 months", classLimit: 20 },
    expiryFrom: (start) => addMonths(start, 3),
  },
  {
    label: "Single (Single Class Pass)",
    plan: { type: "GROUP", duration: "Single", period: "per class", classLimit: 1 },
    expiryFrom: (start) => addDays(start, 30),
  },
  {
    label: "Annual (Unlimited Annual)",
    plan: { type: "GROUP", duration: "Annual", period: "/year", classLimit: null },
    expiryFrom: (start) => addYears(start, 1),
  },
  {
    label: "Single private (Single Private Session)",
    plan: { type: "PRIVATE", duration: "Single", period: "per session", classLimit: 1 },
    expiryFrom: () => null,
  },
  {
    label: "Package (5 Private Sessions)",
    plan: { type: "PRIVATE", duration: "Package", period: "package", classLimit: 5 },
    expiryFrom: () => null,
  },
];
