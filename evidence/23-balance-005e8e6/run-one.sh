#!/bin/zsh
# args: rev mode players bot seed; full output of every attempt goes to raw/
B=${0:A:h}; rev=$1 mode=$2 n=$3 bot=$4 seed=$5
APP=$B/$rev/app MODE=$mode K0=$seed node --random-seed=$seed $B/head/pm/run-sim.mjs $n 1 $bot > $B/raw/$rev-$mode-$n-$bot-$seed.out 2>&1
echo "$rev $mode $n $bot $seed exit=$?"
