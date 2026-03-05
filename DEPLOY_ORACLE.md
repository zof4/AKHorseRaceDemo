# Deploy To Oracle Linux (Fastest Path)

This is the fastest stable setup:
- Node app serves both API + built frontend
- Caddy reverse proxies and handles HTTPS automatically
- systemd keeps the app running

## 1) OCI Network + Firewall

In Oracle Cloud Security List / NSG for your instance subnet, allow inbound:
- TCP `22` (SSH)
- TCP `80` (HTTP)
- TCP `443` (HTTPS)

On the VM:

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

## 2) Install Runtime

```bash
sudo dnf -y update
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf -y install nodejs git
```

Install Caddy:

```bash
sudo dnf -y install 'dnf-command(copr)'
sudo dnf -y copr enable @caddy/caddy
sudo dnf -y install caddy
```

## 3) Pull App + Build

```bash
cd /opt
sudo git clone <YOUR_REPO_URL> horse-race-demo
sudo chown -R $USER:$USER /opt/horse-race-demo
cd /opt/horse-race-demo

npm ci
npm run build --workspace client
```

## 4) Run Backend As Service (systemd)

Create `/etc/systemd/system/horse-race-demo.service`:

```ini
[Unit]
Description=Horse Race Demo
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/horse-race-demo
Environment=PORT=3001
Environment=HOST=127.0.0.1
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start --workspace server
Restart=always
RestartSec=3
User=opc
Group=opc

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now horse-race-demo
sudo systemctl status horse-race-demo
```

## 5) Configure Caddy (Public HTTPS)

Set your domain DNS `A` record to your Oracle public IP, then create `/etc/caddy/Caddyfile`:

```caddy
yourdomain.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3001
}
```

Reload:

```bash
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo systemctl status caddy
```

Now the site is live at `https://yourdomain.com`.

## 6) Updates

```bash
cd /opt/horse-race-demo
git pull
npm ci
npm run build --workspace client
sudo systemctl restart horse-race-demo
```

## 7) Quick Troubleshooting

App logs:

```bash
sudo journalctl -u horse-race-demo -n 200 --no-pager
```

Caddy logs:

```bash
sudo journalctl -u caddy -n 200 --no-pager
```

Health check:

```bash
curl http://127.0.0.1:3001/api/health
```

