import { Request, Response } from "express";
import adminSessionService from "./admin-session.service.js";

class AdminSessionController {
  async getSessions(req: Request, res: Response) {
    try {
      const { classId, status, fromDate, toDate } = req.query;

      const sessions = await adminSessionService.getSessions({
        classId:
          typeof classId === "string"
            ? classId
            : undefined,

        status:
          typeof status === "string" &&
          ["OPEN", "FULL", "CANCELLED", "COMPLETED"].includes(
            status
          )
            ? status as
                | "OPEN"
                | "FULL"
                | "CANCELLED"
                | "COMPLETED"
            : undefined,

        fromDate:
          typeof fromDate === "string"
            ? new Date(fromDate)
            : undefined,

        toDate:
          typeof toDate === "string"
            ? new Date(toDate)
            : undefined,
      });

      return res.status(200).json({
        success: true,
        data: sessions,
      });
    } catch (error: any) {
      console.error(
        "Get admin sessions error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Failed to fetch class sessions.",
      });
    }
  }

  async getSession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "Session ID is required.",
        });
      }

      const session =
        await adminSessionService.getSessionById(
          String(sessionId)
        );

      return res.status(200).json({
        success: true,
        data: session,
      });
    } catch (error: any) {
      console.error(
        "Get admin session error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Failed to fetch class session.",
      });
    }
  }

  async cancelSession(req: Request, res: Response) {
    try {
       const sessionId = String(req.params.sessionId);

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "Session ID is required.",
        });
      }

      const result =
        await adminSessionService.cancelSession(
          sessionId
        );

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error(
        "Cancel admin session error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Failed to cancel class session.",
      });
    }
  }

  async reopenSession(req: Request, res: Response) {
    try {

 const sessionId = String(req.params.sessionId);
      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: "Session ID is required.",
        });
      }

      const result =
        await adminSessionService.reopenSession(
          sessionId
        );

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      console.error(
        "Reopen admin session error:",
        error
      );

      return res.status(400).json({
        success: false,
        message:
          error?.message ||
          "Failed to reopen class session.",
      });
    }
  }
}

export default new AdminSessionController();