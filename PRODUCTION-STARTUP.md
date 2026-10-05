# OPERIX Production Startup Guide

## 1. Environment setup

Copy .env.example to .env and fill in real values.

Required values:
- JWT_SECRET
- EMAIL_FROM
- RESEND_API_KEY if email is enabled
- SUPABASE_URL and SUPABASE_ANON_KEY if using Supabase
- VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY if push notifications are enabled

## 2. Install runtime dependencies

npm install

## 3. Start the platform with PM2

npm install --save-dev pm2
npx pm2 start ecosystem.config.js
npx pm2 save
npx pm2 startup

## 4. Check service status

npx pm2 status
npx pm2 logs operix-platform

## 5. Restart / stop

npx pm2 restart operix-platform
npx pm2 stop operix-platform
npx pm2 delete operix-platform

## 6. Notes

The app is configured to restart automatically if it crashes. In current local environment, the app can continue in degraded mode without Supabase until production variables are supplied.
