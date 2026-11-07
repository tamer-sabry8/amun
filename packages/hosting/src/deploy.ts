import { createHash } from "node:crypto";
function checked(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Unexpected Cloudflare result");
  return value as Record<string, unknown>;
}
type Call = (code: string, accountId?: string) => Promise<unknown>;
const address = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
export async function publishOrigin(
  source: string,
  digest: string,
  execute: Call,
  claim: () => void,
) {
  if (
    !/^[a-f0-9]{64}$/.test(digest) ||
    createHash("sha256").update(source).digest("hex") !== digest
  )
    throw Error("Reviewed Worker changed");
  const worker = "amun-origin-" + digest.slice(0, 16);
  // This operator-only deployment targets Tamer's explicitly reviewed origin.
  const dnsCheck =
    'const records=await cloudflare.request({method:"GET",path:"/zones/"+zoneId+"/dns_records?name=amun.transfrm.ai"});if(!Array.isArray(records.result)||records.result.length)throw Error("DNS conflict");';
  const preflight = await execute(`async () => {
 const zones=await cloudflare.request({method:"GET",path:"/zones?name=transfrm.ai"});const matches=zones.result.filter(z=>z.name==="transfrm.ai"&&z.status==="active");if(matches.length!==1)throw Error("Zone unavailable");
 const {id:zoneId,account:{id:acct}}=matches[0];${dnsCheck}
 const scripts=await cloudflare.request({method:"GET",path:"/accounts/"+acct+"/workers/scripts"});const domains=await cloudflare.request({method:"GET",path:"/accounts/"+acct+"/workers/domains?hostname=amun.transfrm.ai"});
 return {zoneId,accountId:acct,clear:Array.isArray(scripts.result)&&!scripts.result.some(s=>s.id===${JSON.stringify(worker)})&&Array.isArray(domains.result)&&!domains.result.some(d=>d.hostname==="amun.transfrm.ai")};
 }`);
  const target = checked(preflight);
  if (
    !address(target.zoneId) ||
    !address(target.accountId) ||
    target.clear !== true
  )
    throw Error("Hosting preflight did not pass");
  claim();
  const scriptPath =
    "/accounts/" + target.accountId + "/workers/scripts/" + worker;
  const upload = await execute(
    `async()=>{const f=new FormData();f.append("metadata",new Blob([JSON.stringify({main_module:"worker.js",compatibility_date:"2026-01-01",observability:{enabled:false}})],{type:"application/json"}));f.append("worker.js",new Blob([${JSON.stringify(source)}],{type:"application/javascript+module"}),"worker.js");const r=await cloudflare.request({method:"PUT",path:${JSON.stringify(scriptPath)},body:f});return {id:r.result?.id};}`,
    target.accountId,
  );
  if (checked(upload).id !== worker) throw Error("Worker upload unconfirmed");
  const bound = await execute(
    `async()=>{const zoneId=${JSON.stringify(target.zoneId)};${dnsCheck}const r=await cloudflare.request({method:"PUT",path:${JSON.stringify("/accounts/" + target.accountId + "/workers/domains")},body:{zone_id:zoneId,hostname:"amun.transfrm.ai",service:${JSON.stringify(worker)},environment:"production"}});return {hostname:r.result?.hostname,service:r.result?.service};}`,
    target.accountId,
  );
  const receipt = checked(bound);
  if (receipt.hostname !== "amun.transfrm.ai" || receipt.service !== worker)
    throw Error("Hostname binding unconfirmed");
  return worker;
}
