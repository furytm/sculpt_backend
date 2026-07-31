import { Request, Response } from "express";
import paymentService from "./payment.service.js";
interface VerifyParams {
  reference: string;
}

class PaymentController {
  async initializePayment(req: Request, res: Response) {
    try {
      const payment = await paymentService.initializeTransaction(req.body);

      res.status(200).json(payment);
    } catch (error) {
      res.status(500).json(error);
    }
  }



async verifyPayment(
  req: Request<VerifyParams>,
  res: Response
) {
  try {
    const payment = await paymentService.verifyTransaction(
      req.params.reference
    );

    return res.status(200).json(payment);
  } catch (error) {
    return res.status(500).json(error);
  }
}

  async webhook(req: Request, res: Response) {
    try {
      const response = await paymentService.handleWebhook(req.body);

      res.status(200).json(response);
    } catch (error) {
      res.status(500).json(error);
    }
  }
}

export default new PaymentController();