import { adoCredential } from "../packages/connectors-ado/src/keychain.ts";
import { AdoProofClient } from "../packages/connectors-ado/src/client.ts";
import { azureTransport } from "../packages/connectors-ado/src/transport.ts";
try {
  const pat = await adoCredential().getPassword();
  if (!pat) throw new Error("missing_keychain_credential");
  const base = "https://devops.tahaluf.ae/TahalufCollection/";
  const client = new AdoProofClient(base, "ICV", azureTransport(base, pat));
  for (const endpoint of [
    "projects",
    "project",
    "teams",
    "processes",
    "types",
    "iterations",
    "pullRequests",
  ]) {
    const data = await client.read(endpoint);
    const record =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const value = Array.isArray(record.value) ? record.value : [];
    // Emit bounded, non-secret identifiers needed to choose the test record type/team. No work-item text.
    console.log(
      JSON.stringify({
        endpoint,
        success: true,
        id: typeof record.id === "string" ? record.id : undefined,
        name: typeof record.name === "string" ? record.name : undefined,
        items: (["teams", "types"].includes(endpoint) ? value : [])
          .slice(0, 100)
          .map((x: Record<string, unknown>) => ({ id: x.id, name: x.name })),
        count: value.length,
      }),
    );
  }
} catch (error) {
  console.error(
    error instanceof Error &&
      /^(missing_keychain_credential|read_failed|request_rejected_\d+)$/.test(
        error.message,
      )
      ? error.message
      : "Azure read proof failed; details withheld",
  );
  process.exitCode = 1;
}
