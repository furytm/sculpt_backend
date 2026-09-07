import { Router } from "express";
import { membershipActivationController } from "./membership-activation.controller.js";
const router = Router();
router.post("/verify", membershipActivationController.verify);
router.post("/complete", membershipActivationController.complete);
export default router;
//# sourceMappingURL=membership-activation.route.js.map