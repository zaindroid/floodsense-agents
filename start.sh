#!/bin/sh
# Two processes, one container. The engines are a side channel: every call to
# them is wrapped, and a run that cannot reach them carries on with a trace
# note instead of failing. So the sidecar is started in the background and the
# console is the process this container lives or dies by.
set -eu

node --experimental-transform-types --no-warnings /engines/src/main.ts &

exec python -m console
