# Devnet $FUNDED test distribution and burn verification — 2026-10-01

Scope: Solana Devnet mint `C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64`. All sending keys were already in ignored local Devnet environment files. This work did not change Mainnet or restore the retired key as a fee-router authority.

## Test supply

- The rotated QA referrer purchased `31,032.057490` $FUNDED from the verified Devnet PumpSwap pool for `0.4` Devnet SOL in [this finalized trade](https://explorer.solana.com/tx/5cp21GQMsyvtLg1yabG7xMzdCMhXAutkXYPdPHwh5iNosRMJKWwEsyWUyuRScGuegvun7ZyAPd5QzybroPFAxDkt?cluster=devnet). Its token-account increase exactly matched the pool token-account decrease and exceeded the quoted minimum.
- The former exposed router authority still held the original Devnet test-token supply, but was no longer the router authority. It transferred only a bounded `400,000` and then `100,000` $FUNDED to the rotated QA distributor in [transfer one](https://explorer.solana.com/tx/33VQ2LqfBpfnaPF3usLk2zUv4mvbRBpN5peK2VmzCRcbQupSyiHKaaMCmDyYLBVxSeKXsdiCHeqRhYx5jEaq86Qc?cluster=devnet) and [transfer two](https://explorer.solana.com/tx/5DMGeVPDLDMBBXeYZ2HJyCyevAMDac48swkNeZUETK3XE1XP9nQeDdyBTXbkjSERCb79P5vk3qBjR29kVtyVdprr?cluster=devnet). Both source and destination deltas were exact and mint supply did not change. The retired key was used only to move its Devnet tokens; no runtime role or program authority was assigned to it.
- QA distribution transfers finalized with exact sender and recipient deltas. The initial creator, holder, X, claimant and buyback transfers are [creator](https://explorer.solana.com/tx/2dgXDU54xDXm6T5j7BateVQ7Sp89sATTDzqNWQtZF9Wh67PoHTcyF8mQBzm2hamm9zuehYQeWPe6hwqKEcPoZTxD?cluster=devnet), [holder](https://explorer.solana.com/tx/2ZB12yuP3HowDBCQXC9qRqaGKz36nTsds3n3Q6ZfgKnPmS1piRwYSZw94haJ3RRBN7Ngy3VL6guNCX9vTySYUo8s?cluster=devnet), [X wallet](https://explorer.solana.com/tx/56GwRDfB7YCRnmdJFC7Q4MT2aX9u2sZJ2ZpNgCk4FibBjBUYowKjskcPQqevSsiGguHvbKoeJESu6bboDpGAN8AJ?cluster=devnet), [claimant](https://explorer.solana.com/tx/26RwS9Eh6HpuoKA5iqj6LXv879UD2xgGtSEEBYVaQjTejgSdnaP1dAHnY9pjmKDdtUrEWCYpeP2dQy9MdV3tEbbP?cluster=devnet), and [buyback wallet](https://explorer.solana.com/tx/4D5Rb8v5Fn9wP3XX6krrapcdKXzMXtBWqdsxZBSKczDQJ8hm6KpYhAdLrXnXiiQNRCWSJpRVJStVTsKTZcsCJRUu?cluster=devnet).
- Before the Pro/Premier and listing tests, the distributor sent another [350,000 to the creator](https://explorer.solana.com/tx/5tY77oUJU3DDRXHLYc57ns2Xx5yCEJbxkTRQqdLK95YgvXu9xNTi498XV44XZi6VSyQ2CmeH4ayZ2fie4p8j8H7N?cluster=devnet), [24,000 to the claimant](https://explorer.solana.com/tx/4WiRKb9YbcdyGu3pKLr9EAkzyvX67priZPSa48YEJTFAS4grxJky5UCVnf6cUWsjshGKXCNZVkUixK2XPHURd7n4?cluster=devnet), and [24,000 to the buyback wallet](https://explorer.solana.com/tx/4dXkMjFWGs7Leabp1Y1SKNxcNXeN8RfBtiwgvBM4TLGJYYA9DKdZd5C7ZuEtRYBvg1XJE3Acx6MixZKprcu5Lo7y?cluster=devnet).
- After testing, final replenishment sent [25,000 to the creator](https://explorer.solana.com/tx/4wgqDTa6txUNPrAKrqqKjmnChWJ6ACb83koE1oD4eAXZupFZjhVdSCukWpEk61snV7dqYJP8vXisHRiz49KzDQom?cluster=devnet), [23,000 to the $FUNDED holder](https://explorer.solana.com/tx/2iwsXvoszEXGcJGQtC8msGui4WQW2iwrtwm5H9WD25Ac3jvs2DL8gfZVggmANCsoz92wHjVLDp3bMu5qpRiMZsCT?cluster=devnet), [9,000 to the X wallet](https://explorer.solana.com/tx/2tQSYC423C7AGNGv4nFM2FfRYi9XupzW3Cz7JyAyKArqYDiVLKCkwCJtPWNsPeU5eA9WAX58Q94UwAgBpkmrnYX8?cluster=devnet), [25,000 to the claimant](https://explorer.solana.com/tx/3jcXuUW6vq63qeZeVGQbLZiTYAaoRqJaRtSXfExhB3sE7sCtkAYMRctwJs5kN6U8aRfJ5ikQ4bLh5DT4EsHy9U7X?cluster=devnet), [1,000 to the coin holder](https://explorer.solana.com/tx/2w9bKG6U3PUfMDAwQiUS1mEJq6idn3ZwxLtTc9dKvBdyDj9WzgYLSjXMaAwLFkTjFLC3qcTBuexZyshhBVKuKBFY?cluster=devnet), and [1,000 each to referral levels two](https://explorer.solana.com/tx/28b7B6TRLAWURti91sMeJ8GFnEJ48EwKeW653QFSyXtAa7ggep1nBVzkpdgeeQ1JB3wNCGFcsdJFRrkqJau9Yg9V?cluster=devnet) and [three](https://explorer.solana.com/tx/2veMbVCuiPjjkfDZaBnv7rPqnnH4T2kdKwT1UFNPte8A1FMfXsgUqp5WooM5M4S14Xrwk68MFL8DXcYsAARSWm9v?cluster=devnet). Every transfer was checked against finalized source and recipient token deltas.

## New-token burn and listing flows

| Flow | New token or listed mint | Finalized receipt | Verified result |
| --- | --- | --- | --- |
| Boost launch | `BHrufSkFKWqYsReUcVGGvxki1fh2VZryHCzd42KkuYeA` | [2t8pEcEbbjuczDSGHpHFvjwLFkfFRwfNNVGaJ1yaauGk4ndYtkmbeqwtAKEQwZXxt1HgTfduUggJEKavDew4mgse](https://explorer.solana.com/tx/2t8pEcEbbjuczDSGHpHFvjwLFkfFRwfNNVGaJ1yaauGk4ndYtkmbeqwtAKEQwZXxt1HgTfduUggJEKavDew4mgse?cluster=devnet) | Atomic Pump launch and 25,000 $FUNDED BurnChecked; exact supply and creator-token deltas; funded.app creator-fee owner. |
| Pro launch | `8n2DHBtMGGp2GWQzRdjY9bDra9wndcHKiDJvmiHUogy6` | [35ryPnWdCTtbEYnFHHmLqwKSxeKU6yV7qhH1sFnsWtkHoV71Un6VHP8R2yz8PmjhZPTyBMWnj6EbERQreggkegLi](https://explorer.solana.com/tx/35ryPnWdCTtbEYnFHHmLqwKSxeKU6yV7qhH1sFnsWtkHoV71Un6VHP8R2yz8PmjhZPTyBMWnj6EbERQreggkegLi?cluster=devnet) | Atomic Pump launch and 100,000 $FUNDED burn with exact deltas and fee owner. |
| Premier launch | `35jU9iX21TkjeaMvxh726x1MeAucHz2CdKwDn1nfxW9v` | [Kof418ZwxMmtD3XVFrFXZsZdhd7j2rfakmUK55GCZpPFtnwq2fsUkKukf4vaAznaNUJxGYpV4gsMeg2XhzLwLvY](https://explorer.solana.com/tx/Kof418ZwxMmtD3XVFrFXZsZdhd7j2rfakmUK55GCZpPFtnwq2fsUkKukf4vaAznaNUJxGYpV4gsMeg2XhzLwLvY?cluster=devnet) | Atomic Pump launch and 250,000 $FUNDED burn with exact deltas and fee owner. |
| Paid listing | Registered fresh mint `FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH` | [J3oU5M6QPQGoKoeEGAi8PUvGEiu5uyxb8vMuKpaXZGn7NPzFwWa6zDBCw7x9Fuvn3hxubQC6eqHE9Nn8SZgYQbA](https://explorer.solana.com/tx/J3oU5M6QPQGoKoeEGAi8PUvGEiu5uyxb8vMuKpaXZGn7NPzFwWa6zDBCw7x9Fuvn3hxubQC6eqHE9Nn8SZgYQbA?cluster=devnet) | Claimant burned 25,000 $FUNDED with mint-specific memo; wallet and supply deltas matched; live app indexed one verified listing and accepted an idempotent replay. |

The three tier launches used the standalone chain verifier. They prove the on-chain atomic burn and Pump creator route, but they were not registered through the app's full launch UI. The paid listing used the running Devnet app API. Holding $FUNDED in an X or holder wallet does not itself verify an X-linked reward or an automatic holder payout.

## Final QA wallet balances

The last finalized inventory read, after the burns and replenishment, showed:

| QA wallet | Address | $FUNDED |
| --- | --- | ---: |
| Creator | `8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk` | 25,000 |
| Referrer/distributor | `7ngaVZdeipr6uZy2inh267PjZLLYFuAfsPoTRZixjJMk` | 19,442.041877 |
| Claimant | `Gv3uSJu2Ki7eqC6V4H1Fc31MMXLih6TJR19a5sydPfr7` | 25,000 |
| $FUNDED holder | `DJsypjeMYdtD5rqxNoa9frNAE1j62ddHMFJAcNdDPrP1` | 25,000 |
| X partner | `JBi5DiqdRD9s7BBybbK7rY7cnFdPbtYJXVnzKPdQZDpe` | 10,000 |
| Buyback operator | `52fMTqPLE2wLpJbszs6PssQSYBLGojvrukkBafysvM8P` | 25,000 |
| Coin holder | `Bh6u9QVrpTMUBi5MuWY1JGuQ23wQGb7eGZp6tyANJr8j` | 1,000 |
| Referral level 2 | `9wFEV3bLscLqvXVYwXMyF5CaniccndLi4fGivSCuYs3R` | 1,000 |
| Referral level 3 | `4yRRW1ikd1JaSzZFCngnx2ChuUHu1FRdRCTS6m5NN42v` | 1,000 |

The retired exposed wallet still holds most original Devnet supply; it is not a suitable active authority or production custody wallet. The current QA allocations are for Devnet flow testing only.

The $FUNDED holder, X partner, and buyback operator wallets also each received `0.02` Devnet SOL for test transaction fees. Their [holder](https://explorer.solana.com/tx/31YJH7Y46k3Van2QSjGwqu6M9vWnYWUSJr25uWmg5VpE94mYx3aPhUBbkdpXV2fwbc9jdACvHaBJBKcY9sBBQtg9?cluster=devnet), [X partner](https://explorer.solana.com/tx/3FipTfWonqPb37imbh45G7c8xQYVVvhvA9dKwTGWNFDJmtWVwY3ccwCB2o4TPJWERtNYzjstTGFtHH8SgUuH7EVj?cluster=devnet), and [buyback operator](https://explorer.solana.com/tx/44fc29sc8wE9qSfuXrPiaobuGiaFuoeFs1GJZXEC3sNgcwEH55QUyrH9kW1vkFbwtY2j22aqJwdLk2Ajvn4fQtrp?cluster=devnet) transfers finalized with exact recipient balance increases. These fee balances make the QA wallets usable for later signed flows; they do not prove those later flows have occurred.
