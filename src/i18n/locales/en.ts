// Flat keys, `{name}` placeholders. English is the source of truth for Messages.
// The UI slice appends keys; CORE only uses the invite.* and error.* keys below.
export const en = {
  "app.name": "Cumplista",
  "invite.subject": "{owner} invited you to a gift list",
  "invite.message": "{owner} invited you to their birthday gift list \"{title}\". Open {link} and enter code {code}.",
  "invite.owner_subject": "Your gift list \"{title}\" is ready",
  "invite.owner_message": "Manage your list here: {link}. Keep this link private, it is your key.",
  "error.throttled": "Too many wrong codes. Try again in a few minutes.",
  "error.wrong_code": "That code does not match. Check it with whoever invited you.",
  "error.already_taken": "Someone else just took that gift.",
  "error.invalid": "Check the highlighted fields and try again.",
} satisfies Record<string, string>;
