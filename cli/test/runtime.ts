import {
  type OutputCapabilities,
  type OutputStream,
  type Prompter,
  type PrompterOptions,
  type Question,
  TaskList,
} from "@antelopejs/core/cli";
import type { Runtime } from "../src/types.js";

/** What the commands of a test wrote, line by line. */
export interface Captured {
  /** Results: stdout. */
  stdout: string[];
  /** Feedback: stderr. */
  stderr: string[];
  /** Both streams, in the order they were written. */
  lines: string[];
}

/** How the fake terminal answers, and what it was asked. */
export interface Answers {
  /** Confirmation answers in order; yes once they run out. */
  confirms: boolean[];
  /** Text answers in order; an empty answer once they run out. */
  texts: string[];
  /** Text questions asked, as `Question (default)`. */
  prompts: string[];
  /** Confirmations asked. */
  confirmed: string[];
}

export interface TestRuntime {
  runtime: Runtime;
  output: Captured;
  answers: Answers;
}

const PLAIN: OutputCapabilities = {
  hasUnicode: true,
  colors: { result: false, feedback: false },
  terminals: { result: false, feedback: false },
};

function capture(target: string[], lines: string[]): OutputStream {
  return {
    write: (chunk: string) => {
      const text = String(chunk).replace(/\n$/, "");
      if (text === "") return true;
      for (const line of text.split("\n")) {
        target.push(line);
        lines.push(line);
      }
      return true;
    },
  };
}

/**
 * Answers like a person at a terminal: from the flags first, then from the
 * scripted answers. An empty text answer keeps the default, as the prompt
 * library does.
 */
function fakePrompter(answers: Answers, options: PrompterOptions): Prompter {
  const given = <Answer>(question: Question<Answer>): Answer | undefined => {
    if (question.answer !== undefined) return question.answer;
    if (options.acceptsDefaults && question.defaultAnswer !== undefined)
      return question.defaultAnswer;
    return undefined;
  };
  return {
    isInteractive: true,
    text: async (question) => {
      const answer = given(question);
      if (answer !== undefined) return answer;
      answers.prompts.push(`${question.message} (${question.defaultAnswer})`);
      return answers.texts.shift() || (question.defaultAnswer ?? "");
    },
    confirm: async (question) => {
      const answer = given(question);
      if (answer !== undefined) return answer;
      answers.confirmed.push(question.message);
      return answers.confirms.shift() ?? true;
    },
    select: async (question) =>
      given(question) ?? question.defaultAnswer ?? question.choices[0].value,
    multiselect: async (question) =>
      given(question) ?? question.defaultAnswer ?? [],
    requireAnswers: () => undefined,
  };
}

/**
 * A runtime on in-memory streams, with no terminal: tasks print their final
 * line only, and nothing is animated.
 */
export function testRuntime(cwd: string, configHome: string): TestRuntime {
  const output: Captured = { stdout: [], stderr: [], lines: [] };
  const answers: Answers = {
    confirms: [],
    texts: [],
    prompts: [],
    confirmed: [],
  };
  const streams = {
    result: capture(output.stdout, output.lines),
    feedback: capture(output.stderr, output.lines),
  };
  const tasks = new TaskList({
    streams,
    capabilities: PLAIN,
    isLive: false,
    isQuiet: false,
  });
  const runtime: Runtime = {
    cwd,
    configHome,
    ui: tasks.ui,
    tasks,
    isInteractive: true,
    hasLiveProgress: false,
    prompter: (options) => fakePrompter(answers, options),
    open: async () => undefined,
    sleep: async () => undefined,
    now: () => Date.now(),
    onInterrupt: () => () => undefined,
  };
  return { runtime, output, answers };
}
