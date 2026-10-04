# companion-module-touchpoint-meetings

Bitfocus Companion module for [TouchPoint](https://www.touchpointsoftware.com/) room reservations.

For any room (optionally including the rooms inside it), it reports whether the room is in **setup**, **in use**, or in **teardown**, as feedbacks. Companion Triggers can use these to run actions when a room's setup, event, or teardown starts or ends.

## TouchPoint side

The module reads from the `CompanionMeetings` Python script, which lives in the TouchPointScripts repository (`Calendar/CompanionMeetings.py`). It's called through TouchPoint's Python API (`/PythonAPI/CompanionMeetings`) with HTTP Basic authentication, using a user that has the `Developer` and `APIOnly` roles.

See [HELP.md](./companion/HELP.md) for setup and usage.

## Development

- `yarn build` / `npm run build` compiles the module
- `npm run dev` runs TypeScript in watch mode
- `npm run lint` runs eslint
- `npm run package` builds the distributable package
