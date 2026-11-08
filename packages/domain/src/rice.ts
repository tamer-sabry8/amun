export interface RiceInputs {
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  effort: number | null;
}
export function riceScore({ reach, impact, confidence, effort }: RiceInputs) {
  if (reach !== null && (!Number.isSafeInteger(reach) || reach < 0))
    throw Error("Reach must be a nonnegative number of people.");
  if (impact !== null && ![0.25, 0.5, 1, 2, 3].includes(impact))
    throw Error("Choose an impact from 0.25 to 3.");
  if (
    confidence !== null &&
    (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)
  )
    throw Error("Confidence must be 0–100 percent.");
  if (effort !== null && (!Number.isFinite(effort) || effort <= 0))
    throw Error("Effort must be positive person-months.");
  if (
    reach === null ||
    impact === null ||
    confidence === null ||
    effort === null
  )
    return null;
  const score = (reach * impact * (confidence / 100)) / effort;
  if (!Number.isFinite(score))
    throw Error("Score exceeds the supported range.");
  return score;
}
