/**
 * The people the "who are you" screen offers. Server code only.
 *
 * The contract has no "list everyone" read, so the list is put together from
 * what it does give: the posters on the board, the workers on those jobs, and
 * the people this browser has joined as.
 */
import { getBoard, getJobPage, getPerson } from "@/contract";
import type { Person } from "@/contract/types";
import { getKnownIds } from "./viewer";

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

  // People this browser joined as, and whoever is chosen now, even if they have done nothing yet.
  const extraIds = [...(await getKnownIds()), ...(viewer ? [viewer.id] : [])].filter((id) => !choices.has(id));
  const extras = await Promise.all([...new Set(extraIds)].map((id) => getPerson(id)));
  for (const person of extras) {
    if (person) choices.set(person.id, { person, does: "New here" });
  }

  return [...choices.values()];
}
