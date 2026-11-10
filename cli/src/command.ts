import { createRequire } from "node:module";
import {
  formatExamples,
  type HelpExample,
  helpTextWidth,
  unbreakable,
  withExamples,
  wrapText,
} from "@antelopejs/core/cli";
import { Command, Option } from "commander";
import { DEFAULT_DEPLOY_TIMEOUT_MINUTES } from "./constants.js";
import { isRecord, isString } from "./guards.js";
import { applyCloudHelp, ENVIRONMENT_TOPIC } from "./help.js";
import { language } from "./i18n.js";
import { defaultRuntime } from "./runtime.js";
import type {
  DeployOptions,
  GlobalOptions,
  LinkOptions,
  LogsOptions,
  Runtime,
} from "./types.js";
import {
  validateDeployArguments,
  validateGlobalOptions,
  validateLinkOptions,
} from "./validation.js";

const DESCRIPTION = "Deploy and operate AntelopeJS Cloud projects";

interface PackageManifest {
  version: string;
}

function isPackageManifest(value: unknown): value is PackageManifest {
  return isRecord(value) && isString(value.version);
}

/** Read through the package's own name, so it works from any build folder. */
function packageVersion(): string {
  const require = createRequire(import.meta.url);
  const manifest: unknown = require("@antelopejs/cloud/package.json");
  if (!isPackageManifest(manifest)) {
    throw new Error("@antelopejs/cloud/package.json has no version");
  }
  return manifest.version;
}

const ROOT_EXAMPLES: HelpExample[] = [
  { description: "Log in once, with your browser", command: "ajs-cloud login" },
  {
    description:
      "Deploy the current folder; the first deploy creates the project",
    command: "ajs-cloud deploy",
  },
  {
    description: "Deploy from CI, without any prompt",
    command: "ajs-cloud deploy --yes --project my-app --port 8080",
  },
  {
    description: "Follow the logs of a service",
    command: "ajs-cloud logs web -f",
  },
];

function describeHelpFooter(width: number): string {
  const pointer =
    `Run ${unbreakable("ajs-cloud <command> --help")} for its options and examples, and ` +
    `${unbreakable(`ajs-cloud help ${ENVIRONMENT_TOPIC}`)} for the variables read from the environment.`;
  return [
    "",
    formatExamples(ROOT_EXAMPLES, width),
    "",
    ...wrapText(pointer, width),
  ].join("\n");
}

function globals(command: Command): GlobalOptions {
  return command.optsWithGlobals<GlobalOptions>();
}

/**
 * Checks the global options, then loads the actions: `--help`, `--version`
 * and usage errors never load them.
 */
async function actions(options: GlobalOptions) {
  validateGlobalOptions(options);
  return import("./actions.js");
}

function loginCommand(runtime: Runtime): Command {
  const command = new Command("login")
    .summary("Log in with your browser")
    .description(
      "Log in with your browser and save the session on this machine. The page to approve is printed, and opened unless --no-browser is given or nobody is at the terminal.",
    )
    .action(async (_, self: Command) => {
      const options = globals(self);
      await (await actions(options)).login(runtime, options);
    });
  return withExamples(command, [
    { description: "Log in to AntelopeJS Cloud", command: "ajs-cloud login" },
    {
      description: "Log in to another endpoint",
      command: "ajs-cloud login --api-url https://api.example.test",
    },
  ]);
}

function logoutCommand(runtime: Runtime): Command {
  return new Command("logout")
    .summary("Forget the saved session")
    .description("Forget the session saved on this machine.")
    .action(async (_, self: Command) => {
      const options = globals(self);
      await (await actions(options)).logout(runtime, options);
    });
}

function whoamiCommand(runtime: Runtime): Command {
  return new Command("whoami")
    .summary("Show the workspace you are logged in to")
    .description(
      "Show the workspace, API and console you are logged in to, and check that the platform still accepts the session.",
    )
    .action(async (_, self: Command) => {
      const options = globals(self);
      await (await actions(options)).whoami(runtime, options);
    });
}

function deployCommand(runtime: Runtime): Command {
  const command = new Command("deploy")
    .argument(
      "[service]",
      "Service to deploy (default: the services of this folder)",
    )
    .summary("Deploy this folder")
    .description(
      "Upload the linked services and follow their deployment until they are live. In a folder that is not linked yet, create the project and its service first, after showing the plan.",
    )
    .option(
      "--project <name>",
      "Project to create, or to deploy to, when the folder has no link of its own: in a folder inside a linked one, deploy it as its own service",
    )
    .option("--region <region>", "Region of a project created by deploy")
    .option(
      "--port <port>",
      "Port the app listens on, for a service created by deploy",
    )
    .option(
      "--timeout <minutes>",
      `Stop following a deployment after this long (default: ${DEFAULT_DEPLOY_TIMEOUT_MINUTES})`,
    )
    .action(
      async (
        service: string | undefined,
        deployOptions: DeployOptions,
        self: Command,
      ) => {
        const options = globals(self);
        validateDeployArguments(service, deployOptions);
        await (
          await actions(options)
        ).deploy(runtime, options, service, deployOptions);
      },
    );
  return withExamples(command, [
    {
      description: "Deploy every service of the linked folder",
      command: "ajs-cloud deploy",
    },
    { description: "Deploy one service", command: "ajs-cloud deploy api" },
    {
      description: "First deploy from CI: no prompt, explicit names",
      command: "ajs-cloud deploy --yes --project my-app --port 8080",
    },
  ]);
}

