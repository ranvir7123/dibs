/**
 * The people the "who are you" screen offers. Server code only.
 *
 * Posters on the board come first, then the workers on those jobs, then
 * everyone else who has joined (newest first), so the people set up for a
 * demo can be picked before they have done anything.
 */
import { getBoard, getJobPage, getPeople } from "@/contract";
import type { Person } from "@/contract/types";

export interface Choice {
  person: Person;
  /** One short line under the name. */
  does: string;
}

export async function listChoices(viewer: Person | null): Promise<Choice[]> {
  const board = await getBoard();
  const pages = await Promise.all(board.jobs.map((item) => getJobPage(item.job.id)));

  const posters = new Map<string, { person: Person; jobs: number }>();
  for (const item of board.jobs) {
    const seen = posters.get(item.poster.id);
    posters.set(item.poster.id, { person: item.poster, jobs: (seen?.jobs ?? 0) + 1 });
  }

  const workers = new Map<string, { person: Person; results: number }>();
  for (const page of pages) {
    for (const card of page?.results ?? []) {
      const seen = workers.get(card.worker.id);
      workers.set(card.worker.id, { person: card.worker, results: (seen?.results ?? 0) + 1 });
    }
  }

  const choices = new Map<string, Choice>();
  for (const { person, jobs } of posters.values()) {
    choices.set(person.id, { person, does: jobs === 1 ? "Posted 1 job" : `Posted ${jobs} jobs` });
  }
  for (const { person, results } of workers.values()) {
    if (!choices.has(person.id)) {
      choices.set(person.id, { person, does: results === 1 ? "Working on 1 job" : `Working on ${results} jobs` });
    }
  }

  // Everyone else: joined, but has posted and taken nothing that is on the board.
  for (const person of await getPeople()) {
    if (!choices.has(person.id)) choices.set(person.id, { person, does: "New here" });
  }
  if (viewer && !choices.has(viewer.id)) choices.set(viewer.id, { person: viewer, does: "New here" });

  return [...choices.values()];
}
