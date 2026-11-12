import { describe, expect, it } from "vitest";
import { tidyAddress } from "./links";

describe("tidyAddress: one form for the same page", () => {
  it("ignores www., capital letters in the site's name, a / at the end, and anything after ? or #", () => {
    const plain = tidyAddress("https://townpages.example/saffron-lane-cafe");
    expect(plain).toBe("townpages.example/saffron-lane-cafe");
    for (const same of [
      "https://www.townpages.example/saffron-lane-cafe",
      "https://TownPages.Example/saffron-lane-cafe/",
      "http://townpages.example/saffron-lane-cafe?x=1",
      "https://townpages.example/saffron-lane-cafe/?utm_source=a&x=2#hours",
      "https://townpages.example:443/saffron-lane-cafe",
      "http://townpages.example:80/saffron-lane-cafe//",
    ]) {
      expect(tidyAddress(same)).toBe(plain);
    }
  });

  it("keeps different pages apart", () => {
    expect(tidyAddress("https://townpages.example/other-cafe")).not.toBe(tidyAddress("https://townpages.example/saffron-lane-cafe"));
    expect(tidyAddress("https://townpages.example:8443/saffron-lane-cafe")).toBe("townpages.example:8443/saffron-lane-cafe");
    expect(tidyAddress("https://townpages.example/Saffron-Lane-Cafe")).not.toBe(tidyAddress("https://townpages.example/saffron-lane-cafe")); // the path keeps its capital letters
    expect(tidyAddress("https://townpages.example")).toBe("townpages.example");
  });

  it("gives back text that is not a web link, in small letters", () => {
    expect(tidyAddress("  Not A Link ")).toBe("not a link");
  });
});
