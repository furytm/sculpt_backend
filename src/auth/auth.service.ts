import {
  AuthProvider,
  UserRole,
} from "@prisma/client";

import prisma from "../config/prisma.js";

import {
  RegisterDto,
  LoginDto,
  JwtPayload,
} from "./auth.types.js";

import {
  hashPassword,
  comparePassword,
} from "../utils/bcrypt.js";

import crypto from "crypto";



import googleClient from "../config/google.js";

import {
  generateSecureToken,
  hashToken,
} from "../utils/auth-token.js";

import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../utils/mailer.js";

import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt.js";

class AuthService {
  /**
   * Register
   */
async register(data: RegisterDto) {
  const {
    fullName,
    email,
    password,
    phone,
  } = data;

  const normalizedEmail =
    email.toLowerCase().trim();

  // Check existing account
  const existingUser =
    await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

  if (existingUser) {
    throw new Error(
      "An account with this email already exists."
    );
  }

  // Hash password
  const hashedPassword =
    await hashPassword(password);

  // Create user
  const user =
    await prisma.user.create({
      data: {
        fullName,
        email: normalizedEmail,
        password: hashedPassword,
        phone: phone || null,
        provider: AuthProvider.LOCAL,
        role: UserRole.MEMBER,
      },
    });

// Link previous guest bookings using the same email
await prisma.booking.updateMany({
  where: {
    email: normalizedEmail,
    userId: null,
  },
  data: {
    userId: user.id,
  },
});

// ==========================================
// CREATE ACTIVE MEMBERSHIP FROM PAID BOOKING
// ==========================================

const paidBooking = await prisma.booking.findFirst({
  where: {
    email: normalizedEmail,
    userId: user.id,
    paymentStatus: PaymentStatus.PAID,
  },
  include: {
    membership: true,
  },
  orderBy: {
    createdAt: "desc",
  },
});

if (paidBooking) {
  await prisma.memberMembership.create({
    data: {
      userId: user.id,
      membershipId: paidBooking.membershipId,
      bookingId: paidBooking.id,
      status: "ACTIVE",
      startDate: null,
      expiryDate: null,
    },
  });
}

  
  // ==========================================
  // CREATE EMAIL VERIFICATION TOKEN
  // ==========================================

  const verificationToken =
    generateSecureToken();

  const verificationTokenHash =
    hashToken(verificationToken);

  await prisma.emailVerificationToken.create({
    data: {
      tokenHash: verificationTokenHash,
      userId: user.id,
      expiresAt: new Date(
        Date.now() +
          60 * 60 * 1000
      ),
    },
  });

  const verificationUrl =
    `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

try {
  await sendVerificationEmail(
    user.email,
    user.fullName,
    verificationUrl
  );
} catch (emailError) {
  console.error(
    "Verification email could not be sent:",
    emailError
  );

  // Do not fail registration if email delivery fails.
};

  // ==========================================
  // GENERATE JWT TOKENS
  // ==========================================

  const payload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken =
    generateAccessToken(payload);

  const refreshToken =
    generateRefreshToken(payload);

  // Save refresh token
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(
        Date.now() +
          1000 *
            60 *
            60 *
            24 *
            30
      ),
    },
  });

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      provider: user.provider,
      role: user.role,
      isEmailVerified:
        user.isEmailVerified,
    },
    accessToken,
    refreshToken,
  };
}
  /**
   * Login
   */
  async login(data: LoginDto) {
    const normalizedEmail =
      data.email.toLowerCase().trim();

    const user =
      await prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
      });

    if (!user) {
      throw new Error(
        "Invalid email or password."
      );
    }

    // Google account cannot use password login
    if (
      user.provider === AuthProvider.GOOGLE &&
      !user.password
    ) {
      throw new Error(
        "This account was created with Google. Please continue with Google."
      );
    }

    if (!user.password) {
      throw new Error(
        "Invalid email or password."
      );
    }

    const passwordMatches =
      await comparePassword(
        data.password,
        user.password
      );

    if (!passwordMatches) {
      throw new Error(
        "Invalid email or password."
      );
    }

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken =
      generateAccessToken(payload);

    const refreshToken =
      generateRefreshToken(payload);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(
          Date.now() +
            1000 *
              60 *
              60 *
              24 *
              30
        ),
      },
    });

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        provider: user.provider,
        role: user.role,
        isEmailVerified:
          user.isEmailVerified,
      },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refresh Access Token
   */
  async refreshToken(
    refreshToken: string
  ) {
    if (!refreshToken) {
      throw new Error(
        "Refresh token is required."
      );
    }

    // Check token exists in database
    const storedToken =
      await prisma.refreshToken.findUnique({
        where: {
          token: refreshToken,
        },
        include: {
          user: true,
        },
      });

    if (!storedToken) {
      throw new Error(
        "Invalid refresh token."
      );
    }

    // Check expiration
    if (
      storedToken.expiresAt.getTime() <
      Date.now()
    ) {
      await prisma.refreshToken.delete({
        where: {
          id: storedToken.id,
        },
      });

      throw new Error(
        "Refresh token has expired."
      );
    }

    // Verify JWT signature
    let payload: JwtPayload;

    try {
      payload =
        verifyRefreshToken(refreshToken);
    } catch {
      await prisma.refreshToken.delete({
        where: {
          id: storedToken.id,
        },
      });

      throw new Error(
        "Invalid refresh token."
      );
    }

    // Make sure token belongs to same user
    if (
      payload.userId !== storedToken.userId
    ) {
      throw new Error(
        "Invalid refresh token."
      );
    }

    const user = storedToken.user;

    const newPayload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const newAccessToken =
      generateAccessToken(
        newPayload
      );

    // Rotate refresh token
    const newRefreshToken =
      generateRefreshToken(
        newPayload
      );

    await prisma.$transaction([
      prisma.refreshToken.delete({
        where: {
          id: storedToken.id,
        },
      }),

      prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: user.id,
          expiresAt: new Date(
            Date.now() +
              1000 *
                60 *
                60 *
                24 *
                30
          ),
        },
      }),
    ]);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Logout
   */
  async logout(
    refreshToken: string
  ) {
    if (!refreshToken) {
      throw new Error(
        "Refresh token is required."
      );
    }

    await prisma.refreshToken.deleteMany({
      where: {
        token: refreshToken,
      },
    });

    return {
      success: true,
    };
  }

  /**
   * Current User
   */
  async getCurrentUser(
    userId: string
  ) {
    const user =
      await prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          provider: true,
          role: true,
          isEmailVerified: true,
          avatar: true,
          createdAt: true,
          updatedAt: true,
        },
      });

    if (!user) {
      throw new Error(
        "User not found."
      );
    }

    return user;
  }

  async getGoogleAuthUrl() {
  const url = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: [
      "openid",
      "email",
      "profile",
    ],
    prompt: "select_account",
  });

  return url;
}

async googleCallback(code: string) {
  if (!code) {
    throw new Error("Google authorization code is required.");
  }

  const { tokens } = await googleClient.getToken(code);

  if (!tokens.id_token) {
    throw new Error("Google authentication failed.");
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();

  if (!payload) {
    throw new Error("Unable to verify Google identity.");
  }

  const googleEmail = payload.email;

  if (!googleEmail || payload.email_verified !== true) {
    throw new Error(
      "Google email could not be verified."
    );
  }

  const normalizedEmail =
    googleEmail.toLowerCase().trim();

  const existingUser =
    await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

  let user;

  if (existingUser) {
    /*
     * Do not silently convert an existing LOCAL
     * account into a GOOGLE account.
     */
    if (
      existingUser.provider === AuthProvider.LOCAL
    ) {
      throw new Error(
        "LOCAL_ACCOUNT_EXISTS"
      );
    }

    user = existingUser;
  } else {
    user = await prisma.user.create({
      data: {
        fullName:
          payload.name ||
          normalizedEmail.split("@")[0],

        email: normalizedEmail,

        password: null,

        phone: null,

        provider: AuthProvider.GOOGLE,

        role: UserRole.MEMBER,

        isEmailVerified: true,

        avatar: payload.picture || null,
      },
    });
  }

  /*
   * Link guest bookings only when the
   * verified Google email matches.
   */
  await prisma.booking.updateMany({
    where: {
      email: normalizedEmail,
      userId: null,
    },
    data: {
      userId: user.id,
    },
  });

  const jwtPayload: JwtPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken =
    generateAccessToken(jwtPayload);

  const refreshToken =
    generateRefreshToken(jwtPayload);

  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(
        Date.now() +
          1000 *
            60 *
            60 *
            24 *
            30
      ),
    },
  });

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      provider: user.provider,
      role: user.role,
      isEmailVerified:
        user.isEmailVerified,
      avatar: user.avatar,
    },

    accessToken,
    refreshToken,
  };
}

async sendVerificationEmailForUser(
  userId: string
) {
  const user =
    await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

  if (!user) {
    throw new Error("User not found.");
  }

  if (user.isEmailVerified) {
    return {
      success: true,
      message: "Email is already verified.",
    };
  }

  /*
   * Delete old verification tokens.
   */
  await prisma.emailVerificationToken.deleteMany({
    where: {
      userId: user.id,
    },
  });

  const token =
    generateSecureToken();

  const tokenHash =
    hashToken(token);

  const expiresAt =
    new Date(
      Date.now() +
        60 * 60 * 1000
    );

  await prisma.emailVerificationToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt,
    },
  });

  const verificationUrl =
    `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
console.log("📧 About to send verification email:", user.email);
  await sendVerificationEmail(
    user.email,
    user.fullName,
    verificationUrl
  );
  console.log("✅ Verification email sent successfully");

  return {
    success: true,
    message:
      "Verification email sent successfully.",
  };
}

async verifyEmail(token: string) {
  if (!token) {
    throw new Error(
      "Verification token is required."
    );
  }

  const tokenHash =
    hashToken(token);

  const storedToken =
    await prisma.emailVerificationToken.findUnique({
      where: {
        tokenHash,
      },
      include: {
        user: true,
      },
    });

  if (!storedToken) {
    throw new Error(
      "Invalid verification token."
    );
  }

  if (
    storedToken.expiresAt.getTime() <
    Date.now()
  ) {
    await prisma.emailVerificationToken.delete({
      where: {
        id: storedToken.id,
      },
    });

    throw new Error(
      "Verification token has expired."
    );
  }

  if (storedToken.user.isEmailVerified) {
    await prisma.emailVerificationToken.delete({
      where: {
        id: storedToken.id,
      },
    });

    return {
      success: true,
      message: "Email is already verified.",
    };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: storedToken.userId,
      },
      data: {
        isEmailVerified: true,
      },
    }),

    prisma.emailVerificationToken.delete({
      where: {
        id: storedToken.id,
      },
    }),
  ]);

  return {
    success: true,
    message:
      "Email verified successfully.",
  };
}


