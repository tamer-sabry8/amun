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
      let reply = "",
        exited = false;
      const client = new PiRpcClient(
        (line) => child.stdin.write(line),
        (frame) => {
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
      child.once("close", () => {
        exited = true;
        client.close();
        this.active = undefined;
        void rm(temp, { force: true, recursive: true }).catch(() => {});
      });
      stop = () => {
        if (exited) return;
        client.close();
        child.stdin.end();
        const timer = setTimeout(() => {
          if (!exited) child.kill("SIGKILL");
        }, 5000);
        timer.unref();
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
  close() {
    this.disposed = true;
    void this.active?.then(
      (live) => live.stop(),
      () => {},
    );
  }
}
