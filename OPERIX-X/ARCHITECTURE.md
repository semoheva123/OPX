# Backend Architecture

## Runtime

`server.js` is the current composition root. It loads the environment, configures Express, registers routes, connects MongoDB, starts the daily UTC job, and starts the HTTP server.

The frontend entry point remains the root `app.js`; the Express application must therefore use `src/app.js` when the final runtime extraction is performed.

## Current modules

```text
src/
├── config/database.js
├── controllers/
│   ├── activityController.js
│   ├── adminController.js
│   ├── aiController.js
│   ├── authController.js
│   ├── publicController.js
│   ├── userController.js
│   └── walletController.js
├── jobs/dailyTasksReset.js
├── middlewares/auth.js
├── models/
│   ├── Staking.js
│   ├── Transaction.js
│   ├── User.js
│   └── VipLevel.js
├── routes/
│   ├── activityRoutes.js
│   ├── adminRoutes.js
│   ├── aiRoutes.js
│   ├── authRoutes.js
│   ├── publicRoutes.js
│   ├── userRoutes.js
│   └── walletRoutes.js
└── services/blockchainService.js
```

## Route ownership

- `authRoutes`: registration, login, and password recovery.
- `userRoutes`: profile, wallet address, referrals, 2FA, and push subscription.
- `walletRoutes`: verified deposits, withdrawals, and transaction history.
- `activityRoutes`: tasks, rewards, spins, and staking.
- `publicRoutes`: VIP levels, leaderboard, and tier upgrades.
- `aiRoutes`: the authenticated Groq advisor.
- `adminRoutes`: administration and financial review operations.

## Final extraction order

1. Move Express middleware setup and route registration from `server.js` into `src/app.js`.
2. Export the Express instance from `src/app.js`.
3. Keep `server.js` limited to `dotenv`, database connection, jobs, `app.listen`, and graceful shutdown.
4. Preserve the root `app.js` as the browser client.
5. Run syntax checks and endpoint smoke tests before removing the compatibility code from `server.js`.
