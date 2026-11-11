/**
 * A plain "no" with a sentence a person can read (unknown job, not approved
 * yet, job not open). Trying the same thing again would give the same answer.
 * Anything else that goes wrong is a fault worth another try.
 */
export class MoneyRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyRefusal";
  }
}