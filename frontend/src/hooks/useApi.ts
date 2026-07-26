import { useState, useCallback } from 'react';
import { parseApiError } from '@/services/api/sdlcApi';

/**
 * Hook chuẩn hóa việc gọi API.
 * Tự động quản lý trạng thái loading, data, và error.
 * Cung cấp hàm `execute` để kích hoạt API call.
 */
export function useApi<T, Args extends unknown[]>(
  apiFunc: (...args: Args) => Promise<T>,
  options?: {
    onSuccess?: (data: T) => void;
    onError?: (error: string) => void;
    initialData?: T | null;
  }
) {
  const [data, setData] = useState<T | null>(options?.initialData ?? null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (...args: Args) => {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFunc(...args);
        setData(result);
        if (options?.onSuccess) {
          options.onSuccess(result);
        }
        return result;
      } catch (err: unknown) {
        const errorMessage = parseApiError(err, 'Lỗi gọi API không xác định').message;
        setError(errorMessage);
        if (options?.onError) {
          options.onError(errorMessage);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [apiFunc, options]
  );

  const reset = useCallback(() => {
    setData(options?.initialData ?? null);
    setError(null);
    setLoading(false);
  }, [options?.initialData]);

  return {
    data,
    loading,
    error,
    execute,
    reset,
    setData,
    setError,
  };
}
