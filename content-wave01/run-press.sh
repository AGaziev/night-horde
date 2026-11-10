#!/bin/zsh
# run-press.sh <tag> <appdir> [runs]: solo, 2 and 4 bots, kite mode, 900 s; all 7 heroes rotate across runs.
cd "$(dirname $0)"
R=${3:-3}
H=knight,witch,ranger,herald,smith,stormcaller,alchemist
for n in 1 2 4; do APP=$2 node balance.mjs kite $n $H $R 900 > pr-$1-n$n.json & done
wait
node pressure.mjs pr-$1-n1.json pr-$1-n2.json pr-$1-n4.json > pr-$1.txt
node summarize.mjs pr-$1-n1.json pr-$1-n2.json pr-$1-n4.json > pr-$1-sum.txt
