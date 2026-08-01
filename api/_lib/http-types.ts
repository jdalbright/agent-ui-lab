export type HeaderValue = string | string[] | undefined;

/** Minimal Vercel-compatible request contract used by this project. */
export type ServerRequest = {
  method?: string;
  headers: Readonly<Record<string, HeaderValue>>;
  body?: unknown;
  socket: { remoteAddress?: string | null };
  on(event: "close", listener: () => void): unknown;
};

/** Minimal Vercel-compatible response contract used by this project. */
export type ServerResponse = {
  statusCode: number;
  setHeader(name: string, value: string | number | readonly string[]): unknown;
  status(code: number): ServerResponse;
  json(body: unknown): unknown;
  write(chunk: string | Uint8Array): boolean;
  flushHeaders(): void;
  end(): void;
};
