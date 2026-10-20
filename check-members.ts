
import prisma from './src/config/prisma.js';

async function checkMembers() {
  try {
    // 1. REGISTERED USERS
    console.log('\n========== 1. REGISTERED USERS ==========');

    const users = await prisma.user.groupBy({
      by: ['role'],
      _count: { _all: true },
    });

    console.table(
      users.map((user) => ({
        role: user.role,
        total: user._count._all,
      })),
    );

    // 2. MEMBERSHIPS
    console.log('\n========== 2. MEMBERSHIPS ==========');

    const memberships = await prisma.memberMembership.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    console.table(
      memberships.map((item) => ({
        status: item.status,
        total: item._count._all,
      })),
    );

    const [linkedMemberships, unlinkedMemberships] =
      await Promise.all([
        prisma.memberMembership.count({
          where: { userId: { not: null } },
        }),
        prisma.memberMembership.count({
          where: { userId: null },
        }),
      ]);

    console.log({ linkedMemberships, unlinkedMemberships });

    // 3. BOOKINGS
    console.log('\n========== 3. BOOKINGS ==========');

    const bookings = await prisma.booking.groupBy({
      by: ['paymentStatus', 'bookingStatus', 'paymentMethod'],
      _count: { _all: true },
    });

    console.table(
      bookings.map((booking) => ({
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.bookingStatus,
        paymentMethod: booking.paymentMethod,
        total: booking._count._all,
      })),
    );

    // 4. COUNTS
    console.log('\n========== 4. MEMBER COUNTS ==========');

    const [totalUsers, memberUsers, totalMemberships, totalBookings] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { role: 'MEMBER' } }),
        prisma.memberMembership.count(),
        prisma.booking.count(),
      ]);

    console.table([
      { metric: 'All registered users', total: totalUsers },
      { metric: 'Users with MEMBER role', total: memberUsers },
      { metric: 'All membership records', total: totalMemberships },
      { metric: 'All booking records', total: totalBookings },
    ]);

    // 5. OFFLINE MEMBERSHIP MATCHES
    console.log('\n========== 5. OFFLINE MEMBER MATCHES ==========');

    const offlineMatches = await prisma.memberMembership.findMany({
      where: {
        userId: null,
        bookings: {
          some: {
            paymentStatus: 'PAID',
            bookingStatus: 'CONFIRMED',
            paymentMethod: 'OFFLINE',
          },
        },
      },
      include: {
        membership: true,
        activation: true,
        bookings: {
          where: {
            paymentStatus: 'PAID',
            bookingStatus: 'CONFIRMED',
            paymentMethod: 'OFFLINE',
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    console.log('Matching offline memberships:', offlineMatches.length);

    console.table(
      offlineMatches.map((item) => ({
        membershipRecordId: item.id,
        userId: item.userId,
        membershipId: item.membershipId,
        membershipName: item.membership.name,
        activationId: item.activation?.id,
        bookingCount: item.bookings.length,
        bookingId: item.bookings[0]?.id,
        bookingEmail: item.bookings[0]?.email,
        bookingPhone: item.bookings[0]?.phone,
      })),
    );

    // 6. BOOKING-MEMBERSHIP LINKS
    console.log('\n========== 6. BOOKING-MEMBERSHIP LINKS ==========');

    const paidOfflineBookings = await prisma.booking.findMany({
      where: {
        paymentStatus: 'PAID',
        bookingStatus: 'CONFIRMED',
        paymentMethod: 'OFFLINE',
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        memberMembershipId: true,
        userId: true,
        membershipId: true,
      },
    });
  const activations = await prisma.membershipActivation.findMany({
  include: {
    booking: {
      select: {
        id: true,
        fullName: true,
        email: true,
        paymentStatus: true,
        paymentMethod: true,
        bookingStatus: true,
        userId: true,
      },
    },
    memberMembership: {
      select: {
        id: true,
        userId: true,
        membershipId: true,
        status: true,
      },
    },
  },
});

console.log("\n========== 7. MEMBERSHIP ACTIVATIONS ==========");

console.table(
  activations.map((activation) => ({
    membershipNumber: activation.membershipNumber,
    activationUsed: Boolean(activation.usedAt),
    bookingId: activation.bookingId,
    customer: activation.booking.fullName,
    email: activation.booking.email,
    paymentStatus: activation.booking.paymentStatus,
    paymentMethod: activation.booking.paymentMethod,
    bookingStatus: activation.booking.bookingStatus,
    bookingUserId: activation.booking.userId,
    memberMembershipId: activation.memberMembership.id,
    memberUserId: activation.memberMembership.userId,
    membershipStatus: activation.memberMembership.status,
  }))
);

    console.table(
      paidOfflineBookings.map((booking) => ({
        bookingId: booking.id,
        fullName: booking.fullName,
        email: booking.email,
        phone: booking.phone,
        memberMembershipId: booking.memberMembershipId,
        userId: booking.userId,
        membershipId: booking.membershipId,
      })),
    );

    console.log(
      'Paid offline bookings with a membership link:',
      paidOfflineBookings.filter(
        (booking) => booking.memberMembershipId !== null,
      ).length,
    );

    console.log(
      'Paid offline bookings without a membership link:',
      paidOfflineBookings.filter(
        (booking) => booking.memberMembershipId === null,
      ).length,
    );
  } catch (error) {
    console.error('Diagnostic failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkMembers();
