# Operational Resilience: Ledger Time, Clock Skew, and Pause

Operational guidance for the time-dependent behaviour of the VeriTix disaster
relief contracts (`src/aid_registry.rs`, `src/cash_transfer.rs`) and for the
incident pause control added in #239.

Addresses #240 and #239.

---

## 1. Which clock the contracts use

Every time-dependent contract path reads **`env.ledger().timestamp()`**, not
`Date.now()` and not anything an oracle supplies. This is deliberate and it is
the right choice: the ledger timestamp is the one clock that every participant
in a transaction agrees on, so two validators executing the same contract
cannot disagree about whether a fund has expired.

Consequences worth internalising:

- **The contracts have no access to wall-clock time.** There is no "system
  time" inside a Soroban contract. Anything that appears to need one is
  deriving it from the ledger.
- **Oracle timestamps are validated, then discarded.** `submit_oracle_data`
  takes an oracle-supplied timestamp, checks it against the staleness and skew
  rules below, but stores `now` (the ledger time) as the record's timestamp.
  A compromised oracle cannot backdate a record.
- **Off-chain code must not assume 1:1 with ledger time.** The UI and SDK run
  on local clocks. `Date.now()` and `env.ledger().timestamp()` are different
  numbers and will differ by the close-time target plus propagation delay.

### Where ledger time drives behaviour

| Path | File | Effect |
| --- | --- | --- |
| `create_fund` | `aid_registry.rs` | Rejects `expires_at <= now` — a fund cannot be born expired |
| `create_fund` | `aid_registry.rs` | Sets `created_at = now` |
| `submit_oracle_data` | `aid_registry.rs` | Enforces staleness, future tolerance, replay protection |
| `execute_trigger` | `aid_registry.rs` | Only counts oracle records newer than `ORACLE_STALENESS_SECS` |
| `cleanup_expired_funds` | `aid_registry.rs` | Deactivates funds where `now > expires_at` |
| `recall_unused_funds` | `aid_registry.rs` | Measures `age_seconds = now - created_at` against a minimum age |
| `allocate_funds` | `aid_registry.rs` | Sets `allocated_at = now` |
| `create_transfer` | `cash_transfer.rs` | Sets `created_at = now`; caller supplies `expires_at` |
| `spend` | `cash_transfer.rs` | **Refuses** when `now > expires_at` |
| `validate_spending_rules` (`time_window`) | `cash_transfer.rs` | Refuses when `now < start` or `now > end` |
| `recall_funds` | `cash_transfer.rs` | Returns `0` (no-op) when `now <= expires_at` |
| `extend_expiry` | `cash_transfer.rs` | Caller supplies new expiry; no validation against `now` |
| `cleanup_expired_transfers` | `cash_transfer.rs` | Deactivates transfers where `now > expires_at` |

---

## 2. Skew tolerance

`aid_registry.rs` defines the oracle acceptance window:

| Constant | Value | Meaning |
| --- | --- | --- |
| `ORACLE_STALENESS_SECS` | `3600` (1 hour) | An oracle record older than this is ignored by `execute_trigger` |
| `ORACLE_FUTURE_TOLERANCE_SECS` | `300` (5 minutes) | How far ahead of ledger time an oracle timestamp may be |
| `ORACLE_MIN_CONFIDENCE` | `80` | Minimum confidence for a record to count as a confirmation |
| `ORACLE_CONFIDENCE_MAX` | `100` | Upper bound; out-of-range confidence is rejected |

The 5-minute future tolerance exists because the oracle reads a clock that is
not the ledger's. The 1-hour staleness bound is the recovery window: an oracle
that stops reporting degrades to "no automatic releases" rather than
"releases from stale data".

**Neither constant applies to fund or transfer expiry.** Those are caller
supplied absolute timestamps checked directly against ledger time. An expiry
that is 10 seconds away is 10 seconds away, with no tolerance band.

### Operational response to oracle staleness

- **Symptom:** automatic triggers stop firing; `get_oracle_records` shows the
  last record ageing past `ORACLE_STALENESS_SECS`.
