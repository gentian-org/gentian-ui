import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiFetch } from "@/api/client";
import {
  BRIDGE,
  BRIDGE_VERSION,
  DECLINED,
  isFramedHere,
  parseRequest,
  perform,
  plan,
  type BridgeReply,
  type Planned,
  type StoreContext,
} from "@/shell/storeBridge";

type Write = Extract<Planned, { kind: "write" }>;

type Pending = {
  write: Write;
  answer: (reply: BridgeReply) => void;
};

/**
 * Listens for the App Store and answers it. Renders nothing until the store
 * asks for a write, and then renders the question.
 *
 * Mounted once per desktop. It asks the BFF which store this cluster listens
 * to; with none named there is no origin to accept a message from, so no
 * listener is installed at all.
 */
export function StoreBridge({ enabled }: { enabled: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  // The listener is installed once per origin and must see the current
  // language without being torn down on every change of it.
  const language = useRef(i18n.language);
  language.current = i18n.language;

  const { data: context } = useQuery({
    queryKey: ["store-context"],
    queryFn: () => apiFetch<StoreContext>("/store/context"),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    const origin = context?.storeOrigin;
    if (!context || !origin) return;

    function onMessage(event: MessageEvent) {
      if (event.origin !== origin) return;
      // A window of the store's that this desktop did not frame -- a tab the
      // person opened themselves -- has the right origin and no business
      // here. The checkout runs in such a tab, and hands its result to the
      // framed page, which is the one that asks.
      if (!isFramedHere(event.source)) return;
      const request = parseRequest(event.data);
      if (!request) return;
      const source = event.source as Window;

      const answer = (reply: BridgeReply) => {
        source.postMessage(
          { gentian: BRIDGE, v: BRIDGE_VERSION, id: request.id, ...reply },
          origin as string,
        );
      };

      const planned = plan(request);
      if (planned.kind === "refused") {
        answer({ ok: false, status: 400, error: planned.error });
        return;
      }
      if (planned.kind === "context") {
        answer({
          ok: true,
          status: 200,
          data: {
            cluster: context!.cluster,
            tenant: context!.tenant,
            relations: context!.relations,
            locale: language.current,
          },
        });
        return;
      }
      if (planned.kind === "read") {
        void perform(planned.call).then(answer);
        return;
      }
      setQueue((q) => [...q, { write: planned, answer }]);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [context]);

  const current = queue[0];
  if (!current) return null;

  function settle(reply: BridgeReply) {
    current.answer(reply);
    setQueue((q) => q.slice(1));
    setBusy(false);
  }

  async function confirm() {
    setBusy(true);
    const reply = await perform(current.write.call);
    if (reply.ok) {
      // What is installed decides which tiles there are.
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void queryClient.invalidateQueries({ queryKey: ["cluster-tiles"] });
    }
    settle(reply);
  }

  function decline() {
    settle({ ok: false, status: DECLINED, error: "declined" });
  }

  const subject = current.write.subject;
  // An install for everyone is its own question: it gives access to every
  // member of the tenant, and the person confirming has to be told.
  const wording = current.write.forEveryone ? "installEveryone" : current.write.write;
  const tenant = context?.tenant ?? "";

  return (
    <div className="customize-modal-overlay" role="presentation">
      <div
        className="customize-modal-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="store-bridge-title"
        aria-describedby="store-bridge-text"
      >
        <header className="customize-modal-header">
          <h2 className="customize-modal-title" id="store-bridge-title">
            {t(`store.${wording}.title`)}
          </h2>
        </header>
        <div className="customize-modal-form">
          <p id="store-bridge-text">
            {t(`store.${wording}.text`, { subject, tenant })}
          </p>
          <p className="customize-modal-hint">{t("store.asked", { origin: context?.storeOrigin })}</p>
          <div className="customize-modal-footer">
            <button
              type="button"
              className="customize-modal-btn"
              onClick={decline}
              disabled={busy}
            >
              {t("store.decline")}
            </button>
            <button
              type="button"
              className="customize-modal-btn customize-modal-btn--primary"
              onClick={() => void confirm()}
              disabled={busy}
              autoFocus
            >
              {busy ? t("store.working") : t(`store.${wording}.confirm`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
