import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { EmailCodeError } from "@/services/sync/SyncPairingService";
import { communityErrorMessage } from "./communitySyncCopy";
import { communityPairing, type CommunityPairingState } from "./communityPairing";
// eslint-disable-next-line css-modules/no-unused-class -- the spinner is shared with the browser waiting screen
import waitingStyles from "./CommunityConnectWaiting.module.css";
import styles from "./CommunityEmailSignIn.module.css";

const CODE_LENGTH = 6;
const INVALID_EMAIL = "Enter your email address, like name@example.com.";

interface CommunityEmailSignInProps {
  pairing: CommunityPairingState;
  heading?: string;
  description?: string;
  /** Apple sign-in and the browser fallback both finish on the website's page. */
  onUseBrowser: (method: "apple" | "browser") => void;
}

/**
 * Signing in or creating a Tagify account without leaving Tagify: email, then the 6-digit code
 * Community emails. The same code creates the account for someone new.
 */
export function CommunityEmailSignIn({ pairing, heading = "Create account or sign in", description, onUseBrowser }: CommunityEmailSignInProps) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const now = useNow(resendAt);
  const codeInput = useRef<HTMLInputElement>(null);
  const verifying = pairing.checking && step === "code";
  const startFailed = !pairing.pending && !pairing.starting && Boolean(pairing.error);
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => { if (step === "code") codeInput.current?.focus(); }, [step]);

  const send = async () => {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError(INVALID_EMAIL);
      return;
    }
    setSending(true);
    setError("");
    try {
      const { resendAfter } = await communityPairing.sendEmailCode(address);
      setResendAt(Date.now() + resendAfter * 1000);
      setCode("");
      setStep("code");
    } catch (failure) {
      if (failure instanceof EmailCodeError && failure.code === "rate_limited") {
        setResendAt(Date.now() + (failure.retryAfter ?? 60) * 1000);
        setError("Too many codes were sent. Wait a moment, then send again.");
      } else if (failure instanceof EmailCodeError && failure.code === "invalid_request") {
        setError(INVALID_EMAIL);
      } else {
        setError(communityErrorMessage(failure, "Couldn't send the code. Please try again."));
      }
    } finally {
      setSending(false);
    }
  };

  const verify = async (value: string) => {
    if (value.length !== CODE_LENGTH || pairing.checking) return;
    setError("");
    try {
      await communityPairing.verifyEmailCode(email.trim(), value);
    } catch (failure) {
      setCode("");
      if (failure instanceof EmailCodeError && failure.code === "expired_token") {
        setResendAt(0);
        setError("That code can't be used anymore. Send a new code.");
      } else if (failure instanceof EmailCodeError && failure.code === "invalid_code") {
        setError(failure.attemptsRemaining === 1 ? "That code isn't right. You have 1 try left." : "That code isn't right. Check the email and try again.");
      } else {
        setError(communityErrorMessage(failure, "Couldn't check the code. Please try again."));
      }
      codeInput.current?.focus();
    }
  };

  const changeCode = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void verify(digits);
  };

  return (
    <div className={styles.signIn}>
      {step === "email" ? <>
        <div className={styles.intro}>
          <h3 className={styles.heading}>{heading}</h3>
          {description ? <p className={styles.description}>{description}</p> : null}
          <p className={styles.hint}>New here? This creates your free Tagify account. It&apos;s not your Spotify login.</p>
        </div>
        <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <label className={styles.label} htmlFor="tagify-account-email">Email</label>
          <div className={styles.row}>
            <input id="tagify-account-email" className={styles.input} type="email" autoComplete="email" inputMode="email"
              placeholder="name@example.com" value={email} autoFocus disabled={sending}
              onChange={(event) => { setEmail(event.target.value); setError(""); }} />
            <button type="submit" className={styles.primary} disabled={sending || pairing.starting || startFailed || resendIn > 0}>
              {sending ? <Loader2 size={16} className={waitingStyles.spinner} aria-hidden="true" /> : null}
              {resendIn > 0 ? `Send code in ${resendIn}s` : "Send code"}
            </button>
          </div>
        </form>
        <div className={styles.divider} aria-hidden="true"><span>or</span></div>
        <div className={styles.alternatives}>
          <button type="button" className={styles.secondary} disabled={!pairing.pending} onClick={() => onUseBrowser("apple")}><AppleLogo /> Continue with Apple</button>
          <button type="button" className={styles.link} disabled={!pairing.pending} onClick={() => onUseBrowser("browser")}>Use my browser instead</button>
        </div>
      </> : <>
        <div className={styles.intro}>
          <h3 className={styles.heading}>Check your email</h3>
          <p className={styles.description}>Enter the 6-digit code we sent to <strong>{email.trim()}</strong>.</p>
        </div>
        <form className={styles.form} noValidate onSubmit={(event) => { event.preventDefault(); void verify(code); }}>
          <label className={styles.label} htmlFor="tagify-account-code">Code</label>
          <div className={styles.row}>
            <input id="tagify-account-code" ref={codeInput} className={`${styles.input} ${styles.code}`} type="text" inputMode="numeric"
              autoComplete="one-time-code" maxLength={CODE_LENGTH + 4} value={code} disabled={verifying} placeholder="000000"
              onChange={(event) => { changeCode(event.target.value); if (error) setError(""); }} />
            <button type="submit" className={styles.primary} disabled={verifying || code.length !== CODE_LENGTH}>
              {verifying ? <Loader2 size={16} className={waitingStyles.spinner} aria-hidden="true" /> : null}
              {verifying ? "Checking…" : "Continue"}
            </button>
          </div>
        </form>
        <p className={styles.hint}>Can&apos;t find it? Check your spam folder.</p>
        <div className={styles.codeLinks}>
          <button type="button" className={styles.link} disabled={sending || resendIn > 0 || verifying} onClick={() => void send()}>
            {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
          </button>
          <button type="button" className={styles.link} disabled={verifying} onClick={() => { setStep("email"); setCode(""); setError(""); }}>Use a different email</button>
        </div>
      </>}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {startFailed && !error ? <p className={styles.error} role="alert">{pairing.error}</p> : null}
      {startFailed ? <div className={styles.footer}>
        <button type="button" className={styles.secondary} onClick={() => void communityPairing.start(pairing.entry ?? "community", { inApp: true })}>Try again</button>
      </div> : null}
    </div>
  );
}

function AppleLogo() {
  return <svg className={styles.appleLogo} viewBox="0 0 17 20" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M14.04 10.63c-.02-2.28 1.86-3.38 1.95-3.43-1.06-1.55-2.71-1.77-3.3-1.79-1.4-.14-2.74.83-3.45.83-.71 0-1.81-.81-2.97-.79-1.53.02-2.94.89-3.73 2.26-1.59 2.76-.41 6.85 1.14 9.09.76 1.1 1.66 2.33 2.85 2.29 1.14-.05 1.57-.74 2.95-.74 1.38 0 1.77.74 2.97.71 1.23-.02 2-1.11 2.75-2.22.87-1.27 1.22-2.5 1.24-2.57-.03-.01-2.38-.91-2.4-3.64ZM11.77 3.94c.63-.76 1.05-1.82.94-2.88-.91.04-2 .6-2.65 1.36-.58.67-1.09 1.75-.95 2.79 1 .08 2.03-.51 2.66-1.27Z" />
  </svg>;
}

/** Ticks once a second while a countdown runs. */
function useNow(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return now;
}
