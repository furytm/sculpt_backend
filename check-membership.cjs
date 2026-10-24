
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "k10@gmail.com" },
    select: { id: true, email: true },
  });

  console.log("\n=== TARGET USER ===");
  console.dir(user);

  console.log("\n=== RECENT MEMBERSHIP RECORDS ===");
  const memberships = await prisma.memberMembership.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      userId: true,
      membershipPurchaseId: true,
      membershipId: true,
      status: true,
      createdAt: true,
      membership: {
        select: {
          name: true,
          price: true,
        },
      },
    },
  });
  console.dir(memberships, { depth: null });

  console.log("\n=== ALL MEMBERSHIP PURCHASES ===");
  const purchases = await prisma.membershipPurchase.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      userId: true,
      email: true,
      paymentStatus: true,
      createdAt: true,
    },
  });
  console.dir(purchases, { depth: null });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
