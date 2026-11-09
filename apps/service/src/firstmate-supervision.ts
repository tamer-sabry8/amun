import { spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { FirstmateReleases } from "../../../packages/crew/src/firstmate-release.ts";
import { PiRpcClient } from "../../../packages/crew/src/pi-rpc.ts";
import { guardedBranch } from "../../../packages/crew/src/branch-maintenance.ts";
import { readBoundedPrivateFile } from "../../../packages/crew/src/endpoint-receipt.ts";
import { Redactor } from "../../../packages/security/src/redaction.ts";
import { crewScope } from "../../../packages/crew/src/firstmate-dispatch.ts";

const controls = `export default function(pi) {
  let started;
  pi.registerCommand("amun-helm",{description:"Take the helm",handler:async()=>{
    pi.setActiveTools([]);
    const r=await pi.exec("/bin/bash",[process.env.FM_HOME+"/bin/fm-lock.sh"],{timeout:10000});
    if(r.code!==0) throw Error("Firstmate lock unavailable");
  }});
  pi.registerCommand("amun-product-turn",{description:"Review selected product sources",handler:async(encoded,ctx)=>{
    const {model,instruction,context,stream}=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));
    const cut=model.indexOf("/");
    const selected=ctx.modelRegistry.find(model.slice(0,cut),model.slice(cut+1));
    if(cut<1 || !selected)throw Error("Selected product model unavailable");
    const prompt={systemPrompt:instruction,messages:[{role:"user",content:[{type:"text",text:context}],timestamp:Date.now()}]};
    const options={signal:AbortSignal.timeout(90000)};
    let answer;
    if(stream){
      const response=ctx.modelRegistry.streamSimple(selected,prompt,options);
      let text="", last=0;
      for await(const event of response){
        if(event.type!=="text_delta")continue;
        text+=event.delta;
        if(text.length>30000)throw Error("Response exceeds conversation limit");
        if(Date.now()-last>=80){ctx.ui.notify("AMUN_CHAT "+text,"info");last=Date.now();}
      }
      answer=await response.result();
    }else answer=await ctx.modelRegistry.complete(selected,prompt,options);
    if(answer.provider!==selected.provider || answer.model!==selected.id)throw Error("Provider returned a different model");
    if(answer.stopReason!=="stop")throw Error("Incomplete product response");
    const text=answer.content.filter(block=>block.type==="text").map(block=>block.text).join("\\n");
    if(!text || text.length>30000)throw Error("Invalid product response");
    ctx.ui.notify("AMUN_PRODUCT "+text,"info");
  }});
  pi.registerCommand("amun-posture",{description:"Captain posture",handler:async(encoded,ctx)=>{
    const {name,argument}=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));
    const run=(script,args,timeout=25000)=>pi.exec("/bin/bash",[process.env.FM_HOME+"/bin/"+script,...args],{timeout});
    let text;
    if(name==="afk" && argument==="return"){
      const r=await run("fm-afk-return.sh",[]);
      if(r.code!==0 && r.code!==4)throw Error("Return failed");
      text=r.stdout.slice(0,12000);
    } else if(name==="afk"){
      const r=await run("fm-afk-launch.sh",["enter","--words",argument]);
      if(r.code!==0)throw Error("Away posture refused");
      text="Away posture is active.";
    } else if(name==="quiet" && (argument==="" || argument==="off")){
      text="On Pi, attended supervision keeps routine wakes quiet. If away, use /afk return for the return briefing.";
    } else if(name==="ahoy" && !argument){
      if(!started){
        const r=await run("fm-session-start.sh",[],70000);
        if(r.code!==0)throw Error("Firstmate startup failed");
        started=r.stdout;
      }
      text="Firstmate session start\\n"+started.slice(0,12000);
    } else throw Error("Unsupported posture");
    ctx.ui.notify("AMUN_POSTURE "+text,"info");
  }});
}`;

export class FirstmateSupervision {
  private active: ReturnType<FirstmateSupervision["start"]> | undefined;
  private disposed = false;
  private stopChild: (() => Promise<void>) | undefined;
  private busy = false;
  constructor(
    private workspace: string,
    private archives: string,
    private binary: string,
    private entry: string,
    private auth: string,
    private redactor: Redactor,
  ) {}
  async resume() {
    try {
      if (
        (await readBoundedPrivateFile(
          join(this.workspace, "primary-supervision"),
          16,
        )) === "active"
      )
        await this.owner();
    } catch {
      /* A later captain command can retry startup. */
    }
  }
  async ensureRunning() {
    await this.owner();
  }
  private owner() {
    if (this.disposed) throw Error("Supervision closed");
    if (!this.active)
      this.active = this.start().catch((e) => {
        this.active = undefined;
        throw e;
      });
    return this.active;
  }
  private async start() {
    const releases = await FirstmateReleases.open(
      this.workspace,
      this.archives,
    );
    const { home, revision } = await releases.crewHome();
    await releases.verifyHomes(revision, [home]);
    const owner = dirname(dirname(home));
    for (const name of ["config", "state", "data", "projects"]) {
      const dir = join(home, name);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      if ((await realpath(dir)) !== dir) throw Error("Invalid crew directory");
    }
    const { scope } = await crewScope(owner);
    const temp = await realpath(await mkdtemp(join(tmpdir(), "amun-primary-")));
    let stop = () => {};
    try {
      const extensions = join(home, ".pi/extensions"),
        branch = join(temp, "fm-branch-supervision.ts"),
        control = join(temp, "amun-controls.ts");
      await cp(join(extensions, "lib"), join(temp, "lib"), { recursive: true });
      await writeFile(
        branch,
        guardedBranch(
          await readFile(join(extensions, "fm-branch-supervision.ts"), "utf8"),
        ),
        { mode: 0o600, flag: "wx" },
      );
      await writeFile(control, controls, { mode: 0o600, flag: "wx" });
      if (this.disposed) throw Error("Closed");
      const child = spawn(
        this.binary,
        [
          this.entry,
          "--mode",
          "rpc",
          "--no-session",
          "--no-tools",
          "--no-extensions",
          "--no-mcp",
          "--no-skills",
          "--no-prompt-templates",
          "--no-context-files",
          "--extension",
          branch,
          "--extension",
          join(extensions, "fm-primary-pi-watch.ts"),
          "--extension",
          control,
        ],
        {
          cwd: home,
          env: {
            HOME: owner,
            PATH: "/usr/bin:/bin:/opt/homebrew/bin",
            ELECTRON_RUN_AS_NODE: "1",
            PI_CODING_AGENT_DIR: this.auth,
            PI_SKIP_VERSION_CHECK: "1",
            FM_HOME: home,
            FM_ROOT_OVERRIDE: home,
            FM_BACKEND: "tmux",
            TMUX_TMPDIR: scope,
          },
          stdio: ["pipe", "pipe", "ignore"],
        },
      );
      let productReply = "";
      let onStream: ((text: string) => void) | undefined;
      let reply = "",
        exited = false;
      const client = new PiRpcClient(
        (line) => child.stdin.write(line),
        (frame) => {
          if (
            frame.type === "extension_ui_request" &&
            frame.method === "notify" &&
            typeof frame.message === "string" &&
            frame.message.startsWith("AMUN_CHAT ")
          )
            onStream?.(this.redactor.text(frame.message.slice(10)));
          if (
            frame.type === "extension_ui_request" &&
            frame.method === "notify" &&
            typeof frame.message === "string" &&
            frame.message.startsWith("AMUN_PRODUCT ")
          )
            productReply = this.redactor.text(frame.message.slice(13));
          if (
            frame.type === "extension_ui_request" &&
            frame.method === "notify" &&
            typeof frame.message === "string" &&
            frame.message.startsWith("AMUN_POSTURE ")
          )
            reply = this.redactor.text(frame.message.slice(13, 12013));
        },
      );
      child.stdout
        .setEncoding("utf8")
        .on("data", (data) => client.receive(data));
      child.stdin.on("error", () => client.close());
      child.on("error", () => client.close());
      const closed = new Promise<void>((resolve) =>
        child.once("close", () => {
          exited = true;
          client.close();
          if (this.stopChild === stopOwned) {
            this.stopChild = undefined;
            this.active = undefined;
          }
          void rm(temp, { force: true, recursive: true }).catch(() => {});
          resolve();
        }),
      );
      let stopping = false;
      const stopOwned = () => {
        if (!stopping && !exited) {
          stopping = true;
          client.close();
          child.stdin.end();
          const timer = setTimeout(() => {
            if (!exited) child.kill("SIGKILL");
          }, 4000);
          timer.unref();
          void closed.then(() => clearTimeout(timer));
        }
        return closed;
      };
      this.stopChild = stopOwned;
      stop = () => {
        void stopOwned();
      };
      const command = async (message: string) => {
        if (this.disposed) throw Error("Closed");
        const r = (await client.request("prompt", { message }, 100000)) as {
          disposition?: string;
        };
        if (r.disposition !== "handled") throw Error("Command unavailable");
      };
      const catalog = (await client.request("get_commands", {}, 25000)) as {
        commands?: { name: string }[];
      };
      for (const name of [
        "amun-helm",
        "amun-posture",
        "fm-watch-arm-pi",
        "supervision-model",
      ])
        if (!catalog.commands?.some((c) => c.name === name))
          throw Error("Firstmate extension unavailable");
      await command("/amun-helm");
      if (
        (await readFile(join(home, "state/.lock"), "utf8")).trim() !==
        String(child.pid)
      )
        throw Error("Firstmate ownership unverified");
      await command("/fm-watch-arm-pi");
      const marker = join(this.workspace, "primary-supervision");
      await writeFile(marker, "active", { mode: 0o600, flag: "wx" }).catch(
        async (e: NodeJS.ErrnoException) => {
          if (
            e.code !== "EEXIST" ||
            (await readBoundedPrivateFile(marker, 16)) !== "active"
          )
            throw e;
        },
      );
      return {
        stop,
        productTurn: async (
          model: string,
          instruction: string,
          context: string,
          stream?: (text: string) => void,
        ) => {
          onStream = stream;
          try {
            productReply = "";
            await command(
              "/amun-product-turn " +
                Buffer.from(
                  JSON.stringify({
                    model,
                    instruction,
                    context,
                    stream: !!stream,
                  }),
                ).toString("base64url"),
            );
            if (!productReply) throw Error("No verified product response");
            return productReply;
          } finally {
            onStream = undefined;
          }
        },
        run: async (name: string, argument: string) => {
          reply = "";
          await command(
            "/amun-posture " +
              Buffer.from(JSON.stringify({ name, argument })).toString(
                "base64url",
              ),
          );
          if (!reply) throw Error("No verified posture result");
          return reply;
        },
      };
    } catch (e) {
      stop();
      await rm(temp, { recursive: true, force: true });
      throw e;
    }
  }
  async productTurn(
    model: string,
    instruction: string,
    context: string,
    stream?: (text: string) => void,
  ) {
    if (this.busy) throw Error("Primary supervision busy");
    this.busy = true;
    try {
      return await (
        await this.owner()
      ).productTurn(model, instruction, context, stream);
    } finally {
      this.busy = false;
    }
  }
  async run(name: string, argument: string) {
    if (this.busy || argument.length > 6000 || argument.includes("\0"))
      throw Error("Primary supervision busy or invalid argument");
    this.busy = true;
    try {
      return await (await this.owner()).run(name, argument);
    } finally {
      this.busy = false;
    }
  }
  close(): Promise<void> {
    this.disposed = true;
    return this.stopChild?.() ?? Promise.resolve();
  }
}
