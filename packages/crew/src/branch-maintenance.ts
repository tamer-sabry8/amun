import { wakeAcknowledgement } from "./wake-ack.ts";
// The pinned branch executes the returned command in its verified worktree.
// Accept the canonical spelling only, with no shell substitutions or redirects.
export function maintenanceCommand(command: string) {
  const drain = "bin/fm-wake-drain.sh";
  if (command === drain) return drain;
  const ack =
    /^bin\/fm-wake-drain\.sh --ack-through (0|[1-9][0-9]{0,14}) --recovery-generation ([a-zA-Z0-9._-]{1,128})$/.exec(
      command,
    );
  if (!ack || ack[0] !== command)
    throw Error(
      "Unattended action requires captain review. Report it through fm_branch_report.",
    );
  return (
    drain + " --ack-through " + ack[1] + " --recovery-generation " + ack[2]
  );
}

/** Adapt the verified upstream extension before loading it into the owned RPC process. */
export function guardedBranch(source: string) {
  const replaceOnce = (anchor: string, replacement: string) => {
    if (source.split(anchor).length !== 2)
      throw Error("Unrecognized Firstmate branch implementation");
    source = source.replace(anchor, () => replacement);
  };
  replaceOnce(
    'const BRANCH_TOOL_NAMES = ["read", "bash", "fm_branch_report"] as const;',
    'const BRANCH_TOOL_NAMES = ["bash", "fm_branch_report"] as const;',
  );
  replaceOnce(
    "    const loader = new DefaultResourceLoader({",
    `    let allowedAck = "";
    const reported = new Set<string>();
    const authorizedCommand = (raw:string) => {
      const command=amunMaintenanceCommand(raw);
      if(command==="bin/fm-wake-drain.sh") return command;
      if(command!==allowedAck || !reported.size || (wakeTaskScope && [...wakeTaskScope.tasks].some(task=>!reported.has(task)))) throw Error("Acknowledge only after recording an outcome for the presented wake.");
      allowedAck="";return command;
    };
    const loader = new DefaultResourceLoader({`,
  );
  replaceOnce(
    '            branchPi.on("before_provider_request"',
    `            branchPi.on("tool_result", event=>{
              if(event.toolName==="bash" && event.input.command==="bin/fm-wake-drain.sh"){
                allowedAck="";reported.clear();
                if(!event.isError)try{allowedAck="bin/fm-wake-drain.sh "+parseAmunAck(event.content.filter(x=>x.type==="text").map(x=>x.text).join("\\n")).join(" ");}catch{}
              }
              if(event.toolName==="fm_branch_report" && !event.isError) reported.add(String(event.input.task));
            });
            branchPi.on("before_provider_request"`,
  );
  replaceOnce("${context.command}", "${authorizedCommand(context.command)}");
  return (
    source +
    "\nconst amunMaintenanceCommand = " +
    maintenanceCommand.toString() +
    ";\nconst parseAmunAck = " +
    wakeAcknowledgement.toString() +
    ";\n"
  );
}
