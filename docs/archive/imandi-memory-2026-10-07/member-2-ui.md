# Historical Member 2 booking UI records

This is historical context archived from Imandi commit 3e18abf. Recheck every statement against current source, SRS, handoffs and member_work_log.md. It is not current completion or deployment evidence.

## M2-S16 public availability contract — 6 October 2026

`/rooms` is a shared staff/direct-guest search screen over the public M2-S09 API. Its companion `GET /api/availability/options` exposes only active branch IDs/names/cities and active room-type IDs/names under a read-only consistent snapshot. Search and local multiple-room selection require no authenticated actor and create no booking or hold. Each selection retains its own dates, guest count and exact catalogue rate, uses an ephemeral client selection ID, and is scoped to one branch. Member 2's later staff/guest booking screens must obtain real identity and server quotes/revalidate these selections at confirmation; browser selection data is not authorization or an agreed rate snapshot.


## M2-S17 staff booking UI integration — 6 October 2026

`/bookings/new` reuses M2-S16 search within a verified FRONT_DESK session's branch and consumes M2-S10's quote/create contracts. Quote criteria exclude identity/rate overrides; confirmation echoes the server-quoted type/base rate and policy ID with the staff-selected existing guest record and FRONT_DESK/PHONE/EMAIL channel. UI totals are exact decimal provisional estimates; the saved DRAFT invoice is authoritative. Selection changes invalidate quotes, changed catalogue/policy requires new review, inventory conflicts refresh availability, and uncertain confirmation responses must be checked against booking records before retrying. The production session seam remains null until Member 1 supplies real identity/CSRF and mounts M2-S10; development sample identities/transports never authorize production access. Guest-record lookup UI remains Member 1's integration contract.


## M2-S18 staff booking-read UI integration — 7 October 2026

`/bookings` and `/bookings/:bookingId` consume M2-S11's staff GET list/detail contracts, using verified FRONT_DESK branch identity and no submitted authority overrides. List cards show one booking and derived line counts; detail keeps every active/terminal line and its status, revision and room-assignment history. Occupancy is derived from the open CHECKED_IN assignment, separately from physical room condition. Assignment timestamps preserve historical decisions/occupancy, but joined room type/capacity/condition labels are current catalogue metadata, not historical type snapshots. The screen projects away guest NIC/contact fields and clears records after authorization denial. Production access remains gated until Member 1 identity and protected M2-S11 mounting are available; development sample transport is not authentication.


## M2-S19 staff room-line editor integration — 7 October 2026

`/bookings/:bookingId/edit` consumes M2-S11 full histories, M2-S07 current type reads and M2-S12 add/change/move contracts under a verified FRONT_DESK session/branch and Member 1-supplied mutation headers. BOOKED changes quote the assigned catalogue type directly because public availability excludes the already reserved room; add/move targets use same-branch availability and fresh review. CHECKED_IN moves fix dates/guests/agreed rate and send null price adjustment; non-zero differences require Branch Manager authority and its integration remains pending. The UI keeps unaffected lines/history, explains complete rollback, refreshes full records after success and displays the server DRAFT total/balance/credit without replacing the saved billing policy. An unknown mutation outcome is never automatically replayed and requires fresh booking records plus explicit booking/invoice reconciliation before another submission in this editor. Cancellation/refunds use Member 4's existing workflow. Production identity remains null and protected read/catalogue/modification routers remain unmounted; dev fixture changes memory only.


## M2-S20 direct guest booking UI integration — 7 October 2026

`/guest/bookings/new` consumes M2-S13 quote/create contracts through a verified guest-session/mutation-header adapter; the backend derives guest ownership and DIRECT_ONLINE, with no submitted guest/actor/channel identity. Search selects one branch and separately dated/counted room lines. Server rates and published policy feed an exact-decimal provisional quote, which requires explicit review; selection changes and stale-rate/policy rejection require a fresh quote and renewed acknowledgement. Known any-line inventory/concurrency failures retain and recheck all selections, while unknown write outcomes block another submission and direct guests to the hotel. The receipt displays one reference, agreed lines and saved DRAFT total without guest/actor/NIC/contact metadata. No online payment is taken. The direct booking route uses guest-only navigation; general role-aware navigation is a Member 1 contract. Production remains gated by a null session seam until Member 1 guest linking/session/CSRF and protected M2-S13 mounting; the development fixture is memory-only and does not authorize production. Guest history remains M2-S21.


## M2-S21 guest My Bookings UI integration — 7 October 2026

`/guest/my-bookings` and `/guest/my-bookings/:bookingId` consume M2-S14 guest GET contracts under Member 1's verified guest session, with no guest/user/branch identity overrides or staff endpoint fallback. Ownership is checked by the backend for every read; unknown and other-owner IDs share the same safe not-found result. All active/terminal line states, individual dates/guests/agreed rates, assignments/occupancy and date/rate/state histories remain available; DTOs exclude internal identity/contact/condition metadata and free-text staff notes. Reads clear stale records and authorization denial clears/locks the whole private state until a new verified session. The list includes own staff-assisted reservations too and uses bounded pagination. Both routes use guest-only navigation and expose only read/navigation actions. Member 4's previous cancellation simulator file remains preserved but unmounted; authenticated guest cancellation controls remain an owner handoff with contact-hotel guidance here. Production identity remains null pending Member 1 and protected M2-S14 mounting; the development preview is in-memory only.

