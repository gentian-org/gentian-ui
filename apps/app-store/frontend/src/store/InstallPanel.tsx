import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { problemOf, type Problem } from "@/api/client";
import {
  advanceOperation,
  fetchAppState,
  fetchContext,
  setCredential,
  startOperation,
  stopOperation,
  type AdvanceRequest,
  type AppDetail,
  type AppState,
  type AppStateAnswer,
  type CredentialOutcome,
  type Operation,
  type Stage,
  type StartRequest,
  type Version,
} from "@/api/store";
import i18n from "@/lib/i18n";
import { ExternalLink, ProblemNote, shortDigest, StoreSignIn } from "@/store/parts";
import { useStoreSession } from "@/store/session";
import { StoreMarkdown } from "@/store/StoreMarkdown";

const mono = { mono: <span className="admin-console__mono" /> };

/** The steps of a sequence, in the order they are taken. */
const STEPS: Stage[] = ["acquire", "checkout", "declare", "credential", "install", "addons", "rollout"];

/** The step a stage belongs to, for the list of steps. */
const STEP_OF: Record<Stage, Stage> = {
  acquire: "acquire",
  checkout: "checkout",
  "confirm-build": "acquire",
  declare: "declare",
  "confirm-repository": "declare",
  credential: "credential",
  "credential-timeout": "credential",
  install: "install",
  addons: "addons",
  rollout: "rollout",
  failing: "rollout",
  done: "rollout",
  failed: "acquire",
};

/**
 * The dialog an install is confirmed in.
 *
 * It shows what is about to be sent to the cluster -- the coordinate and the
 * digest of the build -- before anything is sent, and asks the one thing
 * that is the person's to decide: whether the app is for everyone.
 */
