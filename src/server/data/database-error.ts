import "server-only";

/** Contexto para logs/Sentry. El adaptador HTTP solo publica server_error. */
export class DatabaseOperationError extends Error {
  constructor(readonly operation: string, cause: unknown) {
    super(`Falló la operación de base de datos: ${operation}`, { cause });
    this.name = "DatabaseOperationError";
  }
}

export function throwIfDatabaseError(error: unknown, operation: string): void {
  if (error) throw new DatabaseOperationError(operation, error);
}
