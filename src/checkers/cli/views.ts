// Prints a public video's numbers, read from the video site.
//   npx tsx src/checkers/cli/views.ts "https://www.youtube.com/watch?v=jNQXAC9IVRw"
import "../../db/cli/env";
import { readVideoStats } from "../video-site";

const link = process.argv[2];
if (!link) {
  console.error('Give a video link, for example: npx tsx src/checkers/cli/views.ts "https://www.youtube.com/watch?v=jNQXAC9IVRw"');
  process.exit(1);
}
readVideoStats(link)
  .then((s) => {
    const n = (v: number | null) => (v === null ? "not shown" : v.toLocaleString("en-US"));
    console.log(`Video ${s.videoId}`);
    console.log(`Views:    ${n(s.views)}`);
    console.log(`Likes:    ${n(s.likes)}`);
    console.log(`Comments: ${n(s.comments)}`);
    console.log(`Length:   ${s.seconds === null ? "not shown" : `${s.seconds} seconds`}`);
    console.log(`Read from: ${s.source === "official" ? "the video site's official address (YOUTUBE_API_KEY)" : "the public page (no key)"}`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
