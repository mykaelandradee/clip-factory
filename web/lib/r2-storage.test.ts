import { describe, expect, it } from "vitest";
import { deleteItemFolder, itemFolder } from "./r2-storage";

describe("deleteItemFolder", () => {
  it("only accepts a single item's folder", async () => {
    for (const prefix of ["", "influencer", "influencer/u/libraries/l", "influencer/u/libraries/l/not-a-uuid", "../x", "other/u/libraries/l/" + "a".repeat(36)]) {
      await expect(deleteItemFolder(prefix)).rejects.toThrow("Prefixo de item inválido.");
    }
  });

  it("builds the item folder like the worker", () => {
    expect(itemFolder("u", "l", "11111111-2222-3333-4444-555555555555")).toBe("influencer/u/libraries/l/11111111-2222-3333-4444-555555555555");
  });
});
