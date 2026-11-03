// Whether this deployment asks for a second factor (owner: Dev 1). The web app reads it before sign-in, so a sign-in screen never asks for
// a code that the API will not check. It answers from the same function the API's own enforcement uses (mfa-switch.ts).
import express, { type Router } from 'express';
import { secondFactorSkipped } from './mfa-switch';

export function createAuthConfigRouter(): Router {
  const router = express.Router();

  // GET /public/v1/auth/config — the second-factor setting only. Nothing about the project, the user or a token is returned.
  router.get('/auth/config', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ mfaEnabled: !secondFactorSkipped() });
  });

  return router;
}
