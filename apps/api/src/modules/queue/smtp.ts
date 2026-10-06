import nodemailer from 'nodemailer';
import type { Environment } from '../../config/environment';
export function smtpTransport(env: Environment) {
  const smtp = new URL(env.SMTP_URL);
  return nodemailer.createTransport({
    host: smtp.hostname,
    port: Number(smtp.port || (smtp.protocol === 'smtps:' ? 465 : 587)),
    secure: smtp.protocol === 'smtps:',
    requireTLS: env.NODE_ENV === 'production',
    ...(smtp.username
      ? {
          auth: {
            user: decodeURIComponent(smtp.username),
            pass: decodeURIComponent(smtp.password),
          },
        }
      : {}),
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 15000,
  });
}
