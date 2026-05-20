export function sanitizedErrorContext(error: unknown): { errorName: string; errorCode?: string } {
  if (error instanceof Error) {
    const code = typeof (error as Error & { code?: unknown }).code === 'string'
      ? (error as Error & { code: string }).code
      : undefined;
    return { errorName: error.name, ...(code ? { errorCode: code } : {}) };
  }

  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { name?: unknown; code?: unknown };
    return {
      errorName: typeof maybeError.name === 'string' ? maybeError.name : 'Object',
      ...(typeof maybeError.code === 'string' ? { errorCode: maybeError.code } : {}),
    };
  }

  return { errorName: typeof error };
}
