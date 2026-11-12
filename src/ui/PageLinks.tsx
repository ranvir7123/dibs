import { Icon } from "./Icon";

/** A link short enough for a narrow column: the site, then the last part of the address. The full link is in the tooltip. */
function shortLink(link: string): string {
  const plain = link.replace(/^https?:\/\/(www\.)?/i, "");
  if (plain.length <= 34) return plain;
  const [site, ...parts] = plain.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  return last && parts.length > 1 ? `${site}/…/${last}` : plain;
}

/**
 * The links a worker handed in for a job where Dibs opens each page itself,
 * one per line. Shown where a video or recording would be on other jobs.
 */
export function PageLinks({ links }: { links: string[] }) {
  return (
    <div className="rules">
      <h3>{links.length === 1 ? "Page handed in" : "Pages handed in"}</h3>
      {links.map((link) => (
        <div className="linkbox" key={link}>
          <Icon name="link" />
          <code>
            <a className="textlink" href={link} target="_blank" rel="noopener noreferrer" title={link}>
              {shortLink(link)}
              <span className="hide"> (opens in a new tab)</span>
            </a>
          </code>
        </div>
      ))}
    </div>
  );
}
