/**
 * When to ask an account with an empty library what's stopping it from tagging:
 * from the second UTC day the Tagify page opens, once per account, until it's answered or dismissed.
 * Only days and the done flag are stored, on this device.
 */
const PREFIX = "tagify:getting-started-question:v1:";

export const START_REASONS = [
  { value: "not_sure_where_to_start", label: "I'm not sure where to start" },
  { value: "library_too_big", label: "My library feels too big to tag" },
  { value: "just_looking", label: "I was just looking around" },
  { value: "something_broke", label: "Something didn't work" },
  { value: "other", label: "Something else" },
] as const;
export type StartReason = typeof START_REASONS[number]["value"];

interface QuestionState { firstDay?: string; secondDay?: string; done?: boolean }

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function read(account: string): QuestionState {
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + account) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}

function save(account: string, state: QuestionState): void {
  try { localStorage.setItem(PREFIX + account, JSON.stringify(state)); }
  catch { /* Without storage the question simply isn't asked again this session. */ }
}

/** Notes today's opening and says whether the question is due. Call once per opening of the Tagify page. */
export function noteOpeningAndCheckDue(account: string, now = Date.now()): boolean {
  const state = read(account);
  if (state.done) return false;
  const day = today(now);
  if (!state.firstDay) { save(account, { firstDay: day }); return false; }
  if (!state.secondDay && day > state.firstDay) save(account, { ...state, secondDay: day });
  return day > state.firstDay;
}

/** Answered or dismissed: never ask this account again on this device. */
export function finishQuestion(account: string): void {
  save(account, { ...read(account), done: true });
}
