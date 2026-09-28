import { createHash } from "node:crypto";

// Links a manager across seasons without storing their ESPN account id.
export const managerKey = ownerId => ownerId
  ? createHash("sha256").update(String(ownerId)).digest("hex").slice(0, 12)
  : null;
