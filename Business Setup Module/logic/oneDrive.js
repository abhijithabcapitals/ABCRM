// Which folder of the client's OneDrive a form document goes to. The Client Module (clients-folder) files "Passport / ID" under KYC,
// "Bank Statement" under Bank Statements and anything else under Others. Pure, so it is tested.
const ID_TYPES = ["Passport", "Emirates visa", "Emirates ID", "Old visa", "Old Emirates ID"];

export function oneDriveType(formType) {
  if (ID_TYPES.includes(formType)) return "Passport / ID";
  if (formType === "Bank statement") return "Bank Statement";
  return "Other";
}

// What staff are told after a drop. saved and failed count files; reason is the first failure's sentence.
export function oneDriveNote({ saved, failed, reason }) {
  if (!saved && !failed) return null;
  if (!failed) return { tone: "ok", text: `${saved} file${saved === 1 ? "" : "s"} saved to the client's OneDrive folder.` };
  return { tone: "warn", text: `${failed} file${failed === 1 ? " was" : "s were"} not saved to OneDrive: ${reason || "the Client Module did not answer"}. They are stored in the CRM. Drop them again on the PC that runs the Client Module to copy them.` };
}
