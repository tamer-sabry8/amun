// Entry point: node ask-server-main.ts <bridge-directory>
import { serve } from "./ask-server.ts";

const dir = process.argv[2];
if (!dir) {
  process.stderr.write("Usage: ask-server <bridge-directory>\n");
  process.exit(2);
}
serve(dir);
