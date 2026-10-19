#!/bin/bash
# Start the Sakeena clinic backend (qa-boot: embedded postgres + Express on :4000)
BACKEND_DIR=/home/z/my-project/upload/extracted/sakeena-clinic-complete/backend
export QA_INFO_PATH=/home/z/my-project/clinic-qa-info.json
cd "$BACKEND_DIR"
npx prisma generate >/dev/null 2>&1
setsid nohup npx tsx qa-boot.mts > /home/z/my-project/clinic-backend.log 2>&1 < /dev/null &
echo "backend PID: $!"
