export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
};

export type AuthPayload = {
  user: AuthUser;
};
