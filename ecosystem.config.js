module.exports = {
  apps: [
    {
      name: "manifest-web",
      script: "./scripts/start-web.js",
      env: {
        NODE_ENV: "production",
      }
    },
    {
      name: "manifest-https",
      script: "./scripts/https-proxy.js",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      env: {
        NODE_ENV: "production",
        HTTPS_PROXY_PORT: "3443",
        HTTPS_PROXY_TARGET: "http://127.0.0.1:3000",
      }
    },
    {
      name: "manifest-bot",
      script: "./scripts/bot-daemon.js",
      env: {
        NODE_ENV: "production",
      }
    },
    {
      name: "manifest-tunnel",
      script: "./scripts/tunnel-daemon.js",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
        TUNNEL_PROVIDER: "cloudflare",
        TUNNEL_SUBDOMAIN: "osteam",
        TUNNEL_TARGET: "http://127.0.0.1:3000",
      }
    }
  ]
};
