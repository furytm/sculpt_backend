import { JwtPayload } from "../auth/auth.types.js";

declare global {
  namespace Express {
    interface Request {
      user: JwtPayload;
    }
  }
}

export {};