function linkCommand(runtime: Runtime): Command {
  const command = new Command("link")
    .argument("<project>", "Name of the project to link")
    .summary("Link this folder to an existing project")
    .description(
      "Link this folder to an existing project, so deploy, status and logs work on it. Without --service, the api and app services of a starter are mapped to apps/api and apps/app.",
    )
    .option(
      "--service <name=path>",
      "Map a service to a source folder; repeat it for each service",
      collect,
      [],
    )
    .option(
      "--dockerfile <name=path>",
      "Build a service with this Dockerfile, relative to its folder, instead of the folder's own",
      collect,
      [],
    )
    .action(
      async (project: string, linkOptions: LinkOptions, self: Command) => {
        const options = globals(self);
        validateLinkOptions(linkOptions);
        await (
          await actions(options)
        ).link(runtime, options, project, linkOptions);
      },
    );
  return withExamples(command, [
    {
      description: "Link a monorepo with two services",
      command:
        "ajs-cloud link my-project --service api=apps/api --service app=apps/app",
    },
    {
      description: "Build two services from the same folder",
      command:
        "ajs-cloud link my-project --service web=. --service frontend=. --dockerfile frontend=frontend.Dockerfile",
    },
  ]);
}

function statusCommand(runtime: Runtime): Command {
  return new Command("status")
    .summary("Show the state of each service")
    .description(
      "Show the state of each service of the linked project, the deployment on its way if any, and its public URL.",
    )
    .action(async (_, self: Command) => {
      const options = globals(self);
      await (await actions(options)).status(runtime, options);
    });
}

function openCommand(runtime: Runtime): Command {
  return new Command("open")
    .argument("[service]", "Service whose public URL to open")
    .summary("Open the project in the console")
    .description(
      "Print the console page of the linked project, or the public URL of a service, and open it in the browser.",
    )
    .action(async (service: string | undefined, _, self: Command) => {
      const options = globals(self);
      await (await actions(options)).open(runtime, options, service);
    });
}

function logsCommand(runtime: Runtime): Command {
  const command = new Command("logs")
    .argument("<service>", "Service whose logs to print")
    .summary("Print the logs of a service")
    .description(
      "Print the logs of a service from the last hour, or keep streaming new lines with -f. Lines go to stdout, one per log entry.",
    )
    .option("-f, --follow", "Keep streaming new log lines")
    .action(
      async (service: string, logsOptions: LogsOptions, self: Command) => {
        const options = globals(self);
        await (
          await actions(options)
        ).logs(runtime, options, service, logsOptions);
      },
    );
  return withExamples(command, [
    { description: "The last hour of logs", command: "ajs-cloud logs web" },
    { description: "Follow new lines", command: "ajs-cloud logs web -f" },
  ]);
}

function rollbackCommand(runtime: Runtime): Command {
  const command = new Command("rollback")
    .argument("<service>", "Service to roll back")
    .argument(
      "[revision]",
      "Revision id to roll back to (default: the previous one)",
    )
    .summary("Roll a service back to an earlier revision")
    .description(
      "Roll a service back to its previous revision, or to the given one, after a confirmation that --yes answers.",
    )
    .action(
      async (
        service: string,
        revision: string | undefined,
        _,
        self: Command,
      ) => {
        const options = globals(self);
        await (
          await actions(options)
        ).rollback(runtime, options, service, revision);
      },
    );
  return withExamples(command, [
    {
      description: "Back to the previous revision",
      command: "ajs-cloud rollback web",
    },
    {
      description: "Without the confirmation (CI)",
      command: "ajs-cloud rollback web --yes",
    },
  ]);
}

/** Every command, in the order the help lists them. */
const COMMANDS = [
  loginCommand,
  logoutCommand,
  whoamiCommand,
  deployCommand,
  linkCommand,
  statusCommand,
  openCommand,
  logsCommand,
  rollbackCommand,
];

/**
 * Options shared with `ajs` itself. The core output module reads them from
 * the command line and the environment; they are declared so that Commander
 * accepts them before and after a command name.
 */
function addOutputOptions(cloud: Command): void {
  cloud
    .option(
      "-q, --quiet",
      "Print only results, warnings and errors (also ANTELOPEJS_QUIET=1)",
    )
    .option(
      "--verbose [=channels]",
      "Show stack traces and full output (also ANTELOPEJS_VERBOSE)",
    )
    .option("--no-color", "Disable colors (also NO_COLOR=1)");
}

export function createCloudCommand(
  runtime: Runtime = defaultRuntime(),
): Command {
  const version = packageVersion();
  const cloud = new Command("cloud")
    .summary(DESCRIPTION)
    .version(version, "-v, --version", "Print the version")
    .addOption(
      new Option("--api-url <url>", "Cloud API URL").env("ANTELOPE_CLOUD_URL"),
    )
    .option(
      "-j, --json",
      "Print versioned JSON Lines on stdout instead of text",
    )
    .option("-y, --yes", "Accept the defaults and confirm: never prompt")
    .option("--no-browser", "Print links without opening them in a browser")
    .addOption(
      new Option("--lang <language>", "Language of the messages")
        .choices(["en", "fr"])
        .default(language(process.env.LANG), "from LANG"),
    );
  addOutputOptions(cloud);
  cloud
    .addHelpText(
      "before",
      () =>
        `${cloud.name()} ${version}${runtime.ui.symbols.separator}${DESCRIPTION}\n`,
    )
    .addHelpText("after", (context) =>
      describeHelpFooter(helpTextWidth(context)),
    );
  for (const command of COMMANDS) cloud.addCommand(command(runtime));
  applyCloudHelp(cloud);
  return cloud;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function mountCloudCommand(
  program: Command,
  runtime?: Runtime,
): Command {
  return program.addCommand(createCloudCommand(runtime));
}
