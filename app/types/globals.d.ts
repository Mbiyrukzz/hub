declare function useApi<T = unknown>(
  url: string,
  options?: { method?: string; body?: unknown }
): Promise<T>

declare function reactive<T extends object>(state: T): T

declare function notFound(): void
