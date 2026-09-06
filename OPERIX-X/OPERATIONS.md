# OPERIX Operations

## Production checklist

- Set `APP_URL` to the real HTTPS domain before enabling email verification links.
- Configure `ALLOWED_ORIGINS` with only the production web origins.
- Keep `JWT_SECRET`, `MONGO_URI`, `RESEND_API_KEY`, `ABLY_API_KEY`, `CRON_SECRET`, AI keys, and blockchain provider keys outside source control; rotate any key that appeared in chat or logs.
- Configure the production `EMAIL_FROM` as a verified custom domain such as `OPERIX <noreply@operix.website>` and never use a `resend.dev` address.
- Use a managed MongoDB backup policy with daily snapshots, point-in-time recovery, and a quarterly restore drill.
- Set up Vercel/hosting environment variables for production, including `ABLY_API_KEY`, `CRON_SECRET`, `JWT_SECRET`, `MONGO_URI`, `RESEND_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and provider blockchain credentials.
- Monitor `/api/health`, process uptime, MongoDB connectivity, email delivery, AI provider errors, and blockchain provider errors.
- Configure alerts for repeated login failures, withdrawal backlog, failed email delivery, and health-check failures.
- Put the app behind HTTPS and a reverse proxy with rate limiting and secure headers.
- Replace the localhost URLs in `sitemap.xml` and `robots.txt` with the real canonical domain before deployment.
- Run a full production smoke test: authentication, wallet flow, KYC, withdrawal, rewards, admin operations, and realtime updates.

## Suggested checks

```text
GET /api/health
GET /status.html
GET /sitemap.xml
GET /api/realtime/token
```

The repository includes application-level protections and endpoints, but backups, external monitoring, DNS, TLS, and provider credentials must be configured in the hosting and infrastructure accounts.
