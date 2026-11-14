export async function cleanupFailedUpload(providerCleanup: (() => Promise<void>) | null, sessionCleanup: () => Promise<void>) {
  if (providerCleanup) await providerCleanup().catch(() => undefined)
  await sessionCleanup()
}
