#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ "${PSYCHESCAN_LOCAL_TEST_MODE:-}" = "1" ]; then
  echo "WARNING: Local test mode is ON. Sign-in is bypassed for this local server."
  export PSYCHESCAN_HOST=127.0.0.1  # server.py refuses local test mode on a non-loopback address
  python3 server.py
  exit $?
fi
if [ -z "${PSYCHESCAN_OPERATOR_PASSWORD:-}" ]; then
  PSYCHESCAN_OPERATOR_PASSWORD="$(python3 -c 'import getpass; print(getpass.getpass("Set operator password: "))')"
  export PSYCHESCAN_OPERATOR_PASSWORD
fi
python3 server.py
