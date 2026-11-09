# Smaller Devnet program release

The user authorized upgrading the existing Devnet program to the tested smaller candidate, retaining its upgrade authority and testing the application. The source release pins the 900,144-byte executable with SHA-256 `03749b95dd6f4cd67e77eb9932012bcd7ee61d34a3da0171a2fc48b3a9d99a24`, replacing the 1,095,080-byte commitment. This is a reduction of 194,936 bytes (17.8%).

Program: `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`. Upgrade authority: `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`.

The candidate manifest is a reproducibility record, not an automatic deployment authorization. Its retained runtime commitment now describes this authorized release. The separate production-feature artifact still uses a public test identity and is not a Mainnet deployment artifact. Missing production configuration remains placeholders and Mainnet writes remain blocked.

Before cutover, all ten existing LiteSVM contract tests passed against these exact bytes. The finalized upload buffer was independently compared with the local executable. The release requires finalized upgrade receipt, exact executable plus zero padding, retained authority, unchanged legacy escrow and matching app/worker ProgramData pins. Live acceptance evidence is recorded separately; VM success does not imply that every financial journey has passed on Devnet.

The existing ProgramData allocation is retained. This upgrade does not reclaim its existing rent. Upload-buffer rent returns to the same Devnet authority on upgrade; no Mainnet SOL is spent.
