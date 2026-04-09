/** Thrown from CRM helpers when the message is safe to show in the UI (forms / server actions). */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}
