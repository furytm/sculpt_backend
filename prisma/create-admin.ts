import prisma from "../src/config/prisma.js";
import { AuthProvider, UserRole } from "@prisma/client";
import { hashPassword } from "../src/utils/bcrypt.js";

async function main() {
  const admins = [
    {
      fullName: "Sculpt LAB Admin 1",
      email: "admin1@sculptlab.com",
      password: "password1",
    },
    {
      fullName: "Sculpt LAB Admin 2",
      email: "admin2@sculptlab.com",
      password: "password2",
    },
  ];

  for (const admin of admins) {
    const normalizedEmail = admin.email
      .toLowerCase()
      .trim();

    const hashedPassword = await hashPassword(
      admin.password
    );

    const existingUser =
      await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

    if (existingUser) {
      const updatedUser =
        await prisma.user.update({
          where: {
            id: existingUser.id,
          },
          data: {
            fullName: admin.fullName,
            password: hashedPassword,
            provider: AuthProvider.LOCAL,
            role: UserRole.ADMIN,
            isEmailVerified: true,
          },
        });

      console.log(
        `Updated admin: ${updatedUser.email}`
      );

      continue;
    }

    const user =
      await prisma.user.create({
        data: {
          fullName: admin.fullName,
          email: normalizedEmail,
          password: hashedPassword,
          provider: AuthProvider.LOCAL,
          role: UserRole.ADMIN,
          isEmailVerified: true,
        },
      });

    console.log(
      `Created admin: ${user.email}`
    );
  }
}

main()
  .catch((error) => {
    console.error(
      "Failed to create admins:",
      error
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });