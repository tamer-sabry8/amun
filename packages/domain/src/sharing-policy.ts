export function sharingGate(input: {
  destination: "pi" | "notion";
  connected: boolean;
  parentSelected: boolean;
  parentId?: string;
  reviewedParentId?: string;
  contentHash: string;
  reviewedHash?: string;
}): { allowed: boolean; reason: string } {
  if (input.destination !== "notion")
    return {
      allowed: false,
      reason:
        "Pi sharing is disabled. Use Share to Notion; no gist or Radius fallback is allowed.",
    };
  if (!input.connected)
    return { allowed: false, reason: "Connect Notion in Amun before sharing." };
  if (
    !input.parentSelected ||
    !input.parentId ||
    !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(
      input.parentId,
    )
  )
    return {
      allowed: false,
      reason: "Choose the Notion parent section before sharing.",
    };
  if (
    !/^[a-f0-9]{64}$/.test(input.contentHash) ||
    input.reviewedHash !== input.contentHash ||
    input.reviewedParentId !== input.parentId
  )
    return {
      allowed: false,
      reason: "Review the exact redacted content before publishing.",
    };
  return {
    allowed: true,
    reason: "Ready for the approved Notion publication.",
  };
}
