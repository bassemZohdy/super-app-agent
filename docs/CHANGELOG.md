# Documentation changelog

## 2 November 2026 — Qualify concurrent food order identity (P1-13, step)

Competing local application processes now tolerate a bounded SQLite journal initialization race, and a cross-process check verifies one original food order. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Preserve integrated food order identities (P1-13, step)

Integrated food orders atomically save an account-scoped operation identity and receipt, return the original on retry and refuse changed terms or missing evidence. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Verify integrated wallet operation replay (P1-02, step)

A local-stack browser qualification checks that different trace IDs preserve one wallet charge and changed terms cannot create a second debit. Guide: [testing](testing.md).

## 2 November 2026 — Preserve domain operation identities across tracing (P1-02, step)

Authenticated domain calls carry their original operation identity independently of diagnostic trace IDs; the application validates it before routing. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bind wallet transactions to captured charges (P1-02, step)

Integrated wallet payment confirmation now matches the transaction to the captured charge and its account, amount and original reference. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bind composite meal price and delivery fee (P1-13, step)

The composite review displays and binds the meal price and delivery fee separately, rechecks both and verifies the resulting order. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bind composite checkout to reviewed terms (P1-13, step)

Composite approval binds the displayed ride, meal, delivery fee, total and currency, rechecks prices before dispatch and passes reviewed amounts to each service. Wallet receipts require the selected mode's currency. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Verify integrated parking meter changes (P1-13, step)

Parking activation checks the charged fee, and extension verifies the vehicle, zone, fee and expiry against the meter read before capture. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Preserve integrated parking outcomes after capture (P1-13, step)

Parking activation and extension verify captured payment details before dispatch and keep inconsistent or failed later provider outcomes unconfirmed. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Restore integrated receipt compatibility (P1-13, step)

Compatibility validation accepts the integrated ride and food response shapes, preserves the requested delivery address, and receives the prior parking duration from the integrated provider. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Restrict compatibility domain writes (P1-02, step)

Compatibility domain adapters reject write routes without a specific receipt contract before dispatch, instead of accepting unchecked success responses. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Preserve partial integrated move-in outcomes (P1-13, step)

The integrated move-in path checks each provider result before the next effect and keeps a later refusal or inconsistent result unconfirmed after an earlier provider responds. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Repair payment accessibility browser checks (P2-05, step)

The payment-state browser check now detects unmasked card digits and waits for rule controls to become enabled before exercising keyboard actions. Guide: [testing](testing.md).

## 2 November 2026 — Bind move-in approval to reviewed tenancy (P1-13, step)

Move-in approval carries the displayed contract and premise, rechecks them before dispatch and checks the premise again at the fixture boundary. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Verify compatibility move-in receipts (P1-13, step)

Move-in confirmations require the requested tenancy, connected utility, waived deposit and issued parking permit before continuing. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Check parking extension increments (P1-13, step)

The parking fixture reports the previous duration and compatibility adapters require the resulting duration to match the requested increment. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Verify compatibility parking receipts (P1-13, step)

Parking activation receipts must match the zone, vehicle and duration; extension receipts must match the original ticket. Meter fields used by the display are validated. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Verify compatibility food order receipts (P1-13, step)

Food confirmations now match the selected restaurant, item quantities and supplied address; inconsistent responses remain unknown. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Verify compatibility ride booking receipts (P1-13, step)

Ride confirmations now match the selected driver and supplied route, retaining inconsistent responses as unknown and stopping composite checkout. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Verify compatibility wallet transaction receipts (P1-13, step)

Wallet payment and top-up confirmations now match the requested amount and require a settled transaction of the correct type and fixture currency. Inconsistent responses remain unknown. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Preserve rate-limited domain write outcomes (P1-02, step)

Local and HTTP domain adapters retain rate-limited writes as unknown, preserving reconciliation when the response follows an applied effect. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Preserve uncertain domain write outcomes (P1-02, step)

Local and HTTP domain adapters retain an unknown outcome for authentication failures and responses indicating a prior effect or conflicting operation identity. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bind legacy settlement proofs (P1-13, step)

Source providers reject payment proof mismatches before creating a claim, and legacy effects recheck the exact payment, account, currency and capture status. Guide: [payment reconciliation](development/payment-reconciliation.md).

## 2 November 2026 — Preserve unconfirmed returned settlement outcomes (P1-02, step)

Returned settlement errors and contradictory success responses now roll back local effects and keep the original claim fenced unless an explicit reviewed refusal proves non-application. Guide: [payment reconciliation](development/payment-reconciliation.md).

## 2 November 2026 — Preserve uncertain settlement claims (P1-02, step)

The source settlement coordinator keeps uncertain or prior-effect errors fenced and returns generic text for confirmed refusals, avoiding provider text in saved attempts. Guide: [payment reconciliation](development/payment-reconciliation.md).

## 2 November 2026 — Constrain settlement identities (P1-02, step)

The settlement transport rejects path-changing account, payment and attempt identifiers before obtaining credentials or dispatching, and validates returned claim identities. Guide: [payment reconciliation](development/payment-reconciliation.md).

## 2 November 2026 — Harden settlement claim transport (P1-02, step)

The settlement client refuses redirects and automatic 401 retries, bounds and sanitizes replies, and verifies claim, charge and acknowledgement bindings before allowing settlement to proceed. Guide: [payment reconciliation](development/payment-reconciliation.md).

## 2 November 2026 — Restrict provider request methods (P1-02, step)

The application provider client accepts only its supported GET and POST operations and restricts the account bootstrap route to GET before obtaining credentials or making a request. Guide: [connections](development/connections.md).

## 2 November 2026 — Preserve provider writes after authentication failures (P1-02, step)

The provider client no longer automatically resends a write after a 401; it retains an unconfirmed outcome and invalidates rejected service credentials for subsequent calls. Guide: [connections](development/connections.md).

## 2 November 2026 — Reconcile prior provider effects (P1-02, step)

Provider write refusals that indicate a prior payment, capture, decision, dispatch or conflicting operation identity remain unconfirmed until the original effect is inspected. Guide: [connections](development/connections.md).

## 2 November 2026 — Preserve unknown provider write outcomes (P1-02, step)

The application provider client treats unrecognized or incomplete write refusals as unconfirmed, while retaining reviewed rejection codes and sanitizing provider text. Guide: [connections](development/connections.md).

## 2 November 2026 — Explain unconfirmed pause results (P1-12, step)

The React automation panel distinguishes confirmed pauses from unconfirmed or unreadable results and directs the owner to check the current rule state. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Verify owner pause-all results (P1-10, step)

Pause-all validates all mandate owners, accounts, states and versions before dispatch, and reports contradictory or unreadable pause responses as unconfirmed without provider text. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Verify automation inbox ownership (P1-10, step)

The automation inbox rejects malformed or contradictory mandate lists and checks each mandate's owner and account before exposing job history. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Deduplicate automation claims (P1-10, step)

Worker claims atomically suppress unclaimed duplicate occurrences across rule versions, including jobs enqueued outside the scheduler, while preserving original claimed or held work. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Deduplicate periodic jobs across versions (P1-10, step)

Periodic catch-up retains at most one unclaimed job per occurrence and skips queued duplicates of an already completed occurrence. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Prevent queued automation catch-up bursts (P1-10, step)

Periodic catch-up atomically skips older unclaimed jobs and retains only the newest, while claimed or held work blocks a replacement and remains untouched. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Align parking schedule previews (P1-10, step)

Parking previews use the first eligible instant within the mandate window and require the session still to be active at that instant. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Respect invoice mandate windows (P1-10, step)

Invoice-due scheduling and previews exclude occurrences before the mandate starts and at or after its expiry, including during catch-up. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Validate automation scheduling rules (P1-02, step)

The scheduler validates the complete worker-scoped rule list and rejects duplicate identities or malformed triggers, windows and time zones before processing any rule. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Validate scheduled occurrence readings (P1-02, step)

The automation scheduler rejects invalid invoice dates, ambiguous or invalid fine identifiers and malformed parking sessions before recording occurrences. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Validate automation scheduler readings (P1-02, step)

Scheduler HTTP reads are bounded and require an unambiguous success envelope; balance and usage counts must be nonnegative safe integers before threshold state changes. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Bind automation stores to one run (P1-02, step)

Worker startup binds an empty job store to its isolated run and refuses a different run or an older store with unbound scheduling history. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Bind automation jobs to their run before preparation (P1-02, step)

The worker records its configured run before dispatch and refuses to retry or obtain credentials through a different run. Unbound older in-flight preparations remain held. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Inspect held automation jobs locally (P1-02, step)

A read-only command derives the original preparation request from a held job, verifies returned evidence and leaves the worker and job history untouched. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Inspect original automation preparations (P1-02, step)

The isolated provider and worker adapter expose a read-only, worker-scoped lookup of a preparation by its original request key, with rule and run binding checks. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Preserve uncertain automation preparations (P1-02, step)

Exhausted preparation retries and refusals after a lost or interrupted preparation remain held for reconciliation under the original request identity. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Reject contradictory automation replies (P1-02, step)

The worker rejects success responses that also report errors, contradictory preparation skips, and empty, oversized or expired credentials before dispatch or challenge resumption. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Preserve settled-payment uncertainty (P1-13, step)

After integrated bill and fine settlement, an unavailable or malformed wallet balance produces an unknown outcome rather than a refusal that could invite a replacement payment. Guide: [integrations](integrations.md).

## 2 November 2026 — Validate fine selections before provider writes (P1-13, step)

Integrated fine settlement rejects duplicate fine or payable identities and missing revisions before creating a provider selection. Guide: [integrations](integrations.md).

## 2 November 2026 — Verify settled bill state (P1-13, step)

After integrated utility or telecom settlement, the application checks the refreshed bill's identity, paid state, exact amount and receipt reference before reporting success. Conflicting or unavailable evidence remains unknown. Guide: [integrations](integrations.md).

## 2 November 2026 — Refuse ambiguous bill identities (P1-13, step)

Integrated utility and telecom settlement now requires one matching bill and one matching payable; duplicate provider identities stop before an order or already-paid receipt. Guide: [integrations](integrations.md).

## 2 November 2026 — Require exact unpaid bill amounts (P1-13, step)

Integrated utility and telecom settlement rejects unreadable, negative or fractional-fil bill amounts before creating an order, instead of rounding provider data. Guide: [integrations](integrations.md).

## 2 November 2026 — Verify previously paid bill evidence (P1-13, step)

Integrated utility and telecom bill responses require a usable original receipt reference and valid exact-fils amount before reporting an already-paid bill. Invalid evidence remains unconfirmed without another payment. Guide: [integrations](integrations.md).

## 2 November 2026 — Type application payment receipt contracts (P2-04, step)

Application OpenAPI now describes the types of fine, utility and telecom bill, and toll and prepaid recharge receipt fields, with checks against mapped application responses. Guide: [application API](development/application-api.md).

## 2 November 2026 — Bound current-eligibility reads (P1-10, step)

The shared authority reader limits response bytes, refuses contradictory success responses and cancels rejected bodies before a token retry. Guide: [payment lifecycle](development/payment-lifecycle.md).

## 2 November 2026 — Bind automation permits to eligibility versions (P1-10, step)

Automation permits retain the mandate's eligibility version and recheck it before and after token issuance and during provider use. A revoked and restored membership cannot revive an old permit. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Validate automation authority views (P1-10, step)

The broker bounds execution-view responses, rejects contradictory envelopes and requires explicit well-typed authority flags before issuing a permit. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Revalidate authority at the focused tool boundary (P1-02, step)

Consequential focused tools now recheck the same identity and current permission immediately before dispatch, within the tool deadline. A late identity check cannot dispatch after timeout. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Verify automation settlement receipts (P1-02, step)

The worker persists the prepared amount and accepts settlement only when the receipt names that exact amount in AED. Older preparations without a stored amount and unverifiable receipts are held for reconciliation. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Hold unfamiliar automation reasons (P1-02, step)

Automation skips and order failures now accept only recognized reason codes. Unknown values are held for reconciliation without saving provider-supplied text. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Bind automation preparation to the queued rule (P1-02, step)

Before requesting a credential, the automation HTTP adapter verifies the returned run, mandate, occurrence, policy version, prepared state and bounded amount and currency. Skips must name the same mandate and occurrence. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Bind automation execution results to the prepared order (P1-02, step)

The automation worker checks the returned order identity, state and capture flag before accepting an outcome. Mismatches and contradictory settlement or challenge responses remain held. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Bound and sanitize automation HTTP outcomes (P1-02, step)

The worker bounds automation responses, keeps documented refusal codes without provider error text, and treats malformed, contradictory or unrecognized replies as uncertain. Credential and execution uncertainty stays held under the original identity. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Validate automation kill-switch responses (P1-10, step)

The worker bounds and validates the broker's desired-state response before applying it. Contradictory, malformed or oversized responses leave the current switch unchanged. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Preserve automation kill-switch ordering (P1-10, step)

Broker and local switch changes now advance their stored timestamps monotonically. Workers retain authority timestamps and atomically reject stale desired states, including after delayed polls or concurrent local changes. Guide: [automation worker](development/automation-worker.md).

## 2 November 2026 — Sanitize kill-switch verification responses (P2-05, step)

The stack verification bounds identity and broker responses and avoids including response bodies in failed assertions. Its identity-token reader rejects invalid responses without exposing their contents. Guide: [testing](testing.md).

## 2 November 2026 — Respect explicit English negation in demo requests (P1-13, step)

The deterministic demo planner declines recognized negated payment and renewal requests rather than preparing a review. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Reject duplicate focused resource IDs (P1-02, step)

Focused fine and vehicle tool outputs require unique IDs. Duplicate records make the read unavailable and cannot start payment or renewal review. Guide: [integrations](integrations.md).

## 2 November 2026 — Review named fine batches in Arabic (P1-16, step)

The deterministic demo planner recognizes a precise Arabic command naming multiple fines. Selected batches still require separate payment confirmation before a renewal can be reviewed. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize fine review limits (P2-01, step)

The React focused journey displays known fine-selection and batching guidance in Arabic in the conversation and service pane. The exact server reply is matched before translation. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Guide larger fine sets through reviewed batches (P1-13, step)

Payment and renewal requests exceeding the quote limit now ask for batches instead of failing or silently choosing fines. The resident can separately review and confirm each batch before renewal. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Bind payment follow-ups to the displayed list (P1-13, step)

Supported pronoun payment requests require a successful immediately preceding list and review only its fine IDs, excluding later additions. Empty or missing context asks for clarification. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Bind whole resource tokens (P1-13, step)

Focused fine and vehicle selection retains prefixes and incomplete references, preventing substitution or a default selection; the model receives placeholders instead of these references. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Preserve complete resource references (P1-13, step)

Fine and vehicle selection retains trailing hyphens instead of substituting a shorter ID; the fixture planner leaves exact fine binding to the graph. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Align payment review records (P1-13, step)

The structured focused response now matches the selected fine rows and quote during payment review, including when the interaction is restored. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Reset focused resource snapshots on a new request (P1-12, step)

Focused requests no longer carry prior fine or vehicle data into clarification, unsupported-service or planning-error responses. Conversation history remains available for selected-fine follow-ups. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Remove confirmed payments from the fine snapshot (P1-13, step)

After a verified simulated payment, the focused response and restored surface exclude the paid fines while retaining other entries from the earlier list. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Respect named fine reads (P1-13, step)

Focused fine reads and surfaces now show only explicitly requested fines. A missing selection returns an unavailable message and no partial or stale list. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Bind Arabic demo selections (P1-13, step)

The deterministic demo planner recognizes exact Arabic requests naming a fine or vehicle, while refusing ambiguous or negated mixed-language requests. Browser checks verify a named fine is reviewed and paid only after confirmation. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize focused recovery outcomes (P2-01, step)

The React focused journey distinguishes known refused and unknown payment or renewal outcomes in Arabic, preserving codes and any completed fines payment. Browser checks simulate an unknown response and recover the original payment without replacement. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize focused renewal summaries (P2-01, step)

The React focused journey translates known renewal review and outcome messages, retaining vehicle, fee and any completed fines payment. Browser checks verify both approval and declining renewal after fines were paid. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize focused payment summaries (P2-01, step)

The React fines conversation and service panel translate known list, review and completed-payment templates in Arabic while retaining their exact counts and amounts. The renewal review keeps its separate-approval warning; unfamiliar responses remain unchanged. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize focused safety replies (P2-01, step)

The React fines conversation and service panel translate known fixed safety and availability messages in Arabic. Unknown or detailed responses remain unchanged; browser checks verify rejecting a payment causes no payment. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Support Arabic demo requests (P2-01, step)

React fines suggestions send Arabic requests when Arabic is selected. The deterministic demo planner recognizes the exact supported Arabic list, payment-review and renewal phrases; negated wording does not trigger a payment review. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize React workspace controls (P2-01, step)

The React concierge and focused fines workspaces localize pane labels, controls and resize guidance. Right-to-left pointer and arrow-key resizing follow the visible divider. Guide: [design tokens](development/design-tokens.md).

## 2 November 2026 — Localize focused service tables (P2-01, step)

The React focused fines and vehicle tables translate known column headings without changing rows or amounts. The shared renderer aligns tables to reading direction and marks column headers. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize focused review decisions (P2-01, step)

The React focused fines and renewal reviews translate matching totals and decision controls while preserving their original approval payloads. Browser checks exercise separate approvals on desktop and phone; unexpected surface content is left unchanged. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize fines status and errors (P2-01, step)

The React focused fines workspace presents progress and safe recovery guidance in Arabic, with a separate message for unavailable account access. Browser checks exercise access refusal and recovery after a lost payment response. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize React fines conversation controls (P2-01, step)

The React focused fines workspace translates conversation controls, review headings, confirmation warning and receipt labels, with Arabic-aware receipt amounts and expiry times. Browser checks cover the Arabic review without making a payment. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Localize React fines sign-in (P2-01, step)

The React focused fines sign-in and navigation follow the saved English or Arabic language and page direction. Browser checks cover Arabic sign-in and navigation at desktop and phone widths. Guide: [shell parity](development/shell-parity.md).

## 2 November 2026 — Protect broker identity exchanges (P1-02, step)

The delegation and automation broker limits successful identity responses and records only the HTTP status for rejected exchanges. Oversized responses do not reach the provider, and identity-server error text is not logged. Guide: [delegation](development/delegation.md).

## 2 November 2026 — Validate local backend startup (P2-06, step)

The development backend rejects duplicate or invalid ports before opening listeners and waits for all six services before announcing readiness. Process tests verify health endpoints and released ports after stopping. Guide: [local development](development/local-development.md).

## 2 November 2026 — Protect delegated execution results (P1-02, step)

The broker refuses a provider result that echoes its delegated bearer and redacts sensitive fields before saving or replaying successful results. The original execution remains unknown when a credential is echoed. Guide: [delegation](development/delegation.md).

## 2 November 2026 — Keep delegated failures unconfirmed (P1-02, step)

Delegated provider failures now return an unconfirmed outcome even when the HTTP response is successful, and raw failure bodies are not returned or saved. The original execution remains blocked pending reconciliation. Guide: [delegation](development/delegation.md).

## 2 November 2026 — Bound delegated provider responses (P1-02, step)

The delegation broker limits provider response bodies and rejects malformed or non-object results. An oversized or unreadable response leaves the original execution unknown and blocks another dispatch. Guide: [delegation](development/delegation.md).

## 2 November 2026 — Verify delegated credit receipts (P1-02, step)

The delegation broker verifies that a successful synthetic wallet-credit response contains a settled AED top-up for the approved amount and a valid balance. Contradictory or mismatched receipts remain unknown and cannot be repeated blindly. Guide: [delegation](development/delegation.md).

## 2 November 2026 — Verify confirmed wallet payment terms (P1-13, step)

Composite checkout recovery checks the original wallet operation and each reviewed payment item as well as the ledger before accepting a confirmed debit. Missing, unavailable or changed operation evidence blocks continuation and resolution. Guide: [integrations](integrations.md).

## 2 November 2026 — Recover a refused step after fixture restart (P1-13, step)

A first attempt recorded as refused can be explicitly retried with the same reviewed operation after its fixture restarts. Unknown or previously retried attempts remain bound to their original fixture lifetime. Redis/HTTP tests cover concurrent retries, changed evidence and a second restart during dispatch. Guide: [integrations](integrations.md).

## 2 November 2026 — Retry a refused civic step (P1-13, step)

The owner can retry a refused original or continued checkout step using its saved identity and fixture lifetime after prior evidence is rechecked. A failed retry becomes unknown. Redis/HTTP tests cover corrected fine terms, concurrent requests, an original utility refusal and a fixture restart. Guide: [integrations](integrations.md).

## 2 November 2026 — Retry original civic checkout steps (P1-13, step)

Separate-service offline checkout records each original step's fixture lifetime before dispatch. The owner can retry an uncertain original step with its saved identity only during that lifetime. Redis/HTTP tests cover the first wallet step, older journals, unavailable lifetime checks and a real wallet-service restart. Guide: [integrations](integrations.md).

## 2 November 2026 — Retry an uncertain civic continuation (P1-13, step)

The owner can retry a journaled continuation with its original operation ID while the same synthetic fixture process is available. Fixtures refuse a changed lifetime before mutation; failed retries remain unknown and fenced. Redis/HTTP tests cover pre-dispatch failure, concurrent and in-flight retries, each step type, and a real fixture-service restart. Guide: [integrations](integrations.md).

## 2 November 2026 — Verify interrupted civic continuation (P1-13, step)

The Redis/HTTP recovery test now stops another agent after the utility step takes effect and races fresh agent processes to continue. It verifies both original outcomes, one fine settlement and final checkout resolution. Fixture services stay running. Guide: [integrations](integrations.md).

## 2 November 2026 — Verify civic recovery across agent processes (P1-13, step)

A Redis/HTTP integration test kills the original agent while its wallet response is in flight, then uses fresh processes to observe the debit, continue the reviewed checkout and resolve it without repeating the debit. The synthetic fixture services remain running throughout. Guide: [integrations](integrations.md).

## 2 November 2026 — Continue the original offline checkout (P1-13, step)

The owner can continue a verified partial civic checkout one original step at a time. Each step is journaled before dispatch, fine terms include each reviewed amount, and uncertain outcomes stay fenced for observation. Redis/HTTP tests cover concurrency, changed evidence, refusal, lost responses, in-flight observation and final resolution. Guide: [integrations](integrations.md).

## 2 November 2026 — Admit fresh civic checkout after resolution (P1-13, step)

For separate-service offline fixtures, the shared civic fence now governs subsequent actions after explicit resolution. Redis/HTTP tests verify that an unresolved checkout still blocks a new action and a fresh review can complete in the same agent process after resolution. Guide: [integrations](integrations.md).

## 2 November 2026 — Record an observed toll outcome (P1-13, step)

The owner can record a verified lost toll response in the original journal without another recharge, then resolve the complete checkout after a fresh evidence check. Redis/HTTP tests cover prior recoveries, account isolation, concurrency and an in-flight response. Guide: [integrations](integrations.md).

## 2 November 2026 — Identify a lost offline toll response (P1-13, step)

Separate-service civic checkout saves a toll operation ID before dispatch. The synthetic ride fixture binds it to the reviewed tag and amount, deduplicates same-term requests within its process, and supports exact-receipt evidence after a lost response. Guide: [integrations](integrations.md).

## 2 November 2026 — Record an observed fine outcome (P1-13, step)

The owner can record independently matched fine evidence against the original civic journal without repeating settlement or clearing the fence. Redis/HTTP tests cover changed evidence, account isolation, retries, prior recoveries and a response still in flight. Guide: [integrations](integrations.md).

## 2 November 2026 — Identify a lost offline fine response (P1-13, step)

Separate-service civic checkout saves a fine operation ID before dispatch and compares lost responses with the exact fine operation, receipt and wallet ledger. Redis/HTTP and evidence tests cover uncertain responses, changed records and account isolation. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind offline fine settlement identities (P1-13, step)

The synthetic fines fixture binds a supplied operation ID to the exact fine set and reviewed total, returns the original receipt on same-term repeats, and exposes the original settlement for later reconciliation. Integrated provider mode rejects this offline identity. Guide: [integrations](integrations.md).

## 2 November 2026 — Record an observed utility outcome (P1-13, step)

The owner can record verified utility evidence in the original civic journal without repeating settlement or releasing its fence. Redis/HTTP tests cover changed evidence, account isolation, retries, concurrency and a response still in flight. Guide: [integrations](integrations.md).

## 2 November 2026 — Identify a lost offline utility response (P1-13, step)

Separate-service civic checkout saves a utility operation ID before dispatch. The synthetic utility fixture binds that ID to the reviewed bill and amount, deduplicates same-term requests within its process, and supports read-only evidence after a lost response. Redis/HTTP tests cover the lost response and older wallet journals. Guide: [integrations](integrations.md).

## 2 November 2026 — Record an observed wallet outcome (P1-13, step)

The owner can record matching lost-response wallet evidence against the original civic journal without another debit or fence release. Live Redis/HTTP tests cover changed evidence, cross-account requests, retries, concurrency and an original wallet response still in flight. Guide: [integrations](integrations.md).

## 2 November 2026 — Identify a lost offline wallet response (P1-13, step)

Separate-service civic checkout saves a wallet operation ID before dispatch. The synthetic wallet deduplicates same-term requests within its process, rejects changed terms, and exposes the original operation for owner-scoped evidence after a lost response. The result remains fenced and is not automatically retried; wallet-process restart loses the in-memory operation history. Guide: [integrations](integrations.md).

## 2 November 2026 — Resolve a verified complete civic checkout (P1-13, step)

The owner can explicitly acknowledge a complete offline composite checkout after the gateway rechecks every recorded step against current fixture evidence. Resolution atomically archives the exact revision, retires the original approval and clears its fence; retries do not clear newer checkouts. Live Redis/HTTP tests cover stale, unknown, changed-evidence, cross-account and concurrent requests. Guide: [integrations](integrations.md).

## 2 November 2026 — Compare the selected fine receipt (P1-13, step)

Offline civic evidence now requires the wallet ledger and a fine receipt to match the reviewed fine IDs and amounts. Live Redis/HTTP and focused tests cover matching receipts, altered selections and unavailable evidence; integrated provider mode does not use the shared fixture lookup. Guide: [integrations](integrations.md).

## 2 November 2026 — Compare synthetic toll receipts (P1-13, step)

The offline toll fixture keeps a bounded in-memory recharge history, allowing owner-scoped civic evidence checks to compare the confirmed receipt, reviewed tag and amount. Missing or evicted records remain unverified; integrated provider mode does not fall back to the fixture. Focused and live Redis/HTTP tests cover matching and missing records. Guide: [integrations](integrations.md).

## 2 November 2026 — Compare saved civic references (P1-13, step)

The owner-scoped offline civic status can compare confirmed wallet, fine and utility references with current fixture records. Unknown, missing, duplicate and unavailable evidence stays unverified; toll lookup is explicitly unsupported. Live Redis/HTTP and focused tests cover matching, ambiguous and inaccessible records without clearing the fence. Guide: [integrations](integrations.md).

## 2 November 2026 — Preserve confirmed civic receipt references (P1-13, step)

The owner-scoped civic journal retains bounded transaction or receipt references for confirmed wallet, utility, fines and toll steps. Live Redis/HTTP tests verify confirmed references remain available after partial outcomes and failed session saves; unknown steps do not gain a reference. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind civic toll receipts to the reviewed tag (P1-13, step)

Offline composite checkout carries its reviewed toll tag through recharge, rejects a changed target before credit, and treats a mismatched tag or amount in the receipt as unknown. Focused tests and live Redis/HTTP tests cover wrong-target refusals and uncertain receipts after earlier confirmed steps. The application contract passed on a disposable synthetic stack using revision `26560d1` plus this change, Node 24.16.0, Docker 29.9.2 and Compose 5.6.1. Guide: [integrations](integrations.md).

## 2 November 2026 — Preserve reviewed civic resources (P1-13, step)

Separate-service composite checkout stores the reviewed bill, fines, toll target and exact amounts in the owner-scoped fence before dispatch. Live Redis and HTTP tests verify the review is present before the wallet call, remains bound after an unknown response, and stays hidden from other accounts. Guide: [integrations](integrations.md).

## 2 November 2026 — Journal civic payment attempts (P1-13, step)

Separate-service civic actions record each step before dispatch and retain its classified response in the owner-scoped fence. Live Redis and HTTP tests cover a lost wallet response, a refused utility step after debit, and session-save failure. This evidence does not itself reconcile a payment. Guide: [integrations](integrations.md).

## 2 November 2026 — Identify the fenced civic journey (P1-13, step)

Shared offline civic fences retain an owner/account-bound session and action, with an authenticated read-only status that hides journey details from other accounts and preserves legacy fences. Live Redis and gateway tests cover ownership, legacy records and session-save failure. Guide: [integrations](integrations.md).

## 2 November 2026 — Hold the civic fence until session save (P1-13, step)

Confirmed separate-service civic payments keep their shared fence until the gateway saves the completed session. A live Redis and local HTTP test exercises both a successful save and a failed save after payment; the latter retains the fence. Guide: [integrations](integrations.md).

## 2 November 2026 — Coordinate separate-service civic payments (P1-13, step)

HTTP-connected offline civic actions now acquire a non-expiring shared Redis fence before dispatch and retain it on uncertain or partial effects. A live Redis and local HTTP test confirms a lost wallet reply leaves the fence in place for a fresh agent process; definite pre-debit refusal releases it. Direct service calls and durable reconciliation remain outside this fence. Guide: [integrations](integrations.md).

## 2 November 2026 — Fence uncertain offline checkout across sessions (P1-13, step)

An uncertain or partially completed offline civic checkout now blocks overlapping civic payment actions in other agent sessions for the lifetime of the process. Tests cover uncertain wallet results, refused or changed utility settlement, and a definite pre-debit refusal. Durable cross-service recovery remains open. Guide: [integrations](integrations.md).

## 2 November 2026 — Scope utility reads to the account (P1-13, step)

Utility bill and consumption reads and implicit bill settlement select the account's synthetic utility account; bill payable metadata must name that account too. Mixed-account, missing and malformed provider responses are covered by focused tests; the application contract passed on a disposable synthetic stack using revision `c08973d` plus this change, Node 24.16.0, Docker 29.9.2 and Compose 5.6.1. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind utility settlement to the account (P1-13, step)

Standalone and grouped utility payments reject bills or payables outside the account's synthetic utility account, and reject a mismatched premise when present. Focused boundary tests and all 17 documented application contract writes passed; live checks used revision `3858ce6` plus this change, Node 24.16.0, Docker 29.9.2 and Compose 5.6.1 on a disposable synthetic stack. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind integrated fine settlement to the account plate (P1-13, step)

Standalone and manual grouped fine settlement refuse provider fines or selection quotes for a different plate before creating payment. Wrong-plate tests and the valid grouped checkout and application contract writes passed; live checks used revision `b151013` plus this change, Node 24.16.0, Docker 29.9.2 and Compose 5.6.1 on a disposable synthetic stack. Guide: [integrations](integrations.md).

## 2 November 2026 — Scope fine lookups to the selected plate (P1-13, step)

Offline and integrated fine lookups now filter by the selected or default plate and calculate exact totals; integrated lookups refuse a different account plate before provider access. Authenticated checks of both routes passed on an isolated synthetic stack using revision `2e547fa` plus this change, Node 24.16.0, Docker 29.9.2 and Compose 5.6.1. Guide: [integrations](integrations.md) · [testing](testing.md).

## 2 November 2026 — Qualify isolated React payment journeys (P0-08, step)

The React payment-account browser journeys passed on desktop and mobile with fresh synthetic providers and qualification Keycloak/Redis. Commands, revision, tool versions and limits: [evidence](reports/2026-11-02-isolated-payment-browser.md). Guide: [testing](testing.md).

## 2 November 2026 — Use isolated realm credentials in React E2E (P0-08, step)

The React fixture reads client credentials from the selected stack and refuses missing credentials in qualification. The previously failing stale-action journey passed on desktop and mobile against disposable Compose, using revision `216d524` plus this change, Node 24.16.0, Docker 29.9.2 and Compose 5.6.1. Guide: [testing](testing.md).

## 2 November 2026 — Bind standalone approvals to reviewed amounts (P1-13, step)

Standalone fine and utility approvals carry the displayed amount in offline and integrated modes. Offline fixtures reject stale terms before settlement; tests also reject client tampering with the bound amount. Guide: [integrations](integrations.md).

## 2 November 2026 — Guard offline utility settlement terms (P1-13, step)

The offline utility fixture refuses changed reviewed amounts, unsupported revisions and repeated settlement of an already-paid bill. Composite checkout passes its reviewed utility amount; a post-debit change stops the journey for reconciliation. Guide: [grouped checkout](development/checkout-groups.md).

## 2 November 2026 — Exercise offline composite failure outcomes (P1-13, step)

Test an inconsistent wallet response after debit and a refused utility settlement after debit. Both stop later steps and fence the current session for reconciliation. Cross-session and durable recovery remain open. Guide: [grouped checkout](development/checkout-groups.md).

## 2 November 2026 — Coordinate offline civic actions (P1-13, step)

The agent's offline composite checkout and standalone fine and utility actions now share one process-local guard. A regression interleaves these actions and checks that the reviewed checkout settles once. Direct service calls and cross-process coordination remain open. Guide: [grouped checkout](development/checkout-groups.md).

## 2 November 2026 — Validate composite fine summaries (P1-13, step)

Reject composite reviews whose fine count, distinct IDs or summed amounts disagree, and recheck the offline action before dispatch. Tests cover inconsistent reads before review and payment, with no fixture changes. Guide: [grouped checkout](development/checkout-groups.md).

## 2 November 2026 — Compare offline checkout reviews by value (P1-13, step)

Equivalent checkout confirmations no longer fail solely because a client reordered JSON object fields. The existing tampering, stale-review, replay and exact-debit tests remain in place. Guide: [grouped checkout](development/checkout-groups.md).

## 2 November 2026 — Guard browser test-route forwarding (P0-08, step)

Existing explicit browser forwarding checks for local, non-interactive targets and refuses redirects. A source check catches direct route forwarding, and live browser tests verify a redirect never reaches a second server. Node-side traffic and other page-level interception remain outside this guard. Guide: [testing](testing.md).

## 2 November 2026 — Fence qualification WebSockets (P0-08, step)

The browser network fence also closes unhandled WebSockets to interactive-stack ports in qualification. A desktop and mobile browser test verifies HTTP and WebSocket interception against a disposable server and checks an unfenced control can reach it. Page-level forwarding and Node-side requests remain outside this fence. Guide: [testing](testing.md).

## 2 November 2026 — Fence browser requests during qualification (P0-08, step)

The browser fixture aborts unhandled HTTP requests to interactive-stack loopback ports when a qualification offset is set, and fails the test. Policy tests cover each configured port and loopback host; page-level forwarding, WebSockets and Node-side requests remain outside this guard. Guide: [testing](testing.md).

## 2 November 2026 — Fence Angular browser qualification target (P0-08, step)

The Angular browser fixture refuses an isolated qualification run if its compiled gateway is missing, ambiguous or does not match the isolated endpoint. Angular test stubs follow the selected gateway. Guide: [testing](testing.md).

## 2 November 2026 — Guard overlapping offline checkouts (P1-13, step)

Prevent two concurrent sessions in one agent process from executing the shared offline composite checkout at once. A regression confirms that only one reviewed checkout debits the wallet and recharges the tag. Cross-process and other-route coordination remain open. Guide: [grouped checkout](development/checkout-groups.md).

## 2 November 2026 — Preserve effects across controlled gateway errors (P1-02, step)

When a controlled request, eligibility or session error follows a tracked effect, report the partial or unknown outcome and fence the current session for reconciliation. Tests inject these errors after local simulated effects; real distributed lease-loss recovery remains open. Guide: [integrations](integrations.md).

## 2 November 2026 — Validate grouped-payment response totals (P1-02, step)

The compatibility domain adapter checks grouped-payment responses against requested item amounts in integer fils for both route aliases and both transports. Malformed balances and mismatched or imprecise totals remain unknown after dispatch. Guide: [integrations](integrations.md).

## 2 November 2026 — Correct offline composite checkout amounts (P1-13, step)

Bind offline composite confirmation to the reviewed bill, fine IDs and amounts, and toll tag. Recheck current terms and funds before dispatch; charge selected fines once and omit settled obligations. Tests cover stale reviews, replay, wallet totals and a later recharge-only review. The separate fixture operations do not establish atomic settlement. Guide: [grouped checkout](development/checkout-groups.md).

## 2 November 2026 — Check offline fine review before debit (P1-13, step)

The offline fine-payment aliases reject a changed reviewed amount before settling and refuse provider revisions they cannot validate. Tests cover unchanged state on rejection and an exact-amount payment. Guide: [integrations](integrations.md).

## 2 November 2026 — Refuse invented offline checkout funding (P1-13, step)

Reject underfunded legacy unified wallet settlements instead of fabricating a card charge and replacing the wallet balance. Verify both route aliases and the composite action leave fixtures unchanged after refusal. Guide: [grouped checkout](development/checkout-groups.md).

## 2 November 2026 — Verify selected grouped checkout on Compose (P0-08, step)

An isolated authenticated qualification-stack check exercises rejected selections, a selected fine and toll recharge, unchanged unrelated resources and original-request replay. It ran against source revision `9cf6ffa` with Node 24.16.0, Docker 29.9.2 and Compose 5.6.1; the full application contract write check also passed on that stack. This is synthetic Compose evidence, not real-provider or native-device qualification. Guide: [testing](testing.md).

## 2 November 2026 — Select reviewed grouped-checkout payables (P1-13, step)

Integrated manual grouped checkout now requires reviewed bill and fine IDs and revisions and plans only those payables; an empty selection means recharge only. It rejects stale, duplicate or unknown selections and checks the selected fine set. The utility bill read exposes its payable ID, the integrated OpenAPI and verification scripts are updated, and the offline fixture refuses selected-resource requests. Guide: [integrations](integrations.md).

## 2 November 2026 — Check grouped checkout's reviewed total (P0-04, step)

Integrated manual grouped checkout compares the caller's reviewed amount with current provider payables before group creation and with the returned group before approval or execution. Changed payables or totals cannot silently advance. Verification scripts now supply the expected amount; individual descriptions remain outside this check. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind grouped checkout to a toll target (P1-13, step)

The integrated manual grouped-checkout API accepts a selected toll target and version, validates the returned quote, and refuses an ambiguous implicit target. The offline wallet rejects target-specific fields without changing funds. The application OpenAPI and targeted tests cover explicit selection, stale or substituted targets and the single-target case. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind grouped checkout to its plan (P0-04, step)

Compatibility grouped checkout verifies its saved item set, owner, source, child quotes and totals before approval or execution, retains a local group binding across requests, and checks settled child receipts. Inconsistent results remain unknown. Tests cover substituted groups, changed terms after reopening, wrong receipts and original-child recovery. Guide: [integrations](integrations.md).

## 2 November 2026 — Retain compatibility quote bindings (P0-04, step)

Compatibility payments atomically store a hash of the first observed order quote and its approval digest before advancing, then reject changed terms on later requests. A reopened application store test covers changed quotes, changed digests and original-order recovery. This local binding does not authenticate the initial provider quote or establish replicated durability. Guide: [integrations](integrations.md).

## 2 November 2026 — Keep compatibility payment quotes stable (P0-04, step)

Compatibility bill, fine and recharge transitions reject changes to the complete quote or approval digest during one attempt, including after approval. JSON key ordering does not affect comparison. The check does not authenticate provider quotes or persist a separate reference across requests. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind compatibility payment order ownership (P0-04, step)

Compatibility bill, fine and recharge transitions now require the original safe order ID, subject, workspace and requested wallet source on every returned order before approval, execution or recovery. Substituted identities and funding sources remain unknown. Provider-signed quotes and production delegated consent remain separate. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind recharge orders to targets (P1-13, step)

Integrated toll and prepaid recharges check their original quote, each order and the final receipt against the requested provider, target, amount and credited balance. Mismatches stop approval or remain unknown for inspection, including during original-order recovery. Tests cover all three simulated providers and lost-response recovery. Guide: [integrations](integrations.md).

## 2 November 2026 — Check fine orders before execution (P1-13, step)

Integrated compatibility fines payments compare the order's frozen selection, reference and total to the selected fines before approval, execution and recovery, retaining inconsistent outcomes as unknown. Tests cover substituted selections and changed totals before approval, changed orders after approval and mismatched settlement receipts. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind integrated bill orders (P1-13, step)

Integrated utility and telecom payments check each frozen order against the selected payable before approval, execution and recovery, and require the final receipt to match the bill, amount and currency. Inconsistent results retain an unknown outcome. Tests exercise substituted orders and receipts for all three providers. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind compatibility utility receipts (P1-13, step)

The compatibility agent confirms utility receipts name the selected bill and match the reviewed AED amount before reporting success. Malformed or mismatched receipts leave the write outcome unknown in both local and HTTP transports. Tests exercise both receipt formats and the local utility handler. Guide: [integrations](integrations.md).

## 2 November 2026 — Bind compatibility fine receipts to identities (P1-13, step)

The local wallet returns its settled fine IDs; the integrated application checks the provider selection before payment and its frozen settled order and receipt afterward. The compatibility agent requires the returned IDs to match the request, treating a mismatch as unknown. The application OpenAPI is regenerated and tests cover substitution, duplicate IDs and receipt mismatches. Guide: [integrations](integrations.md).

## 2 November 2026 — Check compatibility fines receipts (P1-13, step)

Compatibility domain adapters no longer report success when a fines receipt has a different count or reviewed amount, or an invalid amount. Unconfirmed writes remain unknown in both local and authenticated HTTP transports. The legacy receipt does not identify each settled fine. Guide: [integrations](integrations.md).

## 2 November 2026 — Tighten browser login request lifetime (P0-01, step)

The shared browser client consumes callback requests once, strips callback parameters even when saved state is corrupt, and rejects incomplete, future-dated or five-minute-old requests before exchange. The generated Flutter bridge and unit and desktop/mobile browser tests cover the change. Production server-side state and nonce remain separate. Guide: [security](security.md).

## 2 November 2026 — Bound browser token responses (P0-11, step)

The shared browser client limits token-exchange bodies while reading, declines oversized or malformed responses without exposing their contents, and does not wait for cancellation of an oversized stream. The generated Flutter bridge and targeted unit and desktop/mobile browser tests cover the same boundary. Guide: [security](security.md).

## 2 November 2026 — Validate browser token responses (P0-01, step)

The shared browser client rejects malformed token values and lifetimes on login and refresh, and clears an unchanged expired session when refresh fails. The Flutter bridge is regenerated; unit and desktop/mobile browser tests cover rejected responses and a valid refresh. Signature validation, subject continuity and server-side sessions remain separate. Guide: [security](security.md).

## 2 November 2026 — Fence browser sign-in races (P0-01, step)

The shared browser OIDC client fences late login and refresh responses after sign-out or session replacement, clears pending PKCE state on sign-out and coalesces same-session refreshes across instances of the loaded client. The generated Flutter bridge is updated. Unit and desktop/mobile browser tests cover late success, failure and concurrent refresh. Cross-tab, native and production server-side sessions remain separate. Guide: [security](security.md).

## 2 November 2026 — Refuse browser token-exchange redirects (P0-14, step)

The shared browser OIDC client rejects token-endpoint redirects during authorization-code exchange and refresh, and the Flutter bridge is regenerated from it. Loopback and real browser tests check both clients, a vulnerable control and direct successful login. This does not remove browser token storage or qualify production identity. Guide: [security](security.md).

## 2 November 2026 — Fence invalidated service-token refreshes (P0-13, step)

Invalidating the local service-token cache now fences requests already in flight: their late results cannot be returned or cached, and later callers share a new refresh. Tests control both completion orders and verify an older request cannot clear the newer pending refresh. This does not revoke tokens already issued to callers or establish real-provider revocation. Guide: [security](security.md).

## 2 November 2026 — Bound service-token responses (P0-11, step)

The shared service-credential client bounds token responses, rejects malformed token values and lifetimes, and never caches invalid responses. Oversized and rejected bodies are cancelled without waiting for an uncooperative stream; provider response bounds retain their existing limit. Tests cover recovery after invalid responses, bounded reads, cancellation and direct local issuer compatibility. The explicit `any` in the token response was removed and its baseline lowered. Guide: [security](security.md).

## 2 November 2026 — Refuse service-token redirects (P0-14, step)

The shared service-credential client refuses redirects from the configured token endpoint rather than forwarding its request elsewhere. Loopback tests cover common redirect statuses and confirm that another server receives no request, while direct token issuance still succeeds. Production egress policy and credential lifecycle remain separate. Guide: [security](security.md).

## 2 November 2026 — Sanitize focused write failure codes (P0-14, step)

Focused payment and renewal failures now expose only a fixed set of known codes; other tool errors become fixed unknown-outcome codes before the response or checkpoint is written. Tests inject synthetic sensitive text into each error, inspect stored rows and verify replacement remains blocked. This does not complete production data protection or audit controls. Guide: [security](security.md).

## 2 November 2026 — Enforce RS256 signing-key minimum (P0-13, step)

The shared verifier rejects RSA signing keys below 2,048 bits before signature verification. A signed-token test places a weak and valid key in the same key set and verifies that only the valid key succeeds. This does not establish real-provider key rotation or federation behavior. Guide: [security](security.md).

## 2 November 2026 — Bound focused tool waits (P1-02, step)

The focused invocation wrapper now stops waiting at the configured deadline even if a tool ignores its abort signal. A deadline wins over a simultaneous abort-triggered refusal, so a dispatched write remains unknown rather than being treated as a definitive refusal. Tests cover a noncooperative read and a simulated payment committed before a withheld reply, including replacement blocking and original-key recovery. This cannot forcibly stop noncooperative in-process work. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Stabilize focused model deadline tests (P2-05, step)

The focused planner's loopback timeout tests warm the connection and allow scheduling headroom before asserting a bounded deadline, one provider request and socket closure for stalls before headers and during the response body. A watchdog fails the test if the timeout stops working. This improves the test gate without changing runtime model deadlines. Guide: [testing](testing.md).

## 2 November 2026 — Recheck token expiry after verification (P0-13, step)

The shared JWT verifier now checks expiry again after signing-key retrieval, signature validation and any online introspection. Tests advance the clock while each identity-provider request is pending and verify that an expired token is rejected while a valid control still succeeds. This does not establish real-provider rotation or revocation behavior. Guide: [security](security.md).

## 2 November 2026 — Bound concurrent focused HTTP handlers (P0-11, step)

The focused API limits active public request handlers and reserves a separate bounded pool for simulator requests carrying the workload key. Excess requests receive a busy response; slots remain occupied until handler work settles, including after disconnect. Loopback tests cover saturation, a simulated payment through the reserved pool and subsequent slot release. This is not a socket, distributed or proxy quota. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Limit focused recovery request churn (P0-11, step)

The focused agent admits up to 16 recovery attempts per conversation in a rolling minute, preserving inspection, completed-request replay and the original operation identity. The limit persists across SQLite reopen and provides a retry hint for ordinary HTTP responses; streamed requests receive an error event. Tests cover expiry, isolation, restart and recovery without a duplicate simulated payment. This is a local per-conversation limit, not a global quota or storage-retention policy. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bound focused conversation messages (P0-11, step)

The focused agent admits at most 128 new messages per conversation after upgrade, storing admission atomically with the request record. Inspection, replay, approval and original-operation recovery remain available at the limit. Tests cover the boundary, concurrent requests, another resident and SQLite reopen. This does not bound other request records or historical storage. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Stop disconnected focused requests before dispatch (P0-11, step)

The focused API checks for a disconnected client after initial authentication and after the post-upload authority check, before dispatching work. Loopback tests cover creation, cancellation, message and direct simulator payment; a separate test confirms a payment already committed completes and replays once after client disconnect. This does not cancel authentication or graph work already in progress. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bind focused fine selection in the graph (P1-13, step)

The focused graph now binds named fines independently of the planner, refuses invented or substituted references and preserves omitted explicit selections in the quote. A supported “pay them” follow-up uses only the immediately preceding user turn, avoiding stale older selections. Tests cover invalid references and verify an approved simulated payment leaves other fines outstanding. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bind focused renewal vehicle selection (P1-13, step)

The focused graph binds an exact `veh-` reference from the current resident request, rejects an unbound planner selection, and asks for clarification when several references are named. The compatible planner no longer receives exact vehicle references. Tests cover invented, mismatched, multiple, unavailable and selected vehicles without executing renewal. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Recheck focused authority after uploads (P0-03, step)

After a request body arrives, the focused API authenticates again, requires the same subject and workload, and checks the current permission before creating a conversation, dispatching a conversation action or executing a simulator write. Loopback tests change expiry, subject and permissions while uploading and verify no affected action occurs. The test authority models changes; production revocation and federation remain separate. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bound ignored focused-agent request bodies (P0-11, step)

Conversation creation, cancellation and recovery now consume any ignored body within the same size and time bounds before performing the action. Empty bodies remain supported. A loopback test covers incomplete uploads, no premature creation or cancellation, and recovery of the original unresolved payment after a timed-out request. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bound focused-agent JSON body reads (P0-11, step)

The focused API applies an absolute deadline to JSON body reads after authentication, including uploads that continually trickle bytes. Timed-out and oversized bodies are rejected before a transition and their connections are closed. Loopback tests cover both failures and a subsequent valid request. This does not limit all connections, authentication time or graph execution. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Limit focused-agent conversation creation (P0-11, step)

The local focused agent limits successful conversation creation within a rolling hour per resident and globally, including across cancellation and SQLite reopen. Admission and rate records are transactional, and existing conversations remain accessible. Tests cover rate expiration, isolation, restart and concurrent global admission. This does not provide distributed quotas or historical-record retention. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Bound focused-agent active conversations (P0-11, step)

The local focused agent now limits active conversations to 64 per resident and 1,024 overall, with transactional admission and a 429 response when full. Expired conversations with linked unresolved operations retain a slot and remain inspectable; cancelled or ordinary expired conversations free their slot. Tests cover concurrent admission, resident isolation and the global limit. This is not a distributed quota, rate limit or historical-data retention policy. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Exercise process death after simulator commit (P0-06, step)

A local proxy test now observes a simulated payment or renewal commit, holds its reply, kills the real focused-agent process and restarts it against the same SQLite file. It verifies the pending original blocks a second conversation, recovery uses the original key, and exactly one simulator effect exists. The subprocess helper also treats an already signalled process as stopped. This is local process-kill evidence, not distributed failover or real-provider qualification. Guide: [testing](testing.md).

## 2 November 2026 — Keep unresolved focused conversations inspectable (P0-05, step)

A focused conversation now records the approval-to-operation link before execution. If its normal expiry passes while that exact owned operation remains pending or unknown, an authenticated owner access extends the conversation for another day; unrelated, competing and other-user conversations do not gain access. Older records are linked only when a saved approval response and operation owner agree; records without sufficient evidence are not guessed. Tests cover payment, renewal, SQLite reopen, authority loss and legacy links. This does not solve production retention or authority renewal. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Fence unresolved operations across conversations (P0-06, step)

The focused agent now reserves one pending or unknown operation per resident in SQLite and binds its retry to the original consent. New payment and renewal reviews, including approvals opened before the reservation, cannot dispatch while another operation is unresolved; read-only requests and other residents remain available. Explicit initial refusals release their reservation. On upgrade, an older unresolved operation is bound only when its consent is unambiguous; ambiguous records remain blocked for inspection. Tests cover concurrent and separate conversations, both journeys, reopen, legacy records and subject isolation. This is a single-process local-demo guard, not distributed locking or production reconciliation. Guide: [agent flow](agent-flow.md).

## 2 November 2026 — Verify authority-loss recovery after reopening SQLite (P0-06, step)

The focused payment and renewal recovery tests now close and reopen the SQLite-backed harness after a simulated effect and lost response, before testing expired consent and revoked permission. Both remain unknown and block replacement; after test authority is restored, recovery returns the original operation without a second effect. This is an in-process reopen, not a crash, real identity or distributed failover test. Guide: [testing](testing.md).

## 2 November 2026 — Preserve unknown outcomes when recovery loses authority (P0-06, step)

The focused fines and renewal graphs now retain an unknown outcome if a previously recorded operation cannot be reauthorized during recovery. Expired consent or revoked permission no longer turns a potentially committed effect into a definitive denial or permits a replacement. Tests simulate a lost response after commit, then expire consent and revoke permission; both remain blocked until the fixture restores authority and recovers the original operation. Real identity, durable production reconciliation and authority renewal remain separate. Guide: [testing](testing.md).

## 2 November 2026 — Preserve focused renewal outcomes on unrecognized refusals (P1-02, step)

The focused agent no longer assumes every simulator 403 is a denial or every 409 a stale quote. Only named simulator refusal codes receive those classifications; unrecognized responses remain unknown so the original operation must be recovered. A renewal journey test commits the simulated effect before substituting an unrecognized 403 or 409, then verifies that replacement is blocked and recovery returns the original renewal. Existing consent and stale-quote refusals remain covered. Guide: [testing](testing.md).

## 2 November 2026 — Preserve unconfirmed settlement outcomes (P1-02, step)

The retained agent and application provider clients now share a conservative rule for codes ending in unknown, not confirmed or reconciliation required: a write remains unknown rather than becoming a definite failure. Tests cover both clients and show an unknown settlement after a wallet effect blocks a replacement. Some pre-effect refusals with these suffixes may also require inspection; this deliberately avoids claiming a completed effect failed. Durable production reconciliation remains separate. Guide: [testing](testing.md).

## 2 November 2026 — Restrict exposed provider rejection codes (P0-14, step)

The application provider client now exposes and records only codes from a fixed simulator rejection-code catalog; unrecognized values become `PROVIDER_REJECTED`. Known codes needed by callers remain intact, and free-form provider error text remains suppressed. A regression checks both exception and connection-record output. New simulator codes require deliberate catalog review; this does not cover other outbound clients or successful payloads. Guide: [testing](testing.md).

## 2 November 2026 — Do not expose provider rejection text (P0-14, step)

The application provider client now uses a fixed rejection message instead of copying free-form upstream error text into application errors. The response status and provider code are retained for existing callers; provider codes remain a separate data-minimization concern. A regression checks that an injected private detail does not appear in the error. Guide: [testing](testing.md).

## 2 November 2026 — Keep provider calls within the selected account (P1-02, step)

The application provider client rejects paths that normalize outside the selected account prefix, including encoded separators and backslashes, before sending a request. The explicit account-list bootstrap route remains available. Tests cover traversal attempts, a normal encoded payable path with query and bootstrap. This confines path construction; provider-side ownership and authorization remain required. Guide: [testing](testing.md).

## 2 November 2026 — Classify ambiguous application provider replies (P1-02, step)

The application provider client no longer accepts a success response containing an error, or treats a contradictory, timed-out, unclassified or server-error write as a definite rejection. Such writes remain unknown; clear client-error rejections retain their status and code. The regression covers those cases and an explicit rejection. This does not replace durable reconciliation or qualify real providers. Guide: [testing](testing.md).

## 2 November 2026 — Bound application provider responses (P1-02, step)

The application provider client now shares the agent adapter’s one-MiB response reader. Oversized bodies are cancelled, and oversized, malformed or non-object responses become provider-unavailable reads or unknown writes without exposing response details. Tests cover these cases and ordinary responses. Other outbound clients and global quotas remain separate work. Guide: [testing](testing.md).

## 2 November 2026 — Refuse application provider redirects (P1-02, step)

The retained application provider client now refuses HTTP redirects instead of forwarding authenticated requests to another route. A redirect leaves a read unavailable and a write outcome unknown, because the original provider may have acted. A loopback HTTP test verifies the target receives neither request. Provider identity and production transport qualification remain separate. Guide: [testing](testing.md).

## 2 November 2026 — Bound domain adapter responses (P1-02, step)

The retained HTTP domain adapter now reads at most one MiB of response bytes, independent of the declared content length, and cancels an oversized stream. A failed read reports a domain unavailable for reads and an unknown outcome for writes, preserving reconciliation. A streamed-response regression checks both paths and confirms reading stops early. Other clients and global quotas are not covered by this change. Guide: [testing](testing.md).

## 2 November 2026 — Keep domain requests on their configured origin (P1-02, step)

The authenticated HTTP domain adapter rejects absolute URLs, network paths, backslashes, control characters and embedded query or fragment delimiters before dispatch. It checks the resolved origin against its configured service and keeps query parameters in the separate query argument. A regression test verifies malformed paths send no request and create no mutation step, while a normal path still works. This is an origin boundary, not an operation-level allowlist or production transport qualification. Guide: [testing](testing.md).

## 2 November 2026 — Refuse redirects in authenticated domain calls (P1-02, step)

The retained HTTP domain adapter no longer follows redirects to another route. A redirected read reports the domain unavailable; a redirected mutation remains unknown because the original service may already have acted. A loopback HTTP regression test checks that neither a read nor a write reaches the redirect target. This does not qualify external provider identity or transport security. Guide: [testing](testing.md).

## 2 November 2026 — Check reviewed amounts on already-paid bills (P1-13, step)

The retained utility and telecom application paths no longer return an already-paid bill as confirmation when its total differs from a supplied reviewed amount. They return `PAYABLE_CHANGED` without opening a new order; matching amounts and legacy requests without a reviewed amount still receive the existing receipt. Tests cover DEWA, du and Etisalat with mocked provider calls. Guide: [testing](testing.md).

## 2 November 2026 — Compare telecom receipts with reviewed amounts (P1-02, step)

When the retained telecom payment request includes a reviewed amount in integer fils, its adapter now requires the returned receipt amount to match exactly before reporting success. An invalid or mismatched amount remains an unknown outcome for reconciliation. Legacy calls without a reviewed amount retain their existing receipt checks; this does not prove provider settlement. Guide: [testing](testing.md).

## 2 November 2026 — Validate selected telecom bill receipts (P1-02, step)

The retained agent telecom-payment adapter now accepts a success only when its receipt names the requested bill and includes a receipt number, a two-decimal amount and AED currency. Missing, malformed or foreign receipts produce an unknown outcome rather than a confirmed payment; this check does not independently prove provider settlement or compare the receipt against an approval quote. Regression tests cover both supported telecom providers. Guide: [testing](testing.md).

## 2 November 2026 — Preserve uncertain domain mutation outcomes (P1-02, step)

The local and authenticated HTTP domain adapters now treat mutation timeouts, unknown-outcome codes, contradictory success claims and responses without an explicit rejection as unknown rather than definitive failures. Confirmed rejections still fail normally. HTTP success also refuses a response containing an error field, matching the local adapter. Tests exercise both transports and show that an uncertain response after a wallet effect stops the composite and blocks replacement. This does not provide durable reconciliation or production provider guarantees. Guide: [testing](testing.md).

## 2 November 2026 — Replay an unhandled Flutter stream event (P1-12, step)

The Flutter live-update client now advances its resume cursor after its envelope handler returns successfully. If that handler throws, reconnection resumes after the preceding handled event and retries the failed event before later ones. Unreadable and foreign events still advance the cursor when skipped. A regression test exercises the failure and ordered replay. Guide: [testing](testing.md).

## 2 November 2026 — Type browser verification token responses (P2-05, step)

The browser verification scripts now describe the `access_token` field they read from identity responses instead of casting those responses to `any`. This narrows the static type without changing the request or adding runtime validation. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the shared voice and recorder code (P2-05, step)

The microphone recorder and the voice client are shared by the React and Angular shells and take the browser's objects through an environment parameter so tests can pass fakes. Those objects were typed `any`; they now use small interfaces naming only what the code touches (`CaptureStream`, `CaptureTrack`, `CaptureRecorder`, `RecognitionResultEvent`, `SpeechUtterance`, `AudioPlayer`). The package, the React type check and the Angular build pass against the real browser objects, the voice tests pass with their fakes, and the `any` baseline fell by 13. Behavior is unchanged. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the delegation realm configuration (P2-05, step)

The Keycloak delegation configuration looked up identity providers, client scopes, executor profiles, policies, links and roles through callbacks typed `any`; they now name the one field each reads (`alias`, `name` or `identityProvider`), the service type check passes and the `any` baseline fell by 12. The admin API's own responses stay untyped at the `api` call. The behavior is unchanged. Guide: [testing](development/testing.md).

## 1 November 2026 — Localize the React main shell's remaining labels (P1-12, step)

Thirty-four more labels in the React main shell now come from shared catalog keys, 29 of them new with Arabic text and five reused: the voice studio (language, preset, speed, preview, stop and refresh controls), the sign-in screen's text and demo account hint, the three suggestion chips (only the label changes; the message each chip sends stays English), the dismiss, skip-to-workspace and check-again controls, the conversation, navigation and saved-conversation names, and the simulated-data and review notes. English wording is unchanged, so the English journeys that find controls by name are untouched; the Flutter catalog was regenerated. A few labels split across a line break by markup (the keyboard hint and the two-line sign-in headline) are left for a later step. The offline tests, the shell type check, the catalog parity test and the shared-contract check pass; the browser suite was not run against this change (the stack was stopped), so run `npm run test:browser` on the Compose stack before relying on it. Guide: [localization](development/localization.md).

## 1 November 2026 — Stale actions in all three shells (P1-12, step)

The gateway answers an action taken on a replaced surface with 409 `STALE_SURFACE`, its reason and the current surface. `test/browser/failures/stale-action.spec.ts` replays that answer to the Angular and React shells on phone and desktop, and `surface_stale_action_test.dart` replays it to the Flutter shell, and each requires the reason to be shown, the current surface to replace the stale one, the stale button to be gone and exactly one action to have been sent, with nothing sent afterwards. All three already behaved correctly; the specs pin it. Writing them also showed the shared surface check is stricter than the Flutter renderer (it requires a `timestamp` and an `onPress` event on a button binding), so the Flutter test now uses a payload the other shells would also accept. Navigation tests, further ordering cases and real devices remain open in P1-12. Guide: [testing](testing.md).

## 1 November 2026 — One unreadable event no longer blocks a live stream (P1-12, step)

A stream resumes from the last event it handled, so an event the client could not read, whose data was not valid JSON, never moved the cursor: every reconnect replayed it and no later event was ever delivered. New tests built on a stub stream server (`services/test/p112-stream-poison.test.ts` for the shared client, used by the React and Angular shells, and a new case in `event_stream_test.dart` for Flutter) showed both clients stuck on the first bad event. Both now report the unreadable event, skip it and move the cursor past it, and the Flutter stream does the same for an event that belongs to another session instead of throwing and reconnecting; events before and after arrive once each and there is no reconnect loop. A message handler that throws still gets its event redelivered, as before. All 48 Flutter widget tests, `flutter analyze`, the 5 stream tests and the offline suite pass. Further ordering and reconnect cases, navigation tests and real devices remain open in P1-12. Guide: [testing](testing.md).

## 1 November 2026 — Unreadable answers in the web shells and advertised-action schemas (P1-12, step)

A new browser spec (`test/browser/failures/unreadable-surface.spec.ts`) replaces the gateway's intent answer with a surface whose revision is not a revision and checks, on phone and desktop, that the Angular shell says "Could not read the gateway response. Check status before retrying.", the React shell says "The gateway returned an invalid surface. Refresh your request." and offers Try again, neither blames the connection, and the composer stays usable; the Flutter shell has the same rule in its widget tests. `services/test/p112-action-schemas.test.ts` requires every action a gateway surface advertises (12 found in the graph and payment-surface sources) to have a payload schema at the gateway edge and checks that a mangled payload for `pay_police_fines` and `confirm_movein` is refused with a 400; they already were. Navigation tests, ordering and reconnect errors and real devices remain open in P1-12. Guide: [testing](testing.md).

## 1 November 2026 — Renderer coverage and unreadable gateway answers (P1-12, step)

`services/test/p112-renderer-coverage.test.ts` requires the React, Angular and Flutter renderers to each draw every one of the 11 component types the protocol advertises and to say "Unsupported component" for a type they do not know, and requires the Flutter handshake list to equal the protocol list. New Flutter widget tests (`surface_adversarial_test.dart`) send four unreadable surfaces (another session's, a revision that is not a revision, a component with no id, properties that are not an object) and found a real defect: the shell reported "Could not reach Gateway" for an answer the gateway had sent but the shell could not draw. It now says the answer could not be shown and that nothing was changed, nothing is drawn, and nothing crashes; the action-unconfirmed message is localized too. All 47 Flutter widget tests, `flutter analyze` and the offline tests pass. The React and Angular shells' handling of unreadable surfaces, ordering and reconnect errors, and real devices remain open in P1-12. Guide: [testing](testing.md).

## 1 November 2026 — Close the protocol and catalog contract task (P1-14)

P1-14 is delivered for the local demo. Hostile or malformed input fails safely everywhere a request contract exists: the protocol fuzz suite covers the surface and message validators, and `services/test/p114-hostile-input.test.ts` sends an array, a prototype-pollution key, an oversized string, an unknown field, a null and a deeply nested value to every application operation (40) and every gateway contract, in the body and the query, and requires a 400, no throw and untouched input. Success, errors and references are proved against running code, not schema compilation: `npm run demo:verify:contract` checks that all 45 documented operations refuse a request with no token using the documented `Error` shape, 15 writes refuse an invalid body with a documented 400, the 3 documented 404s return, 28 reads (20 parameter-free and 8 telecom reads for each of Etisalat and du) return every required key, and, with `--writes` on a fresh qualification stack, each of the 17 mutating operations answers 200 with every documented key. Offline tests pin the mapping: every tool a service advertises has a validated schema (`p114-tool-mapping`), every gateway path a client calls and every payment call the React shell makes has a gateway contract and the focused agent client matches the router's actions (`p114-client-mapping`), and every write route is driven by a behavior test or verifier (`p114-mutation-coverage`). The checks found and fixed a real drift (the catalog's 404s lacked the documented `code`). Not claimed: response bodies of provider passthroughs stay `additionalProperties: true` by design, and the write check runs once per fresh stack because it uses up the resident's fines, bills and recharge target. Guide: [testing](testing.md).

## 1 November 2026 — Pin the client-to-gateway mapping (P1-14, step)

`services/test/p114-client-mapping.test.ts` checks three things offline: every literal `/api/...` path the shells and shared clients use matches a gateway request contract; every payment call the React shell makes (`api`, `mutate` and `read` names, 36 of them) maps to a contract under `/api/payments`, with an action chosen at run time requiring a route family; and the focused agent client's action list (`messages`, `resume`, `cancel`, `recover`) equals the orchestrator router's. A probe of the mutating routes found why a success-body check cannot run offline: the legacy fixture path and the REST provider path name some keys differently (the Salik recharge returns `rechargedAmount` in one and `amountRecharged`, as documented, in the other), so that check belongs on the live stack, on the disposable qualification stack so shared balances stay untouched. Guide: [testing](testing.md).

## 1 November 2026 — Cover the gateway contracts and the mutating routes (P1-14, step)

`contractRoutes(owner)` in `request-validation.ts` lists the routes a service validates, so `services/test/p114-hostile-input.test.ts` now sends the six hostile inputs (array, prototype-pollution key, oversized string, unknown field, null, deep nesting) to every gateway (agent-core) request contract as well as the application operations; all are refused with a 400, none throws and the input is untouched. `services/test/p114-mutation-coverage.test.ts` requires each of the 17 mutating application operations to be called by at least one behavior test or verifier beyond the generic input-validation sweeps, so a new write route without a test fails. What stays open in P1-14 is a live check that the mutating routes' success bodies carry the documented keys, and client mapping. Guide: [testing](testing.md).

## 1 November 2026 — Pin the service tool mapping (P1-14, step)

The ride, food, wallet and profile services build each advertised tool's parameters as the validated route schema or, failing that, the tool's own unvalidated parameters, so a tool whose name matched no route would have fallen back silently. `services/test/p114-tool-mapping.test.ts` now requires every advertised tool (13 across the four services) to have a validated request schema, to advertise exactly that schema, to take a closed object that refuses unnamed fields and to have a description; all of them already did. Gateway and client mapping remain open in P1-14. Guide: [testing](testing.md).

## 1 November 2026 — Check the telecom reads for each provider (P1-14, step)

`npm run demo:verify:contract` now runs every telecom read that is scoped only by provider once for Etisalat and once for du, with a signed-in resident, and requires 200 with every key the document lists (8 checks: four operations for each provider); before, those routes were only exercised with a placeholder provider. The mutating routes and the mapping between catalog tools, gateway routes and client calls remain open in P1-14. Guide: [testing](testing.md).

## 1 November 2026 — Check errors on writes and unknown resources, and fix the catalog 404s (P1-14, step)

`npm run demo:verify:contract` now also sends every write that needs no resource id (15 of them) a body the contract does not allow and requires a documented 400 with the `Error` keys, and asks every read that documents a 404 (orders, mini-apps, capabilities) for something that does not exist and requires the 404 with those keys. It found a real drift: the catalog service answered an unknown mini-app or capability with `{error, id}` and no `code`, although the document says every error carries `code` and `error`; both responses now carry `success: false`, `code: 'NOT_FOUND'` and `error`. Writes on a specific bill or subscription are left out on purpose: the service looks the resource up first, so a made-up id is a 404. Guide: [testing](testing.md).

## 1 November 2026 — Verify the running services against their OpenAPI document (P1-14, step)

