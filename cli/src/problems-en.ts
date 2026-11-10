import type { ProblemTexts } from "./problem-text.js";

const LOGIN = "Run ajs-cloud login";

const UNBUILDABLE_REASON =
  "A deployment needs a Dockerfile, an AntelopeJS project or a Node app with a package.json.";
const UNBUILDABLE_FIXES = [
  "Add a Dockerfile, or a package.json with a start script",
  "Or run the command from the app's own folder",
];

export const EN: ProblemTexts = {
  not_authenticated: {
    title: "You are not logged in",
    fixes: [`${LOGIN}, then run the command again`],
  },
  api_url_mismatch: {
    title: "You are logged in to another API endpoint",
    reason:
      "The saved session is never sent to an endpoint it was not issued by.",
    fixes: ["Run ajs-cloud login --api-url <url> to log in to that endpoint"],
  },
  project_not_linked: {
    title: "This folder is not linked to a project",
    fixes: [
      "Run ajs-cloud deploy to create one",
      "Or run ajs-cloud link <project> to use an existing one",
    ],
  },
  workspace_mismatch: {
    title: "This folder is linked to another workspace",
    reason: "The session saved on this machine is for a different workspace.",
    fixes: [
      `${LOGIN} and approve the folder's workspace`,
      "Or run ajs-cloud link <project> again",
    ],
  },
  invalid_project_config: {
    title: "The project link .antelope/cloud.json is not valid",
    fixes: ["Fix it, or delete it and run ajs-cloud link <project>"],
  },
  unknown_project: {
    title: 'No project named "{detail}" in this workspace',
    fixes: [
      "Check the name in the console",
      "Or run ajs-cloud deploy to create the project",
    ],
  },
  unknown_service: {
    title: 'The project has no service named "{detail}"',
    fixes: ["Run ajs-cloud status to list its services"],
  },
  unlinkable_service: {
    title: 'The project has no service named "{detail}"',
    reason:
      "Without --service, link expects the api and app services of a starter.",
    fixes: ["Pass --service <name>=<path> for each service of this folder"],
  },
  outside_project: {
    title: "This folder is outside the linked project",
    fixes: ["Run the command from the project folder"],
  },
  service_path_not_found: {
    title: "No linked service lives in this folder",
    fixes: [
      "Run the command from a service folder",
      "Or name the service: ajs-cloud deploy <service>",
    ],
  },
  ambiguous_service_path: {
    title: "Several linked services live in this folder",
    fixes: ["Name the service: ajs-cloud deploy <service>"],
  },
  invalid_service_path: {
    title: 'Invalid --service value "{detail}"',
    reason: "A service is mapped as <name>=<path>.",
    fixes: ["Pass it as --service api=apps/api"],
  },
  invalid_service_dockerfile: {
    title: 'Invalid --dockerfile value "{detail}"',
    reason:
      "A Dockerfile is given as <service>=<path>, for a service --service maps.",
    fixes: ["Pass it as --dockerfile app=docker/app.Dockerfile"],
  },
  service_path_outside_project: {
    title: 'The service path "{detail}" is outside the project folder',
    fixes: ["Give a path inside the project folder, such as apps/api"],
  },
  project_has_no_environment: {
    title: "The project has no environment to deploy to",
    fixes: ["Check the project in the console"],
  },
  rollback_revision_unavailable: {
    title: "No earlier revision of {detail} can be rolled back to",
    fixes: ["Run ajs-cloud status to see what the service runs"],
  },
  device_code_expired: {
    title: "The login request expired before it was approved",
    fixes: [`${LOGIN} again`],
  },
  invalid_api_url: {
    title: "Invalid API URL {detail}",
    reason:
      "The API URL is an http(s) URL without credentials, query or fragment.",
    fixes: ["Pass it as --api-url https://api.antelopejs.cloud"],
  },
  invalid_open_url: {
    title: "Refused to open {detail}",
    reason: "Only web pages are opened.",
  },
  invalid_timeout: {
    title: 'Invalid --timeout "{detail}"',
    reason: "The timeout is a number of minutes.",
    fixes: ["Pass it as --timeout 30"],
  },
  invalid_port: {
    title: 'Invalid port "{detail}"',
    reason: "A port is a whole number from 1 to 65535.",
    fixes: ["Pass it as --port 3000"],
  },
  invalid_project_slug: {
    title: 'Invalid project name "{detail}"',
    reason:
      "A project name has at least 2 lowercase letters, digits or dashes.",
    fixes: ["Pass it as --project my-app"],
  },
  invalid_service_name: {
    title: 'Invalid service name "{detail}"',
    reason: "A service name has lowercase letters, digits and dashes.",
    fixes: ["Name it like web or api"],
  },
  unknown_region: {
    title: 'Unknown region "{detail}"',
    fixes: ["Pass one of the regions below with --region"],
  },
  project_slug_taken: {
    title: "The project {detail} already exists in this workspace",
    reason: "--yes never deploys to an existing project it was not told to.",
    fixes: [
      "Pass --project {detail} to deploy to it, or --project with another name",
      "Or run ajs-cloud link {detail} first",
    ],
  },
  project_creation_forbidden: {
    title: "Your role cannot create projects in this workspace",
    fixes: [
      "Ask an administrator of the workspace",
      "Or run ajs-cloud link <project> to deploy to an existing project",
    ],
  },
  unsupported_source: {
    title: "This folder cannot be built",
    reason: UNBUILDABLE_REASON,
    fixes: UNBUILDABLE_FIXES,
  },
  workspace_not_ready: {
    title: "Your workspace is still being prepared",
    reason: "Nothing was created.",
    fixes: [
      "Run ajs-cloud deploy again in a few minutes",
      "Or check the workspace in the console",
    ],
  },
  workspace_blocked: {
    title: "Your workspace cannot deploy yet",
    reason: "It needs attention: {detail}.",
    fixes: ["Open the console to see why, or contact support"],
  },
  workspace_closed: {
    title: "This workspace has been deleted or cancelled",
    reason: "It can no longer deploy.",
    fixes: [`${LOGIN} and approve another workspace`],
  },
  deployment_failed: {
    title: "The deployment of {detail} failed",
    fixes: [
      "Run ajs-cloud logs {detail} to see why",
      "Or open the deployment page below",
    ],
  },
  deployment_cancelled: {
    title: "The deployment of {detail} was cancelled",
    fixes: ["Run ajs-cloud deploy {detail} to start another one"],
  },
  deployment_stream_ended: {
    title: "Lost track of the deployment of {detail}",
    reason: "It continues on the platform.",
    fixes: ["Run ajs-cloud status to check it"],
  },
  deployment_timeout: {
    title: "Stopped waiting for the deployment of {detail}",
    reason: "The deployment is still running on the platform.",
    fixes: [
      "Run ajs-cloud status to check it",
      "Or wait longer with --timeout <minutes>",
    ],
  },
  log_stream_error: {
    title: "The log stream failed",
    reason: "{detail}",
  },
  invalid_log_event: {
    title: "The API sent a log line the CLI cannot read",
    fixes: ["Update ajs-cloud, then run the command again"],
  },
  invalid_api_response: {
    title: "The API sent an answer the CLI cannot read",
    fixes: ["Update ajs-cloud, then run the command again"],
  },
  network_error: {
    title: "Cannot reach AntelopeJS Cloud",
    reason: "No answer from {detail}.",
    fixes: [
      "Check your connection, then run the command again",
      "Or pass another endpoint with --api-url",
    ],
  },
  "api.invalidSlug": {
    title: "The project name is not valid",
    reason:
      "A project name has at least 2 lowercase letters, digits or dashes.",
  },
  "api.slugTaken": {
    title: "A project already uses this name",
    fixes: [
      "Pass --project with another name",
      "Or run ajs-cloud link <project> to deploy to the existing project",
    ],
  },
  "api.projectLimit": {
    title: "The workspace has reached its project limit",
    fixes: [
      "Upgrade the plan",
      "Or run ajs-cloud link <project> to deploy to an existing project",
    ],
  },
  "api.serviceLimit": {
    title: "The production environment has reached its service limit",
    fixes: ["Remove a service, or upgrade the plan"],
  },
  "api.hostnameLimit": {
    title: "The workspace has reached its public hostname limit",
    fixes: ["Remove a public service, or upgrade the plan"],
  },
  "api.invalidServiceName": {
    title: "The service name is not valid",
    reason: "A service name has lowercase letters, digits and dashes.",
  },
  "api.serviceNameTaken": {
    title: "A service with this name already exists",
    fixes: ["Name the service another way"],
  },
  "api.unbuildable": {
    title: "This folder cannot be built",
    reason: UNBUILDABLE_REASON,
    fixes: UNBUILDABLE_FIXES,
  },
  "api.missingStartScript": {
    title: "package.json has no start script",
    reason:
      "Without a Dockerfile, the platform starts a Node app with its start script.",
    fixes: [
      'Add a start script to package.json, such as "start": "node server.js"',
      'For a static site, serve its build: "start": "npx serve dist"',
      "Or add a Dockerfile",
    ],
  },
  "api.monorepoUnsupported": {
    title: "A monorepo cannot be built without a Dockerfile",
    reason: "The folder is a workspace of several packages.",
    fixes: ["Add a Dockerfile that builds and starts the app"],
  },
  "api.nodeVersionUnsupported": {
    title: "No supported Node.js version matches {requested}",
    reason: "Supported versions: {supported}.",
    fixes: [
      "Ask for a supported version in package.json (engines.node)",
      "Or add a Dockerfile with the Node.js version you need",
    ],
  },
  "api.sourceTooLarge": {
    title: "The folder is too large to deploy",
    fixes: [
      "List what the build does not need in a .cloudignore, such as build output or test data",
    ],
  },
  "api.lfsUnsupported": {
    title: "Git LFS files are not supported yet",
    fixes: [
      "Add a Dockerfile that fetches them",
      "Or store these files elsewhere",
    ],
  },
  "api.plainVariableLimit": {
    title: "The service holds more than {limit} plain variables",
    fixes: [
      "Mark some variables as secret in the console",
      "Or remove the ones the app no longer reads",
    ],
  },
  "api.plainValueTooLong": {
    title: "The plain variable {key} is longer than {limit} characters",
    fixes: ["Mark it as secret in the console to keep a longer value"],
  },
  "api.unreadableSource": {
    title: "The API could not read the uploaded source",
    reason: "The archive is unreadable, or holds entries the platform refuses.",
    fixes: [
      "Run ajs-cloud deploy again",
      "Or contact support if it keeps failing",
    ],
  },
  "api.submodulesUnsupported": {
    title: "Git submodules are not supported",
    reason: "The upload never carries what a submodule points to.",
    fixes: [
      "Copy the submodule's files into the folder, or install it as a package",
      "Then remove .gitmodules",
    ],
  },
  "api.infraUnavailable": {
    title: "The deployment platform is unavailable right now",
    reason: "The folder stays linked.",
    fixes: ["Run ajs-cloud deploy again later"],
  },
  "api.workspaceNotReady": {
    title: "Your workspace is still being prepared",
    reason: "This takes about a minute after it is created.",
    fixes: ["Run ajs-cloud deploy again shortly"],
  },
  "api.projectGone": {
    title: "The linked project no longer exists",
    fixes: [
      "Run ajs-cloud link <project> to link another one",
      "Or delete .antelope/cloud.json and run ajs-cloud deploy to create one",
    ],
  },
  "api.serviceGone": {
    title: "The service no longer exists",
    fixes: ["Run ajs-cloud status to list the project's services"],
  },
  "api.deploymentInProgress": {
    title: "A deployment is already in progress for this service",
    fixes: ["Follow it with ajs-cloud status, then try again"],
  },
  "api.nothingDeployed": {
    title: "Nothing has been deployed to this service yet",
    fixes: ["Run ajs-cloud deploy first"],
  },
  "api.plan": {
    title: "Your current plan does not include this operation",
    fixes: ["Upgrade the plan in the console"],
  },
  "api.sessionExpired": {
    title: "Your session has expired or was revoked",
    fixes: [`${LOGIN} again`],
  },
  "api.permission": {
    title: "You do not have permission to perform this operation",
    fixes: ["Ask an administrator of the workspace"],
  },
  "api.quota": {
    title: "A workspace quota has been reached",
    fixes: ["Check the usage of the workspace in the console"],
  },
  "api.serverError": {
    title: "AntelopeJS Cloud had a problem handling the request",
    fixes: ["Try again in a moment"],
  },
  "api.refused": {
    title: "The API refused the request",
  },
};
