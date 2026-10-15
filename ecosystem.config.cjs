const path = require('node:path');

module.exports = {
  apps: [{
    name: 'operations',
    cwd: __dirname,
    script: 'server/index.js',
    interpreter: process.execPath,
    node_args: ['--env-file=' + path.join(__dirname, '.env')],
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    autorestart: true,
    restart_delay: 5000,
    time: true,
    env: { NODE_ENV: 'production' }
  }]
};
