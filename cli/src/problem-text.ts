/**
 * What the user reads for one failure, in the what / why / fix template of
 * the core CLI. `{detail}` is replaced by the failure's detail: a service, a
 * project, a path or a value given on the command line.
 */
export interface ProblemText {
  title: string;
  reason?: string;
  fixes?: string[];
}

/** The problem texts of one language, by problem code. */
export type ProblemTexts = Record<string, ProblemText>;
