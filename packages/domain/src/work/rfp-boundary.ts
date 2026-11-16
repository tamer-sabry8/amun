// In R1 an RFP is tracked only (client, owner, deadline, status). Writing the
// response itself is out of scope, so this recognises work that asks for it.
// Anything ambiguous is refused: the user can still record tracking details.

const DELIVERABLE =
  "(?:(?:rfp|tender|technical|commercial)\\s+(?:responses?|answers?)|(?:rfp|tender)\\s+questions?|responses?|answers?|proposals?|bids?|offers?|execsummary|compliance\\s+matri(?:x|ces)|requirements?\\s+matri(?:x|ces)|pricing(?:\\s+schedules?)?|statements?\\s+of\\s+work|sow)";
const VERB =
  "(?:writ(?:e|ing)|draft(?:ing)?|prepar(?:e|ing)|compos(?:e|ing)|produc(?:e|ing)|author(?:ing)?|generat(?:e|ing)|creat(?:e|ing)|build(?:ing)?|develop(?:ing)?|put(?:ting)?\\s+together|complet(?:e|ing)|fill(?:ing)?(?:\\s+(?:in|out))?|respond(?:ing)?|answer(?:ing)?|submit(?:ting)?|finali[sz]e|finali[sz]ing|craft(?:ing)?|work(?:ing)?\\s+on)";
// A drafting verb, up to a few words, then the deliverable itself.
const DRAFTING = new RegExp(
  `\\b${VERB}\\b((?:\\W+\\w+){0,6}?)\\W+${DELIVERABLE}\\b(\\W+\\w+)?`,
  "gi",
);
const BARE_DELIVERABLE = new RegExp(`\\b${DELIVERABLE}\\b`, "i");
// Words showing that what is being written is tracking bookkeeping.
const TRACKING_BETWEEN =
  /\b(?:down|owners?|owns?|client|name|status|stage|outcome|reason|deadlines?|dates?|summary|summaries|list|reminders?|updates?|tracker|notes?|team|kickoff|kick-off|bidDecision)\b/i;
const TRACKING_SIGNAL =
  /\b(?:record|log|track|tracker|owners?|owns?|client|status|stage|outcome|reason|deadlines?|due\s+dates?|reminders?|summary|summaries|bidDecision|team|kickoff|kick-off)\b/i;
// A deliverable word used as a modifier of a tracking field: "proposal owner".
const FOLLOWED_BY_FIELD =
  /^(?:owners?|status|deadlines?|stage|outcome|lead|manager|reference|number)$/i;

function normalise(text: string): string {
  return text
    .replace(
      /\bbid\s*(?:\/|-|\s)\s*no\s*-?\s*bid(?:\s+decisions?)?/gi,
      "bidDecision",
    )
    .replace(/\bexecutive\s+summar(?:y|ies)\b/gi, "execsummary");
}

const RESPOND_TO_RFP =
  /\brespond(?:ing)?\s+to\b(?:\W+\w+){0,3}?\W+(?:rfp|tender)\b/i;

function clauseAsksForResponse(clause: string): boolean {
  if (RESPOND_TO_RFP.test(clause)) return true;
  for (const [, between, after] of clause.matchAll(DRAFTING)) {
    if (TRACKING_BETWEEN.test(between!)) continue;
    if (after && FOLLOWED_BY_FIELD.test(after.trim())) continue;
    return true;
  }
  // A deliverable with no tracking context at all, such as "then the proposal".
  return BARE_DELIVERABLE.test(clause) && !TRACKING_SIGNAL.test(clause);
}

function asksForResponse(text: string): boolean {
  return normalise(text)
    .split(/[.;:!?\n,]+|\b(?:and|then|also|plus|but)\b/i)
    .some(clauseAsksForResponse);
}

export function rfpResponseDelegation(input: {
  areaType: string;
  agent: string;
  title: string;
  task: string;
}): boolean {
  if (input.areaType.trim().toLowerCase() !== "rfp") return false;
  if (input.agent.trim().toLowerCase() === "proposal & bid") return true;
  return [input.title, input.task].some(asksForResponse);
}
