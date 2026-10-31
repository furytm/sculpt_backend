
import prisma from "./src/config/prisma.js";

async function main() {
  const email = "sholaaminu0@gmail.com";

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error(`No user found with email: ${email}`);
  }

  const memberships = await prisma.memberMembership.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
    },
    include: {
      membership: true,
    },
  });

  if (memberships.length === 0) {
    throw new Error("No active membership found for this customer.");
  }

  console.log("Active memberships found:");
  console.table(
    memberships.map((m) => ({
      membershipRecordId: m.id,
      plan: m.membership.name,
      creditsTotal: m.creditsTotal,
      creditsUsed: m.creditsUsed,
      remaining: m.creditsTotal - m.creditsUsed,
    }))
  );

  // Update only the 5-class monthly plan.
  const target = memberships.find(
    (m) =>
      m.creditsTotal === 5 &&
      m.membership.duration.toLowerCase().includes("month")
  );

  if (!target) {
    throw new Error(
      "No active 5-credit monthly membership found. No changes made."
    );
  }

  const updated = await prisma.memberMembership.update({
    where: { id: target.id },
    data: {
      creditsUsed: 3,
    },
    include: {
      membership: true,
    },
  });

  console.log("\nUpdated membership:");
  console.log({
    customer: user.fullName,
    email: user.email,
    plan: updated.membership.name,
    creditsTotal: updated.creditsTotal,
    creditsUsed: updated.creditsUsed,
    remainingCredits: updated.creditsTotal - updated.creditsUsed,
  });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