`npm run demo:verify:contract` signs in a resident and checks the live Compose stack against the generated application OpenAPI document: all 45 documented operations refuse a request with no token with a 401 whose body has the document's `Error` keys (`code` and `error`), and 20 parameter-free reads answer 200 with every key the document lists as required. Reads only; nothing is created or paid. It fails with the operation and the missing key (checked by demanding a key that does not exist). Response bodies for provider passthroughs stay `additionalProperties: true` by design. Guide: [testing](testing.md).

## 1 November 2026 — Prove hostile request input is refused on every operation (P1-14, step)

A new offline test, `services/test/p114-hostile-input.test.ts`, takes each of the application operations that has a request contract (40 at the time) and sends it six hostile inputs, once in the body and once in the query: an array, a prototype-pollution key, a 300,000-character string, a field the contract does not name, a null value and a value nested forty levels deep. Every case is refused with a 400, none throws, and the caller's input is never changed; a positive control checks the validator still accepts a valid request. The schemas for success and error responses and the provider and telecom catalog coverage remain open in P1-14. Guide: [testing](testing.md).

## 1 November 2026 — Type the React mandate consent panel (P2-05, step)

The React mandate consent panel takes its billing accounts, payment methods and rule policies from the shared `BillingAccount`, `PaymentMethod` and `MandatePolicy` types instead of `any`; the shell type check passes and the `any` baseline fell by 17 uses. The automation-screens and rules browser specs that exercise the panel pass on the Compose stack. The panel's `read` and `mutate` props and its draft review still return `any`. Guide: [testing](development/testing.md).

## 1 November 2026 — Localize the Flutter focused fines workspace (P2-01, step)

