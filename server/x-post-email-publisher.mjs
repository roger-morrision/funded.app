import { createHash, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { adminEmailConfig } from './admin-email-delivery.mjs';

// Stand-in for createXPublisher (x-post-client.mjs) while the platform X
// account is suspended: emails the drafted post to the admin instead of
// calling the X API, so the account is never touched during review/suspension.
export function createXEmailPublisher({ env, createTransport = options => nodemailer.createTransport(options) } = {}) {
  return {
    async verifyAccount() { adminEmailConfig(env); return { id: 'email-fallback', handle: 'email-fallback' }; },
    async publish(event) {
      if (typeof event?.text !== 'string' || !event.text.trim() || Buffer.byteLength(event.text, 'utf8') > 280)
        throw Object.assign(new Error('X post text must contain between 1 and 280 UTF-8 bytes.'), { delivery: 'rejected' });
      const config = adminEmailConfig(env);
      if (config.provider !== 'gmail')
        throw Object.assign(new Error('Agency X post emails require the configured Gmail sender.'), { delivery: 'not-sent' });
      const transport = createTransport({ host: 'smtp.gmail.com', port: 465, secure: true,
        tls: { servername: 'smtp.gmail.com', minVersion: 'TLSv1.2', rejectUnauthorized: true },
        auth: { user: config.from, pass: config.key }, pool: false, logger: false, debug: false,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, dnsTimeout: 10000,
        disableFileAccess: true, disableUrlAccess: true });
      const id = createHash('sha256').update(`${event.id || randomUUID()}:${event.text}`).digest('hex').slice(0, 32);
      let result;
      try {
        result = await transport.sendMail({ from: config.from, to: [config.to], envelope: { from: config.from, to: [config.to] },
          messageId: `<x-post-${id}@funded.vip>`,
          subject: `[Devnet] X post ready (${event.kind || 'post'}) — account suspended, post manually`,
          text: `The X account is suspended, so this post was emailed instead of published. Nothing has been posted to X automatically. Review and post it manually.\n\n--- COPY POST ---\n${event.text}\n--- END POST ---\n` });
      } catch { throw Object.assign(new Error('X post email delivery failed.'), { delivery: 'not-sent' }); }
      if (!result?.accepted?.length) throw Object.assign(new Error('X post email acknowledgment is unavailable.'), { delivery: 'not-sent' });
      return { id, url: null, delivery: 'email' };
    },
  };
}
