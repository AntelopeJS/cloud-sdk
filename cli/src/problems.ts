import type { Language } from "./i18n.js";
import type { ProblemTexts } from "./problem-text.js";
import { EN } from "./problems-en.js";
import { FR } from "./problems-fr.js";

export type { ProblemText } from "./problem-text.js";

export const PROBLEM_TEXTS: Record<Language, ProblemTexts> = { en: EN, fr: FR };
