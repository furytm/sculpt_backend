
import prisma from "./src/config/prisma.js";


async function main() {
  console.log("\n========== TUESDAY SCHEDULES ==========\n");

  // 1. Check Tuesday schedules
  const schedules = await prisma.schedule.findMany({
    where: {
      dayOfWeek: "TUESDAY",
    },
    orderBy: {
      startTime: "asc",
    },
    select: {
      id: true,
      code: true,
      dayOfWeek: true,
      startTime: true,
      endTime: true,
      className: true,
      tutorName: true,
      isActive: true,
    },
  });

  console.table(schedules);

  console.log("\n========== TUESDAY CLASS SESSIONS ==========\n");

  // 2. Check generated Tuesday sessions
  const sessions = await prisma.classSession.findMany({
    where: {
      schedule: {
        dayOfWeek: "TUESDAY",
      },
    },
    orderBy: {
      sessionDate: "asc",
    },
    include: {
      schedule: {
        select: {
          code: true,
          className: true,
          startTime: true,
          endTime: true,
          tutorName: true,
          isActive: true,
        },
      },
    },
  });

  console.table(
    sessions.map((session) => ({
      code: session.schedule.code,
      className: session.schedule.className,
      tutorName: session.schedule.tutorName,
      startTime: session.schedule.startTime,
      sessionDate: session.sessionDate.toISOString(),
      status: session.status,
      scheduleActive: session.schedule.isActive,
    }))
  );

  console.log("\n========== CHECK COMPLETED ==========\n");
}

main()
  .catch((error) => {
    console.error("Error checking Tuesday schedules:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });