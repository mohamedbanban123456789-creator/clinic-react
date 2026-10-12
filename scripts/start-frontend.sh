#!/bin/bash
# Start the clinic frontend (Vite on :3000, proxied to backend :4000)
cd /home/z/my-project/clinic/frontend
export PORT=3000
setsid nohup pnpm dev > /home/z/my-project/clinic/frontend-boot.log 2>&1 < /dev/null &
echo "frontend PID: $!"
