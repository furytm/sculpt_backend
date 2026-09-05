import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
export async function sendVerificationEmail(email, fullName, verificationUrl) {
    const { error } = await resend.emails.send({
        from: "Sculpt Lab <onboarding@resend.dev>",
        to: email,
        subject: "Verify your Sculpt Lab account",
        html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Welcome to Sculpt Lab, ${fullName}</h2>

        <p>
          Thank you for creating your Sculpt Lab account.
        </p>

        <p>
          Please click the button below to verify your email address.
        </p>

        <p>
          <a
            href="${verificationUrl}"
            style="
              display:inline-block;
              padding:12px 20px;
              background:#000;
              color:#fff;
              text-decoration:none;
              border-radius:6px;
            "
          >
            Verify Email
          </a>
        </p>

        <p>
          This link will expire in 60 minutes.
        </p>

        <p>
          If you did not create this account, you can safely ignore this email.
        </p>
      </div>
    `,
    });
    if (error) {
        console.error("Verification email error:", error);
        throw new Error("Unable to send verification email.");
    }
}
export async function sendPasswordResetEmail(email, fullName, resetUrl) {
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
//# sourceMappingURL=mailer.js.map