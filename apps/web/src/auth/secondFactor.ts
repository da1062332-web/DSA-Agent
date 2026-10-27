// Which second-factor step an account needs. An account with a verified authenticator gets the code prompt. Any other account gets the set-up,
// and a set-up that replaces an authenticator (resetExisting) starts with the set-up too, so the old one stays until the new one is verified.
export type SecondFactorPlan = { mode: 'challenge'; factorId: string } | { mode: 'enrol' };

export function secondFactorPlan(
  totpFactors: { id: string; status: string }[] | null | undefined,
  resetExisting = false,
): SecondFactorPlan {
  const verified = (totpFactors ?? []).find((f) => f.status === 'verified');
  if (verified && !resetExisting) return { mode: 'challenge', factorId: verified.id };
  return { mode: 'enrol' };
}
