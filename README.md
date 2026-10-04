# companion-module-touchpoint-meetings

Bitfocus Companion module for [TouchPoint](https://www.touchpointsoftware.com/) room reservations.

For any room (optionally including the rooms inside it), it reports whether the room is in **setup**, **in use**, or in **teardown**, as feedbacks. Companion Triggers can use these to run actions when a room's setup, event, or teardown starts or ends.

## TouchPoint side

The module reads from the `CompanionMeetings` Python script, which lives in this repository at [touchpoint/CompanionMeetings.py](./touchpoint/CompanionMeetings.py). It's called through TouchPoint's Python API (`/PythonAPI/CompanionMeetings`) with HTTP Basic authentication, using a user that has the `Developer` and `APIOnly` roles.

The script is installed in TouchPoint by hand once. After that, the module installs newer versions of it itself, the way the TouchPoint-WP plugin does: the script reports its `VERSION` with every response, and when the module carries a newer one it sends it to the script's `updateScript` action, which replaces the script. The script refuses anything that isn't newer, doesn't begin with `#API`, or couldn't be updated again.

See [HELP.md](./companion/HELP.md) for setup and usage.

## Development

- `npm run build` compiles the module (and embeds the script, see below)
- `npm run dev` runs TypeScript in watch mode
- `npm run lint` runs eslint
- `npm run package` builds the distributable package
- `npm test` runs the TypeScript tests (vitest)
- `npm run test:py` runs the tests for the TouchPoint script (Python's `unittest`)

### Changing the script

1. Edit `touchpoint/CompanionMeetings.py`, and **raise its `VERSION`**. Installed copies only update to a higher version.
2. Run `npm run embed` to copy it into `src/scriptSource.ts`, which is how the module carries it. `npm run build` does this too. A test fails if the two disagree.
3. Run both test suites. If the shape of the script's results changed, update `test/fixtures/windows-result.json`; both sides are tested against it.

TouchPoint runs scripts with IronPython 2.7, but the script tests run under current Python with fakes of TouchPoint's `model`, `Data`, `q`, and .NET's `System`. A test checks the script for syntax that Python 2.7 can't parse, but it can't replace trying a change in TouchPoint.
