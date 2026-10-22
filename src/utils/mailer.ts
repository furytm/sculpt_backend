import { Resend } from "resend";

const resend = new Resend(
  process.env.RESEND_API_KEY
);


interface PaymentConfirmationEmailData {
  email: string;
  fullName: string;
  bookingReference: string;
  registrationUrl: string;
  loginUrl: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}

export async function sendPaymentConfirmationEmail({
  email,
  fullName,
  bookingReference,
  registrationUrl,
  loginUrl,
}: PaymentConfirmationEmailData) {
  const safeName = escapeHtml(fullName);
  const safeReference = escapeHtml(bookingReference);
  const safeRegistrationUrl = escapeHtml(registrationUrl);
  const safeLoginUrl = escapeHtml(loginUrl);

  const { error } = await resend.emails.send({
   from: "Sculpt LAB <enquiriess@sculptlab.com.ng>",
    to: email,
    subject: "Your Sculpt LAB payment confirmation",
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.7;color:#222;">
        <h2>Payment received, ${safeName}!</h2>

        <p>Your payment for Sculpt LAB has been confirmed.</p>

        <p>
          <strong>Booking reference:</strong>
          ${safeReference}
        </p>

        <p>
          Create an account or log in to continue your booking.
          If you have already registered, you do not need to create
          another account.
        </p>

        <p>
          <a href="${safeRegistrationUrl}"
             style="display:inline-block;padding:12px 20px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">
            Create Your Account
          </a>
        </p>

        <p>
          <a href="${safeLoginUrl}"
             style="color:#000;text-decoration:underline;">
            Already registered? Log in
          </a>
        </p>

        <p>
          If you have forgotten your password, use the Forgot Password
          option on the login page.
        </p>

        <p>
          Your payment is confirmed. Complete the account and booking
          steps to finish activating your membership.
        </p>

        <p>Sculpt LAB</p>
      </div>
    `,
  });

  if (error) {
    console.error("Payment confirmation email error:", error);
    throw new Error("Unable to send payment confirmation email.");
  }
}


export async function sendPasswordResetEmail(
  email: string,
  fullName: string,
  resetUrl: string
) {
  const { error } = await resend.emails.send({
    from: "Sculpt Lab <onboarding@resend.dev>",
    to: email,
    subject: "Reset your Sculpt Lab password",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Password Reset</h2>

        <p>Hello ${fullName},</p>

        <p>
          We received a request to reset your Sculpt Lab password.
        </p>

        <p>
          <a
            href="${resetUrl}"
            style="
              display:inline-block;
              padding:12px 20px;
              background:#000;
              color:#fff;
              text-decoration:none;
              border-radius:6px;
            "
          >
            Reset Password
          </a>
        </p>

        <p>
          This link will expire in 15 minutes.
        </p>

        <p>
          If you did not request this reset, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error("Password reset email error:", error);
    throw new Error("Unable to send password reset email.");
  }
}


export async function sendVerificationEmail(
  email: string,
  fullName: string,
  verificationUrl: string
) {
  const safeName = escapeHtml(fullName);
  const safeUrl = escapeHtml(verificationUrl);

  const { error } = await resend.emails.send({
    from: "Sculpt LAB <enquiriess@sculptlab.com.ng>",
    to: email,
    subject: "Complete your Sculpt LAB registration",
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.7;color:#222;max-width:600px;margin:auto;">
        <h2>Welcome to Sculpt LAB, ${safeName}!</h2>

        <p>Thank you for completing your registration form.</p>

        <p>Click below to verify your email address and complete your registration.</p>

        <p>
          <a href="${safeUrl}"
             style="display:inline-block;padding:12px 20px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">
            Verify My Email
          </a>
        </p>

        <p>This link expires after one hour.</p>

        <p>If you have already completed registration, you can ignore this email and proceed to login.</p>

        <p>Sculpt LAB</p>
      </div>
    `,
  });

  if (error) {
    console.error("Verification email error:", error);
    throw new Error("Unable to send verification email.");
  }
}
