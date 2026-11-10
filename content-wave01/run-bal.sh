#!/bin/zsh
# run-bal.sh <tag> <appdir>: 2 hero mixes × 4 bots × 3 runs, 900 s
cd "$(dirname $0)"
APP=$2 node balance.mjs kite 4 knight,witch,ranger,herald 3 900 > bal-$1-a.json &
APP=$2 node balance.mjs kite 4 smith,stormcaller,alchemist,knight 3 900 > bal-$1-b.json &
wait
node summarize.mjs bal-$1-a.json bal-$1-b.json > bal-$1.txt
