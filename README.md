# approved-edits

A command-line tool where a change to a text file is applied only after a person approves that exact change. Each change is backed up, applied only to an unchanged file, and checked by reading the file again.

Built in 2026 as a demonstration on a sample cafe site, with no dependencies. Write-up: https://theskript.com/work/approved-edits-demo/

## The path of one edit

1. **Propose.** A proposal names a file, the exact text to replace, its replacement and a reason. The text must appear exactly once; zero or several matches are refused.
2. **Approve.** A person approves by quoting the first eight characters of the proposal's fingerprint. The fingerprint covers the id, the file, the text to replace, the replacement and a hash of the file at proposal time.
3. **Apply.** The change is applied only if the approved proposal is unchanged and the file still matches the hash taken at proposal time. A copy of the file is kept first.
4. **Check.** The file is read again and compared with what the backup should become. The outcome is `confirmed`, `mismatch` or `not checked`.
5. **Roll back.** Restores the backup, and refuses if the file changed after the edit.

Every step is appended to a log in `.approved-edits/log.jsonl` inside the content folder.

## Use

Requires Node.js 20 or later.

`proposal.json`:

```json
{
  "id": "opening-hours",
  "file": "home.txt",
  "find": "We open at 8am on weekdays",
  "replace": "We open at 7:30am on weekdays",
  "reason": "Weekday opening time moved earlier."
}
```

```sh
node edits.mjs sample propose proposal.json
node edits.mjs sample approve opening-hours --by owner --words "Approved <first eight characters>"
node edits.mjs sample apply opening-hours
node edits.mjs sample verify opening-hours
node edits.mjs sample rollback opening-hours
node edits.mjs sample log
```

A proposal holds `id`, `file`, `find`, `replace` and `reason`. Run it on a copy of `sample/`, because applying a change edits the files. A refusal prints its reason and exits with code 1.

## Tests

```sh
npm test
```

The tests cover the full path from proposal to check and each refusal: ambiguous or missing text, a path outside the folder, an approval that does not quote the fingerprint, a file that changed first, a proposal edited after approval, a mismatch found by the check, a rollback, a rollback refused after a later edit, and replacement text inserted literally.

## Scope

- Works on plain text files in a local folder.
- Each proposal is one exact text replacement in one file.
- Every approval is recorded by name in the audit trail, next to each proposal, apply, check and rollback.
- Runs end to end on the bundled sample site.

## Limits

- The approver is a typed name, not an authenticated identity, so the log is an audit trail and not an access control.
- It handles one text replacement in one file, in a local folder of plain text files. It is not connected to a content system.
- It has not been used on real content, so no time saved or error rate is claimed.

## Licence

MIT, see `LICENSE`.
