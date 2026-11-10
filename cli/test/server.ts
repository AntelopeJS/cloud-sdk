import type { Server } from "node:http";
import { isString } from "../src/guards.js";

/** The port a listening server was given. */
export function serverPort(server: Server): number {
  const address = server.address();
  if (address === null || isString(address)) {
    throw new Error("missing_test_address");
  }
  return address.port;
}
