/** EC-020: 연결이 중간에 끊기거나 종결 이벤트가 없으면 완료로 처리하지 않는다. */
export async function readRunStream(response: Response, onLine: (line: string) => void): Promise<void> {
  if (!response.body) throw new Error("응답 본문이 없습니다");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let terminal = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event: { type?: string } = JSON.parse(line);
    onLine(line);
    if (event.type === "done" || event.type === "error" || event.type === "blocked") terminal = true;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        consume(line);
        if (terminal) break;
      }
      if (terminal) break;
      if (done) { consume(pending); break; }
    }
    if (!terminal) throw new Error("완료 전에 연결이 종료됐습니다");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
