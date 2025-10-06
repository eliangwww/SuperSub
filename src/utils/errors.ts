export class LogoutInProgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogoutInProgressError';
  }
}