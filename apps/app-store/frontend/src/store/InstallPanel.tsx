import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { problemOf, type Problem } from "@/api/client";
import { Link } from "@tanstack/react-router";
import {
  advanceOperation,
  fetchApp,
  fetchAppState,
  fetchContext,
  removeAddon,
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
import { Approvals } from "@/store/Approvals";
import { coordinateParams } from "@/store/BrowsePage";
import { ExternalLink, giveBackLink, PriceText, ProblemNote, shortDigest, StoreSignIn } from "@/store/parts";
import { useStoreSession } from "@/store/session";
import { StoreMarkdown } from "@/store/StoreMarkdown";

const mono = { mono: <span className="admin-console__mono" /> };

/** The steps of a sequence, in the order they are taken. */
const STEPS: Stage[] = ["acquire", "checkout", "declare", "credential", "install", "addons", "metering", "approvals", "rollout"];

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
  metering: "metering",
  "metering-timeout": "metering",
  approvals: "approvals",
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
  addons,
  onConfirm,
  onClose,
}: {
  detail: AppDetail;
  version: Version;
  update: boolean;
  /** The names of the add-ons ticked to be installed with it. */
  addons: string[];
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

        {!update && addons.length > 0 ? (
          <p className="admin-console__lead">{t("addons.withTheApp", { addons: addons.join(", ") })}</p>
        ) : null}

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
    // An add-on is not installed apart: its build is pinned in its app.
    if (step === "install") return !operation.addonOf;
    if (step === "addons") return Boolean(operation.addonOf) || (operation.build?.addons.length ?? 0) > 0;
    // Only an app priced by use has one, and nothing says so before it is reached.
    if (step === "metering") return operation.stage === "metering" || operation.stage === "metering-timeout";
    // Only an app that asks for more than the default posture has one, and
    // the cluster says so once the install reaches it.
    if (step === "approvals") return operation.stage === "approvals" || (operation.rollout?.pendingPrivilegeApprovals?.length ?? 0) > 0;
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
  base,
  onAdvance,
  onStop,
  busy,
  error,
}: {
  detail: AppDetail;
  operation: Operation;
  storeName: string;
  /** For an add-on's sequence: the app it goes in, whose rollout and approvals it waits on. */
  base?: { coordinate: string; name: string };
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

      {stage === "checkout" && !operation.checkout ? (
        <>
          <p className="admin-console__lead">
            {operation.acquisition?.waitingFor === "approval"
              ? t("install.approvalLead", { store: storeName })
              : t("install.confirmingLead", { store: storeName })}
          </p>
          <div className="admin-console__actions">
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.stopWaiting")}
            </button>
          </div>
        </>
      ) : null}

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

      {stage === "metering" ? <p className="admin-console__lead">{t("install.settingMetering")}</p> : null}

      {stage === "metering-timeout" ? (
        <div className="admin-console__warning" role="alert">
          <p className="store-notice__title">{t("install.meteringNotArrivedTitle")}</p>
          <p className="store-notice__text">{t("install.meteringNotArrivedBody")}</p>
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
      {stage === "addons" ? (
        <p className="admin-console__lead">{base ? t("addons.pinning", { app: base.name }) : t("install.pinningAddons")}</p>
      ) : null}

      {stage === "approvals" && operation.rollout ? (
        <Approvals
          coordinate={base?.coordinate ?? operation.coordinate}
          approvals={operation.rollout.pendingPrivilegeApprovals ?? []}
          onChanged={() => onAdvance()}
        />
      ) : null}

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

      {stage === "done" && base ? (
        <div className="admin-console__success" role="status">
          <p className="store-notice__title">{t("addons.doneTitle", { addon: detail.name, app: base.name })}</p>
          <p className="store-notice__text">{t("addons.doneBody", { app: base.name })}</p>
          <div className="admin-console__actions">
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onStop}>
              {t("install.close")}
            </button>
          </div>
        </div>
      ) : null}

      {stage === "done" && !base ? (
        <div className="admin-console__success" role="status">
          <p className="store-notice__title">{t("install.doneTitle", { app: detail.name })}</p>
          <p className="store-notice__text">{t("install.doneTile")}</p>
          {operation.tile?.outcome === "failed" ? (
            <p className="store-notice__text">
              {operation.tile.problem?.detail
                ? t("install.tileNotCopiedBecause", { detail: operation.tile.problem.detail })
                : t("install.tileNotCopied")}
            </p>
          ) : null}
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
 * One entry's sequence, as a screen drives it: start it, ask for the next
 * step after the wait the API named, one request at a time, stop it.
 *
 * `base` is the coordinate whose state the sequence changes -- the entry's
 * own, or for an add-on the app it goes in -- and is looked at again
 * whenever the sequence waits for the person.
 */
function useSequence(coordinate: string, base: string, answered: Operation | null) {
  const queryClient = useQueryClient();
  const [operation, setOperation] = useState<Operation | null>(null);
  const [wantsSignIn, setWantsSignIn] = useState(false);
  const [stepError, setStepError] = useState<unknown>(null);

  // A page loaded in the middle of a sequence takes it up where the API
  // says it stands.
  useEffect(() => {
    setOperation(answered);
  }, [answered]);

  const took = useCallback(
    (view: Operation) => {
      setStepError(null);
      setOperation(view);
      if (view.waitsForPerson) {
        void queryClient.invalidateQueries({ queryKey: ["state", base] });
        void queryClient.invalidateQueries({ queryKey: ["overview"] });
        void queryClient.invalidateQueries({ queryKey: ["store", "session"] });
      }
    },
    [queryClient, base],
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
        void queryClient.invalidateQueries({ queryKey: ["state", base] });
      }
    },
  });
  const stop = useMutation({
    mutationFn: () => stopOperation(coordinate),
    onSuccess: (state: AppStateAnswer) => {
      setOperation(null);
      setStepError(null);
      if (base === coordinate) queryClient.setQueryData(["state", coordinate], state);
      else void queryClient.invalidateQueries({ queryKey: ["state", base] });
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  // The next step, after the wait the API named. One request at a time.
  const { mutate: step, isPending: stepping } = advance;
  const failedStep = stepError !== null;
  useEffect(() => {
    if (!operation || operation.waitsForPerson || stepping || failedStep) return;
    const timer = window.setTimeout(() => step(undefined), Math.max(operation.waitSeconds, 0.4) * 1000);
    return () => window.clearTimeout(timer);
  }, [operation, stepping, failedStep, step]);

  return {
    operation,
    start,
    advance,
    stop,
    stepError,
    setStepError,
    wantsSignIn,
    setWantsSignIn,
    busy: start.isPending || advance.isPending || stop.isPending,
  };
}

/** The add-on half of a coordinate: the name its app's list has it under. */
const nameOf = (coordinate: string) => coordinate.split("/", 2)[1] ?? coordinate;

/** Where an app's sequence has pinned its own build and add-ons: one may go in beside them. */
const PINNED: Stage[] = ["metering", "metering-timeout", "approvals", "rollout", "failing", "done"];

/**
 * The add-ons of an app that is not installed yet, to tick before Install:
 * each is installed with the app, after it.
 */
function AddonChoice({
  addons,
  chosen,
  onChange,
}: {
  addons: AppDetail["addons"];
  chosen: string[];
  onChange: (chosen: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="admin-console__fieldset admin-console__fieldset--plain store-addons">
      <legend className="admin-console__group-title">{t("addons.chooseTitle")}</legend>
      {addons.map((addon) => (
        <label key={addon.coordinate} className="admin-console__checkbox">
          <input
            type="checkbox"
            checked={chosen.includes(addon.coordinate)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...chosen, addon.coordinate]
                  : chosen.filter((coordinate) => coordinate !== addon.coordinate),
              )
            }
          />
          <span>
            {addon.name}
            {addon.summary ? <span className="admin-console__meta">{" — "}{addon.summary}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * One add-on of an installed app: whether the app has it on, and the one act
 * that changes that. Installing is the add-on's own sequence -- acquired at
 * the store, checkout and approvals included -- shown in place.
 */
function AddonRow({
  addon,
  base,
  on,
  answered,
  queued,
  autoStart,
  storeName,
  onSettled,
}: {
  addon: AppDetail["addons"][number];
  base: AppDetail;
  on: boolean;
  answered: Operation | null;
  /** Ticked with the app's install, and not gone in yet. */
  queued: boolean;
  /** Its turn: start without being asked. */
  autoStart: boolean;
  storeName: string;
  /** Its build is pinned, or it stopped: the next one may go. */
  onSettled: (coordinate: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { session } = useStoreSession();
  const signedIn = session?.signedIn === true;
  const detailQuery = useQuery({
    queryKey: ["store", "app", addon.coordinate],
    queryFn: () => fetchApp(addon.coordinate),
    retry: false,
  });
  const sequence = useSequence(addon.coordinate, base.coordinate, answered);
  const { operation, start, advance, stop, busy, stepError, setStepError } = sequence;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = useMutation({
    mutationFn: () => removeAddon(base.coordinate, addon.coordinate),
    onSuccess: () => {
      setConfirmRemove(false);
      void queryClient.invalidateQueries({ queryKey: ["state", base.coordinate] });
    },
  });

  const detail = detailQuery.data;
  const latest = detail?.versions[0];
  const begin = useCallback(() => {
    if (!latest) return;
    setStepError(null);
    start.mutate({ mode: "install", forEveryone: false, expectedDigest: latest.digest, addonOf: base.coordinate });
  }, [latest, start, setStepError, base.coordinate]);

  // Ticked before Install: started once, when its turn comes.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || operation || on || !latest) return;
    started.current = true;
    begin();
  }, [autoStart, operation, on, latest, begin]);

  // Its turn ends once its build is pinned in the app, or it stopped.
  useEffect(() => {
    if (!autoStart) return;
    if ((operation && (operation.addons || operation.stage === "failed")) || stepError || (on && !operation)) {
      onSettled(addon.coordinate);
    }
  }, [autoStart, operation, stepError, on, onSettled, addon.coordinate]);

  return (
    <li className="store-addon">
      <div className="store-addon__head">
        <div className="store-addon__main">
          <p className="admin-console__card-title">
            <Link to="/app/$catalogue/$app" params={coordinateParams(addon.coordinate)} className="admin-console__btn-link">
              {addon.name}
            </Link>
          </p>
          {detail ? (
            <p className="admin-console__meta">
              <PriceText price={detail.price} />
            </p>
          ) : null}
        </div>
        {operation ? null : on ? (
          <div className="store-addon__act">
            <span className="admin-console__badge admin-console__badge--ok">{t("addons.on")}</span>
            <button
              type="button"
              className="admin-console__btn admin-console__btn--quiet"
              disabled={remove.isPending}
              onClick={() => setConfirmRemove(true)}
            >
              {t("addons.remove")}
            </button>
          </div>
        ) : (
          <div className="store-addon__act">
            <button
              type="button"
              className="admin-console__btn"
              disabled={busy || !latest || queued}
              onClick={() => (signedIn ? begin() : sequence.setWantsSignIn(true))}
            >
              {queued ? t("addons.queued") : t("addons.install")}
            </button>
          </div>
        )}
      </div>

      {confirmRemove && !operation ? (
        <div className="admin-console__warning" role="alert">
          <p className="store-notice__text">{t("addons.removeBody", { addon: addon.name, app: base.name })}</p>
          <div className="admin-console__actions">
            <button type="button" className="admin-console__btn admin-console__btn--danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t("addons.removeAction")}
            </button>
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={() => setConfirmRemove(false)}>
              {t("install.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {remove.error ? <ProblemNote error={remove.error} /> : null}

      {operation && detail ? (
        <Progress
          detail={detail}
          operation={operation}
          storeName={storeName}
          base={{ coordinate: base.coordinate, name: base.name }}
          busy={busy}
          error={stepError}
          onAdvance={(request) => {
            setStepError(null);
            advance.mutate(request);
          }}
          onStop={() => stop.mutate()}
        />
      ) : stepError ? (
        <ProblemNote error={stepError} />
      ) : null}
      {sequence.wantsSignIn && !signedIn ? <StoreSignIn reason={t("session.neededToAcquire", { store: storeName })} storeName={storeName} /> : null}
      {detailQuery.error ? <ProblemNote error={detailQuery.error} /> : null}
    </li>
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

  const [dialog, setDialog] = useState<"install" | "update" | null>(null);
  // The add-ons ticked before Install, and those still to go in after it.
  const [chosen, setChosen] = useState<string[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  const sequence = useSequence(coordinate, coordinate, stateQuery.data?.operation ?? null);
  const { operation, start, advance, stop, busy, stepError, setStepError, wantsSignIn, setWantsSignIn } = sequence;
  const credential = useMutation({ mutationFn: (id: string) => setCredential(id, false) });

  const state = stateQuery.data;
  const standing = session?.signedIn ? session.standing : null;
  const refused = standing !== null && !standing.served;
  const signedIn = session?.signedIn === true;

  const begin = (mode: "install" | "update", everyone: boolean) => {
    setDialog(null);
    setStepError(null);
    if (mode === "install") setQueued(chosen);
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

  const settled = useCallback((addon: string) => setQueued((now) => now.filter((c) => c !== addon)), []);

  // The app's add-ons are offered once git has the app and its own sequence
  // has pinned what it pins: one at a time, as the director replaces the list whole.
  const installed = state?.installed ?? null;
  const appPinned = (installed !== null || Boolean(operation?.install)) && (!operation || PINNED.includes(operation.stage));
  const activeAddons = installed?.addons ?? [];
  const addonOperations = state?.addonOperations ?? [];
  const addonsSection =
    detail.addons.length > 0 && appPinned ? (
      <section className="store-addons">
        <h3 className="admin-console__group-title">{t("app.addons")}</h3>
        <ul className="store-addons__list">
          {detail.addons.map((addon) => (
            <AddonRow
              key={addon.coordinate}
              addon={addon}
              base={detail}
              on={activeAddons.includes(nameOf(addon.coordinate))}
              answered={addonOperations.find((op) => op.coordinate === addon.coordinate) ?? null}
              queued={queued.includes(addon.coordinate)}
              autoStart={queued[0] === addon.coordinate}
              storeName={storeName}
              onSettled={settled}
            />
          ))}
        </ul>
      </section>
    ) : null;

  let body: React.ReactNode;
  if (operation) {
    body = (
      <Progress
        detail={detail}
        operation={operation}
        storeName={storeName}
        // An add-on's sequence, looked at from the add-on's own page.
        base={operation.addonOf && detail.addonOf ? { coordinate: detail.addonOf, name: detail.addonOf } : undefined}
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
  } else if (detail.addonOf) {
    // An add-on goes in its app, and is installed from that app's page.
    body = (
      <p className="admin-console__lead">
        {t("addons.installedFromApp")}{" "}
        <Link to="/app/$catalogue/$app" params={coordinateParams(detail.addonOf)} className="admin-console__btn-link">
          {t("addons.openApp")}
        </Link>
      </p>
    );
  } else {
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
            {state.stage === "installing" && (state.state?.pendingPrivilegeApprovals?.length ?? 0) > 0 ? (
              // The same step as in a sequence under way: a page opened
              // again shows what the app waits on and lets the person act.
              <Approvals
                coordinate={coordinate}
                approvals={state.state?.pendingPrivilegeApprovals ?? []}
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ["state", coordinate] })}
              />
            ) : null}
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
            {updateAvailable && !state.mayUpdate ? (
              <div className="store-notice" role="note">
                <p className="store-notice__title">{t("install.updateAvailable", { version: latest.version })}</p>
                <p className="store-notice__text">
                  {installed.updateMode === "latest" ? t("install.updateByPlatform") : t("install.updateByCluster")}
                </p>
              </div>
            ) : null}
            {updateAvailable && state.mayUpdate ? (
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
            {detail.addons.length > 0 ? <AddonChoice addons={detail.addons} chosen={chosen} onChange={setChosen} /> : null}
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

  // A community or maintained edition is not sold: where the panel of an
  // enterprise edition has its price, theirs says where to give back.
  const giveBack = giveBackLink(detail.edition, detail.links);

  return (
    <aside className={`store-install store-install--${detail.edition}`}>
      <h2 className="admin-console__subsection-title">{t("install.heading")}</h2>
      {body}
      {addonsSection}
      {giveBack ? (
        <div className="store-giveback">
          <a
            className="admin-console__btn store-giveback__btn"
            href={giveBack.url}
            target="_blank"
            rel="noopener noreferrer"
            title={giveBack.label ?? undefined}
          >
            {giveBack.rel === "donate" ? t("install.donate") : t("install.supportProject")}
          </a>
          {giveBack.label ? <p className="admin-console__meta store-giveback__label">{giveBack.label}</p> : null}
        </div>
      ) : null}
      {dialog ? (
        <InstallDialog
          detail={detail}
          version={latest}
          update={dialog === "update"}
          addons={dialog === "install" ? detail.addons.filter((a) => chosen.includes(a.coordinate)).map((a) => a.name) : []}
          onClose={() => setDialog(null)}
          onConfirm={(everyone) => begin(dialog, everyone)}
        />
      ) : null}
    </aside>
  );
}
