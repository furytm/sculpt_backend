
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();

const customerEmails = [
  "cendrella_eid@hotmail.com",
  "sculptlabpilates@gmail.com",
  "oyinda16@gmail.com",
  "heavenlyflo@gmail.com",
  "sholaaminu0@gmail.com",
  "ogokosisochukwu@gmail.com",
  "me@jemimabenson.com",
  "bolan78@me.com",
  "folusopearce@hotmail.com",
  "aramidepearce@gmail.com",
  "iomenai@hotmail.com",
  "evaojeme@yahoo.com",
  "obinwugo@yahoo.com",
  "michellevpatrick@gmail.com",
  "folarin.odubeko@gmail.com",
  "appahdebs@gmail.com",
];

async function main() {
  const normalizedEmails = customerEmails.map((email) =>
    email.trim().toLowerCase()
  );

  const users = await prisma.user.findMany({
    where: {
      email: {
        in: normalizedEmails,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      createdAt: true,
    },
  });

  const userIds = users.map((user) => user.id);

  const [memberships, purchases, bookings] = await Promise.all([
    prisma.memberMembership.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          {
            user: {
              email: {
                in: normalizedEmails,
                mode: "insensitive",
              },
            },
          },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        membership: true,
        membershipPurchase: {
          select: {
            id: true,
            type: true,
            paymentStatus: true,
            paymentMethod: true,
            amount: true,
            paymentReference: true,
            firstSessionId: true,
            firstClassId: true,
            healthDeclarationAccepted: true,
            previousMembershipId: true,
            previousMemberMembershipId: true,
            carriedCredits: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        activation: true,
        bookings: {
          include: {
            session: {
              include: {
                schedule: true,
              },
            },
            healthSafetyForm: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    }),

    prisma.membershipPurchase.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          {
            email: {
              in: normalizedEmails,
              mode: "insensitive",
            },
          },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        membership: true,
        firstSession: {
          include: {
            schedule: true,
          },
        },
        memberMembership: {
          select: {
            id: true,
            status: true,
            startDate: true,
            expiryDate: true,
            creditsTotal: true,
            creditsUsed: true,
          },
        },
        membershipActivation: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),

    prisma.booking.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          {
            email: {
              in: normalizedEmails,
              mode: "insensitive",
            },
          },
        ],
      },
      include: {
        membership: true,
        memberMembership: {
          include: {
            membership: true,
          },
        },
        session: {
          include: {
            schedule: true,
          },
        },
        schedule: true,
        healthSafetyForm: true,
        membershipActivation: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
  ]);

  const now = new Date();

  const customerReports = normalizedEmails.map((email) => {
    const user = users.find(
      (item) => item.email.toLowerCase() === email
    ) ?? null;

    const customerMemberships = memberships.filter(
      (item) =>
        item.userId === user?.id ||
        item.user?.email?.toLowerCase() === email
    );

    const customerPurchases = purchases.filter(
      (item) =>
        item.userId === user?.id ||
        item.email?.toLowerCase() === email
    );

    const customerBookings = bookings.filter(
      (item) =>
        item.userId === user?.id ||
        item.email?.toLowerCase() === email
    );

    const membershipAnalysis = customerMemberships.map((record) => {
      const confirmedBookings = record.bookings.filter(
        (booking) => booking.bookingStatus === "CONFIRMED"
      );

      const nonCancelledBookings = record.bookings.filter(
        (booking) => booking.bookingStatus !== "CANCELLED"
      );

      const purchase = record.membershipPurchase;

      const requiresInitialBookingCandidate =
        purchase?.type === "NEW" &&
        purchase.paymentStatus === "PAID" &&
        !purchase.firstSessionId &&
        nonCancelledBookings.length === 0;

      return {
        memberMembershipId: record.id,
        member: record.user,
        membershipName: record.membership.name,
        membershipType: record.membership.type,
        status: record.status,
        startDate: record.startDate,
        expiryDate: record.expiryDate,
        expiryInPast:
          record.expiryDate !== null &&
          record.expiryDate < now,
        creditsTotal: record.creditsTotal,
        creditsUsed: record.creditsUsed,
        remainingCredits:
          record.creditsTotal === null
            ? null
            : record.creditsTotal - record.creditsUsed,
        membershipPurchaseId: record.membershipPurchaseId,
        purchaseType: purchase?.type ?? null,
        purchasePaymentStatus: purchase?.paymentStatus ?? null,
        firstSessionId: purchase?.firstSessionId ?? null,
        confirmedBookingCount: confirmedBookings.length,
        nonCancelledBookingCount: nonCancelledBookings.length,
        totalBookingCount: record.bookings.length,
        requiresInitialBookingCandidate,
        bookings: record.bookings.map((booking) => ({
          id: booking.id,
          bookingStatus: booking.bookingStatus,
          paymentStatus: booking.paymentStatus,
          paymentMethod: booking.paymentMethod,
          amount: booking.amount,
          membershipType: record.membership.type,
          memberMembershipId: booking.memberMembershipId,
          sessionId: booking.sessionId,
          sessionDate: booking.session?.sessionDate ?? null,
          className:
            booking.session?.schedule?.className ?? null,
          healthDeclarationAccepted:
            booking.healthSafetyForm?.accepted ?? null,
          createdAt: booking.createdAt,
        })),
      };
    });

    const activeMemberships = customerMemberships.filter(
      (item) =>
        item.status === "ACTIVE" &&
        (!item.expiryDate || item.expiryDate >= now)
    );

    const potentialInitialBooking = membershipAnalysis.filter(
      (item) => item.requiresInitialBookingCandidate
    );

    return {
      email,
      userFound: Boolean(user),
      user,
      counts: {
        memberships: customerMemberships.length,
        activeMemberships: activeMemberships.length,
        purchases: customerPurchases.length,
        bookings: customerBookings.length,
      },
      activeMemberships: activeMemberships.map((item) => ({
        id: item.id,
        membershipName: item.membership.name,
        membershipType: item.membership.type,
        creditsTotal: item.creditsTotal,
        creditsUsed: item.creditsUsed,
        remainingCredits:
          item.creditsTotal === null
            ? null
            : item.creditsTotal - item.creditsUsed,
      })),
      membershipAnalysis,
      purchases: customerPurchases,
      bookings: customerBookings,
      warnings: {
        noUserAccount: !user,
        noMembershipRecords: customerMemberships.length === 0,
        multipleActiveMemberships: activeMemberships.length > 1,
        potentialInitialBooking: potentialInitialBooking.length > 0,
        activeMembershipsWithoutPurchase:
          activeMemberships.filter(
            (item) => !item.membershipPurchaseId
          ).length,
        paidNewPurchasesWithoutMembership:
          customerPurchases.filter(
            (purchase) =>
              purchase.type === "NEW" &&
              purchase.paymentStatus === "PAID" &&
              !purchase.memberMembership?.id
          ).length,
        pendingPurchases: customerPurchases.filter(
          (purchase) => purchase.paymentStatus === "PENDING"
        ).length,
        failedPurchases: customerPurchases.filter(
          (purchase) => purchase.paymentStatus === "FAILED"
        ).length,
      },
    };
  });

  const report = {
    generatedAt: now.toISOString(),
    totalCustomersRequested: normalizedEmails.length,
    totalUsersFound: users.length,
    totalMemberships: memberships.length,
    totalPurchases: purchases.length,
    totalBookings: bookings.length,
    customers: customerReports,
  };

  const outputPath = `affected-members-report-${Date.now()}.json`;

  writeFileSync(
    outputPath,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log("\n========== AFFECTED MEMBERS REPORT ==========");
  console.log({
    requested: report.totalCustomersRequested,
    usersFound: report.totalUsersFound,
    memberships: report.totalMemberships,
    purchases: report.totalPurchases,
    bookings: report.totalBookings,
  });

  console.log("\n========== CUSTOMER SUMMARY ==========");

  for (const customer of customerReports) {
    console.log({
      email: customer.email,
      userFound: customer.userFound,
      memberships: customer.counts.memberships,
      activeMemberships: customer.counts.activeMemberships,
      purchases: customer.counts.purchases,
      bookings: customer.counts.bookings,
      warnings: customer.warnings,
    });
  }

  console.log(`\nFull report saved to: ${outputPath}`);
  console.log("=============================================\n");
}

main()
  .catch((error) => {
    console.error("Affected members diagnostic failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
