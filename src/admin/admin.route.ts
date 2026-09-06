import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import requireAdmin from "../middleware/requireAdmin.js";
import { adminController } from "./admin.controller.js";

const router = Router();

router.get(
  "/payments/pending",
  authenticate,
  requireAdmin,
  adminController.getPendingOfflinePayments
);

export default router;