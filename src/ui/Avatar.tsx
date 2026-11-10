import { initial, tone } from "./format";

/** The round picture with a person's first letter, in the colour that goes with their name. */
export function Avatar({ name }: { name: string }) {
  return (
    <span className={`avatar ${tone(name)}`} aria-hidden="true">
      {initial(name)}
    </span>
  );
}
