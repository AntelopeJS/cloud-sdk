/** How a log read is shaped: one bounded page, or a tail from a cursor. */
export interface LogRequest {
  follow: boolean;
  lastEventId?: string;
  /** Called once the API accepted the read, before its first frame. */
  onOpen?: () => void;
}

/** How one build's log is read. */
export interface BuildLogRequest extends LogRequest {
  /**
   * The most lines the read returns before it ends. Without `follow` and
   * without `lastEventId` the read is a tail, the newest lines oldest first,
   * and the API returns 500 at most.
   */
  limit?: number;
}

/** A log read as it goes on the wire. */
interface LogRead {
  /** The query string, with its leading `?`, or empty. */
  query: string;
  headers: Record<string, string>;
}

/** The query string and headers a log read is sent with. */
export function logReadOf(request: BuildLogRequest): LogRead {
  const query = new URLSearchParams();
  if (request.follow) query.set("follow", "true");
  if (request.limit !== undefined) query.set("limit", String(request.limit));
  const text = query.toString();
  const accept = { Accept: "text/event-stream" };
  return {
    query: text === "" ? "" : `?${text}`,
    headers: request.lastEventId
      ? { ...accept, "Last-Event-ID": request.lastEventId }
      : accept,
  };
}
