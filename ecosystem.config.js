module.exports = {
  apps: [
    {
      name: 'operix-platform',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '900M',
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      log_file: './logs/operix.log',
      out_file: './logs/operix-out.log',
      error_file: './logs/operix-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
