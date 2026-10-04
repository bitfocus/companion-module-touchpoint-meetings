# companion-module-touchpoint-meetings

Bitfocus Companion module for [TouchPoint](https://www.touchpointsoftware.com/) room reservations.

For any room (optionally including the rooms inside it), it reports whether the room is in **setup**, **in use**, or in **teardown**, as feedbacks. Companion Triggers can use these to run actions when a room's setup, event, or teardown starts or ends.

Setup and usage are in [companion/HELP.md](./companion/HELP.md), which is also what Companion shows users. This page is for people working on the module.

## How it is put together

```
src/                          the module (TypeScript)
  scriptSource.ts             GENERATED: the TouchPoint script, and the versions and address that go with it
  __tests__/                  the module's tests
touchpoint/
  CompanionMeetings.py        the script that runs inside TouchPoint
  script-version.json         GENERATED: the script's version and a hash of its content, when last embedded
scripts/embed-script.mjs      generates the two files above
test/
  python/                     the script's tests
  fixtures/                   what the script returns, as checked by both sides' tests
companion/                    manifest.json and HELP.md
```

## The TouchPoint script

The module can't read reservations directly, so it calls a Python script that runs inside TouchPoint. This is the part that most needs explaining.

**How it is called.** The module POSTs a form to `https://{host}/PythonAPI/{script name}` with HTTP Basic authentication. TouchPoint requires the user to have the `Developer` and `APIOnly` roles, and the script to begin with `#API`. TouchPoint answers `{ "output": ..., "data": {...} }`, and the script's own answer is in `data.result`. The parameter `a` says what is wanted:

| `a`            | What it does                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `rooms`        | Lists the rooms: id, parent, type, name. The module builds the room picker and works out which rooms are inside which from this. |
| `windows`      | Lists reservations for the room ids in `rooms` that overlap a range around now (`back` and `ahead`, in minutes).                 |
| `updateScript` | (POST) Replaces the script with the source in `content`. See below.                                                              |
| _(none)_       | Opened in a browser, shows a message saying that the script is ready. This is the check in the setup instructions.               |

Every result includes `scriptVersion`. `windows` also reports the church's local time and its UTC offset, taken from TouchPoint's `LocalTimeZone` setting. Reservation times are stored in local time, and the server and database are often in another zone, so the module never infers the zone from clocks.

**Where it lives.** In this repository, so that the module and the script it needs change together, in one commit and one review.

**How it gets installed and updated.** Installing it the first time is manual. After that, the module keeps it current, as the TouchPoint-WP plugin does for its scripts:

1. The module carries a copy of the script (`src/scriptSource.ts`, generated from `touchpoint/CompanionMeetings.py` by `npm run embed`; `npm run build` does it too, so a packaged module always has it).
2. Every response from the script includes its `VERSION`. If it is lower than the module's copy, or missing because the installed script predates versions, the module POSTs its copy to the script's `updateScript` action and then repeats what it was doing.
3. The installed script writes the new source over itself (`model.WriteContentPython`), but only if the new source begins with `#API`, can itself be updated again, has a `VERSION`, and that version is higher than its own. Downgrades are refused on both sides.
4. If that fails, the module doesn't retry until its settings change or it restarts, and the connection's status says what to do.

A user can turn this off in the connection's settings, and then the module only reports that the script is out of date.

**Linking to the right version.** The connection's settings link to the script at the tag for this version of the module: `{repository}/blob/v{module version}/touchpoint/CompanionMeetings.py`. So the repository must have a tag named `v` plus the version in `package.json`, for every release.

## Versions

Several things carry a version or an address and have to agree. Tests check all of them (`src/__tests__/versions.spec.ts`), and say what to change when one disagrees:

- **The module's version**, in `package.json` and `companion/manifest.json`, and in the generated `src/scriptSource.ts`. The release tag is `v` plus it.
- **The script's version**, the `VERSION` in `touchpoint/CompanionMeetings.py`, which is separate from the module's. Installed copies only update to a _higher_ version, so **a change to the script without a higher `VERSION` would never reach anyone.** `touchpoint/script-version.json` records the version and a hash of the content; `npm run embed` refuses to run if the content changed and the version didn't.
- The repository's address, and the module's name, in `package.json`, the manifest, and the script's header.
- The Node.js and Yarn versions, in `package.json`, the manifest, and every workflow.
- Version numbers in the documentation. There shouldn't be any, since they'd go out of date; a test looks.

## Changing things

**The script**

1. Edit `touchpoint/CompanionMeetings.py` and **raise its `VERSION`**.
2. Run `npm run embed`. It copies the script into the module and updates `touchpoint/script-version.json`.
3. Run both test suites (below). If the shape of the script's results changed, update `test/fixtures/windows-result.json`; both sides are tested against it.

**Releasing**

1. Raise `version` in `package.json` and `companion/manifest.json`, then run `npm run embed`.
2. Run both test suites and `npm run lint`.
3. Tag the commit `v` plus the version, and push the tag. The settings link to the script at that tag, so it has to exist.

## Development

- `npm run build` compiles the module (and embeds the script)
- `npm run dev` runs TypeScript in watch mode
- `npm run lint` runs eslint
- `npm run package` builds the distributable package
- `npm run embed` regenerates `src/scriptSource.ts` and `touchpoint/script-version.json`
- `npm test` runs the module's tests (vitest)
- `npm run test:py` runs the script's tests (Python's `unittest`)

### Tests

- **The module's** (`src/__tests__/`) cover the phase and padding logic, the HTTP client (against a real local server), the module's refresh and update behavior (with Companion's base class replaced and TouchPoint faked, under a controllable clock), the upgrade scripts, and the versions above.
- **The script's** (`test/python/`) run the real script file against fakes of TouchPoint's `model`, `Data`, and `q` and .NET's `System`. TouchPoint runs scripts with IronPython 2.7; these tests run under current Python, and one checks the script for syntax that 2.7 can't parse. They can't replace trying a change in TouchPoint, especially the first update of an installed script.
- **Both sides check the same fixture** (`test/fixtures/windows-result.json`), so a change to what the script returns that the module can't read fails a test on one side or the other.
- **CI** (`.github/workflows/tests.yml`) runs everything on every push and pull request, on Linux and Windows, and fails if the generated files are out of date.

### Committing

The pre-commit hook runs `eslint --fix` and Prettier on the staged files directly, so committing doesn't depend on which package manager is installed. The workflows use Yarn 4 through Corepack, as the module template does.
