"use server";

/**
 * Everything a screen can ask the server to do. Each one checks who is asking,
 * calls the contract's functions, and answers with either a move to another
 * page or one plain sentence saying what went wrong.
 */
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  callDibs,
  createJob,
  endJob,
  getJobPage,
  getMyWork,
  getPerson,
  handIn,
  joinDibs,
  objectToOpinion,
  startHold,
  writeJobCard,
} from "@/contract";
import { isNotBuilt, plainError } from "@/ui/errors";
import { getViewer, safeNext, setViewer } from "@/ui/viewer";

/** What a form gets back when it could not do what was asked. */
export interface FormState {
  error: string | null;
  /** True when the reason is a part of Dibs that is not built yet, so the screen can say "not yet" instead of "wrong". */
  notReady?: boolean;
  /** What the person typed, handed back so they do not lose it. */
  typed?: string;
  /** The same for the join form, which has two boxes. */
  typedName?: string;
  typedEmail?: string;
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

function failed(error: unknown, typed?: string): FormState {
  if (!isNotBuilt(error)) console.error(error);
  return { error: plainError(error), notReady: isNotBuilt(error), typed };
}

// ------------------------------------------------------------ who you are

/** Switch this browser to one of the people already on Dibs. */
export async function chooseWho(form: FormData): Promise<void> {
  const person = await getPerson(text(form, "personId"));
  if (person) await setViewer(person.id);
  redirect(safeNext(text(form, "next")));
}

/** Join with a name and the email your PayPal uses. No password. */
export async function joinUp(_previous: FormState, form: FormData): Promise<FormState> {
  const name = text(form, "name");
  const paypalEmail = text(form, "paypalEmail");
  const kept = { typedName: name, typedEmail: paypalEmail };
  if (!name) return { error: "Please give a name.", ...kept };
  if (name.length > 60) return { error: "Please keep the name under 60 letters.", ...kept };
  try {
    const person = await joinDibs({ name, paypalEmail });
    await setViewer(person.id, true);
  } catch (error) {
    return { ...failed(error), ...kept };
  }
  redirect(safeNext(text(form, "next")));
}

// ------------------------------------------------------------ taking a job

/** Call dibs on a job, then go to the page for handing in. */
export async function callDibsOn(_previous: FormState, form: FormData): Promise<FormState> {
  const jobId = text(form, "jobId");
  const viewer = await getViewer();
  if (!viewer) redirect(`/you?next=${encodeURIComponent(`/jobs/${jobId}`)}`);
  let claimId: string;
  try {
    const taken = await callDibs({ jobId, workerId: viewer.id });
    claimId = taken.claim.id;
  } catch (error) {
    return failed(error);
  }
  redirect(`/work/${claimId}`);
}

/** Hand in a link for a claim. */
export async function handInLink(_previous: FormState, form: FormData): Promise<FormState> {
  const claimId = text(form, "claimId");
  const url = text(form, "url");
  const viewer = await getViewer();
  if (!viewer) redirect(`/you?next=${encodeURIComponent(`/work/${claimId}`)}`);
  if (!/^https?:\/\/\S+\.\S+/i.test(url)) {
    return { error: "Please paste the full link, starting with https://", typed: url };
  }
  try {
    const mine = await getMyWork(viewer.id);
    if (!mine?.items.some((item) => item.claim.id === claimId)) {
      return { error: "This job was taken by someone else. Switch to the person who called dibs on it.", typed: url };
    }
    await handIn({ claimId, url });
  } catch (error) {
    return failed(error, url);
  }
  redirect(`/work?handed=${encodeURIComponent(claimId)}`);
}

// ------------------------------------------------------------ posting a job

/** Turn the typed sentence into a job card and keep it as a draft. No money moves here. */
export async function writeCard(_previous: FormState, form: FormData): Promise<FormState> {
  const sentence = text(form, "sentence");
  const viewer = await getViewer();
  if (!viewer) redirect(`/you?next=${encodeURIComponent("/post")}`);
  if (sentence.length < 12) return { error: "Say a little more: what result do you want, and how much will you pay?", typed: sentence };
  if (sentence.length > 600) return { error: "Please keep it under 600 letters. One or two sentences is enough.", typed: sentence };
  let jobId: string;
  try {
    const card = await writeJobCard({ sentence, posterName: viewer.name });
    const job = await createJob({ posterId: viewer.id, sentence, card });
    jobId = job.id;
  } catch (error) {
    return failed(error, sentence);
  }
  redirect(`/post/${jobId}`);
}

/** Send the poster to PayPal to approve the hold for a draft job. */
export async function holdMoney(_previous: FormState, form: FormData): Promise<FormState> {
  const jobId = text(form, "jobId");
  const viewer = await getViewer();
  if (!viewer) redirect(`/you?next=${encodeURIComponent(`/post/${jobId}`)}`);
  // redirect() works by throwing, so it is only ever called outside the try.
  let goTo: string;
  try {
    const page = await getJobPage(jobId);
    if (!page) return { error: "We could not find that job card. Please write it again." };
    if (page.job.posterId !== viewer.id) {
      return { error: `Only ${page.poster.name} can lock money for this job. Switch person to carry on.` };
    }
    if (page.job.status === "draft") {
      const hold = await startHold(jobId);
      goTo = hold.approveUrl;
    } else {
      // The money is already locked: show the job instead of holding twice.
      goTo = `/jobs/${jobId}`;
    }
  } catch (error) {
    return failed(error);
  }
  redirect(goTo);
}

// ------------------------------------------------------------ a poster objecting to AI's opinion

export async function objectTo(_previous: FormState, form: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) redirect("/you");
  try {
    await objectToOpinion({ resultId: text(form, "resultId"), posterId: viewer.id });
  } catch (error) {
    return failed(error);
  }
  refresh();
  return { error: null };
}

// ------------------------------------------------------------ a poster ending their job

/** End a job now: last checks, pay what was earned, then PayPal lets the rest of the hold go. */
export async function endThisJob(_previous: FormState, form: FormData): Promise<FormState> {
  const jobId = text(form, "jobId");
  const viewer = await getViewer();
  if (!viewer) redirect(`/you?next=${encodeURIComponent(`/jobs/${jobId}`)}`);
  try {
    const outcome = await endJob({ jobId, posterId: viewer.id });
    refresh();
    // Not finished at once: the job is closed to new work, and the page says what is still going on.
    return outcome.ended ? { error: null } : { error: outcome.note, notReady: true };
  } catch (error) {
    return failed(error);
  }
}
