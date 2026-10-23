import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { beginStoreSignIn, fetchStoreSession, signOutOfStore, type StoreSession } from "@/api/store";
import { closePending, sendPending } from "@/lib/pendingWindow";

/**
 * The person's sign-in to the store, as far as the browser knows of it.
 *
 * That is: whether there is one, and how the store regards the tenant. The
 * token is the API's, kept in its memory only, and never arrives here. A
 * sign-in is started only when something needs it -- acquiring, or what the
 * tenant has acquired -- and it takes the whole window to the store's issuer
 * and back to the page it left, which carries on where it was. With a
 * session there already, nobody is asked anything on the way.
 *
 * Shown in a frame -- on the desktop -- the page cannot take the window, and
 * the sign-in opens in a separate one instead, while this page asks the API
 * whether it has arrived.
 */
type StoreSessionValue = {
  session: StoreSession | undefined;
  /** In a frame: the address at the store's issuer to open, once a sign-in was started. */
  signInUrl: string | null;
  starting: boolean;
  startError: unknown;
  /**
   * Start a sign-in that comes back to `returnTo`, a page of this app (by
   * default this one). In a frame, `pending` is a window the caller opened
   * in the person's click (lib/pendingWindow.js), sent to the issuer once
   * its address is known; without one, the page offers a link.
   */
  begin: (returnTo?: string, pending?: Window | null) => void;
  signOut: () => void;
};

const StoreSessionContext = createContext<StoreSessionValue | null>(null);

const POLL_WHILE_SIGNING_IN_MS = 2000;

/** Whether this page is shown inside another one, which it cannot navigate away. */
export function inFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** This page, as a path of this app. */
export function herePath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

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
    mutationFn: (v: { returnTo: string; pending?: Window | null }) =>
      beginStoreSignIn(inFrame() ? undefined : v.returnTo),
    onSuccess: (answer, v) => {
      if (inFrame()) {
        // The window opened in the click goes to the issuer; the link stays
        // offered all the same, and this page asks until the sign-in arrived.
        sendPending(v.pending ?? null, answer.authorizationUrl);
        setSignInUrl(answer.authorizationUrl);
      } else window.location.assign(answer.authorizationUrl);
    },
    onError: (_error, v) => closePending(v.pending ?? null),
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

  const { mutate: startSignIn } = start;
  const begin = useCallback(
    (returnTo?: string, pending?: Window | null) => startSignIn({ returnTo: returnTo ?? herePath(), pending }),
    [startSignIn],
  );
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
