// What the Share link screen does after the login is saved. The password is shown whenever the client has not been emailed it.
// isAdmin: only an admin can email a login. result: the email reply, if one was attempted. thrown: the error, if the attempt threw.
export function shareStep({ isAdmin, result = null, thrown = null }) {
  if (!isAdmin) return { sendEmail: false, advance: false, showPassword: true, error: null, note: "The login is saved. An admin can email it to the client, or give it to them yourself." };
  if (thrown) return { sendEmail: true, advance: false, showPassword: true, error: `The login is saved, but the email did not send: ${thrown.message || thrown}. Use Resend, or give the login to the client yourself.` };
  if (result?.emailed) return { sendEmail: true, advance: true, showPassword: false, error: null, note: null };
  return { sendEmail: true, advance: false, showPassword: true, error: `The login is saved, but the email did not send: ${result?.email_error || "unknown error"}. Use Resend, or give the login to the client yourself.` };
}
