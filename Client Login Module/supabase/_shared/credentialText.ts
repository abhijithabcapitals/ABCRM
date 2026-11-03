// The wording of a login email. Pure, so it can be tested without a mail server.
export const SIGN_IN_URL = "https://abhijithabcapitals.github.io/ABCRM/";

export type CredentialMail = {
  audience: "client" | "staff";
  reset: boolean;
  name: string;
  username: string;
  password: string;
};

export function credentialEmail({ audience, reset, name, username, password }: CredentialMail) {
  const place = audience === "client" ? "AB Capital client portal" : "AB Capital Workspace";
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
        ? "Please keep these details safe and do not share this email. If you need a new password, contact AB Capital."
        : "You will be asked to set your own password when you sign in. Please do not share this email.",
      "If you did not expect it, reply to tell us.",
      "",
      "*Regards,*",
      "AB Capital",
    ].join("\n"),
  };
}
