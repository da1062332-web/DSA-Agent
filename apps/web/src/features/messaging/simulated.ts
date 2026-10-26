// Messages sent by the simulated provider (test only) are never delivered to a real customer. The provider name says so.
export const SIMULATED_PROVIDER_PREFIX = 'DEV_SIMULATED';

export const isSimulatedProvider = (provider: string | null | undefined): boolean =>
  (provider ?? '').startsWith(SIMULATED_PROVIDER_PREFIX);
