
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EMAIL = "ogokosisochukwu@gmail.com";
const PAYMENT_REFERENCE = "SL-1792830055373-51f793e9";

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    // 1. Find the member.
    const user = await tx.user.findUnique({
      where: { email: EMAIL },
    });

    if (!user) {
      throw new Error("Member account not found.");
    }

    // 2. Find the existing paid booking.
    const booking = await tx.booking.findUnique({
      where: { paymentReference: PAYMENT_REFERENCE },
      include: {
        healthSafetyForm: true,
      },
    });

    if (!booking) {
      throw new Error("Existing booking not found.");
    }

    if (booking.userId !== user.id) {
      throw new Error("Booking does not belong to this member.");
    }

    if (
      booking.paymentStatus !== "PAID" ||
      booking.bookingStatus !== "CONFIRMED"
    ) {
      throw new Error("Booking is not paid and confirmed.");
    }

    // 3. Find her existing active membership.
    const membership = await tx.memberMembership.findFirst({
      where: {
        userId: user.id,
        membershipId: booking.membershipId,
        status: "ACTIVE",
      },
      include: {
        membership: true,
        membershipPurchase: true,
      },
    });

    if (!membership) {
      throw new Error("Existing active membership not found.");
    }

    if (membership.creditsTotal !== 10) {
      throw new Error(
        `Unexpected total credits: ${membership.creditsTotal}`
      );
    }

    if (booking.amount !== membership.membership.price) {
      throw new Error("Booking amount does not match membership price.");
    }

    if (membership.membershipPurchaseId) {
      throw new Error(
        "Membership already has a purchase linked. Stopping."
      );
    }

    if (
      booking.memberMembershipId &&
      booking.memberMembershipId !== membership.id
    ) {
      throw new Error(
        "Booking is linked to a different membership. Stopping."
      );
    }

    // 4. Confirm the purchase reference has not been used
    // by a different purchase.
    let purchase = await tx.membershipPurchase.findUnique({
      where: {
        paymentReference: PAYMENT_REFERENCE,
      },
    });

    if (purchase) {
      if (
        purchase.userId !== user.id ||
        purchase.membershipId !== membership.membershipId ||
        purchase.amount !== booking.amount ||
        purchase.paymentStatus !== "PAID"
      ) {
        throw new Error(
          "An existing purchase has conflicting details."
        );
      }

      console.log("Matching purchase already exists. Reusing it.");
    } else {
      // 5. Create the missing purchase from the verified booking.
      purchase = await tx.membershipPurchase.create({
        data: {
          userId: user.id,
          email: user.email,
          fullName: booking.fullName ?? user.fullName,
          phone: booking.phone ?? user.phone,
          membershipId: membership.membershipId,
          type: "NEW",
          amount: booking.amount,
          paymentReference: booking.paymentReference,
          paymentStatus: "PAID",
          carriedCredits: 0,
          firstSessionId: booking.sessionId,
          firstClassId: booking.classId,
          healthDeclarationAccepted:
            booking.healthSafetyForm?.accepted ?? false,
          healthDeclarationNotes:
            booking.healthSafetyForm?.notes ?? null,
        },
      });
    }

    // 6. Link the existing membership to its purchase.
    const updatedMembership =
      await tx.memberMembership.update({
        where: { id: membership.id },
        data: {
          membershipPurchaseId: purchase.id,
          creditsUsed: 0,
        },
      });

    // 7. Link the existing booking to that membership.
    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: {
        memberMembershipId: membership.id,
      },
    });

    return {
      member: user.fullName,
      email: user.email,
      purchaseId: purchase.id,
      membershipId: updatedMembership.id,
      bookingId: updatedBooking.id,
      paymentReference: purchase.paymentReference,
      paymentStatus: purchase.paymentStatus,
      bookingStatus: updatedBooking.bookingStatus,
      creditsTotal: updatedMembership.creditsTotal,
      creditsUsed: updatedMembership.creditsUsed,
      creditsRemaining:
        (updatedMembership.creditsTotal ?? 0) -
        updatedMembership.creditsUsed,
      membershipStatus: updatedMembership.status,
      expiryDate: updatedMembership.expiryDate,
    };
  });

  console.log("\n========== REPAIR SUCCESSFUL ==========\n");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("\nREPAIR FAILED:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
