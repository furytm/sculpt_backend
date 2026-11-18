
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

const EMAIL = "oyinda16@gmail.com";
const PHONE = "08031944464";

const PAYMENT_REFERENCES = [
  "SL-1794821958678-da973714",
  "SL-1794821794950-ac707e46",
  "SL-1794821674898-0814c40a",
];

const OUTPUT_DIR = path.resolve("investigation-output");

type DbRow = Record<string, unknown>;

type TableColumn = {
  column_name: string;
  data_type: string;
};

type RecordGroup = Record<string, DbRow[]>;

const quote = (value: string) =>
  `"${value.replace(/"/g, '""')}"`;

const sensitiveFields = new Set([
  "password",
  "token",
  "tokenhash",
  "bookingflowtokenhash",
  "secret",
  "apikey",
  "accesstoken",
  "refreshtoken",
]);

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === "object") {
    const result: DbRow = {};

    for (const [key, item] of Object.entries(value)) {
      if (sensitiveFields.has(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitize(item);
      }
    }

    return result;
  }

  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function getString(row: DbRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log("Starting read-only member investigation...");
  console.log(`Member: ${EMAIL}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);

  // 1. Discover database tables and columns.
  const columns = await prisma.$queryRaw<TableColumn[]>`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `;

  const tables = new Map<string, TableColumn[]>();

  for (const column of columns) {
    const current = tables.get(
      (column as any).table_name
    ) ?? [];

    current.push(column);
    tables.set((column as any).table_name, current);
  }

  const identityValues = [
    EMAIL,
    PHONE,
    ...PAYMENT_REFERENCES,
  ];

  // 2. Find direct matches.
  const directMatches: RecordGroup = {};

  for (const [table, tableColumns] of tables) {
    const searchable = tableColumns.filter((column) =>
      ["text", "character varying", "character"].includes(
        column.data_type
      )
    );

    if (!searchable.length) continue;

    const conditions = searchable.map(
      (column) =>
        `${quote(column.column_name)} = ANY($1::text[])`
    );

    const sql = `
      SELECT *
      FROM ${quote(table)}
      WHERE ${conditions.join(" OR ")}
      LIMIT 500
    `;

    const rows = await prisma.$queryRawUnsafe<DbRow[]>(
      sql,
      identityValues
    );

    if (rows.length) {
      directMatches[table] = rows;
    }
  }

  // 3. Build targeted relationship IDs.
  // Do NOT use membershipId to expand the investigation:
  // it identifies a shared plan, not an individual member.
  const userIds = new Set<string>();
  const bookingIds = new Set<string>();
  const memberMembershipIds = new Set<string>();
  const purchaseIds = new Set<string>();
  const sessionIds = new Set<string>();
  const scheduleIds = new Set<string>();

  for (const [table, rows] of Object.entries(directMatches)) {
    for (const row of rows) {
      if (table === "User") {
        const id = getString(row, "id");
        if (id) userIds.add(id);
      }

      if (table === "Booking") {
        const id = getString(row, "id");
        if (id) bookingIds.add(id);
      }

      for (const [field, target] of [
        ["userId", userIds],
        ["memberMembershipId", memberMembershipIds],
        ["membershipPurchaseId", purchaseIds],
        ["sessionId", sessionIds],
        ["scheduleId", scheduleIds],
        ["bookingId", bookingIds],
      ] as const) {
        const value = getString(row, field);
        if (value) target.add(value);
      }
    }
  }

  // 4. Include related bookings, memberships, purchases,
  // sessions and health forms using specific foreign keys.
  const relatedMatches: RecordGroup = {};

  const relationshipIds: Record<string, Set<string>> = {
    userId: userIds,
    memberMembershipId: memberMembershipIds,
    membershipPurchaseId: purchaseIds,
    bookingId: bookingIds,
    sessionId: sessionIds,
    scheduleId: scheduleIds,
  };

  for (const [table, tableColumns] of tables) {
    const links = tableColumns.filter(
      (column) =>
        relationshipIds[column.column_name]?.size &&
        ["text", "character varying", "character"].includes(
          column.data_type
        )
    );

    if (!links.length) continue;

    const conditions = links.map(
      (column) =>
        `${quote(column.column_name)} = ANY($1::text[])`
    );

    const ids = unique(
      links.flatMap((column) => [
        ...relationshipIds[column.column_name],
      ])
    );

    const sql = `
      SELECT *
      FROM ${quote(table)}
      WHERE ${conditions.join(" OR ")}
      LIMIT 1000
    `;

    const rows = await prisma.$queryRawUnsafe<DbRow[]>(
      sql,
      ids
    );

    if (rows.length) {
      relatedMatches[table] = rows;
    }
  }

  // 5. Extract additional individual record IDs from
  // related membership and booking records.
  for (const [table, rows] of Object.entries(relatedMatches)) {
    for (const row of rows) {
      if (table === "MemberMembership") {
        const id = getString(row, "id");
        if (id) memberMembershipIds.add(id);

        const purchaseId = getString(row, "membershipPurchaseId");
        if (purchaseId) purchaseIds.add(purchaseId);
      }

      if (table === "MembershipPurchase") {
        const id = getString(row, "id");
        if (id) purchaseIds.add(id);
      }

      if (table === "Booking") {
        const id = getString(row, "id");
        if (id) bookingIds.add(id);
      }
    }
  }

  // 6. Collect all discovered rows into one deduplicated result.
  const allRecords: RecordGroup = {};

  function addRecords(groups: RecordGroup) {
    for (const [table, rows] of Object.entries(groups)) {
      const existing = allRecords[table] ?? [];
      const byId = new Map<string, DbRow>();

      for (const row of [...existing, ...rows]) {
        const id = getString(row, "id");

        // Use ID where available; otherwise preserve the row.
        const key = id ?? JSON.stringify(row);
        byId.set(key, row);
      }

      allRecords[table] = [...byId.values()];
    }
  }

  addRecords(directMatches);
  addRecords(relatedMatches);

  // 7. Calculate booking and membership summaries.
  const bookings = allRecords.Booking ?? [];
  const memberships = allRecords.MemberMembership ?? [];
  const purchases = allRecords.MembershipPurchase ?? [];
  const healthForms = allRecords.HealthSafetyForm ?? [];

  const memberBookings = bookings.filter(
    (row) =>
      getString(row, "email")?.toLowerCase() === EMAIL.toLowerCase() ||
      PAYMENT_REFERENCES.includes(
        getString(row, "paymentReference") ?? ""
      )
  );

  const membershipSummary = memberships.map((membership) => {
    const total = Number(membership.creditsTotal ?? 0);
    const used = Number(membership.creditsUsed ?? 0);

    return {
      memberMembershipId: membership.id,
      status: membership.status,
      startDate: membership.startDate,
      expiryDate: membership.expiryDate,
      creditsTotal: total,
      creditsUsed: used,
      remainingCredits: total - used,
      membershipPurchaseId: membership.membershipPurchaseId,
    };
  });

  const referenceSummary = PAYMENT_REFERENCES.map((reference) => {
    const matches = bookings.filter(
      (row) => row.paymentReference === reference
    );

    return {
      paymentReference: reference,
      matchingBookingCount: matches.length,
      bookings: matches.map((row) => ({
        bookingId: row.id,
        className: row.classId,
        bookingDate: row.bookingDate,
        bookingStatus: row.bookingStatus,
        paymentStatus: row.paymentStatus,
        paymentMethod: row.paymentMethod,
        sessionId: row.sessionId,
        memberMembershipId: row.memberMembershipId,
      })),
    };
  });

  const summary = {
    member: { email: EMAIL, phone: PHONE },
    investigationMode: "READ ONLY",
    generatedAt: new Date().toISOString(),
    counts: {
      directMatchTables: Object.keys(directMatches).length,
      totalTables: Object.keys(allRecords).length,
      bookings: bookings.length,
      matchingMemberBookings: memberBookings.length,
      memberMembershipRecords: memberships.length,
      membershipPurchases: purchases.length,
      healthSafetyForms: healthForms.length,
    },
    paymentReferenceSummary: referenceSummary,
    membershipCreditSummary: membershipSummary,
    observations: [] as string[],
  };

  if (referenceSummary.some((item) => item.matchingBookingCount !== 1)) {
    summary.observations.push(
      "At least one supplied payment reference does not match exactly one Booking record."
    );
  }

  if (!memberships.length) {
    summary.observations.push(
      "No MemberMembership records were found through the discovered relationships."
    );
  }

  if (
    memberBookings.some(
      (booking) => !getString(booking, "memberMembershipId")
    )
  ) {
    summary.observations.push(
      "At least one matching booking has no memberMembershipId."
    );
  }

  if (
    memberBookings.some(
      (booking) => booking.bookingStatus !== "CONFIRMED"
    )
  ) {
    summary.observations.push(
      "At least one matching booking is not CONFIRMED."
    );
  }

  // 8. Save the full JSON export.
  const jsonOutput = {
    summary,
    directMatches,
    relatedRecords: allRecords,
  };

  const jsonPath = path.join(
    OUTPUT_DIR,
    "oyindamola-investigation.json"
  );

  await writeFile(
    jsonPath,
    JSON.stringify(sanitize(jsonOutput), null, 2),
    "utf8"
  );

  // 9. Save a readable summary.
  const lines: string[] = [];

  lines.push("SCULPT LAB — MEMBER INVESTIGATION");
  lines.push("================================");
  lines.push(`Member: ${EMAIL}`);
  lines.push(`Phone: ${PHONE}`);
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push("Mode: READ ONLY");
  lines.push("");

  lines.push("RECORD COUNTS");
  lines.push("-------------");

  for (const [key, value] of Object.entries(summary.counts)) {
    lines.push(`${key}: ${value}`);
  }

  lines.push("");
  lines.push("PAYMENT REFERENCES");
  lines.push("------------------");

  for (const item of referenceSummary) {
    lines.push(`Reference: ${item.paymentReference}`);
    lines.push(`Matching bookings: ${item.matchingBookingCount}`);

    for (const booking of item.bookings) {
      lines.push(`  Booking ID: ${booking.bookingId}`);
      lines.push(`  Class: ${booking.className}`);
      lines.push(`  Date: ${booking.bookingDate}`);
      lines.push(`  Booking status: ${booking.bookingStatus}`);
      lines.push(`  Payment status: ${booking.paymentStatus}`);
      lines.push(`  Session ID: ${booking.sessionId}`);
      lines.push(
        `  Member membership ID: ${booking.memberMembershipId}`
      );
    }

    lines.push("");
  }

  lines.push("MEMBERSHIP CREDIT SUMMARY");
  lines.push("-------------------------");

  for (const item of membershipSummary) {
    lines.push(`Membership ID: ${item.memberMembershipId}`);
    lines.push(`Status: ${item.status}`);
    lines.push(`Start: ${item.startDate}`);
    lines.push(`Expiry: ${item.expiryDate}`);
    lines.push(`Total credits: ${item.creditsTotal}`);
    lines.push(`Used credits: ${item.creditsUsed}`);
    lines.push(`Remaining credits: ${item.remainingCredits}`);
    lines.push(`Purchase ID: ${item.membershipPurchaseId}`);
    lines.push("");
  }

  lines.push("OBSERVATIONS");
  lines.push("------------");

  if (summary.observations.length) {
    summary.observations.forEach((item) =>
      lines.push(`- ${item}`)
    );
  } else {
    lines.push("No automatic warning conditions were detected.");
  }

  lines.push("");
  lines.push("IMPORTANT:");
  lines.push(
    "This is an investigative summary, not proof that every booking or credit operation is correct."
  );
  lines.push(
    "Review the JSON export for complete records and relationships."
  );

  const summaryPath = path.join(
    OUTPUT_DIR,
    "oyindamola-investigation-summary.txt"
  );

  await writeFile(
    summaryPath,
    lines.join("\n"),
    "utf8"
  );

  console.log("\nINVESTIGATION COMPLETE");
  console.log("----------------------");
  console.log(`JSON: ${jsonPath}`);
  console.log(`Summary: ${summaryPath}`);
  console.log("\nNo database records were modified.");
}

main()
  .catch((error) => {
    console.error("Investigation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