- **Not an emergency.** Manual releases (#241) are unaffected — they do not
  depend on oracle data at all.
- **Action:** check the oracle feed. Do not widen `ORACLE_STALENESS_SECS` to
  paper over a stalled feed; a stale trigger is worse than no trigger.

---

## 3. Ledger stalls

A ledger stall is any period where the network stops closing ledgers. Ledger
time stops advancing, so **every time-dependent gate in these contracts freezes
at its last value**.

| Situation | Behaviour |
| --- | --- |
| `expires_at` not yet reached | Stays not-reached. Spending and releases continue as normal. |
| `expires_at` reached, then a stall | `spend` keeps refusing. `cleanup_*` does not advance. Funds stay put. |
| `recall_funds` after expiry | Correctly blocked until time advances past `expires_at`. |
| `recall_unused_funds` minimum age | The age check stalls; nothing matures early. |
| Oracle staleness window | A stall makes every record *look* stale relative to a frozen clock — no, see below. |

The oracle row needs care: because `execute_trigger` compares against
`env.ledger().timestamp()`, and that clock is frozen during a stall, an oracle
record does **not** age out during the stall. It will not suddenly become
stale mid-stall. It ages out once the ledger resumes, at which point it is
immediately more than an hour old and is correctly ignored.

### Operator runbook

**During a stall:**

1. **Do not** resubmit transactions expecting them to expire. They will not.
2. Manual releases and allocations continue to work. Use them.
3. If funds must stop moving for incident reasons, use the **pause control**
   (§4) — it is ledger-time independent and works during a stall. This is
   precisely why pause is not implemented as an expiry.

**After the ledger resumes:**

1. Ledgers close in bursts. Expiry checks become effective retroactively for
   anything whose `expires_at` passed during the stall.
2. Run `cleanup_expired_funds` and `cleanup_expired_transfers` to sweep funds
   and transfers that expired while time was frozen. Both are idempotent.
3. Expect `recall_unused_funds` to unblock en masse for anything past its
   minimum age. Review the queue before acting.
4. **Re-check the incident pause** (see §4) before resuming normal flow. A
   pause raised during the stall is still raised; lift it deliberately.

**Ledger clock reset or correction:** Soroban ledger timestamps are
monotonic in practice, but a network halt-and-restart that rewinds sequence
or close time will make recently-computed `age_seconds` wrong. After such an
event, treat all "expiring soon" and "age" reasoning as unreliable until the
ledger has been stable for at least one full close-time period.

---

## 4. Incident pause control (#239)

Expiry and recall handle funds reaching a natural end. They are not an
emergency brake: a wrong disbursement, a compromised key, or a fraudulent
release needs to stop **now**, not when something expires.

### Design

`AidRegistry` gains a contract-wide pause switch:

- `set_paused(admin, paused)` — admin-only, records who paused and when.
- `is_paused()` — read for monitoring and alerting.
- `get_pause_state()` — full state including the actor and reason.

The switch is checked by `require_not_paused` at the top of every path that
moves value out of a fund or activates a transfer:

- `submit_disbursement`, `submit_batch_disbursement`, `execute_multi_sig_release`
- `allocate_funds`
- `execute_trigger` (automatic releases)
- `recall_unused_funds`
- and in `cash_transfer.rs`: `spend`, `create_transfer`, `extend_expiry`

### What pausing deliberately does *not* block

- **`recall_unused_funds` returning funds to the donor.** Pausing must never
  trap money in a contract during an incident. Recall is the safe direction.
- **Reads.** Monitoring must keep working while paused, or operators cannot
  see what they are responding to.
- **`set_paused(false)`.** The pause must always be liftable, or a single
  mistaken call bricks disbursement until the contract is replaced.

### Authorization

Only the admin address may set or clear the pause. This is deliberately
single-key rather than multi-sig: a pause that needs 2-of-3 signatures is a
pause that fails to apply exactly when it is needed. The blast radius of a
malicious pause is bounded — no value moves — while the blast radius of
inability to pause is unbounded.

### Monitoring

Alert on both edges of the state change:

- `is_paused()` transitions `false -> true` — someone stopped the platform.
- `is_paused()` remains `true` past the expected incident window — a pause was
  left raised, which halts relief operations just as effectively as a
  compromised key.

Record the `reason` string on the pause so the monitoring alert carries
context. There is no event emitted for pause transitions; watch the read.

---

## 5. Known sharp edges

Found while documenting the above. None are fixed here.

**1. Malformed `time_window` rule parameters silently disable the rule.**
In `cash_transfer.rs`, `validate_spending_rules`:

```rust
let start = start_time.clone().to_string().parse::<u64>().unwrap_or(0);
let end = end_time.clone().to_string().parse::<u64>().unwrap_or(u64::MAX);
```

A typo'd or non-numeric `start_time` becomes `0`, so `current_time < 0` is
false; a typo'd `end_time` becomes `u64::MAX`, so `current_time > end` is false.
Either way the spending window is treated as **open forever**. A spending
restriction that fails open on bad input is a security bug, not a robustness
bug — this should reject the rule or reject the transaction rather than
defaulting.

**2. `extend_expiry` does not validate the new expiry.** It takes a caller
supplied `new_expiry` and writes it straight through, with no check that it is
in the future or sensible relative to the current one. A typo can set an expiry
in 1970 and strand a transfer.

**3. `cleanup_expired_funds` and `cleanup_expired_transfers` are uncallable
during a pause.** They are not in the guarded list above, deliberately — they
reduce state rather than move value. But if a pause is raised and the ledger
stalls, cleanup cannot run, so the "after the ledger resumes" step of the
runbook must wait for the pause to be lifted or the pause to be bypassed for
cleanup.