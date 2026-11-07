// The wording of a login email. Pure, so it can be tested without a mail server.
export const SIGN_IN_URL = "https://crm-abcapital.pages.dev/";

export type CredentialMail = {
  audience: "client" | "staff";
  reset: boolean;
  name: string;
  username: string;
  password: string;
};

// A client who already has a login is told a new quote is waiting. No password: the login they have stays as it is.
export type NoticeMail = { name: string; username: string };

export function noticeEmail({ name, username }: NoticeMail) {
  const clean = name.replace(/[\r\n]+/g, " ").trim();
  return {
    subject: "A new quote is waiting for you on the AB Capital Services FZE client portal",
    text: [
      `Dear ${clean || "Sir or Madam"},`,
      "",
      "A new quote is waiting for you on the AB Capital Services FZE client portal.",
      "",
      `Sign in: ${SIGN_IN_URL}`,
      `Username: ${username}`,
      "",
      "Please sign in with the login you already have to read the quote and accept it. If you need a new password, contact AB Capital Services FZE.",
      "",
      "*Regards,*",
      "AB Capital Services FZE",
    ].join("\n"),
  };
}

// A request for information or payment. The link signs the client in without a password until it expires.
export type RequestMail = { name: string; items: string[]; otherNote: string | null; message: string | null; link: string; expiresOn: string };

export function requestEmail({ name, items, otherNote, message, link, expiresOn }: RequestMail) {
  const clean = name.replace(/[\r\n]+/g, " ").trim();
  const lines = items.map((i) => (i === "Other" && otherNote ? `- Other: ${otherNote.replace(/[\r\n]+/g, " ").trim()}` : `- ${i}`));
  return {
    subject: "AB Capital Services FZE: information we need from you",
    text: [
      `Dear ${clean || "Sir or Madam"},`,
      "",
      "To continue our work for you, please send us the following:",
      ...lines,
      ...(message ? ["", message.trim()] : []),
      "",
      "Open your client portal with this link to upload documents and see what is due:",
      link,
      "",
      `The link signs you in without a password and works until ${expiresOn}. Please do not forward this email. After that date, sign in with your username and password.`,
      "If you did not expect it, reply to tell us.",
      "",
      "*Regards,*",
      "AB Capital Services FZE",
    ].join("\n"),
  };
}

export function credentialEmail({ audience, reset, name, username, password }: CredentialMail) {
  const place = audience === "client" ? "AB Capital Services FZE client portal" : "AB Capital Services FZE Workspace";
  const clean = name.replace(/[\r\n]+/g, " ").trim();
  return {
    subject: `Your ${place} ${reset ? "password has been reset" : "login"}`,
    text: [
      `Dear ${clean || "Sir or Madam"},`,
      "",
      reset ? `Your ${place} password has been reset.` : `A login has been created for you on the ${place}.`,
      "",
      `Sign in: ${SIGN_IN_URL}`,
      `Username: ${username}`,
      `${audience === "client" ? "Password" : "Temporary password"}: ${password}`,
      "",
      audience === "client"
        ? "Please keep these details safe and do not share this email. If you need a new password, contact AB Capital Services FZE."
        : "You will be asked to set your own password when you sign in. Please do not share this email.",
      "If you did not expect it, reply to tell us.",
      "",
      "*Regards,*",
      "AB Capital Services FZE",
    ].join("\n"),
  };
}
