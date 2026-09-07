export interface VerifyActivationDto {
  membershipNumber: string;
  activationToken: string;
}

export interface CompleteActivationDto {
  membershipNumber: string;
  activationToken: string;
  fullName: string;
  phone?: string;
  password: string;
}

export interface ActivationResponse {
  membershipNumber: string;
  email: string;
  membershipName: string;
}