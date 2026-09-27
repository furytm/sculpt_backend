import PDFDocument from "pdfkit";

type ReceiptData = {
  fullName: string;
  email: string;
  reference: string;
  amount: number;
  paymentDate: Date;
  paymentMethod: string;
  item: string;
  paymentStatus: string;
};

type VoucherData = {
  fullName: string;
  email: string;
  bookingReference: string;
  className: string;
  instructor: string;
  sessionDate: Date;
  startTime: string;
  endTime: string;
  membershipName: string;
  bookingStatus: string;
};

class BookingPdfService {
  private formatCurrency(amount: number) {
    return `₦${amount.toLocaleString("en-NG")}`;
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat(
      "en-NG",
      {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "Africa/Lagos",
      }
    ).format(date);
  }

  async generateReceipt(
    data: ReceiptData
  ): Promise<Buffer> {
    return new Promise(
      (resolve, reject) => {
        const doc =
          new PDFDocument({
            size: "A4",
            margin: 50,
          });

        const chunks: Buffer[] = [];

        doc.on("data", (chunk) => {
          chunks.push(chunk);
        });

        doc.on("end", () => {
          resolve(
            Buffer.concat(chunks)
          );
        });

        doc.on("error", reject);

        doc
          .fontSize(24)
          .font("Helvetica-Bold")
          .text("SCULPT LAB");

        doc
          .moveDown()
          .fontSize(18)
          .text("Payment Receipt");

        doc.moveDown();

        doc
          .fontSize(11)
          .font("Helvetica")
          .text(
            `Customer: ${data.fullName}`
          );

        doc.text(
          `Email: ${data.email}`
        );

        doc.moveDown();

        doc
          .font("Helvetica-Bold")
          .text("Payment Details");

        doc
          .font("Helvetica")
          .moveDown(0.5)
          .text(
            `Transaction Reference: ${data.reference}`
          )
          .text(
            `Amount: ${this.formatCurrency(
              data.amount
            )}`
          )
          .text(
            `Payment Date: ${this.formatDate(
              data.paymentDate
            )}`
          )
          .text(
            `Payment Method: ${data.paymentMethod}`
          )
          .text(
            `Item: ${data.item}`
          )
          .text(
            `Payment Status: ${data.paymentStatus}`
          );

        doc.moveDown();

        doc
          .fontSize(10)
          .fillColor("#666666")
          .text(
            "Thank you for choosing Sculpt LAB."
          );

        doc.end();
      }
    );
  }

  async generateVoucher(
    data: VoucherData
  ): Promise<Buffer> {
    return new Promise(
      (resolve, reject) => {
        const doc =
          new PDFDocument({
            size: "A4",
            margin: 50,
          });

        const chunks: Buffer[] = [];

        doc.on("data", (chunk) => {
          chunks.push(chunk);
        });

        doc.on("end", () => {
          resolve(
            Buffer.concat(chunks)
          );
        });

        doc.on("error", reject);

        doc
          .fontSize(24)
          .font("Helvetica-Bold")
          .text("SCULPT LAB");

        doc
          .moveDown()
          .fontSize(18)
          .text("Booking Voucher");

        doc.moveDown();

        doc
          .fontSize(11)
          .font("Helvetica")
          .text(
            `Member: ${data.fullName}`
          )
          .text(
            `Email: ${data.email}`
          );

        doc.moveDown();

        doc
          .font("Helvetica-Bold")
          .text("Session Details");

        doc
          .font("Helvetica")
          .moveDown(0.5)
          .text(
            `Class: ${data.className}`
          )
          .text(
            `Instructor: ${data.instructor}`
          )
          .text(
            `Date: ${new Intl.DateTimeFormat(
              "en-NG",
              {
                dateStyle: "long",
                timeZone: "Africa/Lagos",
              }
            ).format(data.sessionDate)}`
          )
          .text(
            `Time: ${data.startTime} - ${data.endTime}`
          )
          .text(
            `Membership: ${data.membershipName}`
          );

        doc.moveDown();

        doc
          .font("Helvetica-Bold")
          .text("Booking Details");

        doc
          .font("Helvetica")
          .moveDown(0.5)
          .text(
            `Booking Reference: ${data.bookingReference}`
          )
          .text(
            `Status: ${data.bookingStatus}`
          );

        doc.moveDown();

        doc
          .fontSize(10)
          .fillColor("#666666")
          .text(
            "Please keep this voucher for your records."
          );

        doc.end();
      }
    );
  }
}

export const bookingPdfService =
  new BookingPdfService();