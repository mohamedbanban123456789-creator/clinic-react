#!/bin/bash
# Start the Sakeena clinic frontend (Next.js dev on :3000, proxying /clinic-api
# + /clinic-socket.io to Express :4000). Detached via setsid + nohup.
cd /home/z/my-project
export PATH=/home/z/my-project/node_modules/.bin:/usr/bin:/bin:/usr/local/bin
setsid nohup bash -c "exec next dev -p 3000" > /home/z/my-project/dev.log 2>&1 < /dev/null &
echo "frontend PID: $!"
