import Link from "next/link";
import { Empty } from "@/ui/States";

// Shown inside the window for an address that leads nowhere, such as a job that does not exist.
export default function NotFound() {
  return (
    <Empty
      icon="jobs"
      title="We could not find that"
      action={
        <Link href="/" className="btn main-b">
          Back to the jobs
        </Link>
      }
    >
      The link may be old, or the job may have been removed.
    </Empty>
  );
}
