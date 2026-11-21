export function scheduleBlockerChecks(check: () => Promise<void>, failed: (error: unknown) => void) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await check();
    } catch (error) {
      failed(error);
    } finally {
      running = false;
    }
  }, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
