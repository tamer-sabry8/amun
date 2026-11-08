import { useState } from "react";
import type { HostingDestination } from "../../../packages/contracts/src/hosting.ts";
export function HostingForm({
  saved,
  save,
  inspect,
}: {
  saved: HostingDestination | null;
  save: (v: HostingDestination) => void;
  inspect: () => void;
}) {
  const [provider, setProvider] = useState<string>(saved?.provider ?? "");
  const [zone, setZone] = useState(
    saved?.provider === "cloudflare" ? saved.zone : "",
  );
  const [host, setHost] = useState(saved?.host ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (provider === "cloudflare") save({ provider, zone, host });
        else if (provider === "other") save({ provider, host });
      }}
    >
      <h3>Workspace hosting</h3>
      <label>
        Hosting provider
        <select
          required
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value="">Choose a provider</option>
          <option value="cloudflare">Cloudflare Code Mode</option>
          <option value="other">Self-managed or another provider</option>
        </select>
      </label>
      {provider === "cloudflare" && (
        <label>
          DNS zone
          <input
            value={zone}
            required
            onChange={(e) => setZone(e.target.value)}
          />
        </label>
      )}
      {provider && (
        <label>
          Publishing hostname
          <input
            value={host}
            required
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
      )}
      <button disabled={!provider}>Save hosting destination</button>
      {saved && <p>Saved destination: {saved.host}</p>}
      {saved?.provider === "cloudflare" &&
        provider === saved.provider &&
        host === saved.host &&
        zone === saved.zone && (
          <button type="button" onClick={inspect}>
            Inspect DNS in Cloudflare
          </button>
        )}
    </form>
  );
}
