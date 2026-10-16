#!/bin/bash
# Start the clinic backend (qa-boot: embedded postgres + server on :4000)
cd /home/z/my-project/clinic/backend
export QA_INFO_PATH=/home/z/my-project/clinic/qa-info.json
setsid nohup npx tsx qa-boot.mts > /home/z/my-project/clinic/backend-boot.log 2>&1 < /dev/null &
echo "backend PID: $!"
