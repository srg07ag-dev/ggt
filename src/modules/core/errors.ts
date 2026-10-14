/** Règle métier violée : message affichable tel quel à l'utilisateur. */
export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
