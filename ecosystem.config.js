module.exports = {
    apps: [{
      name: "auctionweb",
      script: "server.js",
      interpreter: "none",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production"
      },
      exec_interpreter: "xvfb-run",
      args: "-a node"
    }]
  }