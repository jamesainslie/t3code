import { expect, it } from "vite-plus/test";

import * as BootService from "./bootService.ts";

it("reads the home of a boot service installed before the Lathe rename", () => {
  expect(
    BootService.bootServiceBaseDirOf("[Service]\nEnvironment=T3CODE_HOME=/home/theo/.t3f\n"),
  ).toBe("/home/theo/.t3f");
  expect(
    BootService.bootServiceBaseDirOf(
      "<dict><key>T3CODE_HOME</key>\n<string>/Users/theo/.t3f</string></dict>",
    ),
  ).toBe("/Users/theo/.t3f");
});
