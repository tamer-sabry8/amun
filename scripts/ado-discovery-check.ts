import { BoardDiscovery } from "../packages/connectors-ado/src/board-discovery.ts";
import { pilotConnection } from "../packages/connectors-ado/src/pilot-connection.ts";
import { azureTransport } from "../packages/connectors-ado/src/transport.ts";

try {
  const {
    collection: base,
    project: pilotProject,
    credential,
  } = pilotConnection();
  const secret = await credential.getPassword();
  if (!secret) throw Error("missing_keychain_credential");
  const transport = azureTransport(base, secret);
  const discovery = new BoardDiscovery(base, pilotProject, transport);
  const schema = await discovery.processSchema();
  const teams = await discovery.teams();
  let boardCount = 0,
    columnCount = 0;
  for (const team of teams) {
    const boards = await discovery.boards(team.id);
    for (const board of boards) {
      columnCount += (await discovery.columns(team.id, board.id)).length;
      boardCount++;
    }
  }
  console.log(
    JSON.stringify({
      types: schema.types.length,
      teams: teams.length,
      boards: boardCount,
      columns: columnCount,
    }),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  console.error(
    /^(missing_keychain_credential|read_failed|invalid_discovery_response|request_rejected_\d+)$/.test(
      message,
    )
      ? message
      : "Azure discovery failed; details withheld",
  );
  process.exitCode = 1;
}
