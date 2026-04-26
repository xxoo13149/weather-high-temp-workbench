export const withHandledTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error,
): Promise<T> => {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  try {
    const result = await Promise.race([
      promise.then(
        (value) =>
          ({
            kind: "value" as const,
            value,
          }),
        (error) =>
          ({
            kind: "error" as const,
            error,
          }),
      ),
      new Promise<{ kind: "timeout" }>((resolve) => {
        timerId = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);

    if (result.kind === "value") {
      return result.value;
    }

    if (result.kind === "error") {
      throw result.error;
    }

    throw createError();
  } finally {
    if (timerId) {
      clearTimeout(timerId);
    }
  }
};
