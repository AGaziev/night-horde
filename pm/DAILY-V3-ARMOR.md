# Daily contract v3

The heavy-armor rule now grants +1 armor and retains its 10% movement-speed penalty.
The completed v2 causal probes isolated flat +2 armor as the dominant source of the
three/four-player lunch advantage. Reducing only armor is the prospective correction;
those probes used the previous combat base and do not establish the new win rate.

Daily contract version 3 separates new personal bests from v1/v2 records. Already locked
contracts keep their original modifiers on start and reconnect. Swarm's finite-cohort
rules explicitly support versions 2 and 3; v1 keeps its original XP multiplier, and an
unknown future version does not silently acquire current cohort rewards.

Validation: native daily tests cover actual incoming damage, both modes' v2/v3 cohort
rewards, legacy v1 reconnect, unknown-version rejection, and persisted v1/v2/v3 bests.
Fresh paired balance validation must use the current merged combat base.
