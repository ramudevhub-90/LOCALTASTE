import { defineAuth } from "@aws-amplify/backend";

// Café owners sign in with email. Judges and first-time visitors use the
// identity pool's guest (unauthenticated) access, so there is no sign-up wall.
export const auth = defineAuth({
  loginWith: { email: true },
});
