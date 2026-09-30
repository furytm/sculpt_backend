export interface VerifyActivationDto {
  membershipNumber: string;
  activationToken: string;
}

export interface CompleteActivationDto {
  membershipNumber: string;
  activationToken: string;
  password: string;
  fullName?: string;
  email?: string;
  phone?: string;
}

export interface ActivationResponse {
  membershipNumber: string;
  email: string;
  membershipName: string;
}