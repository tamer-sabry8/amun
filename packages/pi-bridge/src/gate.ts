export const bridgeTools = {
  amun_get_context: "Read the current Amun workspace context",
  amun_propose_backlog_publication: "Request review of a backlog publication",
  amun_propose_sprint_commitment: "Request review of a sprint commitment",
  amun_request_merge: "Request review of a merge",
  amun_raise_decision: "Raise a decision for the product owner",
  amun_report_blocker: "Report a blocker to the product owner",
} as const;

export async function gateTool(
  event: { toolName: string; parentToolCallId?: string },
  propose: (name: string, nested: boolean) => Promise<string>,
) {
  try {
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(event.toolName)) throw Error();
    const id = await propose(
      event.toolName,
      event.parentToolCallId !== undefined,
    );
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))
      throw Error();
    return { block: true as const, reason: "Pending Amun review: " + id };
  } catch {
    return {
      block: true as const,
      reason: "Amun could not record this request.",
    };
  }
}
