import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import requireMember from "../middleware/requireMember.js";
import { healthSafetyController } from "./health-safety.controller.js";

/**
 * Member self-service Health & Safety, mounted at /api/members.
 * MEMBER accounts only; the member comes from the token.
 */
const router = Router();

router.get("/me/health-safety", authenticate, requireMember, healthSafetyController.getMine);
router.patch("/me/health-safety", authenticate, requireMember, healthSafetyController.updateMine);

export default router;
