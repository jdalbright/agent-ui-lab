export type AnswerProgressStage =
  | "accepted"
  | "understanding"
  | "retrieving"
  | "composing"
  | "validating"
  | "rendering";

export type StepKey = "read" | "gather" | "compose" | "check";

export const STEP_ORDER: readonly StepKey[] = [
  "read",
  "gather",
  "compose",
  "check",
];

export function stepForStage(stage: AnswerProgressStage): StepKey {
  switch (stage) {
    case "accepted":
    case "understanding":
      return "read";
    case "retrieving":
      return "gather";
    case "composing":
      return "compose";
    case "validating":
    case "rendering":
      return "check";
  }
}
