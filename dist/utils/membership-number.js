import crypto from "crypto";
export function generateMembershipNumber() {
    const year = new Date().getFullYear();
    const randomNumber = crypto.randomInt(100000, 999999);
    return `SL-${year}-${randomNumber}`;
}
//# sourceMappingURL=membership-number.js.map