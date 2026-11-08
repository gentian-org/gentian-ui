import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchPrefs, fetchBackgroundBlob } from "@/api/prefs";
import { DEFAULT_SHELL_BACKGROUND } from "@/lib/background";

/** Resolves wallpaper URL including authenticated user uploads. */
export function useShellBackgroundUrl() {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  const prefsQuery = useQuery({
    queryKey: ["prefs"],
    queryFn: fetchPrefs,
  });

  const blobQuery = useQuery({
    queryKey: ["prefs", "background-blob"],
    queryFn: fetchBackgroundBlob,
    enabled: Boolean(prefsQuery.data?.hasBackground),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!blobQuery.data) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(blobQuery.data);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blobQuery.data]);

  if (objectUrl) {
    return objectUrl;
  }
  return DEFAULT_SHELL_BACKGROUND;
}

export function useInvalidateShellBackground(queryClient: { invalidateQueries: (opts: { queryKey: string[] }) => Promise<unknown> }) {
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ["prefs"] });
    await queryClient.invalidateQueries({ queryKey: ["prefs", "background-blob"] });
  };
}
