// import { PrismaClient } from "@prisma/client";

// const prisma = new PrismaClient();

// async function backfillMembershipNumbers() {
//   try {
//     const memberships = await prisma.memberMembership.findMany({
//       where: {
//         membershipNumber: null,
//       },
//       include: {
//         activation: true,
//       },
//     });

//     let updatedCount = 0;

//     for (const membership of memberships) {
//       const membershipNumber =
//         membership.activation?.membershipNumber;

//       if (!membershipNumber) {
//         continue;
//       }

//       await prisma.memberMembership.update({
//         where: {
//           id: membership.id,
//         },
//         data: {
//           membershipNumber,
//         },
//       });

//       updatedCount++;
//     }

//     console.log(
//       `Backfill completed. Updated ${updatedCount} memberships.`
//     );
//   } catch (error) {
//     console.error("Membership number backfill failed:", error);
//     process.exitCode = 1;
//   } finally {
//     await prisma.$disconnect();
//   }
// }

// backfillMembershipNumbers();

 import { PrismaClient } from "@prisma/client";

 const prisma = new PrismaClient();

async function checkMembershipNumbers() {
  try {
    const [
      totalMemberships,
      membershipsWithNumbers,
      membershipsWithoutNumbers,
      totalActivations,
      activations,
      memberships,
    ] = await Promise.all([
      prisma.memberMembership.count(),

      prisma.memberMembership.count({
        where: {
          membershipNumber: {
            not: null,
          },
        },
      }),

      prisma.memberMembership.count({
        where: {
          membershipNumber: null,
        },
      }),

      prisma.membershipActivation.count(),

      prisma.membershipActivation.findMany({
        select: {
          id: true,
          membershipNumber: true,
        },
      }),

      prisma.memberMembership.findMany({
        where: {
          membershipNumber: null,
        },
        include: {
          activation: true,
          membership: true,
          membershipPurchase: true,
        },
      }),
    ]);

    console.log("\n========== MEMBERSHIP REPORT ==========\n");

    console.log({
      totalMemberships,
      membershipsWithNumbers,
      membershipsWithoutNumbers,
      totalActivations,
      activationsWithNumbers: activations.length,
    });

    console.log("\nMemberships without numbers:\n");

    console.dir(
      memberships.map((item) => ({
        id: item.id,
        userId: item.userId,
        membershipId: item.membershipId,
        membershipPurchaseId: item.membershipPurchaseId,
        membershipName: item.membership?.name,
        activationNumber: item.activation?.membershipNumber,
        purchaseEmail: item.membershipPurchase?.email,
        paymentStatus: item.membershipPurchase?.paymentStatus,
        purchaseType: item.membershipPurchase?.purchaseType,
      })),
      { depth: null }
    );

    console.log("\n=======================================\n");
  } catch (error) {
    console.error("Membership diagnostic failed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

checkMembershipNumbers();