# Night Horde: evidence for PRs #53–#60

This branch publishes isolated local QA artifacts requested by the independent reviewers. It is **not an application candidate** and must not be merged or deployed. The application files in this branch are the unchanged `f4a40dc3cd743a114b5df7417acd65e0c08bceae` base.

All eight implementation PRs remain Draft while the CEO's general-review findings are corrected. None of the archives below closes those findings or establishes acceptance of a later source revision.

## Archives

Each directory contains a downloadable `.tar.gz`, `SHA256SUMS` and an uncompressed `members.json`. The member manifest gives the SHA256 and byte length of every original text file. Extracted paths begin with `outputs/`, preserving the original artifact structure. The archives retain raw results, errors, rejected attempts, preregistered seed/K0/hero plans, source/runtime hashes, terminal/Room.finish evidence, report generators and immutable text source copies where present.

| Directory | Scope and limits |
| --- | --- |
| `historical-balance` | Earlier independent split-branch runs on the pre-v36 baseline, including baseline raw, 600-cell plans, partial/replaced candidates, replication/probes, the rejected #31 harness attempt and its corrected run. These are historical results, not measurements of the current v36 candidates. |
| `historical-strength` | #31 build-strength measurements, all raw logical rows, explicit cached-control accounting, scripts/source hashes, pull/gravity follow-ups and transfer evidence for the then-current head; also the #41 boss-slow ablation. Later code fixes require a separate applicability review. |
| `v36-prereview` | Fresh v36 baseline `f4a40dc` 600 terminal runs; the paused pre-review-fix combat matrix (1472 terminal / 928 not started) and guarded #17 matrix (215 / 385); 180 Swarm-factor trials; then-current independent CI/backend/player evidence. These candidates precede the subsequent CEO fixes. The fresh ordinary baseline remains usable only with explicit source/runtime/tuple equivalence. |

Source SHA, base, effective parameters and execution commands are recorded inside each plan and source manifest; a directory name alone is not evidence of applicability. Runtime: local macOS Node 24.22.1 for the simulations, Linux Node 24.22.2 for GitHub Server CI. The locally used Node binary is identified by SHA256 in the plans, not bundled. Public Git revisions reconstruct original source/assets; binary source assets, duplicate source tar files, dependency directories and symlink aliases are omitted and listed in the member manifests. Output-only source modifications are retained as text.

The 180 Swarm-factor trials distinguish density-only, XP-only and the combined variant. They do not prove superadditivity or validate the proposed replacement reward. Historical guarded dash data represents a specified bot policy, not every human play style. Controlled duration runs explicitly identify immunity/HP fixtures and cancellations. Browser measurements do not prove a universal FPS gain or performance on a physical low-end device. No live candidate match, production network acceptance, portal notification delivery or deployment is claimed.

## Verify before use

From this directory run `python3 verify.py`. It checks archive digests, exact member sets, raw byte lengths and hashes without extracting or executing any contents. The recorded `verification.json` is the publisher's readback; reviewers can rerun the same independent byte checks. Recompute gameplay summaries using the included report scripts and their recorded inputs; do not substitute a summary for raw terminal checks.

Only isolated QA data is published. No production environment files, application credentials, tokens, installed dependencies or live player data are included. A credential-pattern scan ran before archiving; original raw bytes were not rewritten to disguise an input or outcome.
