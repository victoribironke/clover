type Level = "debug" | "info" | "warn" | "error";

const write = (level: Level, message: string, meta?: Record<string, unknown>) => {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    severity: level.toUpperCase(),
    message,
    ...meta,
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
};

export const log = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
