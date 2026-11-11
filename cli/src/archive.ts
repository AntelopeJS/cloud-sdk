import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { buffer } from "node:stream/consumers";
import ignore from "ignore";
import { pack } from "tar-stream";
import { CliError } from "./errors.js";

const DEFAULT_IGNORES = [".git", "node_modules", ".antelope"];
const DEFAULT_IGNORE_SET = new Set(DEFAULT_IGNORES);
/** Every entry gets the same mtime so the same tree always packs to the same bytes. */
const ENTRY_MTIME = new Date(0);

async function ignoreRules(root: string): Promise<string[]> {
  try {
    return [
      ...DEFAULT_IGNORES,
      ...(await readFile(join(root, ".cloudignore"), "utf8")).split("\n"),
    ];
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    return DEFAULT_IGNORES;
  }
}

async function filesUnder(
  root: string,
  filter: ReturnType<typeof ignore>,
  directory = root,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      const name = tarName(relative(root, path));
      if (entry.isDirectory()) {
        return DEFAULT_IGNORE_SET.has(entry.name)
          ? []
          : filesUnder(root, filter, path);
      }
      return filter.ignores(name) ? [] : [name];
    }),
  );
  return nested.flat().sort();
}

function tarName(path: string): string {
  return path.split(sep).join("/");
}

const DOCKERFILE = "Dockerfile";

/**
 * The Dockerfile a service names, once it is known to be a file of the
 * service folder. `link` checks the path it is given, but `deploy` reads it
 * back from `.antelope/cloud.json`, a committed file anyone who can change
 * the repository can edit: without this check a path such as
 * `../../.ssh/id_ed25519`, or one through a symlinked folder, would pack a
 * file of the deployer's machine into the upload.
 *
 * @throws CliError `service_path_outside_project` when the path leaves the folder.
 */
async function containedDockerfile(
  root: string,
  dockerfile: string,
): Promise<string> {
  const path = join(root, dockerfile);
  const [folder, target] = await Promise.all([realpath(root), realpath(path)]);
  const inside = relative(folder, target);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    throw new CliError("service_path_outside_project", dockerfile);
  }
  return path;
}

/**
 * The service folder as a tar archive. With `dockerfile`, that file is packed
 * as the archive's `Dockerfile`, in place of the folder's own.
 */
export async function createSourceArchive(
  root: string,
  dockerfile?: string,
): Promise<Buffer> {
  const suppliedDockerfile = dockerfile
    ? await containedDockerfile(root, dockerfile)
    : undefined;
  const filter = ignore().add(await ignoreRules(root));
  const listed = await filesUnder(root, filter);
  const files = dockerfile
    ? [...new Set([...listed, DOCKERFILE])].sort()
    : listed;
  const archive = pack();
  const complete = buffer(archive);
  for (const file of files) {
    const path =
      suppliedDockerfile && file === DOCKERFILE
        ? suppliedDockerfile
        : join(root, file);
    const stats = await lstat(path);
    if (!stats.isFile()) continue;
    archive.entry(
      { name: tarName(file), mode: stats.mode, mtime: ENTRY_MTIME },
      await readFile(path),
    );
  }
  archive.finalize();
  return complete;
}
