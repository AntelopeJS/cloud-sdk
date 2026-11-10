export interface SseEvent {
  event: string;
  data: unknown;
  id?: string;
}

function eventOf(lines: string[]): SseEvent | null {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = fieldValue(line.slice(6));
    if (line.startsWith("id:")) id = fieldValue(line.slice(3));
    if (line.startsWith("data:")) data.push(fieldValue(line.slice(5)));
  }
  if (data.length === 0) return null;
  const text = data.join("\n");
  try {
    return { event, data: JSON.parse(text), id };
  } catch {
    return { event, data: text, id };
  }
}

function fieldValue(value: string): string {
  return value.startsWith(" ") ? value.slice(1) : value;
}

export async function* parseSse(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += value ?? "";
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = eventOf(frame.split(/\r?\n/));
      if (event) yield event;
    }
    if (done) break;
  }
}
