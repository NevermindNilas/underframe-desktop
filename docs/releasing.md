# Releasing

Releases are GitHub Releases of [NevermindNilas/underframe-desktop](https://github.com/NevermindNilas/underframe-desktop/releases).
Installed copies update themselves from the newest published release (`src/main/updater.js`, electron-updater's
GitHub provider), so what is attached to a release, and how it is named, matters.

## The version

- The version in `package.json` is the release date, `YYYY.M.D` without leading zeros: `2026.10.26`, `2026.11.3`.
  The tag is `v<version>`.
- It must be higher than every earlier release. The updater only installs a higher version.
- One release per day: a second fix on the same day goes out the next day, under that date.

## Steps

1. Set the version: `npm version 2026.10.26 --no-git-tag-version` (it updates `package.json` and
   `package-lock.json`).
2. Run `npm test`, commit and push `main`. The release script stops on uncommitted changes or a commit that
   isn't on `origin/main`, because the release tag points at the commit that was built.
3. Write the release notes in a Markdown file outside the repository (or commit it). The script adds a
   "Checksums (SHA-256)" section unless the notes already mention `SHA256SUMS`.
4. Check: `npm run release -- <notes.md> --dry-run`. It checks the version, the notes, git, `gh auth status` and the
   existing releases, and prints the plan. Nothing is built or created.
5. Release: `npm run release -- <notes.md>`. The script
   - builds with `npm run dist -- --publish never` (electron-builder never uploads anything itself),
   - writes `dist/SHA256SUMS.txt` for the two exes,
   - creates a **draft** release `v<version>` with `gh release create --draft`, attaching
     `Underframe-Desktop-Setup-<version>.exe`, its `.blockmap`, `Underframe-Desktop-<version>-Portable.exe`,
     `latest.yml` and `SHA256SUMS.txt`.
6. Publish the draft: open the Releases page (the draft is at the top, visible only to maintainers), check the notes
   and the five files, then **Edit** › **Publish release**, or `gh release edit v<version> --draft=false`.
   Publishing creates the tag.

Installed copies find the new release 10 seconds after they start or at their next 6-hourly check.

## Keep in mind

- Don't rename the attached files. `latest.yml` names the installer and its SHA-512; the updater downloads exactly
  that file and checks it. electron-builder already names the files as they are uploaded.
- A release without `latest.yml` can't be installed by the updater. Automatic checks then fail silently, and
  About › Check for updates tells the user to get it from the Releases page.
- Pre-releases are ignored by the updater.
- The installer isn't code-signed; the updater checks the SHA-512 from `latest.yml`, not a signature.
- The portable exe never updates itself; it only says that a newer version is out.

## Testing an update locally

1. Build and install an older version (with the updater), then build a newer one.
2. Serve a folder holding the newer `latest.yml` and the installer it names (its `.blockmap` too, if you like) on
   `http://127.0.0.1:<port>/`.
3. Start the installed app with `UF_UPDATE_FEED=http://127.0.0.1:<port>/`. It checks that feed instead of GitHub
   and prints each state as `UF_UPDATE_STATE <json>`; `UF_UPDATE_TEST_RESTART=1` installs the update as soon as it
   is downloaded. Only `http://127.0.0.1` and `http://localhost` feeds are accepted. The installer starts the
   updated app without these variables, so that copy checks GitHub.
