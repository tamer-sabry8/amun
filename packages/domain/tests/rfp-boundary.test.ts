import { expect, it } from "vitest";
import { rfpResponseDelegation } from "../src/work/rfp-boundary.ts";

const ask = (
  areaType: string,
  agent: string,
  title: string,
  task = "",
): boolean => rfpResponseDelegation({ areaType, agent, title, task });

it("blocks the Proposal & Bid agent in an RFP area", () => {
  expect(ask("rfp", " proposal & bid ", "Anything", "Anything")).toBe(true);
  expect(ask("RFP", "Proposal & Bid", "Check dates")).toBe(true);
});

it("blocks asks to write the response in an RFP area", () => {
  const agent = "Presales & Solutioning";
  expect(
    ask(
      "rfp",
      agent,
      "Write the technical response for the Smart Inspection RFP",
    ),
  ).toBe(true);
  expect(ask("rfp", agent, "Compliance", "Draft the compliance matrix")).toBe(
    true,
  );
  expect(ask("rfp", agent, "Prepare a SOW")).toBe(true);
  expect(ask("rfp", agent, "x", "Generate a proposal for the client")).toBe(
    true,
  );
  expect(ask("rfp", agent, "x", "Compose the tender response")).toBe(true);
  expect(ask("rfp", agent, "Draft the proposal")).toBe(true);
  expect(ask("rfp", agent, "Write a bid for this tender")).toBe(true);
  expect(ask("rfp", agent, "Draft the response to the client RFP")).toBe(true);
});

it("allows tracking work in an RFP area", () => {
  const agent = "Research & Insights";
  expect(ask("rfp", agent, "Summarise the RFP deadline and owners")).toBe(
    false,
  );
  expect(ask("rfp", agent, "List the evaluation dates")).toBe(false);
  expect(ask("rfp", agent, "Update the status to Won")).toBe(false);
  for (const task of [
    "Prepare a summary of the bid deadlines",
    "Write a list of proposal due dates",
    "Prepare the status of the bid for the owner",
    "Draft a reminder about the proposal submission date",
    "Draft a reply to the client",
  ])
    expect(ask("rfp", agent, task)).toBe(false);
});

it("never applies outside RFP areas", () => {
  for (const type of ["product", "project", "Product"]) {
    expect(ask(type, "Proposal & Bid", "Write the proposal")).toBe(false);
    expect(ask(type, "Presales", "Draft the compliance matrix")).toBe(false);
    expect(ask(type, "Presales", "x", "Prepare a SOW")).toBe(false);
  }
});

const refused = [
  "Draft the proposal due Friday",
  "Write the response to the client",
  "Respond to the RFP",
  "Answer the RFP questions",
  "Create the proposal",
  "Build the compliance matrix",
  "Develop the proposal",
  "Put together the proposal",
  "Complete the proposal",
  "Fill in the compliance matrix",
  "Fill in the proposal",
  "Write a status update and then the proposal",
  "Write the pricing schedule",
  "Write the executive summary",
  "Prepare the technical response",
  "Write the statement of work",
  "Draft the offer",
  "Write the answers to the RFP questions",
  "Do the response",
];
const allowed = [
  "Record the client",
  "Update the owners and due date",
  "Set the deadline to Friday",
  "Update the status, stage and outcome",
  "Record the loss reason",
  "Remind me about the deadline",
  "Write a bid/no-bid decision summary",
  "Summarise the status",
  "Prepare the team for the bid",
  "Prepare a kickoff for the bid",
  "Write down who owns the proposal",
  "Write the owner of the bid in the tracker",
  "Write the client name for the proposal",
  "Write a status update",
];

it.each(refused)("refuses %s", (text) => {
  expect(ask("rfp", "Presales", text)).toBe(true);
  expect(ask("rfp", "Presales", "x", text)).toBe(true);
  expect(ask("product", "Presales", text)).toBe(false);
});

it.each(allowed)("allows %s", (text) => {
  expect(ask("rfp", "Presales", text)).toBe(false);
  expect(ask("rfp", "Presales", "x", text)).toBe(false);
});