async forgotPassword(
  email: string
) {
  const normalizedEmail =
    email.toLowerCase().trim();

  const user =
    await prisma.user.findUnique({
      where: {
        email: normalizedEmail,
      },
    });

  /*
   * Always return the same response.
   * This prevents account enumeration.
   */
  if (!user) {
    return {
      success: true,
      message:
        "If an account exists with this email, a password reset link has been sent.",
    };
  }

  /*
   * Google-only account.
   */
  if (
    user.provider === AuthProvider.GOOGLE &&
    !user.password
  ) {
    return {
      success: true,
      message:
        "If an account exists with this email, a password reset link has been sent.",
    };
  }

  /*
   * Delete previous reset tokens.
   */
  await prisma.passwordResetToken.deleteMany({
    where: {
      userId: user.id,
    },
  });

  const token =
    generateSecureToken();

  const tokenHash =
    hashToken(token);

  const expiresAt =
    new Date(
      Date.now() +
        60 * 60 * 1000
    );

  await prisma.passwordResetToken.create({
    data: {
      tokenHash,
      userId: user.id,
      expiresAt,
    },
  });

  const resetUrl =
    `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  await sendPasswordResetEmail(
    user.email,
    user.fullName,
    resetUrl
  );

  return {
    success: true,
    message:
      "If an account exists with this email, a password reset link has been sent.",
  };
}

async resetPassword(
  token: string,
  password: string,
  confirmPassword: string
) {
  if (!token) {
    throw new Error(
      "Reset token is required."
    );
  }

  if (!password || !confirmPassword) {
    throw new Error(
      "Password and confirm password are required."
    );
  }

  if (password !== confirmPassword) {
    throw new Error(
      "Passwords do not match."
    );
  }

  if (password.length < 8) {
    throw new Error(
      "Password must be at least 8 characters."
    );
  }

  const tokenHash =
    hashToken(token);

  const storedToken =
    await prisma.passwordResetToken.findUnique({
      where: {
        tokenHash,
      },
      include: {
        user: true,
      },
    });

  if (!storedToken) {
    throw new Error(
      "Invalid or expired reset token."
    );
  }

  if (
    storedToken.expiresAt.getTime() <
    Date.now()
  ) {
    await prisma.passwordResetToken.delete({
      where: {
        id: storedToken.id,
      },
    });

    throw new Error(
      "Invalid or expired reset token."
    );
  }

  const hashedPassword =
    await hashPassword(password);

  await prisma.$transaction([
    prisma.user.update({
      where: {
        id: storedToken.userId,
      },
      data: {
        password: hashedPassword,
        provider: AuthProvider.LOCAL,
      },
    }),

    prisma.passwordResetToken.delete({
      where: {
        id: storedToken.id,
      },
    }),

    /*
     * Revoke all existing refresh tokens.
     */
    prisma.refreshToken.deleteMany({
      where: {
        userId: storedToken.userId,
      },
    }),
  ]);

  return {
    success: true,
    message:
      "Password reset successfully. Please login again.",
  };
}

}

export default new AuthService();