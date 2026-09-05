console.log("membership.route.ts loaded");
import { Router } from "express";
import membershipController from "./membership.controller.js";
const router = Router();
router.get("/test", (req, res) => {
    res.send("Membership routes working");
});
// GET all memberships
router.get("/", membershipController.getMemberships);
// GET membership by ID
router.get("/:id", membershipController.getMembership);
// CREATE membership
router.post("/", membershipController.createMembership);
// UPDATE membership
router.patch("/:id", membershipController.updateMembership);
// SOFT DELETE membership
router.delete("/:id", membershipController.deleteMembership);
export default router;
//# sourceMappingURL=membership.route.js.map