import { describe, expect, it } from "vitest";
import {
  mentionsAzureDevOps,
  parseQuestion,
} from "../src/work/question-choices.ts";

describe("reading choices from the First Mate's words", () => {
  it("reads a numbered list after the question with a tagged recommendation", () => {
    expect(
      parseQuestion(
        [
          "I can start the PRD now.",
          "Which Azure DevOps project should Product Test 1 track?",
          "1. POCs · POCs Team (recommended): it's the project you use for tests",
          "2. ICV · ICV Team",
          "3. Payments · Core Team",
        ].join("\n"),
      ),
    ).toEqual({
      question: "Which Azure DevOps project should Product Test 1 track?",
      options: ["POCs · POCs Team", "ICV · ICV Team", "Payments · Core Team"],
      recommended: 0,
      why: "it's the project you use for tests",
    });
  });

  it("reads lettered options and a separate recommendation line", () => {
    const parsed = parseQuestion(
      [
        "Options:",
        "A) One-page checkout",
        "B) Two-step checkout — keeps address entry separate",
        "",
        "Recommendation: B, because it matches your current flow.",
        "Which layout should the prototype use?",
      ].join("\n"),
    );
    expect(parsed).toMatchObject({
      options: ["One-page checkout", "Two-step checkout"],
      recommended: 1,
      why: "it matches your current flow",
    });
  });

  it("keeps a plain question when there are no choices or too many", () => {
    expect(
      parseQuestion("What is the core benefit for a product manager?"),
    ).toEqual({
      question: "What is the core benefit for a product manager?",
      options: [],
      recommended: null,
      why: null,
    });
    const five = ["Which one?", "- a", "- b", "- c", "- d", "- e"].join("\n");
    expect(parseQuestion(five)?.options).toEqual([]);
  });

  it("finds nothing to ask in a statement", () => {
    expect(
      parseQuestion("Done: the product is now named Product-test-1."),
    ).toBeNull();
  });

  it("takes the reason from a recommendation line for a tagged option", () => {
    const text = [
      "Which should I start with?",
      "1. Current sprint only",
      "2. Last three sprints (recommended)",
      "",
      "Recommendation: 2, because it shows the trend.",
    ].join("\n");
    expect(parseQuestion(text)).toMatchObject({
      recommended: 1,
      why: "it shows the trend",
    });
  });

  it("notices Azure DevOps", () => {
    expect(mentionsAzureDevOps("Connect Azure DevOps in Settings")).toBe(true);
    expect(mentionsAzureDevOps("the ADO board")).toBe(true);
    expect(mentionsAzureDevOps("Notion page")).toBe(false);
  });
});
