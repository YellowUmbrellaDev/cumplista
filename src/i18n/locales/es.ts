import type { Messages } from "../index.js";

export const es: Messages = {
  "app.name": "Cumplista",
  "invite.subject": "{owner} te ha invitado a una lista de regalos",
  "invite.message": "{owner} te invita a su lista de regalos de cumpleaños \"{title}\". Abre {link} e introduce el código {code}.",
  "invite.owner_subject": "Tu lista de regalos \"{title}\" está lista",
  "invite.owner_message": "Gestiona tu lista aquí: {link}. Guarda este enlace en privado, es tu llave.",
  "error.throttled": "Demasiados códigos incorrectos. Inténtalo de nuevo en unos minutos.",
  "error.wrong_code": "Ese código no coincide. Compruébalo con quien te invitó.",
  "error.already_taken": "Alguien acaba de coger ese regalo.",
  "error.invalid": "Revisa los campos marcados e inténtalo de nuevo.",
};
