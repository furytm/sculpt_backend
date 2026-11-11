/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory Prisma fake */
/**
 * In-memory stand-in for the Prisma client, covering only what the
 * booking and membership services use:
 *
 * - findMany / findFirst / findUnique / count / create / update /
 *   updateMany / upsert / delete / deleteMany on the tables below;
 * - where filters: equality, null, Date, OR / AND / NOT, the
 *   operators equals / not / in / startsWith / gt / gte / lt / lte (and
 *   mode: "insensitive"), and to-one / to-many (some) relation filters;
 * - include (nested), including filtered and limited to-many
 *   includes and _count;
 * - orderBy with Postgres null ordering (ASC nulls last, DESC nulls
 *   first);
 * - unique MemberMembership.membershipPurchaseId and
 *   Booking.paymentReference;
 * - $transaction(callback), which restores every table when the
 *   callback throws, like a database rollback.
 *
 * Every delegate method is a vi.fn, so a test can override one call.
 */
import { vi } from "vitest";

export type Row = Record<string, any>;

export type TableName =
  | "membership"
  | "memberMembership"
  | "membershipPurchase"
  | "booking"
  | "classSession"
  | "schedule"
  | "user"
  | "healthSafetyForm"
  | "membershipActivation"
  | "refreshToken";

const TABLES: TableName[] = [
  "membership",
  "memberMembership",
  "membershipPurchase",
  "booking",
  "classSession",
  "schedule",
  "user",
  "healthSafetyForm",
  "membershipActivation",
  "refreshToken",
];

interface Relation {
  table: TableName;
  kind: "one" | "many";
  local: string;
  foreign: string;
}

const one = (table: TableName, local: string, foreign = "id"): Relation => ({
  table,
  kind: "one",
  local,
  foreign,
});

const many = (table: TableName, foreign: string): Relation => ({
  table,
  kind: "many",
  local: "id",
  foreign,
});

const RELATIONS: Record<TableName, Record<string, Relation>> = {
  membership: {},
  memberMembership: {
    membership: one("membership", "membershipId"),
    membershipPurchase: one("membershipPurchase", "membershipPurchaseId"),
    user: one("user", "userId"),
    bookings: many("booking", "memberMembershipId"),
  },
  membershipPurchase: {
    membership: one("membership", "membershipId"),
    user: one("user", "userId"),
    firstSession: one("classSession", "firstSessionId"),
    memberMembership: one("memberMembership", "id", "membershipPurchaseId"),
    membershipActivation: one(
      "membershipActivation",
      "id",
      "membershipPurchaseId"
    ),
  },
  booking: {
    membership: one("membership", "membershipId"),
    memberMembership: one("memberMembership", "memberMembershipId"),
    session: one("classSession", "sessionId"),
    schedule: one("schedule", "scheduleId"),
    user: one("user", "userId"),
    healthSafetyForm: one("healthSafetyForm", "id", "bookingId"),
    membershipActivation: one("membershipActivation", "id", "bookingId"),
  },
  classSession: {
    schedule: one("schedule", "scheduleId"),
    bookings: many("booking", "sessionId"),
  },
  schedule: {},
  user: {},
  healthSafetyForm: {},
  membershipActivation: {
    booking: one("booking", "bookingId"),
    membershipPurchase: one("membershipPurchase", "membershipPurchaseId"),
    memberMembership: one("memberMembership", "memberMembershipId"),
  },
  refreshToken: {},
};

const DEFAULTS: Partial<Record<TableName, Row>> = {
  memberMembership: {
    userId: null,
    membershipPurchaseId: null,
    status: "ACTIVE",
    startDate: null,
    expiryDate: null,
    creditsTotal: null,
    creditsUsed: 0,
    membershipNumber: null,
  },
  membershipPurchase: {
    userId: null,
    fullName: null,
    phone: null,
    previousMembershipId: null,
    previousMemberMembershipId: null,
    paymentMethod: "PAYMISH",
    paymentStatus: "PENDING",
    paymentRejectionReason: null,
    carriedCredits: 0,
    firstSessionId: null,
    firstClassId: null,
    healthDeclarationAccepted: false,
    healthDeclarationNotes: null,
  },
  booking: {
    userId: null,
    sessionId: null,
    scheduleId: null,
    memberMembershipId: null,
    bookingStatus: "PENDING",
    paymentStatus: "PENDING",
    calendarEventId: null,
    calendarEventUrl: null,
  },
  classSession: {
    capacity: null,
    status: "OPEN",
  },
};

const UNIQUE: Partial<Record<TableName, string[]>> = {
  memberMembership: ["membershipPurchaseId"],
  membershipPurchase: ["paymentReference"],
  booking: ["paymentReference"],
  membershipActivation: [
    "bookingId",
    "membershipPurchaseId",
    "memberMembershipId",
    "membershipNumber",
    "tokenHash",
  ],
};

const isPlainObject = (value: unknown): value is Row =>
  typeof value === "object" &&
  value !== null &&
  !(value instanceof Date) &&
  !Array.isArray(value);

