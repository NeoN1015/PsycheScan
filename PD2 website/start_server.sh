#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1

if [ -z "${PSYCHESCAN_LOCAL_TEST_MODE+x}" ]; then
  read -r -n 1 -p "Enable local test mode (skip sign-in, local use only)? [Y/N] " choice
  echo ""
  case "$choice" in
    [Yy]* ) export PSYCHESCAN_LOCAL_TEST_MODE="1" ;;
    * )     export PSYCHESCAN_LOCAL_TEST_MODE="0" ;;
  esac
fi

if [ "$PSYCHESCAN_LOCAL_TEST_MODE" = "1" ]; then
  echo "WARNING: Local test mode is ON. Sign-in is bypassed for this local server."
  python3 server.py
  exit $?
fi

if [ -z "${PSYCHESCAN_OPERATOR_PASSWORD+x}" ]; then
  read -r -s -p "Set operator password: " PSYCHESCAN_OPERATOR_PASSWORD
  echo ""
  export PSYCHESCAN_OPERATOR_PASSWORD
fi

python3 server.py
pause
