export const windowPreferences = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
});
export const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function shellSecurityPolicy(nonce: string): string {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(nonce)) throw Error("Invalid style nonce");
  return contentSecurityPolicy.replace(
    "style-src 'self'",
    `style-src 'self' 'nonce-${nonce}'`,
  );
}
