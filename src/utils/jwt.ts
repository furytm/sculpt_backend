import jwt from "jsonwebtoken";
import { JwtPayload } from "../auth/auth.types.js";

function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    throw new Error(
      "JWT_ACCESS_SECRET is not configured."
    );
  }

  return secret;
}

function getRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;

  if (!secret) {
    throw new Error(
      "JWT_REFRESH_SECRET is not configured."
    );
  }

  return secret;
}

export function generateAccessToken(
  payload: JwtPayload
): string {
  return jwt.sign(
    payload,
    getAccessSecret(),
    {
      expiresIn: "15m",
    }
  );
}

export function generateRefreshToken(
  payload: JwtPayload
): string {
  return jwt.sign(
    payload,
    getRefreshSecret(),
    {
      expiresIn: "30d",
    }
  );
}

export function verifyAccessToken(
  token: string
): JwtPayload {
  return jwt.verify(
    token,
    getAccessSecret()
  ) as JwtPayload;
}

export function verifyRefreshToken(
  token: string
): JwtPayload {
  return jwt.verify(
    token,
    getRefreshSecret()
  ) as JwtPayload;
}