// Minimal MCP server (stdio, newline-delimited JSON-RPC) that gives the
// Council Chair one tool: ask_owner. Claude Code's own AskUserQuestion is not
// offered in --print mode (verified with 2.1.321), so the Chair asks through
// this instead and Amun routes the question to the Island.
//
// Started by ask-server-main.ts (or the desktop build entry) with the bridge
// directory as its only argument.
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { ask, waitForAnswer } from "./bridge.ts";

export const serverName = "amun_council";
export const toolName = "ask_owner";
const tool = {
  name: toolName,
  description:
    "Ask the owner for information that is missing from the brief. Use it wherever the protocol says to ask the user. Returns their answers.",
  inputSchema: {
    type: "object",
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          required: ["question"],
          properties: {
            question: { type: "string" },
            header: { type: "string" },
            multiSelect: { type: "boolean" },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  description: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};

interface Request {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}
/** Handles one request. Returns the response, or null for a notification. */
export async function handle(
  request: Request,
  bridgeDir: string,
  options: { intervalMs?: number } = {},
): Promise<object | null> {
  const reply = (result: unknown) => ({
    jsonrpc: "2.0",
    id: request.id,
    result,
  });
  const fail = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: request.id,
    error: { code, message },
  });
  if (request.id === undefined) return null;
  switch (request.method) {
    case "initialize":
      return reply({
        protocolVersion:
          typeof request.params?.protocolVersion === "string"
            ? request.params.protocolVersion
            : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: serverName, version: "1.0.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: [tool] });
    case "tools/call": {
      if (request.params?.name !== toolName)
        return fail(-32602, "Unknown tool");
      const id = randomUUID();
      try {
        const questions = await ask(bridgeDir, id, request.params.arguments);
        const answers = await waitForAnswer(bridgeDir, id, options);
        return reply({
          content: [
            {
              type: "text",
              text: questions
                .map(
                  (question, index) =>
                    `${question.question}\nAnswer: ${answers[index] ?? ""}`,
                )
                .join("\n\n"),
            },
          ],
        });
      } catch (error) {
        return reply({
          isError: true,
          content: [
            {
              type: "text",
              text:
                error instanceof Error
                  ? error.message
                  : "The question could not be asked.",
            },
          ],
        });
      }
    }
    default:
      return fail(-32601, "Method not found");
  }
}

export function serve(bridgeDir: string) {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let request: Request;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    void handle(request, bridgeDir).then((response) => {
      if (response) process.stdout.write(JSON.stringify(response) + "\n");
    });
  });
}
