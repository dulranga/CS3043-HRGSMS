# Staff reservation room-type filter — 11 October 2026

The updated New Reservation wizard hid the room-type filter in its date-first availability form, forcing staff to inspect every room type. The existing Room type filter now appears below the date/guest fields, offering Any type and the active catalogue choices. Staff choose a type and click Show available rooms; the existing search model and API submit `roomTypeId` and clear stale results when criteria change.

Reused the existing shadcn buttons and catalogue options. The fixed staff branch, three-stage wizard, results-before-selection ordering, READY behavior and guest/public view retain their current contracts. SRS FR-023 already requires an optional room-type criterion, and FR-034 still treats capacity as a maximum. No database/API or financial behavior changed.

Verification:

- `npm run test:m2-availability-ui --workspace frontend`: 18/18 passed, including room-type query serialization and the updated date-first filter rendering expectation.
- `npm run test:m2-staff-booking-ui --workspace frontend`: 21/21 passed, covering stage gating, selections, quote/confirmation and conflict states.
- `npm run build --workspace frontend`: passed with the existing Vite bundle-size warning.
- Manual browser check pending: use 13–15 October 2026, 1 guest, QA M2 Single, then Show available rooms. Only that type's available rooms should appear. Any type restores an unrestricted room-type search on the next submission.

No member-task checkboxes were changed solely for this UI follow-up.

Proposed commit: `feat(booking): show room-type filter in staff reservation search`

Proposed PR title: `Add room-type filtering to the staff reservation wizard`

Proposed PR description:

The staff wizard's date-first search hid its existing room-type choices. Show the shared Any type and catalogue buttons before searching, using the existing roomTypeId API criterion while retaining the current booking layout and selection behavior.

Verified with 18 availability UI checks, 21 staff booking UI checks and the frontend production build. Manual browser click-through remains pending; no API, schema or billing changes are included.