function InstallDialog({
  detail,
  version,
  update,
  onConfirm,
  onClose,
}: {
  detail: AppDetail;
  version: Version;
  update: boolean;
  onConfirm: (everyone: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [everyone, setEveryone] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="install-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        className="admin-console__dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(everyone);
        }}
      >
        <h3 id="install-title" className="admin-console__dialog-title">
          <Trans
            i18nKey={update ? "install.updateTitle" : "install.installTitle"}
            values={{ app: detail.name, version: version.version }}
            components={mono}
          />
        </h3>
        <p className="admin-console__lead">
          <Trans
            i18nKey="install.installBody"
            values={{ coordinate: detail.coordinate, digest: shortDigest(version.digest) }}
            components={mono}
          />
        </p>
        <p className="admin-console__meta admin-console__mono admin-console__wrap">{version.digest}</p>

        {update ? (
          <>
            <p className="admin-console__lead">{t("install.updateKeepsAccess")}</p>
            {version.releaseNotes ? (
              <div className="store-dialog__notes">
                <p className="admin-console__group-title">{t("app.releaseNotes")}</p>
                <StoreMarkdown source={version.releaseNotes} />
              </div>
            ) : null}
          </>
        ) : (
          <div className="admin-console__choices" role="radiogroup" aria-labelledby="install-title">
            <label className={`admin-console__choice${everyone ? "" : " admin-console__choice--selected"}`}>
              <input type="radio" name="install-access" checked={!everyone} onChange={() => setEveryone(false)} />
              <span>
                <span className="admin-console__choice-title">{t("install.installPlain")}</span>
                <span className="admin-console__choice-desc">{t("install.installPlainBody")}</span>
              </span>
            </label>
            <label className={`admin-console__choice${everyone ? " admin-console__choice--selected" : ""}`}>
              <input type="radio" name="install-access" checked={everyone} onChange={() => setEveryone(true)} />
              <span>
                <span className="admin-console__choice-title">{t("install.installEveryone")}</span>
                <span className="admin-console__choice-desc">{t("install.installEveryoneBody")}</span>
              </span>
            </label>
          </div>
        )}

        {!update && detail.price.model !== "free" ? <p className="admin-console__hint">{t("install.mayNeedCheckout")}</p> : null}

        <div className="admin-console__dialog-footer">
          <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onClose}>
            {t("install.cancel")}
          </button>
          <button type="submit" className="admin-console__btn admin-console__btn--primary">
            {update ? t("install.updateAction") : everyone ? t("install.installEveryone") : t("install.installAction")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** What the cluster says of the app, in its own words. */
function ClusterState({ state }: { state: AppState | null }) {
  const { t } = useTranslation();
  if (!state) return <p className="admin-console__meta">{t("install.rolloutNotSeenYet")}</p>;
  return (
    <>
      {state.message ? <p className="admin-console__meta">{state.message}</p> : null}
      {state.failure ? <p className="admin-console__error">{state.failure}</p> : null}
      {state.pendingPrivileges.length > 0 ? (
        <p className="admin-console__hint">
          {t("install.pendingPrivileges")}{" "}
          <span className="admin-console__mono">{state.pendingPrivileges.join(", ")}</span>
        </p>
      ) : null}
    </>
  );
}

/** In words, what a refusal at one step of the sequence means. */
function stepWords(operation: Operation, problem: Problem): string | null {
  if (problem.source !== "director" && problem.source !== "custodian") return null;
  const key = `refused.${operation.failedStage ?? ""}-${problem.status ?? ""}`;
  return i18n.exists(key) ? i18n.t(key) : null;
}

function StepList({ operation }: { operation: Operation }) {
  const { t } = useTranslation();
  const at = STEP_OF[operation.stage === "failed" ? (operation.failedStage ?? "acquire") : operation.stage];
  const shown = STEPS.filter((step) => {
    if (step === "checkout") return operation.stage === "checkout";
    if (step === "declare" || step === "credential") return operation.mode === "install" && operation.repositories.length > 0;
    if (step === "addons") return (operation.build?.addons.length ?? 0) > 0;
    return true;
  });
  const index = shown.indexOf(at);
  return (
    <ol className="store-steps">
      {shown.map((step, i) => {
        const done = operation.stage === "done" || i < index;
        const current = !done && i === index;
        return (
          <li
            key={step}
            className={`store-steps__step${done ? " store-steps__step--done" : ""}${current ? " store-steps__step--current" : ""}`}
            aria-current={current ? "step" : undefined}
          >
            {t(`steps.${step}`)}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A sequence under way: what it is doing, what it waits for, and the few
 * places where it stops for the person.
 *
 * The page asks the API for the next step, shows what came of it, and asks
 * again after the wait it is told. Nothing runs when the page is closed, and
 * a page that is loaded again in the middle picks up from what the API
 * answers.
 */
function Progress({
  detail,
  operation,
  storeName,
  onAdvance,
  onStop,
  busy,
  error,
}: {
  detail: AppDetail;
  operation: Operation;
  storeName: string;
  onAdvance: (body?: AdvanceRequest) => void;
  onStop: () => void;
  busy: boolean;
  error: unknown;
}) {
  const { t } = useTranslation();
  const { session } = useStoreSession();
  const [typed, setTyped] = useState("");
  const stage = operation.stage;
  const waitingRepository = operation.repositories.find((r) => r.credential === "waiting");
  const problem = operation.error;
  const needsSignIn = problem?.code === "store-sign-in-required";

  return (
    <div className="store-progress" aria-live="polite">
      <StepList operation={operation} />

      {stage === "acquire" ? <p className="admin-console__lead">{t("install.acquiring", { store: storeName })}</p> : null}

      {stage === "checkout" && operation.checkout ? (
        <>
          <p className="admin-console__lead">{t("install.checkoutLead", { store: storeName })}</p>
          <div className="admin-console__actions">
            <a
              className="admin-console__btn admin-console__btn--primary"
              href={operation.checkout.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("install.openCheckout")}
            </a>
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.stopWaiting")}
            </button>
          </div>
          <p className="admin-console__meta">{t("install.checkoutWaiting")}</p>
        </>
      ) : null}

      {stage === "confirm-build" && operation.build ? (
        <div className="admin-console__warning" role="alert">
          <p className="store-notice__title">{t("install.otherBuildTitle")}</p>
          <p className="store-notice__text">{t("install.otherBuildBody", { store: storeName })}</p>
          <p className="store-notice__text">
            {t("install.buildShown")} <span className="admin-console__mono admin-console__wrap">{operation.expectedDigest}</span>
          </p>
          <p className="store-notice__text">
            {t("install.buildConfirmed", { version: operation.build.version })}{" "}
            <span className="admin-console__mono admin-console__wrap">{operation.build.digest}</span>
          </p>
          <div className="admin-console__actions">
            <button
              type="button"
              className="admin-console__btn admin-console__btn--primary"
              disabled={busy}
              onClick={() => onAdvance({ confirmDigest: operation.build?.digest })}
            >
              {t("install.installThisBuild")}
            </button>
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.stop")}
            </button>
          </div>
        </div>
      ) : null}

      {stage === "declare" ? <p className="admin-console__lead">{t("install.declaring")}</p> : null}

      {stage === "confirm-repository" && operation.confirmRepository ? (
        <form
          className="admin-console__danger"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed) onAdvance({ confirmRepository: typed });
          }}
        >
          <p className="admin-console__danger-title">{t("install.confirmRepositoryTitle")}</p>
          <p className="store-notice__text">{t("install.confirmRepositoryLead")}</p>
          {/* The director's own words. */}
          {operation.confirmRepository.text ? <p className="store-problem__said">{operation.confirmRepository.text}</p> : null}
          <p className="store-notice__text">
            <span className="admin-console__mono">{operation.confirmRepository.name}</span>
            {" → "}
            <span className="admin-console__mono">{operation.confirmRepository.url}</span>
          </p>
          <label className="admin-console__label">
            <span className="admin-console__label-text">
              {t("install.confirmRepositoryType")}{" "}
              <span className="admin-console__mono">{operation.confirmRepository.confirmWith ?? operation.confirmRepository.name}</span>
            </span>
            <input
              type="text"
              className="store-input"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </label>
          <div className="admin-console__actions">
            <button type="submit" className="admin-console__btn admin-console__btn--danger" disabled={busy || !typed}>
              {t("install.confirmRepositoryAction")}
            </button>
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.stop")}
            </button>
          </div>
        </form>
      ) : null}

      {stage === "credential" ? (
        <p className="admin-console__lead">
          {waitingRepository ? t("install.waitingForRepository") : t("install.settingCredential")}
        </p>
      ) : null}

      {stage === "credential-timeout" ? (
        <div className="admin-console__warning" role="alert">
          <p className="store-notice__title">{t("install.repositoryNotArrivedTitle")}</p>
          <p className="store-notice__text">{t("install.repositoryNotArrivedBody")}</p>
          {problem?.detail ? <p className="store-problem__said">{problem.detail}</p> : null}
          <div className="admin-console__actions">
            <button
              type="button"
              className="admin-console__btn admin-console__btn--primary"
              disabled={busy}
              onClick={() => onAdvance({ continue: true })}
            >
              {t("install.continue")}
            </button>
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.stop")}
            </button>
          </div>
        </div>
      ) : null}

      {stage === "install" ? <p className="admin-console__lead">{t("install.installing")}</p> : null}
      {stage === "addons" ? <p className="admin-console__lead">{t("install.pinningAddons")}</p> : null}

      {stage === "rollout" ? (
        <>
          <p className="admin-console__lead">{t("install.rollingOut")}</p>
          <ClusterState state={operation.rollout} />
        </>
      ) : null}

      {stage === "failing" ? (
        <>
          <p className="admin-console__lead">{t("install.failingLead")}</p>
          <ClusterState state={operation.rollout} />
          <div className="admin-console__actions">
            <button type="button" className="admin-console__btn" disabled={busy} onClick={() => onAdvance()}>
              {t("install.lookAgain")}
            </button>
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.close")}
            </button>
          </div>
        </>
      ) : null}

      {stage === "done" ? (
        <div className="admin-console__success" role="status">
          <p className="store-notice__title">{t("install.doneTitle", { app: detail.name })}</p>
          <p className="store-notice__text">{t("install.doneTile")}</p>
          {operation.install?.commit ? (
            <p className="store-notice__text">
              <Trans i18nKey="install.committedAs" values={{ commit: operation.install.commit }} components={mono} />
            </p>
          ) : operation.install?.status === "already_installed" ? (
            <p className="store-notice__text">{t("install.alreadyInstalled")}</p>
          ) : null}
          <div className="admin-console__actions">
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.close")}
            </button>
          </div>
        </div>
      ) : null}

      {stage === "failed" && problem ? (
        <>
          {stepWords(operation, problem) ? <p className="admin-console__lead">{stepWords(operation, problem)}</p> : null}
          <ProblemNote problem={problem} />
          {needsSignIn && !session?.signedIn ? (
            <StoreSignIn reason={t("session.endedSignInAgain", { store: storeName })} storeName={storeName} />
          ) : null}
          <div className="admin-console__actions">
            <button
              type="button"
              className="admin-console__btn admin-console__btn--primary"
              disabled={busy || (needsSignIn && !session?.signedIn)}
              onClick={() => onAdvance({ retry: true })}
            >
              {t("install.tryAgain")}
            </button>
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.stop")}
            </button>
          </div>
          <p className="admin-console__meta">{t("install.nothingLost")}</p>
        </>
      ) : null}

      {error ? (
        <>
          <ProblemNote error={error} />
          <div className="admin-console__actions">
            <button type="button" className="admin-console__btn" disabled={busy} onClick={() => onAdvance()}>
              {t("install.tryAgain")}
            </button>
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.stop")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Setting a repository's credential again, and saying what came of it. */
export function CredentialOutcomeNote({ outcome }: { outcome: CredentialOutcome }) {
  const { t } = useTranslation();
  return (
    <div className="store-standing">
      {outcome.repositories.length === 0 ? <p className="admin-console__meta">{t("credential.noRepository")}</p> : null}
      {outcome.repositories.map((repository) => (
        <div key={repository.name} className={repository.outcome === "set" ? "admin-console__success" : "admin-console__warning"} role="status">
          <p className="store-notice__text">
            <span className="admin-console__mono">{repository.name}</span>
            {" — "}
            {t(`credentialOutcome.${repository.outcome}`)}
          </p>
          {repository.problem?.detail ? <p className="store-problem__said">{repository.problem.detail}</p> : null}
        </div>
      ))}
      {outcome.rotated ? <p className="admin-console__meta">{t("credential.rotatedOverlap")}</p> : null}
    </div>
  );
}

/**
 * Everything about having this app: whether the tenant has it, getting it,
 * and how the cluster is doing with it.
 */
export function InstallPanel({ detail, storeName }: { detail: AppDetail; storeName: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { session } = useStoreSession();
  const coordinate = detail.coordinate;
  const latest = detail.versions[0];

  const stateQuery = useQuery({
    queryKey: ["state", coordinate],
    queryFn: () => fetchAppState(coordinate),
    retry: false,
  });
  const contextQuery = useQuery({ queryKey: ["context"], queryFn: fetchContext, retry: false });

  const [operation, setOperation] = useState<Operation | null>(null);
  const [dialog, setDialog] = useState<"install" | "update" | null>(null);
  const [wantsSignIn, setWantsSignIn] = useState(false);
  const [stepError, setStepError] = useState<unknown>(null);

  // A page loaded in the middle of a sequence takes it up where the API
  // says it stands.
  const answered = stateQuery.data?.operation ?? null;
  useEffect(() => {
    setOperation(answered);
  }, [answered]);

  const took = useCallback(
    (view: Operation) => {
      setStepError(null);
      setOperation(view);
      if (view.waitsForPerson) {
        void queryClient.invalidateQueries({ queryKey: ["state", coordinate] });
        void queryClient.invalidateQueries({ queryKey: ["overview"] });
        void queryClient.invalidateQueries({ queryKey: ["store", "session"] });
      }
    },
    [queryClient, coordinate],
  );

  const start = useMutation({
    mutationFn: (body: StartRequest) => startOperation(coordinate, body),
    onSuccess: took,
    onError: (error) => {
      setStepError(error);
      if (problemOf(error).code === "store-sign-in-required") {
        void queryClient.invalidateQueries({ queryKey: ["store", "session"] });
        setWantsSignIn(true);
      }
    },
  });
  const advance = useMutation({
    mutationFn: (body: AdvanceRequest | undefined) => advanceOperation(coordinate, body),
    onSuccess: took,
    onError: (error) => {
      setStepError(error);
      if (problemOf(error).code === "no-operation") {
        // The API no longer holds this sequence. Where things stand is what
        // the store and the cluster say.
        setOperation(null);
        void queryClient.invalidateQueries({ queryKey: ["state", coordinate] });
      }
    },
  });
  const stop = useMutation({
    mutationFn: () => stopOperation(coordinate),
    onSuccess: (state: AppStateAnswer) => {
      setOperation(null);
      setStepError(null);
      queryClient.setQueryData(["state", coordinate], state);
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  const credential = useMutation({ mutationFn: (id: string) => setCredential(id, false) });

  // The next step, after the wait the API named. One request at a time.
  const { mutate: step, isPending: stepping } = advance;
  const failedStep = stepError !== null;
  useEffect(() => {
    if (!operation || operation.waitsForPerson || stepping || failedStep) return;
    const timer = window.setTimeout(() => step(undefined), Math.max(operation.waitSeconds, 0.4) * 1000);
    return () => window.clearTimeout(timer);
  }, [operation, stepping, failedStep, step]);

  const state = stateQuery.data;
  const standing = session?.signedIn ? session.standing : null;
  const refused = standing !== null && !standing.served;
  const signedIn = session?.signedIn === true;
  const busy = start.isPending || advance.isPending || stop.isPending;

  const begin = (mode: "install" | "update", everyone: boolean) => {
    setDialog(null);
    setStepError(null);
    start.mutate({
      mode,
      forEveryone: everyone,
      expectedDigest: latest.digest,
      ...(mode === "update" ? { version: latest.version } : {}),
      ...(state?.acquisition ? { acquisitionId: state.acquisition.id } : {}),
    });
  };

  const ask = (mode: "install" | "update") => {
    if (!signedIn) {
      setWantsSignIn(true);
      return;
    }
    setDialog(mode);
  };

  let body: React.ReactNode;
  if (operation) {
    body = (
      <Progress
        detail={detail}
        operation={operation}
        storeName={storeName}
        busy={busy}
        error={stepError}
        onAdvance={(request) => {
          setStepError(null);
          advance.mutate(request);
        }}
        onStop={() => stop.mutate()}
      />
    );
  } else if (stateQuery.isLoading) {
    body = <p className="admin-console__loading">{t("install.loadingState")}</p>;
  } else if (!state) {
    body = <ProblemNote error={stateQuery.error} />;
  } else {
    const installed = state.installed;
    const updateAvailable = installed !== null && installed.digest !== null && installed.digest !== latest.digest;
    body = (
      <>
        {Object.entries(state.clusterProblems).map(([service, problem]) => (
          <ProblemNote key={service} problem={problem} />
        ))}
        {state.storeProblem ? <ProblemNote problem={state.storeProblem} /> : null}

        {installed ? (
          <>
            <p className="store-install__status">
              <span className={`admin-console__badge admin-console__badge--${state.stage === "ready" ? "ok" : state.stage === "failing" ? "danger" : "info"}`}>
                {t(`stage.${state.stage}`)}
              </span>
              {installed.forEveryone ? <span className="admin-console__chip">{t("install.forEveryone")}</span> : null}
            </p>
            {installed.digest ? (
              <p className="admin-console__meta">
                {t("install.pinnedBuild")} <span className="admin-console__mono" title={installed.digest}>{shortDigest(installed.digest)}</span>
              </p>
            ) : (
              <p className="admin-console__meta">{t("install.notPinned")}</p>
            )}
            {state.stage !== "ready" ? <ClusterState state={state.state} /> : null}
            {state.stage === "ready" ? <p className="admin-console__meta">{t("install.doneTile")}</p> : null}
            {state.stage === "failing" && state.acquisition && state.acquisition.repositories.length > 0 ? (
              <div className="admin-console__actions">
                <button
                  type="button"
                  className="admin-console__btn"
                  disabled={credential.isPending}
                  onClick={() => state.acquisition && credential.mutate(state.acquisition.id)}
                >
                  {t("credential.setAgain")}
                </button>
              </div>
            ) : null}
            {credential.data ? <CredentialOutcomeNote outcome={credential.data} /> : null}
            {credential.error ? <ProblemNote error={credential.error} /> : null}
            {updateAvailable ? (
              <div className="store-notice" role="note">
                <p className="store-notice__title">{t("install.updateAvailable", { version: latest.version })}</p>
                {state.acquisition ? (
                  <div className="admin-console__actions">
                    <button type="button" className="admin-console__btn admin-console__btn--primary" disabled={busy || refused} onClick={() => ask("update")}>
                      {t("install.updateAction")}
                    </button>
                  </div>
                ) : (
                  <p className="store-notice__text">{signedIn ? t("install.updateNeedsAcquisition") : t("install.updateNeedsSignIn")}</p>
                )}
              </div>
            ) : null}
            <p className="admin-console__meta">
              {t("install.administeredInConsole")}{" "}
              <ExternalLink href={contextQuery.data?.adminConsoleUrl}>{t("install.openAdminConsole")}</ExternalLink>
            </p>
          </>
        ) : (
          <>
            {state.stage === "acquired" ? <p className="admin-console__lead">{t("install.acquiredNotInstalled")}</p> : null}
            {state.stage === "checkout" ? <p className="admin-console__lead">{t("install.checkoutOpen", { store: storeName })}</p> : null}
            <div className="admin-console__actions">
              <button
                type="button"
                className="admin-console__btn admin-console__btn--primary"
                disabled={busy || refused}
                onClick={() => ask("install")}
              >
                {state.stage === "checkout" ? t("install.continue") : t("install.installAction")}
              </button>
            </div>
            {refused ? <p className="admin-console__hint">{t("install.refusedByStore")}</p> : null}
            {state.stage === "not-installed" ? <p className="admin-console__meta">{t("install.twoWays")}</p> : null}
          </>
        )}

        {wantsSignIn && !signedIn ? <StoreSignIn reason={t("session.neededToAcquire", { store: storeName })} storeName={storeName} /> : null}
        {stepError ? <ProblemNote error={stepError} /> : null}
      </>
    );
  }

  return (
    <aside className="store-install">
      <h2 className="admin-console__subsection-title">{t("install.heading")}</h2>
      {body}
      {dialog ? (
        <InstallDialog
          detail={detail}
          version={latest}
          update={dialog === "update"}
          onClose={() => setDialog(null)}
          onConfirm={(everyone) => begin(dialog, everyone)}
        />
      ) : null}
    </aside>
  );
}
