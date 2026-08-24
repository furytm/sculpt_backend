import { Response } from "express";

const isProduction =
  process.env.NODE_ENV === "production";


const cookieOptions = {
  httpOnly: true,

  secure: isProduction,

  sameSite: isProduction
    ? ("none" as const)
    : ("lax" as const),

  path: "/",
};

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string
) {
  res.cookie(
    "accessToken",
    accessToken,
    {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000,
    }
  );

  res.cookie(
    "refreshToken",
    refreshToken,
    {
      ...cookieOptions,
      maxAge:
        30 *
        24 *
        60 *
        60 *
        1000,
    }
  );
}

export function clearAuthCookies(
  res: Response
) {
  res.clearCookie(
    "accessToken",
    cookieOptions
  );

  res.clearCookie(
    "refreshToken",
    cookieOptions
  );
}