The Flutter fines workspace now reads the saved language (else the browser's), lays out right to left in Arabic and shows its header, sign-in, conversation, review, receipt and renewal labels from the same `fines.*` catalog keys the Angular fines route uses, plus two new keys for the review reminder and the unconfirmed-result message; English wording is unchanged and the requests the suggestion buttons send stay English. The Flutter Arabic browser spec gained a fines test (translated headline and token field, 44 px controls, nothing scrolling sideways, no English headline left), and the Flutter parity and focused-agent specs (52 tests with it), all 43 widget tests and `flutter analyze` pass. Guide: [localization](development/localization.md).

## 1 November 2026 — Localize the Flutter main shell's remaining labels (P2-01, step)

The Flutter main shell no longer has hardcoded English in its header, dialogs or messages: the tool tooltips and menu (workspace tools, fines and renewal, saved conversations, connections), the saved-conversations dialog and its empty and default titles, the sign-in title, the composer hint, the progress, action and unreachable-gateway messages and the mini-app link now use shared catalog keys with Arabic text; English wording is unchanged and the generated Dart catalog was regenerated. The Flutter Arabic browser spec now checks the translated tools on phone and desktop, and the English Flutter parity specs and all 43 widget tests pass. Guide: [localization](development/localization.md).

## 1 November 2026 — Close responsive, accessible shell parity (QA-06)

QA-06 is delivered for the local demo. The [shell parity guide](development/shell-parity.md) is the agreed journey matrix: nine journeys across the React, Angular and Flutter web shells, each cell naming its browser spec or Flutter widget test, plus the four journeys only React offers and the gated native and device behavior; `services/test/qa06-parity-matrix.test.ts` fails if a named file is missing or a gap is unlisted. The five cells that had no test were closed: new `test/browser/parity/angular-journeys.spec.ts` signs Angular in through Keycloak with the authorization code, switches account, reads Connections and starts in Arabic against the live gateway, and `test/browser/localization/flutter-arabic.spec.ts` checks the Flutter shell in Arabic. The full Playwright suite passes on the Compose stack (138 tests on desktop and phone), all 43 Flutter widget tests and `flutter analyze` pass, and the 955 offline tests, lint and docs checks pass. The checks found and fixed real defects: the Flutter send control and tools were 32 to 40 px tall in a desktop browser because Flutter shrinks Material controls there (the shell theme now sets a 44 px minimum and standard density, and the widget tests also run under a desktop platform), and sign-in was refused when optional services were down because slow host lookups starved the Keycloak lookups (agent-core now sets `UV_THREADPOOL_SIZE`). Not claimed: physical devices, screen readers, native Flutter sign-in and speech hardware, which the guide gates by name. [Guide](development/shell-parity.md).

## 1 November 2026 — Agree the shell journey matrix (QA-06, step)

The new [shell parity guide](development/shell-parity.md) is the agreed matrix of resident journeys: for each of nine journeys it names the browser spec or Flutter widget test in the React, Angular and Flutter web shells, lists the four journeys only React offers (payment accounts, challenge and unknown outcome, pause and revoke a rule, automation screens), gates native Flutter sign-in, devices and standards-based protocols, and says plainly which five cells have no test yet. `services/test/qa06-parity-matrix.test.ts` fails if a named file is missing or a gap is not listed. The matrix was checked against the specs and corrected in the process: Angular has no browser test for sign-in, account switch, Connections or the main shell in Arabic. Those five gaps are now QA-06's remaining work.

## 1 November 2026 — Fix refused sign-ins when optional services are down (QA-06)

The cause of the Flutter sign-in spec failure is found and fixed. agent-core's `/health` probes the local model and voice services; when they are not running, their host lookups hang for seconds, and with Node's default four lookup threads those waits queued the Keycloak lookups behind them, so a concurrent first request with a valid token timed out and was refused with 401. The Flutter app calls `/health` and `/api/accounts` together at start-up, which is why only that flow failed. Found by elimination: a browser token alone was accepted in 27 ms; with `/health` in flight the same call took 5 to 8 seconds; with the model and voice endpoints refusing instantly it took 0.25 s; and with `UV_THREADPOOL_SIZE=32` it took 0.23 s with the real unreachable hosts. The agent-core service in `docker-compose.demo.yml` now sets `UV_THREADPOOL_SIZE` (default 16). All 22 parity specs, including the Flutter authorization-code sign-in on phone and desktop, pass. The earlier readings that blamed Keycloak and the introspection timeout were wrong. The `automation-execution` script still fails separately with `DELEGATION_UNAVAILABLE` on this stack. Guide: [local development](development/local-development.md).

## 1 November 2026 — Measure the slow first sign-in introspection (QA-06, finding)

Repeated timings on the Compose stack show the cause precisely: the first online check of a token from a real browser login takes about 8 seconds (8.5 s, 8.6 s, 8.0 s), then 15 to 650 ms, while a password-grant token is checked at once; it was present before the delegation realm was reconciled. A later measurement corrected the first reading of where the time goes: calling Keycloak's introspection endpoint from inside the agent-core container with a browser token that nothing else had used yet took 77 ms, then 5 to 6 ms, so Keycloak is not slow and the delay is in the gateway's own path for those requests (running `/health` alongside, or a fresh password token, did not reproduce it). With `KEYCLOAK_INTROSPECTION_TIMEOUT_MS=12000` and a warm key cache the desktop Flutter sign-in spec passes, but the mobile run's first call returns a 500 at about 8 seconds, probably a second service's own 8-second check, so the timeout alone is not a fix. The next thing to examine is the gateway's handling of a first request with a browser-login token; the default timeout stays 8 seconds and no code changed. [Testing guide](development/testing.md).

## 1 November 2026 — Localize the Angular focused fines workspace (P2-01, step)

The Angular fines route now reads the saved language (or the browser's), sets `lang` and `dir`, and shows its header, tools, sign-in, conversation, review, receipt and renewal labels from shared catalog keys with Arabic text; English wording is unchanged and the Flutter catalog was regenerated. A new browser spec checks Arabic direction, text, 44px controls and no sideways scroll on phone and desktop, and the focused-agent, localization and renewal-parity journeys (34 tests) pass against the Compose stack. Gateway messages and the requests the suggestion buttons send stay English. Guide: [localization](development/localization.md).

## 1 November 2026 — Review unused dependencies (P2-05, step)

Every dependency declared in the workspace `package.json` files was checked against the source, scripts and configuration. None is unused: `@angular/compiler`, `@angular/compiler-cli` and `rxjs` are build or peer requirements of the Angular shell, `@types/react` and `@types/react-dom` type the React shell, and `better-sqlite3` is the agent checkpoint store. One mismatch to resolve when dependencies are next updated: `@types/better-sqlite3` is at ^9 while the runtime is 12. [Testing guide](development/testing.md).

## 1 November 2026 — Diagnose the Flutter sign-in spec failure (QA-06, finding)

The Flutter authorization-code sign-in spec fails on the Compose stack with "Could not load sign-in settings". The cause is not the Flutter app or the realm: the code exchange succeeds and the token's claims are correct, but the gateway's first call with that fresh browser token waits 8 seconds for Keycloak introspection, times out and answers 401 (the safe, fail-closed result), while the next calls with the same token take 604 ms and 25 ms. A password-grant token is accepted at once. The same slow first introspection probably explains the HTTP 503 from the `automation-execution` script. Raising `KEYCLOAK_INTROSPECTION_TIMEOUT_MS` to its 12-second ceiling on the local stack did not help: the first call then failed at about 5 seconds on the separate JWKS fetch timeout, so the slow first use affects more than introspection. No code changed; the open question moved into QA-06 in `TODO.md`. [Testing guide](development/testing.md).

## 1 November 2026 — Close the token contrast, size and focus task (P2-14)

P2-14 is delivered for the local demo. Every declared text/background pair is contrast-checked in both themes at generation; the React and Angular shells' controls reach 44px with 14px text, show focus and honour reduced motion, measured in a browser (all React and Angular accessibility and layout specs pass on the Compose stack). The Flutter shell is measured in widget tests that run with a Flutter 3.47.9 SDK: the workspace panes and divider, fines sign-in, focused conversation and payment review, connections, delegated access, the main header (named 44px controls at desktop, phone and 2x text), the composer, the agent-drawn surface controls, the settings, services and saved-conversation dialogs, and Tab reaching a focus ring drawn by the theme on every button. The checks found and fixed three real defects: the account selector and the settings language selector overflowed at large text, and the services and conversation choices were 36px tall. All 41 Flutter widget tests, `flutter analyze` and the 952 offline tests pass. Not claimed: native device runs and the live-Keycloak Flutter sign-in spec, which fails on this stack with "Could not load sign-in settings" and stays with QA-06. [Design details](development/design-tokens.md).

## 1 November 2026 — Draw the focus ring on every Flutter shell button (P2-14, step)

The main Flutter shell previously drew a focus ring only in the delegated-access panel. The theme now gives elevated, filled, outlined, text and icon buttons the 3px token focus ring while focused and leaves them unchanged otherwise. A widget test checks the ring on each button kind and that Tab reaches the send control. After a rebuild of the Flutter web app the parity and accessibility browser specs pass (40), except the live-Keycloak sign-in spec noted in the previous entries. [Design details](development/design-tokens.md).

## 1 November 2026 — Measure the Flutter surface controls (P2-14, step)

A widget test renders a gateway surface containing a button, a choice group and a form input in the main Flutter shell at desktop, phone (through the Service details view) and 2x text on a 360px phone, and checks each is at least a 44px target. They already were; the test keeps them that way. Not yet measured: the settings dialog and map viewer. [Design details](development/design-tokens.md).

## 1 November 2026 — Measure the Flutter main composer (P2-14, step)

A widget test now pumps the main concierge at desktop, phone and 2x text on a 360px phone and checks the message field has a name and at least a 44px height and that the send control is at least 44px in both directions. The composer already met these; the test keeps it that way. [Design details](development/design-tokens.md).

## 1 November 2026 — Measure the Flutter header and fix the account selector overflow (P2-14, step)

With a Flutter 3.47.9 SDK now installed, a new widget test pumps the main concierge at desktop, phone and 2x text on a 360px phone and checks that every header tool has a name and a 44px target. It found a real defect: the account selector overflowed its row by 146 pixels at large text. The selector now flexes, expands and ellipsizes its labels. All 32 Flutter widget tests pass and `flutter analyze` is clean; the Flutter web build was rebuilt and the parity specs pass except the live-Keycloak sign-in spec, which fails on this stack with "Could not load sign-in settings" and was not diagnosed. [Design details](development/design-tokens.md).

## 1 November 2026 — Keep the history section's accessible name (P2-01, fix)

Localizing the Statements & funding history panel changed its region's accessible name from "Statements and funding history" to the heading text, which the payment-history browser journey could not find. The region now has its own catalog key, so the English name is unchanged and Arabic has its own. Found by running the browser script against the Compose stack; the full Playwright suite then passed 108 tests on desktop and mobile, and its 16 failures were all specs that need a built Flutter web app (the Flutter project specs and the three-shell renewal parity spec); payment-history, -obligations, -accounts, -authorization, -refunds, -reconciliation, -lifecycle, -surfaces, checkout-groups, fine/recharge checkout and wallet funding pass there. The `automation-execution` script returned HTTP 503 on this stack and was not diagnosed. Guide: [testing](development/testing.md).

## 1 November 2026 — Type four more browser scripts (P2-05, step)

The fine-checkout, mandate-narrowing and automation-security browser scripts, and the rest of the grouped-checkout script, take their payables, card balances, mandates, billing accounts, accounts and realm clients from shared types instead of `any`; the E2E type check passes and the `any` baseline fell again. The scripts need the Compose stack and were not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type five more browser scripts (P2-05, step)

The mandate-change, mandate-create, recharge-checkout, wallet-funding and payment-history browser scripts take their mandates, billing accounts, card balances, recharge targets, payables and orders from the shared types instead of `any`; the E2E type check passes and the `any` baseline fell again. The scripts need the Compose stack and were not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the automation-execution browser script (P2-05, step)

The automation-execution browser script types its accounts, candidates, billing accounts, forecast candidates and orders instead of using `any`; the E2E type check passes and the `any` baseline fell again. The script needs the Compose stack and was not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the payment-lifecycle browser script (P2-05, step)

The payment-lifecycle browser script types its accounts, realm clients, orders, payables and sessions instead of using `any`; the E2E type check passes and the `any` baseline fell again. The script needs the Compose stack and was not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the issuer-scenarios browser script (P2-05, step)

The issuer-scenarios browser script types its fetch wrapper, card balances and wallet funding orders instead of using `any`; the E2E type check passes and the `any` baseline fell again. The script needs the Compose stack and was not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the payment-mandates browser script (P2-05, step)

The payment-mandates browser script types its accounts, realm clients, candidates and recharge targets instead of using `any`; the E2E type check passes and the `any` baseline fell again. The script needs the Compose stack and was not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the payment-events browser scripts (P2-05, step)

The payment-events and legacy-payment-events browser scripts type their payables, orders, billing accounts, recharge targets and event updates from the shared types instead of `any`; the E2E type check passes and the `any` baseline fell again. The scripts need the Compose stack and were not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the surfaces and reconciliation browser scripts (P2-05, step)

The payment-surfaces and payment-reconciliation browser scripts type their orders, card balances, groups, refunds, recovery audit rows and the surface envelope (view, session, revision) instead of using `any`; the E2E type check passes and the `any` baseline fell again. The scripts need the Compose stack and were not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the obligations and accounts browser scripts (P2-05, step)

The payment-obligations and payment-accounts browser scripts take their payables, methods, billing accounts, card balances, obligations and token responses from the shared types instead of `any`; the E2E type check passes and the `any` baseline fell again. Raw `api` data stays untyped. The scripts need the Compose stack and were not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the payment-authorization browser script (P2-05, step)

The payment-authorization browser script types its payables, orders, card budgets, realm clients and token responses instead of using `any`; the E2E type check passes and the `any` baseline fell again. Responses that other helpers read untyped (`api` data, one JSON helper) still use `any`. The script needs the Compose stack and was not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the payment-refunds browser script (P2-05, step)

The payment-refunds browser script now takes `Payable`, `PaymentAuthorizationReview`, `PaymentRefund`, `CardBalance` and `RechargeTarget` from the shared payment types instead of `any`; the E2E type check passes and the `any` baseline fell by eighteen uses. The script needs the Compose stack and was not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Type the grouped-checkout browser script (P2-05, step)

The grouped-checkout browser script no longer uses `any` for its payable, recharge-target and group callbacks: they take the shared `Payable`, `RechargeTarget` and `CheckoutGroupView` types, and the E2E type check passes. The `any` baseline was lowered by eight uses. The browser script itself needs the Compose stack and was not run. Guide: [testing](development/testing.md).

## 1 November 2026 — Localize the React recharge form and reservations list (P2-01, step)

The toll/mobile recharge form and the business reservations and attempts list now follow the shell language, with Arabic catalog text; the state codes and identifiers stay as the gateway sends them. Every Payment accounts panel in the React shell is now translated. The Flutter catalog was regenerated. Tests: `services/test/p201-i18n.test.ts`. Guide: [localization](development/localization.md).

## 1 November 2026 — Localize the React statements and funding history panel (P2-01, step)

The Statements & funding history panel in the React shell now follows the shell language: the snapshot totals, statement entries, payment activity, operation detail and confirmed-receipt lines use shared catalog keys with Arabic text, and entry times use the locale formatter. Amounts and the state codes the gateway sends are unchanged. The Flutter catalog was regenerated. Tests: `services/test/p201-i18n.test.ts`. Guide: [localization](development/localization.md).

## 1 November 2026 — Localize the React payment recovery panel (P2-01, step)

The Payment recovery panel in the React shell now follows the shell language: its headings, case and evidence lines, the three recovery actions, the saved-reference field and the audit times use shared catalog keys with Arabic text, and the times use the locale formatters. English wording is unchanged and the Flutter catalog was regenerated. Flutter was not run here (no toolchain on this machine), so P2-14 stays open. The AUTO-13 preview test now freezes its clock like the other invoice tests, because it failed once the real date reached month-end renewal. Tests: `services/test/p201-i18n.test.ts` (key and placeholder parity). Guide: [localization](development/localization.md).

## 29 October 2026 — React kill switch follows the shell language (P2-01, step)

The automation kill-switch panel's title, operator intro, show control, state and reason terms, reason field, stop/resume actions, and every notice (the operator refusal, the missing-reason warning, the stopped and resumed confirmations, and the unchanged result) moved to shared catalog keys localized for Arabic. English output is unchanged, so the payment-accounts screen keeps its touch, focus and reduced-motion measures on the desktop and phone projects; the every-locale parity check covers the new keys and the generated Flutter catalogs follow them. Tests: `services/test/p201-i18n.test.ts`, `test/browser/accessibility/touch-focus-motion.spec.ts`.

## 29 October 2026 — React automation inbox follows the shell language (P2-01, step)

Every label of the React automation inbox — the title, intro, load control, entry headlines for all eight worker kinds, the rule/version/occurrence line, the reason/effect/recorded terms, and the card-challenge decision with its notices — moved from hardcoded English to shared catalog keys localized for Arabic. English output is unchanged, so the QA-10 inbox journey passes as before on the desktop and phone projects; the every-locale catalog parity check covers the new keys and the generated Flutter catalogs follow them. The recorded timestamp stays an ISO instant on purpose. Tests: `services/test/p201-i18n.test.ts`, `test/browser/accessibility/automation-screens.spec.ts`.

## 29 October 2026 — Budget spend is visible in the delegated-access panel (P1-10, step)

A grant that carries a spending budget now shows what was spent of it (`Budget: AED x of y spent`, Arabic included) under its status line. The catalog keys pass the every-locale parity check, the React shell builds, and the delegated-access screen keeps its touch, focus and reduced-motion measures on the desktop and phone projects. Guide: [delegation](development/delegation.md).

## 29 October 2026 — Spending budgets on delegated wallet-credit consent (P1-10, step)

A grant for the approved synthetic wallet credit can now carry an explicit cumulative `budgetMinor`. The policy accepts the budget only for that operation, requires it to cover one operation, allow more than one, and stay inside the bounded AED 100 scale; authorization refuses the operation that would pass the budget (`GRANT_BUDGET_REACHED`) before anything moves, tracks `spentMinor` on the grant and in the audit, and narrowing may lower the budget but never below what was spent and never upward. Grants without a budget behave exactly as before, including the single-operation rule. Taken while the acceptance path's Flutter measures are blocked on this machine. Tests: `services/test/p110-delegation-budget.test.ts`. Guide: [delegation](development/delegation.md).

## 29 October 2026 — One shared gateway default for the shells (P2-06, step)

The gateway origin the shells fall back to now comes from the shared local-endpoints table instead of a second written literal: `local-endpoints.ts` gained the `GATEWAY_URL` default, the React shell's `VITE_GATEWAY_URL` fallback and the Angular build's generator read it from there, and the generated Angular file is byte-for-byte what it was. A regression pins the shell sources to the table and forbids the repeated literal. Taken while the acceptance path's Flutter measures are blocked on this machine (no Flutter toolchain). Both shells build; tests: `services/test/p206-local-endpoints.test.ts`. Guide: [local development](development/local-development.md).

## 29 October 2026 — P2-09 delivered: realm client secrets are generated per stack

The qualification and interactive stacks no longer share a credential. Every confidential realm client's secret now has a named environment variable (`scripts/realm-client-secrets.ts`); the Keycloak reconcile sets each client's secret from its variable, the Compose file reads the same variable with the seeded demo value kept only as the interactive default, the qualification launcher generates it into the ignored per-stack env file, and the scripts that authenticate as a service client read the variable with the seeded fallback. Checked live: the qualification stack came up beside the interactive one, its realm took the generated secrets (`demo:verify` passed against it, which requires the generated values to match the reconciled realm), the interactive stack still verifies unchanged, and `qualify down` removed only the qualification project. Tests: `services/test/p209-qualification-stack.test.ts`. Guide: [local development](development/local-development.md).

## 29 October 2026 — Revoke a rule from the keyboard in the hardest-states journey (QA-06, step)

The React payments journey that runs on a crowded screen (masked card, a paused and an approved rule, a card challenge, an unknown outcome) now revokes the paused rule with the keyboard as well. The journey verifies the revoked state is said in words, that a revoked rule offers no resume, skip or second revoke while the untouched paused rule still resumes, and that returning from another account finds it still revoked with the other rule untouched. Desktop and phone projects pass; the Flutter panel measure remains a separate toolchain. [Verification](development/testing.md#browser-journeys-under-playwright-test).

## 28 October 2026 — Improve Flutter delegated-access controls (P2-14, step)

Delegated-access actions now use token-based touch targets and theme-aware focus borders. Large-text widget checks cover control reachability and revocation disabling execution, while browser checks measure the initial consent actions without sending a mutation. [Design details](development/design-tokens.md).

## 28 October 2026 — Improve Flutter connections refresh focus (P2-14, step)

The connections refresh action now uses a token-based touch target and a theme-aware keyboard focus border. Widget checks cover English and Arabic, enlarged text and refresh behavior; browser checks measure the exposed action. [Design details](development/design-tokens.md).

## 28 October 2026 — Improve Flutter review control focus (P2-14, step)

Focused review actions now have token-based touch targets and visible theme-aware keyboard focus. Phone widget checks cover standard and enlarged text, reduced motion and the exact approval sent on activation. Browser checks measure the simulated payment review controls. [Design details](development/design-tokens.md).

## 28 October 2026 — Keep Flutter conversation actions reachable (P2-14, step)

The focused conversation now contains its composer and actions within scrollable areas, avoiding short-phone overflow at regular and enlarged text sizes. Action targets use shared spacing tokens and the message field has a theme-aware focus border. Widget checks measure the controls and their scroll reachability. [Design details](development/design-tokens.md).

## 28 October 2026 — Make phone pane switching visible (QA-06, step)

The swap icon now changes the visible view on single-pane phones in React, Angular and Flutter and remains available to switch back. The active web workspace control has a stronger token-based highlight. React's stacked fines layout scrolls to the pane moved to the top. Phone checks cover both directions, selection and draft retention; split and fold layouts keep their existing behavior. [Design details](development/design-tokens.md).

## 28 October 2026 — Improve Flutter fines sign-in accessibility (P2-14, step)

The focused fines sign-in form now provides larger action targets, a theme-aware input focus border and scrolling on short screens with enlarged text. Widget and browser checks cover labels, control size and keyboard focus. Other Flutter panels and physical screen-reader testing remain separate. [Design details](development/design-tokens.md).

## 28 October 2026 — Name the Flutter web divider slider (QA-06, step)

Flutter web generated a labeled divider container but left its focusable range input unnamed. A narrowly scoped web bridge links the input to its existing semantics label, preserves any engine-provided name and reconnects it after pane or viewport changes. Browser checks exercise the computed name, keyboard value, dynamic labels, engine-provided names and an unrelated slider. This follows the P2-14 divider measurement because the missing name blocked accessible use of that control; physical screen-reader testing remains separate. [Design details](development/design-tokens.md).

## 28 October 2026 — Make Flutter workspace pane controls easier to use (P2-14, step)

The pane divider and header actions now have larger token-based touch targets, and the divider shows a theme-aware focus ring when focused. Keyboard users can use Shift with the arrow keys for larger resize steps; the existing bounds, reset, swap, restore and fold behavior remain. Widget tests measure control size, keyboard traversal and focus in light and dark/reduced-motion settings; a web regression checks the exposed divider. Other Flutter panels retain their separate acceptance work. [Design details](development/design-tokens.md).

## 28 October 2026 — P1-05 delivered for the selected local planner

The configured local llama-server passed the declared English/Arabic intent, exact-selection and latency gates against clean implementation `44e2d16`, then passed live HTTP/graph/SQLite approval, owner and idempotency checks including separate fines/renewal reviews. The evidence pins model weights, server build, source/corpus/tool hashes and configured limits; deterministic provider-failure regressions remain passing. The focused agent now uses the explicit local provider while preserving its private identities, hosted credentials and persisted demo state. This closes the finite local selected-planner acceptance task; broader model, hosted-provider, native-device and production qualification are not implied. [Milestone evidence](reports/2026-10-28-local-planner.md).

## 28 October 2026 — Select local llama-server for bounded planning (P1-05, step)

The focused agent can explicitly select an existing local llama-server without sending hosted credentials. Local requests disable reasoning and use a schema generated from the shared plan validator; arbitrary remote endpoints cannot be selected as local. Runtime, smoke and qualification commands use the same mode. Planner instructions distinguish preparing/reviewing a renewal from an unclear request and clarify unsupported tasks, while retaining exact approvals and input minimization. Provider-isolation/configuration regressions and focused checks cover this boundary. [Local planner setup](integrations.md#local-llama-server-planner).

## 28 October 2026 — Stabilize invoice-automation time fixtures (P2-05, step)

Month-end seeded invoices entered the due-soon window as the calendar advanced, breaking isolated invoice expectations and causing an unexpected cooldown. The AUTO-08 suite now freezes its test clock before constructing providers. Runtime invoice selection, payment caps, cooldowns and scopes are unchanged. This work was taken off the planner critical path because the existing failures blocked its required repository verification. [Deterministic test time](testing.md).


## 28 October 2026 — Add reproducible selected-planner qualification (P1-05, step)

A separate opt-in qualification command evaluates a versioned synthetic English/Arabic corpus against declared intent, exact-selection and latency thresholds. It then exercises the same live planner through disposable HTTP/graph/SQLite approval, owner and idempotency checks, including the separate fines/renewal reviews. Safe artifacts record code/corpus/tool provenance and distinguish scored, unavailable and unrun cases; provider errors stop without retry or fallback. Controlled tests verify the evaluator and authority checks, without claiming real inference. The attempted live LiteLLM run could not connect; broader live qualification remains open. [Runner and acceptance boundary](testing.md#selected-planner-qualification).

## 28 October 2026 — Refuse incomplete and over-budget planner replies (P1-05, step)

The compatible planner previously accepted parseable JSON despite provider-reported truncation/filtering. It now refuses any supplied finish reason other than `stop` and rejects invalid or over-budget reported completion-token counts. Failure regressions exercise malformed/invented plans, oversized responses, real HTTP stalls before headers and during body reads, and the actual graph/SQLite boundary: a truncated plan creates no consent or business effect and cannot trigger a fixture fallback. [Failure verification](testing.md).

## 27 October 2026 — Synchronize shared shell journeys and model policies (QA-06, step)

Angular and Flutter now adopt the focused fines/renewal API with private in-memory tokens, exact approvals, saved-thread recovery and blocked replacement after uncertain effects. Their concierge workspaces add equal resizable panes, swap/maximize/restore, phone views, hinge clearance, Connections, service selection, profile-sharing and saved conversations. Generic surfaces collect forms and multiple choice groups with server binding precedence. Flutter web PKCE, catalogs, provider-status cases and request deadlines are generated from shared TypeScript contracts; local fonts and engine assets keep the build independent of remote assets. Optional renewal enrollment creates a separate demo persona without widening existing identities. Verification covers offline contracts, Flutter analysis/widgets/web compilation and the shared phone/desktop approval journeys. Full specialized payment-panel parity and physical/native device qualification remain separate. [Client boundaries](integrations.md#angular-and-flutter-adoption), [verification](testing.md#cross-shell-verification).

## 27 October 2026 — Share selected-planner input and configuration policies (P1-05, step)

Focused planning and compatibility chat now share LiteLLM endpoint/model/output validation, identifier minimization and bounded per-owner model budgets. Exact fine references stay outside provider input and are bound back to the validated plan, preventing redaction from broadening a selection. Regression tests cover withheld identifiers/assistant amounts, absence of user tokens, exact selection and owner-isolated quota enforcement. The graph retains deterministic authority, consent and approval gates. [Model input boundary](development/local-ai.md#what-the-model-sees).


## 27 October 2026 — Treat requests to review paying fines as an approval review (P1-05, step)

GLM 5.3 classified “Retrieve my fines and review paying them” as a list-only request in the live smoke check. The planner prompt now distinguishes preparing a payment review from executing it, explains combined retrieve/review requests and preserves read-only/negated-payment intent. The smoke command adds a negated-payment case. An HTTP/SQLite regression with the compatible model adapter proves a model-selected payment review creates an exact approval without a payment effect, and typed assent is refused. Deterministic scopes, consent and execution checks are unchanged. The live GLM smoke check passes all nine English/Arabic cases, the running API returns an approval review without a receipt, and focused/privacy browser regressions pass on desktop and phone. Repository and focused-agent checks pass. Broader selected-model qualification remains separate from these bounded smoke cases. [Intent and approval contract](integrations.md).

## 27 October 2026 — Restore LiteLLM chat behind the isolated demo network (P1-05, step)

The shared LiteLLM URL/key were loaded correctly, but the compatibility network isolation prevented core from resolving or connecting to the hosted server. The existing edge relay now exposes an unpublished, fixed-destination TCP listener for explicitly selected LiteLLM. Core retains end-to-end TLS verification for the configured server, sends only model headers, refuses redirects and bounds the reply; the relay receives no model key or plaintext and backends retain their blocked direct egress. Refresh includes the relay so changed endpoint settings take effect. Security regressions cover endpoint refusal, hostname verification, header filtering and response bounds. A real authenticated concierge request returned a GLM 5.3 reply and health became ready. [Configuration and transport boundaries](development/local-ai.md#select-a-conversation-provider).

## 27 October 2026 — P1-04 delivered: fines then registration renewal

The focused agent now runs a second concrete journey across two simulated services. A renewal request lists vehicles and fines, takes the fines through the existing review and approval, then waits at a second persisted interrupt for the renewal; each step has its own approval ID, operation key and exactly one effect. Outcomes are truthful: `complete`, `partial` (fines paid, renewal declined, expired, refused or unauthorized, with the fines receipt kept) or `unknown` (renewal response lost; replacement blocked until recovery with the original key). The surface shows the vehicle and fee and binds its buttons to the pending approval, the shared client validates the renewal approval and receipt, and the React fines workspace treats a pending renewal as an approval, not as a recovery state. A real process kill and restart is covered at both approvals and after the receipt. The renewal restart test shares one spawn helper with the existing restart test. The browser journeys for the React workspace need the Compose stack and were not run.

## 27 October 2026 — P1-04 (step): fines then renewal in the focused graph

A renewal request now runs the native graph through fines (existing review and approval) and then a second persisted interrupt for the renewal, with its own approval ID and operation key. The outcome is truthful: `complete`, `partial` (fines paid, renewal declined, expired, refused or unauthorized) or `unknown` (renewal response lost; replacement blocked until recovery with the original key). A resident without the renew permission is refused before any payment. `createGraph` takes the vehicles adapter; the surface and the process-restart check for the second step are the remaining sub-step.

## 27 October 2026 — P1-04 (step): governed vehicle renewal adapter

`vehicles.list` and `vehicles.renew` are typed tools on a simulator client shared with the fines tools. Each call checks its own permission, the renewal requires an idempotency key, and a refused renewal keeps the simulator's reason (`FINES_OUTSTANDING`). The graph does not call them yet; the second approval and restart recovery are the remaining sub-steps.

## 27 October 2026 — P1-04 (step): vehicle renewal simulator

The in-process simulator gained vehicles and renewals for the fines-then-renewal journey: a renewal is refused while fines are outstanding, renews a vehicle once, replays its original receipt for a repeated key, and needs consent bound to the exact quote. The renewal consent check shares one helper with fines. The adapter, the graph's second approval and restart recovery are the remaining sub-steps. `package.json` now lists `better-sqlite3@12.11.1` under `allowScripts` so its native binding can be built.

## 27 October 2026 — P2-01 (step): Angular status and messages in Arabic

The Angular shell's welcome message, connection status, default user name, request progress text and error messages follow the language through more `ng.*` keys. The connection status is stored as what happened and worded when shown, so it follows a language change; an untouched welcome message is re-worded too. Gateway-supplied surface content and grant text stay English. The Angular build passes; no browser spec has run it in Arabic.

## 27 October 2026 — P2-01 (step): Angular delegation and voice panels in Arabic

The Angular shell's delegated access panel (consent actions, grant status, notices) and voice settings (microphone, language, preset, speed, preview, status text) follow the language through more `ng.*` keys. Grant purposes and results still come from the gateway in English. The Angular build passes; no browser spec has run it in Arabic.

## 27 October 2026 — P2-01 (step): Angular shell chrome in Arabic

The Angular shell's sign-in screen, header, concierge title, suggestion chips, composer, workspace titles and empty state follow the language through `ng.*` catalog keys, with a language selector that shares the React shell's saved choice and sets `lang` and `dir`. Physical left/right styles became logical ones (English unchanged). The delegated access and voice panels, welcome message and status text stay English; the Angular build passes, but no browser spec has run it in Arabic.

## 27 October 2026 — P2-01 (step): wallet top-up in Arabic

The wallet top-up panel (form, review cards, challenge and cancel actions, receipt and refund note) and the notices after each action follow the shell language through `wallet.*` catalog keys; its receipt facts now take the language too. English text is unchanged. Refund and checkout panels stay English for now. Taken ahead of the critical path because P1-04 is blocked here: the SQLite binding is not built (npm blocks its install script), so no agent-core test can run.

## 26 October 2026 — P2-01 (step): authorization receipts in Arabic

The receipt of a paid authorization review (title, number, original funding, linked target, amounts, correlation and refund note) follows the shell language through `receipt.*` catalog keys; the shared receipt facts component takes a `locale`, English by default, so the wallet top-up, refund and checkout panels are unchanged until they pass it.

## 26 October 2026 — P2-01 (step): quote preview and authorization reviews in Arabic

The quote preview and the Authorization reviews section (amounts, state, approve, challenge, pay, inspect, cancel) and the notices after each action follow the shell language, with times from the locale formatter. Receipts and the panels below stay English for now. The English payment, failure and automation journeys and the Arabic spec pass unchanged.

## 26 October 2026 — P2-01 (step): bills, fines and the payment review form in Arabic

The Bills & fines list (due dates, cycles, discounts, restricted and seeded notes) and the Review a payment form (obligation and source pickers, fine selection, quote button) follow the shell language. Amounts and discount times use the locale formatters; provider statuses stay as the provider names them. The English payment, failure and automation journeys and the Arabic spec pass unchanged.

## 26 October 2026 — P2-01 (step): demo cards and biller accounts in Arabic

The Payment accounts sections for demo cards (add, default, enable, disable, remove) and linked biller accounts (link, archive, balances) are translated, with the card statuses and presets still as the provider names them. The English payment, failure and automation journeys and the Arabic spec pass unchanged.

## 26 October 2026 — P2-01 (step): Payment accounts header and wallet summary in Arabic

The Payment accounts panel takes the shell's language for its heading, introduction, loading text, refresh and close controls and the wallet summary, with amounts from the locale formatter. The sections inside it stay English for now because the payment journeys find their controls by name; they follow panel by panel. `arabic.spec.ts` checks the translated header on both projects.

## 26 October 2026 — P2-01 (step): the Delegated access panel in Arabic

The panel's own text (heading, scope notice, buttons, status line, empty state, revoke notice) and its amounts and times come from the catalogs and formatters; the grant purpose and run result are the gateway's English text. Test: a phone and desktop Arabic journey; the English journeys are unchanged.

## 26 October 2026 — P2-01 (step): every amount follows the language

`formatAED` now takes the language from `setAmountLocale`, which the React shell sets when the resident chooses one, so the 63 places that show an amount show `1500٫00 د.إ` in Arabic and keep `AED 1500.00` in English (neither groups thousands, so widths do not change). Tests: the formatter in `services/test/p201-i18n.test.ts` and a phone and desktop journey on the payment screen.

## 26 October 2026 — P2-01 (step): the Connections view in Arabic

The Connections panel's text is in the catalogs in English and Arabic (title, status, counts, table headers, call lines) and formats its times for the language; its status is kept as an outcome and worded when shown. A first Arabic wording for Connections duplicated the Telecom button's name, which the journey caught, so Connections is "روابط الخدمات". Tests: the catalog parity test and a phone and desktop Arabic journey for the view.

## 26 October 2026 — P2-06 (step): voice, conversation and CORS defaults and the port tables in one place

`packages/backend-kit/src/local-endpoints.ts` now also holds the local voice and conversation service addresses, the default CORS origins and the application-service and provider port tables, which the gateway, the voice and conversation clients, the domain transport and the provider client read from it; the test that forbids repeating a default covers them. Test: `services/test/p206-local-endpoints.test.ts`.

## 26 October 2026 — P1-17 delivered: earlier turns go through the minimiser too

A gap remained after the consent switch: the earlier assistant turns sent back as conversation history reached the model with their balances, amounts and dates even when the resident had withheld personal context (only identifiers were scrubbed at the egress). `minimiseHistory` now applies the full minimiser to assistant turns and only the identifier scrub to the resident's own words, and the graph uses it for every prompt, so the current surface, the service summary and the history all follow the same function and the same per-call consent. Test: `services/test/p117-model-input.test.ts`. Guide: [local AI](development/local-ai.md).

## 26 October 2026 — P2-01 (step): Arabic and right-to-left in the React shell

Conversation settings has a Language choice (English or Arabic) that sets `lang` and `dir`, translates the sidebar, drawer, tool buttons, composer and settings from catalogs in `packages/protocol-core/src/i18n.ts` (same keys and placeholders enforced by a test), and mirrors the layout: the stylesheet moved to logical properties (English screens compare pixel-identical before and after) and the phone drawer slides from the right. `formatMoney` (whole minor units only, Latin digits), `formatDateTime` and `formatTime` (Dubai time zone) are in place; the Connections panel uses the time formatter. A browser asking for Arabic first starts in Arabic. Tests: `services/test/p201-i18n.test.ts` and `test/browser/localization/arabic.spec.ts` on the phone and desktop projects (the journey helpers now match names in both languages). Not yet translated: the panel bodies, the assistant's replies and surfaces, Angular and Flutter. Guide: [localization](development/localization.md).

## 26 October 2026 — P2-11 and QA-10 delivered: the Connections view

A new **Connections** view lists the seven providers with the operations each advertises, the owner's recent calls (OK or `Failed <status> <code>`, with account and object ids replaced) and a **Check connections** button. `GET /api/connections` reads each provider's `/openapi.json` from a fixed address with redirects refused, caches it for 30 seconds (`?refresh=1` reads again) and refuses a document that is not OpenAPI 3.1, has a path with `..`, encoded dots or slashes, a query, a scheme or `//`, has a missing or duplicate operation ID, or names a server on another host; `bindOperation` resolves a call by operation ID on the provider's own origin only. The call record is bounded and per owner. Tests: `services/test/p211-connections.test.ts` (malformed, relocated, traversal, redirect, cache and refresh, binding, record) and the phone and desktop journeys in `test/browser/connections/`. QA-10: the view has its brief and checklist in the guide and passes the touch, name, fit and token checks, as do the rule editor and inbox from the earlier entry, so the gate is closed. Guide: [Connections view](development/connections.md).

## 26 October 2026 — P2-13 delivered: no shell has a raw color

The token generator now emits the primitives as Dart constants (`CitysideTokens.primitiveMist95`, named as the CSS custom properties are), and the Flutter shell's 45 raw colors (`Color(0xFF…)`, `Colors.white`, `Colors.black`, `Colors.grey.shade600`) were replaced with them; one new primitive was added for a color with no neighbor within a distance of 4. The raw-color baseline is empty, so `npm run check:tokens` now rejects any raw color in any shell. **Not compiled:** no Dart toolchain is installed here, so the Flutter edit is checked only by text (every token it names exists in the generated file, and no token is written as a `const` constructor, which the first pass got wrong and the check now catches); run `flutter analyze` and `flutter test` where Flutter is installed. Guide: [design tokens](development/design-tokens.md).

## 26 October 2026 — P2-13 (step): the React and Angular shells use design tokens for every color

The 302 raw colors in the React stylesheet, the A2UI renderer and the Angular component (214 distinct values) now reference primitive tokens. Colors within a CIELAB distance of 4 of each other were merged, which added 61 primitives (named by hue family and lightness, for example `mist-95`) and one emerald (`emerald-600`) used for focus and shadow tints; the six `rgba` shadows use `color-mix` with transparent. The raw-color ratchet's baseline fell from 347 to 45, all in the Flutter shell, and the Dart constants regenerated with the new tokens (uncompiled here). Checked in the browser: fourteen screens on the desktop and phone projects (home, payments, delegated access, settings and the wallet, profile and fines surfaces) before and after, with a PSNR of 38 to 49 dB, and a visual comparison of the profile screen. P2-13 stays open for Flutter. Guide: [design tokens](development/design-tokens.md).

## 26 October 2026 — P1-18 delivered: profile confirmations are bound to the reviewed revision

The profile service now has a revision that every preference change moves, and `POST /profile/preferences` accepts `expectedRevision`: a stale value is refused with `PROFILE_REVISION_CHANGED` (409) and writes nothing. The profile surface's confirmation names the exact fields and the revision, carries `expectedRevision` in the approved payload, and when the profile changed in between, the graph shows the current values and a new confirmation instead of overwriting the newer change; the old surface cannot be replayed. Tests: `services/test/service-profile.test.ts`, the two cases in `services/test/approval-bindings.test.ts` and the updated life scenario 8; the application OpenAPI was regenerated for the new field. The live profile and gateway containers were restarted to pick it up. Guide: [agent runtime](architecture/agent-runtime.md#profile-confirmations-are-bound-to-a-revision).

## 26 October 2026 — P2-07 delivered: backends on an internal network behind a fixed-destination relay

The demo Compose backends now sit on an `internal` network (no route out) and only `edge-relay` publishes ports, forwarding each loopback port to one fixed service (`scripts/port-relay.ts`, which refuses anything but a plain service name). Checked on the qualification stack: `npm run verify:network` found only the relay publishing ports and 17 backends unable to open a connection to the internet (1.1.1.1 and example.com), with the same probe connecting from the relay as the control; and `demo:verify`, `demo:verify:security`, `demo:verify:delegation`, `demo:verify:inventory` and `demo:verify:journeys` all passed through the relay, so identity, provider and delegation calls are unbroken. That run also showed that `verify-payment-inventory`, `verify-demo-stack`, `verify-demo-journeys` and `ops` still built some provider ports by hand and would have hit the interactive stack from a qualification run (the earlier P2-09 check of `demo:verify` had passed with that gap); they now add `DEMO_PORT_OFFSET`. Tests: `services/test/p207-port-relay.test.ts`. Guide: [local development](development/local-development.md).

## 26 October 2026 — P2-06 (step): the repeated service defaults live in one place

The payments, delegation-broker, delegation-issuer and MCP defaults that nine files each repeated as a literal are now functions in `packages/backend-kit/src/local-endpoints.ts`, read from the environment at call time (an empty value counts as unset). A test pins the defaults and fails if a service or package repeats one again. Behaviour is unchanged: the payment and failure journeys pass against the refactor. Tests: `services/test/p206-local-endpoints.test.ts`.

## 26 October 2026 — P2-05 (step): an `any` ratchet in the checks

`npm run check:any` fails when a TypeScript file gains an explicit `any` (or a new file has one) and when a file loses some without the baseline being lowered, so the 809 uses recorded across 159 files can only go down. It is part of `npm run check`; `npm run any:baseline` rewrites the baseline. Tests: `services/test/p205-any-ratchet.test.ts`. Guide: [testing](development/testing.md#the-any-ratchet).

## 26 October 2026 — P1-17 (step): the resident decides what the assistant's model sees

Conversation settings now has "Share my profile details with the assistant". It calls the new `POST /api/a2ui/model-privacy` (`{ sessionId, accountId?, modelPersonalContext }`, boolean only), which stores the choice in the conversation's metadata; the minimiser reads it on the next prompt, a session read returns it, and a reload shows the same choice. Turning it off is allowed even during a pending reconciliation or an eligibility change, so withdrawing consent is never blocked, while other requests still wait. Tests: `services/test/p117-model-privacy-route.test.ts` and the phone and desktop journey `test/browser/privacy/model-privacy.spec.ts`. Streamed UI state still has to be fed through the same function. Guide: [local AI](development/local-ai.md).

## 26 October 2026 — P2-09 (step): a qualification stack beside the interactive one

Every host port of `docker-compose.demo.yml` is now a variable defaulting to the interactive port, the project name is `COMPOSE_PROJECT_NAME` (default `cityside-demo`), and the settlement secret is a variable too; `docker compose config` with no overrides is byte-for-byte what it was. `scripts/qualification-stack.ts` (`npm run qualify`) adds the `cityside-qualify` project at ports +30000 with generated, preserved, ignored credentials and refuses any other project or an interactive port; `DEMO_PORT_OFFSET` shifts the default endpoints of the scripts (`endpoints.ts`, `wait-demo-stack.ts` and the two e2e scripts that hard-coded the broker). Checked live: the second stack came up beside the first, `demo:verify` passed against it through `qualify run` (the Keycloak admin reconcile only succeeded with the generated password, so it really reached the qualification realm), `qualify down` removed only `cityside-qualify_*` volumes, and the interactive stack stayed healthy and passed `demo:verify`. Realm client secrets are still the seeded demo values, so P2-09 stays open for generating them per stack. Tests: `services/test/p209-qualification-stack.test.ts`. Guide: [local development](development/local-development.md).

## 26 October 2026 — P2-06 (step): the Angular gateway and the dev backend ports come from the environment

The Angular build now runs `scripts/angular-environment.ts` first, which writes `environment.ts` from `SHELL_GATEWAY_URL` (a bare http(s) origin; a path, query, fragment or credentials are refused, and unset leaves the committed default so a plain build changes nothing). Checked by building with `SHELL_GATEWAY_URL=http://localhost:4999` and then without it. `npm run dev:backend` no longer hard-codes its ports or binds every interface: each service takes the port of its `DEMO_*_URL` and all listen on `127.0.0.1` unless `DEV_BACKEND_HOST` is set; checked on alternate ports 24000 to 24005. Tests: `services/test/p206-angular-environment.test.ts`. Guide: [local development](development/local-development.md).

## 26 October 2026 — P2-16 delivered: the focused agent qualified as one container

`npm run agent:verify:container` builds the image from this checkout (revision and image ID are printed), runs it as its own compose project with an empty SQLite volume and checks the readiness probe, a refused bad credential, the non-root user and writable volume, an approval that survives a restart unchanged, one payment however often the approval is replayed (same key 200 with the same receipt, new key 409), a receipt that survives another restart, a clean SIGTERM stop (0.6 seconds, exit 0, inside the 35-second grace) and a restart from the volume. It was run twice in a row against revision 839650f and passed both times, with no Redis, PostgreSQL, external simulator or model download. It covers the fixture planner over the HTTP API; the React fines journey and a real local planner stay with P1-03 and P1-05. Guide: [local development](development/local-development.md).

## 26 October 2026 — QA-09 delivered; QA-10 step: the rule editor and inbox pass the screen checklist

QA-09 is closed: the QA-04, QA-05 and QA-06 browser journeys all run under `npm run test:browser` on the desktop and phone projects, each with its own context, traces on failure and the external-host block. `accessibility/automation-screens.spec.ts` applies the screen checklist (named fields, 44px targets, an error said in words next to the action, nothing to scroll sideways, keyboard order, an honest empty state) to the AUTO-04 rule editor and the AUTO-14 inbox on both projects; QA-10 stays open for the P2-11 Connections view and the shell token migration (P2-13).

## 26 October 2026 — QA-08 delivered: reproducible start, release controls and rollback, with evidence

[Local development](development/local-development.md#reproducible-start-release-controls-and-rollback) now maps start, seed, migrations, clock, scenarios, recovery and rollback to the command that reproduces each and the test that fails when it drifts. `services/test/qa08-release-controls.test.ts` reads the real startup gates and files: the worker is off by default and in production, needs a run and a credential even when enabled, scheduling is a second opt-in, no compose file or example environment starts either, and no payment SDK, hosted telemetry or feature-flag service is a dependency of any workspace package. Evidence run on this revision against the Compose stack: `npm run demo:verify`, `demo:verify:security`, `demo:verify:inventory` and `ops:verify:recovery` passed; the offline suite, lint, E2E types, docs, secrets, local-only and token checks pass, and the browser suite passes (64 tests, the external-host guard failing by design). The offline suite has one failure on this machine, the other contributor's SQLite agent test, because the `better-sqlite3` native binding cannot be built under the install-script policy; that is not a QA-08 control.

## 26 October 2026 — QA-07 delivered: readable recordings with asserted chapters, captions and provenance

`npm run record:journeys` records three journeys on isolated runs (fines paid from the wallet; a response lost after the capture and recovered once; a card challenge that expires after the operator advances the run clock) and publishes WebM, WebVTT captions and a manifest per journey to `docs/recordings/journeys/`. Every chapter asserts the ledger, hold, issuer and agency state before it pauses, then holds at least 3 seconds (state), 6 (review, recovery) or 8 (receipt); chapter times are measured. Simulated time and simulated failures are written into the picture and the captions, and the manifest carries the revision and provenance. A failing journey stages nothing and a failed run leaves the last good publication in place (proved by running with a browser that does not exist). Unit tests pin the hold rules, the manifest checks and the captions. Guide: [recording](development/recording.md#readable-journey-recordings).

## 26 October 2026 — QA-06 (step): the crowded payment screen on a phone and a desktop, and a paused rule that said "Unknown state"

`accessibility/payment-states.spec.ts` builds one isolated run with a masked card, a paused and an approved rule, a top-up waiting on a card challenge and a payment whose answer was lost, then measures the React screen on both projects: only `•••• 4242` for the card and no run of 13 or more digits anywhere, each state in words (`RECONCILIATION_REQUIRED` with "do not pay again", `REQUIRES_ACTION`, Paused, Approved), every visible control named and at least 44px with 14px text, nothing to scroll sideways, a rule paused from the keyboard with Enter, and nothing of it visible after switching to the household account (and back again on return). It found that the rules list labelled a paused rule "Unknown state"; the consent view now says Paused and that consent is kept (unit test added). Flutter is still unverified here, and the Angular shell has no payments screen, so those states are not claimed there. Guide: [testing](development/testing.md#browser-journeys-under-playwright-test).

## 26 October 2026 — Resize conversation and details with a fold-aware divider (QA-06, step)

Conversation and service details start at 50/50 and resize with mouse, touch or a keyboard separator. Enter or double-click restores equal widths; swapping and maximizing preserve the split and draft. The main concierge keeps both panes from 680px and moves navigation into a drawer up to 1100px. Progressive viewport-segment rules keep book and clamshell content clear of a hinge, with the existing phone fallback when segment information is absent. Shared color and focus tokens remain in use. Browser checks cover resizing, draft preservation, icon controls, real signed-in service navigation and Chromium-emulated hinges; physical foldable validation remains separate. `npm run check` and the focused-agent checks pass. Guides: [layout and accessibility](development/design-tokens.md#react-workspace-design), [integration](integrations.md#react-fines-workspace) and [verification](testing.md). This user-requested layout work takes precedence over the planner qualification critical path.

## 26 October 2026 — Explicit LiteLLM, OpenRouter and local conversation providers (P1-05, step)

The main concierge uses one bounded provider-aware text adapter, retaining minimized model input, per-actor token reservations and button-bound execution. Select local, free OpenRouter or the existing LiteLLM server through environment configuration; provider keys stay outside graph state and the browser, redirects are refused and failures do not trigger a fallback. LiteLLM reuses `LITELLM_BASE_URL`/`LITELLM_URL` and `LITELLM_API_KEY`; GLM 5.3 is the selected demo model and MiMo is configurable. Its larger bounded output reservation is included in the token budget. Health and chat settings identify the actual provider. The focused compatible planner can also bind the exact configured LiteLLM endpoint/key with bounded output/timeout settings and strict returned-plan validation. [Setup and provider boundaries](development/local-ai.md#select-a-conversation-provider).

Real gateway probes returned text from GLM 5.3 and MiMo; the running authenticated concierge returned a GLM 5.3 reply. Direct OpenRouter connections reset before authentication from host and container, so no successful direct OpenRouter authentication/inference is claimed. The gateway advertises Whisper transcription and Chatterbox/S2 Pro speech; voice is optional for text and audio quality was not qualified. Full selected-planner intent/latency qualification remains separate from these live text probes.

## 26 October 2026 — Make the source-event recovery check independent of background delivery (QA-09, step)

Full page/layout verification exposed a timing-sensitive assertion in the existing duplicate-event browser journey: legitimate source events could arrive after its account-wide inbox snapshot. Compare the original replayed event's stored result instead. Duplicate disposition, forged/invented-event refusal, exact journal/wallet effects and settled-order assertions remain unchanged; no payment or authorization code changes. The [testing guide](development/testing.md) explains this boundary. Validation: `npm run check` passes. The full browser run passed 75 cases and exposed this assertion race; the corrected recovery check passes separately on both desktop and phone. This test repair is off the adoption critical path because it was uncovered by the user's requested application verification.

## 26 October 2026 — Simplify pane controls and fit service pages (QA-06, step)

Use an icon-only swap button and a size icon that toggles between maximize and restore on each pane. Remove the layout menu, separate restore action and minimize mode. The chat receives the remaining wide-screen space beside service details clamped to 320–448px; up to 1100px, a single full-width view avoids cramped side-by-side content. Swapping preserves both width roles and reading order. Profile and parking navigation use their existing governed manual routes directly. Browser checks cover real authenticated sidebar navigation, deep-link reload, width bounds, drafts, focus and unchanged exact fines/payment recovery. The separate focused fines API was started and its same-origin frontend proxy verified; existing test-token sign-in remains required. Guides: [design](development/design-tokens.md#react-workspace-design), [integration](integrations.md#react-fines-workspace) and [testing](testing.md). This user-requested UI change takes precedence over planner qualification.

## 26 October 2026 — Refresh stale APIs behind service-page 404s (P2-06, step)

The running compatibility API predated the current route handlers: real local sign-in worked, but service discovery, payment accounts and manual page preparation returned HTTP 404. Reconcile the checked-in demo identity configuration and recreate the source-mounted APIs while retaining all existing volumes. All advertised manual routes then prepare successfully using real local Keycloak authentication; cancelled wallet approval replay remains refused. Add `npm run demo:refresh` so a source update reloads those Node processes without starting automation workers, resetting stores or downloading models. The [development guide](development/local-development.md#configuration) explains when a plain Compose `up -d` can leave an old process serving outdated routes. This user-requested repair takes precedence over planner qualification.

## 26 October 2026 — Put the conversation at the centre of the React app (QA-06, step)

Replace the tall welcome cards and stacked phone directory with an explicit **Chat with Rashid** workspace: a dark navigation rail, message bubbles, compact prompt chips and a visible **Send** action. Chat and service details use separate phone views; drafts and transcripts survive switching, and service updates keep the resident in chat. A bounded viewport and scrolling transcript keep the composer on screen after long replies and resizing. New conversations and the chat navigation action restore the chat view. Swap/restore move into **Layout**, retaining each pane's minimize/maximize controls. Correct the payment button fill/text roles. The [design guide](development/design-tokens.md#react-workspace-design) describes the resulting layout and token palette. This user-requested UI correction takes precedence over planner qualification.

Desktop/phone browser checks cover the actual user/assistant exchange through an explicit gateway stub, composer visibility including a short phone viewport and a long response, view/draft retention, navigation and unchanged focused-agent payment recovery. Repository and token checks apply. Full compatibility sign-in remains subject to the previously recorded local account-loading failure; no new compatibility, live-model or native qualification is claimed.

## 26 October 2026 — Refine the React city workspace with offline design skills (QA-06, step)

The user-requested design work takes precedence over planner qualification for this slice. Use `frontend-design` and the vendored design-system/UI guidance to give the concierge more desktop space, readable type, a direct fines shortcut, a labelled composer and a compact service directory. The local Dubai skyline and semantic service icons retain Cityside's identity without external assets. Existing pane controls, service actions and exact fines approvals remain intact. The main React stylesheet now uses shared color tokens throughout, lowering the raw-color baseline. The tablet/phone navigation drawer traps focus, closes with Escape, restores its opener and releases the workspace when resized to desktop; a skip link reaches the workspace. The [design guide](development/design-tokens.md#react-workspace-design) records the palette, layout and checklist.

Validation: repository checks and token checks pass. Desktop/phone focused-agent, Angular accessibility and external-host-guard journeys pass against isolated test servers (Chrome's IPv4 host resolver avoids an older IPv6 Angular dev server); the concierge gateway is explicitly stubbed and fines use the real isolated agent/SQLite runtime. Screenshots are visually inspected. The full compatibility suite was attempted and stopped after account loading failed during real Keycloak sign-in, before those journeys could run; no full compatibility or native/device pass is claimed.

## 26 October 2026 — React adoption milestone evidence recorded (P1-03)

The [executed report](reports/2026-10-26-react-fines.md) names implementation revision `9041913`, its focused/repository checks, desktop/phone browser assertions and visually inspected artifacts. It distinguishes the real process/SQLite boundary from fixture inference, the stubbed main-concierge layout test and the unsuccessful OpenRouter connection attempt. The evidence register links this milestone without extending historical compatibility operating claims. No runtime or task status changes.

## 26 October 2026 — React fines adoption and interchangeable workspace panes (P1-03)

The primary React `/services/fines` route uses the focused agent's authenticated POST SSE, validated Cityside surface and exact approval bindings, with saved conversation restoration, inspect/recover and cancellation. The selected fine set is shown in AED; receipts stay explicitly simulated. A lost response blocks replacement commands until the original operation is recovered. The browser token stays in memory and the model key stays server-side. Desktop/phone browser journeys execute the real agent and SQLite, kill/restart it across an approval, replay/stale/cross-owner actions and verify the persisted payment count. Other journeys retain their existing API paths.

At the user's request, both the main concierge and fines route share swap, maximize, minimize and restore controls. Reordering preserves DOM reading order and drafts; new reviews reopen service details. The offline design-system/UI guidance, token validator and browser touch/focus checks apply; new styles add no raw colors and obsolete overlay styles were removed. The browser suite also verifies layout controls in the main concierge against an explicit compatibility-gateway stub. Guides: [React setup and design brief](integrations.md#react-fines-workspace), [testing](testing.md) and [architecture](architecture.md#incremental-adoption-boundary). Real-model, container, Keycloak and native/device qualification are separate boundaries.

## 26 October 2026 — Explicit free OpenRouter planner configuration (P1-05, step)

The user-selected hosted planner reuses `OPENROUTER_API_KEY` through the existing OpenAI-compatible adapter, only at the exact HTTPS OpenRouter endpoint. The private initializer supports `--openrouter` without copying the key; free model names and zero provider prices are enforced, redirects are refused and there is no paid/fixture fallback. Tests cover key isolation, explicit override, paid-model refusal and safe provider failures. The opt-in `npm run agent:verify:model` declares synthetic bilingual intent/latency smoke thresholds. Live access attempts failed at network connectivity before a usable response; no successful key authentication or inference is claimed. This explicit user request takes precedence over the local-only planner preference. Guide: [OpenRouter setup](integrations.md#explicit-openrouter-setup).

## 26 October 2026 — Remove unused workspace experiments (P2-05, P2-06)

User-requested cleanup takes precedence over the adoption critical path for this change. Remove the unreferenced historical OpenRouter connector, its isolated tests and diagnostic command, the unvalidated gateway YAML and obsolete default Compose file, and the duplicate pnpm workspace manifest. Remove their environment hints and update the gateway decision and [local setup guide](development/local-development.md#refreshing-the-workspace). The focused agent, retained compatibility services, payment/security/restart suites and historical evidence remain in place. No TODO acceptance criterion is claimed by deleting unused experiments.

Validation: `npm run check:agent` and `npm run check` pass after refreshing locked dependencies and rebuilding SQLite with the pinned npm version. Docker, browser and native/device suites were not run.

## 26 October 2026 — Reconcile focused-agent adoption and compatibility planning (P1-03)

PR #9 incorporates the latest main branch, retaining QA-05's delivered revocation/payment fixes and its evidence. The current plan prioritizes primary React adoption of the native SQLite agent, local model qualification and a single-container persistence check; broader shell parity and the historical multi-service simulator remain a separate compatibility track. Agent rules, architecture decisions, overview, setup, README and index now distinguish the focused default from that retained path. PostgreSQL, a separate workflow executor, mandatory gateway infrastructure and mandatory UI-protocol migration are excluded from the minimal demo. Task status remains solely in TODO.md; no UI, business behavior, disabled workflow or unrelated project is changed by this reconciliation. Executed qualification of the published reconciliation revision is recorded in the [milestone evidence](reports/2026-10-26-simple-agent.md#merge-reconciliation-qualification).

## 26 October 2026 — Focused-agent verification recorded (P1-03)

The [milestone evidence](reports/2026-10-26-simple-agent.md) now names the exact fetched implementation revision and records executed focused/repository checks, the clean native dependency install, interactive CLI result, the reproduced Python formatting issue and the optional pytest skip. No application behavior or task status changes.

## 26 October 2026 — Python-version-independent vendored-skill assertion (P2-12)

The unchanged base test rejected Python 3.14's argparse output solely because choices no longer have surrounding quotes. The assertion accepts both Python 3.12 and 3.14 formatting while still requiring rejection of `vue` and exactly the supported React, Angular and Flutter choices. No vendored skill source or product behavior changes. The focused-agent evidence records the original failure, base reproduction and subsequent verification.

## 26 October 2026 — QA-05 delivered: failure and revocation journeys with exact persisted effects

Five journeys in `test/browser/failures/` run on desktop and phone, each on an isolated run with an operator and a controllable clock (`scenarioTest` in `stack.ts`). Card failures: an expired or disabled card is refused with no journal, hold or issuer row; a declined card and an exceeded limit fail the order with their own codes after one issuer attempt, and a replay is not a second attempt; a refund the issuer declines leaves the funding settled, the refund `FAILED` and the journal unchanged. Captured but unsettled: with the response lost after the capture commit, the order shows `RECONCILIATION_REQUIRED`, replay and replacement are blocked, and "Inspect or resume payment" settles the same order once (one journal entry, one applied claim, both fines paid). Blockers: a bill amended after the review cannot be approved on the old price, and a new review needs the stale one cancelled first; a wallet that no longer covers the amount fails with no hold and no fallback to another card; a challenge nobody answers before the clock passes its expiry is refused (`APPROVAL_CHANGED`), the issuer record ends `EXPIRED`, the order `FAILED` with `AUTHORIZATION_EXPIRED`, and nothing is captured or journaled. Rules: a rule is paused on the page (consent kept, resume offered, nothing moves); a card it depends on can be disabled but not removed, and resuming on a disabled card is refused (`MANDATE_SOURCE_CHANGED`) and leaves the rule paused; revoking releases the references, keeps the history, and a revoked rule cannot be resumed, paused or approved again. Duplicate events: after a lost response is recovered, the source's signed event repeated is a duplicate, a forged copy is 401 and an invented one is refused, with the inbox, journal and wallet unchanged. The rules journey found a real defect, fixed with a unit test: revoking a *paused* rule answered 200 "Rule revoked" but left it paused with its references held (so its card could never be removed); a paused rule now revokes, releases and expires like an approved one. Guide: [testing](development/testing.md#browser-journeys-under-playwright-test).

## 26 October 2026 — Focused one-process agent and SQLite fines slice (P1-03)

The explicit architecture simplification assignment adds the `npm start` entry point inside agent-core: one strict TypeScript/LangGraph.js agent, official SQLite checkpoints and a fixture-backed REST simulator. The model can select a bounded fines plan; deterministic permissions, exact consent and backend quote checks gate every simulated payment. Persisted operation identity and atomic simulator receipts prevent duplicate effects, and original-operation recovery handles a lost payment response. The CLI and validated Cityside compatibility surface expose durable approvals without rebuilding the shells. Existing integrated services and workflows remain isolated and unchanged; no other repository is used. PostgreSQL is deferred following the later embedded-storage instruction. Work is off the browser critical path because this user-requested runtime simplification explicitly takes precedence. Guides: [architecture](architecture.md), [flow](agent-flow.md), [integrations](integrations.md), [security](security.md), [testing](testing.md). Actual verification is recorded in the [milestone evidence](reports/2026-10-26-simple-agent.md). P1-03 remains open for primary-shell adoption and live model/identity qualification.

## 26 October 2026 — QA-04 delivered: asserted payment and automation journeys with exact journal and provider effects

Five new browser journeys in `test/browser/pay-and-automate/` run on the Playwright runner on desktop and phone, each on its own environment: linked accounts (five owned records, no money moved, a repeat is not a second record, a forged reference refused, another account and the household workspace see nothing), fines from the wallet (an active hold for the reviewed total, then one sealed `PAYMENT` of -42000 balanced against merchant clearing, the hold voided, one applied settlement claim, and both police fine records PAID against one receipt), a wallet top-up from a challenged card (no entry until capture, then one balanced `TOPUP` tied to the order and one `CAPTURED` issuer record bound to the approved challenge), a bill with its receipt and full refund (a balanced `REFUND` that mirrors the payment, the refund record `REFUNDED`, the utility's bill `CANCELLED` with the reversed amount, and the journal summing back to the starting wallet), and a wallet recharge with a card recharge (the wallet debited only by the wallet one, each provider credited by exactly the recharge). Each journey also asserts that a retry and a reload add nothing and that a wrong owner is refused. Breaking the top-up reference, the hold release and the refund reference each fails the matching journey. The opt-in autopay and time-advance coverage stays in `scripts/e2e/automation-execution.ts`, which now asserts the journal: exactly one sealed, balanced entry for the first settlement, for the two-worker race and for the scheduled run, and none while only scheduling (all 20 checks pass against the Compose broker, which is restored afterwards). The 13 existing payment journey scripts were rerun and stay green. Evidence: `npm run test:browser` (the five journeys, 10 runs together in one go) and the scripts above. Guide: [testing](development/testing.md#browser-journeys-under-playwright-test).

## 26 October 2026 — SIM-05 delivered: the scenario console, the run reset and the stack run

`npm run simulator:console` starts an isolated run and a local operator page for it (`scripts/operator-console/`): arm or clear the four named failpoints, see which are armed and how often each fired, see every account's wallet, held funds, open orders and claims, read the audit, export the run as redacted JSON, and reset it behind a one-time, 60 second confirmation. The launcher keeps the operator's token (refreshed before it expires) and the page holds only an HttpOnly, SameSite=Strict cookie; the server listens on loopback, checks Host and Origin, requires a console header, sends a strict content security policy, accepts only the fixed registry names and bounded counts, and makes its own request keys. The reset uses the host-side database replacement from the earlier step and was exercised on the stack: a resident's seeded wallet was deleted by the reset and reseeded to its starting balance on next use. Time is deliberately not in the console: the provider has no route that moves it, and a test fails if one appears. The stack journey (`test/browser/operate-scenarios/console.spec.ts`, 6 tests on desktop and phone) found two defects, both fixed: `GET /internal/scenario-controls/{run}/inspect` had no operator check, so any signed-in user could read the isolated run's accounts and balances (now guarded, with a unit test), and the console page overflowed sideways on a phone (the table now scrolls in its own region). The controls' status now also reports each failpoint's remaining hits. Evidence: `services/test/sim05-console.test.ts` (13 tests; breaking the host, origin, header or one-time confirmation guard fails them) and `services/test/sim05-reset.test.ts`. Guide: [issuer scenarios](development/issuer-scenarios.md#scenario-console).

## 26 October 2026 — the Angular shell passes the touch, focus and motion measures at phone width (QA-06, step)

The Angular accessibility spec now runs on the phone project as well as desktop and passes without further style changes: every control is at least 44px with text of at least 14px (with the delegation and voice panels open), keyboard focus is visible, and reduced motion stops motion. I checked the phone screen by eye, closed and with both panels open: the header wraps, the suggestion chips scroll sideways and nothing overlaps. The stubbed gateway now returns an empty grants list so the fixture shows a clean state. QA-06 stays open for Flutter (no toolchain here) and the masked-method, challenge, unknown-state and pause/revoke journeys. Guide: [testing](development/testing.md#browser-journeys-under-playwright-test).

## 26 October 2026 — the React shell passes the touch, focus and motion measures at phone width (QA-06, step)

The responsive rules for narrow screens had re-shrunk six controls: the navigation items, the four suggestion cards, the "Explore all city services" link, the profile button and the surface toggle, to 9 to 12px. They now use the control size, and `touch-focus-motion.spec.ts` runs on the phone project as well as desktop: every control is at least 44px with text of at least 14px on the home, payment accounts and delegated access screens, keyboard focus is visible, and reduced motion stops motion. I checked the phone home screen and the navigation drawer by eye. The Angular accessibility spec still skips on mobile. QA-06 stays open for the Angular and Flutter phone layouts and the masked-method, challenge, unknown-state and pause/revoke journeys. Guide: [testing](development/testing.md#browser-journeys-under-playwright-test).

## 26 October 2026 — the kill-switch journey runs on the phone project (QA-06, step)

The earlier skip said the account switcher is not in the header at phone width; it is, in the navigation drawer that the "Open navigation" button opens, and the journeys never opened it. `withAccountSwitcher` (`test/browser/layout.ts`) opens the drawer when the layout collapses it, runs the step, and closes it again, and the shared signed-in fixture uses it. The AUTO-15 kill-switch journey now passes on both the desktop and mobile projects instead of skipping on mobile. The accessibility specs still skip on mobile: un-skipping the React one showed card buttons at 10px and the browse link at 9px in the phone layout, which is the next fix. QA-06 stays open. Guide: [testing](development/testing.md#browser-journeys-under-playwright-test).

## 26 October 2026 — P2-12 delivered: an offline subset of the design skills for agents

`.claude/skills/design-system` and `.claude/skills/ui-ux-pro-max` are copied from the sibling `agentic-super-app` project without slide generation, Tailwind and shadcn material, `fetch-background.py` and the upstream tests that need the full dataset; only the React, Angular and Flutter stack data is kept, and the stack table, the stack list in `SKILL.md` and `design-system/SKILL.md` are edited to match. `AGENTS.md` gains a UI rule that points at them, and `.claude/skills/VENDORED.md` records the source, the edits, the license status and a SHA-256 for each of 34 files (the source is not a git repository, so content hashes are its revision). `design-system` states MIT; `ui-ux-pro-max` states no license, which is recorded and means it should not leave this repository until confirmed. Evidence: `services/test/p212-vendored-skills.test.ts` (9 tests) checks the manifest hashes, front matter, omissions, every file a `SKILL.md` names, that no script imports a network module, and runs the search for each stack, the design-system mode, the token generator and validator, and the vendored validator tests with all proxies pointed at a closed port; adding a network import, a stray stack file or a hand edit fails it. Python caches are now git-ignored. Guide: [design tokens](development/design-tokens.md#design-skills-for-agents).

## 26 October 2026 — P2-15 delivered: a slow Keycloak introspection no longer fails the first signed-in call

The online token check had a fixed 5 second limit. On the local stack a cold Keycloak answered its first introspections in 3.7 seconds and once past 5 seconds (a 503, then a 401 for the first `/api/accounts`); warm it takes about 0.2 seconds. The limit is now `KEYCLOAK_INTROSPECTION_TIMEOUT_MS`, default 8000 and bounded to 1000 to 12000 so it stays inside the servers' 15 second request limit. It still fails closed: past the limit, an inactive answer, a server error or an invalid setting all refuse the token, and error text from the upstream is not exposed. Evidence: `services/test/p215-introspection-timeout.test.ts` (6 tests, including the observed 5.5 second answer succeeding under the default; restoring the fixed 5 second limit fails two of them). Not checked on the running Compose stack, whose containers were not restarted. Guide: [application API](development/application-api.md).

## 26 October 2026 — the Angular shell meets the same touch, focus and motion floor (P2-14, step)

The Angular shell now loads the generated token CSS, and its controls are at least 44px with 14px text, its chat row shows keyboard focus, and it honours reduced motion. Reduced motion is one shared global stylesheet, `packages/ui-tokens/src/a11y.css`, used by React and Angular, because Angular's component-scoped `*` rule never reached `html`, `body` or the app host. `test/browser/accessibility/angular-touch-focus-motion.spec.ts` measures the built shell in a real browser against a stubbed local gateway; against the previous Angular sources all three of its tests fail, and the original shell had no working reduced-motion rule at all. Both shells' reduced-motion tests now inject a motion canary so they prove motion exists before proving it stops. While building this, the gateway logs showed Keycloak token introspection taking 3.7 seconds and once exceeding the gateway's 5 second limit (503), so the first signed-in call returned 401; that is tracked as P2-15. P2-14 stays open for Flutter (no toolchain here), the phone layout (QA-06) and the shell text colors that are not tokens yet. Guide: [design tokens](development/design-tokens.md#outputs).

## 26 October 2026 — contrast, touch target and focus floor for the React shell (P2-14, step)

Fill and text colors are now separate roles (`successText`, `warningText`, `dangerText`, `primaryText`, each with a dark value), a `focusRing` role and a 14px control size exist, and the token source declares 19 text/background pairs per theme that `npm run tokens:generate` checks in light and dark, refusing to write outputs when one falls below its ratio (4.5:1 text, 3:1 focus ring). The dark-theme primary text, 2.4 to 2.7:1, is replaced by a readable value. In the React shell, text fields now share the focus indicator, the composer shows focus on its container, every control has a 44px minimum, and 12 control rules that used 9 to 13px text now use the control size, with the two card-button captions raised from 9px to 13px. `test/browser/accessibility/touch-focus-motion.spec.ts` measures this in a real browser on the Compose stack; against the previous stylesheet four of its five tests fail. Evidence also in `services/test/p214-contrast.test.ts` (7 tests). P2-14 stays open for the Angular and Flutter shells, the phone layout (QA-06) and the shell text colors that are not tokens yet (the P2-13 migration). Guide: [design tokens](development/design-tokens.md#text-roles-contrast-and-focus).

## 26 October 2026 — one layered design-token source and a raw-color ratchet (P2-13, step)

`packages/ui-tokens/src/tokens.source.json` now holds primitive values, semantic roles (light and dark) and component tokens, and `npm run tokens:generate` writes `theme.css`, `tokens.json` and a Flutter `tokens.g.dart` from it. Every CSS variable and JSON key the shells used keeps its name and value (a frozen contract in the test), and the new primitive and component variables are additive; components follow the dark theme through their semantic role. `npm run check:tokens` (part of `npm run check`) fails when a committed output drifts from the source, and a ratchet fails when a shell file gains a raw hex, rgb, hsl or Flutter color literal or loses some without lowering `packages/ui-tokens/raw-colors.baseline.json`. Evidence: `services/test/p213-tokens.test.ts` (11 tests); adding a raw color to a shell file or hand-editing `theme.css` makes the checks fail. The Dart output is generated text that no check here compiles, because this environment has no Dart toolchain. P2-13 stays open for migrating the shells until the baseline is empty. Guide: [design tokens](development/design-tokens.md).

## 26 October 2026 — Playwright Test runner for the browser journeys (QA-09, step)

`npm run test:browser` runs the journeys under Playwright Test with desktop and mobile projects, folders by resident intent, a fresh browser context per test, an automatic block on any request outside this machine, traces and screenshots kept on failure, and per-suite artifact roots (`E2E_SUITE`, `E2E_ARTIFACT_ROOT`) so suites can run side by side. The kill-switch journey (AUTO-15) is ported as the first spec and passes on desktop against the Compose stack; on mobile it skips with a reason, because the account switcher is not in the header at phone width (QA-06). The external-host guard is proved by a spec that must fail, and disabling the guard makes the runner report an unexpected pass. Offline tests cover the artifact roots and the host rule (`services/test/qa09-browser-runner.test.ts`). QA-09 stays open until the QA-04 to QA-06 journeys exist and run under it. Guide: [testing](development/testing.md#browser-journeys-under-playwright-test).

## 26 October 2026 — bounded in-memory conversations and approval refusals (P1-18, step)

The process-local conversation store had no cap and no idle expiry. `services/agent-core/src/session-limits.ts` now bounds threads per owner (default 25) and overall (1000), expires idle ones, evicts the owner's least recently used thread first, never evicts a thread with a request in flight, refuses a new thread with `SESSION_LIMIT_REACHED` (429) when every candidate is busy, and lets only the owner's own activity keep a thread alive. Redis sessions already expired idle threads and kept 100 replayable events each; the event journal was already bounded. Evidence: `services/test/p118-session-limits.test.ts` (12 tests: per-owner and global bounds, 20,000-thread churn staying within the caps, busy protection, foreign touches, the running core evicting the oldest, and confirmations refused for another identity, another account, a replaced revision, changed or extra fields, and typed yes, confirm or pay-it); removing the wiring or the busy check fails tests. P1-18 stays open for binding a draft confirmation to a profile/consent revision, which needs a revision source in the profile service. Guide: [local development](development/local-development.md).

## 26 October 2026 — P2-10 delivered: delegation and role negatives on the fast issuer

`services/test/p210-delegation-exchange.test.ts` runs the real broker against the test-only issuer and a loopback provider that calls the broker's own authorization check: an owner grants consent, the runner client executes it, the RFC 7523 exchange mints a token whose subject is the owner and whose client is the broker with no actor claim, and the provider sees exactly that. It refuses non-interactive and wrong-client consent callers, a runner token without its role or service-account name, a forged runner token, another user, a revoked grant, and an exchange the issuer rejects (nothing reaches the provider and the failure is not retried). The kill switch is writable only by the admin client and readable only by the worker, with the client, the scope and an actor claim each tested on its own. A first draft passed with the runner-role and kill-switch client guards removed, because other guards covered for them; the added cases fail when either guard is removed. The whole P2-10 suite runs in about two seconds with no Docker and is not Keycloak evidence. Guide: [testing](development/testing.md#fast-signed-issuer-suite).

## 26 October 2026 — a fast test-only signed issuer (P2-10, step)

`test/support/test-issuer.ts` is a loopback OIDC issuer for tests: ephemeral RSA keys and a JWKS endpoint, authorization code with mandatory S256 PKCE, a registered redirect and state, single-use and expiring codes, refresh rotation where reuse revokes the session, client credentials, and the RFC 7523 jwt-bearer grant with trusted-issuer keys, client-assertion checks and assertion-reuse refusal. `services/test/p210-test-issuer.test.ts` (9 tests, about 1.5 seconds, no Docker) drives the real `verifyJwt` and `ClientCredentials` over HTTP and checks that forged, foreign-key, altered, wrong-audience, expired, alg-none, jku/jwk and missing-scope tokens are refused. Two issuer guards were broken on purpose to confirm the tests fail. This is not Keycloak evidence; the real-Keycloak suites remain the release gate. P2-10 stays open for the broker exchange and role negatives. Guide: [testing](development/testing.md#fast-signed-issuer-suite).

## 26 October 2026 — one minimiser for model input (P1-17, step)

The prompt now carries a minimised copy of the current surface and a scrubbed service summary, and `boundedMessages` removes raw identifiers from every model request as a last net. Excluded with or without consent: account, meter, card, ledger, order and receipt references, Emirates ID, phone, email, UUIDs, long digit runs, node and option IDs, coordinates and unknown properties. Amounts and dates stay while personal context is shared and are withheld when it is withdrawn, and consent is read on every call. Evidence: `services/test/p117-model-input.test.ts` (8 tests, including the real request body; the egress test fails when the net is removed) and the unchanged live-conversation tests. P1-17 stays open: no resident control sets the consent yet (shared by default), and the streamed UI state does not use this function. Guide: [local AI](development/local-ai.md#what-the-model-sees).

## 26 October 2026 — P2-08 delivered: the free-only, local-only policy gate

`npm run check:local-only` (part of `npm run check`) fails on a hosted-SDK dependency in any package manifest, a deploy or publish command in an npm script, a hosting linkage file (Vercel, Netlify, Firebase, Wrangler, Fly, Serverless, Procfile), a cloud key or credentialed source in an env file or lockfile, and a CDN or remote-font URL in a built bundle under `dist` or `build`. Findings name the rule, file and line and never the matched value. Evidence: `services/test/p208-local-only.test.ts` (8 fixture tests, one per rule plus a clean tree, CRLF and Windows paths); the gate passes on the current tree (20 manifests, 1 env file, 1 lockfile, 6 bundle files scanned). A fixture test found and fixed an `aws` subcommand pattern that missed `aws s3`. Guide: [testing](development/testing.md#commands).

## 26 October 2026 — run-scoped reset through the scenario controls (SIM-05, step)

`POST /internal/scenario-controls/{run}/reset` lets the run's operator ask the host to replace the isolated run's database with a fresh, reseeded one. Sealed journals block an in-place restore, so the server only validates, audits and drops armed failpoints; the host deletes `payments.sqlite` and its WAL files inside the dedicated run directory and reopens the store on the same run context. A normal demo directory is refused, and each reset is logged outside the erased database. Evidence: `services/test/sim05-reset.test.ts` (7 tests); not yet run on the stack. SIM-05 stays open for the control-panel UI and that stack run. Guide: [issuer scenarios](development/issuer-scenarios.md#verified-boundary-and-remaining-work).

## 26 October 2026 — ledger invariant sequence test (QA-02, partial)

A sequence test holds, captures and voids funds and asserts that available equals posted minus held at every step, that a refused hold changes nothing, and that a capture moves exactly its amount (`services/test/qa02-ledger-invariants.test.ts`). QA-02 stays open: its tracker entry names the clearing-account reconciliation and the general per-period budget invariants that remain.

## 26 October 2026 — AUTO-15 delivered: the kill-switch panel control

The payments panel shows the worker's kill switch and lets an allowlisted automation operator stop automation (a reason is required) or let it run again. The worker's store records each change, and runs already paid are not reversed, as the panel says. Other accounts are refused. The browser journey `npm run demo:verify:kill-switch-panel` passes on the Compose stack. The broker-scoped admin route (3b-ii) remains a service path: a browser cannot hold the admin client's secret, so the panel uses the allowlisted operator sign-in. The rest of AUTO-15 was delivered earlier: pause-all, the operator route, the worker's applied state, and the in-flight race and outage tests. Its tracker entry is removed.

## 26 October 2026 — run export through the scenario controls (SIM-05, step)

`GET /internal/scenario-controls/{run}/export` returns the run's inspection for the operator, with secrets redacted by the shared redaction helper. It is operator-only and read-only: the test confirms that exporting changes no armed failpoint. Evidence: `services/test/scenario-controls.test.ts`; the provider type-checks. The route is not yet exercised on the Compose stack. Still open in SIM-05: the control-panel UI, the run-scoped reset, and network time-advance.

## 26 October 2026 — AUTO-04 delivered: consent for create, expand and source change

Every change to a rule's terms is a new review. The panel raises an approved rule's cap or changes its funding source through the revise route; the rule then waits for the owner's approval of the new terms, shown with trigger, target, funding (including fallback), caps, expiry and revocation. Lowering through the expand control is refused without a request. Lowering through narrowing needs no model call. Draft chat or voice text cannot activate a rule (guard test). Expanding keeps the budgets ordered, so the cap never exceeds its period or lifetime budget. Evidence: `scripts/e2e/mandate-create.ts`, `scripts/e2e/mandate-narrowing.ts`, `scripts/e2e/mandate-change.ts` (each passes on the Compose stack), `services/test/mandate-narrow.test.ts`, `services/test/bill-rule-policy.test.ts`, `services/test/auto04-consent-guard.test.ts`. The next run appears in the rule preview, not in the approval review.

## 26 October 2026 — create a bill rule in the panel with explicit consent (AUTO-04, step 3)

The rules panel can create an automatic bill rule for a linked biller and a chosen source, capped by the amount the owner types. Reviewing it creates a draft that is not active; only approving the reviewed terms consents to the rule. The browser journey `npm run demo:verify:mandate-create` runs this on the Compose stack. The rule policy is built by a shared function (`packages/protocol-core/src/bill-rule.ts`) whose output passes the same request validation as the route. AUTO-04 stays open for the expand and source-change consent flows.

## 26 October 2026 — narrow a rule's cap without a model call (AUTO-04, step 2)

The React rules panel can lower an approved rule's per-payment cap. The change goes through the existing revise route, is refused if it would raise or keep the cap, and leaves the rule waiting for the owner to approve its reviewed terms before it runs again. Evidence: `services/test/mandate-narrow.test.ts`; the React shell type-checks; the stack mandate check passes. A browser journey (`npm run demo:verify:mandate-narrowing`) drives the control on the Compose stack: a raise is refused with no request sent, a real narrowing waits for approval, and the approved review takes effect. AUTO-04 stays open for the create, expand and source-change consent flows.

## 26 October 2026 — draft text cannot activate a rule (AUTO-04, step 1)

A guard test scans the agent core: the approve action is reachable only from the authenticated mandate route, never from conversational code, so a draft in chat or voice cannot activate a rule. Approval also needs the reviewed digest and version, which the request validator enforces. Evidence: `services/test/auto04-consent-guard.test.ts`. AUTO-04 stays open for the consent flows (create, expand, source change) and the rule editor with narrowing in the React panel.

## 26 October 2026 — AUTO-14 delivered: owner inbox explains every run on the real stack

AUTO-14 meets its `Done when`. The owner inbox shows, with reason, rule version and effect, each outcome the stack produces: scheduled (once, before the run is due), settled, paused (`MANDATE_NOT_ACTIVE`), declined (`CARD_DECLINED`), challenged (approve pays once, reject pays nothing) and unknown (held, not retried, shown as possibly moved). Re-reading adds no entries, and another owner sees none of them. Evidence: `npm run demo:verify:automation-execution` (20 checks, including the scheduled notice), with unit coverage in `services/test/auto14-*.test.ts` and `services/test/automation-inbox.test.ts`. Notifications are in-app: the inbox is the delivery surface, and no push channel exists.

## 26 October 2026 — unknown outcome verified on the real stack (AUTO-14, step 6)

`scripts/e2e/automation-execution.ts` now injects a lost response after admission and before capture on the Compose stack. The provider's recovery marks the order unresolved; the worker holds the run as unknown (`ORDER_CAPTURING`, or `OUTCOME_UNKNOWN` where the provider reports it), moves nothing the owner can see, does not retry under a new identity, and the owner inbox says money may have moved. The earlier "ORDER_CAPTURING" surprise was the lost response itself: the provider turns it into a capturing order rather than an error, which the worker holds. Evidence: `npm run demo:verify:automation-execution`. On the stack, the owner inbox now covers settled, paused, declined, challenged and unknown outcomes. AUTO-14 stays open until the scheduled upcoming-run notice is also checked on the stack.

## 25 October 2026 — every held run that may have moved money says so (AUTO-14, correction)

The owner inbox described a held run as "Effect: None" unless its reason was one of two named ones, so a run the provider left capturing (`ORDER_CAPTURING`) was also described as no effect. Now every hold except a kill switch that stopped a run before its credential was presented says money may have moved, and the owner is pointed to reconciliation on the original order. Evidence: `services/test/auto14-effects.test.ts`. Still open in AUTO-14 step 6: the unknown outcome on the Compose stack. A first attempt found the provider returns a capturing order without reaching the simulator failpoint, which needs investigating before the stack check is written.

## 25 October 2026 — broker-scoped kill-switch admin client and desired state (AUTO-15, step 3b-ii)

A new `automation-admin` Keycloak client, whose only scope is `automation.admin`, writes the desired kill-switch state at `POST /api/delegation/automation/kill-switch`. The automation worker reads it with its own execute scope. The worker applies it only when it is newer than the worker's last change, so a local engage or release is never undone by an older authority state. Verified on the Compose stack with real tokens (`npm run demo:verify:automation-kill-switch`): the admin sets the state, the worker reads it through its gateway, and the worker and the admin are each refused the other's direction. Still open in AUTO-15: 3b-iii, the panel control.

## 25 October 2026 — the worker applies an authority's kill-switch state (AUTO-15, step 3b-i)

The worker now reads an optional desired kill-switch state from its gateway and applies it to its own store. The worker stays the only writer of that store. A desired engaged state stops new claims; a desired released state lets work resume; an unreadable or absent state changes nothing, so a switch is never released on a failed read. The HTTP gateway does not call an authority yet, so nothing changes in a running system until the broker side (3b-ii) exists. Evidence: `services/test/auto15-kill-switch.test.ts`.

## 25 October 2026 — operator kill switch over the application route (AUTO-15, step 3a)

`POST /api/payments/automation-kill-switch` engages or releases the worker's kill switch for a signed-in account listed in `AUTOMATION_OPERATOR_SUBS`. Engaging needs a reason; any other account is refused and nothing changes; a missing job store is an error, never a new file; the route accepts only its named fields. Evidence: `services/test/auto15-admin-kill-switch.test.ts`. Still open in AUTO-15: 3b, a broker-scoped admin client and scope with its panel control.

## 25 October 2026 — pause and revoke races stop an in-flight run before money moves (AUTO-15, step 4)

A limit reduction and a card disable made after preparation each stop the in-flight execution at admission: it closes with its order cancelled and nothing moved (`services/test/automation-runs.test.ts`). Revoke before admission, an authority denial and a restart keeping a pause were already covered and are cited in the tracker. The worker guide now explains that signing out does not stop a rule, while a pause or revoke takes effect at admission and never reverses a committed payment. Still open in AUTO-15: step 3, the authenticated admin route.

## 25 October 2026 — held runs state their money effect honestly (AUTO-14, correction)

The owner inbox and run history described every held run as "Effect: None", including a run whose outcome is unknown and whose money may already have moved. A held unknown outcome now says that money may have moved and is reconciled on the original order, never retried under a new identity. A run waiting for a card challenge says nothing has moved yet. Skipped, failed and kill-switched runs keep "None". Evidence: `services/test/auto14-effects.test.ts`. Still open in AUTO-14: the unknown outcome on the Compose stack (the provider's retries replay the same order, so the stack check needs a persistent provider failure).

## 25 October 2026 — test suite cleanup on Windows (no feature change)

The offline suite went from 45 failing tests to none on Windows (734 pass, 3 skip for platform reasons, 0 fail). Temporary-directory removal goes through one helper that tolerates Windows file locks. The catalog endpoint test imports a file URL; the SBOM generator and the isolated React build run `npm` through the Windows shim; the shutdown tests skip where `SIGTERM` cannot be delivered; the symlink check probes and skips when symlinks are not permitted; and the POSIX file-mode assertion runs only where modes are enforced. The owner inbox real-stack check now also covers card challenges (approve pays once, reject pays nothing). Rules and reasons are in [the testing guide](development/testing.md#windows-test-notes).

## 25 October 2026 — owner inbox verified on the real stack (AUTO-14, step 5)

`scripts/e2e/automation-execution.ts` now reads the owner inbox through the core route after the worker has run. A settled run, a paused run (`MANDATE_NOT_ACTIVE`) and a declined card (`CARD_DECLINED`) each appear once with their reason, rule version and effect; re-reading adds no entries; another owner sees none of them. The check passes on the Compose stack. Still open in AUTO-14: challenged and unknown outcomes on the stack. Also fixed: the issuer-scenario harness retries a GET once after a stale keep-alive reset, and the journey top-up is within the funding limit.

## 25 October 2026 — answer a held challenge from the inbox; restart keeps a pause (AUTO-14 step 4, AUTO-15 step 4 in part)

A held card challenge entry in the owner inbox now names its order and offers approve or reject, using the same order challenge action as the payments list; the worker never answers. A pause on a rule survives a provider restart and still refuses preparation (`services/test/automation-runs.test.ts`). Still open: AUTO-14's `Done when` checks for notifications and the paused outcome on the stack, and AUTO-15 steps 3 and 4 (the admin route, and the revoke, limit and card-disable races against an in-flight execution plus the authority outage). Evidence: `services/test/auto14-inbox-feed.test.ts`, `services/test/automation-runs.test.ts`; the React shell type-checks.

## 25 October 2026 — operator kill switch and owner pause-all (AUTO-15, steps 1–2)

The automation worker honours a persisted global kill switch, engaged and released with `scripts/automation-kill-switch.ts`. Engaged, it claims no job and starts no step. A credential already issued is held as `KILL_SWITCH_ENGAGED` and never presented. The state survives a restart. The owner can pause every approved rule at once through `POST /api/payments/mandates/pause-all`, which reports the rules it could not pause and retries under stable keys; the React rules panel has the button. Still open in AUTO-15: the authenticated broker-scoped admin route and panel control, and the race and outage tests in its `Done when`. Evidence: `services/test/auto15-kill-switch.test.ts`, `services/test/auto15-pause-all.test.ts`.

## 25 October 2026 — owner inbox feed and panel (AUTO-14, step 3)

`GET /api/payments/automation-inbox` returns the worker's inbox entries for the signed-in owner's rules only. The owned set comes from the provider's owner-scoped mandate list, the response carries the request's `requestId`, and a missing job store reads as empty without being created. The React payments panel loads it on demand under the same per-account key as the rules panel, so an account switch re-reads it. Polling replaces streaming for the demo. Still open in AUTO-14: answering a held challenge from the inbox, and the notification and "paused" outcome checks in its `Done when`. Evidence: `services/test/auto14-inbox-feed.test.ts`; the React shell type-checks; the Compose stack was not run.

## 25 October 2026 — worker resumes an approved card challenge (AUTO-14, step 2b)

A job held on an automation order's card challenge is now parked for a minute and polled. The broker's new `resume-credential` route issues one resumed credential only after the provider reports the owner approved the challenge; a pending or rejected answer is refused before anything is issued. The replaced permit is closed so its token stops being a session, and a resumed permit is never resumed again. Approve resumes the same order once and records `CHALLENGE_ANSWERED` (`APPROVE`); reject fails the job with the answer recorded and nothing moves. An unconfirmed or refused resume holds the job and is not asked again. This is the one documented exception to the one-credential rule in the permit contract. Evidence: `services/test/auto14-resume.test.ts`, `services/test/auto14-resume-permits.test.ts`, `services/test/auto14-challenge.test.ts`. Not run here: the Compose stack, so the resumed execution against the real provider and Keycloak is unverified. Still open in AUTO-14: the authenticated feed and the React panel (step 3).

## 25 October 2026 — owner answers a held automation challenge (AUTO-14, step 2a)

A card challenge raised by an automation order can now be answered only by the signed-in owner, through the existing challenge route. Approve authorizes the same order; reject closes it with nothing paid and its reservation released. The worker and any other unattended caller are refused. The worker does not yet resume an approved job or record the answer as an event (step 2b). Evidence: `services/test/auto14-challenge.test.ts`.

## 25 October 2026 — owner inbox and run history from the worker's records (AUTO-14, step 1)

`services/automation-worker/src/inbox.ts` turns the worker's outbox events and pre-run reminders into owner-facing entries. Each entry names its source, so re-reading the inbox never duplicates a notification; it carries the reason, the rule version and what the run changed. Only the caller's owned rules are returned, and run history is refused for another owner's rule. Evidence: `services/test/automation-inbox.test.ts`. Still open in AUTO-14: answering or abandoning a held card challenge, the authenticated feed, and the React panel.

## 25 October 2026 — one-period subscription renewal and the default-deny capability map (AUTO-13)

A `SUBSCRIPTION_RENEWAL` rule now renews one billing period at a time, from that period's own unpaid invoice, for an active subscription, at exactly the current plan price and inside the cap, with the paid order's receipt. A plan upgrade or repricing, a lapsed subscription, an uninvoiced or ambiguous period and a restricted invoice are skipped with a reason and recorded as requiring action; a paid period is never paid twice. `automationEligibility` maps catalog capabilities to mandate operations by default deny, and a test walks all 32 catalog capabilities: only the six named operations are automatic, and rides, dining, tenancy and utility activation, plan changes and parking activation stay review-required with no delegation. The preview forecasts renewals. Evidence: `services/test/automation-eligibility.test.ts`, `services/test/auto13-renewal.test.ts`. Not yet run on the real Compose stack: the renewal rule needs a start date in the past, which the mandate API rejects.

## 25 October 2026 — bounded automatic extension of one parking session (AUTO-12)

A `PARKING_EXTENSION` rule now adds one hour at a time to exactly the session, plate and zone the owner bound, only while that session is running and the extra hour fits the rule's maximum hours, end time and budget. The rta provider quotes an extension for the exact session state (`services/provider-simulator/src/parking-extensions.ts`), and an automatic order that only the dedicated execution route can admit pays it through the usual reservation, admission and settlement chain, so the session changes only when an admitted, captured and settled order applies the quote. Departure, expiry or revocation before admission make the quote stale and nothing is charged; a departed, expired, missing or mismatched session is skipped and never revived or inferred. The scheduler announces one occurrence per session expiry. Manual orders cannot take a parking quote, parking extensions cannot be refunded, and one extension per rule can be open at a time. The preview forecasts extensions. Evidence: `services/test/auto12-parking.test.ts`, `scripts/e2e/automation-execution.ts`.

## 25 October 2026 — opt-in automatic payment of approved fines (AUTO-11)

A `FINE_PAYMENT` rule now pays a fine automatically only when its current record is inside what the owner approved: the plate, a finite list of fine types, a per-fine cap and the period and lifetime counts. The scheduler announces each unpaid fine once as its own occurrence; preparation then reads the current fine and skips anything paid or withdrawn, of an unapproved type, under a simulated restriction or above the cap, with a recorded reason and a requires-action event for the owner, and nothing is reserved or moved. A discount applied before preparation is honoured, a reserved fine can no longer be amended at the source, and admission re-reads the record. Automatic and manual payments of one fine exclude each other in either order and settle it once; fines arriving together are paid one at a time because the worker now treats a mandate cooldown as a wait and retries the same occurrence instead of failing it. Fixing the duplicate-order pre-check (it compared the wrong identifier) also makes bill rules refuse a payable a manual review already holds. Fine payables now carry their violation, and the preview forecasts fines. Evidence: `services/test/auto11-fines.test.ts`, `services/test/automation-worker.test.ts`, `scripts/e2e/automation-execution.ts`.

## 25 October 2026 — automatic recharge of a toll tag or prepaid number (AUTO-10)

A `RECHARGE` rule now recharges its exact toll tag or prepaid number when usage takes the balance below the rule's threshold. The scheduler reads only that target at its own provider and re-fires only after new usage recorded on it, so another line, another provider and the recharge itself cannot trigger a charge. Preparation checks the target is active, the approved amount is still a denomination and would not pass the target ceiling, takes a recharge quote from the source provider and reserves it with an automatic payment order that only the dedicated execution route can admit; a balance that moved after preparation makes the quote stale and admission refuses it. A rule has one unfinished recharge at a time, caps and cooldown are shared with every rule, and short funds or a declined card fail as requiring action without touching another source or starting any other automatic payment. The preview forecasts recharges. Evidence: `services/test/auto10-recharge.test.ts`, `scripts/e2e/automation-execution.ts`.

## 25 October 2026 — automatic wallet reload from an approved card (AUTO-09)

A `WALLET_RELOAD` rule now reloads a low wallet balance from its approved card. Preparation computes one finite amount (the rule's reload amount, capped by the target balance, the funding limits, the per-payment cap and the period and lifetime budget), reserves it and creates an automatic wallet-funding order that ordinary funding routes refuse and only the dedicated execution route admits, using the same one-time permit, freshness check and release rules as a bill. Capture and credit stay one local transaction, one funding order can be open at a time, and admission re-checks that the rule is approved and the balance is still low for the same amount, so a revoke or an owner top-up stops it. The scheduler's threshold trigger now fires again only after a new qualifying external payment (a wallet payment counts; the reload's own credit, a top-up and a refund of a reload do not), so the reload cannot loop; a decline fails the job as requiring action and a challenge holds it, with the trigger left disarmed while the balance stays low. The rule preview now forecasts reloads. Evidence: `services/test/auto09-reload.test.ts`, `scripts/e2e/automation-execution.ts`.

## 25 October 2026 — automatic payment of linked utility and telecom invoices (AUTO-08)

An approved rule now pays an eligible current DEWA, Etisalat or du invoice from the wallet or from its approved card exactly once within its limits, on the real stack as well as in-process. Paid, withdrawn and over-cap invoices skip with a reason, and a card that expired after approval skips with `SOURCE_EXPIRED`. Preparation now picks the earliest-due invoice within the per-payment cap, so an over-cap invoice no longer blocks a smaller one behind it. A declined or over-limit card and short wallet funds fail visibly, release the reservation and never fall back to another source; a card challenge holds with its reservation and no money moved. The worker records owner-fixable failures and challenges as `REQUIRES_ACTION` outbox events, and the scheduler records one `UPCOMING_RUN` notice ahead of each run. Evidence: `services/test/auto08-invoices.test.ts`, `services/test/automation-worker.test.ts`, `services/test/automation-scheduler.test.ts`, `scripts/e2e/automation-execution.ts`. Answering or abandoning a held challenge, and turning these events into notifications, move to AUTO-14.

## 25 October 2026 — source lifecycle events (SIM-02)

Source providers gained a trusted, idempotent event seam (`engine.lifecycle`): recurring invoice cycles for DEWA accounts and Etisalat/du subscription renewals, fine discount changes, toll and prepaid usage, and parking departure. Each event has a stable id and an immutable record; redelivery returns the first outcome with no second bill, balance change or state change, a reused id with different content conflicts, and an event the state no longer allows is remembered as rejected, so a stale event can never reopen a paid, withdrawn or ended obligation. Usage bumps the target version and so makes an open recharge quote unpayable, and an ended parking session now refuses extension. Evidence: `services/test/sim02-events.test.ts` (with `services/test/sim02-lifecycle.test.ts` for the payment-side guards). The events are a library seam; no HTTP route or CLI command drives them yet.

## 25 October 2026 — dry-run preview of a rule (AUTO-07)

The owner can preview any stored rule, draft or approved: `GET /api/payments/mandates/preview` returns a forecast of the invoices it would consider with amount, due date and scheduled run, the funding source and whether it is usable, whether the owner's access still matches, the next run, the budget used, any cooldown and a skip reason per invoice (per-payment cap, period or lifetime budget, cooldown, already reserved, wallet balance low), plus blockers such as a draft, a pause, an expiry, a changed source or biller, or a rule kind that cannot execute yet. The forecast is a pure function over facts the route has read, so it reserves no budget, claims no invoice, issues no credential and creates no order; tests compare every table in the gateway and the source provider before and after, and the real-stack run checks the wallet and the claims. An execution never trusts it: a bill paid after the preview is skipped at preparation. The React panel gets a Preview action backed by a shared plain-language view. Evidence: `services/test/automation-runs.test.ts`, `services/test/mandate-forecast-view.test.ts`, `scripts/e2e/automation-execution.ts`. Not covered: a browser journey (QA-04) and the Angular and Flutter shells (QA-06).

## 25 October 2026 — schedules and bounded catch-up wired to persisted jobs (AUTO-06)

`services/automation-worker/src/scheduler.ts` converts approved rules, the clock and the pure calculator into idempotent jobs. Calendar rules give one occurrence per local month with LAST_DAY or SKIP month ends, invoice-due rules give one occurrence per due date at 09:00 local, and a balance threshold fires once per dip, persists its armed state and sequence in one transaction and re-arms on recovery. Repeated ticks, two processes, small or large time steps and a revised rule all converge on the same jobs; after downtime only the latest occurrence stays pending and earlier ones become visible `SKIPPED` jobs (`MISSED_CATCH_UP`), never a burst of charges. The provider exposes a read-only worker-scoped view (`rules`, due invoices, wallet balance) that reserves nothing and refuses every other identity. Scheduling is a second opt-in (`AUTOMATION_SCHEDULE_ENABLED`) beside the worker flag. Making invoices that share a due date one scheduled run fixed a case where a run and its own skips collided. The real-stack scenario reads rules over HTTP under duplicate ticks, enqueues one job and settles one invoice. Evidence: `services/test/automation-scheduler.test.ts`, `services/test/automation-runs.test.ts`, `scripts/e2e/automation-execution.ts`.

## 25 October 2026 — persistent automation worker (AUTO-05)

`services/automation-worker` adds SQLite jobs, attempts and an outbox. A job is one rule version, occurrence and target; claims take a lease and raise a fencing number that every renewal and transition must present, so two workers, a redelivery after a lapsed lease and a restart cannot run an admitted job twice. State and an append-only attempt row are written before each step is dispatched. The execution credential exists only in the running process: a restart while one was in flight holds the job instead of requesting another, a lost execute response retries only the same credential, and a definitive refusal or a provider rejection before funds fails the job. Jobs, attempts and the outbox never contain a credential (checked byte-for-byte in the database files). The worker is off unless `AUTOMATION_WORKER_ENABLED=true`, refuses production and has no Compose service; nothing enqueues jobs until AUTO-06. The real-stack scenario shows two workers racing for one job file, one settlement, no rerun, and a paused rule skipped without moving money. Evidence: `services/test/automation-worker.test.ts`, `scripts/e2e/automation-execution.ts`. Guide: `docs/development/automation-worker.md`.

## 25 October 2026 — definitive failures release reservations; AUTO-03 and PAY-08 delivered

An automatic execution whose order provably never reached funds now releases everything it held: a rejected admission, a provider rejection before capture, a failed authorization or an admission window that closed unused cancels or fails the order, drops the shared payable claim in the source provider and the gateway, and frees the period and lifetime budget (`AutomationRuns.reconcile` and `sweepExpired`; the sweep runs at the start of each preparation). The occurrence itself stays final: preparing it again answers `AUTOMATION_OCCURRENCE_RELEASED`, and no credential or admission remains (`AUTOMATION_EXECUTION_RELEASED`). Captured work, an unknown outcome and a pending challenge are never released: a lost response after capture is held as `RECONCILIATION_REQUIRED` with its claim and reservation, and resuming with the same spent permit session recovers the original order. Tests inject a crash at each of the three checkout failpoints and prove one debit after recovery, no second permit and no release while the outcome is unknown. With this, the credential, admission, budget, race, outage and restart gates in AUTO-03, and the automatic-caller reservation and retry gates in PAY-08, hold on the Compose stack with wallet-funded DEWA bills. Not covered and carried by their own tasks: card sources and card challenges (AUTO-08), the persistent worker and leases (AUTO-05), and schedules (AUTO-06). Mandates still return `executionEnabled:false`; no worker or scheduled write is enabled.

## 25 October 2026 — automatic execution qualified for races, outage and restart (AUTO-03 step 4)

The real-stack proof now also covers two workers asking at once (one token is bound, the loser's is useless), three parallel executes with one token (one admission, one debit), a broker outage during execution (nothing moves; the same bound token completes after recovery), a payments restart followed by a replay (same settled order, no charge) and an owner pause between credential and admission (admission re-reads authority and refuses; the reservation stays held). Two defects surfaced and were fixed: the engine refused to reopen an armed run even with its original context, and the provider contract never listed `pause`, `resume` and `skip-next`, so they returned 404 over HTTP (OpenAPI regenerated). A spent permit with no recorded admission, as after a crash, now continues once through the permit session instead of staying locked; without a session it stays denied. Definitive-failure release of reservations is not done and is tracked as TODO step 5.

## 25 October 2026 — real-stack proof of automatic execution (AUTO-03 step 3b-ii)

`npm run demo:verify:automation-execution` arms an isolated payments run in the e2e environment (`startEnvironment({automation})`, no browser bundle), points the Compose broker at it and drives the whole path on the pinned Keycloak: only the `automation-worker` service account prepares and obtains a credential, the minted 90-second owner token settles the stored DEWA bill order exactly once with the wallet debited once, and a replay, a second credential or any wallet, transactions or top-up call moves nothing. Making it work corrected four defects: the worker could not reach `prepare` over HTTP (it required an interactive caller), the worker client lacked a `preferred_username` claim and the verifier audience, the source provider dropped the token when calling the gateway, and the payable snapshot was read before the permit session existed. A call that finds its execution already admitted now resumes the same order using the session instead of spending anything (unit-tested with a lost response). Mandates still return `executionEnabled:false`; no worker or schedule is enabled.

## 25 October 2026 — execution token session across the provider chain (AUTO-03 step 3b-i)

After the broker consumes the permit, the same token may finish only its own order: the broker answers `POST /api/delegation/automation/session` for a consumed or uncertain permit that has not expired (owner and client must match), carrying the permit's exact operation. Providers then apply exact allowlists (`services/provider-simulator/src/automation-session.ts`): the source provider covers one payable, its admission, admit, settlement, finish and cancel; the gateway covers reading the one order and charge. Every other path, payable or workspace stays denied, and the interactive-only gates and the grant check are skipped only for a token with such a session. Evidence: `services/test/automation-session.test.ts`, `services/test/automation-permits.test.ts`. The Compose proof with an armed run is TODO 3b-ii.

## 25 October 2026 — dedicated execution route for automatic orders (AUTO-03 step 3)

`POST /internal/automation-runs/{runId}/execution/{id}/execute` accepts only the broker-issued per-execution token (no actor chain, no roles). The provider derives the operation from its stored preparation (`packages/protocol-core/src/automation-operation.ts`, shared with the broker's permit), the broker consumes the permit once through `POST /api/delegation/automation/authorize` after re-checking owner eligibility, and the run then re-reads mandate, source, biller and payable freshness. A stale fact records a final `REJECTED` dispatch and moves nothing; otherwise the stored order is approved, authorized and captured by the existing checkout driver (`services/provider-simulator/src/automation-execution.ts`). Only the owning execution can pass the automation claim in the provider's admission step. A second call finds the permit spent and the dispatch closed, so it cannot charge again. Not yet proven on the real stack: the dewa admission lane still requires the interactive owner (TODO 3b). Evidence: `services/test/automation-runs.test.ts`.

## 25 October 2026 — preparation creates the gateway order (AUTO-03 step 3a)

Preparing an automatic execution now also creates the real payment order for the exact payable, source and biller in the same transaction, using the existing order rules (eligibility, freshness, one active order per obligation). The order carries an `automation` marker bound to the execution, mandate and bound digest, and the preparation records its `orderId`; a retry returns the same order. Ordinary approve, challenge, capture and cancel refuse a marked order with `ORDER_AUTOMATIC`, so nothing but the dedicated execution route (step 3, still open) can move it. No credential, hold or capture exists yet and mandates still return `executionEnabled:false`. Evidence: `services/test/automation-runs.test.ts`.

## 25 October 2026 — execution credential exchange qualified (AUTO-03 step 2b-ii)

Against the Compose stack on the pinned Keycloak image, the `automation-worker` client credentials token (audiences `delegation-api`, `provider-api` and the verifier, scope `automation.execute`, a mapped `preferred_username`) now authenticates at the broker, and the broker's permit assertion mints a 60-second owner token with no refresh token and no realm roles. The delegation runner token is refused on the new endpoint, and a normal database without an armed run answers 404 so no credential is issued. The end-to-end path with a real prepared execution is tracked as TODO step 3b.

## 25 October 2026 — execution credential endpoint (AUTO-03 step 2b-ii, offline part)

The broker accepts `POST /api/delegation/automation/executions/{id}/credential` from the `automation-worker` service account only (`automation.execute` scope, no actor chain). It reads the prepared execution from the provider with the worker's own token, issues the single permit, re-checks owner eligibility, performs the exchange and binds the minted token's fingerprint to the permit (`services/delegation/src/automation.ts`, tests in `services/test/automation-credential.test.ts`). A proven refusal or lost eligibility closes the permit so one replacement is possible; an unknown exchange leaves it open, and a second token can never be bound. The provider now lets that service account, and no other machine identity, read a prepared execution, and the realm reconciler creates the `automation-worker` client and scope. The Keycloak exchange itself is not yet qualified against the pinned image, and mandates still return `executionEnabled:false`.

## 25 October 2026 — schedule calculator (AUTO-06, calculator part)

`packages/protocol-core/src/mandate-schedule.ts` computes mandate schedules as pure functions of UTC instants and the mandate's IANA zone, with tests in `services/test/mandate-schedule.test.ts`. Calendar runs honour `LAST_DAY` and `SKIP` month-end rules (including leap years) and the start and expiry window. Invoice-due runs fire a set number of local days before the due date at 09:00. Budget period keys and resets follow the local zone rather than UTC. After downtime only the latest missed occurrence becomes pending and earlier ones are reported as skipped, so a restart never produces a burst of charges. DST gaps and repeats resolve deterministically. It is not wired to jobs yet; that waits for AUTO-05.

## 25 October 2026 — one-time execution permits (AUTO-03 step 2b-i)

The delegation broker gained a permit store (`services/delegation/src/permits.ts`, tested in `services/test/automation-permits.test.ts`). A permit is issued only from a fresh, provider-owned execution view: the mandate must be approved with no skip pending, and the source, linked biller and payable must still be current inside the admission window. A worker supplies references only. The permit is bound to one token fingerprint and consumed once for exactly the operation derived from the preparation (amount, payable and revision, source version, account, bound digest); a changed fact, wrong subject or client, expired token or second admission is refused. Once a token exists the execution never receives a second credential, so an uncertain outcome holds the execution until its original operation is reconciled; an unbound permit that expired or whose exchange definitively failed can be replaced, up to three attempts. State survives restart, two connections cannot issue or consume twice, and the audit table is append-only without token material. The execution view now names the workspace owner so the broker can name the delegated subject. The Keycloak client, broker endpoint and exchange are the next step and are not yet exercised.

## 25 October 2026 — build, lint and failpoint-route repairs

The preceding slices had left `npm run check` red. Two type errors broke the provider-simulator build (the skip helper in the automation run returned a too-wide type) and three broke the agent-core build (an untyped choice-map read in the approval binding and a read of a `code` that `HttpError` never had; the response code stays `REQUEST_REJECTED`). Two lint errors came from an unused schema constant and an unused variable. The unused constant was a real defect: the HTTP failpoint route listed three failpoints by hand and refused the registered `funding.after-commit` with a validation error. The route now derives its schema from the failpoint registry, with a regression test that every registered failpoint can be armed over HTTP. All 18 workspace builds, ESLint, the E2E type check, documentation and secret checks pass again.

## 25 October 2026 — TODO.md is the only status tracker

`TODO.md` was rewritten to one short bullet per open task with sub-steps for partial work, so progress is visible and the file is cheap to load. Task status is no longer duplicated: `docs/STATUS.md` and its count table, the README progress paragraphs and the backlog counts in the index were removed (they had already drifted: the README said 24 delivered / 26 open while STATUS said 26 / 24). `README.md#what-exists-today` now describes the implemented system and `docs/reports/README.md` holds verification results; neither tracks tasks. The identity-delegation tasks (OBO-02 to OBO-33) that are delivered for the local-demo boundary and the delivered portions of partial platform tasks moved to the ledger below; their production remainders are listed under the production gate in `TODO.md`. `npm run check:docs` no longer compares counts and instead enforces unique task IDs and short task bullets. This entry also repairs a corrupted heading and a duplicated title that had accumulated in this file, and moves the ledger to the end.

## 25 October 2026 — worker-scoped execution read for the broker lane (AUTO-03 checkpoint 2)

The automation run exposes the immutable preparation to the credential broker through a worker-scoped read: only the run's exact workload identity may call it, and it re-reads the current mandate state, source version, biller link and payable revision at credential time instead of trusting the preparation. The user-confirmed path for the remaining checkpoints (broker permit-bound grant, real gateway order at preparation, worker admit route, compose worker service) is recorded in the backlog.

## 25 October 2026 — consent management actions (AUTO-04)

Automation rules can now be paused, resumed, skipped for one occurrence and revoked from the React panel through new authenticated mandate routes. Pause keeps the consent and its binds while the execution authority refuses to prepare anything not approved; resume revalidates the current sources and target exactly like a fresh approval; skip-next is a versioned one-shot that the preparation consumes once with a recorded reason. The generate provider contracts now include the new actions. Create/expand/source-change consent flows and the rule editor remain open.

## 25 October 2026 — SIM-04 and SIM-06 completed

The simulator now covers the wallet funding path with the `funding.after-commit` failpoint: the response is lost after the real atomic capture-and-credit commit and the retry replays the settled order with exactly one credit. The run-wide read-only inspection (`inspectRun`) is exposed through the operator-guarded internal controls, reporting wallet and card balances with holds, non-terminal orders with concrete mismatch reasons, settlement claims and the pending event outbox. SIM-04 and SIM-06 are delivered for the retained local-demo boundaries; their ledger entries moved to this changelog.

## 25 October 2026 — backlog now lists open work only; handoffs removed

The superseded checkpoint handoffs (`docs/development/handoff.md` and the archived `e9135ff` snapshot) were removed; STATUS is the continuation page and the delivered record lives here. All 47 completed backlog entries (PAY, AUTO, SIM, P0, P1, P2 and OBO) moved verbatim into the [completed task ledger](#completed-task-ledger) below, so the backlog lists open acceptance criteria only. The STATUS count table now reflects open work per group, and no task was closed or reopened by this reorganization.

## 25 October 2026 — guarded scenario failpoint controls (SIM-04/SIM-05)

Failpoint arming moved from test-only calls to guarded, run-scoped controls on the isolated simulator run: the run's exact operator can arm a named failpoint for a bounded count, clear and inspect redacted counters through an authenticated internal route, with immutable audit and idempotent request keys. Ordinary users are denied, the failpoint registry is a fixed list so nothing arbitrary can be injected, and the controls exist only inside an isolated run. An armed boundary loses the checkout response exactly once and recovery keeps the original single debit.

## 25 October 2026 — telecom route contracts and generalized path matching (P1-14)

The telecom `subscriptions`, `plans` and `bills` reads and the path-parameterized bill payment are registered in the request-validation registry and enforced by the shared per-route gate; the registry template matcher now supports mid-path parameters uniformly (previously only trailing parameters matched, so such routes silently skipped validation), and POST routes with path parameters validate the request body alongside the captured parameters.

## 25 October 2026 — request-body validation across application services (P2-05)

Every application-server request body must now be a plain JSON object in integrated and legacy modes, rejected with the established `VALIDATION_ERROR` contract before routing. The telecom service and the `/accounts` route run the same per-route validation gate as every other service; the telecom prepaid/recharge schemas were registered but never enforced. Schema-level tests cover the telecom gate and the plain-object rule offline.

## 25 October 2026 — P1 parity slices and the AUTO-03 preparation checkpoint

P1-12: dispatches whose action is advertised only by disabled buttons are rejected explicitly with `ACTION_DISABLED` instead of a generic denial. P1-13: conversational parking/ride/food dispatches no longer fall back to hardcoded demo resources; a missing selection fails closed with a visible rejection, and controlled `HttpError` rejections now keep their status and message at the gateway boundary. P1-14: choice-group validation enforces non-empty option ids/titles and coherent `selectedId` preselections, covered by the fuzz suite. AUTO-03 first checkpoint: run-scoped automatic execution preparation and owned inspection in a pristine, persisted isolated run — exact worker/operator identities, server-owned due-invoice resolution, one-transaction shared budget/count/cooldown/occurrence and payable exclusion, immutable preparation records with bounded admission windows and recorded skip reasons. No credential is issued, no order is created and no funds move; mandates keep `executionEnabled:false` and credential issuance, admission and qualification remain later checkpoints.

## 25 October 2026 — multi-group surface dispatch (P1-12)

Surfaces with several choice groups now dispatch a `selectedChoices` map keyed by group id; single-group surfaces keep `selectedChoice`. Every surface group scopes each dispatch, each selection must be an advertised option of its own group, and approval validates the exact per-group map while rejecting substituted options, missing or extra groups and wrong payload shapes. Client form values cannot inject either key. Group scoping moved from "rejected as ambiguous" to supported with adversarial coverage in the surface-action-scoping and approval-bindings tests.

## 25 October 2026 — read-only order inspector (SIM-06)

Add `inspectOrder`, a read-only explanation of one payment order that reports the order state, ledger and card balances, settlement claim and concrete mismatch reasons. Tests show the reasons appear after a lost response and clear after recovery. The HTTP route and its operator role remain open with SIM-05.

## 25 October 2026 — named simulator failpoints (SIM-04)

Add a named, process-local failpoint registry for the demo payment simulator. Three checkout boundaries (after admission, after a committed capture, after the provider settlement request) can lose their response once. Tests prove each recovers the original order with one debit and one payment. Callback-fault coverage already existed; scenario arming through guarded controls (SIM-05) remains open.

## 25 October 2026 — hourly model token budget (P1-05)

Add a cumulative hourly token ceiling (40,000 estimated tokens per citizen, on top of the 30-call limit) to the local and hosted model clients. Estimates use the bounded input size plus the 192-token output reservation, and a test proves the cap binds before the call count does.

## 25 October 2026 — deterministic routing evaluation (P1-05)

Move domain routing into a pure, whole-word classifier (`services/agent-core/src/domain-router.ts`). Fixed false routes such as `card` to mobility and `weather` to food, then evaluate a fixed civic, ambiguous and multilingual set offline. Arabic has no lexicon yet and is recorded as a known concierge fallback. Model evaluation, budgets and latency remain open under P1-05.

## 24 October 2026 — direct manual route approval evidence (P1-11)

Add regression tests proving that direct manual wallet routes run the same approval-gated adapters as the concierge: an unoffered top-up amount is rejected and the confirmed result is returned without a model call. Mark P1-11 complete for the integrated React scope; the legacy ride mini-app is unmounted and other shells remain chat-first by design.

## 24 October 2026 — Angular gateway build setting

Move the Angular shell's gateway URL from an unwired `NG_APP_GATEWAY_URL` lookup into `apps/shell-angular/src/environments/environment.ts`, a single explicit build-time value. Guarded by `services/test/angular-gateway-config.test.ts`; production build and gate verified. An environment-variable-driven build setting remains open under P2-06.

## 24 October 2026 — documentation and backlog reconciliation after P2-02

Consolidate the current application checkpoint in STATUS.md, reorganize the index/evidence register, refresh the active handoff and archive its superseded `e9135ff` snapshot. Correct stale test totals, readiness/authentication descriptions, API versions, payment/consent/refund status, local-AI decision amendments and references to unfinished automation. Preserve task IDs/checkmarks, dated report/recording facts, personal files and durable demo state. Strengthen documentation checks for local anchors, current npm commands and backlog-count drift; no payment/identity runtime feature is enabled by this maintenance.

## 24 October 2026 — P2-02 local operations and recovery

Add correlated HTTP/domain/MCP telemetry, private diagnostics/Prometheus metrics, bounded redacted logs, durable-work and backpressure alerts, gateway/broker readiness and graceful Node shutdown. Add signed load/soak/partial-journey qualification and encrypted, integrity-checked cold backup/restore with isolated financial/Redis/issuer and full Keycloak/Redis recovery rehearsal. Complete P2-02 for the selected single-writer demo; retain separate production HA gates. [Runbook](development/operations.md) · [Evidence](reports/2026-10-24-operations.md).

## 24 October 2026 — lifecycle tests, read-only consent review and push to GitHub

Added five SIM-02 lifecycle cases (quote agreement, repeated-delivery idempotency and stale-event rejection) and a refund-consistency case, so the simulator's refunded and withdrawn states are covered end to end (SIM-02, still partial because its invoice-period, discount, prepaid and parking scope is unbuilt). Added a read-only "Automation rules" panel that shows each mandate's trigger, target, funding, caps, expiry and revocation consequences, with no write actions (AUTO-04, still partial). The shared test baseline is now 515 Node tests and 18 workspace builds. The session's 28 commits were pushed to GitHub as a fast-forward from `edad819` to `fb24e17`.

## 24 October 2026 — backlog slices: typing, contracts, probes, supply chain and guardrails

Removed explicit `any` at trust boundaries in backend-kit, ag-ui, the surface client, the A2UI renderer and the agent graph (P2-05); the request-body type is still an assertion and agent-core `Result.data` is still `any`. Generated an OpenAPI 3.1 contract for the 46 integrated application operations (the 45 table entries plus `GET /accounts`) with an onboarding guide (P2-04). Added `/live` and `/ready` probes to the shared handlers and routed the delegation exchange-rejection log through `redact()` and `logEvent()` (P2-02). Added a local CycloneDX SBOM command, a dependency triage report and an ajv upgrade to 8.20.0, and recorded that the zod advisory has no same-major fix (P2-03). Pinned Node 24 in `engines` and `.nvmrc`, made the catalog MCP endpoint configurable, centralized script endpoints and the Angular gateway URL (P2-06). Added a protocol validator fuzz suite and fixed hostile interpolation in error messages (P1-14), an application auth-boundary matrix (QA-01) and amount-invariant tests (QA-02). Removed the legacy ride module's optimistic Salik balance (P1-11) and kept server-bound action keys authoritative in surface action payloads (P1-12). Every listed item remains partial in TODO.md; no backlog item is complete.

## 24 October 2026 — gateway business reservations and original attempts

Advance PAY-08 with canonical invoice/fine/recharge reservations before authorization, persisted pre-dispatch capture identities, unknown retention and conservative historical overlap migration. Add an owned expandable lifecycle view, signed panel/manual race/restart/recovery verification and paced recording. PAY-08 remains open for actual automatic caller/budget/occurrence qualification under AUTO-03. [Guide](development/payment-obligations.md) · [Evidence](reports/2026-10-24-payment-obligations.md).

## 24 October 2026 — current owner and workspace lifecycle

Deliver PAY-21 with versioned owner/membership decisions, separate machine reader/operator lanes, current eligibility checks, approval/grant epochs and atomic gateway capture fencing. Preserve history and captured original IDs; show restricted access and stale in-flight work in React without implicit reassignment. Verify revoke/restore, source changes, authority outages, restart, delegation and actual temporary Keycloak user disablement. Update current contracts/guides; preserve dated evidence. [Guide](development/payment-lifecycle.md) · [Evidence](reports/2026-10-24-payment-lifecycle.md).

## 24 October 2026 — automation authority contract and broker hardening

Complete AUTO-02 threat modeling and negative authority gates. Freeze reviewed legacy read permissions independently of OpenAPI growth, reject extra authority fields, require exact pending-job token bindings and fence terminal results. Document current-entitlement/shared-budget/permit requirements before scheduled spending; qualify real local Keycloak and isolated providers while preserving normal broker records. [Threat model](architecture/payment-automation-security.md) · [Evidence](reports/2026-10-24-automation-security.md).

## 24 October 2026 — paginated financial statements and consistent receipts

Deliver PAY-20 with owned journal/activity snapshots, exact running balances, original masked funding/biller details and explicit capture/settlement/refund outcomes. Unify receipt facts and suppress completed styling for pending acknowledgement or unknown operations; enrich the retained wallet history without rewriting financial rows. Verify more than 100 records, source/link removal, partial funding return and restart/reload in a paced signed browser run. [Guide](development/payment-history.md) · [Evidence](reports/2026-10-24-payment-history.md).

## 24 October 2026 — owned evidence-first payment recovery

Deliver PAY-19 with paginated original-operation cases, frozen current-evidence decisions, fenced same-operation continuation, supported refund reviews and append-only local audit. Qualify before/after-commit response loss, gateway restart, reversal response loss, source-outage blocking and saved outcome reload with a paced signed browser run. Update shared payment/OpenAPI contracts and current guides. [Guide](development/payment-reconciliation.md) · [Evidence](reports/2026-10-24-payment-reconciliation.md).

## 24 October 2026 — complete retained payment-event coverage

Deliver PAY-18 for current manual flows: retain v1 stored events, add explicit v2 legacy capture/refund and parking application/release events, and bind callbacks to original captures/claims. Add owned existing-attempt inspection and signed restart/duplicate/forgery/cross-path qualification. Notifications remain non-authoritative for money effects. [Guide](development/payment-events.md) · [Evidence](reports/2026-10-24-legacy-payment-events.md).

## 24 October 2026 — explicit conversational payment funding

Deliver PAY-07 with source choice, immutable stored review, separate authorization/challenge/pay and original-order cancellation/recovery for manual/conversational bills, fines, wallet reload and civic checkout. Fix service-URL reload replacing restored reviews and challenged-group continuation replaying earlier progress. Update asserted journeys and add a paced signed browser matrix. [Guide](development/payment-surfaces.md) · [Evidence](reports/2026-10-24-payment-surfaces.md).

## 24 October 2026 — finite owner-approved mandate records

Deliver AUTO-01 with strict six-family actor/audience/target/source policies, finite caps/counts/windows, exact owner approval, append-only versions and atomic lifecycle references. Verify signed ownership, changed terms, source guards, provider restart and zero consent-time money effects. Automatic execution remains disabled. [Guide](development/payment-mandates.md) · [Evidence](reports/2026-10-24-payment-mandates.md).

## 24 October 2026 — authenticated isolated issuer outcomes

Deliver SIM-03 with eight run-scoped operator presets, pristine/path/identity confinement, frozen issuer decisions and persisted pending authorization. Pending capacity survives provider restart without capture and still requires customer execution. Add shared conditional control contracts, state migrations/backups, negative authority checks and an eight-case paced browser recording. Normal provider controls remain absent. [Guide](development/issuer-scenarios.md) · [Evidence](reports/2026-10-24-issuer-scenarios.md).

## 24 October 2026 — transactional signed payment status events

Advance PAY-18 with stored-order/source outboxes, bounded leased delivery, producer-specific callback signatures, deduplicating monotonic inbox and owned inspection hints. Prove actual source-commit response loss followed by a signed notification and explicit original-payment recovery; late events cannot regress a reversed bill. Retain SIM-03 and remaining legacy event/path gates as open. [Guide](development/payment-events.md) · [Evidence](reports/2026-10-24-payment-events.md).

## 24 October 2026 — original-source refunds after provider reversal

Deliver PAY-17 with exact cumulative refund reviews, source-authoritative full bill/fine cancellation and partial unused recharge reversal, original-card returns and available-wallet funding reversal. Persist APPLIED/REJECTED source outcomes, retain unknown refund identities, and atomically post issuer/journal/history updates. Add paced success/partial/spent-funding-denial evidence. [Guide](development/payment-refunds.md) · [Evidence](reports/2026-10-24-payment-refunds.md).

## 24 October 2026 — durable one-source grouped checkout

Deliver PAY-16 with exact group/source review, immutable child payments, sequential per-line authorization, challenges, partial receipts and same-child recovery. Persist original unified civic checkout plans to prevent fresh recharge on response-loss retry. Verify wallet/card success and partial card failure with a paced recording; retain refunds and automation as open work. [Guide](development/checkout-groups.md) · [Evidence](reports/2026-10-24-checkout-groups.md).

## 24 October 2026 — owned toll/prepaid provider recharges

Complete PAY-15 with Salik/Etisalat/du target/denomination reviews, wallet/card/challenge execution, exact provider credit, target fencing, final-confirmation recovery and original-intent adapter resume. Verify and record all six provider/funding journeys. [Guide](development/provider-recharges.md) · [Evidence](reports/2026-10-24-provider-recharges.md).

## 24 October 2026 — exact-set wallet/card fine payments

Complete PAY-14 and the remaining PAY-06 demo capture criteria. Add authoritative fine-set quotes, shared constituent locks, wallet/card/challenge execution, atomic source application, original-payment recovery and confirmed receipts. Move current manual/conversation fine payments to stored orders with exact offered bindings. [Guide](development/fine-checkout.md) · [Evidence](reports/2026-10-24-fine-checkout.md).

## 24 October 2026 — saved-card wallet funding

Deliver PAY-13 with source/amount-bound review, explicit authorization/challenge, atomic issuer capture and wallet credit, restart/retry receipts and finite legacy funding aliases. Record an asserted paced real-Keycloak journey; retain remaining payment/automation gates. [Guide](development/wallet-funding.md) · [Evidence](reports/2026-10-24-wallet-funding.md).

## 24 October 2026 — actual wallet/card bill checkout

Enable explicit approved bill execution, source payable admission, finite hold capture, source-confirmed receipts and same-order recovery. Migrate existing bill application/conversation paths to the shared wallet flow and bind offered bill ID/revision/amount. Preserve prior reviews through the capture-state migration and reject raw billing capture bypasses. Verify challenged card payment with unchanged wallet funds, wallet execution and lost-response recovery. PAY-09–PAY-12 are delivered; broader payables, refunds and automation remain open. [Guide](development/payment-checkout.md) · [Evidence](reports/2026-10-24-payment-checkout.md).

## 24 October 2026 — settlement/refund exclusion and historical migration

Guard current provider HTTP settlements with separate merchant-scoped Keycloak workloads, gateway claims/refund checks, durable source fences and receipt acknowledgements. Cover stale proofs, lost responses/ACKs, late effects after release, scoped credentials and old captured payments. Preserve financial/idempotency rows and create a consistent claims backup; old uncertain captures stay blocked until reconciled. New stored-order capture/admission remains open. [Guide](development/settlement-claims.md) · [Evidence](reports/2026-10-24-settlement-claims.md).

## 24 October 2026 — finite issuer and stored owner authorization

Deliver PAY-05 with persistent finite card attempts/limits, bound one-time interactive challenges and decline/expiry states. Add immutable source-owned authorization reviews, explicit approval, local obligation uniqueness, wallet/card holds and cancellation with actual lifecycle locks. New routes reject machine/header actors and caller price overrides. Capture and cross-path settlement/refund claims remain disabled/open. [Guide](development/payment-authorization.md) · [Evidence](reports/2026-10-24-payment-authorization.md).

## 24 October 2026 — provider-owned payable revisions and history

Advance PAY-06 with source-owned bill/fine summaries, labelled prior cycles, exact-revision review/settlement, trusted lifecycle changes and React history. Keep legacy current-bill ordering, current fine discounts and terminal-state checks. Test persistence, stale revisions, ownership, restricted/withdrawn/expired obligations and signed-owner settlement with journal assertions. Stored-order capture admission and settlement/refund claims remain open. [Guide](development/payables.md) · [Evidence](reports/2026-10-24-payables.md).

## 24 October 2026 — payment backlog review and documentation cleanup

Reconcile the 50 payment/automation tasks as 5 delivered foundations and 45 open, add delivery checkpoints and scenario coverage, correct current baseline/preview-clock/testing references, and consolidate the byte-identical revoked-consent screenshot into its canonical dated recording artifact. Preserve existing implementation changes and historical results. This review adds no payment execution or automation activation. [Backlog](../TODO.md) · [Cleanup record](reports/2026-10-24-payment-planning.md).

## 24 October 2026 — owned prepaid/vehicle links, lifecycle guards and preview clock

Deliver PAY-03/PAY-04 storage/lifecycle contracts and the initial SIM-01 preview CLI. Add one-time owned prepaid/vehicle inventory upgrades, source-provider link verification, persisted related-use removal/archive guards and UI, plus fixed-path deterministic run/clock/event/reset persistence. Prove guard behavior with trusted isolated lifecycle fixtures and real API/UI denial; no actual issuer or mandate producer is implied. Add post-fine vehicle discovery to the twelve journeys and verify JWT security time stays real. [Guide](development/simulator.md) · [Evidence](reports/2026-10-24-lifecycle-simulator.md).

## 24 October 2026 — balanced payment journal and legacy migration

Deliver PAY-02: versioned journal/postings, one-time carried wallet balances and consistent pre-migration backup, checked projection, shared available-funds holds, and atomic existing payment/refund/top-up records. Add SQL sealing guards, failure/restore/reopen regressions, a controlled live migration verifier and recovery guidance. Existing twelve journeys and the payment setup browser pass; the actual three-wallet database preserves prior resources/idempotency. Card orders, settlement claims and automation remain open. [Guide](development/payment-ledger.md) · [Evidence](reports/2026-10-24-payment-ledger.md).

## 24 October 2026 — payment account and quote-review foundation

Deliver PAY-01 and partial PAY-03/PAY-04: versioned strict contracts, saved synthetic cards/defaults, verified biller links and source-bound non-executable previews. Add the responsive React workspace, persistence/ownership/version tests and an isolated real-Keycloak browser flow. Preserve current wallet execution and keep journal/orders/automation unchecked. [Usage](development/payment-accounts.md) · [Evidence](reports/2026-10-24-payment-accounts.md).

## 24 October 2026 — payment/automation backlog and repository cleanup

Reconcile current evidence links, implementation baseline and build counts while preserving dated reports. Remove the duplicate delegation video copy; the viewer and recorder use canonical dated media. Add [the proposed payment accounts/automation design](architecture/payment-automation-demo.md) and 50 unchecked tasks in [TODO](../TODO.md), covering linked billers, synthetic saved cards, wallet/card orders/ledger/recovery, finite mandates, automatic payments/services and isolated clock/failure simulation. This is planning, with no new payment endpoints, scheduler, authority or runtime configuration enabled. [Cleanup and validation record](reports/2026-10-24-payment-planning.md).

## 24 October 2026 — internal open-source text and voice

Replace active hosted conversation with private CPU llama.cpp/Qwen; add revision-pinned KittenTTS/Whisper, a bounded internal FastAPI module and explicit model setup. Add authenticated speech/dictation, editable draft review, strict no-cloud/browser fallback, preset/speed/preview/stop controls in React/Angular and honest native/Arabic limits. Preserve button-bound approvals and model budgets, record upstream licences and generate an original voice sample. VoiceStudio is unnecessary for this scope. [Setup and licences](development/local-ai.md) · [Evidence](reports/2026-10-24-local-ai.md).

## 24 October 2026 — supported JWT-grant delegation demo

Implement the separate trusted broker, private-key RFC 7523 exchange, linked identity, durable exact-operation grants/token bindings, online provider authorization, narrowing/revocation, idempotent bounded writes and audit. Forward signed interactive identity and reject service-header impersonation in the reference profile. Add consent controls in all three shells, guarded MCP tools, real Keycloak attack checks, scoped tests, updated OpenAPI and paced browser evidence. Record the observed overlong-assertion behavior and independently enforced 90-second limits. [Decision](adr/ADR-0012-secure-delegation-demo.md) · [Guide](development/delegation.md) · [Evidence](reports/2026-10-24-delegation-demo.md). Production/security review remains open.

## 24 October 2026 — proposed secure identity delegation analysis

Analyze the supplied no-preview Keycloak RFC 7523 blueprint against the current 26.6.4 demo and tagged primary sources. Correct the native-delegation feature history; identify issuer/client and token/grant binding decisions, trusted-header migration, consent/revocation, atomic limits and optional Java mapper gates. Add [the analysis](architecture/secure-identity-delegation.md) and 36 unchecked OBO tasks in [TODO](../TODO.md), from scoped approval and exact-image proof through demo evidence and separately gated production readiness. Documentation only; no realm, runtime, credentials, providers, workflows or deployment changed by this proposal.

## 24 October 2026 — asserted browser journeys and paced recording

Replace the stale UI recorder and hand-authored fixture transcripts with one twelve-chapter browser harness using real local Keycloak, Redis and isolated REST/SQLite services. Assert approvals, exact financial effects, tracking, move-in, no-double-charge checkout, history/account restoration and logout. Visual review also caught and fixed missing utility premise references, dining delivery-field drift, dropped ride ETA, incomplete fine plate/discount fields and receipts, and paid bills included in a new checkout quote; add contract and visible-placeholder regressions. Add configurable 6-second reviews/8-second receipts, failure screenshots, strict harness checks, measured chapters/captions, MP4/WebM and preservation of historical/last successful recordings. [Guide](development/recording.md).

## 24 October 2026 — publication cleanup

Reconciled the source/evidence references for GitHub publication, fixed the ADR index table, included the browser cancellation screenshot, consolidated typed action discovery and removed redundant endpoint checks. Repeated code/document/security-pattern, Flutter and integrated demo gates before committing. Private environment values, local databases, builds and caches remain excluded. Historical reports and recordings remain dated.

## 24 October 2026 — demo target, checkpointed approval runtime and security gates

Implemented a real LangGraph prepare/review/execute graph with bounded Redis checkpoints and tested restart resume; authenticated official MCP transport; model-independent bundled service routes; expiring digest-bound approvals and cancellation; shared access-token/JWKS/introspection checks with real logout revocation; byte/deadline/admission HTTP limits; Flutter authenticated SSE; corrected resource tracking; free-provider/model request budgets; and executable ESLint/docs/secret gates. Configured the supplied environment key privately; OpenRouter still returns 401. Updated current docs and retained production requirements. [Decision](adr/ADR-0011-local-demo-target.md) · [Evidence](reports/2026-10-24-demo-completion.md).

## 23 October 2026 — latest demo validation and documentation reconciliation

Pulled `0571413`, validated real local Keycloak/provider/Redis/payment journeys and ordinary restart recovery, and reproduced OpenRouter’s 401 for the configured key. Added startup readiness polling, safe envelope validation and regressions, Flutter web/bootstrap/strict-analysis/widget checks, desktop account switching and transcript restoration fixes, neutral default greetings, and preserved model-error status on conversation reload. Reconciled all current guides/ADR/backlog/package claims while preserving dated reports and open production criteria. [Current evidence](reports/2026-10-23-demo-reconciliation.md).

## 23 October 2026 — integrated provider demo and Cityside interface

Added seven account-scoped SQLite provider simulators and generated OpenAPI 3.1 contracts; application REST adapters and a telecom service; real local Keycloak client credentials and browser PKCE; Redis conversation ownership, TTL, fenced leases, history and shared SSE replay; payment capture/decline/refund, proof checks and persistent idempotency. Unified/move-in adapters avoid legacy duplicate effects. Updated the React/Angular/Flutter design and made OpenRouter replies visible with context and explicit failures. Added the reference Compose stack, provider/Redis/integration verification and refreshed current architecture/security/setup documentation. Historical reports remain unchanged; [current evidence](reports/2026-10-23-provider-demo.md) supersedes their implementation baseline.

## 2026-10-23 — Voice and conversational chat

- Add React/Angular microphone drafts, English/Arabic recognition locale controls, optional spoken replies, visible errors/text fallback and audio cancellation on editing, sending, tab hide and teardown.
- Carry committed assistant messages with surfaces over HTTP/SSE; display replies in all shells. Add bounded deterministic context follow-ups, proposal explanations, greetings/help and approval cancellation. Chat assent never dispatches a mutation.
- Merge #6/#7; refresh backlog, document native/multilingual/runtime boundaries under P1-16/P1-03/P0-05.
- 84 tests and 14 forced JS builds pass. Actual microphone/speaker/browser/native verification remains open. [Voice guide](architecture/voice-and-conversation.md).

## 2026-10-23 — P1-12 dispatch and response handling (partial)

- Omit absent selections, initialize choices from the active surface, reset on revision replacement and reject ambiguous multi-group dispatch. Preserve advertised action parameters in Angular/Flutter.
- Validate web surfaces, read non-2xx bodies, show errors/warning surfaces, clear loading on all request outcomes and prevent duplicate local requests. Deduplicate current HTTP/SSE surface revisions.
- 77 tests and 14 forced JS build tasks pass. Browser/native validation, full form/component parity, event ordering and connection state remain open. [Evidence](reports/2026-10-23-p1-12-dispatch.md).

## 2026-10-23 — P0-10 session coordination

- Merge P0-09/P0-12 into main; refresh backlog baseline.
- Reject overlapping session transitions and stale action revisions; rotate UUID revisions on success/failure and remove timestamp-based consumed-action history.
- Preserve approvals on input rejection, allow refresh after definitive failure, and block partial/unknown sessions pending reconciliation. Update every action caller.
- 72 tests pass; 14 forced JS build tasks pass. [Evidence](reports/2026-10-23-p0-10-session-transitions.md). Distributed durability and provider reconciliation remain open.

## 2026-10-23 — P0-12 domain failure and partial-outcome propagation

- Route graph domain calls through checked result handling with per-request effect tracking; do not render success for rejected operations, thrown writes or incomplete receipts.
- Return stable FAILED / PARTIALLY_COMPLETED / UNKNOWN outcomes, matching failure surfaces over HTTP/SSE, completed-step summaries and refresh/reconciliation guidance. Stop later effects after failure; do not silently compensate or retry.
- Mark move-in plans pending approval before activation; skip empty fine settlements in composite simulation.
- Correct the positive fine-payment E2E scenario to provision sufficient fixture funds and assert fines actually clear. Add nine regression groups for real rejection, partial effects, ambiguous writes, malformed receipts, outages, request isolation, HTTP/SSE agreement and proposal-only planning.
- 67 tests and 14 forced JS build tasks pass; [evidence](reports/2026-10-23-p0-12-domain-failures.md). Durable idempotency, payment fallback/currency semantics and actual reconciliation remain P0-06/P0-10.

## 2026-10-23 — P0-09 runtime validation and money invariants

- Merged PR #2 to main, including PR #3 and the remaining-task review backlog.
- Added shared non-coercing runtime schemas across core/domain HTTP and in-process handlers; capability/tool inputs use the same source (capability versions 2.0.0).
- Reject malformed roots, undeclared/nested fields, numeric strings, non-finite/over-precision/negative/excessive amounts and missing mutation resource IDs before state changes.
- Use integer minor units for wallet, toll, order and parking amounts; enforce aggregate ceilings and validate exact selected mutation resources.
- Strengthened catalog success tests and added nine regression groups covering financial attacks, nested validation, resource selection and real HTTP boundaries. Clean install, 58 tests and 14 forced build tasks pass; [evidence](reports/2026-10-23-p0-09-validation.md).
- Domain authorization/quotes, false success, transaction durability, real Keycloak/browser/native validation remain open tasks.

## 2026-10-23 — Backlog implementation: capabilities, streams and build gates

- Completed P1-01 discovery: 32 stable capability IDs, version/owner, JSON Schemas, risk and consent metadata; catalog/list/detail/tool discovery endpoints and contract tests.
- Implemented backend/web portion of P0-02: authenticated scoped SSE, bounded replay, expiry, origin rejection, backpressure, shared React/Angular fetch client and transport regressions. Flutter/login/durable replay remain open.
- Fixed P0-08 baseline failures: package-manager metadata, Angular workspace, mini-app TypeScript configs, housing workspace, Node source type-checking, incorrect HTTP JSON response calls, crypto types and personalization scenario requiring its own active profile surface.
- Verified clean installation, 49 automated tests and all 14 JS workspace build tasks. Added a separate disposable real-Keycloak runner; Docker is unavailable, and browser installation failed, so those execution gates remain open.
- Updated README/security/architecture/development docs and TODO with [recorded evidence](reports/2026-10-23-release-gates.md); no workflows enabled or model API calls made.

## 2026-10-23 — Full documentation reconciliation

- Replaced misleading `README.md` claims of full agentic autonomy/official protocol support with an **as-built prototype** description and free-model/no-key quick start.
- Added [index](INDEX.md) and detailed [local development](development/local-development.md), [testing](development/testing.md), [agent runtime](architecture/agent-runtime.md), [service contracts](architecture/service-contracts.md), [frontend/mini-apps](architecture/frontend-and-miniapps.md), and [target architecture](architecture/target-architecture.md) guides.
- Rewrote [system overview](architecture/system-overview.md) to show direct TypeScript service calls, in-memory state and custom HTTP/SSE protocol.
- Corrected public AG-UI/A2UI terminology in [protocol guide](architecture/protocol-ag-ui-a2-ui.md); distinguished advertised `GET /mcp` tool listings from verified protocol-compliant MCP servers.
- Revisited ADR-0001–0008 with implementation statuses, and added [ADR-0009](adr/ADR-0009-agent-first-with-bounded-authority.md) for proposed Option A.
- Reorganized [TODO](../TODO.md) into prioritized P0/P1/P2 work, preserving the old historical demo checklist under [history](history/demo-backlog-pre-production.md).
- Expanded [SECURITY](../SECURITY.md) into explicit threat boundaries and release gates; marked recordings and E2E transcripts **historical**.

Documentation work is **docs-only** and does not itself validate a successful build, Keycloak integration, agentgateway syntax, model interoperability or production behavior.

- Corrected the local conversation Docker health check to its configured private port 4201; real local text/speech verification passes.

## Completed task ledger

Backlog entries that were completed or moved out of `TODO.md`, preserved verbatim from the backlog at the time. Dated evidence links remain valid. Within this section, items marked `[x]` are complete for their stated boundary.

### P0 — Security, financial correctness and release blockers

- [x] **P0-09 — Enforce runtime input validation and money invariants.** **Implemented on main; original task evidence:** shared non-coercing input schemas for core/domain/direct callers, explicit mutation resource IDs, bounded exact money arithmetic, nested preference validation and catalog/tool input version 2.0.0. 58 tests and 14 forced build tasks pass; [evidence](reports/2026-10-23-p0-09-validation.md). Production authorization, quotes, durable/cross-currency settlement and failure propagation remain separate open tasks. **Original acceptance scope:** Apply schemas in actual domain/core/tool handlers, including nested fields, finite numbers, strict parsing, positive bounded amounts, currency and precision/minor-unit rules, valid quantities/durations and required resource IDs. Reject unknown fields and malformed preferences rather than coercing arbitrary objects/strings. Source: wallet/top-up/unified settlement, parking/EV, food orders and profile handlers; catalog inputs now share the runtime schema source. **Done when:** negative/NaN/infinite/overflow/string-coercion amounts, invalid durations and malformed nested payloads return controlled 4xx without state changes. Add regressions for both confirmed financial probes.
- [x] **P0-10 — Serialize process-local session transitions and make action consumption recoverable.** Intent/action execution, failure rendering and broadcast hold a per-session coordinator; overlapping requests return `SESSION_BUSY`. Every committed surface gets a UUID revision, required as `surfaceRevision` on action requests; stale/replayed revisions return `STALE_SURFACE`. Invalid inputs preserve the approval, definitive rejection permits a fresh intent, and partial/unknown effects block further session requests with `RECONCILIATION_REQUIRED`. Five new regression groups plus the partial-outcome regression verify concurrency, independent sessions, timestamp collisions, duplicate effects and retry behavior. [Evidence](reports/2026-10-23-p0-10-session-transitions.md). **Boundary:** original P0-10 covered process-local coordination; integrated mode now adds Redis leases/fenced saves. Cross-session effects, crash/HA recovery and authenticated business reconciliation remain P0-05/P0-06/P0-03. No client reset endpoint bypasses the reconciliation block.
- [x] **P0-12 — Propagate domain failures and report truthful outcomes.** **Implemented on main; original task evidence:** checked domain calls, per-request pending/succeeded/failed/unknown effect records, stop-on-error, partial/unknown HTTP+SSE outcomes, receipt checks and safe retry guidance. 67 tests and 14 forced build tasks pass; [evidence](reports/2026-10-23-p0-12-domain-failures.md). These are domain-reported simulator outcomes; production payment authority, compensation and durable reconciliation remain P0-06. **Original acceptance scope:** Check every domain result before creating success surfaces, receipts or subsequent effects. Fine payment, parking extension and composite journeys currently ignore failures; a rejected fine payment was reproduced as a successful core response. Define pending/succeeded/failed/partially-completed states with stable error codes and retry guidance. **Done when:** insufficient funds, unavailable services, rejected quotes and partial settlements never show paid/cleared/connected status; later irreversible steps stop or compensate as specified.

### P1 — Complete the agent-centric product and integration boundaries

- [x] **P1-03 — Connect the primary React fines journey to the focused agent.** Reuse existing components and the Cityside compatibility surface; map conversational SSE, exact approval actions, inspect/recover and cancellation to `/api/agent`. **Done when:** a browser journey retrieves fines, reviews and approves a simulated payment, survives an agent restart and proves duplicate/stale/cross-owner actions add no payment. Keep other journeys on their current path until migrated.
- [x] **P1-05 — Qualify the selected local planner for the focused demo.** Versioned English/Arabic list/pay/renewal/clarification/out-of-scope and follow-up cases meet declared exact-selection/latency thresholds; live isolated approvals, ownership and idempotency pass, with malformed/output-budget/timeout failure checks and no silent fallback. Evidence is limited to the pinned local model and finite corpus.
- [x] **P1-07 — Implement real MCP; add A2A only for a demonstrated remote-agent need (demo complete).** Core `/mcp` now supports official SDK initialization/discovery/calls with authentication and the existing guarded intent/action APIs. Independent reference-client tests cover successful calls, hostile origin, tampering and replay; the integrated verifier calls a tool with real local Keycloak. A2A is deferred by ADR-0011 because no remote-agent need is selected. Application descriptor endpoints remain compatibility metadata; obsolete gateway configuration is not a verified path. **Original scope:** Replace `GET /mcp` descriptor JSON with supported initialization, tool discovery/call transport, schemas, authentication and errors; reconcile catalog/tool names. Catalog currently lacks the `/mcp` route referenced by gateway YAML. Define remote-agent identities, delegated authority and cancellation before A2A execution. **Done when:** independent reference clients invoke authorized tools successfully and reject unauthorized calls; document A2A as deferred if no remote-agent requirement is selected.
- [x] **P1-11 — Make manual mini-app journeys independent of concierge state (integrated React scope).** React service navigation now opens `/services/{id}` through the model-independent `/api/manual/prepare` allowlist and shares the normal approval/effect guard. All eleven integrated routes and cancellation replay denial pass. Other shells retain chat-first navigation; legacy standalone mount modules are not an integrated remote runtime. The legacy ride mini-app no longer writes an optimistic Salik balance or a success label on click; it dispatches the recharge and leaves the balance to the host's confirmed result. **Evidence:** `services/test/manual-direct-routes.test.ts` proves a direct wallet route runs the same approval-gated adapter: a top-up amount the reviewed surface never offered is rejected with 403, and the prepared, confirmed top-up returns the confirmed result without any model call; `services/test/manual-services.test.ts` covers all integrated routes, cancellation and replay denial. **Boundaries:** the legacy Salik balance is not updated by any module because no retained shell mounts the legacy ride mini-app (`mini-apps/miniapp-ride`), so there is no host-side consumer to change; other shells keep chat-first navigation by design. Done when: retained direct journeys work without a prior concierge proposal and failures never update balances/status — met for the React shell and its integrated routes.
- [x] **P1-15 — Finalize deployment and external integration scope (demo target complete).** ADR-0011 records the user-selected local Docker demo, primary React/comparison shells, synthetic providers/funds, local open-source text/voice (updated by the current user choice) and no public/native/air-gapped release. Actual agency/UAE PASS/PSP contracts are not needed for this selected demo. Future production deployment reopens the original criteria. **Original scope:** Record retained shells, target hosting/OpenShift requirements, network/air-gap profile, actual provider owners, user journeys and allowed autonomy modes in ADRs with acceptance criteria. Replace placeholder agency/UAE PASS/payment endpoints with scoped provider adapters only when contracts, test environments and credentials are available. If offline operation is selected, package images/dependencies/renderer assets and self-hosted inference without external fonts/avatars/provider calls. **Done when:** each release scenario identifies its real versus simulated dependencies and testable deployment profile; no unselected provider/agent integration is claimed complete.

### P2 — Engineering, experience and operating quality

- [x] **P2-02 — Observability, capacity and recovery operations (local demo complete).** All fifteen Node boundaries have bounded redacted server/client/tool telemetry, request/run/workflow/tool/approval propagation, separate key-protected operator inspection/Prometheus metrics and process-versus-critical-dependency probes. Add stuck active/durable-work and capacity/SSE signals, optional alert rules, rotated logs, init and bounded graceful shutdown. Signed partial-journey/load/60-second-soak qualification passes; encrypted cold checkpoint/restore and fenced financial/Redis/issuer recovery preserve original replay, pending and revoked authority. A full normal-stack snapshot also boots its actual Keycloak H2 realm and Redis copy in isolated containers. [Runbook/SLOs/RPO-RTO/failover](development/operations.md) · [Executed evidence and retained old-job alert](reports/2026-10-24-operations.md). **Boundary:** the selected single-writer synthetic demo; production replicated HA, automatic/off-host backups and extended endurance qualification remain separate release gates. The daily ≤24-hour RPO objective depends on the documented operator backup schedule.

### P0 demo foundations — payment contracts, accounts and funding

- [x] **PAY-01 — Freeze the executable payment contract and first review flow.** **Owner:** payment/API/UX. **Modifies:** provider contracts, validation and review surfaces; **creates:** versioned account/method/order schemas. Model workspace versus biller account, ownership, immutable quote/source binding, payment/settlement/attempt states, money/fee bounds, typed errors and idempotency/business keys. Specify additive routes and an explicit migration for incompatible requests. **Done when:** contract fixtures drive a review-only UI/API example and reject unknown sources, cross-account resources, invalid money and changed quote/source; existing API compatibility is documented. **Delivered:** versioned strict request/method/order schemas, additive payments OpenAPI 2.1, signed owner/provider reads, source/version-bound non-executable reviews and an isolated real-Keycloak desktop/mobile flow. The legacy charge API is preserved. [Evidence](reports/2026-10-24-payment-accounts.md).
- [x] **PAY-02 — Migrate balances into a balanced payment journal.** **Owner:** payments/data. **Modifies:** payments database/projections; **creates:** versioned migrations, journal entries/postings and holds. Import each existing wallet balance as one auditable opening entry, retain historical IDs/idempotency, and prevent reseeding or replay. **Done when:** a seeded and an upgraded database display the same funds after reopen/repeated migration; postings balance per currency, available funds exclude holds, overflow/negative-balance writes fail, and backup/rollback behavior is exercised. **Delivered:** versioned balanced journal, checked wallet projection, available-funds holds and atomic legacy capture/top-up/refund postings; migration/backup/restore/reopen tests and actual three-wallet upgrade retain prior resources/idempotency. [Evidence](reports/2026-10-24-payment-ledger.md). **Depends:** PAY-01.
- [x] **PAY-03 — Link and manage owned biller/service accounts.** **Owner:** providers/UI. **Reuses:** account picker and signed resource checks; **creates:** linked-account API and React management screen. Support utility premises, telecom subscriptions/prepaid numbers, toll tags and owned vehicle/fine references, with nickname/status/verified synthetic ownership. **Done when:** personal/household links restore after restart, duplicates and another user's resource are rejected, and unlink shows dependent orders/rules rather than silently orphaning them. **Delivered:** provider-verified utility/subscription/prepaid/tag/registered-vehicle links, safe existing-account upgrades, persisted lifecycle-use guards and related-item UI; vehicles remain discoverable after fines are paid. Future producer wiring must use the guard contract. [Evidence](reports/2026-10-24-lifecycle-simulator.md). **Depends:** PAY-01.
- [x] **PAY-04 — Add saved synthetic card management.** **Owner:** payments/UI. **Creates:** local token registry and method picker; **reuses:** account-owned UI/auth. Add named approve/decline/challenge/expired-card presets, masked metadata, status, default selection and removal controls; never ask for PAN/CVV or bank credentials. **Done when:** create/select/disable/remove and restart work, ownership is checked server-side, dependent mandates/holds block unsafe removal, and changing the default does not rewrite an approved rule. **Delivered:** masked presets, persisted defaults/status/tombstones, strict versions, related order/hold/mandate use guards, direct API denial and trusted-release behavior. Issuer and consent-record producers now use these references; automatic admission remains gated by execution tasks. [Evidence](reports/2026-10-24-lifecycle-simulator.md). **Depends:** PAY-01.
- [x] **PAY-05 — Simulate issuer authorization and interactive challenges.** **Owner:** payments/simulator. **Creates:** local issuer adapter, finite synthetic limits, one-time challenge API/UI and expiry states. Bind challenges to owner/order/source/amount; unattended execution cannot answer for the user. **Done when:** approve, challenge-success/failure/expiry, disabled/expired card and insufficient-limit paths have deterministic persisted outcomes; replay or substituted challenges fail. **Delivered:** finite persisted card limits/attempts, owner/order/source/amount-bound challenge API/UI, decline/limit/expiry outcomes, and replay/unattended denial. Stored interactive reviews and actual lifecycle-use producers support authorization; bill capture is separately enabled through PAY-09–PAY-12. [Guide](development/payment-authorization.md) · [Evidence](reports/2026-10-24-payment-authorization.md). **Depends:** PAY-04, SIM-01.
- [x] **PAY-06 — Expose versioned payables and lifecycle changes.** **Owner:** providers/API. **Modifies:** DEWA/telecom/fine resources and adapters; **creates:** typed payable summaries. Include provider account, exact obligation IDs, revisions, amount/currency, due/expiry state, fine discount eligibility and paid/cancelled status. **Done when:** multiple bills/cycles are visible, ownership holds, stale amounts/discounts cannot be used for capture, and withdrawal/already-paid status prevents a new payment. **Delivered:** provider-owned revisions, multiple-cycle history, fine discounts/expiry/restrictions, guarded lifecycle mutations and React history now integrate stored bill/fine capture admission. Stale/withdrawn/paid terms deny before capture; frozen captured terms settle at their admitted value. [Capture evidence](reports/2026-10-24-fine-checkout.md). [Guide](development/payables.md) · [Evidence](reports/2026-10-24-payables.md). **Depends:** PAY-01, PAY-03.
- [x] **PAY-07 — Review an authoritative quote with a selected funding source.** **Owner:** payment/UI. **Modifies:** A2UI review, manual routes and approval digest; **reuses:** explicit confirmation/cancellation. Show biller, items, fees, AED total, wallet available funds or masked card, source version and expiry. **Done when:** changed source/quote/amount/resource, expired approval and chat/voice assent cannot execute; cancel leaves funds unchanged and Send alone cannot approve. **Delivered:** Provider-backed manual/conversational bills, exact fines, saved-card wallet reload and civic groups now choose explicit funding, freeze current displayed terms into stored reviews, and separate authorization/challenge from capture. Source/version/quote/owner/expiry/assent substitution deny; original-order cancellation releases holds and unknown responses recover original identities. Service-URL reload preserves the saved payment review. Eleven focused checks and the signed cancellation/expiry/challenged-card/restart/lost-response/funding/group matrix pass; the twelve-journey harness uses explicit funding steps. [Guide](development/payment-surfaces.md) · [Evidence](reports/2026-10-24-payment-surfaces.md). **Depends:** PAY-03–PAY-06.
- [x] **PAY-09 — Authorize, hold, capture and void finite funds.** **Owner:** payments. **Modifies:** wallet/issuer effect APIs; **creates:** durable authorization/hold transitions. Wallet available funds and card available limit reflect active holds; capture consumes a hold once and expiry/void releases it safely. **Done when:** concurrent spends cannot overdraw or exceed limits, capture/void retries are safe, authorization is distinct from user consent, and crash/reopen preserves both funds and state. **Delivered:** Finite wallet/card capture, hold consumption/void, balanced postings and durable retry/recovery pass. Expired/changed holds deny and captured orders cannot be cancelled. [Guide](development/payment-checkout.md) · [Evidence](reports/2026-10-24-payment-checkout.md). **Depends:** PAY-02, PAY-05, PAY-08.
- [x] **PAY-10 — Serialize settlement claims and refunds.** **Owner:** payments/providers/security. **Modifies:** captured-payment proof and settlement client contracts; **creates:** persisted claim/ack/release state bound to provider, payable, quote/order and attempt. A stale GET proof is insufficient for a new settlement. Refunds must reject a pending/settled claim unless authoritative non-application or a supported provider reversal is recorded; unknown claims cannot expire into spendable funds automatically. **Done when:** concurrent claim-versus-refund, duplicate claims, lost acknowledgements and restart cannot produce both a paid obligation and restored spendable money; service credentials cannot claim another provider's payment. **Delivered:** Gateway merchant claims/refund exclusion now bind real stored-order captures, source admission and exact attempts. Source fencing, ACK/release, historical migration, lost responses and race denials pass. [Guide](development/payment-checkout.md) · [Evidence](reports/2026-10-24-payment-checkout.md). **Depends:** PAY-08, PAY-09.

### P1 demo manual payments, settlement and recovery

- [x] **PAY-11 — Pay utility and telecom bills from the wallet.** **Owner:** application/providers/UI. **Modifies:** existing bill adapters; **reuses:** quote/order/hold and provider proof checks. **Done when:** DEWA/Etisalat/du bill payment displays funding and receipt, debits the exact amount once, stops on insufficient funds, and reports capture versus provider settlement truthfully. Direct/manual and conversational routes share the same checks. **Delivered:** DEWA/Etisalat/du wallet bills use one stored-order admission/capture/settlement path from the panel and existing manual/conversation APIs, with exact receipts and no duplicate debit. [Guide](development/payment-checkout.md) · [Evidence](reports/2026-10-24-payment-checkout.md). **Depends:** PAY-08, PAY-09, PAY-10.
- [x] **PAY-12 — Pay the same bills directly from a saved card.** **Owner:** payments/providers/UI. **Modifies:** source selection and bill execution; **reuses:** the same order/settlement path and issuer challenge. **Done when:** the selected card is charged, wallet funds stay unchanged, a challenge is shown/required correctly, and decline/expiry/timeout cannot appear as a paid bill. **Delivered:** Explicit saved-card bill payment and bound challenges capture the selected finite source, preserve wallet funds and show only source-confirmed receipts. Declines/expiry/pending outcomes remain truthful. [Guide](development/payment-checkout.md) · [Evidence](reports/2026-10-24-payment-checkout.md). **Depends:** PAY-05, PAY-11.
- [x] **PAY-13 — Top up the wallet from a selected synthetic card.** **Owner:** payments/UI. **Modifies:** wallet top-up and legacy funding-flag adapters; **reuses:** card orders/ledger. Enforce amount/fee/balance limits and credit only after confirmed capture. New automation cannot self-select `demo_approved` as funding authority. **Done when:** successful/replayed/declined/pending top-ups have exact ledger effects, wallet self-funding is rejected, and original compatibility fixtures do not become a free-credit bypass. **Delivered:** selected saved-card reviews/challenges and atomic issuer capture + balanced wallet credit; source/amount/balance limits, replay/reopen/persistence-failure coverage and persistent finite legacy funding aliases. [Guide](development/wallet-funding.md) · [Evidence](reports/2026-10-24-wallet-funding.md). **Depends:** PAY-08, PAY-09, PAY-12.
- [x] **PAY-14 — Pay an exact set of current fines using wallet or card.** **Owner:** fines/payments/UI. **Modifies:** fine selection/quote/settlement; **reuses:** common order/source flow. **Done when:** each selected ID is owned/unpaid, duplicates and stale discount/amount revisions fail, required synthetic restrictions are surfaced, and manual/parallel retries cannot pay the same fine twice. **Delivered:** exact-set source quotes, per-fine unique admission, wallet/card/challenge capture, atomic all-fine application, recovery and receipts; manual/conversation paths share the order flow and bind displayed resources/revisions. [Guide](development/fine-checkout.md) · [Evidence](reports/2026-10-24-fine-checkout.md). **Depends:** PAY-06, PAY-11, PAY-12.
- [x] **PAY-15 — Recharge toll and telecom prepaid balances.** **Owner:** RTA/telecom/UI. **Modifies:** Salik adapters; **reuses:** owned Etisalat/du prepaid inventory; **creates:** recharge execution UI/contracts. Keep wallet top-up, mobile recharge and toll recharge distinct targets with owned references and displayed denominations. **Done when:** either approved funding type produces one captured payment and one correct provider credit, with truthful pending/decline/unknown outcomes and no cross-target proof reuse. **Delivered:** owned Salik/Etisalat/du denomination-bound intents, wallet/card/challenge execution, target fences through unknown/final acknowledgement, exact provider credit/receipt and original-intent adapter resume. [Guide](development/provider-recharges.md) · [Evidence](reports/2026-10-24-provider-recharges.md). **Depends:** PAY-03, PAY-08, PAY-12.
- [x] **PAY-16 — Select one explicit funding policy for grouped checkout.** **Owner:** orchestration/UI. **Modifies:** unified checkout and totals; **reuses:** child orders and per-payable guards. Start with one selected source for all eligible lines; do not imply atomic multi-provider settlement or silent split tender. **Done when:** already-paid items are excluded, each successful line has one debit/receipt, later failure preserves prior results, and retry resumes/reconciles affected lines without charging settled ones again. **Delivered:** Owner-bound groups freeze one source/version, exact current quotes, total/digest and child IDs; already-paid exclusion, sequential execution, per-line challenges, partial receipts and original-child recovery are implemented. Legacy unified checkout persists and resumes the original group/intent. Wallet/card success, limit failure, lost-response/concurrency/cancellation/reopen tests and three paced real-Keycloak browser cases pass. [Guide](development/checkout-groups.md) · [Evidence](reports/2026-10-24-checkout-groups.md). **Depends:** PAY-11, PAY-12, PAY-14, PAY-15.
- [x] **PAY-17 — Refund/reverse payments through their original source.** **Owner:** payments/providers/UI. **Modifies:** refund routes; **creates:** cumulative refund/reversal state. Support full/partial payment refunds within captured value only where the provider declares an eligible reversal; initial bill/fine partial settlement remains unsupported. **Done when:** retries cannot over-refund, card refunds do not credit the wallet, provider settlement cannot remain paid with an untracked restored balance, spent top-up funds are not refunded into a negative wallet, and uncertain reversals require reconciliation. **Delivered:** Exact owner refund reviews and cumulative caps, durable source APPLIED/REJECTED reversals, full bill/fine cancellation, partial unused toll/mobile return and available-wallet funding reversal are implemented. Original issuer/journal/claim/order/receipt updates commit together; unknown response/persistence recovery retains original IDs, card returns never credit wallets, and held/spent funds deny overdraft. Focused and real-Keycloak paced UI checks cover success, partial/retry and spent-funding denial. [Guide](development/payment-refunds.md) · [Evidence](reports/2026-10-24-payment-refunds.md). **Depends:** PAY-09–PAY-15.
- [x] **PAY-18 — Deliver authenticated asynchronous payment events.** **Owner:** integration/payments. **Creates:** transactional outbox, event IDs, signed local callbacks and deduplicating inbox; **reuses:** order lookup and existing private service boundaries. Persist effect/event publication together and apply events with order/version checks. **Done when:** delayed/duplicate/reordered/forged delivery cannot create funds or regress terminal state, restart resumes delivery, and callback payloads alone cannot assert bill settlement. **Delivered:** Stored orders/group children, funding/refunds and provider application/reversal retain signed v1 outboxes; explicit v2 adds legacy capture/decline/refund and parking activation/extension/non-application. Inbox authentication, exact original capture/claim bindings, monotonic views, persisted leases/backoff/deduplication and no-backfill upgrade preserve money/terminal states. Owner-only capture inspection re-reads the original provider attempt; callbacks cannot settle claims or authorize effects. The original fourteen plus thirteen retained-path tests pass, with a paced signed parking/restart matrix and mixed bill/fine/toll/prepaid/funding/refund HTTP qualification. PAY-19 now supplies the workbench below; SIM-04/SIM-05 controls and automatic-caller qualification keep their separate gates. [Guide](development/payment-events.md) · [Evidence](reports/2026-10-24-legacy-payment-events.md). **Depends:** PAY-08, PAY-09, SIM-03.
- [x] **PAY-19 — Reconcile captured-but-unsettled and unknown outcomes.** **Owner:** payments/operations/UI. **Creates:** owned status/reconciliation view and guarded recovery actions; **reuses:** authoritative payment/provider lookup. Classify before-commit failures versus lost-after-commit responses. **Done when:** restart/timeout recovery proves whether to finish settlement, leave blocked or request a supported refund; a new charge or arbitrary balance edit is never the default recovery. Recovery decisions and effects are audited. **Delivered:** Owned paginated workbench, evidence-bound five-minute decisions, fenced same-operation recovery, separately approved original-source refund reviews, conservative legacy release returns, saved outcomes and append-only local audit. Fifteen focused tests and a paced signed browser matrix prove before/after-commit loss, gateway restart, reversal loss, unavailable-source blocking, owner/stale/digest denial, concurrency, unknown retry, audit rollback and pagination beyond 100 records. [Guide](development/payment-reconciliation.md) · [Evidence](reports/2026-10-24-payment-reconciliation.md). **Depends:** PAY-16–PAY-18.
- [x] **PAY-20 — Show receipts, statements and funding history consistently.** **Owner:** UI/payments. **Modifies:** wallet/history and all payment receipts; **creates:** paginated statement/order detail APIs. Display AED consistently, masked source, linked biller, fee breakdown, capture/settlement/refund state and correlation reference. **Done when:** totals reconcile to ledger/provider effects, more than 100 records paginate correctly, historical source snapshots survive removal, and partial/pending/unknown operations never show a completed receipt. **Delivered:** Owned journal/activity pagination and normalized detail APIs retain insertion ceilings, exact running balances, masked original source/biller, fee/correlation and separate capture/settlement/refund state. Receipt guards suppress unknown/partial/final-acknowledgement completion; the wallet view shows actual movement and current outcomes. Thirteen focused tests and a paced real-Keycloak browser prove 116 journal/117 activity records, snapshot stability, group accounting, removed sources/links, partial funding returns, signed exact-cent formatting and restart/reload. [Guide](development/payment-history.md) · [Evidence](reports/2026-10-24-payment-history.md). **Depends:** PAY-16, PAY-17, PAY-19.
- [x] **PAY-21 — Handle source, linked-account and owner lifecycle safely.** **Owner:** identity/payments/UI. **Modifies:** account/method unlink and entitlement handling; **reuses:** dependent-order/mandate lookup. **Done when:** disabled cards, closed links, revoked membership and user disablement stop new authorization, preserve history and identify in-flight work; no dependent rule silently moves to another workspace/source. **Delivered:** Central versioned owner/membership decisions, exact machine reader/operator lanes, no-cache current checks across core/application/provider/broker, approval/grant epochs and atomic gateway capture fencing. Revoke-and-restore, source re-enable, stale conversation actions and grants cannot renew old authority. React hides restricted financial data and identifies original in-flight payments/rules without fallback. Fifteen new regressions, signed Keycloak/operator/source/broker qualification, paced browser recording, twelve retained journeys and normal-data/authority restart preservation pass. Automatic execution and shell parity retain separate gates. [Guide](development/payment-lifecycle.md) · [Evidence](reports/2026-10-24-payment-lifecycle.md). **Depends:** PAY-03, PAY-04, PAY-08, AUTO-01.

### P0 automation authority, followed by P1 automatic services

- [x] **AUTO-01 — Record versioned, finite payment/service mandates.** **Owner:** consent/payment/API. **Creates:** durable mandate schema and authoritative validation; **reuses:** owner/account policy and consent audit patterns. Bind actor, target biller/resources, eligible operations, exact approved sources/fallback, purpose, trigger/window, per-payment/period caps, counts, expiry and cooldown. **Done when:** invalid/unbounded/cross-account policies fail, historical versions remain auditable, and neither a saved card nor a five-minute read grant confers recurring spend. **Delivered:** Strict finite actor/audience/target/source/trigger policies for all six operation families, signed-owner explicit digest approval, immutable policy history, source-owned eligibility reads and transactional lifecycle locks/release survive provider restart. Revisions withdraw old approval; wrong owners, service tokens, unbounded terms, stale sources and substituted digests deny. Fourteen focused checks and a signed six-family integration pass preserve balances/history. Consent records return `executionEnabled: false`; permits, workers, budget reservations, UI and automatic effects remain their own gates. [Guide](development/payment-mandates.md) · [Evidence](reports/2026-10-24-payment-mandates.md). **Depends:** PAY-01, PAY-03, PAY-04.
- [x] **AUTO-02 — Threat-model the expanded delegation/payment boundary.** **Owner:** identity/security/payments. **Modifies:** ADR-0012 extension contract and policy tests; **reuses:** supported RFC 7523/no-preview profile. Define who may create consent, derive exact jobs, reserve budgets, mint assertions, admit effects, revoke and reconcile. **Done when:** spoofed resources/sources, stolen tokens, LLM input, stale entitlements, grant substitution and revocation races have explicit controls and negative test cases before any scheduled money write is enabled. **Delivered:** Baseline-hashed authority/STRIDE review maps owner/worker/issuer/provider responsibilities, selected ASVS 5.0.0 and LLM threats, residual bearer risk and mandatory current-entitlement/budget/admission gates. Broker reads use an explicit profile; extra authority terms, invalid pending-job bindings and stale terminal completions deny. Thirteen focused negatives plus six retained delegation tests and signed isolated Keycloak/broker/provider qualification pass; normal grants/bindings/jobs/audit survive restart byte-for-byte. This completes the security contract; automatic PAY-08 reservation qualification and AUTO-03/PAY-21/AUTO-15 enforcement remain gates, with scheduled spending disabled. [Threat model](architecture/payment-automation-security.md) · [Evidence](reports/2026-10-24-automation-security.md). **Depends:** AUTO-01, PAY-08.

### Simulator slices — deterministic, isolated and inspectable

- [x] **SIM-04 — Inject boundary failures and event delivery faults.** **Owner:** integration/test. **Creates:** scripted failpoints before/after authorization, capture commit/response and provider settlement plus delayed/dropped/duplicate/reordered/forged callbacks. **Done when:** each failpoint has a deterministic expected state/funds/receipt result, a request can time out after a real local commit, and status recovery uses the original operation identity. **Delivered:** named failpoints in `services/provider-simulator/src/failpoints.ts` lose the response after admission, after a committed capture and after the provider settlement request; `services/test/payment-checkout.test.ts` proves each recovers the original order with one debit and one payment. Forged, duplicate, reordered, delayed and lost callback responses were already covered by `services/test/payment-events.test.ts`. **Guarded arming (done):** scenario-driven arming through the guarded controls is delivered (`services/provider-simulator/src/scenario-controls.ts`, tested in `services/test/scenario-controls.test.ts`): the isolated run's exact operator can arm a named failpoint for a bounded count, clear and inspect redacted counters over an authenticated internal route, with immutable audit and idempotent request keys; ordinary users and other identities are denied and controls exist only inside an isolated run. The wallet funding path loses its response after the real atomic capture+credit commit (`funding.after-commit`); the retry replays the settled order and credits exactly once (`services/test/scenario-controls.test.ts`). All acceptance criteria are met for the retained boundaries. **Depends:** SIM-01, PAY-08, PAY-09, PAY-18.

- [x] **SIM-06 — Inspect funds, payment/provider state and reconciliation.** **Owner:** simulator/operations/UI. **Creates:** read-only run inspector; **reuses:** ledger/order/job/audit views. **Done when:** the operator can explain balances/holds/clearing, pending events, budget reservations and provider state at each failpoint, with concrete mismatch reasons rather than a false success or an unrestricted balance-edit control. **Delivered:** `services/provider-simulator/src/run-inspector.ts` (`inspectOrder`) is a read-only explanation of one order: order state, ledger and card balances, settlement claim and mismatch reasons (unknown before capture, committed capture awaiting settlement, captured without a claim, unreleased hold). `services/test/payment-checkout.test.ts` proves the reasons appear after a lost response and clear after recovery. The run-wide read-only inspection (`inspectRun`) exposes wallet and card balances with holds, non-terminal orders with their mismatch reasons, settlement claims and the pending event outbox, through the operator-guarded internal controls (`GET /internal/scenario-controls/{runId}/inspect`); ordinary users are denied and there is no balance-edit control (`services/test/scenario-controls.test.ts`). All acceptance criteria are met for the retained boundaries. **Depends:** SIM-05, PAY-19, PAY-20, AUTO-14.

- [x] **SIM-01 — Create isolated scenarios with a persistent business clock.** **Owner:** simulator/test. **Creates:** scenario/run identity, injectable business time and bounded advance command; **reuses:** isolated provider volumes/environment. **Done when:** a run repeats from a seed across restart, advance deterministically emits due work, fixture reset cannot touch normal demo data, and JWT/key/credential validity continues to use real security time. This starts with a preview-only run. **Delivered:** fixed-path operator CLI, persistent owner/run/seed/time, bounded/idempotent advances and reset, deterministic due preview events and injectable clock; cross-process, containment, concurrency and real-time JWT tests pass. The preview-clock slice alone enables no network admin controls or provider effects. [Guide](development/simulator.md) · [Evidence](reports/2026-10-24-lifecycle-simulator.md). **Depends:** PAY-01.
- [x] **SIM-03 — Supply reproducible issuer outcomes.** **Owner:** simulator/payments. **Creates:** named approved/declined/limit/expired/disabled/challenge/pending/refund-failure presets; **reuses:** local issuer and order attempts. **Done when:** scenarios select outcomes through authenticated run configuration rather than ordinary payment body fields, behavior persists across restart, and fixture metadata never contains real card data. **Delivered:** Eight named outcomes use startup-bound, authenticated operator configuration within a pristine isolated run; ordinary body/preset overrides, foreign operators, normal/copied data and changed active sources deny. Authorization freezes the run decision. Pending card/payment/funding states reserve finite capacity without capture, persist across provider restart, and require a separate operator issuer decision plus customer execution. Original refund failures remain frozen; schema backups/migration preserve historical records. Fourteen focused checks and all eight paced real-Keycloak browser cases pass. [Guide](development/issuer-scenarios.md) · [Evidence](reports/2026-10-24-issuer-scenarios.md). **Depends:** SIM-01, PAY-05.

### Completed foundations — retain, do not reimplement

- [x] **P1-01 — Capability discovery metadata:** 32 stable IDs, versions/owners, input/output schemas, risk/consent declarations, `/capabilities`, detail lookup and linked `/tools` entries; simulator contract checks pass. Invocation enforcement is P0-09/P1-02/P1-14.
- [x] Ingress RS256 issuer/audience/expiry validation, subject-bound session/action guards and the selected local open-source inference boundary. Hosted-model helpers remain diagnostic compatibility code. Production lifecycle and domain authority remain open above.
- [x] Backend/web stream foundation: bearer fetch, replay/reset/snapshot, expiry/backpressure and Redis shared replay. Native device verification/global limits remain open.
- [x] Local demo verification foundation: real seeded Keycloak user/service tokens, provider REST/payment flows, Redis multi-client integration, ordinary container restart and scoped browser checks. Native/clean-image/production gates remain open.
- [x] Documentation index, as-built/target separation, ADR review, production warnings, historical demo archive and dated command evidence. Current changes and verification close the documented demo defects; broader production task criteria remain open.

### Phase A — decisions, contracts and implementation approval

- [x] **OBO-01 — Accept the bounded demo scope.** **Owner:** architecture/product. Define one actor, existing linked user, owned read capability and later optional simulator write; distinguish interactive-human, delegated-workload and true-machine lanes. Keep schedules, multi-hop chains and production rollout outside the first slice. **Done when:** an accepted decision records scope, exclusions, role owners, rollout/rollback boundaries and alignment with ADR-0011. Depends on the proposal review; relates to P0-03/P1-10. **Current demo disposition:** Accepted bounded local scope: isolated broker, seven exact read targets and one exact AED 1–10 synthetic credit; [ADR-0012](adr/ADR-0012-secure-delegation-demo.md).
- [x] **OBO-03 — Decide actor and token-to-grant binding.** **Owner:** identity/security. Compare controlled broker plus authenticated token-fingerprint registration with direct exchange plus a verified server-side extension. Prove how client A assertions cannot authorize client B. Specify the actual OAuth actor versus initiating workflow identity; a broker's `azp`/`act` must name the broker. **Done when:** a reviewed contract prevents token/grant substitution and defines registration races, failure/availability behavior and whether `act` is needed. Never assume arbitrary assertion claims propagate. Depends on OBO-02. **Current demo disposition:** Selected separate broker execution with SHA-256 token/grant/version/operation bindings; actual broker azp and separately audited initiator. No tokens returned to workflows.
- [x] **OBO-05 — Review and authorize the implementation plan.** **Owner:** integration/security/product. Review OBO-01–OBO-04, the optional custom-Java maintenance burden, current trusted-header migration and measurable revocation semantics. **Done when:** an explicit recorded decision authorizes only the agreed implementation phases and assigns review ownership; unresolved binding or version constraints block coding/activation. This task is a future approval gate from the supplied proposal, not a request to implement during this analysis pass. **Current demo disposition:** The user instruction to start authorizes this local implementation; ADR-0012 records its constraints. This is not independent production/security approval.

### Phase B — isolated exact-version compatibility proof

- [x] **OBO-13 — Decide and, only if needed, prove the Java mapper.** **Owner:** identity/security. First assess whether `azp` plus verified grant/audit records suffices. If required, prototype an access-token-only Java OIDC mapper restricted to verified grant type/client/user context; package the service descriptor/JAR in a pinned optimized image. No JS, form-field actors, unverified assertion parsing, user-attribute/session-note grant storage or nested chain injection. **Done when:** exact-image tests prove context, concurrent isolation, safe failure, introspection/lightweight behavior and absence from ID/user-info/unrelated flows; record a justified omission if unnecessary. Depends on OBO-12/OBO-03. Custom grant propagation beyond informational `act` needs its own reviewed extension contract. **Current demo disposition:** Mapper deliberately omitted: verified azp plus trusted grant/audit binding meets demo provenance. No Java/JS provider installed; future custom claim requirement reopens its packaging/security gate.

### Phase C — grant authority, issuer and read-only vertical slice

- [x] **OBO-19 — Replace provider user-header authority.** **Owner:** domain/integration. Update provider adapters and simulator authorization to derive delegated owner from verified credentials and current grant; remove `X-User-Subject` as authority in that lane. Specify narrowly scoped settlement-proof/status machine authorization independently. Do not grant machine provider roles to all users or fall back to fixtures/headers after denial. **Done when:** direct provider cross-user/resource/client attacks fail and valid delegated reads retain existing account ownership. Depends on OBO-18; refines P0-03/P1-02. **Current demo disposition:** Reference providers derive human ownership from signed token subject, check delegated authority online and reject service-header impersonation. Only captured-charge proof reads retain their separate machine profile; old fixtures remain explicitly separate.
- [x] **OBO-20 — Isolate delegated credential caching and retry rules.** **Owner:** integration. Keep machine `client_credentials` cache separate; initially use memory-only per-operation delegated tokens. Any cache key must include realm/issuer, user, actor, grant/version, audience/scopes, resource/operation and approval constraints. Fresh exchange means fresh assertion `jti`; ambiguous exchange/effect outcomes must preserve business idempotency. **Done when:** concurrent users/grants cannot reuse each other's token, credentials never enter persisted checkpoints/logs and 401 retries cannot widen authority or duplicate effects. Depends on OBO-17/OBO-19. **Current demo disposition:** No delegated token cache or persisted credentials; fresh assertion per operation and stable durable request-key result reuse. Unknown executions block new work without service/header fallback.
- [x] **OBO-21 — Enforce current consent and revocation semantics.** **Owner:** API/security/data. For the initial demo, check the authoritative grant on every delegated call and immediately before effects; fail closed on outage and avoid positive grant caches. Define revocation linearization, propagation SLO and already-authorized in-flight behavior. **Done when:** an introspection-active token is denied after grant revocation, including assertions signed before withdrawal and registration/revocation races; no claim that committed effects are undone. Depends on OBO-14/OBO-18. **Current demo disposition:** Current grant/version and limits checked online per delegated provider call, with no positive cache. A real introspection-active token is denied after consent revocation; authorization-point/in-flight semantics documented.
- [x] **OBO-22 — Validate one end-to-end owned read.** **Owner:** integration/test. Connect explicit consent, issuer/broker, stock Keycloak, application API and provider for the selected real catalog read; keep the opt-in profile single-hop and synthetic. **Done when:** minimally scoped read succeeds for its owner, wrong user/actor/resource/grant/audience and revoked consent fail at independent boundaries, evidence includes actual persisted business state and no credentials. Depends on OBO-15–OBO-21 and the mapper decision OBO-13. This is the gate before delegated mutations. **Current demo disposition:** Actual Keycloak/private-key broker, consent facade and all seven provider read paths pass owner/current-grant checks. This closes the local read slice, not production certification.

### Phase D — controlled writes, workflow recovery and retained paths

- [x] **OBO-23 — Bind a separately approved bounded mutation.** **Owner:** domain/security. Choose one low-value simulator effect after OBO-22 review; bind grant, actual actor, user, capability/version, exact resource/recipient/amount/currency, quote and approval revision, expiry and idempotency key. Grant consent must not replace required action confirmation. **Done when:** omitted/modified/stale/replayed/cross-grant approvals fail and exactly the approved effect occurs. Depends on OBO-22 and explicit write-slice acceptance; refines P0-04. **Current demo disposition:** Explicit exact-body one-time synthetic wallet credit succeeds once; duplicate request key returns stored result, wider amounts and another execution are denied. No general delegated spending enabled.
- [x] **OBO-28 — Enforce the single-hop boundary and future chain policy.** **Owner:** architecture/security. Reject or ignore caller-supplied `act`, subject overrides, nested chains and unsupported subdelegation; document how any future hop would obtain fresh bounded credentials and independently verified parent authority. **Done when:** injected chains cannot inherit rights and the separate approval/migration gate for native supported delegation is documented. Do not implement preview `may_act`/actor-token exchange. Depends on OBO-18/OBO-25. **Current demo disposition:** Single-hop only; unsupported act chains rejected, no may_act/native delegation or caller actor override confers authority. Future per-hop work remains a separate decision.

### Phase E — acceptance, recovery evidence and demo handover

- [x] **OBO-32 — Record asserted consent, execution and revocation scenarios.** **Owner:** test/demo. Extend the existing browser harness with grant approval, allowed owned read, bounded write if accepted, denial, revoke-after-token and safe resume. Wait for asserted application state before configurable review/receipt holds; use synthetic accounts and redact/omit tokens and keys from screenshots, traces, captions and videos. **Done when:** recordings have reproducible chapters, enough reading time, real denied/allowed outcomes and preserved historical runs; they are demo evidence, not a security certification. Depends on OBO-26/OBO-29–OBO-31. **Current demo disposition:** Asserted paced Chrome journey records explicit read consent, execution, audit, revocation and the separately approved one-time synthetic write, with 6-second reviews and 8-second results. [Viewer](recordings/delegation/index.html).

### Identity delegation (OBO) — delivered for the local-demo boundary, moved 25 October 2026

Each entry is the backlog text as it stood; "Current demo disposition" states the delivered boundary. The production remainders are tracked under the production gate in `TODO.md`.

- [x] **OBO-02 — Threat-model issuer, grant authority and API boundaries.** **Owner:** security/identity. Inventory signing/client keys, consent, tokens, account data and financial effects; model arbitrary-sub issuance, confused deputy, cross-client/user/tenant substitution, key/JWKS abuse, bearer theft, replay, revocation races, denial of service and audit loss. **Done when:** trust diagram, STRIDE/risk register, mitigations, sender-binding decision and testable residual-risk acceptance exist. Depends on OBO-01. **Current demo disposition:** Trust/risk analysis and residual-risk disposition recorded; independent security acceptance remains OBO-35.
- [x] **OBO-04 — Specify grant, principal and capability contracts.** **Owner:** domain/API/security. Define opaque grant ID/version, realm/tenant, internal Keycloak subject and external link, actor/initiator, purpose, scope/capability versions, audiences, resources/actions, validity, revocation and parent policy. Specify money/recipient/approval limits, lifecycle APIs, error semantics and authorization-store transactions. Map real catalog scopes and the distinct assertion/access/client-auth audiences. **Done when:** schemas and policy tables express the intersection of human, actor, client, grant, approval and budget authority. Depends on OBO-01/OBO-03. **Current demo disposition:** Implemented single-realm grant/principal/operation contract and immutable owned-account identity; production tenant/entitlement/capability-version expansion remains a separate migration.
- [x] **OBO-06 — Pin and inventory the exact supported runtime.** **Owner:** identity/platform. Triage advisories, select 26.6.x patch/digest and compatible Java toolchain; inventory feature status from that tag/image and scan dependencies/image. Forbid scripts, preview aggregate flags, legacy exchange V1, experimental exchange and native delegation; avoid hidden preview dependencies such as SPIFFE authentication or preview secret rotation. **Done when:** version/feature/scan evidence and a maintained-patch decision are recorded. Depends on OBO-05; supports P2-03. **Current demo disposition:** Pinned the tested 26.6.4 image digest and supported grant path. Maintained-patch/advisory disposition and fresh image/supply-chain scanning remain open for production.
- [x] **OBO-07 — Create isolated opt-in realm/profile and safe reconciliation.** **Owner:** identity/platform. Extend the realm/bootstrap tooling for IdPs, client profiles/policies, links and scoped clients without resetting existing users or enabling the profile by default. Separate disposable demo keys from existing secrets; use synthetic data and isolated ports/state. **Done when:** repeatable apply/diff/rollback preserves UUIDs, interactive login and unrelated clients, with no secret committed. Depends on OBO-06. **Current demo disposition:** Reference demo reconciler safely provisions IdP, scopes, clients/policy and existing-user links; broker has its own volume and agent-core has no issuer-key mount. Clean-image and production rollback remain open.
- [x] **OBO-08 — Implement controlled identity linking lifecycle.** **Owner:** identity. Link external issuer/subject to existing internal users through authenticated administrative provisioning; no email auto-link or arbitrary auto-provision. Handle unlink, disabled/deleted user, required actions and ownership continuity. **Done when:** link/unlink tests preserve current account IDs and deny unknown, cross-user and disabled identities; affected grants are invalidated as specified. Depends on OBO-07/OBO-04. **Current demo disposition:** Existing enabled users linked without UUID changes; unknown-link issuance denied. Administrative unlink/disable/role-change lifecycle and production enrollment tests remain open.
- [x] **OBO-09 — Configure the trusted JWT-grant IdP.** **Owner:** identity. Enable only the intended issuer, controlled HTTPS JWKS and pinned RS256; assertion reuse off, fresh `jti`, explicit clock skew and bounded expiration. Choose a canonical single Keycloak audience, restrict JWKS egress, reject audience escape hatches and plan rotation. **Done when:** exact export/runtime evidence proves signature, issuer, audience, time and replay checks, with no untrusted key URL input. Depends on OBO-07. **Current demo disposition:** Controlled demo JWKS, RS256, one-use jti, clock/lifetime settings and independent issuer/client caps implemented. HTTPS/egress restriction and rollover evidence remain open.
- [x] **OBO-10 — Configure and isolate confidential workload authentication.** **Owner:** identity/security. Allow JWT grant only for approved clients/IdPs; prefer tested private-key JWT or suitable mTLS, with separately managed credentials and rotation. Disable unneeded browser/password/service-account/offline flows for delegation clients; the issuer signing key must not reside in the agent runtime. **Done when:** unauthenticated/wrong-client/wrong-IdP exchange fails and issuer-to-client isolation is proven. Do not equate mTLS client authentication with sender-bound access tokens. Depends on OBO-03/OBO-09. **Current demo disposition:** Private-key JWT broker and separately authenticated runner work; runner cannot exchange assertions or create consent. Managed credential rotation remains open.
- [x] **OBO-11 — Enforce effective scope, role and audience bounds.** **Owner:** identity/API. Bind `downscope-assertion-grant-enforcer` to the approved client/IdP, minimize defaults/optional scopes, disable unrestricted role scope and review every mapper. Specify provider target audience and `cityside-verifier` inclusion only where required. **Done when:** expansion, omitted/empty scopes, hidden default scopes and unexpected role/audience injection are tested against actual tokens, including audience-restricted introspection. Depends on OBO-04/OBO-10. **Current demo disposition:** Real scope expansion denied; broker has no default client scopes, minimal output scope/audiences and no inherited realm roles. Broader policy combinations still require release testing.
- [x] **OBO-12 — Prove the stock RFC 7523 flow before extensions.** **Owner:** identity/test. Exercise linked user issuance, expected internal `sub`/`azp`, transient session, absence of refresh token, hard lifetime bounds, algorithm/claim rejection, one-time replay and introspection/revocation behavior. Probe fresh `iat` with overlong `exp`, failed exchange consuming a `jti`, and timeout retries. **Done when:** a reproducible exact-image report separates observed behavior from source hypotheses and resolves compatibility blockers. Depends on OBO-08/OBO-11. **Current demo disposition:** Actual linked issuance, no refresh token, introspection, replay and negative claim checks pass. Overlong-exp probe was accepted by Keycloak while access-token lifespan stayed capped at 90 seconds; issuer independently enforces its hard bound. Cluster/lifecycle coverage remains open.
- [x] **OBO-14 — Build the durable grant authority and migration.** **Owner:** backend/data. Implement the OBO-04 lifecycle/state/version model, authenticated owner/actor checks, immutable decision identifiers and minimum audit; choose isolated demo storage and document production migration. Redis checkpoints must not be the source of consent or budget truth. **Done when:** create/read/narrow/expire/revoke transitions are durable, race-safe, ownership-scoped and restart-tested. Depends on OBO-05/OBO-04. **Current demo disposition:** Durable SQLite grants, narrowing/versioning, expiry, withdrawal, bindings/jobs and audit implemented; two connections and reopen tested. Production migration/HA remains open.
- [x] **OBO-15 — Add explicit consent controls.** **Owner:** frontend/security. Provide authenticated grant review/create/inspect/narrow/revoke/history with clear actor, purpose, audience, resources, time and limits; bind owner/account server-side. Define renewal and step-up requirements, CSRF/origin protection and denial UX. **Done when:** cross-user edits fail and consent withdrawal is visible; chat assent, catalog metadata and existing one-time session approval cannot silently create a delegation grant. Depends on OBO-14. **Current demo disposition:** React, Angular and Flutter offer explicit bounded consent, inspect/run/revoke/history. Narrowing is API-only; native-device/UI conformance and step-up policy remain open.
- [x] **OBO-16 — Implement the independently authorized assertion issuer.** **Owner:** identity/backend. Authenticate the workload, resolve external user from the authoritative link and verify current grant, actor entitlement, resource/action and approval before signing. Issue fresh RS256 assertions with `iat`/`nbf`/`exp`, random one-time `jti`, approved scopes and canonical audience; propose 90 seconds bounded further by grant/approval expiry. **Done when:** arbitrary-sub, revoked/missing consent and overbroad requests fail; controlled JWKS/rotation, hard time bounds, rate limits and redacted issuance audit are tested. Depends on OBO-08/OBO-14/OBO-04. **Current demo disposition:** Separate issuer/client keys, authenticated runner, independent grant/ownership checks and 90-second signed assertions implemented. Production entitlement/lifecycle policy, rotation and stronger operational controls remain open.
- [x] **OBO-17 — Implement the reviewed exchange and token-binding mechanism.** **Owner:** identity/backend/security. Follow OBO-03: for the broker option, authenticate exchange, validate returned issuer/signature/user/client/scopes/audiences/expiry and atomically register SHA-256 token fingerprint to active grant version/operation. Restrict registration to the broker; never store the raw token. **Done when:** forged registration, mismatched output, revoke-during-exchange, client A→B and token G1→G2 substitution fail closed. Direct exchange requires equivalent proven binding, not a trusted-header shortcut. Depends on OBO-12/OBO-16/OBO-03 and OBO-13 if required. **Current demo disposition:** Real exchange output checked and fingerprint-bound server-side; unknown/unbound tokens and cross-user/actor/operation mismatches denied. Broader fault/rotation races remain release work.
- [x] **OBO-18 — Introduce typed principals and endpoint policies.** **Owner:** API/security. Separate human subject, OAuth client, initiator, account/tenant, scopes and verified grant in shared context/auth; preserve internal-sub account derivation. Extend JWT validation with per-endpoint scope/audience/actor requirements, current binding lookup and ownership checks while retaining strict RS256/issuer/time/JWKS limits. **Done when:** human, delegated and machine profiles cannot be confused; missing/mismatched actor or binding fails on delegated endpoints without breaking legitimate interactive requests. Depends on OBO-04/OBO-17. **Current demo disposition:** Distinct interactive, delegated and proof-reader lanes enforced; broker and provider share strict verifier/current grant checks. General typed principal/tenant and per-resource audience profiles remain open.
- [x] **OBO-24 — Make limits, revocation and effects race-safe.** **Owner:** data/domain. Implement atomic grant-version checks plus per-operation/cumulative limit reservations and commit/release accounting; coordinate revocation with reservation. Integrate durable idempotency/outbox/status reconciliation and unknown-outcome blocking. **Done when:** cross-session/process races, retries, crash/lease loss and revoke-versus-write cannot overspend or double settle; unknown effects reconcile before further authority is consumed. Depends on OBO-23/OBO-21; refines P0-06/P1-04. **Current demo disposition:** SQLite count reservation and provider idempotency prevent duplicate bounded credit; concurrent/reopen and unknown-outcome blocking tests pass. General money budgets, reconciliation/outbox/compensation remain open.
- [x] **OBO-25 — Reauthorize durable workflow and MCP continuations.** **Owner:** agent/integration. Persist grant references/versions, operation/approval state and safe correlation only; reacquire fresh credentials and check current authority on resume and every effect. Propagate cancellation and preserve reconciliation-required state. **Done when:** expired/revoked grants stop resumed/manual/tool execution, tokens/keys never enter LangGraph/Redis and restart cannot replay consumed approval. Scheduling remains a separate scope decision. Depends on OBO-20/OBO-24; refines P1-03/P1-10. **Current demo disposition:** Authenticated MCP can inspect/execute/revoke existing grants; broker jobs persist safe references/results, not tokens. Automatic LangGraph delegated resume, schedules and durable orchestration remain open.
- [x] **OBO-26 — Apply shared enforcement to every retained path.** **Owner:** API/frontend/test. Inventory all six application APIs, seven providers, direct/manual HTTP, authenticated MCP, agent tools and React/Angular/Flutter consent/action flows; update governed contracts and errors. Preserve the interactive/machine lanes with explicit policies. **Done when:** a conformance matrix proves no alternate path bypasses grant/ownership/approval enforcement; unsupported UI flows are explicitly bounded rather than counted as complete. Depends on OBO-19/OBO-25; refines P1-02/P1-07/P0-13/P0-14. **Current demo disposition:** All providers enforce shared identity/grant logic; all three shells have consent controls and MCP reuses the facade. Full native/browser conformance across every alternate retained path remains open.
- [x] **OBO-27 — Complete delegation audit and operational controls.** **Owner:** security/observability. Record user, actual actor, initiator, grant/version, issuance identifier hash, token fingerprint where used, policy/decision, resource/action, request/workflow/approval IDs and resulting effect. Specify append-only storage, access/retention, redaction and behavior on audit failure; add deny/revocation/rotation alerts and authority-store readiness. **Done when:** an authorized reviewer can trace approval through effect/denial without raw JWTs, keys or sensitive payloads; bounded 50-entry UI history is not treated as the audit ledger. Depends on OBO-14/OBO-24; refines P0-11/P2-02. **Current demo disposition:** Durable consent/issuance/authorization/effect audit and owner history implemented without raw tokens. P2-02 supplies private correlated Node telemetry, broker readiness/pending-job inspection and local operating SLOs. Immutable external audit, delegation-specific deny/rotation alert qualification and production retention/access operations remain open.
- [x] **OBO-29 — Automate the complete exact-image attack matrix.** **Owner:** security/test. Cover valid linked issuance; unknown/unlinked/disabled user; forged signature/wrong issuer/`kid`/algorithm; wrong/multi-valued audience; expired/future/overlong assertion; replay; disallowed IdP/client; scope/default-role/audience inflation; arbitrary-sub issuance; missing/expired/revoked/substituted consent; wrong API/resource/tenant; user's own entitlement ceiling; injected chains; unrelated mapper flows and concurrent claim isolation. **Done when:** independently asserted deny decisions and business-state checks pass on the pinned image, including active-token/revoked-grant and grant-store outage cases. Depends on OBO-12/OBO-22–OBO-28. **Current demo disposition:** Real assertion attack matrix and store substitution/narrowing/expiry/limit tests pass. Disabled/unlinked lifecycle, tenant, full malformed/default-policy combinations and all concurrency/fault permutations remain release work.
- [x] **OBO-30 — Test key lifecycle, replay and recovery beyond one process.** **Owner:** identity/platform/test. Rotate/retire issuer, client-auth and Keycloak signing keys independently; test unknown-key refresh limits, clock skew, exchange timeout/fresh `jti`, replay across two nodes and restart/failover, grant-store restore, budget/effect crash recovery and emergency disable. **Done when:** actual replay-state boundaries, backup behavior, stale credentials and recovery risks are measured; single-node demo results are not labeled HA proof. Depends on OBO-24/OBO-29. **Current demo disposition:** Local store two-connection/reopen behavior and P2-02 encrypted grant/job/revocation/key/session recovery plus copied Keycloak/Redis boot are tested. Multi-node replay/failover, key rollover/retirement and production disaster recovery remain open.
- [x] **OBO-31 — Validate availability and abuse controls.** **Owner:** platform/security. Set bounded sizes, timeouts, rate/concurrency limits, JWKS egress/refresh policy and grant/issuer backpressure; measure online-check latency and fail-closed behavior under outages and load. **Done when:** agreed SLOs and resource-exhaustion tests pass without bypassing consent, audit or revocation. Record bearer-theft residual risk or prove the selected sender-constrained profile separately. Depends on OBO-27/OBO-29. **Current demo disposition:** Shared bounded-body, timeout and rate/admission protections apply; authority errors deny execution. P2-02 qualifies general signed reads, a partial provider journey and local restore with explicit SLOs. Delegation-issuance-specific abuse/load/chaos and sender-binding evidence remain open.
- [x] **OBO-33 — Reconcile all affected documentation and delivery evidence.** **Owner:** integration/docs. Update README, SECURITY, as-built/target architecture, identity/provider/MCP contracts, realm/setup/testing/recording guides, ADRs, index, changelog and this backlog; retain dated historical evidence. Add clean-checkout opt-in commands, exact versions/digests, limitations, keys/rotation/revoke runbooks, rollback and migration notes. **Done when:** links/contract/secret checks pass and every implementation claim has revision/command/positive-negative evidence; broader production tasks remain open where unmet. Depends on OBO-29–OBO-32; refines P2-04. **Current demo disposition:** Current guides, status, security, architecture, ADR/index/changelog and generated contracts are reconciled; local paths/anchors/commands are checked. P2-02 adds tested local operations/recovery runbooks. Production identity rotation/migration and the remaining release evidence await their implementations.

### Confirmed defects — all fixed

The original probes used isolated synthetic fixtures; later regressions use simulated records and funds.

| Observed behavior | Source | Backlog |
| --- | --- | --- |
| Original finding: negative unified settlement increases balance — fixed on main by P0-09 | `services/service-wallet/src/index.ts` | P0-09 |
| Original finding: string `Infinity` top-up accepted — fixed on main by P0-09 | `services/service-wallet/src/index.ts` | P0-09 |
| Original finding: rejected fine payment returned a success surface — fixed on main by P0-12 | `services/agent-core/src/langgraph/graph.ts` | P0-12 |
| Original finding: unknown parking ticket modifies first meter — mutation fallback removed on main by P0-09 | `services/service-ride/src/index.ts` | P1-13, P0-03 |
| Original finding: empty wallet selection rejected — renderer dispatch fix omits absent selections | Renderer + `agent-core/src/index.ts` | P1-12 |
| Null render payload crash fixed with a regression; malformed data/render mode/timestamp/IDs/session mismatch now return validation errors | `packages/protocol-core/src/a2-ui.ts` | P1-14 (partial) |
| Flutter desktop account selector was absent; moved to the shared layout with phone/desktop switching regressions | `apps/shell-flutter/lib/main.dart` | P1-12 (partial) |
| First-start verifier reached Keycloak before realm import; `demo:up` now waits through `demo:wait` | `scripts/wait-demo-stack.ts` | P0-07/P2-06 (partial) |

### Pre-rewrite backlog text

The full backlog as it stood before this reorganization, including the long progress notes of tasks that stay open, is preserved in git history: `git show 4073ee1:TODO.md`. Delivered detail for those tasks is in the dated entries above and the linked guides.
