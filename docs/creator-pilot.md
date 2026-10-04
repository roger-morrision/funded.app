# Creator and community pilot

Status: proposed recruitment and research protocol, 4 October 2026. **No participants have been recruited or invitations sent by this change.** The target is 100 consenting people: 10 creators and 90 community participants. This is a Devnet learning experiment, not a Mainnet launch or evidence of product demand. All invitations below are drafts for manual review and sending by the account owner of [@johntrand83](https://x.com/johntrand83).

## Current entry gate

The latest operator release check reports `funded.vip` returning HTTP 530 / Cloudflare 1033; no existing Codespace was available, and machine discovery returned 403. This is a deployment blocker, not a working public pilot URL. **Do not send participants to funded.vip as a functioning pilot, schedule live claim tasks, or claim the app is publicly ready today.** Stage 0 may collect interest through a reviewed reply-only invitation from @johntrand83, without a product URL or any promise of an available session.

Before actual sessions, the operator must verify a reachable public HTTPS deployment, the intended Devnet build and network, healthy routes, accurate unavailable states, and consent controls from an external device. For any optional transaction task, separately verify the relevant route and sufficient disposable Devnet test-wallet funding; a readable page alone does not establish an available launch or claim. If a faucet or eligible claim is unavailable, choose a clearly labeled read-only task or defer the transaction task. Record the check time, build, URL, and remaining limits privately before distributing the verified link.

## Question and boundaries

Can a creator explain a fee allocation, publish a useful update, and give their community a reason to return without a reward offer or a reminder? Can a community member distinguish a proposed allocation from a finalized payment? The pilot tests those questions before recruiting a larger cohort.

Use a clearly marked Devnet deployment and fresh test wallets. Devnet SOL and test tokens have no monetary value; faucet availability and transaction execution are not guaranteed. No purchase, real deposit, trade, paid referral, token holding, or successful claim is required to participate. Do not promise earnings, airdrops, token value, guaranteed payments, future rewards, or preferential Mainnet access. A displayed allocation, reserve, published claim, or countdown is not a payment. A payment needs the app's verified finalized receipt.

The research team never asks for seed phrases, private keys, wallet exports, wallet signatures, or transaction signatures. Recruitment and consent happen without connecting or signing with a wallet. Any optional Devnet transaction is reviewed and signed by the participant in their own wallet inside the app; the researcher must not operate it or collect the signature. Public ledger activity is public even when the research record omits wallet identifiers. A person can complete browsing, drafting, saving, following, and interview tasks without transacting.

## Recruitment plan: 10 creators and 90 community members

Recruit adults who can give informed consent, with varied familiarity with wallets. This is a purposive usability sample, not a representative market survey. Avoid selecting only friends who built the app or people expecting a financial reward.

| Phase | Proposed new participants | Recruitment and gate |
| --- | --- | --- |
| Readiness | 0 | Name a study owner and support contact; pass the public HTTPS entry gate above; review privacy wording; verify read-only journeys, cancellation, unavailable-data states, and consent/export/deletion controls. Freeze the build and protocol version. |
| Small cohort | 2 creators + 18 community | Invite creators manually through @johntrand83; ask each to invite up to 9 community members who independently opt in. Observe the first sessions and review all safety/trust failures before expansion. |
| Expand | 3 creators + 27 community | Proceed only after the small cohort's full D7 window and report. Fix critical issues, record the changed build, and retain separate cohort results. |
| Complete cohort | 5 creators + 45 community | Proceed after the expansion gate. Total planned recruitment is 10 creators + 90 community; never replace an inactive recruit silently to improve the denominator. |
| Follow-up | No automatic new recruits | Follow each enrollment cohort for at least 4 weeks and through its full D30 UTC observation day. The final report cannot precede the youngest cohort's maturity. |

Maintain a private invitation log of counts invited, replies, eligible, consented, activated, withdrawn, and lost to follow-up, split by role and cohort. Use a study code for each person; keep their chosen contact channel separately. A creator may distribute a reviewed invitation but cannot consent for followers or receive their individual activity. Do not scrape followers, mass-DM, publish a participant list, or enroll accounts automatically. Stop following up after a refusal or withdrawal; send at most one unanswered recruitment follow-up after 5–7 days.

A creator short of 9 interested members is a recruitment result. Report the shortfall; invite independently interested community members with a distinct source label if needed. Do not buy activity or require repeated trades. Recruitment via X is a source, not proof that a later return was organic or voluntary.

## Consent, privacy, and support

Before any recorded session, explain the purpose, Devnet limitations, optional tasks, data fields, use of results, retention period, contact for deletion, and right to stop without consequence. Obtain separate choices for participation, device-local metrics, sharing an exported metrics file, and any quotation. Declining metrics must not prevent app use or an interview. Do not record audio/video or capture a wallet screen by default; request separate permission if a recording becomes necessary and avoid sensitive information.

Suggested consent script:

> We are studying whether funded.vip's Devnet creator and community flows are understandable and useful. Test SOL and tokens have no monetary value. Participation is voluntary, with no purchase or promise of earnings. We can take anonymous task notes if you agree. Optional event recording stays on your device until you choose to export and share it. You can skip tasks or stop at any time. We will not ask for wallet secrets or signatures. May we take task notes? Separately, would you like to enable local metrics and decide later whether to share an export?

Explain that a random device ID is a pseudonymous identifier, not anonymous once linked to a contact. Do not put names, handles, wallet addresses, signatures, URLs, free-text wallet errors, or message content in metrics exports. Task notes use study codes and short categories. Ask participants to inspect an export before sharing. Use an access-restricted research location, never a public issue, repository, or X reply. No API credentials are needed for recruitment.

Name one researcher responsible for access and deletion before inviting anyone. Proposed retention: delete contact details, raw exports, link tables, and identifiable notes within 30 days after the final report; retain only aggregated results and separately approved quotations. Tell participants the actual calendar deletion date once the cohort closes. Honor a deletion request sooner. Deleting device data does not delete a previously shared copy, so provide a researcher contact; withdrawal of research consent does not erase public blockchain records. Publish no small-cell breakdown that could identify a participant.

Support messages and interviews count as reminders if they prompt an app return. Schedule the exit interview and export request after the relevant retention window where possible. Record any assistance during a window. Do not send a “come back today” message on D7 and then describe the resulting activity as voluntary retention.

### Private operator observation template

Store this outside the repository in the restricted research workspace; the blank template contains no actual participants. Keep contact details in a separate access-controlled roster and link only with the participant's consent.

```text
Study code: [random researcher code, not wallet or social handle]
Cohort / protocol / build / Devnet deployment check time:
Role: creator | community    Entry source:
Consent time and protocol version:
Choices: task notes / local recording / export sharing / quotation [each yes/no]
Session UTC time / observer:
Task attempted:
Outcome: completed unassisted | assisted | cancelled | unavailable | failed | declined
Friction category / short non-sensitive observation:
Participant explanation: [paraphrase; direct quote only with separate consent]
Prompt context: voluntary | reminder | unknown
Incentive context: none | offered | unknown
Next contact allowed? / scheduled after observation window:
Export supplied? / observedThrough: [optional; no inferred consent]
Optional device-to-study linkage consent: yes | no
Withdrawal/deletion request and completion date:
```

No secrets, signatures, wallet addresses, transaction URLs, balance screenshots, free-text wallet logs, or direct identifiers belong in this template. Count consenting **people** in the roster and observed **devices** in exports separately. A device identifier may be linked to a study code only with separate informed consent; absence of linkage is not a reason to infer a person's identity.

## Observation tasks and interview prompts

Observe completion, abandonment, help needed, elapsed task time, and the participant's explanation. Ask participants to think aloud; do not give the answer before they try. Stop at any network, cost, or wallet misunderstanding.

| Role | Task | Evidence to record without wallet identifiers |
| --- | --- | --- |
| Creator | Draft a name, ticker, image, and short project explanation; reach review without signing. | Completed review or blocking step; can explain network, cost, recipients, and allocation. |
| Creator | Explain the fee split to a community member using the displayed facts. | Correctly distinguishes percentages of total fees from percentages of the app's share; flags unknowns. |
| Creator | If a test launch is feasible and freely chosen, review wallet instructions and complete it; otherwise inspect a verified example. | Separate completed, cancelled, unavailable, and failed outcomes. An example inspection is not a personal launch. |
| Creator | Publish a useful project update, then choose whether there is a real reason to publish another within 14 days. | App-reported publication success plus a separate human assessment of usefulness; no filler posts to hit a target. |
| Community | Find a creator's coin, save it or follow the creator, and explain what they expect on return. | First core action; no buying required. |
| Community | Find an update and compare allocated, available, and paid reward examples. | Can identify which one has a verified finalized payment and which one remains unavailable. |
| Either | Cancel a wallet request or inspect an unavailable claim; explain what to do next. | Understands cancellation versus an uncertain submitted transaction; does not repeatedly resubmit. |
| Either | Find the pilot controls, decline or enable local recording, inspect/export if desired, then locate deletion. | Controls understandable; research consent does not imply wallet or posting consent. |

For each applicable task record attempted, completed without help, completed with help, cancelled, blocked by infrastructure, and declined. Use attempted tasks as the completion denominator; keep declines and infrastructure blocks visible. A claim that is unavailable is not a usability failure if it is accurately explained; presenting an unpaid allocation as earned money is a trust failure.

Interview prompts: “What did you expect to happen?” “What does this amount represent?” “What would bring you back without a reminder?” “What could make you stop using this?” “What information would help you decide whether to sign?” “What did you do elsewhere instead?” At follow-up, ask for a concrete recent example rather than willingness to use the app someday. Do not ask about portfolio values or request proof of wealth.

## Metrics and denominators

The implementation lives in [pilot-metrics-model.js](../pilot-metrics-model.js), [pilot-metrics.js](../pilot-metrics.js), and [scripts/summarize-pilot-metrics.mjs](../scripts/summarize-pilot-metrics.mjs). Measurement is opt-in and device-local; there is no automatic upload or central participant registry. Self-reported context and local browser events are research observations, not tamper-proof on-chain analytics.

The v2 schema uses `role: creator | community | unknown` and `source: creator-invite | organic | other | test | bot | unknown`. Network, role and source stay fixed for a record. Legacy missing fields stay unknown. New recording is available only in the writable Devnet build; existing records can still be exported or deleted in other builds. Each event records `incentive: none | offered | unknown` and `prompt: voluntary | reminder | unknown`. Context starts unknown on each visit. `none` means the participant reports no reward offer for returning; it is not inferred from source. Strict voluntary, non-incentivized use requires **both** `incentive=none` and `prompt=voluntary`. Report reminder-driven, incentivized, and unknown-context returns separately, including overlaps where appropriate.

Use the CLI's `devnetPilot` object for this study. Its top-level aggregate also includes unknown-network legacy records, which must not be relabeled as Devnet evidence. `devnetPilot.retention.d7` and `week1` through `week4` expose mature, observed eligible, missing-follow-up and returned counts, strict voluntary counts, rates and conservative lower bounds. `devnetPilot.sustainedFourWeek.voluntaryNoneAllWeeks` counts the **same devices** returning voluntarily without a reported incentive in all four windows; four separate weekly totals do not establish this intersection. `devnetPilot.participants` counts device records, while recruited people remain a separate manual roster. `launchSubmitters` counts devices starting the launch flow, not broadcast transactions; supported launch/claim completion hooks are client observations, not an independent chain audit. Paid listings, referral claims and claims recovered after reload do not currently have complete instrumentation.

| Measure | Numerator / denominator and interpretation |
| --- | --- |
| Recruitment | Consented people / eligible people invited, by role and phase. Use the private manual roster; device IDs cannot establish unique people. Record declined and unanswered invitations separately. |
| Activation | People completing an agreed core action / consented people in the manual study; separately report device activation from the model. Device activation is first `draft-reviewed`, `save-coin`, `follow-creator`, or supported verified launch/claim event. A draft review is not a launched coin. |
| Draft completion | Devices with a valid review after a draft start / devices with a draft start. Report task completion and help separately from the event ratio. |
| D1, D7, D30 | Devices with a qualifying useful return on UTC activation day + N / activated devices with a full observable target day. Eligibility starts only after the end of that UTC day. Report calendar-mature activations, observed eligible devices, and missing follow-up separately. |
| Strict voluntary D7 | Eligible devices with a useful D7 return explicitly marked `none` + `voluntary` / **all observed D7-eligible devices**, not just devices that selected that context. Unknown context is not a successful voluntary return. |
| Weekly useful return | For each window of days 1–7, 8–14, 15–21, and 22–28 after UTC activation day, count each device once if it has a qualifying useful return; denominator is devices observed through that full window. Separately report all returns and `none` + `voluntary` returns. This is distinct from exact-day D7. |
| Sustained voluntary use | Devices with at least one `none` + `voluntary` useful return in **each** of all four complete weekly windows / devices observed through all four windows. Do not divide by the number of visits or only returning devices. |
| Creator follow-through | Creators/devices with a second successfully published update within 14 days of the first / creators/devices observed through that full 14-day interval. Report the model's publication count and the researcher's “useful update” assessment separately. |
| Reward comprehension | Participants correctly distinguishing unpaid allocation, available claim, and finalized payment without hints / participants who attempted all three examples. Report task wording and failures. |
| Reliability | Completed, cancelled, failed, and uncertain launch/claim attempts / observed attempts, split by action and build. Verified success requires the app's verified signal; button clicks are not success. |

A useful return means viewing a saved coin, followed creator update, or verified reward view (plus any explicitly documented verified core-action return supported by the model). Page opens, invite clicks, wallet connections, raw trades, and prize-card views alone are not retention. Never label app event counts as unique humans or verified payouts.

Example: activation on 5 October UTC makes D7 the entire 12 October UTC calendar day; report it only on or after 13 October 00:00 UTC. A return on 11 or 13 October does not count as exact-day D7. A weekly days 1–7 return may still include those earlier days. Export timestamps must cover the observation window; the report date alone cannot turn an old export into observed non-return. `observedThrough` identifies the latest explicit observation/export; tracking interruptions, storage resets, and missing exports remain limitations even with that timestamp.

Deduplicate repeat exports by device ID according to the model's rules; do not count an updated export as another participant. Exclude synthetic/test/bot sources from participant results. A person using two devices is not two recruits: resolve it only through voluntary study-code linkage or report the ambiguity without fingerprinting. Never recover deleted IDs, match wallets, or infer identities from activity. Unknown role/source/context remains unknown.

Report a lower-bound sensitivity result as well as observed retention: confirmed voluntary D7 returns / all calendar-mature activated devices, with missing follow-up counted as unknown, not known non-return. This prevents selective export participation from looking like strong retention. A roster-based people rate is separate and requires explicit opt-in linkage; otherwise use device-based language throughout. Keep withdrawn people out of retained personal data, but report permitted aggregate withdrawals transparently.

Run `node scripts/summarize-pilot-metrics.mjs export-a.json export-b.json` only on explicitly shared, consented exports in the restricted research workspace. Do not commit files or include contact details. Use the script's implemented field names; do not invent weekly or people-level results when only daily device fields are available. Compute unsupported study measures from consented event exports using the definitions above, with reviewed analysis and a recorded cutoff time.

## Gates and decisions

These are predeclared **learning hypotheses**, not industry benchmarks, proven conversion rates, or guarantees of future demand. Freeze thresholds before invitations; if changed, record the reason and report both interpretations. A 100-person target is operational scope, not the success metric.

- **Immediate pause:** any Mainnet/real-funds confusion, request for wallet secrets or research signatures, unexpected real-value charge, consent/privacy failure, duplicate submission hazard, or copy that participants reasonably interpret as guaranteed earnings. Stop the affected task, preserve only consented evidence, fix, and rerun before inviting the next cohort.
- **Expansion gate:** no unresolved critical trust or transaction issue; at least 8 of 10 observed participants correctly distinguish the three reward states without help; a full small-cohort D7 report with denominators and at least 80% follow-up observation coverage. If fewer than 10 attempt comprehension, or fewer than 10 activations mature, extend observation and recruitment within the small-cohort cap instead of claiming success.
- **Continue the four-week learning pilot:** aim for at least 25% strict voluntary D7 retention among observed eligible devices, with at least 40 observed eligible devices across the expanded cohorts, at least 80% coverage of mature activations, and the missing-follow-up sensitivity shown. Also aim for at least 3 of the 10 recruited creators to publish a useful second update in 14 days, reporting the actual eligible creator denominator rather than assuming all 10 matured.
- **Consider a further Devnet cohort:** the preceding gates pass, at least 20% of devices observed through four weeks return voluntarily in each weekly window, at least 3 creators describe a concrete ongoing use case supported by observed behavior, and no critical unresolved trust issue remains. Report counts, cohort/build splits, missingness, and uncertainty; a small purposive sample does not establish a causal growth effect.
- **Revise or stop:** below-threshold voluntary use with adequate follow-up, repeat confusion after fixes, or most engagement requiring reminders/reward offers. Interview non-returners who agreed to contact, fix the strongest observed problem, and preregister a new cohort. Do not buy engagement, change definitions retroactively, or erase inactive recruits.

An incomplete denominator produces “insufficient follow-up,” not pass or fail. None of these gates authorizes Mainnet: custody, contract review, operational controls, and the separate launch-readiness requirements still apply.

Weekly review template: build/protocol version; UTC cutoff; invited and consented by role; devices activated; mature/observed/missing for each day/window; returned counts and rates with explicit context; creator update numerator/eligible denominator; task failures and comprehension; withdrawals; fixes; gate decision and next owner. Example formatting only: `D7 voluntary: n/N observed eligible; M mature activations; K missing exports; lower bound n/M`. Do not populate it with synthetic sample numbers as if measured.

## Ready-to-review outreach drafts — not sent

The current entry link is blocked; the initial public invitation intentionally has no app URL. Replace later deployment URLs only after the public HTTPS entry gate passes, using the verified Devnet pilot page. Review the displayed account, privacy contact, support capacity, and recruitment phase before manually posting. These drafts authorize no API posting or direct messages; account access and sending remain separate actions.

**Public invitation from @johntrand83**

> Planning a funded.vip Devnet pilot: 10 creators + 90 community members. Help test project updates and reward clarity. Test funds only; no purchase or earnings promise. Interested? Reply “pilot” for details. No wallet details needed.

**Public context reply, after the invitation**

> Participation is voluntary. You can browse, draft, save and follow without trading. Optional metrics stay on your device unless you share an export. We never ask for wallet secrets or signatures. Devnet tokens have no monetary value.

**Private reply only to someone who requested details**

> Thanks for asking about the pilot. We are recruiting a small Devnet research cohort, not selling tokens. Would you prefer creator tasks or community tasks? The initial session takes about 20–30 minutes, with optional feedback over four weeks. No purchase, promised earnings, wallet secrets or signatures are needed for recruitment. I can send the task outline, privacy terms and verified pilot link before you decide.

**Creator invitation to their own community**

> I am considering a funded.vip Devnet usability pilot and can invite up to 9 community volunteers. The study tests project updates and whether reward states are clear. No buying or trading is required; test tokens have no monetary value. Participation and data sharing are optional. Reply only if you want the research details; no wallet information needed.

**One recruitment follow-up, only if there has been no refusal**

> One follow-up on the Devnet pilot invitation. If the timing is useful, I can send the task and privacy details. If not, no action is needed and I will not follow up again. There is no purchase requirement or earnings promise.

**Onboarding confirmation after consent**

> Your optional pilot session is confirmed. Use the verified Devnet link provided in the study details. Browsing and drafting need no transaction. If you choose a wallet task, use a fresh test wallet and review every request yourself. Keep all secrets and signatures private. You can skip any task; we can use a read-only example if the faucet or network is unavailable.

**Research follow-up after the observation window**

> Your observation window has ended. If you still want to share feedback, what brought you back—or kept you away? Sharing an optional local export is a separate choice; inspect it first and use the private research channel. You do not need to reopen the app or make a transaction for this study. This message is a reminder and any prompted visit will be recorded that way.

**Withdrawal confirmation**

> You have been removed from further pilot contact. We will delete your linked research records as described in the study terms. You can delete the local record in the app's pilot controls; that is separate from copies already shared with us. Public blockchain records cannot be deleted. Thank you for the feedback you chose to share.

**Public findings update template, only after review**

> Devnet pilot update: [consented people] opted in; [observed eligible devices] had complete D7 follow-up. [voluntary return count] returned without a reported reminder or reward offer. [missing follow-up count] remain unobserved. These are small-sample device observations, not earnings or Mainnet readiness.

The findings template may exceed X's single-post limit when populated. Split it into a reviewed thread without dropping denominators or limitations. Do not use the automated financial-event posting worker for research outreach or unverified pilot results.
