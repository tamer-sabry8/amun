/** Public deployment preflight. Only an actual web authorization can prove success. */
const callback = "https://amun.transfrm.ai/mcp/callback";
async function rejectionProbe(url: URL) {
  const response = await fetch(url, {
    redirect: "manual",
    credentials: "omit",
    signal: AbortSignal.timeout(8000),
  });
  await response.body?.cancel();
  return (
    [400, 401, 403].includes(response.status) &&
    /(?:^|,|\s)no-store(?:$|,|\s)/i.test(
      response.headers.get("cache-control") ?? "",
    )
  );
}
try {
  const invalid = new URL(callback);
  invalid.searchParams.set("state", "amun-invalid-acceptance-state");
  invalid.searchParams.set("code", "amun-invalid-acceptance-code");
  if (
    !(await rejectionProbe(new URL(callback))) ||
    !(await rejectionProbe(invalid))
  )
    throw Error();
  console.log(
    "HTTPS callback rejected both invalid requests with no-store. Valid authorization still requires a packaged web-flow test.",
  );
} catch {
  console.error(
    "Callback preflight incomplete. Check DNS, TLS, exact route, rejection status and Cache-Control. No valid OAuth code was sent.",
  );
  process.exitCode = 1;
}
