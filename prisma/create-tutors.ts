/**
 * Create the first tutor logins and link their existing schedules.
 *
 * Run AFTER the migration 20261115120000_add_tutor_role_and_tutors:
 *   npx tsx prisma/create-tutors.ts
 *
 * For each tutor below, in order:
 *   1. Find or create their Tutor record. Names are matched ignoring
 *      letter case and extra spaces; more than one match is reported
 *      and the tutor is skipped.
 *   2. Link schedules whose tutorName matches the tutor's name (same
 *      matching) and that aren't linked yet. A schedule linked to a
 *      different tutor is reported and left alone.
 *   3. Create their TUTOR login with a random password and link it to
 *      the Tutor record, in one transaction. The password is printed
 *      once and stored only as a hash.
 *
 * Safe to run again: existing tutors, links and accounts are reported,
 * never duplicated. An existing account's password and role are never
 * changed. Schedules for anyone not listed (for example Betty) are not
 * touched.
 */
import crypto from "node:crypto";
import prisma from "../src/config/prisma.js";
import { AuthProvider, UserRole } from "@prisma/client";
import { hashPassword } from "../src/utils/bcrypt.js";

const TUTORS = [
  { name: "Hope", email: "hope@sculptlab.com" },
  { name: "Daniel", email: "daniel@sculptlab.com" },
];

/** "  HOPE " and "hope" are the same tutor. */
const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

/** 24 URL-safe characters (144 bits of randomness). */
const generatePassword = () => crypto.randomBytes(18).toString("base64url");

type Report = {
  created: string[];
  existing: string[];
  attention: string[];
  credentials: { email: string; password: string }[];
};

async function findOrCreateTutor(name: string, report: Report) {
  const tutors = await prisma.tutor.findMany();
  const matches = tutors.filter((tutor) => normalize(tutor.name) === normalize(name));

  if (matches.length > 1) {
    report.attention.push(
      `Tutor "${name}": ${matches.length} Tutor records match (${matches
        .map((tutor) => `"${tutor.name}"`)
        .join(", ")}). Skipped; resolve the duplicates first.`
    );
    return null;
  }

  if (matches.length === 1) {
    report.existing.push(`Tutor record "${matches[0].name}" already exists.`);
    return matches[0];
  }

  const tutor = await prisma.tutor.create({ data: { name } });
  report.created.push(`Tutor record "${name}".`);
  return tutor;
}

async function linkSchedules(tutor: { id: string; name: string }, report: Report) {
  const schedules = await prisma.schedule.findMany({
    select: { id: true, code: true, tutorName: true, tutorId: true },
  });

  const matching = schedules.filter(
    (schedule) => normalize(schedule.tutorName) === normalize(tutor.name)
  );

  const toLink = matching.filter((schedule) => schedule.tutorId === null);
  const alreadyLinked = matching.filter((schedule) => schedule.tutorId === tutor.id);
  const linkedElsewhere = matching.filter(
    (schedule) => schedule.tutorId !== null && schedule.tutorId !== tutor.id
  );

  // Only schedules that are still unlinked are updated.
  const linked = toLink.length
    ? await prisma.schedule.updateMany({
        where: { id: { in: toLink.map((schedule) => schedule.id) }, tutorId: null },
        data: { tutorId: tutor.id },
      })
    : { count: 0 };

  report.created.push(
    `${tutor.name}: linked ${linked.count} schedule(s); ${alreadyLinked.length} already linked.`
  );

  for (const schedule of linkedElsewhere) {
    report.attention.push(
      `Schedule ${schedule.code} ("${schedule.tutorName}") is already linked to another tutor. Not changed.`
    );
  }

  if (matching.length === 0) {
    report.attention.push(
      `No schedules have tutorName "${tutor.name}". Check the spelling in Schedule.tutorName.`
    );
  }
}

async function createAccount(
  tutor: { id: string; name: string; userId: string | null },
  email: string,
  report: Report
) {
  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    include: { tutor: true },
  });

  if (tutor.userId && tutor.userId !== existingUser?.id) {
    report.attention.push(
      `Tutor "${tutor.name}" already has a different login account. ${normalizedEmail} not created.`
    );
    return;
  }

  if (existingUser) {
    if (existingUser.role !== UserRole.TUTOR) {
      report.attention.push(
        `${normalizedEmail} already exists with role ${existingUser.role}. Not changed and not linked.`
      );
      return;
    }

    if (existingUser.tutor && existingUser.tutor.id !== tutor.id) {
      report.attention.push(
        `${normalizedEmail} is already linked to tutor "${existingUser.tutor.name}". Not changed.`
      );
      return;
    }

    if (!existingUser.tutor) {
      // An existing TUTOR account that was never linked: link it, without
      // touching its password or role.
      await prisma.tutor.update({
        where: { id: tutor.id },
        data: { userId: existingUser.id },
      });
      report.created.push(`Linked existing TUTOR account ${normalizedEmail} to "${tutor.name}".`);
      return;
    }

    report.existing.push(`Login ${normalizedEmail} already exists for "${tutor.name}". Password not changed.`);
    return;
  }

  const password = generatePassword();
  const hashedPassword = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        fullName: tutor.name,
        email: normalizedEmail,
        password: hashedPassword,
        provider: AuthProvider.LOCAL,
        role: UserRole.TUTOR,
        isEmailVerified: true,
      },
    });

    // Only link if the tutor is still unlinked (never overwrite).
    const linked = await tx.tutor.updateMany({
      where: { id: tutor.id, userId: null },
      data: { userId: user.id },
    });

    if (linked.count !== 1) {
      throw new Error(`Tutor "${tutor.name}" was linked to another account meanwhile.`);
    }
  });

  report.created.push(`Login ${normalizedEmail} (TUTOR) for "${tutor.name}".`);
  report.credentials.push({ email: normalizedEmail, password });
}

async function main() {
  const report: Report = { created: [], existing: [], attention: [], credentials: [] };

  for (const { name, email } of TUTORS) {
    const tutor = await findOrCreateTutor(name, report);

    if (!tutor) {
      continue;
    }

    await linkSchedules(tutor, report);
    await createAccount(tutor, email, report);
  }

  // Schedules still without a tutor (e.g. tutors with no login yet).
  const unlinked = await prisma.schedule.groupBy({
    by: ["tutorName"],
    where: { tutorId: null },
    _count: { _all: true },
  });

  console.log("\n=== Created / linked ===");
  report.created.forEach((line) => console.log(`  ${line}`));

  console.log("\n=== Already existed ===");
  (report.existing.length ? report.existing : ["(none)"]).forEach((line) => console.log(`  ${line}`));

  console.log("\n=== Schedules left without a tutor (unchanged) ===");
  (unlinked.length
    ? unlinked.map((group) => `"${group.tutorName}": ${group._count._all} schedule(s)`)
    : ["(none)"]
  ).forEach((line) => console.log(`  ${line}`));

  console.log("\n=== Needs attention ===");
  (report.attention.length ? report.attention : ["(none)"]).forEach((line) => console.log(`  ${line}`));

  if (report.credentials.length) {
    console.log("\n=== New login credentials (shown once; save them securely now) ===");
    report.credentials.forEach(({ email, password }) =>
      console.log(`  ${email}  ${password}`)
    );
  }
}

main()
  .catch((error) => {
    console.error("Failed to create tutors:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
