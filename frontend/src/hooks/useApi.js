import { useState, useEffect, useCallback } from "react";
/**
 * Hook for fetching data from the API.
 * Automatically fetches on mount and provides a refetch function.
 *
 * Usage:
 *   const { data: accounts, loading, refetch } = useApi(() => api.accounts.list());
 */
export function useApi(fetcher, deps = []) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetcher();
            setData(result);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Failed to fetch");
        }
        finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    useEffect(() => {
        fetchData();
    }, [fetchData]);
    return { data, loading, error, refetch: fetchData };
}
