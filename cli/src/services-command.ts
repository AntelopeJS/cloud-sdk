import { Command } from "commander";
import { actions, globals, withInvokedExamples } from "./command-kit.js";
import type { MaintenanceSetOptions, Runtime } from "./types.js";
import { validateMaintenanceArguments } from "./validation.js";

const DATABASE_ARGUMENT = "Managed database of the linked project";

function showCommand(runtime: Runtime): Command {
  return new Command("show")
    .argument("<service>", DATABASE_ARGUMENT)
    .summary("Show the maintenance window of a database")
    .description(
      "Show the maintenance window in force for a managed database, whether it is the platform's default, its next opening on the window's own clock, and whether you may change it.",
    )
    .action(async (service: string, _, self: Command) => {
      const options = globals(self);
      validateMaintenanceArguments(service);
      await (await actions(options)).maintenanceShow(runtime, options, service);
    });
}

function setCommand(runtime: Runtime): Command {
  return new Command("set")
    .argument("<service>", DATABASE_ARGUMENT)
    .summary("Choose the maintenance window of a database")
    .description(
      "Choose the weekly window in which the platform applies the updates it holds back for a managed database: a day, a start hour and a duration, read in a time zone. The workspace owner only, on a paid plan. Nothing is redeployed: the next opening of the new window is the first one the platform uses.",
    )
    .requiredOption("--day <day>", "Day of the week, monday to sunday")
    .requiredOption(
      "--start <hour>",
      "Hour the window opens, 0 to 23, in --zone",
    )
    .requiredOption(
      "--hours <hours>",
      "How long the window stays open, 1 to 4 hours",
    )
    .requiredOption(
      "--zone <zone>",
      "IANA time zone the day and the hour are read in, such as Europe/Brussels",
    )
    .action(
      async (
        service: string,
        setOptions: MaintenanceSetOptions,
        self: Command,
      ) => {
        const options = globals(self);
        validateMaintenanceArguments(service, setOptions);
        await (
          await actions(options)
        ).maintenanceSet(runtime, options, service, setOptions);
      },
    );
}

function resetCommand(runtime: Runtime): Command {
  return new Command("reset")
    .argument("<service>", DATABASE_ARGUMENT)
    .summary("Go back to the platform's maintenance window")
    .description(
      "Drop the window chosen for a managed database: the platform's default, Sunday 02:00 to 05:00 in Europe/Brussels, applies again. The workspace owner only, on a paid plan.",
    )
    .action(async (service: string, _, self: Command) => {
      const options = globals(self);
      validateMaintenanceArguments(service);
      await (
        await actions(options)
      ).maintenanceReset(runtime, options, service);
    });
}

function maintenanceWindowCommand(runtime: Runtime): Command {
  const command = new Command("maintenance-window")
    .summary("Read and choose when a database takes the platform's updates")
    .description(
      "Read and choose the weekly window in which the platform restarts a managed database to apply the updates it holds back. A database whose owner chose none runs the platform's default, Sunday 02:00 to 05:00 in Europe/Brussels.",
    )
    .addCommand(showCommand(runtime))
    .addCommand(setCommand(runtime))
    .addCommand(resetCommand(runtime));
  return withInvokedExamples(command, [
    {
      description: "Show the window of a database",
      command: "ajs-cloud services maintenance-window show postgres",
    },
    {
      description: "Maintain it on Tuesday nights, 01:00 to 03:00, Paris time",
      command:
        "ajs-cloud services maintenance-window set postgres --day tuesday --start 1 --hours 2 --zone Europe/Paris",
    },
    {
      description: "Go back to the platform's window",
      command: "ajs-cloud services maintenance-window reset postgres",
    },
  ]);
}

/** `services`: the settings of the linked project's services. */
export function servicesCommand(runtime: Runtime): Command {
  return new Command("services")
    .summary("Configure the services of the linked project")
    .description(
      "Configure the services of the linked project, in its production environment.",
    )
    .addCommand(maintenanceWindowCommand(runtime));
}
