import { Amplify } from "aws-amplify";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import backend from "./backend.json";
import { App } from "./App.tsx";
import "./styles.css";

// Outputs of the localtaste CDK stack (written by scripts/deploy-web.sh).
// Visitors get a guest identity; every API call is IAM-signed with it.
Amplify.configure({
  Auth: { Cognito: { identityPoolId: backend.IdentityPoolId, allowGuestAccess: true } },
  API: { GraphQL: { endpoint: backend.ApiUrl, region: backend.Region, defaultAuthMode: "iam" } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
