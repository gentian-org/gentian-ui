import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { beginStoreSignIn, fetchStoreSession, signOutOfStore, type StoreSession } from "@/api/store";

/**
 * The person's sign-in to the store, as far as the browser knows of it.
 *
 * That is: whether there is one, and how the store regards the tenant. The
 * token is the API's and never arrives here. A sign-in is started only when
 * the person asks for something that needs it -- acquiring, or what the
 * tenant has acquired -- and it happens in a separate window, at the store:
 * this app may be shown in a frame on the desktop, and a store's sign-in
 * page does not belong in one. While that window is open this page asks the
 * API whether the sign-in has arrived.
 */
type StoreSessionValue = {
  session: StoreSession | undefined;
  /** The address at the store's issuer to open, once a sign-in was started. */
  signInUrl: string | null;
  starting: boolean;
  startError: unknown;
  begin: () => void;
  signOut: () => void;
};

const StoreSessionContext = createContext<StoreSessionValue | null>(null);

const POLL_WHILE_SIGNING_IN_MS = 2000;

export function StoreSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [signInUrl, setSignInUrl] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ["store", "session"],
    queryFn: fetchStoreSession,
    refetchInterval: signInUrl ? POLL_WHILE_SIGNING_IN_MS : false,
    refetchOnWindowFocus: true,
  });
  const signedIn = sessionQuery.data?.signedIn === true;

  useEffect(() => {
    if (signedIn && signInUrl) {
      setSignInUrl(null);
      // What depends on the store's side of things is asked again.
      void queryClient.invalidateQueries({ queryKey: ["state"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    }
  }, [signedIn, signInUrl, queryClient]);

  const start = useMutation({
    mutationFn: beginStoreSignIn,
    onSuccess: (answer) => setSignInUrl(answer.authorizationUrl),
  });

  const end = useMutation({
    mutationFn: signOutOfStore,
    onSuccess: (answer) => {
      setSignInUrl(null);
      queryClient.setQueryData(["store", "session"], answer);
      void queryClient.invalidateQueries({ queryKey: ["state"] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  const begin = useCallback(() => start.mutate(), [start]);
  const signOut = useCallback(() => end.mutate(), [end]);

  const value = useMemo(
    () => ({
      session: sessionQuery.data,
      signInUrl,
      starting: start.isPending,
      startError: start.error,
      begin,
      signOut,
    }),
    [sessionQuery.data, signInUrl, start.isPending, start.error, begin, signOut],
  );

  return <StoreSessionContext.Provider value={value}>{children}</StoreSessionContext.Provider>;
}

export function useStoreSession(): StoreSessionValue {
  const value = useContext(StoreSessionContext);
  if (!value) {
    throw new Error("useStoreSession must be used within StoreSessionProvider");
  }
  return value;
}