function compare(a: any, b: any) {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function createFakePrisma() {
  const tables = Object.fromEntries(
    TABLES.map((name) => [name, [] as Row[]])
  ) as Record<TableName, Row[]>;

  let idCounter = 0;
  let clockOffset = 0;

  const nextId = (table: string) => `${table}_${++idCounter}`;

  // Strictly increasing createdAt, so "latest" ordering is never a tie.
  const nextCreatedAt = () => new Date(Date.now() + ++clockOffset);

  function reset() {
    for (const name of TABLES) tables[name] = [];
    idCounter = 0;
    clockOffset = 0;
  }

  const resolveOne = (relation: Relation, row: Row) =>
    tables[relation.table].find(
      (other) =>
        row[relation.local] !== null &&
        row[relation.local] !== undefined &&
        other[relation.foreign] === row[relation.local]
    ) ?? null;

  const resolveMany = (relation: Relation, row: Row) =>
    tables[relation.table].filter(
      (other) => other[relation.foreign] === row[relation.local]
    );

  function matchValue(value: any, condition: any): boolean {
    if (condition === null) return value === null || value === undefined;

    if (condition instanceof Date) {
      return value instanceof Date && value.getTime() === condition.getTime();
    }

    if (isPlainObject(condition)) {
      const insensitive = condition.mode === "insensitive";

      return Object.entries(condition).every(([operator, argument]) => {
        switch (operator) {
          case "mode":
            return true;
          case "equals":
            return insensitive &&
              typeof value === "string" &&
              typeof argument === "string"
              ? value.toLowerCase() === argument.toLowerCase()
              : matchValue(value, argument);
          case "not":
            return !matchValue(value, argument);
          case "in":
            return (argument as any[]).some((item) => matchValue(value, item));
          case "startsWith":
            return typeof value === "string" && value.startsWith(argument as string);
          case "gt":
            return value != null && compare(value, argument) > 0;
          case "gte":
            return value != null && compare(value, argument) >= 0;
          case "lt":
            return value != null && compare(value, argument) < 0;
          case "lte":
            return value != null && compare(value, argument) <= 0;
          default:
            throw new Error(`Fake Prisma: unsupported operator "${operator}"`);
        }
      });
    }

    return value === condition;
  }

  function matches(table: TableName, row: Row, where?: Row): boolean {
    if (!where) return true;

    return Object.entries(where).every(([key, condition]) => {
      if (condition === undefined) return true;

      if (key === "OR") {
        return (condition as Row[]).some((item) => matches(table, row, item));
      }

      if (key === "AND") {
        const list = Array.isArray(condition) ? condition : [condition];
        return list.every((item) => matches(table, row, item));
      }

      if (key === "NOT") {
        return !matches(table, row, condition);
      }

      const relation = RELATIONS[table][key];

      if (relation) {
        if (relation.kind === "one") {
          const related = resolveOne(relation, row);
          if (condition === null) return related === null;
          return related !== null && matches(relation.table, related, condition);
        }

        const list = resolveMany(relation, row);
        if (condition.some) {
          return list.some((item) => matches(relation.table, item, condition.some));
        }
        if (condition.none) {
          return !list.some((item) => matches(relation.table, item, condition.none));
        }
        if (condition.every) {
          return list.every((item) => matches(relation.table, item, condition.every));
        }
        throw new Error(`Fake Prisma: unsupported to-many filter on "${key}"`);
      }

      return matchValue(row[key], condition);
    });
  }

  function sortRows(rows: Row[], orderBy: any) {
    if (!orderBy) return rows;

    const orders = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap(
      (item: Row) => Object.entries(item)
    ) as [string, "asc" | "desc"][];

    return [...rows].sort((a, b) => {
      for (const [field, direction] of orders) {
        const left = a[field];
        const right = b[field];
        const leftNull = left === null || left === undefined;
        const rightNull = right === null || right === undefined;

        if (leftNull || rightNull) {
          if (leftNull && rightNull) continue;
          // Postgres: ASC puts nulls last, DESC puts nulls first.
          const nullFirst = direction === "desc";
          return leftNull === nullFirst ? -1 : 1;
        }

        const result = compare(left, right);
        if (result !== 0) return direction === "desc" ? -result : result;
      }
      return 0;
    });
  }

  function project(table: TableName, row: Row, args?: Row): Row {
    const output: Row = { ...row };
    const include = args?.include ?? args?.select;

    if (!include) return output;

    for (const [key, spec] of Object.entries(include)) {
      if (!spec) continue;

      if (key === "_count") {
        const counts: Row = {};
        for (const [relationKey, countSpec] of Object.entries(
          (spec as Row).select ?? {}
        )) {
          const relation = RELATIONS[table][relationKey];
          const list = resolveMany(relation, row);
          counts[relationKey] = isPlainObject(countSpec)
            ? list.filter((item) => matches(relation.table, item, countSpec.where)).length
            : list.length;
        }
        output._count = counts;
        continue;
      }

      const relation = RELATIONS[table][key];
      if (!relation) continue; // a scalar in a select: already copied

      const nested = spec === true ? undefined : (spec as Row);

      if (relation.kind === "one") {
        const related = resolveOne(relation, row);
        output[key] = related ? project(relation.table, related, nested) : null;
      } else {
        let list = resolveMany(relation, row);
        if (nested?.where) {
          list = list.filter((item) => matches(relation.table, item, nested.where));
        }
        list = sortRows(list, nested?.orderBy);
        if (nested?.take !== undefined) list = list.slice(0, nested.take);
        output[key] = list.map((item) => project(relation.table, item, nested));
      }
    }

    return output;
  }

  function applyData(row: Row, data: Row) {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;

      if (isPlainObject(value)) {
        if ("increment" in value) row[key] = (row[key] ?? 0) + value.increment;
        else if ("decrement" in value) row[key] = (row[key] ?? 0) - value.decrement;
        else if ("set" in value) row[key] = value.set;
        else row[key] = value; // JSON fields
      } else {
        row[key] = value;
      }
    }
    row.updatedAt = new Date();
  }

  function assertUnique(table: TableName, row: Row) {
    for (const field of UNIQUE[table] ?? []) {
      if (row[field] === null || row[field] === undefined) continue;
      const duplicate = tables[table].some(
        (other) => other !== row && other[field] === row[field]
      );
      if (duplicate) {
        const error: any = new Error(
          `Unique constraint failed on the fields: (\`${field}\`)`
        );
        error.code = "P2002";
        throw error;
      }
    }
  }

  function delegate(table: TableName) {
    const findMany = vi.fn(async (args: Row = {}) => {
      let rows = tables[table].filter((row) => matches(table, row, args.where));
      rows = sortRows(rows, args.orderBy);
      if (args.take !== undefined) rows = rows.slice(0, args.take);
      return rows.map((row) => project(table, row, args));
    });

    const findFirst = vi.fn(async (args: Row = {}) =>
      (await findMany({ ...args, take: 1 }))[0] ?? null
    );

    return {
      findMany,
      findFirst,
      findUnique: vi.fn(async (args: Row) => findFirst(args)),
      findUniqueOrThrow: vi.fn(async (args: Row) => {
        const row = await findFirst(args);
        if (!row) throw new Error(`No ${table} found`);
        return row;
      }),
      count: vi.fn(
        async (args: Row = {}) =>
          tables[table].filter((row) => matches(table, row, args.where)).length
      ),
      create: vi.fn(async (args: Row) => {
        const row: Row = {
          id: nextId(table),
          createdAt: nextCreatedAt(),
          updatedAt: new Date(),
          ...(DEFAULTS[table] ?? {}),
        };
        applyData(row, args.data);
        tables[table].push(row);
        try {
          assertUnique(table, row);
        } catch (error) {
          tables[table].pop();
          throw error;
        }
        return project(table, row, args);
      }),
      update: vi.fn(async (args: Row) => {
        const row = tables[table].find((item) => matches(table, item, args.where));
        if (!row) throw new Error(`Record to update not found (${table}).`);
        applyData(row, args.data);
        assertUnique(table, row);
        return project(table, row, args);
      }),
      delete: vi.fn(async (args: Row) => {
        const index = tables[table].findIndex((item) => matches(table, item, args.where));
        if (index < 0) throw new Error(`Record to delete not found (${table}).`);
        const [removed] = tables[table].splice(index, 1);
        return project(table, removed, args);
      }),
      deleteMany: vi.fn(async (args: Row = {}) => {
        const keep = tables[table].filter((item) => !matches(table, item, args.where));
        const count = tables[table].length - keep.length;
        tables[table] = keep;
        return { count };
      }),
      updateMany: vi.fn(async (args: Row) => {
        const rows = tables[table].filter((item) => matches(table, item, args.where));
        for (const row of rows) applyData(row, args.data);
        return { count: rows.length };
      }),
      upsert: vi.fn(async (args: Row) => {
        const row = tables[table].find((item) => matches(table, item, args.where));
        if (row) {
          applyData(row, args.update);
          return project(table, row, args);
        }
        const created: Row = {
          id: nextId(table),
          createdAt: nextCreatedAt(),
          updatedAt: new Date(),
          ...(DEFAULTS[table] ?? {}),
        };
        applyData(created, args.create);
        tables[table].push(created);
        return project(table, created, args);
      }),
    };
  }

  const prisma: any = {
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const saved = structuredClone(tables);
      try {
        return await callback(prisma);
      } catch (error) {
        for (const name of TABLES) tables[name] = saved[name];
        throw error;
      }
    }),
  };

  for (const name of TABLES) prisma[name] = delegate(name);

  /** Insert a row directly, with the same defaults as create(). */
  function insert(table: TableName, data: Row): Row {
    const row: Row = {
      id: nextId(table),
      createdAt: nextCreatedAt(),
      updatedAt: new Date(),
      ...(DEFAULTS[table] ?? {}),
      ...data,
    };
    tables[table].push(row);
    return row;
  }

  /** Live row from a table, by id. */
  function get(table: TableName, id: string): Row {
    const row = tables[table].find((item) => item.id === id);
    if (!row) throw new Error(`No ${table} row with id ${id}`);
    return row;
  }

  return { prisma, tables, reset, insert, get };
}
