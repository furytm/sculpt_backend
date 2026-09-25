import { Router } from "express";
import membershipController from "./membership.controller.js";
const router = Router();
console.log("membership.route.ts loaded");
/**
 * @openapi
 * /api/memberships/test:
 *   get:
 *     tags:
 *       - Membership
 *     summary: Test membership routes
 *     description: Checks whether the membership routes are working.
 *     responses:
 *       200:
 *         description: Membership routes are working
 */
router.get("/test", (req, res) => {
    res.send("Membership routes working");
});
/**
 * @openapi
 * /api/memberships:
 *   get:
 *     tags:
 *       - Membership
 *     summary: Get all memberships
 *     description: Returns all available membership plans.
 *     responses:
 *       200:
 *         description: Memberships returned successfully
 *       500:
 *         description: Failed to retrieve memberships
 */
router.get("/", membershipController.getMemberships);
/**
 * @openapi
 * /api/memberships/{id}:
 *   get:
 *     tags:
 *       - Membership
 *     summary: Get membership by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Membership ID
 *         example: single-class
 *     responses:
 *       200:
 *         description: Membership returned successfully
 *       404:
 *         description: Membership not found
 */
router.get("/:id", membershipController.getMembership);
/**
 * @openapi
 * /api/memberships:
 *   post:
 *     tags:
 *       - Membership
 *     summary: Create a membership
 *     description: Creates a new membership plan.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - price
 *             properties:
 *               name:
 *                 type: string
 *                 example: Monthly 5 Classes
 *               price:
 *                 type: number
 *                 example: 90000
 *               classLimit:
 *                 type: integer
 *                 nullable: true
 *                 example: 5
 *               duration:
 *                 type: string
 *                 example: Monthly
 *               description:
 *                 type: string
 *                 example: 5 classes per month
 *     responses:
 *       201:
 *         description: Membership created successfully
 *       400:
 *         description: Invalid membership data
 */
router.post("/", membershipController.createMembership);
/**
 * @openapi
 * /api/memberships/{id}:
 *   patch:
 *     tags:
 *       - Membership
 *     summary: Update a membership
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Membership ID
 *         example: single-class
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Monthly 10 Classes
 *               price:
 *                 type: number
 *                 example: 150000
 *               classLimit:
 *                 type: integer
 *                 nullable: true
 *                 example: 10
 *               duration:
 *                 type: string
 *                 example: Monthly
 *               description:
 *                 type: string
 *                 example: 10 classes per month
 *     responses:
 *       200:
 *         description: Membership updated successfully
 *       400:
 *         description: Invalid membership data
 *       404:
 *         description: Membership not found
 */
router.patch("/:id", membershipController.updateMembership);
/**
 * @openapi
 * /api/memberships/{id}:
 *   delete:
 *     tags:
 *       - Membership
 *     summary: Delete a membership
 *     description: Soft deletes a membership plan.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Membership ID
 *         example: single-class
 *     responses:
 *       200:
 *         description: Membership deleted successfully
 *       404:
 *         description: Membership not found
 */
router.delete("/:id", membershipController.deleteMembership);
export default router;
//# sourceMappingURL=membership.route.js.map