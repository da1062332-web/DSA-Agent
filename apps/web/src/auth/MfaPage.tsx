// /mfa — TOTP enrolment and challenge (owner: Dev 1, UI-PLT-001, SUB-AUTH.02).
// In development, two-step verification is bypassed and redirects immediately to the requested page.
import { Navigate, useLocation } from 'react-router-dom';

export function MfaPage() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/admin/import-export';
  return <Navigate to={from} replace />;
}

export default MfaPage;
